import { Router } from "express";
import { db } from "@workspace/db";
import {
  rankingReportsTable,
  clientsTable,
  businessesTable,
  keywordsTable,
  emailSendsTable,
} from "@workspace/db/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import sgMail from "@sendgrid/mail";

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

/* GET /api/rankings/email-recipients/:clientId
   Returns the 3 stored email fields so the FE can pre-fill the picker. */
router.get("/email-recipients/:clientId", async (req, res) => {
  const id = Number.parseInt(req.params.clientId, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: "invalid id" });
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

interface RankRow {
  reportId: number;
  keywordId: number;
  keywordText: string;
  platform: string;
  rank: number | null;
  date: string;
  screenshotUrl: string | null;
}

/* Fetch the latest ranking_reports row per (keyword, platform) for the given
   client (optionally filtered by business or aeo-plan). One row per pair. */
async function getCurrentRankings(filter: {
  clientId: number;
  businessId?: number;
  aeoPlanId?: number;
}): Promise<RankRow[]> {
  const conditions = [eq(rankingReportsTable.clientId, filter.clientId)];
  if (filter.businessId)
    conditions.push(eq(rankingReportsTable.businessId, filter.businessId));

  /* DISTINCT ON (keyword_id, platform) — latest by date desc, id desc. */
  const result = await db.execute(sql`
    SELECT DISTINCT ON (rr.keyword_id, lower(rr.platform))
      rr.id              AS report_id,
      rr.keyword_id      AS keyword_id,
      k.keyword_text     AS keyword_text,
      lower(rr.platform) AS platform,
      rr.ranking_position AS rank,
      rr.date            AS date,
      rr.screenshot_url  AS screenshot_url
    FROM ranking_reports rr
    LEFT JOIN keywords k ON k.id = rr.keyword_id
    WHERE rr.client_id = ${filter.clientId}
      ${filter.businessId ? sql`AND rr.business_id = ${filter.businessId}` : sql``}
    ORDER BY rr.keyword_id, lower(rr.platform), rr.date DESC, rr.id DESC
  `);

  return (result.rows as Array<Record<string, unknown>>).map((r) => ({
    reportId: Number(r.report_id),
    keywordId: Number(r.keyword_id),
    keywordText: String(r.keyword_text ?? ""),
    platform: String(r.platform),
    rank: r.rank == null ? null : Number(r.rank),
    date: String(r.date),
    screenshotUrl: r.screenshot_url == null ? null : String(r.screenshot_url),
  }));
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

function rankPill(rank: number | null): string {
  if (rank == null) return `<span style="color:#94a3b8">—</span>`;
  return `<strong>#${rank}</strong>`;
}

interface BuildEmailArgs {
  clientName: string;
  rows: Array<RankRow & { imageUrl: string | null }>;
  customMessage?: string;
}

function buildEmailHtml({
  clientName,
  rows,
  customMessage,
}: BuildEmailArgs): string {
  /* Group rows by keyword for the table. */
  const byKeyword = new Map<number, { text: string; platforms: typeof rows }>();
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

  const keywordSections = [...byKeyword.values()]
    .map((kw) => {
      const platRows = kw.platforms
        .sort((a, b) => a.platform.localeCompare(b.platform))
        .map((p) => {
          const img = p.imageUrl
            ? `<a href="${p.imageUrl}" style="display:inline-block">
               <img src="${p.imageUrl}" alt="screenshot" width="200"
                    style="max-width:200px;height:auto;border:1px solid #e5e7eb;border-radius:6px;display:block" />
             </a>
             <div style="margin-top:4px;font-size:11px"><a href="${p.imageUrl}" style="color:#475569">View full size</a></div>`
            : `<span style="color:#94a3b8;font-size:12px">no screenshot</span>`;
          return `
          <tr>
            <td style="padding:12px;border-bottom:1px solid #f1f5f9;vertical-align:top">
              <span style="display:inline-block;padding:3px 10px;border-radius:12px;background:${platformColor(p.platform)};color:#fff;font-size:11px;font-weight:600">${platformLabel(p.platform)}</span>
            </td>
            <td style="padding:12px;border-bottom:1px solid #f1f5f9;vertical-align:top;font-size:18px">${rankPill(p.rank)}</td>
            <td style="padding:12px;border-bottom:1px solid #f1f5f9;vertical-align:top;font-size:12px;color:#64748b">${p.date}</td>
            <td style="padding:12px;border-bottom:1px solid #f1f5f9;vertical-align:top">${img}</td>
          </tr>`;
        })
        .join("");
      return `
      <div style="margin:24px 0">
        <h3 style="margin:0 0 8px 0;color:#0f172a;font-size:16px">${kw.text}</h3>
        <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
          <thead>
            <tr style="background:#f8fafc">
              <th style="padding:10px 12px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px">Platform</th>
              <th style="padding:10px 12px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px">Current Rank</th>
              <th style="padding:10px 12px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px">Audited</th>
              <th style="padding:10px 12px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px">Screenshot</th>
            </tr>
          </thead>
          <tbody>${platRows}</tbody>
        </table>
      </div>`;
    })
    .join("");

  const customBlock = customMessage?.trim()
    ? `<div style="margin:16px 0;padding:16px;background:#f8fafc;border-left:3px solid #6366f1;border-radius:4px;color:#334155;font-size:14px;white-space:pre-wrap">${customMessage}</div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:680px;margin:0 auto;padding:32px 16px">
    <div style="background:#fff;border-radius:12px;padding:28px;border:1px solid #e5e7eb">
      <h1 style="margin:0 0 4px 0;color:#0f172a;font-size:22px">AEO Rankings Report</h1>
      <p style="margin:0 0 16px 0;color:#64748b;font-size:14px">${clientName} · ${today}</p>
      ${customBlock}
      ${keywordSections || `<p style="color:#94a3b8">No keyword data for this period.</p>`}
      <p style="margin:28px 0 0 0;color:#94a3b8;font-size:11px;text-align:center">
        Screenshot links expire in 7 days. Reply to this email for help.
      </p>
    </div>
  </div>
</body>
</html>`;
}

interface SendReportBody {
  clientId: number;
  businessId?: number;
  aeoPlanId?: number;
  recipients: string[];
  subject?: string;
  customMessage?: string;
}

/* POST /api/rankings/send-report */
router.post("/send-report", async (req, res) => {
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
    if (!fromEmail)
      return res.status(500).json({ error: "SENDGRID_FROM_EMAIL not set" });

    const clientRow = await db
      .select({ businessName: clientsTable.businessName })
      .from(clientsTable)
      .where(eq(clientsTable.id, body.clientId))
      .limit(1);
    if (clientRow.length === 0)
      return res.status(404).json({ error: "client not found" });
    const clientName = clientRow[0].businessName ?? `Client ${body.clientId}`;

    const rankings = await getCurrentRankings({
      clientId: body.clientId,
      businessId: body.businessId,
      aeoPlanId: body.aeoPlanId,
    });

    /* Sign all S3 URLs (parallel; 7-day TTL). */
    const rowsWithImages = await Promise.all(
      rankings.map(async (r) => ({
        ...r,
        imageUrl: await maybeSignS3(r.screenshotUrl),
      })),
    );

    const html = buildEmailHtml({
      clientName,
      rows: rowsWithImages,
      customMessage: body.customMessage,
    });
    const subject =
      body.subject?.trim() ||
      `AEO Rankings Report — ${clientName} (${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })})`;

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
      keywordsIncluded: new Set(rowsWithImages.map((r) => r.keywordId)).size,
      rowsIncluded: rowsWithImages.length,
    });
  } catch (err) {
    req.log.error({ err }, "Error sending rankings report email");
    const detail = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: "Internal server error", detail });
  }
});

