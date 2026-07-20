import { Router } from "express";
import { db } from "@workspace/db";
import {
  clientsTable,
  businessesTable,
  clientAeoPlansTable,
  emailSendsTable,
} from "@workspace/db/schema";
import { eq, desc, sql, inArray } from "drizzle-orm";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import sgMail from "@sendgrid/mail";
import { chatCompletion } from "../services/llm-client";
import { requireOwner, requireSalesAllowed } from "../middlewares/role-auth";
import {
  assertScopedAccessToClient,
  getScopedClientIds,
} from "../lib/scoped-access";

const router = Router();

const s3Client = new S3Client({
  region: process.env.AWS_REGION ?? "us-east-1",
});

const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60;

/* Configure SendGrid once on first send call (env may not be ready at import). */
let sgConfigured = false;
function configureSendGrid(): void {
  if (sgConfigured) return;
  const key = process.env.SENDGRID_API_KEY;
  if (!key) throw new Error("SENDGRID_API_KEY not set");
  sgMail.setApiKey(key);
  sgConfigured = true;
}

interface RankingFilter {
  clientId: number;
  businessId?: number | null;
  aeoPlanId?: number | null;
}

interface BiWeeklyRow {
  keywordId: number;
  keywordText: string;
  platform: string;
  current: {
    reportId: number;
    date: string;
    rank: number | null;
    screenshotUrl: string | null;
  } | null;
  previous: {
    reportId: number;
    date: string;
    rank: number | null;
    screenshotUrl: string | null;
  } | null;
  change: number | null;
  status: "improved" | "declined" | "steady" | "new" | "lost" | "no-data";
}

/* Bi-weekly comparison query: returns Current (most recent) and Previous (one
   before) per (keyword_id, platform). Respects business + aeo-plan filters. */
async function getBiWeeklyRankings(
  filter: RankingFilter,
): Promise<BiWeeklyRow[]> {
  const result = await db.execute(sql`
    WITH ranked AS (
      SELECT
        rr.id, rr.keyword_id, lower(rr.platform) AS platform,
        rr.date, rr.ranking_position, rr.screenshot_url,
        k.keyword_text,
        ROW_NUMBER() OVER (
          PARTITION BY rr.keyword_id, lower(rr.platform)
          ORDER BY rr.date DESC, rr.id DESC
        ) AS rn
      FROM ranking_reports rr
      LEFT JOIN keywords k ON k.id = rr.keyword_id
      WHERE rr.client_id = ${filter.clientId}
        ${filter.businessId ? sql`AND rr.business_id = ${filter.businessId}` : sql``}
        ${filter.aeoPlanId ? sql`AND rr.keyword_id IN (SELECT id FROM keywords WHERE aeo_plan_id = ${filter.aeoPlanId})` : sql``}
    )
    SELECT
      keyword_id,
      MAX(keyword_text)                                AS keyword_text,
      platform,
      MAX(CASE WHEN rn=1 THEN id END)                  AS current_id,
      MAX(CASE WHEN rn=1 THEN date END)                AS current_date,
      MAX(CASE WHEN rn=1 THEN ranking_position END)    AS current_rank,
      MAX(CASE WHEN rn=1 THEN screenshot_url END)      AS current_url,
      MAX(CASE WHEN rn=2 THEN id END)                  AS prev_id,
      MAX(CASE WHEN rn=2 THEN date END)                AS prev_date,
      MAX(CASE WHEN rn=2 THEN ranking_position END)    AS prev_rank,
      MAX(CASE WHEN rn=2 THEN screenshot_url END)      AS prev_url
    FROM ranked
    WHERE rn <= 2
    GROUP BY keyword_id, platform
    ORDER BY MAX(keyword_text), platform
  `);

  function deriveStatus(
    prev: number | null,
    cur: number | null,
  ): BiWeeklyRow["status"] {
    if (cur == null && prev == null) return "no-data";
    if (prev == null && cur != null) return "new";
    if (prev != null && cur == null) return "lost";
    if (prev != null && cur != null) {
      if (cur < prev) return "improved";
      if (cur > prev) return "declined";
      return "steady";
    }
    return "no-data";
  }

  return (result.rows as Array<Record<string, unknown>>).map((r) => {
    const currentRank = r.current_rank == null ? null : Number(r.current_rank);
    const prevRank = r.prev_rank == null ? null : Number(r.prev_rank);
    const change =
      currentRank != null && prevRank != null ? currentRank - prevRank : null;
    return {
      keywordId: Number(r.keyword_id),
      keywordText: String(r.keyword_text ?? ""),
      platform: String(r.platform),
      current: r.current_id
        ? {
            reportId: Number(r.current_id),
            date: String(r.current_date),
            rank: currentRank,
            screenshotUrl: r.current_url == null ? null : String(r.current_url),
          }
        : null,
      previous: r.prev_id
        ? {
            reportId: Number(r.prev_id),
            date: String(r.prev_date),
            rank: prevRank,
            screenshotUrl: r.prev_url == null ? null : String(r.prev_url),
          }
        : null,
      change,
      status: deriveStatus(prevRank, currentRank),
    };
  });
}

