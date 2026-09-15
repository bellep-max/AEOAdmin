/*
 * Vision validator for top-3 ranking screenshots (replaces tesseract for the
 * high-stakes headline claims). For each ranking_reports row with a top-3 rank
 * and an s3 screenshot, ask a vision model (Qwen3-VL via OpenRouter) to read the
 * NUMBERED business list and report whether the tracked business is actually a
 * list entry and at which position. Then:
 *   screenshot_rank_visible = true   iff  the tracked business IS in the numbered
 *                                          list AND its position == ranking_position
 *   screenshot_rank_visible = false  otherwise (absent / hedged-narrative fake /
 *                                          position mismatch / inconclusive)
 * This fixes what tesseract could not: narrative-hedge fakes (client absent),
 * position mismatches (client in list at a different slot than claimed), and
 * fuzzy name matches (handled by the model, not token overlap).
 *
 * Resumable: processed row ids are persisted; re-running skips them (no re-spend).
 * Rows that error (API/parse) are left unchanged and retried next run.
 *
 * Run: AWS_PROFILE=aeo-admin DATABASE_URL=... OPENROUTER_API_KEY=... \
 *      node scripts/validate-screenshot-ranks-vision.mjs [concurrency]
 */
import pg from "pg";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import fs from "node:fs";

const CONC = Number(process.argv[2] ?? "8");
const MODEL = "qwen/qwen3-vl-8b-instruct";
const KEY = process.env.OPENROUTER_API_KEY;
const PROGRESS = process.env.PROGRESS_FILE ?? "/tmp/vision-progress.json";
const s3 = new S3Client({ region: "us-east-1" });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: CONC + 2 });
// RDS drops idle connections intermittently; without this the idle-client 'error'
// event is unhandled and crashes the whole run. Swallow it — the per-row query
// path has its own try/catch and unwritten rows are retried on the next resume.
pool.on("error", () => {});

const SYS = `You are shown a screenshot of an AI assistant answer that recommends local businesses as a NUMBERED LIST (1., 2., 3., ...), sometimes followed by a burned-in "[RANK: X/Y]" footer and a narrative/summary paragraph. Judge the tracked business by its EXACT name and ONLY as a genuine numbered LIST ENTRY. Do NOT count it as "in the list" when: (a) it appears only in a narrative/summary sentence (e.g. "X ranks around position 4", "X is an emerging presence") — that is NOT a list entry; (b) the listed name is a DIFFERENT business with a similar or partially-overlapping name (e.g. "Crown Roofing" is NOT "Crown Industrial Roofing"; "Mend Spa" is NOT "Mend - Grapevine"). Minor punctuation, casing or spacing differences are fine, but the core business name must match exactly.`;
const userPrompt = (biz) =>
  `Tracked business: "${biz}". Return ONLY strict minified JSON: {"trackedInList":true|false,"trackedPosition":<int or null>,"trackedNamedAs":"<how shown or ABSENT>","burnedRankLabel":"<X/Y or null>"}`;

function parseJson(txt) {
  if (!txt) return null;
  const m = txt.replace(/```json|```/g, "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

async function classify(row) {
  const m = /^s3:\/\/([^/]+)\/(.+)$/.exec(row.url);
  const obj = await s3.send(new GetObjectCommand({ Bucket: m[1], Key: m[2] }));
  const b64 = Buffer.from(await obj.Body.transformToByteArray()).toString("base64");
  const body = {
    model: MODEL,
    temperature: 0,
    max_tokens: 400,
    messages: [
      { role: "system", content: SYS },
      { role: "user", content: [
        { type: "text", text: userPrompt(row.biz) },
        { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
      ] },
    ],
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
      body: JSON.stringify(body),
    });
    if (r.status === 429 || r.status >= 500) { await new Promise((s) => setTimeout(s, 1500 * (attempt + 1))); continue; }
    const j = await r.json();
    const parsed = parseJson(j.choices?.[0]?.message?.content);
    if (!parsed) return { err: "parse" };
    const inList = parsed.trackedInList === true;
    const pos = Number(parsed.trackedPosition);
    const verdict = inList && pos === row.pos;
    const cat = !inList ? "absent" : pos === row.pos ? "ok" : "mismatch";
    return { verdict, cat, pos: parsed.trackedPosition ?? null };
  }
  return { err: "rate" };
}

const done = fs.existsSync(PROGRESS) ? new Set(JSON.parse(fs.readFileSync(PROGRESS, "utf8"))) : new Set();
const c = await pool.connect();
const rows = (await c.query(
  `SELECT rr.id, rr.ranking_position pos, rr.screenshot_url url, COALESCE(b.name, cl.business_name) biz
     FROM ranking_reports rr JOIN keywords k ON k.id = rr.keyword_id
     LEFT JOIN businesses b ON b.id = k.business_id LEFT JOIN clients cl ON cl.id = k.client_id
    WHERE rr.screenshot_url LIKE 's3://%' AND rr.ranking_position BETWEEN 1 AND 50
    ORDER BY rr.id`)).rows;
c.release();
const todo = rows.filter((r) => !done.has(r.id));
console.log(`top-3 rows total=${rows.length} done=${done.size} todo=${todo.length} conc=${CONC}`);

const stat = { ok: 0, absent: 0, mismatch: 0, err: 0 };
let i = 0, processed = 0;
async function worker() {
  while (i < todo.length) {
    const row = todo[i++];
    try {
      const res = await classify(row);
      if (res.err) { stat.err++; continue; }
      const cc = await pool.connect();
      await cc.query("UPDATE ranking_reports SET screenshot_rank_visible=$1 WHERE id=$2", [res.verdict, row.id]);
      cc.release();
      stat[res.cat]++;
      done.add(row.id);
    } catch { stat.err++; }
    if (++processed % 25 === 0) {
      fs.writeFileSync(PROGRESS, JSON.stringify([...done]));
      console.log(`  ${processed}/${todo.length}  ok=${stat.ok} absent=${stat.absent} mismatch=${stat.mismatch} err=${stat.err}`);
    }
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
fs.writeFileSync(PROGRESS, JSON.stringify([...done]));
console.log(`\nDONE. ok(true)=${stat.ok} absent(false)=${stat.absent} mismatch(false)=${stat.mismatch} err=${stat.err}`);
console.log(`  -> visible=${stat.ok}, rejected=${stat.absent + stat.mismatch}, retry-next-run=${stat.err}`);
await pool.end();
