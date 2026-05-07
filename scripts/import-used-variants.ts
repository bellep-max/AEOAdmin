/**
 * Backfill keyword_variants from sessions.keyword_variant.
 *
 * Scans recent sessions for unique (keyword_id, keyword_variant) pairs
 * where the variant text isn't already present in keyword_variants.
 * Inserts any new ones as active variants (source_model="session-import"),
 * so they enter the rotation pool the next time the executor calls
 * /api/llm/variants/:kid/random.
 *
 * Idempotent: dedup is case-insensitive against existing variant_text.
 * Sessions with empty/null keyword_variant are skipped, as are pairs
 * where the variant text equals the keyword text verbatim (no rotation
 * value).
 *
 * Usage:
 *   pnpm tsx scripts/import-used-variants.ts                    # last 7 days
 *   pnpm tsx scripts/import-used-variants.ts --days 30
 *   pnpm tsx scripts/import-used-variants.ts --since 2026-05-05
 *   pnpm tsx scripts/import-used-variants.ts --dry-run
 *
 * Requires DATABASE_URL.
 */
import { db } from "@workspace/db";
import { sessionsTable, keywordVariantsTable, keywordsTable } from "@workspace/db/schema";
import { and, eq, gte, isNotNull, sql } from "drizzle-orm";

interface Args {
  days: number;
  since: string | null;
  dryRun: boolean;
}

function parseArgs(): Args {
  const out: Args = { days: 7, since: null, dryRun: false };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--days") out.days = Number(argv[++i]);
    else if (a === "--since") out.since = argv[++i];
    else if (a === "--dry-run" || a === "--dry") out.dryRun = true;
    else throw new Error(`Unknown arg: ${a}`);
  }
  if (out.since && !/^\d{4}-\d{2}-\d{2}$/.test(out.since)) {
    throw new Error(`--since must be YYYY-MM-DD`);
  }
  if (Number.isNaN(out.days) || out.days < 1 || out.days > 365) {
    throw new Error(`--days must be 1-365`);
  }
  return out;
}

function sinceCutoff(args: Args): Date {
  if (args.since) return new Date(`${args.since}T00:00:00Z`);
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - args.days);
  return d;
}

async function run() {
  const args = parseArgs();
  const cutoff = sinceCutoff(args);
  const cutoffIso = cutoff.toISOString();

  console.log(`Scanning sessions since ${cutoffIso}…`);

  // 1. Pull (keyword_id, normalized variant) pairs from sessions.
  //    Group to dedupe and count usage per pair.
  const pairs = await db
    .select({
      keywordId: sessionsTable.keywordId,
      variantText: sql<string>`MIN(${sessionsTable.keywordVariant})`.as("variant_text"),
      uses: sql<number>`COUNT(*)::int`.as("uses"),
      lastUsed: sql<Date>`MAX(${sessionsTable.timestamp})`.as("last_used"),
    })
    .from(sessionsTable)
    .where(and(
      isNotNull(sessionsTable.keywordId),
      isNotNull(sessionsTable.keywordVariant),
      sql`length(trim(${sessionsTable.keywordVariant})) > 0`,
      gte(sessionsTable.timestamp, cutoff),
    ))
    .groupBy(
      sessionsTable.keywordId,
      sql`lower(trim(${sessionsTable.keywordVariant}))`,
    );

  console.log(`Found ${pairs.length} distinct (keyword × variant) pairs in window.`);

  // 2. Look up keyword text for filtering "variant == keyword" no-ops.
  const keywordIds = [...new Set(pairs.map((p) => p.keywordId).filter((id): id is number => id != null))];
  const keywordRows = keywordIds.length === 0 ? [] : await db
    .select({ id: keywordsTable.id, keywordText: keywordsTable.keywordText })
    .from(keywordsTable);
  const keywordTextById = new Map(keywordRows.map((k) => [k.id, k.keywordText]));

  // 3. Look up existing variants per keyword (case-insensitive set).
  const existingByKw = new Map<number, Set<string>>();
  if (keywordIds.length > 0) {
    const existing = await db.select({
      keywordId: keywordVariantsTable.keywordId,
      variantText: keywordVariantsTable.variantText,
    }).from(keywordVariantsTable);
    for (const e of existing) {
      const set = existingByKw.get(e.keywordId) ?? new Set<string>();
      set.add(e.variantText.trim().toLowerCase());
      existingByKw.set(e.keywordId, set);
    }
  }

  // 4. Build insert list — only NEW variants.
  interface ToInsert {
    keywordId: number;
    variantText: string;
    uses: number;
    lastUsedAt: Date;
  }
  const toInsert: ToInsert[] = [];
  let skipDuplicate = 0;
  let skipEqualsKeyword = 0;
  let skipEmpty = 0;

  for (const p of pairs) {
    if (p.keywordId == null) { skipEmpty++; continue; }
    const text = (p.variantText ?? "").trim();
    if (!text) { skipEmpty++; continue; }

    const kwText = keywordTextById.get(p.keywordId);
    if (kwText && text.toLowerCase() === kwText.trim().toLowerCase()) {
      skipEqualsKeyword++;
      continue;
    }

    const haveSet = existingByKw.get(p.keywordId) ?? new Set<string>();
    if (haveSet.has(text.toLowerCase())) { skipDuplicate++; continue; }

    toInsert.push({
      keywordId: p.keywordId,
      variantText: text,
      uses: Number(p.uses) || 1,
      lastUsedAt: p.lastUsed ? new Date(p.lastUsed) : new Date(),
    });
  }

  console.log(`To insert: ${toInsert.length}`);
  console.log(`Skipped — already exists: ${skipDuplicate}, equals keyword: ${skipEqualsKeyword}, empty: ${skipEmpty}`);

  if (args.dryRun) {
    const preview = toInsert.slice(0, 20);
    for (const r of preview) {
      const kw = keywordTextById.get(r.keywordId) ?? "?";
      console.log(`  [kid ${r.keywordId}] (${kw}) → "${r.variantText}"  (uses=${r.uses})`);
    }
    if (toInsert.length > preview.length) console.log(`  …and ${toInsert.length - preview.length} more`);
    console.log("Dry run — no inserts.");
    return;
  }

  // 5. Insert in batches.
  const BATCH = 100;
  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const batch = toInsert.slice(i, i + BATCH).map((r) => ({
      keywordId:   r.keywordId,
      variantText: r.variantText,
      isActive:    true,
      sourceModel: "session-import",
      timesUsed:   r.uses,
      lastUsedAt:  r.lastUsedAt,
    }));
    await db.insert(keywordVariantsTable).values(batch);
    inserted += batch.length;
  }
  console.log(`Inserted ${inserted} variants.`);
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : err);
    process.exit(1);
  });