/* GET /api/rankings/email-preview?clientId=&businessId=
   Returns the HTML body so the FE can show a preview before sending. */
router.get("/email-preview", async (req, res) => {
  const clientId = Number.parseInt(String(req.query.clientId ?? ""), 10);
  if (Number.isNaN(clientId))
    return res.status(400).json({ error: "clientId required" });
  try {
    const businessId = req.query.businessId
      ? Number.parseInt(String(req.query.businessId), 10)
      : undefined;
    const aeoPlanId = req.query.aeoPlanId
      ? Number.parseInt(String(req.query.aeoPlanId), 10)
      : undefined;
    const clientRow = await db
      .select({ businessName: clientsTable.businessName })
      .from(clientsTable)
      .where(eq(clientsTable.id, clientId))
      .limit(1);
    if (clientRow.length === 0)
      return res.status(404).json({ error: "client not found" });
    const clientName = clientRow[0].businessName ?? `Client ${clientId}`;

    const rankings = await getCurrentRankings({
      clientId,
      businessId,
      aeoPlanId,
    });
    const rowsWithImages = await Promise.all(
      rankings.map(async (r) => ({
        ...r,
        imageUrl: await maybeSignS3(r.screenshotUrl),
      })),
    );

    const html = buildEmailHtml({
      clientName,
      rows: rowsWithImages,
      customMessage: req.query.customMessage
        ? String(req.query.customMessage)
        : undefined,
    });
    return res.json({
      html,
      clientName,
      keywordCount: new Set(rowsWithImages.map((r) => r.keywordId)).size,
      rowCount: rowsWithImages.length,
      withScreenshotCount: rowsWithImages.filter((r) => r.imageUrl).length,
    });
  } catch (err) {
    req.log.error({ err }, "Error building email preview");
    return res.status(500).json({ error: "Internal server error" });
  }
});

