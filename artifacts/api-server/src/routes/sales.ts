/*
 * Sales / GHL-facing endpoints — "show the rankings & improvement".
 *
 *   GET /api/sales/improvement   → JSON: matched business + EVERY keyword, each
 *                                  with its first/current rank per AI platform
 *                                  and presigned screenshots. Sorted strongest
 *                                  improvement first.
 *   GET /api/sales/screenshot    → one image, streamed (permanent, embeddable
 *                                  link that never expires).
 *
 * A non-technical sales user (via a GHL workflow) passes whatever the contact
 * has — email / business / website / GBP / first+last name. We resolve the
 * client most-reliable-first (email wins ~80%) and return their keywords with
 * per-platform first→current (best-rank) ranks. Optional &keyword= (loose
 * match) and &platform= narrow the result. Only screenshots with a legible rank
 * label (screenshot_rank_visible != false) are surfaced.
 *
 * Auth: READ_API_TOKEN via Authorization: Bearer / X-API-Key, or — for the
 * image endpoint that <img> tags hit — a ?token= query param.
 */
import { Router } from "express";
import type { Readable } from "node:stream";
import { db } from "@workspace/db";
import {
  clientsTable,
  businessesTable,
  keywordsTable,
  rankingReportsTable,
} from "@workspace/db/schema";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { requireApiToken } from "../middlewares/api-token";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const router = Router();
const s3 = new S3Client({ region: process.env.AWS_REGION ?? "us-east-1" });
const PLATFORM_ORDER = ["chatgpt", "gemini", "perplexity"] as const;
const PLATFORMS = new Set<string>(PLATFORM_ORDER);

const lc = (v: unknown) =>
  typeof v === "string" ? v.toLowerCase().trim() : "";
const domain = (u: string) =>
  u
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0];
const cidOf = (u: string | null) => {
  const m = /[?&]cid=(\d+)/.exec(u ?? "");
  return m ? m[1] : null;
};
const normName = (s: string) =>
  s
    .toLowerCase()
    .replace(/\b(llc|inc|ltd|co|corp|the)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const KW_NOISE: RegExp[] = [
  /^best\s+/,
  /^top\s+/,
  /^the\s+/,
  /\s+near me( service)?$/,
  /\s+in (my )?area$/,
  /\s+service(s)?$/,
  /\s+reviews$/,
  /\s+recommendations$/,
  /\s+company$/,
];
function normKw(s: string): string {
  let x = s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const re of KW_NOISE) {
      const next = x.replace(re, "").trim();
      if (next !== x) {
        x = next;
        changed = true;
      }
    }
  }
  return x;
}

interface ClientRow {
  id: number;
  businessName: string;
  accountEmail: string | null;
  contactEmail: string | null;
  websiteUrl: string | null;
  gmbUrl: string | null;
  accountUserName: string | null;
}

interface BusinessRow {
  clientId: number;
  name: string;
}

function resolveClient(
  q: Record<string, string>,
  clients: ClientRow[],
  businesses: BusinessRow[],
): { client: ClientRow; matchedBy: string } | null {
  const email = lc(q.email);
  if (email) {
    const hit = clients.find(
      (c) => lc(c.accountEmail) === email || lc(c.contactEmail) === email,
    );
    if (hit) return { client: hit, matchedBy: "email" };
  }
  const cid = lc(q.cid) || cidOf(q.gbp ?? q.gbpUrl ?? "");
  if (cid) {
    const hit = clients.find((c) => cidOf(c.gmbUrl) === cid);
    if (hit) return { client: hit, matchedBy: "gbp_cid" };
  }
  const website = lc(q.website);
  if (website) {
    const d = domain(website);
    const hit = clients.find((c) => c.websiteUrl && domain(c.websiteUrl) === d);
    if (hit) return { client: hit, matchedBy: "website" };
  }
  const business = q.business ?? q.businessName ?? "";
  if (business.trim()) {
    const n = normName(business);
    const fuzzy = (cand: string) =>
      cand.length > 8 && n.length > 8 && (cand.includes(n) || n.includes(cand));
    // clients.business_name is often the owner's name, not the brand — so also
    // match the businesses table (where the real brand lives) by clientId.
    let hit = clients.find((c) => normName(c.businessName) === n);
    if (!hit) {
      const b =
        businesses.find((x) => normName(x.name) === n) ??
        businesses.find((x) => fuzzy(normName(x.name)));
      if (b) hit = clients.find((c) => c.id === b.clientId);
    }
    if (!hit) hit = clients.find((c) => fuzzy(normName(c.businessName)));
    if (hit) return { client: hit, matchedBy: "business_name" };
  }
  const full = `${q.firstName ?? ""} ${q.lastName ?? ""}`.trim();
  if (full) {
    const n = lc(full);
    const hit = clients.find(
      (c) => lc(c.accountUserName).includes(n) && n.length > 3,
    );
    if (hit) return { client: hit, matchedBy: "owner_name" };
  }
  return null;
}

interface RankRow {
  keywordId: number;
  platform: string;
  date: string | null;
  rankingPosition: number;
  screenshotUrl: string;
}

