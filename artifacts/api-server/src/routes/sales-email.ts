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
import { chatCompletion } from "../services/llm-client";
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

/* Portal theme: dark navy (#0f172a) + amber-500 (#f59e0b) accent on light
   slate — mirrors the customer portal so the email feels like the product. */
const NAVY = "#0f172a";
const AMBER = "#f59e0b";
const DEFAULT_CTA_URL =
  process.env.PORTAL_PUBLIC_URL ?? "https://d2cad6tmt9gq2h.cloudfront.net";
const DEFAULT_CTA_LABEL = "See Your Live AI Rankings";

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
  offerText?: string;
  ctaLabel?: string;
  ctaUrl?: string;
}

function defaultIntro(a: SalesEmailArgs): string {
  const pLabel = PLATFORM_LABELS[a.platform] ?? a.platform;
  return `Are you showing up in AI Search?

More and more of your customers aren't Googling anymore — they're asking ChatGPT, ${pLabel === "ChatGPT" ? "Gemini" : "ChatGPT"} and Perplexity who to hire. The AI gives them one short list, and the businesses on it win the job. Everyone else vanishes from the conversation.

We went and checked where ${a.business} stands. Here's what the AI actually said.`;
}

function defaultOffer(a: SalesEmailArgs): string {
  const improved = a.beforeRank - a.afterRank;
  return `This is one keyword. Every week we push more of your searches up the AI's list — the result below moved ${improved} spot${improved === 1 ? "" : "s"} and it's still climbing. Your competitors are already fighting for these answers; every week you're not optimizing, someone else takes the spot.`;
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
  const eyebrow = (t: string) =>
    `<div style="font-size:11px;font-weight:800;letter-spacing:2.5px;color:${AMBER};text-transform:uppercase">${t}</div>`;
  const paragraphs = (text: string) =>
    text
      .trim()
      .split(/\n{2,}/)
      .map(
        (p) =>
          `<p style="margin:0 0 14px 0;color:#334155;font-size:14px;line-height:1.65;white-space:pre-wrap">${p.trim()}</p>`,
      )
      .join("");

  const intro = paragraphs(a.introMessage?.trim() || defaultIntro(a));
  const offer = paragraphs(a.offerText?.trim() || defaultOffer(a));
  const ctaLabel = a.ctaLabel?.trim() || DEFAULT_CTA_LABEL;
  const ctaUrl = a.ctaUrl?.trim() || DEFAULT_CTA_URL;

  const shotCell = (
    label: string,
    rank: number,
    date: string | null,
    url: string,
    highlight: boolean,
  ) => `
    <td style="width:50%;padding:8px;vertical-align:top">
      <div style="background:#fff;border:1px solid ${highlight ? AMBER : "#e2e8f0"};border-radius:12px;overflow:hidden${highlight ? `;box-shadow:0 0 0 3px rgba(245,158,11,0.15)` : ""}">
        <div style="padding:12px 8px 10px 8px;text-align:center;background:${highlight ? "#fffbeb" : "#f8fafc"};border-bottom:1px solid ${highlight ? "#fde68a" : "#e2e8f0"}">
          <div style="font-size:10px;font-weight:800;letter-spacing:2px;color:${highlight ? "#b45309" : "#94a3b8"};text-transform:uppercase">${label}</div>
          <div style="font-size:30px;font-weight:800;color:${highlight ? "#b45309" : "#64748b"};line-height:1.2">#${rank}</div>
          <div style="font-size:10px;color:#94a3b8">${date ?? ""}</div>
        </div>
        <img src="${url}" alt="${label} screenshot" width="100%"
             style="width:100%;height:auto;display:block" />
      </div>
    </td>`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:640px;margin:0 auto;padding:24px 12px">
    <div style="background:#f8fafc;border-radius:16px;overflow:hidden;border:1px solid #cbd5e1">

      <!-- Hero -->
      <div style="background:${NAVY};padding:36px 28px 32px 28px;text-align:center">
        ${eyebrow("AI Search · Signal AEO")}
        <h1 style="margin:12px 0 8px 0;color:#fff;font-size:26px;line-height:1.25">Your AI Search Results Are&nbsp;In</h1>
        <p style="margin:0;color:#94a3b8;font-size:14px">${a.business} — here&rsquo;s what the AI is telling your customers · ${today}</p>
      </div>

      <!-- Intro copy -->
      <div style="padding:28px 28px 8px 28px">
        ${intro}
      </div>

      <!-- Proof -->
      <div style="padding:8px 20px 4px 20px">
        <div style="text-align:center;margin-bottom:6px">${eyebrow("What we found")}</div>
        <div style="text-align:center;margin-bottom:14px">
          <div style="font-size:17px;color:${NAVY};font-weight:700;margin:6px 0 8px 0">&ldquo;${a.keyword}&rdquo;</div>
          <span style="display:inline-block;padding:3px 12px;border-radius:12px;background:${pColor};color:#fff;font-size:11px;font-weight:700">${pLabel}</span>
          <div style="margin-top:10px;font-size:20px;font-weight:800;color:#16a34a">&#9650; Up ${improved} spot${improved === 1 ? "" : "s"} &nbsp;·&nbsp; #${a.beforeRank} &rarr; #${a.afterRank}</div>
        </div>
        <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">
          <tr>
            ${shotCell("Before", a.beforeRank, a.beforeDate, a.beforeImageUrl, false)}
            ${shotCell("After", a.afterRank, a.afterDate, a.afterImageUrl, true)}
          </tr>
        </table>
        <p style="margin:10px 0 0 0;color:#94a3b8;font-size:11px;font-style:italic;text-align:center">Real device. Real query. Your business, named by ${pLabel}.</p>
      </div>

      <!-- Offer / CTA -->
      <div style="padding:20px 28px 32px 28px">
        <div style="background:#fff;border-left:4px solid ${AMBER};border-radius:10px;padding:20px 22px;border-top:1px solid #e2e8f0;border-right:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0">
          ${eyebrow("Keep the momentum")}
          <div style="height:10px"></div>
          ${offer}
          <div style="text-align:center;margin-top:18px">
            <a href="${ctaUrl}" style="display:inline-block;background:${AMBER};color:${NAVY};font-size:14px;font-weight:800;padding:13px 34px;border-radius:10px;text-decoration:none">${ctaLabel}</a>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div style="background:${NAVY};padding:20px 28px;text-align:center">
        <p style="margin:0 0 4px 0;color:#94a3b8;font-size:12px;font-weight:700">Signal AEO</p>
        <p style="margin:0;color:#64748b;font-size:11px">Screenshots captured directly from ${pLabel}&rsquo;s live results. You&rsquo;re receiving this because we track AI search rankings for ${a.business}.</p>
      </div>

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

interface SalesEmailCopy {
  introMessage?: string;
  offerText?: string;
  ctaLabel?: string;
  ctaUrl?: string;
}

/** Shared preview/send assembly — one path, so preview === sent. The caller
 *  resolves the improvement data once (it's a heavy query) and passes it in. */
function prepareSalesEmail(
  clientId: number,
  data: ImprovementData,
  strictMode: boolean,
  keywordId: number | null,
  platform: string | null,
  copy: SalesEmailCopy,
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
    ...copy,
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
    const qs = (k: string) => (req.query[k] ? String(req.query[k]) : undefined);
    const copy: SalesEmailCopy = {
      introMessage: qs("introMessage"),
      offerText: qs("offerText"),
      ctaLabel: qs("ctaLabel"),
      ctaUrl: qs("ctaUrl"),
    };

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
      copy,
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
  offerText?: string;
  ctaLabel?: string;
  ctaUrl?: string;
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
      {
        introMessage: body.introMessage,
        offerText: body.offerText,
        ctaLabel: body.ctaLabel,
        ctaUrl: body.ctaUrl,
      },
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

/* POST /api/sales/email-ai-suggest
   Body: { clientId, keywordId?, platform?, instruction? }
   DeepSeek writes the persuasive intro + offer copy from the REAL improvement
   numbers (it is explicitly forbidden from inventing stats). Returns
   { intro, offer } for the two editable text blocks. */
router.post("/email-ai-suggest", requireSalesEmail, async (req, res) => {
  const body = req.body as {
    clientId?: number;
    keywordId?: number | null;
    platform?: string | null;
    instruction?: string;
  };
  if (!body.clientId)
    return res.status(400).json({ error: "clientId required" });
  try {
    if (!(await isClientInSalesScope(req, body.clientId)))
      return res.status(403).json({ error: "Client outside your plan scope" });

    const strictMode = process.env.GHL_SYNC_STRICT === "1";
    const r = await resolveImprovement(
      { clientId: String(body.clientId) },
      { strict: strictMode, positiveTop3: true },
    );
    if (!r.ok) return res.status(409).json({ error: r.reason });
    const selection = pickSelection(
      r.data,
      body.keywordId ?? null,
      body.platform ?? null,
    );
    if (!selection)
      return res.status(409).json({ error: "No improved keyword available." });

    const facts = {
      business: r.data.business,
      keyword: selection.entry.keyword,
      platform: PLATFORM_LABELS[selection.platform] ?? selection.platform,
      before_rank: selection.ranks.first.rank,
      after_rank: selection.ranks.current.rank,
      spots_improved: selection.improved,
      before_date: selection.ranks.first.date,
      after_date: selection.ranks.current.date,
      other_improved_keywords: r.data.keywords.length - 1,
    };

    const systemPrompt = `You write short, punchy, persuasive sales emails for local businesses about their AI-search (AEO) rankings on ChatGPT, Gemini, and Perplexity. Tone: confident, exciting, a little FOMO — the reader should feel they're winning and want more. Think "your customers are asking AI who to hire, and the AI just named YOU".

HARD RULES:
- Use ONLY the numbers provided in the data. NEVER invent statistics, percentages, studies, or analyst quotes.
- Plain text only. No markdown, no HTML, no subject line, no greeting ("Hi X"), no sign-off.
- Output EXACTLY two sections separated by a line containing only "---".
  Section 1 (intro, 2-3 short paragraphs, max 110 words): hook about customers asking AI instead of Google, then tee up the result we found for this business. The email template shows the before/after proof right after this text.
  Section 2 (offer, 1-2 short paragraphs, max 60 words): momentum pitch — this is one keyword, more are climbing, competitors want these spots. End with urgency toward the call-to-action button (do not write the button text).
- If the user gives an instruction, follow it.`;

    const userPrompt = `Real data for this client:

${JSON.stringify(facts, null, 2)}

${body.instruction?.trim() ? `User instruction: ${body.instruction.trim()}\n\n` : ""}Write the two sections now.`;

    const result = await chatCompletion({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.8,
      maxTokens: 500,
    });
    const raw = result.content.trim();
    const [intro, offer] = raw.includes("\n---")
      ? raw.split(/\n-{3,}\n?/, 2).map((s) => s.trim())
      : [raw, ""];
    return res.json({
      intro,
      offer,
      model: result.model,
      costUsd: Number(result.costUsd.toFixed(6)),
      tokens: result.totalTokens,
    });
  } catch (err) {
    req.log.error({ err }, "Error generating sales email AI copy");
    const detail = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: "AI generation failed", detail });
  }
});

export default router;
