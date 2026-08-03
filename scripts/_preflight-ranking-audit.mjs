/* Preflight for a ranking-audit CSV. Read-only.
 *   node scripts/_preflight-ranking-audit.mjs <csv> <YYYY-MM-DD>
 * Audit rules differ from daily: timestamps may span wider hours (stale
 * catch-up runs are legitimate), but the date must still be right.
 */
import fs from "node:fs";
import pg from "pg";
import { execSync } from "node:child_process";

const CSV = process.argv[2];
const EXPECT = process.argv[3];
if (!CSV || !/^\d{4}-\d{2}-\d{2}$/.test(EXPECT ?? "")) {
  console.error("usage: _preflight-ranking-audit.mjs <csv> <YYYY-MM-DD>");
  process.exit(1);
}
function parseCsv(text) {
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (q) { if (c === '"') { if (text[i+1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n") { row.push(f); f = ""; if (row.length > 1) rows.push(row); row = []; }
    else if (c !== "\r") f += c; }
  if (row.length > 1) rows.push(row); return rows;
}
const raw = parseCsv(fs.readFileSync(CSV, "utf8"));
const hdr = raw[0].map((h) => h.trim());
const rows = raw.slice(1).map((r) => Object.fromEntries(hdr.map((h, i) => [h, (r[i] ?? "").trim()])));
const g = (r, k) => (r[k] ?? "").trim();
console.log(`file: ${CSV.split("/").pop()}\nrows: ${rows.length}`);

const byStatus = {};
for (const r of rows) byStatus[g(r, "status") || "(blank)"] = (byStatus[g(r, "status") || "(blank)"] ?? 0) + 1;
console.log("status:", JSON.stringify(byStatus));

const dates = [...new Set(rows.map((r) => g(r, "date").slice(0, 10)))];
console.log(`date(s): ${dates.join(", ")}  expected ${EXPECT}  match=${dates.length === 1 && dates[0] === EXPECT}`);

const hours = {};
let tsBadDate = 0;
for (const r of rows) {
  const ts = g(r, "timestamp");
  const m = ts.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):/);
  if (!m) { hours["??"] = (hours["??"] ?? 0) + 1; continue; }
  if (m[1] !== EXPECT) tsBadDate++;
  hours[m[2]] = (hours[m[2]] ?? 0) + 1;
}
console.log("hours:", Object.entries(hours).sort().map(([h, n]) => `${h}:${n}`).join(" "));
console.log(`timestamps whose DATE != ${EXPECT}: ${tsBadDate}`);

const plat = {};
for (const r of rows) { const p = g(r, "platform").toLowerCase(); plat[p] = (plat[p] ?? 0) + 1; }
const pv = Object.values(plat);
console.log(`platforms: ${JSON.stringify(plat)}  skew ${(((Math.max(...pv) - Math.min(...pv)) / Math.max(...pv)) * 100).toFixed(1)}%`);

const withShot = rows.filter((r) => g(r, "screenshot")).length;
console.log(`screenshot column populated: ${withShot} / ${rows.length}  (missing ${rows.length - withShot})`);

const ranked = rows.filter((r) => g(r, "rank_position") && g(r, "rank_position") !== "0").length;
const mentioned = rows.filter((r) => /true|yes|1/i.test(g(r, "mentioned"))).length;
console.log(`rank_position populated: ${ranked}   mentioned=true: ${mentioned}`);

/* unique keyword x platform combos — audit should be one row per combo */
const combos = new Set(rows.map((r) => `${g(r, "keyword").toLowerCase()}|${g(r, "campaign_id")}|${g(r, "platform").toLowerCase()}`));
console.log(`distinct (keyword, campaign, platform): ${combos.size}  ${combos.size === rows.length ? "(1 row per combo)" : `** ${rows.length - combos.size} duplicate combo rows **`}`);

const s = JSON.parse(execSync("aws secretsmanager get-secret-value --secret-id aeo-admin/prod --profile aeo-admin --query SecretString --output text", { encoding: "utf8" }));
const c = new pg.Client({ connectionString: s.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const cids = [...new Set(rows.map((r) => parseInt(g(r, "client_id"), 10)).filter(Number.isFinite))];
const found = (await c.query(`SELECT id FROM clients WHERE id = ANY($1::int[])`, [cids])).rows.map((r) => r.id);
console.log(`client_ids ${cids.length}, resolve ${found.length}, MISSING ${cids.filter((x) => !found.includes(x)).join(",") || "none"}`);

const al = await c.query(`SELECT COUNT(*)::int n FROM audit_logs WHERE date = $1`, [EXPECT]);
const rr = await c.query(`SELECT COUNT(*)::int n FROM ranking_reports WHERE date = $1`, [EXPECT]);
console.log(`audit_logs on ${EXPECT}:      ${al.rows[0].n} ${al.rows[0].n === 0 ? "(clean)" : "** NOT CLEAN **"}`);
console.log(`ranking_reports on ${EXPECT}: ${rr.rows[0].n} ${rr.rows[0].n === 0 ? "(clean)" : "** NOT CLEAN **"}`);

/* campaign_id sanity — same synthesized-id trap as the daily importer */
const camp = [...new Set(rows.map((r) => parseInt(g(r, "campaign_id"), 10)).filter(Number.isFinite))];
const realPlans = new Set((await c.query(`SELECT id FROM client_aeo_plans WHERE id = ANY($1::int[])`, [camp])).rows.map((r) => r.id));
const synth = camp.filter((x) => !realPlans.has(x));
console.log(`campaign_ids ${camp.length}, real plans ${realPlans.size}, synthesized/unknown ${synth.length}${synth.length ? ": " + synth.slice(0, 12).join(",") : ""}`);
await c.end();