async function presign(s3Uri: string): Promise<string | null> {
  const m = /^s3:\/\/([^/]+)\/(.+)$/.exec(s3Uri);
  if (!m) return null;
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: m[1], Key: m[2] }), {
    expiresIn: 3600,
  });
}

interface RankPoint {
  rank: number;
  date: string | null;
  s3Uri: string;
}
interface PlatformRanks {
  first: RankPoint;
  current: RankPoint;
}
interface KeywordEntry {
  keywordId: number;
  keyword: string | null;
  business: string;
  platforms: Record<string, PlatformRanks>;
  maxImproved: number;
}
interface ImprovementData {
  matchedBy: string;
  business: string;
  client: { id: number; name: string };
  keywords: KeywordEntry[];
}

/** first = earliest dated row; current = best (lowest) rank. */
function firstAndCurrent(rows: RankRow[]): PlatformRanks | null {
  const dated = rows.filter((r) => r.date);
  if (dated.length === 0) return null;
  const first = dated.reduce((a, b) => (a.date! <= b.date! ? a : b));
  const current = rows.reduce((a, b) =>
    a.rankingPosition <= b.rankingPosition ? a : b,
  );
  return {
    first: {
      rank: first.rankingPosition,
      date: first.date,
      s3Uri: first.screenshotUrl,
    },
    current: {
      rank: current.rankingPosition,
      date: current.date,
      s3Uri: current.screenshotUrl,
    },
  };
}

async function resolveImprovement(
  q: Record<string, string>,
): Promise<
  | { ok: true; data: ImprovementData }
  | { ok: false; status: number; reason: string }
