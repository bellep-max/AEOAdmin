#!/usr/bin/env node
/**
 * One-shot backfill for clients.latitude/longitude.
 *
 * Finds clients with NULL lat/lng, geocodes their address text via OpenStreetMap
 * Nominatim (free, no API key), and writes the result back. The aeo-import skill's
 * fix step uses these coords as the last-resort fallback when a daily CSV row
 * doesn't have its own base_lat/lng.
 *
 * Nominatim usage policy: 1 req/sec, descriptive User-Agent required.
 *
 *   PROD_DATABASE_URL=... node scripts/_backfill-client-coords.mjs
 *     [--ids 5,12,77]      only these client ids
 *     [--apply]            actually write to DB (default: dry-run)
 *     [--dry-run]          force dry-run even when --apply is on
 */
import pg from "pg";

const dbUrl = process.env.PROD_DATABASE_URL ?? process.env.DATABASE_URL;
if (!dbUrl) { console.error("PROD_DATABASE_URL or DATABASE_URL required"); process.exit(1); }

const argv = process.argv.slice(2);
const apply = argv.includes("--apply") && !argv.includes("--dry-run");
const idsArg = argv.includes("--ids") ? argv[argv.indexOf("--ids") + 1] : null;
const onlyIds = idsArg ? idsArg.split(",").map((s) => Number(s.trim())).filter(Number.isFinite) : null;

const SLEEP_MS = 1100; // be a good Nominatim citizen
const UA = "aeo-admin-coord-backfill/1.0 (ops tooling)"; // ASCII only — headers must encode as ByteString

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

const db = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 60000 });
await db.connect();

/* `clients.business_name` is the owner's name (legacy quirk); the real biz
   name lives in `businesses.name`. Pull both, prefer the business address. */
const sql = `
  SELECT c.id,
         c.business_name           AS owner_name,
         c.search_address          AS client_addr,
         c.published_address       AS client_pub_addr,
         c.city                    AS client_city,
         c.state                   AS client_state,
         b.name                    AS biz_name,
         b.published_address       AS biz_addr,
         b.city                    AS biz_city,
         b.state                   AS biz_state,
         b.latitude                AS biz_lat,
         b.longitude               AS biz_lng
    FROM clients c
    LEFT JOIN LATERAL (
      SELECT name, published_address, city, state, zip_code, latitude, longitude
        FROM businesses
       WHERE client_id = c.id
       ORDER BY id
       LIMIT 1
    ) b ON true
   WHERE (c.latitude IS NULL OR c.longitude IS NULL OR (c.latitude = 0 AND c.longitude = 0))
     ${onlyIds ? "AND c.id = ANY($1::int[])" : ""}
   ORDER BY c.id
`;
const r = onlyIds ? await db.query(sql, [onlyIds]) : await db.query(sql);
console.log(`Clients needing coords: ${r.rows.length}${apply ? "" : "  (DRY-RUN — pass --apply to write)"}`);

let geocoded = 0, skipped = 0, fromBiz = 0;
for (const c of r.rows) {
  // Free win first — the businesses row already has lat/lng on file.
  if (Number.isFinite(Number(c.biz_lat)) && Number.isFinite(Number(c.biz_lng)) &&
      !(Number(c.biz_lat) === 0 && Number(c.biz_lng) === 0)) {
    const lat = Number(c.biz_lat), lng = Number(c.biz_lng);
    console.log(`  ✓ #${c.id} ${c.biz_name || c.owner_name} → ${lat.toFixed(4)}, ${lng.toFixed(4)}  (from businesses table)`);
    if (apply) await db.query(`UPDATE clients SET latitude = $1, longitude = $2 WHERE id = $3`, [lat, lng, c.id]);
    fromBiz++; geocoded++;
    continue;
  }

  // Build a CASCADE of progressively simpler geocode queries. Nominatim tends
  // to fail on overly-specific strings (suite numbers, zip-then-comma, etc.),
  // so we retry with shorter forms until one matches.
  const street = (c.biz_addr || c.client_addr || c.client_pub_addr || "").split(",")[0].trim();
  const city = (c.biz_city || c.client_city || "").trim();
  const state = (c.biz_state || c.client_state || "").trim();
  const zip = (c.zip_code || "").trim();

  const cascade = [
    [street, city, state].filter(Boolean).join(", "),
    [city, state, zip].filter(Boolean).join(" "),
    [city, state].filter(Boolean).join(", "),
    city,
  ].map((s) => s.trim()).filter((s, i, a) => s.length >= 3 && a.indexOf(s) === i);

  if (cascade.length === 0) {
    skipped++;
    console.log(`  ⚠ #${c.id} ${c.biz_name || c.owner_name} — no usable address text, skipping`);
    continue;
  }

  let resolvedLat = null, resolvedLng = null, matchedOn = null;
  for (const query of cascade) {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&q=${encodeURIComponent(query)}`;
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
      if (!res.ok) { await sleep(SLEEP_MS); continue; }
      const j = await res.json();
      if (Array.isArray(j) && j.length > 0) {
        const lat = Number(j[0].lat);
        const lng = Number(j[0].lon);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          resolvedLat = lat;
          resolvedLng = lng;
          matchedOn = query;
          break;
        }
      }
    } catch (_) { /* try the next form */ }
    await sleep(SLEEP_MS); // rate limit between Nominatim hits
  }

  if (resolvedLat == null) {
    skipped++;
    console.log(`  ⚠ #${c.id} ${c.biz_name || c.owner_name} — no Nominatim match (tried ${cascade.length} forms)`);
    continue;
  }
  console.log(`  ✓ #${c.id} ${c.biz_name || c.owner_name} → ${resolvedLat.toFixed(4)}, ${resolvedLng.toFixed(4)}  (matched: "${matchedOn.slice(0, 60)}")`);
  if (apply) {
    await db.query(`UPDATE clients SET latitude = $1, longitude = $2 WHERE id = $3`, [resolvedLat, resolvedLng, c.id]);
  }
  geocoded++;
  await sleep(SLEEP_MS);
}

console.log(`\nDone: ${geocoded} resolved${apply ? " + written" : " (dry-run)"}  (of which ${fromBiz} were already in businesses table, ${geocoded - fromBiz} via Nominatim)  |  ${skipped} skipped`);
await db.end();