async function maybeSignS3(url: string | null): Promise<string | null> {
  if (!url || !url.startsWith("s3://")) return null;
  const m = url.match(/^s3:\/\/([^/]+)\/(.+)$/);
  if (!m) return null;
  const [, bucket, key] = m;
  return getSignedUrl(
    s3Client,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: SEVEN_DAYS_SECONDS },
  );
}

interface SignedBiWeeklyRow extends Omit<BiWeeklyRow, "current" | "previous"> {
  current:
    | (NonNullable<BiWeeklyRow["current"]> & { imageUrl: string | null })
    | null;
  previous:
    | (NonNullable<BiWeeklyRow["previous"]> & { imageUrl: string | null })
    | null;
}

/* Drop rows whose platform or keywordId isn't in the explicit allow-list.
   An undefined/empty list means "no filter" (include all). Used by both
   /email-preview and /send-report to let the operator narrow the email
   table without changing the summary stats. */
function applyEmailTableFilter<
  T extends { platform: string; keywordId: number },
>(
  rows: T[],
  platforms: string[] | undefined,
  keywordIds: number[] | undefined,
): T[] {
  const platSet =
    platforms && platforms.length > 0
      ? new Set(platforms.map((p) => p.toLowerCase()))
      : null;
  const kwSet =
    keywordIds && keywordIds.length > 0 ? new Set(keywordIds) : null;
  if (!platSet && !kwSet) return rows;
  return rows.filter(
    (r) =>
      (!platSet || platSet.has(r.platform)) &&
      (!kwSet || kwSet.has(r.keywordId)),
  );
}

async function signAllUrls(rows: BiWeeklyRow[]): Promise<SignedBiWeeklyRow[]> {
  return Promise.all(
    rows.map(async (r) => ({
      ...r,
      current: r.current
        ? { ...r.current, imageUrl: await maybeSignS3(r.current.screenshotUrl) }
        : null,
      previous: r.previous
        ? {
            ...r.previous,
            imageUrl: await maybeSignS3(r.previous.screenshotUrl),
          }
        : null,
    })),
  );
}

function platformLabel(p: string): string {
  if (p === "chatgpt") return "ChatGPT";
  if (p === "gemini") return "Gemini";
  if (p === "perplexity") return "Perplexity";
  return p;
}
function platformColor(p: string): string {
  if (p === "chatgpt") return "#10a37f";
  if (p === "gemini") return "#4285f4";
  if (p === "perplexity") return "#7c3aed";
  return "#64748b";
}
function statusBadge(status: BiWeeklyRow["status"]): string {
  const map = {
    improved: { label: "↑ Improved", bg: "#dcfce7", fg: "#166534" },
    declined: { label: "↓ Declined", bg: "#fee2e2", fg: "#991b1b" },
    steady: { label: "= Steady", bg: "#f1f5f9", fg: "#475569" },
    new: { label: "★ New", bg: "#e0e7ff", fg: "#3730a3" },
    lost: { label: "✗ Lost", bg: "#fee2e2", fg: "#991b1b" },
    "no-data": { label: "—", bg: "#f1f5f9", fg: "#94a3b8" },
  };
  const s = map[status];
  return `<span style="display:inline-block;padding:2px 8px;border-radius:10px;background:${s.bg};color:${s.fg};font-size:11px;font-weight:600">${s.label}</span>`;
}
function rankPill(rank: number | null): string {
  if (rank == null) return `<span style="color:#94a3b8">—</span>`;
  return `<strong>#${rank}</strong>`;
}
function changePill(
  change: number | null,
  status: BiWeeklyRow["status"],
): string {
  if (
    change == null ||
    status === "no-data" ||
    status === "steady" ||
    status === "new" ||
    status === "lost"
  ) {
    return `<span style="color:#94a3b8">—</span>`;
  }
  const isUp = change < 0;
  const color = isUp ? "#16a34a" : "#dc2626";
  const arrow = isUp ? "▲" : "▼";
  return `<span style="color:${color};font-weight:600">${arrow} ${Math.abs(change)}</span>`;
}

type EmailMode = "comparison" | "current" | "previous";

