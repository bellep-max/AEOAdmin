/* Step 3: judge each OCR'd capture with DeepSeek, then write verdicts to prod.
 *
 * WHY THIS SHAPE. macOS Vision OCR reads these captures fine, but a regex gate
 * cannot turn the text into a verdict: business names wrap across the "1." marker
 * ("Worcester's ... Trailers &" / "1. Pet Feeds"), [RANK] renders above or below
 * the list, map/place-card widgets interleave. DeepSeek reasons over the text and
 * handles all of that. Validated on 74 rows I had adjudicated by eye: 95% agree,
 * ZERO fabrications passed as genuine (misses are the safe direction — a genuine
 * win under an unlisted alias gets held, never a fake #1 exported).
 *
 * THREE CHECKS, ALL MUST HOLD for `true`:
 *   1. presence  — the tracked business (or alias) is an actual numbered entry,
 *                  not narrative prose ("X ranks approximately around position N").
 *   2. position  — its listed position equals the stored rank. A BETTER-than-stored
 *                  read is never trusted (no upgrade); worse would de-inflate.
 *   3. location  — when a search_address is given, the capture's own search city
 *                  must equal the campaign's intended market. Catches the multi-city
 *                  trap (Seo Local ranked #1 — but searched Lehi, not Miami).
 * Anything unreadable/errored is left NULL (never guessed).
 *
 *   DATABASE_URL=... DEEPSEEK_API_KEY=... \
 *     node judge.mjs --rows=rows.json --ocr=ocr.json [--out=verdicts.json] [--apply]
 *
 * Dry-run by default; --apply writes screenshot_rank_visible (NULL-guarded).
 */
import fs from "node:fs";
import pg from "pg";

const arg = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || `--${n}=${d ?? ""}`).split("=")[1];
const APPLY = process.argv.includes("--apply");
const rows = JSON.parse(fs.readFileSync(arg("rows", "rows.json")));
const ocr = JSON.parse(fs.readFileSync(arg("ocr", "ocr.json")));
const OUT = arg("out", "verdicts.json");
const KEY = process.env.DEEPSEEK_API_KEY;
const CONC = 6;

const SYS = `You verify a tracked business's AI-search ranking screenshot. Input is OCR text (lines may wrap: a business name can sit ABOVE its "1."/"2."/"3." marker; a "(Name)", "operating as Name", "now known as X", or brand chip is an alias). The capture's search query reads "Top 3 businesses for '<kw>' in <ADDRESS>".
Return ONLY JSON: {"listed_position":N|null,"capture_city":"<city in the OCR search address>","location_matches":true|false|null,"reason":"<=10 words"}
- listed_position: the numbered position (1/2/3) where the tracked business or an alias appears as a LIST ENTRY (wrapped/garbled names count). null if it only appears in narrative prose, is a per-item [RANK] checklist, the list is scrolled out of frame, or it is absent.
- location_matches: if an INTENDED market is given, true only when the capture's search city equals it; false if a different city; null if no intended market was provided.`;

async function judge(r) {
  const t = ocr[String(r.id)] || "";
  if (!t.trim()) return { listed_position: null, location_matches: null, reason: "no ocr" };
  const u = `Tracked business: "${r.biz}"${r.aka ? ` (aliases: ${r.aka})` : ""}\nStored rank: ${r.pos}\n` +
            `${r.search_address ? `INTENDED market: ${r.search_address}\n` : ""}Platform: ${r.plat}\n\nOCR:\n${t.slice(0, 2500)}`;
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
        body: JSON.stringify({ model: "deepseek-chat", temperature: 0, max_tokens: 150,
          messages: [{ role: "system", content: SYS }, { role: "user", content: u }] }),
      });
      if (!res.ok) { await new Promise((r) => setTimeout(r, 2000)); continue; }
      const j = await res.json();
      return JSON.parse(j.choices[0].message.content.trim().replace(/^```json/, "").replace(/```$/, "").trim());
    } catch { await new Promise((r) => setTimeout(r, 2000)); }
  }
  return { listed_position: null, location_matches: null, reason: "api error" };
}

// true iff present at the stored position AND (no market given OR market matches).
function flagOf(r, d) {
  const present = d.listed_position != null && +d.listed_position === +r.pos;
  if (!present) return d.listed_position != null ? "false" : "skip"; // wrong-position -> false; absent/unreadable -> hold
  if (r.search_address && d.location_matches !== true) return "false"; // right business, wrong market
  return "true";
}

const done = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT)) : {};
const todo = rows.filter((r) => !done[String(r.id)]);
console.error(`judging ${todo.length} rows (${Object.keys(done).length} cached)`);
let i = 0;
async function worker() {
  while (i < todo.length) {
    const r = todo[i++];
    const d = await judge(r);
    done[String(r.id)] = { flag: flagOf(r, d), pos: d.listed_position, loc: d.location_matches, reason: d.reason };
    if (i % 100 === 0) { fs.writeFileSync(OUT, JSON.stringify(done)); console.error(`  ${i}/${todo.length}`); }
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
fs.writeFileSync(OUT, JSON.stringify(done));

const trueIds = rows.filter((r) => done[String(r.id)]?.flag === "true").map((r) => r.id);
const falseIds = rows.filter((r) => done[String(r.id)]?.flag === "false").map((r) => r.id);
const skip = rows.length - trueIds.length - falseIds.length;
console.log(`verdicts: true=${trueIds.length} false=${falseIds.length} held(NULL)=${skip}`);

if (!APPLY) { console.log("DRY RUN — pass --apply to write screenshot_rank_visible."); process.exit(0); }

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 25000, max: 1 });
async function upd(sql, p) {
  for (let k = 0; k < 8; k++) {
    try { return await pool.query(sql, p); } catch { await new Promise((r) => setTimeout(r, 4000)); }
  }
  throw new Error("no db");
}
const t = await upd(`UPDATE ranking_reports SET screenshot_rank_visible=true WHERE id=ANY($1::int[]) AND screenshot_rank_visible IS NULL`, [trueIds]);
const f = await upd(`UPDATE ranking_reports SET screenshot_rank_visible=false WHERE id=ANY($1::int[]) AND screenshot_rank_visible IS NULL`, [falseIds]);
console.log(`COMMITTED true:${t.rowCount} false:${f.rowCount}`);
await pool.end();
