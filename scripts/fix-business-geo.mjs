/* Backfill businesses.city/state from published_address, else the plan's
 * search_address.
 *
 * Why: an audit REQUIRES bizName, bizUrl, city, state, keyword. A business with
 * NULL city/state fails its next audit outright, and the vision validator's
 * location check rejects genuine top-3 rows when the geo is missing or wrong.
 * Natural Scalp had city='York' for "140 West 58th street New York" — one wrong
 * word rejected 30 real wins; fixing it flipped 12 with no code change. So this
 * refuses to guess: anything it cannot parse unambiguously is reported, not written.
 *
 * usage:
 *   DATABASE_URL=... node scripts/fix-business-geo.mjs [--ids=1,2] [--apply]
 * Dry-run by default.
 */
import pg from "pg";

const APPLY = process.argv.includes("--apply");
const idsArg = process.argv.find((a) => a.startsWith("--ids="));
const ONLY = idsArg ? idsArg.slice(6).split(",").map((s) => parseInt(s, 10)) : null;

const STATES = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
  missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
  oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI",
  wyoming: "WY", "district of columbia": "DC",
};
const ABBRS = new Set(Object.values(STATES));

const titleCase = (s) => s.trim().replace(/\s+/g, " ")
  .split(" ").map((w) => w.length <= 2 && w === w.toUpperCase() ? w
    : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");

function normState(raw) {
  const s = raw.trim();
  if (ABBRS.has(s.toUpperCase()) && s.length === 2) return s.toUpperCase();
  return STATES[s.toLowerCase()] ?? null;
}

/* Returns {city, state} or null. Deliberately narrow — a wrong parse is worse
   than no parse, because it silently rejects every genuine win for that business. */
function parseAddr(raw) {
  if (!raw) return null;
  // "Salt Lake City, UT (inferred from area code)" — the parenthetical is a
  // provenance note, not part of the address.
  let s = String(raw).replace(/\(.*?\)/g, " ").replace(/\s+/g, " ").trim();
  // Drop a trailing country suffix, e.g. New Braunfels, TX 78130, United States
  s = s.replace(/,\s*(usa|u\.s\.a\.?|united states)\s*\.?$/i, "");
  s = s.replace(/[,\s]+$/, "");
  const parts = s.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;

  // last part should carry the state (optionally followed by a zip)
  const tail = parts[parts.length - 1];
  const m = tail.match(/^([A-Za-z][A-Za-z .]*?)\.?(?:\s+(\d{5})(?:-\d{4})?)?$/);
  if (!m) return null;
  const state = normState(m[1]);
  if (!state) return null;

  const cityRaw = parts[parts.length - 2];
  // A city glued to a street ("124 N Van Buren StSan Angelo") or carrying digits
  // is not safely separable — refuse rather than store a mangled city.
  if (/\d/.test(cityRaw)) return null;
  if (/\b(st|street|ave|avenue|rd|road|blvd|dr|drive|ln|lane|way|pkwy|parkway|ste|suite|#)\b/i.test(cityRaw))
    return null;
  const city = titleCase(cityRaw);
  if (!city || city.length < 2) return null;
  return { city, state };
}

const db = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await db.connect();

const { rows } = await db.query(`
  SELECT b.id, b.name, b.city, b.state, b.published_address,
         ARRAY(SELECT DISTINCT TRIM(p.search_address) FROM client_aeo_plans p
                JOIN keywords k2 ON k2.aeo_plan_id = p.id
               WHERE k2.business_id = b.id
                 AND NULLIF(TRIM(p.search_address),'') IS NOT NULL) AS plan_addrs
    FROM businesses b
   WHERE (NULLIF(TRIM(b.city),'') IS NULL OR NULLIF(TRIM(b.state),'') IS NULL)
     AND b.status = 'active'
   ORDER BY b.id`);

const targets = ONLY ? rows.filter((r) => ONLY.includes(r.id)) : rows;
const fix = [], skip = [];

for (const b of targets) {
  const fromPublished = parseAddr(b.published_address);
  const planParsed = (b.plan_addrs || []).map(parseAddr).filter(Boolean);
  const planCities = [...new Set(planParsed.map((p) => `${p.city}|${p.state}`))];

  /* A business whose campaigns target different cities has no single
     business-level geo. Its published_address is just the HQ (Seo Local: Lehi,
     UT while its 25 campaigns run in Portland, Miami, Boston...), and city/state
     feed the validator's location match — so stamping the HQ would reject every
     genuine win in every other city. That is the Natural Scalp failure exactly.
     Skip regardless of whether published_address happens to parse. */
  if (planCities.length > 1) {
    skip.push({ b, why: `plans span ${planCities.length} cities: ${planCities.slice(0, 4).join(" / ")}${planCities.length > 4 ? " ..." : ""}` });
    continue;
  }
  const got = fromPublished ?? planParsed[0] ?? null;
  if (!got) {
    skip.push({ b, why: "no parseable city/state" });
    continue;
  }
  // published_address wins, but flag when the plan points somewhere else — that
  // is the case where a wrong pick silently rejects everything.
  const conflict = fromPublished && planCities.length &&
    !planCities.includes(`${fromPublished.city}|${fromPublished.state}`)
      ? ` (plan says ${planCities.join("/")})` : "";
  fix.push({ b, got, src: fromPublished ? "published" : "plan", conflict });
}

console.log(`candidates: ${targets.length}   parseable: ${fix.length}   skipped: ${skip.length}\n`);
console.log("=== WILL SET ===");
for (const f of fix) {
  console.log(`  ${String(f.b.id).padStart(4)}  ${(f.b.name || "").slice(0, 30).padEnd(32)} -> ${f.got.city}, ${f.got.state}   [${f.src}]${f.conflict}`);
}
console.log("\n=== SKIPPED (needs a human) ===");
for (const s of skip) {
  console.log(`  ${String(s.b.id).padStart(4)}  ${(s.b.name || "").slice(0, 30).padEnd(32)} ${s.why}`);
  console.log(`        published: ${s.b.published_address || "—"}`);
  console.log(`        plans:     ${(s.b.plan_addrs || []).join(" | ") || "—"}`);
}

if (!APPLY) {
  console.log("\nDRY RUN — pass --apply to write.");
  await db.end();
  process.exit(0);
}

let n = 0;
try {
  await db.query("BEGIN");
  for (const f of fix) {
    const r = await db.query(
      `UPDATE businesses SET city = $1, state = $2
        WHERE id = $3 AND (NULLIF(TRIM(city),'') IS NULL OR NULLIF(TRIM(state),'') IS NULL)`,
      [f.got.city, f.got.state, f.b.id]);
    n += r.rowCount;
  }
  if (n !== fix.length) {
    await db.query("ROLLBACK");
    console.error(`ABORT: updated ${n}, expected ${fix.length}`);
    process.exit(1);
  }
  await db.query("COMMIT");
  console.log(`\ncommitted: ${n} businesses updated`);
} catch (e) {
  await db.query("ROLLBACK");
  console.error("ROLLBACK", e.message);
  process.exit(1);
}
await db.end();