interface BuildEmailArgs {
  clientName: string;
  filterLabel: string | null;
  rows: SignedBiWeeklyRow[];
  customMessage?: string;
  mode?: EmailMode;
}

function buildEmailHtml({
  clientName,
  filterLabel,
  rows,
  customMessage,
  mode = "comparison",
}: BuildEmailArgs): string {
  /* Group rows by keyword for the table. */
  const byKeyword = new Map<
    number,
    { text: string; platforms: SignedBiWeeklyRow[] }
  >();
  for (const r of rows) {
    if (!byKeyword.has(r.keywordId)) {
      byKeyword.set(r.keywordId, { text: r.keywordText, platforms: [] });
    }
    byKeyword.get(r.keywordId)!.platforms.push(r);
  }

  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "America/New_York",
  });

  /* Column headers vary by mode. */
  const headers =
    mode === "comparison"
      ? ["Platform", "Previous", "Current", "Change", "Status", "Screenshot"]
      : mode === "current"
        ? ["Platform", "Current Rank", "Date", "Screenshot"]
        : ["Platform", "Previous Rank", "Date", "Screenshot"];

  const th = headers
    .map(
      (h) =>
        `<th style="padding:8px 10px;text-align:left;font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px">${h}</th>`,
    )
    .join("");

  function imgCell(url: string | null | undefined): string {
    if (!url)
      return `<span style="color:#cbd5e1;font-size:11px">no screenshot</span>`;
    return `<a href="${url}" style="display:inline-block">
        <img src="${url}" alt="screenshot" width="160"
             style="max-width:160px;height:auto;border:1px solid #e5e7eb;border-radius:6px;display:block" />
      </a>`;
  }

  function platformCell(p: string): string {
    return `<td style="padding:10px;border-bottom:1px solid #f1f5f9;vertical-align:top">
              <span style="display:inline-block;padding:3px 10px;border-radius:12px;background:${platformColor(p)};color:#fff;font-size:11px;font-weight:600">${platformLabel(p)}</span>
            </td>`;
  }

  function rowFor(p: SignedBiWeeklyRow): string {
    const td = (inner: string): string =>
      `<td style="padding:10px;border-bottom:1px solid #f1f5f9;vertical-align:top">${inner}</td>`;
    if (mode === "current") {
      return `<tr>
        ${platformCell(p.platform)}
        ${td(`<div style="font-size:16px">${rankPill(p.current?.rank ?? null)}</div>`)}
        ${td(`<div style="font-size:11px;color:#64748b">${p.current?.date ?? "—"}</div>`)}
        ${td(imgCell(p.current?.imageUrl))}
      </tr>`;
    }
    if (mode === "previous") {
      return `<tr>
        ${platformCell(p.platform)}
        ${td(`<div style="font-size:16px">${rankPill(p.previous?.rank ?? null)}</div>`)}
        ${td(`<div style="font-size:11px;color:#64748b">${p.previous?.date ?? "—"}</div>`)}
        ${td(imgCell(p.previous?.imageUrl))}
      </tr>`;
    }
    /* comparison */
    return `<tr>
      ${platformCell(p.platform)}
      ${td(`<div style="font-size:14px">${rankPill(p.previous?.rank ?? null)}</div>
            <div style="font-size:10px;color:#94a3b8">${p.previous?.date ?? "—"}</div>`)}
      ${td(`<div style="font-size:16px">${rankPill(p.current?.rank ?? null)}</div>
            <div style="font-size:10px;color:#94a3b8">${p.current?.date ?? "—"}</div>`)}
      ${td(`<span style="font-size:14px">${changePill(p.change, p.status)}</span>`)}
      ${td(statusBadge(p.status))}
      ${td(imgCell(p.current?.imageUrl))}
    </tr>`;
  }

  const keywordSections = [...byKeyword.values()]
    .map((kw) => {
      const platRows = kw.platforms
        .sort((a, b) => a.platform.localeCompare(b.platform))
        .map((p) => rowFor(p))
        .join("");
      return `
      <div style="margin:24px 0">
        <h3 style="margin:0 0 8px 0;color:#0f172a;font-size:16px">${kw.text}</h3>
        <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
          <thead><tr style="background:#f8fafc">${th}</tr></thead>
          <tbody>${platRows}</tbody>
        </table>
      </div>`;
    })
    .join("");

  const customBlock = customMessage?.trim()
    ? `<div style="margin:16px 0;padding:16px;background:#f8fafc;border-left:3px solid #6366f1;border-radius:4px;color:#334155;font-size:14px;white-space:pre-wrap">${customMessage}</div>`
    : "";

  const filterLine = filterLabel
    ? `<p style="margin:0 0 8px 0;color:#64748b;font-size:13px">Scope: ${filterLabel}</p>`
    : "";

  const title =
    mode === "current"
      ? "AEO Current Rankings Report"
      : mode === "previous"
        ? "AEO Rankings — Previous Period"
        : "AEO Bi-Weekly Rankings Report";

  const footer =
    mode === "comparison"
      ? "Comparison: latest audit vs the audit before it. Screenshot links expire in 7 days."
      : mode === "current"
        ? "Latest audit per keyword × platform. Screenshot links expire in 7 days."
        : "Audit from the previous period (one before latest). Screenshot links expire in 7 days.";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:760px;margin:0 auto;padding:32px 16px">
    <div style="background:#fff;border-radius:12px;padding:28px;border:1px solid #e5e7eb">
      <h1 style="margin:0 0 4px 0;color:#0f172a;font-size:22px">${title}</h1>
      <p style="margin:0 0 4px 0;color:#64748b;font-size:14px">${clientName} · ${today}</p>
      ${filterLine}
      ${customBlock}
      ${keywordSections || `<p style="color:#94a3b8">No keyword data for this period.</p>`}
      <p style="margin:28px 0 0 0;color:#94a3b8;font-size:11px;text-align:center">${footer}</p>
    </div>
  </div>