/* GET /api/rankings/email-templates?clientId=&businessId=
   Returns ready-to-use message templates with variables (client_name, date,
   keyword_count, screenshot_count, top_keyword) interpolated from real data.
   Frontend renders the resulting bodies in a picker; user can pick one and
   then edit further before sending. */
router.get("/email-templates", async (req, res) => {
  const clientId = Number.parseInt(String(req.query.clientId ?? ""), 10);
  if (Number.isNaN(clientId))
    return res.status(400).json({ error: "clientId required" });
  try {
    const businessId = req.query.businessId
      ? Number.parseInt(String(req.query.businessId), 10)
      : undefined;
    const clientRow = await db
      .select({ businessName: clientsTable.businessName })
      .from(clientsTable)
      .where(eq(clientsTable.id, clientId))
      .limit(1);
    if (clientRow.length === 0)
      return res.status(404).json({ error: "client not found" });
    const clientName = clientRow[0].businessName ?? `Client ${clientId}`;

    const rankings = await getCurrentRankings({ clientId, businessId });
    const keywordIds = new Set(rankings.map((r) => r.keywordId));
    const withScreenshot = rankings.filter((r) =>
      r.screenshotUrl?.startsWith("s3://"),
    ).length;
    /* Best current rank wins; fall back alphabetically. */
    const topRanked = [...rankings]
      .filter((r) => r.rank != null)
      .sort(
        (a, b) =>
          a.rank! - b.rank! || a.keywordText.localeCompare(b.keywordText),
      )[0];

    const todayET = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "America/New_York",
    });

    const vars = {
      client_name: clientName,
      date: todayET,
      keyword_count: keywordIds.size,
      row_count: rankings.length,
      screenshot_count: withScreenshot,
      top_keyword: topRanked?.keywordText ?? "your keywords",
      top_rank: topRanked?.rank ?? null,
    };

    const interpolate = (s: string): string =>
      s.replace(/\{(\w+)\}/g, (_, k) =>
        String(vars[k as keyof typeof vars] ?? ""),
      );

    const rawTemplates: Array<{ id: string; name: string; body: string }> = [
      {
        id: "monthly",
        name: "Monthly update",
        body: `Hi {client_name},

Here's your latest AEO rankings report as of {date}. We're tracking {keyword_count} keywords across ChatGPT, Gemini, and Perplexity, and we've captured {screenshot_count} new audit screenshots since the last report.

Click any screenshot in the table below to see exactly how your business appeared in the AI search results.

Questions? Just reply to this email.`,
      },
      {
        id: "highlight",
        name: "Highlight a top result",
        body: `Hi {client_name},

Great news — "{top_keyword}" is currently ranking #{top_rank} across the AI platforms we track. Below is your full rankings snapshot as of {date} with screenshots for every audit.

Let us know if you'd like to discuss strategy on any of the keywords below.`,
      },
      {
        id: "checkin",
        name: "Quick check-in",
        body: `Hi {client_name},

Your AEO rankings report for {date} is attached. {keyword_count} keywords tracked, {screenshot_count} audit screenshots captured.

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

/* GET /api/rankings/email-sends?clientId=
   Last 20 send attempts for an audit panel. */
router.get("/email-sends", async (req, res) => {
  try {
    const clientId = req.query.clientId
      ? Number.parseInt(String(req.query.clientId), 10)
      : null;
    const rows = await db
      .select()
      .from(emailSendsTable)
      .where(clientId ? eq(emailSendsTable.clientId, clientId) : sql`true`)
      .orderBy(desc(emailSendsTable.sentAt))
      .limit(20);
    return res.json({ sends: rows });
  } catch (err) {
    req.log.error({ err }, "Error listing email sends");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
