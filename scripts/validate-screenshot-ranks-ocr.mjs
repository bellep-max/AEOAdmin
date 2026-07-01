/*
 * OCR-validate ranking screenshots: set ranking_reports.screenshot_rank_visible.
 *
 * For each unchecked row with an s3 screenshot + a rank, download the PNG,
 * upscale 2x (Tesseract needs the resolution), OCR it, and apply TWO checks:
 *   1. RANK MATCH  — the burned-in "RANK: X/Y" label is legible and the DB
 *      ranking_position appears as an X in the image.
 *   2. ENTRY VISIBLE (top-3 only) — for a top-3 rank, the client's business
 *      name must appear in the ANSWER LIST (the text above the "[RANK:]"
 *      footer), not merely in our burned-in footer. This rejects captures that
 *      are scrolled past the client's own ranked entry (the email would then
 *      claim e.g. "#1" without ever showing the client at #1).
 *
 * VALID (true) only when both hold. Otherwise false. Errors leave the row NULL
 * to retry next run, so the job is resumable. Ranks beyond the top 3 are not
 * shown as proof, so only the rank-match check applies to them.
 *
 * Run:  AWS_PROFILE=aeo-admin DATABASE_URL=... node scripts/validate-screenshot-ranks-ocr.mjs [limit]
 */
import pg from "pg";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { execSync } from "node:child_process";
import fs from "node:fs";

const LIMIT = Number(process.argv[2] ?? "200");
const TOP3 = 3;
const s3 = new S3Client({ region: "us-east-1" });
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
const c = await pool.connect();

const norm = (s) =>
  (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
// generic words that don't distinguish a business in a list of competitors
const GENERIC = new Set([
  "the", "and", "llc", "inc", "co", "of", "near", "me", "for", "ave", "st",
  "dr", "shop", "store", "services", "service", "company", "group",
]);

/** True when the client's business appears as a NUMBERED LIST ENTRY in the
 *  answer (its brand name right after a "N." marker on its own line), above the
 *  burned-in "[RANK:]" footer. Tuned to reject narrative/summary mentions,
 *  cross-line bleed, substring hits, and shared-city tokens — so it means "the
 *  client is actually shown at their rank", not "merely named somewhere". */
function entryVisibleInList(fullText, business) {
  const m = /\[?\s*rank\s*[:#]?\s*\d+\s*\/\s*\d+/i.exec(fullText);
  const region = fullText.slice(0, m ? m.index : fullText.length);
  // brand only — drop the ", City [State]" suffix shared by every competitor
  const brand = (business || "").split(",")[0];
  const dist = norm(brand)
    .split(" ")
    .filter((t) => t.length >= 3 && !GENERIC.has(t))
    .slice(0, 3);
  if (dist.length === 0) return false;
  const need = Math.max(1, Math.ceil(dist.length / 2));
  // a list marker is "N." / "N)" followed by whitespace (ratings like "4.8"
  // have no space after the dot, so they don't match)
  const re = /(?:^|\n|\s)(\d{1,2})\s*[.)]\s+/g;
  let mm;
  while ((mm = re.exec(region)) !== null) {
    const start = mm.index + mm[0].length;
    const rest = region.slice(start);
    const nl = rest.indexOf("\n"); // entry's own line only — no cross-line bleed
    const words = new Set(
      norm(rest.slice(0, nl === -1 ? 60 : Math.min(nl, 60))).split(" "),
    ); // whole-word match: "restore" != "restoration"
    if (dist.filter((t) => words.has(t)).length >= need) return true;
  }
  return false;
}

const rows = (
  await c.query(
    `SELECT rr.id, rr.ranking_position, rr.ranking_total, rr.screenshot_url,
            COALESCE(b.name, cl.business_name) AS biz
       FROM ranking_reports rr
       JOIN keywords k ON k.id = rr.keyword_id
       LEFT JOIN businesses b ON b.id = k.business_id
       LEFT JOIN clients cl ON cl.id = k.client_id
      WHERE rr.screenshot_url LIKE 's3://%'
        AND rr.ranking_position IS NOT NULL
        AND rr.screenshot_rank_visible IS NULL
      ORDER BY rr.id DESC
      LIMIT $1`,
    [LIMIT],
  )
).rows;
console.log(`to check: ${rows.length}`);

let visible = 0,
  notVisible = 0,
  errs = 0;
const falseSamples = [];
for (const r of rows) {
  try {
    const m = /^s3:\/\/([^/]+)\/(.+)$/.exec(r.screenshot_url);
    const obj = await s3.send(new GetObjectCommand({ Bucket: m[1], Key: m[2] }));
    const buf = Buffer.from(await obj.Body.transformToByteArray());
    fs.writeFileSync("/private/tmp/ocrwork.png", buf);
    // `-s format png` re-encodes to a clean PNG — some captures carry chunks
    // leptonica/tesseract can't read (misleading "image file not found").
    execSync(
      "sips -s format png -z 3200 1440 /private/tmp/ocrwork.png --out /private/tmp/ocrwork2x.png",
      { stdio: "ignore" },
    );
    const txt = execSync("tesseract /private/tmp/ocrwork2x.png stdout --psm 6 2>/dev/null", {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    const ranks = [...txt.matchAll(/RANK[:\s]*?(\d+)\s*\/\s*(\d+)/gi)].map((mm) =>
      Number(mm[1]),
    );
    const rankMatch = ranks.includes(r.ranking_position);
    // entry-visible only gates the top-3 (the ranks we surface as proof)
    const entryOk =
      r.ranking_position > TOP3 ? true : entryVisibleInList(txt, r.biz);
    // Sole-result guard: ranking_total <= 1 means the AI couldn't find real
    // competitors and named only the client ("#1 of 1", usually with hedging
    // like "I can't reliably verify the top 3"). That's not a competitive
    // ranking — reject it even though the client technically "appears".
    const soleResult = r.ranking_total != null && Number(r.ranking_total) <= 1;
    const ok = rankMatch && entryOk && !soleResult;
    await c.query(
      "UPDATE ranking_reports SET screenshot_rank_visible=$1 WHERE id=$2",
      [ok, r.id],
    );
    if (ok) visible++;
    else {
      notVisible++;
      if (falseSamples.length < 10)
        falseSamples.push(
          `#${r.id} dbRank=${r.ranking_position} ocr=[${ranks.join(",")}] rankMatch=${rankMatch} entry=${entryOk} sole=${soleResult} biz="${(r.biz || "").slice(0, 24)}"`,
        );
    }
  } catch (e) {
    errs++;
    if (errs <= 3)
      console.log(
        `  ERR #${r.id}: ${e.message?.slice(0, 160)} | stderr=${(e.stderr || "").toString().slice(0, 160)}`,
      );
  }
  const done = visible + notVisible + errs;
  if (done % 25 === 0) console.log(`  ${done}/${rows.length}`);
}
console.log(`\ndone. visible=${visible} not-visible=${notVisible} errors=${errs}`);
if (falseSamples.length) console.log("not-visible samples:\n  " + falseSamples.join("\n  "));
await c.release();
await pool.end();
