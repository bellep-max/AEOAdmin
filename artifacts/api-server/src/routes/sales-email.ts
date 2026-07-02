/*
 * Sales email — "send the client their before/after ranking proof".
 *
 *   GET  /api/sales/email-preview  → exact HTML that would be sent + the
 *                                    keyword/platform options for the picker
 *   POST /api/sales/send-email     → sends it via SendGrid, logs to email_sends
 *
 * Session-gated (sales / admin / owner) counterpart to the machine-token
 * routes in sales.ts. Reuses the SAME improvement-pair resolution the GHL CRM
 * sync uses (strict per GHL_SYNC_STRICT + positive-summary guard on top-3), so
 * the email can never show weaker proof than the CRM. Preview and send share
 * one HTML builder, so what the sales person previews is what the client gets.
 *
 * Images are embedded as the permanent /api/sales/screenshot streaming links
 * (pinned by clientId) — presigned S3 URLs expire, sales emails don't.
 */
import { Router, type Request } from "express";
import { db } from "@workspace/db";
import { clientAeoPlansTable, emailSendsTable } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import sgMail from "@sendgrid/mail";
import { requireRoles, getSalesPlanFilter } from "../middlewares/role-auth";
import {
  resolveImprovement,
  buildScreenshotUrlByClient,
  s3Exists,
  PLATFORM_LABELS,
  type ImprovementData,
  type KeywordEntry,
  type PlatformRanks,
} from "./sales";

const router = Router();
const requireSalesEmail = requireRoles("sales", "admin", "owner");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PLATFORM_ORDER = ["chatgpt", "gemini", "perplexity"];

let sgConfigured = false;
function configureSendGrid(): void {
  if (sgConfigured) return;
  const key = process.env.SENDGRID_API_KEY;
  if (!key) throw new Error("SENDGRID_API_KEY not set");
  sgMail.setApiKey(key);
  sgConfigured = true;
}

function platformColor(p: string): string {
  if (p === "chatgpt") return "#10a37f";
  if (p === "gemini") return "#4285f4";
  if (p === "perplexity") return "#7c3aed";
  return "#64748b";
}

/** Sales sessions are plan-scoped (Free Trial Plans) — a sales user may only
 *  email clients inside that slice. Other roles pass unconditionally. */
