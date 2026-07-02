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
  keywordVerdictsTable,
} from "@workspace/db/schema";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { requireApiToken } from "../middlewares/api-token";
import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const router = Router();
const s3 = new S3Client({ region: process.env.AWS_REGION ?? "us-east-1" });
const PLATFORM_ORDER = ["chatgpt", "gemini", "perplexity"] as const;
const PLATFORMS = new Set<string>(PLATFORM_ORDER);
// Largest believable AI-answer list position; ranks above this are treated as
// bad data (parse errors) and excluded from improvement/screenshot resolution.
const MAX_RANK = 50;
// A "top 3" finish is the bold claim that needs a positive summary to back it.
const TOP3 = 3;

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
  // Internal callers (admin UI / sales email) already know the client — a
  // numeric clientId beats every fuzzy signal.
  const idNum = Number(q.clientId);
  if (Number.isFinite(idNum) && idNum > 0) {
    const hit = clients.find((c) => c.id === idNum);
    if (hit) return { client: hit, matchedBy: "client_id" };
  }
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

export interface RankPoint {
  rank: number;
  date: string | null;
  s3Uri: string;
}
export interface PlatformRanks {
  first: RankPoint;
  current: RankPoint;
}
export interface KeywordEntry {
  keywordId: number;
  keyword: string | null;
  business: string;
  platforms: Record<string, PlatformRanks>;
  maxImproved: number;
}
export interface ImprovementData {
  matchedBy: string;
  business: string;
  client: { id: number; name: string };
  keywords: KeywordEntry[];
}

/** Build the strongest real before→after pair:
 *   after  = best (lowest) rank; ties broken toward the most recent date.
 *   before = ANY earlier-dated screenshot with a WORSE rank than the after —
 *            pick the worst such rank for the biggest visible improvement.
 * Returns null when no earlier-dated worse-ranked screenshot exists (no genuine
 * improvement to show). Dates are 'YYYY-MM-DD' text, so string compare = time. */