</body>
</html>`;
}

/* ─── helpers shared by send + preview + templates: derive filter label and
        compute high-level summary stats ───────────────────────────────── */
interface FilterContext {
  clientName: string;
  businessName: string | null;
  campaignName: string | null;
  filterLabel: string | null;
}
async function loadFilterContext(
  filter: RankingFilter,
): Promise<FilterContext> {
  const clientRow = await db
    .select({ businessName: clientsTable.businessName })
    .from(clientsTable)
    .where(eq(clientsTable.id, filter.clientId))
    .limit(1);
  const clientName = clientRow[0]?.businessName ?? `Client ${filter.clientId}`;

  let businessName: string | null = null;
  if (filter.businessId) {
    const r = await db
      .select({ name: businessesTable.name })
      .from(businessesTable)
      .where(eq(businessesTable.id, filter.businessId))
      .limit(1);
    businessName = r[0]?.name ?? null;
  }
  let campaignName: string | null = null;
  if (filter.aeoPlanId) {
    const r = await db
      .select({ name: clientAeoPlansTable.name })
      .from(clientAeoPlansTable)
      .where(eq(clientAeoPlansTable.id, filter.aeoPlanId))
      .limit(1);
    campaignName = r[0]?.name ?? null;
  }
  const parts: string[] = [];
  if (businessName) parts.push(`Business: ${businessName}`);
  if (campaignName) parts.push(`Campaign: ${campaignName}`);
  return {
    clientName,
    businessName,
    campaignName,
    filterLabel: parts.length ? parts.join(" · ") : null,
  };
}

interface SummaryStats {
  keywordCount: number;
  rowCount: number;
  screenshotCount: number;
  improvedCount: number;
  declinedCount: number;
  steadyCount: number;
  newCount: number;
  lostCount: number;
  topKeyword: string | null;
  topRank: number | null;
  biggestImprover: { keyword: string; from: number; to: number } | null;
  biggestDecliner: { keyword: string; from: number; to: number } | null;
}
function summarize(rows: SignedBiWeeklyRow[]): SummaryStats {
  const keywordIds = new Set(rows.map((r) => r.keywordId));
  let topKeyword: string | null = null;
  let topRank: number | null = null;
  let biggestImprover: SummaryStats["biggestImprover"] = null;
  let biggestDecliner: SummaryStats["biggestDecliner"] = null;
  let improved = 0,
    declined = 0,
    steady = 0,
    newC = 0,
    lost = 0;
  let screenshots = 0;
  for (const r of rows) {
    if (r.current?.imageUrl) screenshots++;
    if (r.status === "improved") improved++;
    else if (r.status === "declined") declined++;
    else if (r.status === "steady") steady++;
    else if (r.status === "new") newC++;
    else if (r.status === "lost") lost++;
    if (
      r.current?.rank != null &&
      (topRank == null || r.current.rank < topRank)
    ) {
      topRank = r.current.rank;
      topKeyword = r.keywordText;
    }
    if (
      r.change != null &&
      r.change < 0 &&
      r.previous?.rank != null &&
      r.current?.rank != null &&
      (biggestImprover == null ||
        r.change < biggestImprover.to - biggestImprover.from)
    ) {
      biggestImprover = {
        keyword: r.keywordText,
        from: r.previous.rank,
        to: r.current.rank,
      };
    }
    if (
      r.change != null &&
      r.change > 0 &&
      r.previous?.rank != null &&
      r.current?.rank != null &&
      (biggestDecliner == null ||
        r.change > biggestDecliner.to - biggestDecliner.from)
    ) {
      biggestDecliner = {
        keyword: r.keywordText,
        from: r.previous.rank,
        to: r.current.rank,
      };
    }
  }
  return {
    keywordCount: keywordIds.size,
    rowCount: rows.length,
    screenshotCount: screenshots,
    improvedCount: improved,
    declinedCount: declined,
    steadyCount: steady,
    newCount: newC,
    lostCount: lost,
    topKeyword,
    topRank,
    biggestImprover,
    biggestDecliner,
  };
}

/* ─── ROUTES ───────────────────────────────────────────────────────────── */

/* GET /api/rankings/email-config
   Reports which sender bits are configured so the FE can show a clear
   "you can't send yet" banner instead of waiting for the send to fail. */
router.get("/email-config", (_req, res) => {
  const fromEmail = process.env.SENDGRID_FROM_EMAIL ?? "";
  const fromName = process.env.SENDGRID_FROM_NAME ?? "";
  const hasApiKey = Boolean(process.env.SENDGRID_API_KEY);
  const safeOverride = process.env.SAFE_RECIPIENT_OVERRIDE ?? "";
  const ready = Boolean(fromEmail && hasApiKey);
  return res.json({
    ready,
    fromEmail: fromEmail || null,
    fromName: fromName || null,
    hasApiKey,
    safeRecipientOverride: safeOverride || null,
    safeModeActive: Boolean(safeOverride),
  });
});

router.get("/email-recipients/:clientId", requireSalesAllowed, async (req, res) => {
  const id = Number.parseInt(req.params.clientId, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: "invalid id" });
  if (!(await assertScopedAccessToClient(req, res, id))) return;
  try {
    const rows = await db
      .select({
        contactEmail: clientsTable.contactEmail,
        accountEmail: clientsTable.accountEmail,
        billingEmail: clientsTable.billingEmail,
        businessName: clientsTable.businessName,
      })
      .from(clientsTable)
      .where(eq(clientsTable.id, id))
      .limit(1);
    if (rows.length === 0)
      return res.status(404).json({ error: "client not found" });
    return res.json(rows[0]);
  } catch (err) {
    req.log.error({ err, id }, "Error fetching client email recipients");
    return res.status(500).json({ error: "Internal server error" });
  }
});

function parseFilterQuery(req: {
  query: Record<string, unknown>;
}): RankingFilter | null {
  const clientId = Number.parseInt(String(req.query.clientId ?? ""), 10);
  if (Number.isNaN(clientId)) return null;
  return {
    clientId,
    businessId: req.query.businessId
      ? Number.parseInt(String(req.query.businessId), 10)
      : null,
    aeoPlanId: req.query.aeoPlanId
      ? Number.parseInt(String(req.query.aeoPlanId), 10)
      : null,
  };
}

/* GET /api/rankings/email-preview */
router.get("/email-preview", requireSalesAllowed, async (req, res) => {
  const filter = parseFilterQuery(req);
  if (!filter) return res.status(400).json({ error: "clientId required" });
  if (!(await assertScopedAccessToClient(req, res, filter.clientId))) return;
  try {
    const ctx = await loadFilterContext(filter);
    const raw = await getBiWeeklyRankings(filter);
    const rows = await signAllUrls(raw);
    const modeParam = String(req.query.mode ?? "comparison");
    const mode: EmailMode =
      modeParam === "current" || modeParam === "previous"
        ? modeParam
        : "comparison";

    /* Optional email-table filters (don't affect the keyword-list payload below). */
    const platformsParam = req.query.platforms;
    const keywordIdsParam = req.query.keywordIds;
    const platforms = Array.isArray(platformsParam)
      ? platformsParam.map(String)
      : typeof platformsParam === "string" && platformsParam.length > 0
        ? platformsParam.split(",")
        : undefined;
    const keywordIds = Array.isArray(keywordIdsParam)
      ? keywordIdsParam.map((x) => Number(x)).filter((n) => Number.isFinite(n))
      : typeof keywordIdsParam === "string" && keywordIdsParam.length > 0
        ? keywordIdsParam
            .split(",")
            .map((x) => Number(x))
            .filter((n) => Number.isFinite(n))
        : undefined;

    const tableRows = applyEmailTableFilter(rows, platforms, keywordIds);

    const html = buildEmailHtml({
      clientName: ctx.clientName,
      filterLabel: ctx.filterLabel,
      rows: tableRows,
      mode,
      customMessage: req.query.customMessage
        ? String(req.query.customMessage)
        : undefined,
    });
    /* Summary stats stay on the unfiltered set so the recipient still sees
       the full client-scope numbers in the intro copy. */
    const stats = summarize(rows);

    /* Unique keywords across the unfiltered scope — drives the FE checkbox list. */
    const seenKwIds = new Set<number>();
    const keywords = [] as Array<{ id: number; text: string }>;
    for (const r of rows) {
      if (seenKwIds.has(r.keywordId)) continue;
      seenKwIds.add(r.keywordId);
      keywords.push({ id: r.keywordId, text: r.keywordText });
    }
    keywords.sort((a, b) => a.text.localeCompare(b.text));

    return res.json({
      html,
      clientName: ctx.clientName,
      filterLabel: ctx.filterLabel,
      keywordCount: stats.keywordCount,
      rowCount: stats.rowCount,
      withScreenshotCount: stats.screenshotCount,
      keywords,
    });
  } catch (err) {
    req.log.error({ err }, "Error building email preview");
    return res.status(500).json({ error: "Internal server error" });
  }
});

/* GET /api/rankings/email-templates */
router.get("/email-templates", requireSalesAllowed, async (req, res) => {
  const filter = parseFilterQuery(req);
  if (!filter) return res.status(400).json({ error: "clientId required" });
  if (!(await assertScopedAccessToClient(req, res, filter.clientId))) return;
  try {
    const ctx = await loadFilterContext(filter);
    const raw = await getBiWeeklyRankings(filter);
    const rows = await signAllUrls(raw);
    const stats = summarize(rows);

    const todayET = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "America/New_York",
    });
    const scopeNote = ctx.filterLabel ? ` (${ctx.filterLabel})` : "";

    const vars = {
      client_name: ctx.clientName,
      date: todayET,
      scope: ctx.filterLabel ?? "all keywords",
      keyword_count: stats.keywordCount,
      row_count: stats.rowCount,
      screenshot_count: stats.screenshotCount,
      improved_count: stats.improvedCount,
      declined_count: stats.declinedCount,
      steady_count: stats.steadyCount,
      top_keyword: stats.topKeyword ?? "your keywords",
      top_rank: stats.topRank,
      biggest_improver: stats.biggestImprover
        ? `"${stats.biggestImprover.keyword}" went from #${stats.biggestImprover.from} to #${stats.biggestImprover.to}`
        : null,
    };

    const interpolate = (s: string): string =>
      s.replace(/\{(\w+)\}/g, (_, k) =>
        String(vars[k as keyof typeof vars] ?? ""),
      );

    const rawTemplates: Array<{ id: string; name: string; body: string }> = [
      {
        id: "biweekly",
        name: "Bi-weekly comparison",
        body: `Hi {client_name},

Here's your bi-weekly AEO rankings update as of {date}${scopeNote}. We compared the latest audit to the audit before it across {keyword_count} keywords.

Summary:
• {improved_count} keywords improved
• {declined_count} keywords declined
• {steady_count} keywords held steady

Tap any screenshot in the table below to see the audit result on each AI platform.`,
      },
      {
        id: "highlight",
        name: "Highlight a top result",
        body: `Hi {client_name},

Great news — "{top_keyword}" is currently ranking #{top_rank} across the AI platforms we track. Below is the bi-weekly comparison of all keywords${scopeNote} as of {date}, with screenshots for every audit.

Let us know if you'd like to discuss strategy on any of the keywords below.`,
      },
      {
        id: "checkin",
        name: "Quick check-in",
        body: `Hi {client_name},

Your bi-weekly AEO rankings report for {date} is attached${scopeNote}. {keyword_count} keywords tracked. {improved_count} improved, {declined_count} declined, {steady_count} steady.

Let me know if anything needs attention.`,
      },
      {
        id: "blank",
        name: "Start from scratch",
        body: "",
      },
    ];

    const templates = rawTemplates.map((t) => ({
      ...t,
      body: interpolate(t.body),
    }));

    return res.json({ vars, templates });
  } catch (err) {
    req.log.error({ err }, "Error building email templates");
    return res.status(500).json({ error: "Internal server error" });
  }
});