> {
  const platformFilter = PLATFORMS.has(lc(q.platform)) ? lc(q.platform) : null;

  const clients = (await db
    .select({
      id: clientsTable.id,
      businessName: clientsTable.businessName,
      accountEmail: clientsTable.accountEmail,
      contactEmail: clientsTable.contactEmail,
      websiteUrl: clientsTable.websiteUrl,
      gmbUrl: clientsTable.gmbUrl,
      accountUserName: clientsTable.accountUserName,
    })
    .from(clientsTable)) as ClientRow[];

  const businesses = (await db
    .select({
      clientId: businessesTable.clientId,
      name: businessesTable.name,
    })
    .from(businessesTable)) as BusinessRow[];

  const match = resolveClient(q, clients, businesses);
  if (!match)
    return {
      ok: false,
      status: 404,
      reason:
        "No matching client. Pass email (most reliable), or business / website / gbp / firstName+lastName.",
    };
  const { client, matchedBy } = match;

  const kws = await db
    .select({
      id: keywordsTable.id,
      text: keywordsTable.keywordText,
      businessName: businessesTable.name,
    })
    .from(keywordsTable)
    .leftJoin(businessesTable, eq(keywordsTable.businessId, businessesTable.id))
    .where(
      and(
        eq(keywordsTable.clientId, client.id),
        // active set only — exclude inactive, archived and locked/rotated-out
        eq(keywordsTable.isActive, true),
        sql`${keywordsTable.archivedAt} IS NULL`,
        sql`COALESCE(${keywordsTable.status}, '') NOT IN ('locked', 'archived')`,
      ),
    );
  if (kws.length === 0)
    return {
      ok: false,
      status: 404,
      reason: "Client has no active tracked keywords yet.",
    };

  let candidates = kws;
  const wanted = q.keyword ? normKw(q.keyword) : "";
  if (wanted) {
    const exact = kws.filter((k) => normKw(k.text) === wanted);
    const partial = kws.filter((k) => {
      const n = normKw(k.text);
      return n.length > 3 && (n.includes(wanted) || wanted.includes(n));
    });
    candidates = exact.length ? exact : partial.length ? partial : kws;
  }
  const candidateIds = candidates.map((k) => k.id);
  const kwMeta = new Map(
    kws.map((k) => [
      k.id,
      { text: k.text, business: k.businessName ?? client.businessName },
    ]),
  );

  const rrRows = (await db
    .select({
      keywordId: rankingReportsTable.keywordId,
      platform: rankingReportsTable.platform,
      date: rankingReportsTable.date,
      rankingPosition: rankingReportsTable.rankingPosition,
      screenshotUrl: rankingReportsTable.screenshotUrl,
    })
    .from(rankingReportsTable)
    .where(
      and(
        inArray(rankingReportsTable.keywordId, candidateIds),
        isNotNull(rankingReportsTable.rankingPosition),
        sql`${rankingReportsTable.screenshotUrl} LIKE 's3://%'`,
        sql`COALESCE(${rankingReportsTable.screenshotRankVisible}, true) = true`,
      ),
    )) as RankRow[];

  // group rows by keyword, then platform
  const byKeyword = new Map<number, RankRow[]>();
  for (const r of rrRows) {
    if (!byKeyword.has(r.keywordId)) byKeyword.set(r.keywordId, []);
    byKeyword.get(r.keywordId)!.push(r);
  }

  const wantPlatforms = platformFilter ? [platformFilter] : [...PLATFORM_ORDER];
  const keywords: KeywordEntry[] = [];
  for (const [keywordId, rows] of byKeyword) {
    const platforms: Record<string, PlatformRanks> = {};
    let maxImproved = -Infinity;
    for (const p of wantPlatforms) {
      const fc = firstAndCurrent(rows.filter((r) => r.platform === p));
      if (!fc) continue;
      platforms[p] = fc;
      maxImproved = Math.max(maxImproved, fc.first.rank - fc.current.rank);
    }
    if (Object.keys(platforms).length === 0) continue;
    const improved = maxImproved === -Infinity ? 0 : maxImproved;
    // only surface keywords that actually improved on at least one platform
    if (improved <= 0) continue;
    const meta = kwMeta.get(keywordId);
    keywords.push({
      keywordId,
      keyword: meta?.text ?? null,
      business: meta?.business ?? client.businessName,
      platforms,
      maxImproved: improved,
    });
  }
  if (keywords.length === 0)
    return {
      ok: false,
      status: 404,
      reason: "No improved keywords with a visible rank for this client yet.",
    };

  // strongest improvement first
  keywords.sort((a, b) => b.maxImproved - a.maxImproved);

  // headline business = most common across the returned keywords
  const bizCounts = new Map<string, number>();
  for (const k of keywords)
    bizCounts.set(k.business, (bizCounts.get(k.business) ?? 0) + 1);
  const business =
    [...bizCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
    client.businessName;

  return {
    ok: true,
    data: {
      matchedBy,
      business,
      client: { id: client.id, name: client.businessName },
      keywords,
    },
  };
}

router.get("/improvement", requireApiToken, async (req, res) => {
  try {
    const r = await resolveImprovement(req.query as Record<string, string>);
    if (!r.ok)
      return res.status(r.status).json({ found: false, reason: r.reason });
    const d = r.data;
    const keywords = await Promise.all(
      d.keywords.map(async (k) => {
        const platforms: Record<string, unknown> = {};
        for (const [p, ranks] of Object.entries(k.platforms)) {
          const [firstUrl, currentUrl] = await Promise.all([
            presign(ranks.first.s3Uri),
            presign(ranks.current.s3Uri),
          ]);
          platforms[p] = {
            first: {
              rank: ranks.first.rank,
              date: ranks.first.date,
              screenshotUrl: firstUrl,
            },
            current: {
              rank: ranks.current.rank,
              date: ranks.current.date,
              screenshotUrl: currentUrl,
            },
          };
        }
        return { keyword: k.keyword, business: k.business, platforms };
      }),
    );
    return res.json({
      found: true,
      matchedBy: d.matchedBy,
      business: d.business,
      client: d.client,
      keywordCount: keywords.length,
      keywords,
    });
  } catch (err) {
    req.log.error({ err }, "sales improvement error");
    return res
      .status(500)
      .json({ found: false, reason: "internal server error" });
  }
});

/* GET /api/sales/screenshot?which=first|current&platform=chatgpt&keyword=…&email=…[&token=…]
   Permanent, embeddable image link — streams one PNG so GHL/email <img> tags
   never deal with an expiring URL. Defaults: keyword → strongest-improvement;
   platform → that keyword's best current rank. Auth via header OR ?token=. */
router.get("/screenshot", async (req, res) => {
  const expected = process.env.READ_API_TOKEN ?? "";
  const authz = (req.headers["authorization"] as string | undefined) ?? "";
  const bearer = authz.startsWith("Bearer ") ? authz.slice(7).trim() : "";
  const provided =
    bearer ||
    ((req.headers["x-api-key"] as string | undefined) ?? "").trim() ||
    (typeof req.query.token === "string" ? req.query.token.trim() : "");
  if (!expected || provided !== expected)
    return res.status(401).send("unauthorized");

  try {
    const which =
      lc(req.query.which as string) === "first" ? "first" : "current";
    const r = await resolveImprovement(req.query as Record<string, string>);
    if (!r.ok) return res.status(r.status).send(r.reason);
    // keyword already filtered by resolveImprovement when ?keyword= given; the
    // list is sorted strongest-first, so [0] is the right default.
    const kw = r.data.keywords[0];
    const wantPlatform = lc(req.query.platform as string);
    const ranks =
      (wantPlatform && kw.platforms[wantPlatform]) ||
      Object.values(kw.platforms).reduce((a, b) =>
        a.current.rank <= b.current.rank ? a : b,
      );
    const s3Uri = which === "first" ? ranks.first.s3Uri : ranks.current.s3Uri;
    const m = /^s3:\/\/([^/]+)\/(.+)$/.exec(s3Uri);
    if (!m) return res.status(500).send("bad screenshot reference");
    const obj = await s3.send(
      new GetObjectCommand({ Bucket: m[1], Key: m[2] }),
    );
    res.setHeader("Content-Type", obj.ContentType ?? "image/png");
    res.setHeader("Cache-Control", "public, max-age=300");
    (obj.Body as Readable).pipe(res);
  } catch (err) {
    req.log.error({ err }, "sales screenshot error");
    return res.status(500).send("error");
  }
});

export default router;
