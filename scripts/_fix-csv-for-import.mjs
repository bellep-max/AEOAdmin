#!/usr/bin/env node
/**
 * Pre-import CSV fixer — applies the aeo-import skill's auto-rewrite rules:
 *
 *   1) Date alignment: if every row's `date` (and the YYYY-MM-DD prefix of
 *      `timestamp`) doesn't match the filename's date, rewrite each row's
 *      date + timestamp prefix to the filename's date. Preserves HH:MM:SS.
 *
 *   2) Mock backfill (daily CSVs only): for any row whose
 *      mocked_latitude/mocked_longitude is blank, generate one using the
 *      device-agent's randomize_location() algorithm — uniform-on-disc
 *      sampling within `radius` miles of the row's base_latitude/longitude.
 *
 * Usage:
 *   node scripts/_fix-csv-for-import.mjs <input.csv> [--expected-date YYYY-MM-DD] [--kind daily|audit] [--radius 5.0]
 *
 * Output:
 *   <input>.fixed.csv  — patched copy. The input is never modified.
 *
 * Reports rewrite counts + 3-row samples for spot-check. Exits 0 on success.
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const argv = process.argv.slice(2);
const inputPath = argv[0];
if (!inputPath || !fs.existsSync(inputPath)) {
  console.error("Usage: node scripts/_fix-csv-for-import.mjs <input.csv> [--expected-date YYYY-MM-DD] [--kind daily|audit] [--radius 5.0]");
  process.exit(1);
}

function getArg(flag, fallback = null) {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}

const radiusMiles = parseFloat(getArg("--radius", "5.0"));
const kindArg = (getArg("--kind", "") || "").toLowerCase();
let expectedDate = getArg("--expected-date", null);

// If no explicit date, infer from the filename. Try YYYY-MM-DD anywhere
// first, then the legacy `mmmdd` prefix (jun06, may30).
function inferDateFromFilename(p) {
  const base = path.basename(p).toLowerCase();
  const iso = base.match(/(20\d{2})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const m = base.match(/^([a-z]{3})(\d{2})/);
  if (!m) return null;
  const monMap = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
  const mm = monMap[m[1]];
  if (!mm) return null;
  return `2026-${mm}-${m[2]}`;
}
if (!expectedDate) expectedDate = inferDateFromFilename(inputPath);
if (!expectedDate) {
  console.error("Could not infer expected date from filename; pass --expected-date YYYY-MM-DD");
  process.exit(1);
}

let kind = kindArg;
if (!kind) {
  const lower = path.basename(inputPath).toLowerCase();
  kind = lower.includes("daily") || lower.includes("session") ? "daily" : "audit";
}
console.log(`Input:         ${inputPath}`);
console.log(`Expected date: ${expectedDate}`);
console.log(`Kind:          ${kind}`);

/* ────────────────────────────────────────── CSV parser/serializer ───── */
function parseCSV(text) {
  const rows = []; let row = []; let cur = ""; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { q = false; }
      else cur += ch;
    } else {
      if (ch === '"') q = true;
      else if (ch === ",") { row.push(cur); cur = ""; }
      else if (ch === "\r") {}
      else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
      else cur += ch;
    }
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
function csvField(v) {
  if (v == null) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
function serializeCSV(header, rows) {
  const lines = [header.map(csvField).join(",")];
  for (const r of rows) lines.push(header.map((h) => csvField(r[h] ?? "")).join("\n").replace(/\n/g, ","));
  // The map(csvField).join(",") in one line works fine — the above bug-prone hack avoided in favor of explicit form:
  lines.length = 1;
  lines[0] = header.map(csvField).join(",");
  for (const r of rows) lines.push(header.map((h) => csvField(r[h] ?? "")).join(","));
  return lines.join("\n") + "\n";
}

/* ─────────────────────────────────────── device-agent randomize_location ─────
   Port of /Users/seolocalph/projects/device-agent/run_with_proxy.py:99
   Uniform sampling inside a disc of `radius` miles around (lat, lng). */
function randomizeLocation(lat, lng, radiusMi) {
  const rdLat = radiusMi / 69.0;
  const rdLng = radiusMi / (69.0 * Math.cos((lat * Math.PI) / 180));
  const angle = Math.random() * 2 * Math.PI;
  const dist = Math.sqrt(Math.random());
  return [
    Math.round((lat + dist * rdLat * Math.sin(angle)) * 1e6) / 1e6,
    Math.round((lng + dist * rdLng * Math.cos(angle)) * 1e6) / 1e6,
  ];
}

/* ──────────────────────────────────────────────────── Main rewrite ────── */
const raw = fs.readFileSync(inputPath, "utf8");
const all = parseCSV(raw).filter((r) => r.length > 1 || (r.length === 1 && r[0].length > 0));
const header = all[0];
const data = all.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
console.log(`Rows:          ${data.length}`);

/* Fallback chain for the daily-fix mock backfill:
     1) row's own base_latitude/base_longitude (if usable)
     2) another row in the SAME CSV with the same client_id that has usable base
     3) (last resort) businesses.{latitude,longitude} / clients.{latitude,longitude} from prod */
const clientCoords = new Map(); // id -> { lat, lng }
if (kind === "daily") {
  // pass 1 — harvest from the CSV itself
  for (const row of data) {
    const lat = parseFloat(row.base_latitude);
    const lng = parseFloat(row.base_longitude);
    const usable = Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
    if (usable) {
      const id = Number(row.client_id);
      if (!clientCoords.has(id)) clientCoords.set(id, { lat, lng });
    }
  }
  console.log(`Harvested in-CSV base coords for ${clientCoords.size} client_ids.`);

  // pass 2 — DB fallback for client_ids the CSV couldn't supply
  if (process.env.PROD_DATABASE_URL) {
    const c = new pg.Client({
      connectionString: process.env.PROD_DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 60000,
    });
    await c.connect();
    const needIds = [...new Set(
      data
        .filter((r) => !clientCoords.has(Number(r.client_id)))
        .map((r) => Number(r.client_id))
        .filter((n) => Number.isFinite(n)),
    )];
    if (needIds.length > 0) {
      // Try businesses first (more specific lat/lng per business location);
      // fall back to clients.{latitude,longitude} as a last resort.
      const bizR = await c.query(
        `SELECT client_id, latitude, longitude FROM businesses
          WHERE client_id = ANY($1::int[])
            AND latitude IS NOT NULL AND longitude IS NOT NULL`,
        [needIds],
      );
      for (const row of bizR.rows) {
        if (!clientCoords.has(row.client_id)) {
          clientCoords.set(row.client_id, { lat: Number(row.latitude), lng: Number(row.longitude) });
        }
      }
      const stillNeed = needIds.filter((id) => !clientCoords.has(id));
      if (stillNeed.length > 0) {
        const clR = await c.query(
          `SELECT id, latitude, longitude FROM clients
            WHERE id = ANY($1::int[])
              AND latitude IS NOT NULL AND longitude IS NOT NULL`,
          [stillNeed],
        );
        for (const row of clR.rows) {
          clientCoords.set(row.id, { lat: Number(row.latitude), lng: Number(row.longitude) });
        }
      }
      console.log(`DB fallback filled ${needIds.length - stillNeed.length}/${needIds.length} extra client_ids.`);
    }
    await c.end();
  }
}

let datesRewritten = 0;
let mocksBackfilled = 0;
let mockSkipped = 0;
const mockSamples = [];

for (const row of data) {
  /* 1) Date + timestamp prefix rewrite. */
  const rowDate = (row.date || "").slice(0, 10);
  if (rowDate && rowDate !== expectedDate) {
    row.date = expectedDate;
    if (row.timestamp) {
      // Preserve HH:MM:SS + any trailing Z / +offset / fractional bits.
      const m = row.timestamp.match(/^\d{4}-\d{2}-\d{2}(.*)$/);
      if (m) row.timestamp = `${expectedDate}${m[1]}`;
    }
    datesRewritten++;
  } else if (!rowDate && row.timestamp) {
    // Some audit CSVs leave `date` blank and rely on timestamp.
    const m = row.timestamp.match(/^(\d{4}-\d{2}-\d{2})(.*)$/);
    if (m && m[1] !== expectedDate) {
      row.timestamp = `${expectedDate}${m[2]}`;
      datesRewritten++;
    }
  }

  /* 2) Mock backfill — daily only. */
  if (kind === "daily") {
    const ml = row.mocked_latitude;
    const mn = row.mocked_longitude;
    const haveBoth = ml && mn && ml !== "0" && mn !== "0";
    if (!haveBoth) {
      // Prefer the row's own base; fall back to the client's coords from DB
      // when the row has base = blank or (0,0) which is Null Island.
      let baseLat = parseFloat(row.base_latitude);
      let baseLng = parseFloat(row.base_longitude);
      const baseUnusable =
        !Number.isFinite(baseLat) || !Number.isFinite(baseLng) ||
        (baseLat === 0 && baseLng === 0);
      if (baseUnusable) {
        const fallback = clientCoords.get(Number(row.client_id));
        if (fallback) {
          baseLat = fallback.lat;
          baseLng = fallback.lng;
        }
      }
      const usable =
        Number.isFinite(baseLat) && Number.isFinite(baseLng) &&
        !(baseLat === 0 && baseLng === 0);
      if (usable) {
        const [latM, lngM] = randomizeLocation(baseLat, baseLng, radiusMiles);
        row.mocked_latitude = String(latM);
        row.mocked_longitude = String(lngM);
        if (!row.mocked_timezone) row.mocked_timezone = "America/Los_Angeles"; // matches the existing rows
        mocksBackfilled++;
        if (mockSamples.length < 3) {
          mockSamples.push({
            client_id: row.client_id, keyword: (row.keyword || "").slice(0, 40),
            base: `${baseLat},${baseLng}`, mocked: `${latM},${lngM}`,
          });
        }
      } else {
        mockSkipped++;
      }
    }
  }
}

const outPath = inputPath.replace(/\.csv$/i, ".fixed.csv");
fs.writeFileSync(outPath, serializeCSV(header, data));

console.log("");
console.log("=== Fix summary ===");
console.log(`Dates rewritten to ${expectedDate}: ${datesRewritten}`);
if (kind === "daily") {
  console.log(`Mocks backfilled (randomize_location, radius=${radiusMiles}mi): ${mocksBackfilled}`);
  if (mockSkipped > 0) console.log(`⚠ Mocks SKIPPED (blank base_lat/lng): ${mockSkipped}`);
  if (mockSamples.length) {
    console.log("Sample backfilled mocks:");
    mockSamples.forEach((s) => console.log(`  client ${s.client_id} | kw="${s.keyword}" | base=${s.base} | mocked=${s.mocked}`));
  }
}
console.log(`\nWrote: ${outPath}`);
