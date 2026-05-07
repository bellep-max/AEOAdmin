/**
 * Variant rotation service — owns "regenerate variants for a keyword."
 *
 * Pulled out of routes/keyword-variants.ts so the new /api/llm/* routes
 * can share the same logic without duplicating it.
 */
import { db } from "@workspace/db";
import {
  keywordVariantsTable,
  keywordsTable,
  businessesTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { generateVariants } from "./variant-generator";

const VARIANT_TTL_DAYS = 7;

export interface KeywordContext {
  id: number;
  keywordText: string;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  businessName: string | null;
}

export async function loadKeywordContext(keywordId: number): Promise<KeywordContext | null> {
  const [row] = await db
    .select({
      id: keywordsTable.id,
      keywordText: keywordsTable.keywordText,
      city: businessesTable.city,
      state: businessesTable.state,
      zipCode: businessesTable.zipCode,
      businessName: businessesTable.name,
    })
    .from(keywordsTable)
    .leftJoin(businessesTable, eq(keywordsTable.businessId, businessesTable.id))
    .where(eq(keywordsTable.id, keywordId));
  return row ?? null;
}

export function thisMondayUTC(): string {
  const now = new Date();
  const day = now.getUTCDay();
  const diff = (day + 6) % 7; // days since Monday
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diff));
  return monday.toISOString().slice(0, 10);
}

export function variantExpiresAtFromNow(): Date {
  return new Date(Date.now() + VARIANT_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Generates fresh variants for one keyword, marks the previous batch
 * inactive, and returns the new rows. Used by both the legacy variant
 * routes and the /api/llm/* namespace.
 */
export async function regenerateForKeyword(keywordId: number, count?: number) {
  const ctx = await loadKeywordContext(keywordId);
  if (!ctx) throw new Error(`Keyword ${keywordId} not found`);

  const result = await generateVariants({
    keyword: ctx.keywordText,
    zipCode: ctx.zipCode,
    city: ctx.city,
    state: ctx.state,
    businessName: ctx.businessName,
    count,
  });

  const weekOf = thisMondayUTC();
  const expiresAt = variantExpiresAtFromNow();

  await db.update(keywordVariantsTable)
    .set({ isActive: false })
    .where(eq(keywordVariantsTable.keywordId, keywordId));

  const inserted = await db.insert(keywordVariantsTable).values(
    result.variants.map((variant) => ({
      keywordId,
      variantText: variant,
      isActive: true,
      weekOf,
      sourceModel: result.model,
      generationParams: result.generationParams,
      expiresAt,
    })),
  ).returning();

  return { variants: inserted, count: inserted.length };
}