/* POST /api/rankings/email-ai-suggest
   Body: { clientId, businessId?, aeoPlanId?, instruction? }
   Calls DeepSeek with a compact summary of the bi-weekly data + (optional)
   instruction hint, returns a generated email body the user can edit. */
router.post("/email-ai-suggest", requireOwner, async (req, res) => {
  const body = req.body as Partial<RankingFilter> & { instruction?: string };
  if (!body.clientId)
    return res.status(400).json({ error: "clientId required" });
  try {
    const filter: RankingFilter = {
      clientId: body.clientId,
      businessId: body.businessId ?? null,
      aeoPlanId: body.aeoPlanId ?? null,
    };
    const ctx = await loadFilterContext(filter);
    const raw = await getBiWeeklyRankings(filter);
    const rows = await signAllUrls(raw);
    const stats = summarize(rows);

    /* Compact data summary the LLM will reason about. */
    const compact = {
      client: ctx.clientName,
      scope: ctx.filterLabel ?? "all keywords",
      date_ranges: {
        previous_dates: [
          ...new Set(rows.map((r) => r.previous?.date).filter(Boolean)),
        ],
        current_dates: [
          ...new Set(rows.map((r) => r.current?.date).filter(Boolean)),
        ],
      },
      counts: {
        keywords: stats.keywordCount,
        platform_rows: stats.rowCount,
        improved: stats.improvedCount,
        declined: stats.declinedCount,
        steady: stats.steadyCount,
        new: stats.newCount,
        lost: stats.lostCount,
      },
      top_current_rank:
        stats.topRank != null
          ? { keyword: stats.topKeyword, rank: stats.topRank }
          : null,
      biggest_improver: stats.biggestImprover,
      biggest_decliner: stats.biggestDecliner,
      /* Per-keyword breakdown limited to top 25 most-changed for the LLM. */
      keyword_breakdown: rows
        .sort((a, b) => Math.abs(b.change ?? 0) - Math.abs(a.change ?? 0))
        .slice(0, 25)
        .map((r) => ({
          keyword: r.keywordText,
          platform: r.platform,
          previous_rank: r.previous?.rank ?? null,
          current_rank: r.current?.rank ?? null,
          change: r.change,
          status: r.status,
        })),
    };

    const systemPrompt = `You write concise, friendly, professional emails for SEO clients about their AI-search (AEO) rankings on ChatGPT, Gemini, and Perplexity.

Write only the body text — NO subject line, NO greeting like "Hi {name}", NO sign-off. The system already adds:
- A greeting and the client name
- The rankings table with per-keyword screenshots
- A footer

Your output:
- 2-4 short paragraphs, max 150 words
- Plain text only (no markdown, no HTML)
- Reference specific numbers from the data (improvements, declines, top keyword)
- Match the tone of a trusted account manager — warm but factual
- If there are wins, lead with them. If results are mixed, be balanced.
- If the user provided an instruction, follow it`;

    const userPrompt = `Here is the actual ranking data for this client:

${JSON.stringify(compact, null, 2)}

${body.instruction?.trim() ? `User instruction: ${body.instruction.trim()}\n\n` : ""}Write the email body now.`;

    const result = await chatCompletion({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
      maxTokens: 600,
    });
    return res.json({
      body: result.content.trim(),
      model: result.model,
      costUsd: Number(result.costUsd.toFixed(6)),
      tokens: result.totalTokens,
    });
  } catch (err) {
    req.log.error({ err }, "Error generating AI email suggestion");
    const detail = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: "AI generation failed", detail });
  }
});