async function isClientInSalesScope(
  req: Request,
  clientId: number,
): Promise<boolean> {
  const planType = getSalesPlanFilter(req);
  if (!planType) return true;
  const rows = await db
    .select({ id: clientAeoPlansTable.id })
    .from(clientAeoPlansTable)
    .where(
      and(
        eq(clientAeoPlansTable.clientId, clientId),
        eq(clientAeoPlansTable.planType, planType),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

interface Selection {
  entry: KeywordEntry;
  platform: string;
  ranks: PlatformRanks;
  improved: number;
}

/** Keyword defaults to the strongest improvement (list is pre-sorted);
 *  platform defaults to that keyword's biggest improvement. */
function pickSelection(
  data: ImprovementData,
  keywordId: number | null,
  platform: string | null,
): Selection | null {
  const entry =
    (keywordId != null
      ? data.keywords.find((k) => k.keywordId === keywordId)
      : null) ?? data.keywords[0];
  if (!entry) return null;
  const available = PLATFORM_ORDER.filter((p) => entry.platforms[p]);
  if (available.length === 0) return null;
  const chosen =
    platform && entry.platforms[platform]
      ? platform
      : available.reduce((a, b) => {
          const imp = (p: string) =>
            entry.platforms[p].first.rank - entry.platforms[p].current.rank;
          return imp(b) > imp(a) ? b : a;
        });
  const ranks = entry.platforms[chosen];
  return {
    entry,
    platform: chosen,
    ranks,
    improved: ranks.first.rank - ranks.current.rank,
  };
}

interface SalesEmailArgs {
  business: string;
  keyword: string;
  platform: string;
  beforeRank: number;
  afterRank: number;
  beforeDate: string | null;
  afterDate: string | null;
  beforeImageUrl: string;
  afterImageUrl: string;
  introMessage?: string;
}

function buildSalesEmailHtml(a: SalesEmailArgs): string {
  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "America/New_York",
  });
  const improved = a.beforeRank - a.afterRank;
  const pLabel = PLATFORM_LABELS[a.platform] ?? a.platform;
  const pColor = platformColor(a.platform);

  const introBlock = a.introMessage?.trim()
    ? `<div style="margin:16px 0;padding:16px;background:#f8fafc;border-left:3px solid #6366f1;border-radius:4px;color:#334155;font-size:14px;white-space:pre-wrap">${a.introMessage}</div>`
    : "";

  const shotCell = (
    label: string,
    rank: number,
    date: string | null,
    url: string,
    highlight: boolean,
  ) => `
    <td style="width:50%;padding:10px;vertical-align:top">
      <div style="text-align:center;margin-bottom:8px">
        <div style="font-size:11px;font-weight:700;letter-spacing:1px;color:${highlight ? "#16a34a" : "#94a3b8"};text-transform:uppercase">${label}</div>
        <div style="font-size:26px;font-weight:800;color:${highlight ? "#16a34a" : "#475569"}">#${rank}</div>
        <div style="font-size:11px;color:#94a3b8">${date ?? ""}</div>
      </div>
      <img src="${url}" alt="${label} screenshot" width="100%"
           style="width:100%;height:auto;border:1px solid ${highlight ? "#bbf7d0" : "#e5e7eb"};border-radius:8px;display:block" />
    </td>`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:680px;margin:0 auto;padding:32px 16px">
    <div style="background:#fff;border-radius:12px;padding:28px;border:1px solid #e5e7eb">
      <h1 style="margin:0 0 4px 0;color:#0f172a;font-size:22px">Your AI Search Ranking Is Climbing</h1>
      <p style="margin:0 0 4px 0;color:#64748b;font-size:14px">${a.business} · ${today}</p>
      ${introBlock}
      <div style="margin:20px 0;padding:14px 16px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;text-align:center">
        <div style="font-size:15px;color:#0f172a;font-weight:600;margin-bottom:6px">&ldquo;${a.keyword}&rdquo;</div>
        <span style="display:inline-block;padding:3px 10px;border-radius:12px;background:${pColor};color:#fff;font-size:11px;font-weight:600">${pLabel}</span>
        <div style="margin-top:8px;font-size:18px;font-weight:800;color:#16a34a">&#9650; Up ${improved} spot${improved === 1 ? "" : "s"} &nbsp;·&nbsp; #${a.beforeRank} &rarr; #${a.afterRank}</div>
      </div>
      <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">
        <tr>
          ${shotCell("Before", a.beforeRank, a.beforeDate, a.beforeImageUrl, false)}
          ${shotCell("After", a.afterRank, a.afterDate, a.afterImageUrl, true)}
        </tr>
      </table>
      <p style="margin:28px 0 0 0;color:#94a3b8;font-size:11px;text-align:center">Screenshots captured directly from ${pLabel}&rsquo;s live results.</p>
    </div>
  </div>
</body>
</html>`;
}

interface PreparedEmail {
  html: string;
  business: string;
  clientName: string;
  selection: Selection;
  strictMode: boolean;
}

/** Shared preview/send assembly — one path, so preview === sent. The caller
 *  resolves the improvement data once (it's a heavy query) and passes it in. */
function prepareSalesEmail(
  clientId: number,
  data: ImprovementData,
  strictMode: boolean,
  keywordId: number | null,
  platform: string | null,
  introMessage: string | undefined,
): { ok: true; prep: PreparedEmail } | { ok: false; reason: string } {
  const selection = pickSelection(data, keywordId, platform);
  if (!selection)
    return {
      ok: false,
      reason: "No improved keyword available for this client.",
    };
  const kwText = selection.entry.keyword ?? "";
  const imgUrl = (which: "first" | "current") =>
    buildScreenshotUrlByClient(clientId, kwText, selection.platform, which, {
      strict: strictMode,
    });
  const html = buildSalesEmailHtml({
    business: data.business,
    keyword: kwText,
    platform: selection.platform,
    beforeRank: selection.ranks.first.rank,
    afterRank: selection.ranks.current.rank,
    beforeDate: selection.ranks.first.date,
    afterDate: selection.ranks.current.date,
    beforeImageUrl: imgUrl("first"),
    afterImageUrl: imgUrl("current"),
    introMessage,
  });
  return {
    ok: true,
    prep: {
      html,
      business: data.business,
      clientName: data.client.name,
      selection,
      strictMode,
    },
  };
}

/* Keyword/platform options for the FE picker, strongest improvement first. */
function keywordOptions(data: ImprovementData) {
  return data.keywords.map((k) => ({
    keywordId: k.keywordId,
    keyword: k.keyword,
    maxImproved: k.maxImproved,
    platforms: PLATFORM_ORDER.filter((p) => k.platforms[p]).map((p) => ({
      platform: p,
      beforeRank: k.platforms[p].first.rank,
      afterRank: k.platforms[p].current.rank,
      beforeDate: k.platforms[p].first.date,
      afterDate: k.platforms[p].current.date,
      improved: k.platforms[p].first.rank - k.platforms[p].current.rank,
    })),
  }));
}

/* GET /api/sales/email-preview?clientId=&keywordId?=&platform?=&introMessage?= */
router.get("/email-preview", requireSalesEmail, async (req, res) => {
  const clientId = Number.parseInt(String(req.query.clientId ?? ""), 10);
  if (Number.isNaN(clientId))
    return res.status(400).json({ error: "clientId required" });
  try {
    if (!(await isClientInSalesScope(req, clientId)))
      return res.status(403).json({ error: "Client outside your plan scope" });

    const keywordId = req.query.keywordId
      ? Number.parseInt(String(req.query.keywordId), 10)
      : null;
    const platform = req.query.platform ? String(req.query.platform) : null;
    const introMessage = req.query.introMessage
      ? String(req.query.introMessage)
      : undefined;

    const strictMode = process.env.GHL_SYNC_STRICT === "1";
    const r = await resolveImprovement(
      { clientId: String(clientId) },
      { strict: strictMode, positiveTop3: true },
    );
    /* No-improvement is a valid preview state, not an error — the FE shows an
       empty state and disables Send. */
    if (!r.ok)
      return res.json({
        hasImprovement: false,
        reason: r.reason,
        html: null,
        selected: null,
        keywords: [],
        strictMode,
      });

    const prepared = prepareSalesEmail(
      clientId,
      r.data,
      strictMode,
      keywordId != null && Number.isNaN(keywordId) ? null : keywordId,
      platform,
      introMessage,
    );
    if (!prepared.ok)
      return res.json({
        hasImprovement: false,
        reason: prepared.reason,
        html: null,
        selected: null,
        keywords: keywordOptions(r.data),
        strictMode,
      });

    const sel = prepared.prep.selection;
    return res.json({
      hasImprovement: true,
      html: prepared.prep.html,
      business: prepared.prep.business,
      clientName: prepared.prep.clientName,
      selected: {
        keywordId: sel.entry.keywordId,
        keyword: sel.entry.keyword,
        platform: sel.platform,
        beforeRank: sel.ranks.first.rank,
        afterRank: sel.ranks.current.rank,
        improved: sel.improved,
      },
      keywords: keywordOptions(r.data),
      strictMode,
    });
  } catch (err) {
    req.log.error({ err }, "Error building sales email preview");
    return res.status(500).json({ error: "Internal server error" });
  }
});

interface SendSalesEmailBody {
  clientId: number;
  keywordId?: number | null;
  platform?: string | null;
  recipients: string[];
  subject?: string;
  introMessage?: string;
}

/* POST /api/sales/send-email */
router.post("/send-email", requireSalesEmail, async (req, res) => {
  const body = req.body as Partial<SendSalesEmailBody>;
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
    if (!(await isClientInSalesScope(req, body.clientId)))
      return res.status(403).json({ error: "Client outside your plan scope" });

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

    const strictMode = process.env.GHL_SYNC_STRICT === "1";
    const r = await resolveImprovement(
      { clientId: String(body.clientId) },
      { strict: strictMode, positiveTop3: true },
    );
    if (!r.ok) return res.status(409).json({ error: r.reason });
    const prepared = prepareSalesEmail(
      body.clientId,
      r.data,
      strictMode,
      body.keywordId ?? null,
      body.platform ?? null,
      body.introMessage,
    );
    if (!prepared.ok) return res.status(409).json({ error: prepared.reason });
    const { html, business, selection } = prepared.prep;

    /* A broken <img> in a sales email is worse than no email — verify both
       S3 objects exist before sending (the GHL sync does the same). */
    const [beforeOk, afterOk] = await Promise.all([
      s3Exists(selection.ranks.first.s3Uri),
      s3Exists(selection.ranks.current.s3Uri),
    ]);
    if (!beforeOk || !afterOk)
      return res.status(409).json({
        error: "A screenshot for this keyword is missing from storage.",
      });

    const intendedRecipients = body.recipients
      .map((s) => String(s).trim())
      .filter((s) => EMAIL_RE.test(s));
    if (intendedRecipients.length === 0) {
      return res.status(400).json({ error: "no valid recipient addresses" });
    }
    const safeOverride = process.env.SAFE_RECIPIENT_OVERRIDE;
    const actualRecipients = safeOverride ? [safeOverride] : intendedRecipients;

    const pLabel = PLATFORM_LABELS[selection.platform] ?? selection.platform;
    const subject =
      body.subject?.trim() ||
      `Your AI search ranking is climbing — ${business} (#${selection.ranks.first.rank} → #${selection.ranks.current.rank} on ${pLabel})`;

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
      req.log.error(
        { sendError, sendId: logged.id },
        "SendGrid sales email failed",
      );
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
      keyword: selection.entry.keyword,
      platform: selection.platform,
      beforeRank: selection.ranks.first.rank,
      afterRank: selection.ranks.current.rank,
    });
  } catch (err) {
    req.log.error({ err }, "Error sending sales email");
    const detail = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: "Internal server error", detail });
  }
});

export default router;