function firstAndCurrent(rows: RankRow[]): PlatformRanks | null {
  const dated = rows.filter((r) => r.date);
  if (dated.length === 0) return null;
  const current = dated.reduce((a, b) => {
    if (b.rankingPosition < a.rankingPosition) return b;
    if (
      b.rankingPosition === a.rankingPosition &&
      (b.date ?? "") > (a.date ?? "")
    )
      return b;
    return a;
  });
  const earlier = dated.filter(
    (r) =>
      (r.date ?? "") < (current.date ?? "") &&
      r.rankingPosition > current.rankingPosition,
  );
  if (earlier.length === 0) return null;
  const first = earlier.reduce((a, b) =>
    b.rankingPosition > a.rankingPosition ? b : a,
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

export async function resolveImprovement(
  q: Record<string, string>,
  opts: { strict?: boolean; positiveTop3?: boolean } = {},
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
        // Sanity bound: AI-answer list positions are small. Anything beyond
        // MAX_RANK (e.g. a parse-error "#1242") is garbage and must never
        // become a "before" rank or it makes the improvement look fake.
        sql`${rankingReportsTable.rankingPosition} BETWEEN 1 AND ${MAX_RANK}`,
        sql`${rankingReportsTable.screenshotUrl} LIKE 's3://%'`,
        // strict = only OCR-confirmed rank-visible screenshots (true); the
        // default treats unchecked (null) as visible. The GHL sync uses strict
        // so a not-yet-validated or inaccurate screenshot never reaches a CRM.
        opts.strict
          ? sql`${rankingReportsTable.screenshotRankVisible} = true`
          : sql`COALESCE(${rankingReportsTable.screenshotRankVisible}, true) = true`,
      ),
    )) as RankRow[];

  // group rows by keyword, then platform
  const byKeyword = new Map<number, RankRow[]>();
  for (const r of rrRows) {
    if (!byKeyword.has(r.keywordId)) byKeyword.set(r.keywordId, []);
    byKeyword.get(r.keywordId)!.push(r);
  }

  // Positive-summary guard: a TOP-3 headline must be backed by a positive
  // summary, otherwise the screenshot text could contradict the rank (e.g. "#1"
  // next to "weaker choice"). Ranks below the top 3 aren't bold claims, so they
  // pass without a sentiment check. A top-3 with no positive verdict is dropped.
  let sentimentMap: Map<string, string | null> | null = null;
  if (opts.positiveTop3 && candidateIds.length > 0) {
    const verdicts = await db
      .select({
        keywordId: keywordVerdictsTable.keywordId,
        platform: keywordVerdictsTable.platform,
        sentiment: keywordVerdictsTable.sentiment,
      })
      .from(keywordVerdictsTable)
      .where(inArray(keywordVerdictsTable.keywordId, candidateIds));
    sentimentMap = new Map(
      verdicts.map((v) => [`${v.keywordId}|${lc(v.platform)}`, v.sentiment]),
    );
  }

  const wantPlatforms = platformFilter ? [platformFilter] : [...PLATFORM_ORDER];
  const keywords: KeywordEntry[] = [];
  for (const [keywordId, rows] of byKeyword) {
    const platforms: Record<string, PlatformRanks> = {};
    let maxImproved = -Infinity;
    for (const p of wantPlatforms) {
      const fc = firstAndCurrent(rows.filter((r) => r.platform === p));
      if (!fc) continue;
      // a top-3 headline must have a positive summary, or its screenshot text
      // could undercut the rank — drop those; leave everything else as-is.
      if (
        sentimentMap &&
        fc.current.rank <= TOP3 &&
        sentimentMap.get(`${keywordId}|${p}`) !== "positive"
      )
        continue;
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
    const r = await resolveImprovement(req.query as Record<string, string>, {
      strict: req.query.strict === "1",
    });
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

/* ──────────────────────────────────────────────────────────────────────────
   GHL CRM sync — POST /api/sales/ghl/sync
   Body (or query): { email, contactId }. Triggered by a GHL Workflow "Custom
   Webhook" with the contact's email + id. Writes the best VALIDATED keyword per
   AI platform into the contact's AEO-Screenshot custom fields:
     slot 1 = ChatGPT, slot 2 = Gemini, slot 3 = Perplexity
   Each slot gets keyword + before(first) + after(current) permanent image URLs.
   Validation is strict (screenshot_rank_visible = true) AND the S3 object must
   exist; a platform without a clean before+after has its slot CLEARED so stale
   or inaccurate screenshots are removed. Slots 4 & 5 are always cleared.
   ────────────────────────────────────────────────────────────────────────── */
export const PLATFORM_LABELS: Record<string, string> = {
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  perplexity: "Perplexity",
};

interface GhlSlot {
  platform: string;
  keyword: string;
  before: string;
  after: string;
}
// GHL custom-field IDs (location uXRl9WpDjS7LFjeYfQqD, "AEO Screenshots" set).
const GHL_SLOTS: GhlSlot[] = [
  {
    platform: "chatgpt",
    keyword: "zK2LMxLvSzDuN57Tg5Wm",
    before: "aPO15dVThO9tLII4Gd0M",
    after: "145zp2b1sCUahlx8XUDP",
  },
  {
    platform: "gemini",
    keyword: "AgpjCvYMqMZIsZothqzL",
    before: "JG2d3pSactgHSyZZvqZU",
    after: "xRAFqQZyda6GIHhTymEM",
  },
  {
    platform: "perplexity",
    keyword: "RfpIMJO9NBi8jcOSt9Al",
    before: "ljpITPNxJWzUNuK6tddV",
    after: "J8QEwmgaWEHJfrpx2r9B",
  },
];
// Slots 4 & 5 (keyword + before + after) — always cleared.
const GHL_CLEAR_FIELDS = [
  "UNmLPRknfrcupkbHtHta",
  "Tejpef4lvNXxlOuhKdNQ",
  "hiYVp5Vwd4lnmopxYzUl",
  "hStRjpBWJjXI6TUqSQ7Y",
  "8SaDk0rNZVq1xH4dnyF0",
  "LMxQtjDJO0bcyhzhd10o",
];

const SALES_PUBLIC_BASE =
  process.env.SALES_PUBLIC_BASE ??
  "https://jjm59vpn3y.us-east-1.awsapprunner.com";

function buildScreenshotUrl(
  email: string,
  keyword: string,
  platform: string,
  which: "first" | "current",
): string {
  const u = new URL(`${SALES_PUBLIC_BASE}/api/sales/screenshot`);
  u.searchParams.set("email", email);
  u.searchParams.set("keyword", keyword);
  u.searchParams.set("platform", platform);
  u.searchParams.set("which", which);
  u.searchParams.set("token", process.env.READ_API_TOKEN ?? "");
  return u.toString();
}

/** Same permanent streaming link, but pinned by clientId — for internal
 *  callers (sales email) where the client may have no email on file. */
export function buildScreenshotUrlByClient(
  clientId: number,
  keyword: string,
  platform: string,
  which: "first" | "current",
  opts: { strict?: boolean } = {},
): string {
  const u = new URL(`${SALES_PUBLIC_BASE}/api/sales/screenshot`);
  u.searchParams.set("clientId", String(clientId));
  u.searchParams.set("keyword", keyword);
  u.searchParams.set("platform", platform);
  u.searchParams.set("which", which);
  if (opts.strict) u.searchParams.set("strict", "1");
  u.searchParams.set("token", process.env.READ_API_TOKEN ?? "");
  return u.toString();
}

export async function s3Exists(s3Uri: string): Promise<boolean> {
  const m = /^s3:\/\/([^/]+)\/(.+)$/.exec(s3Uri);
  if (!m) return false;
  try {
    await s3.send(new HeadObjectCommand({ Bucket: m[1], Key: m[2] }));
    return true;
  } catch {
    return false;
  }
}

async function ghlUpdateContact(
  contactId: string,
  customFields: { id: string; field_value: string }[],
): Promise<void> {
  const token = process.env.GHL_PIT_TOKEN;
  if (!token) throw new Error("GHL_PIT_TOKEN not configured");
  const resp = await fetch(
    `https://services.leadconnectorhq.com/contacts/${contactId}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        Version: "2021-07-28",
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ customFields }),
    },
  );
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(
      `GHL update failed (${resp.status}): ${text.slice(0, 300)}`,
    );
  }
}

router.post("/ghl/sync", requireApiToken, async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const pick = (k: string) =>
      String(body[k] ?? (req.query[k] as string) ?? "").trim();
    const email = lc(pick("email"));
    const contactId = pick("contactId") || pick("contact_id") || pick("id");
    if (!email)
      return res.status(400).json({ ok: false, reason: "email is required" });
    if (!contactId)
      return res
        .status(400)
        .json({ ok: false, reason: "contactId is required" });

    // GHL_SYNC_STRICT=1 → only OCR-verified screenshots (screenshot_rank_visible
    // = true: the client is actually shown at their rank) reach the CRM. Default
    // (unset) stays lenient — serves the strongest improvement even if not yet
    // verified — so coverage isn't gutted before captures are re-framed. Flip the
    // env var on once verified screenshots have repopulated. The positive-summary
    // guard always applies (a top-3 headline needs a positive summary).
    const r = await resolveImprovement(
      { email },
      { strict: process.env.GHL_SYNC_STRICT === "1", positiveTop3: true },
    );

    const fields: { id: string; field_value: string }[] = GHL_CLEAR_FIELDS.map(
      (id) => ({ id, field_value: "" }),
    );
    const written: string[] = [];

    for (const slot of GHL_SLOTS) {
      // best keyword for THIS platform = strongest improvement, validated.
      let best: {
        keyword: string | null;
        first: RankPoint;
        current: RankPoint;
      } | null = null;
      let bestImp = -Infinity;
      if (r.ok) {
        for (const k of r.data.keywords) {
          const pr = k.platforms[slot.platform];
          if (!pr) continue;
          const imp = pr.first.rank - pr.current.rank;
          if (imp > bestImp) {
            bestImp = imp;
            best = { keyword: k.keyword, first: pr.first, current: pr.current };
          }
        }
      }
      const valid =
        best != null &&
        bestImp > 0 &&
        (await s3Exists(best.first.s3Uri)) &&
        (await s3Exists(best.current.s3Uri));
      if (!valid || !best) {
        // clear this platform's slot so a stale/inaccurate screenshot is removed
        fields.push(
          { id: slot.keyword, field_value: "" },
          { id: slot.before, field_value: "" },
          { id: slot.after, field_value: "" },
        );
        continue;
      }
      const kwText = best.keyword ?? "";
      fields.push(
        {
          id: slot.keyword,
          field_value: `${kwText} (${PLATFORM_LABELS[slot.platform]})`,
        },
        {
          id: slot.before,
          field_value: buildScreenshotUrl(
            email,
            kwText,
            slot.platform,
            "first",
          ),
        },
        {
          id: slot.after,
          field_value: buildScreenshotUrl(
            email,
            kwText,
            slot.platform,
            "current",
          ),
        },
      );
      written.push(
        `${slot.platform}: "${kwText}" #${best.first.rank}→#${best.current.rank}`,
      );
    }

    await ghlUpdateContact(contactId, fields);
    return res.json({
      ok: true,
      contactId,
      email,
      written,
      clearedPlatforms: GHL_SLOTS.length - written.length,
    });
  } catch (err) {
    req.log.error({ err }, "sales ghl sync error");
    return res.status(500).json({ ok: false, reason: "internal server error" });
  }
});

export default router;