interface SendReportBody {
  clientId: number;
  businessId?: number | null;
  aeoPlanId?: number | null;
  recipients: string[];
  subject?: string;
  customMessage?: string;
  /* What to include in the table:
       comparison = Previous | Current | Change | Status | Screenshot
       current    = Current Rank | Date | Screenshot
       previous   = Previous Rank | Date | Screenshot */
  mode?: EmailMode;
  /* Optional email-table filters. Empty/undefined = include all. Filters
     drop rows from the rendered table only; the intro summary counts
     still reflect the full client scope. */
  platforms?: string[];
  keywordIds?: number[];
}

/* POST /api/rankings/send-report */
router.post("/send-report", requireOwner, async (req, res) => {
  const body = req.body as Partial<SendReportBody>;
  if (
    !body.clientId ||
    !Array.isArray(body.recipients) ||
    body.recipients.length === 0
  ) {
    return res
      .status(400)
      .json({ error: "clientId and recipients[] required" });
  }
  try {
    configureSendGrid();
    const fromEmail = process.env.SENDGRID_FROM_EMAIL;
    const fromName = process.env.SENDGRID_FROM_NAME ?? "AEO Platform Reports";
    if (!fromEmail) {
      return res.status(503).json({
        error: "Sender email not configured",
        code: "SENDER_NOT_CONFIGURED",
        detail:
          "No FROM address is set. Sending is disabled until you set SENDGRID_FROM_EMAIL in AWS Secrets Manager (aeo-admin/prod) and verify the address in SendGrid.",
      });
    }

    const filter: RankingFilter = {
      clientId: body.clientId,
      businessId: body.businessId ?? null,
      aeoPlanId: body.aeoPlanId ?? null,
    };
    const ctx = await loadFilterContext(filter);
    const raw = await getBiWeeklyRankings(filter);
    const rows = await signAllUrls(raw);
    const mode: EmailMode =
      body.mode === "current" || body.mode === "previous"
        ? body.mode
        : "comparison";

    const tableRows = applyEmailTableFilter(
      rows,
      body.platforms,
      body.keywordIds,
    );

    const html = buildEmailHtml({
      clientName: ctx.clientName,
      filterLabel: ctx.filterLabel,
      rows: tableRows,
      mode,
      customMessage: body.customMessage,
    });
    const subjectModeWord =
      mode === "current"
        ? "Current Rankings"
        : mode === "previous"
          ? "Rankings — Previous Period"
          : "Bi-Weekly Rankings";
    const subject =
      body.subject?.trim() ||
      `AEO ${subjectModeWord} — ${ctx.clientName}${ctx.filterLabel ? ` (${ctx.filterLabel})` : ""} (${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })})`;

    /* Safe recipient override — re-route during testing. */
    const intendedRecipients = body.recipients
      .map((s) => String(s).trim())
      .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
    if (intendedRecipients.length === 0) {
      return res.status(400).json({ error: "no valid recipient addresses" });
    }
    const safeOverride = process.env.SAFE_RECIPIENT_OVERRIDE;
    const actualRecipients = safeOverride ? [safeOverride] : intendedRecipients;

    const msg = {
      to: actualRecipients,
      from: { email: fromEmail, name: fromName },
      subject: safeOverride
        ? `[TEST → would have gone to: ${intendedRecipients.join(", ")}] ${subject}`
        : subject,
      html,
    };
    let sgResp: Awaited<ReturnType<typeof sgMail.send>> | null = null;
    let sendError: string | null = null;
    try {
      sgResp = await sgMail.send(msg);
    } catch (e: unknown) {
      sendError = e instanceof Error ? e.message : String(e);
    }
    const messageId = sgResp?.[0]?.headers?.["x-message-id"] as
      | string
      | undefined;

    const [logged] = await db
      .insert(emailSendsTable)
      .values({
        clientId: body.clientId,
        businessId: body.businessId ?? null,
        aeoPlanId: body.aeoPlanId ?? null,
        recipients: actualRecipients,
        intendedRecipients: safeOverride ? intendedRecipients : null,
        fromEmail,
        subject: msg.subject,
        status: sendError ? "failed" : "sent",
        sendgridMessageId: messageId ?? null,
        error: sendError,
        kind: "report",
        html,
        meta: { mode },
      })
      .returning({ id: emailSendsTable.id });

    if (sendError) {
      req.log.error({ sendError, sendId: logged.id }, "SendGrid send failed");
      return res.status(502).json({
        error: "Email delivery failed",
        detail: sendError,
        sendId: logged.id,
      });
    }
    return res.json({
      ok: true,
      sendId: logged.id,
      messageId: messageId ?? null,
      recipientsActual: actualRecipients,
      recipientsIntended: intendedRecipients,
      safeModeActive: Boolean(safeOverride),
      keywordsIncluded: new Set(rows.map((r) => r.keywordId)).size,
      rowsIncluded: rows.length,
    });
  } catch (err) {
    req.log.error({ err }, "Error sending rankings report email");
    const detail = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: "Internal server error", detail });
  }
});

/* GET /api/rankings/email-sends?clientId= */
router.get("/email-sends", requireSalesAllowed, async (req, res) => {
  try {
    const clientId = req.query.clientId
      ? Number.parseInt(String(req.query.clientId), 10)
      : null;
    // Scoped roles only ever see sends for clients in their slice: a specific
    // clientId is asserted; an unfiltered list is confined to the eligible set.
    if (clientId != null) {
      if (!(await assertScopedAccessToClient(req, res, clientId))) return;
    }
    const eligibleIds = clientId == null ? await getScopedClientIds(req) : null;
    if (eligibleIds !== null && eligibleIds.length === 0)
      return res.json({ sends: [] });
    const rows = await db
      .select()
      .from(emailSendsTable)
      .where(
        clientId
          ? eq(emailSendsTable.clientId, clientId)
          : eligibleIds !== null
            ? inArray(emailSendsTable.clientId, eligibleIds)
            : sql`true`,
      )
      .orderBy(desc(emailSendsTable.sentAt))
      .limit(20);
    return res.json({ sends: rows });
  } catch (err) {
    req.log.error({ err }, "Error listing email sends");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
