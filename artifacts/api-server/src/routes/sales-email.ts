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
import {
  clientsTable,
  clientAeoPlansTable,
  keywordsTable,
  emailSendsTable,
  emailEventsTable,
} from "@workspace/db/schema";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import sgMail from "@sendgrid/mail";
import { chatCompletion } from "../services/llm-client";
import { requireRoles } from "../middlewares/role-auth";
import { getScopedClientIds } from "../lib/scoped-access";
import { refreshGhlSendStatuses } from "../services/email-status-ghl";
import {
  resolveImprovement,
  presign,
  buildScreenshotUrlByClient,
  ghlFindContactIdByEmail,
  ghlCreateNote,
  ghlSendEmail,
  s3Exists,
  PLATFORM_LABELS,
  type ImprovementData,
  type KeywordEntry,
  type PlatformRanks,
} from "./sales";

const router = Router();
const requireSalesEmail = requireRoles(
  "sales",
  "chuckslocal",
  "admin",
  "owner",
);
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

/** Scoped roles (sales → free-trial, account-manager → non-free-trial,
 *  chuckslocal → the two Signal local plans) may only email clients inside
 *  their slice. Unscoped roles (admin / owner) pass unconditionally. */
async function isClientInSalesScope(
  req: Request,
  clientId: number,
): Promise<boolean> {
  const eligible = await getScopedClientIds(req);
  if (eligible === null) return true;
  return eligible.includes(clientId);
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
  opts?: { avoidKeywordIds?: Set<number> },
): Selection | null {
  // For an "update" email the auto-pick prefers a keyword not yet emailed, so
  // the second email features a fresh keyword. Fall back to the full list when
  // every keyword has already been sent.
  const avoid = opts?.avoidKeywordIds;
  const autoPool =
    keywordId == null && avoid && avoid.size > 0
      ? data.keywords.filter((k) => !avoid.has(k.keywordId)).length > 0
        ? data.keywords.filter((k) => !avoid.has(k.keywordId))
        : data.keywords
      : data.keywords;
  const entry =
    (keywordId != null
      ? data.keywords.find((k) => k.keywordId === keywordId)
      : null) ?? autoPool[0];
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
// CTA now points at Chuck's Calendly (was the client portal).
const DEFAULT_CTA_URL =
  process.env.SALES_CTA_URL ??
  "https://calendly.com/contact-seolocal/ai-ranking";
const DEFAULT_CTA_LABEL = process.env.SALES_CTA_LABEL ?? "Pick a Time";
const SENDER_NAME = process.env.SALES_SENDER_NAME ?? "Chuck";
const SENDER_ORG = process.env.SALES_SENDER_ORG ?? "SEO Local";
// From address for GHL-delivered sales emails. Unset → GHL uses the sub-account's
// default LC Email sender (e.g. mail@seolocal.us). Set GHL_EMAIL_FROM (address, or
// "Name <address>") to control the From without a redeploy — the address must be an
// authorized sender on the GHL sub-account's verified sending domain.
const GHL_EMAIL_FROM = process.env.GHL_EMAIL_FROM?.trim() || undefined;

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
  firstName?: string | null;
  introMessage?: string;
  offerText?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  /* Which copy template drives the hero headline + default intro/offer/CTA.
     Defaults to the original "first proof" email. */
  template?: SalesTemplateKey;
}

function defaultIntro(a: SalesEmailArgs): string {
  const hi = a.firstName?.trim() ? `Hi ${a.firstName.trim()},` : "Hi there,";
  return `${hi}

We built new technology to get local businesses named in AI searches, and we turned it on for your business. ${a.business} is already improving in the search results. The proof is in the screenshots.

When someone asks ChatGPT, Gemini, and Perplexity "${a.keyword}", ${a.business} is NOW the answer.`;
}

function defaultOffer(_a: SalesEmailArgs): string {
  return `With this, you are first to market. Your business is showing up in AI search results before your competitors know this channel exists.

We'll continue to run for the next few weeks, but we'd love to tell you more. Schedule a time with our team to learn more about AI Search and to lock in your presence in the search results.`;
}

/* Second email in the sequence: a NEW keyword landed (proof they've now seen it
   work twice) + the Founder's Discount offer with free-trial urgency. Same
   layout as the first proof — only the copy, hero, subject, and CTA change. */
function secondKeywordIntro(a: SalesEmailArgs): string {
  const hi = a.firstName?.trim() ? `Hi ${a.firstName.trim()},` : "Hi there,";
  return `${hi}

Another keyword just came in for ${a.business}.

When someone asks ChatGPT, Gemini, and Perplexity "${a.keyword}", your business is showing up in AI search.`;
}

function secondKeywordOffer(_a: SalesEmailArgs): string {
  return `Here is what this means for you.

We have been running a limited free trial to prove our technology works. You have now seen it work. We use patent-pending device farm technology to get local businesses named in AI search before their competitors know this channel exists.

The free trial ends soon. When it does, this becomes a paid service. The Founder's Discount is $100 off your monthly plan, locked in for as long as you stay active. It is reserved for clients who have already seen the results firsthand, and it goes away when the free trial closes.

Schedule a call to claim it before this window closes.`;
}

export type SalesTemplateKey = "first_proof" | "second_keyword";

interface SalesTemplate {
  key: SalesTemplateKey;
  label: string;
  heroHeadline: string;
  defaultSubject: string;
  defaultCtaLabel: string;
  buildIntro: (a: SalesEmailArgs) => string;
  buildOffer: (a: SalesEmailArgs) => string;
  /* When true, the "auto" keyword pick skips keywords already emailed to this
     client so an "update" email naturally features a fresh keyword. */
  preferUnsent: boolean;
}

const SALES_TEMPLATES: Record<SalesTemplateKey, SalesTemplate> = {
  first_proof: {
    key: "first_proof",
    label: "First proof — your first AI ranking is in",
    heroHeadline: "Your first AI ranking is in.",
    defaultSubject: "Your first AI ranking is in",
    defaultCtaLabel: DEFAULT_CTA_LABEL,
    buildIntro: defaultIntro,
    buildOffer: defaultOffer,
    preferUnsent: false,
  },
  second_keyword: {
    key: "second_keyword",
    label: "Update — another keyword + Founder's Discount",
    heroHeadline: "Another keyword just showed up in AI Search.",
    defaultSubject: "Another keyword just showed up in AI Search.",
    defaultCtaLabel: "Claim Your Founder's Discount",
    buildIntro: secondKeywordIntro,
    buildOffer: secondKeywordOffer,
    preferUnsent: true,
  },
};

function resolveTemplate(key: string | null | undefined): SalesTemplate {
  return (
    (key && SALES_TEMPLATES[key as SalesTemplateKey]) ||
    SALES_TEMPLATES.first_proof
  );
}

export function buildSalesEmailHtml(a: SalesEmailArgs): string {
  const improved = a.beforeRank - a.afterRank;
  const pLabel = PLATFORM_LABELS[a.platform] ?? a.platform;
  const pColor = platformColor(a.platform);
  const kicker = (t: string, color = AMBER) =>
    `<table cellpadding="0" cellspacing="0" style="margin:0 auto;border-collapse:collapse"><tr>
       <td style="width:26px;border-top:1px solid ${color};opacity:0.6"></td>
       <td style="padding:0 10px;font-size:11px;font-weight:800;letter-spacing:3px;color:${color};text-transform:uppercase;white-space:nowrap">${t}</td>
       <td style="width:26px;border-top:1px solid ${color};opacity:0.6"></td>
     </tr></table>`;
  // Bold-highlight the keyword (and business) wherever they appear in the copy,
  // custom or default. Longest term first so a business containing the keyword
  // doesn't get double-wrapped.
  const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const kwTerm = (a.keyword || "").trim();
  const highlight = (text: string) =>
    kwTerm.length >= 2
      ? text.replace(
          new RegExp(escRe(kwTerm), "gi"),
          (m) => `<strong style="color:#b45309;font-weight:700">${m}</strong>`,
        )
      : text;
  const paragraphs = (text: string, color = "#334155") =>
    highlight(text)
      .trim()
      .split(/\n{2,}/)
      .map(
        (p) =>
          `<p style="margin:0 0 14px 0;color:${color};font-size:14px;line-height:1.7;white-space:pre-wrap">${p.trim()}</p>`,
      )
      .join("");

  const tpl = resolveTemplate(a.template);
  const intro = paragraphs(a.introMessage?.trim() || tpl.buildIntro(a));
  const offer = paragraphs(a.offerText?.trim() || tpl.buildOffer(a));
  const ctaLabel = a.ctaLabel?.trim() || tpl.defaultCtaLabel;
  const ctaUrl = a.ctaUrl?.trim() || DEFAULT_CTA_URL;

  const shot = (
    label: string,
    rank: number,
    url: string,
    highlight: boolean,
  ) => `
    <div style="background:#fff;border:1px solid ${highlight ? "#fbbf24" : "#e2e8f0"};border-radius:14px;overflow:hidden${highlight ? ";box-shadow:0 8px 24px rgba(245,158,11,0.25)" : ";box-shadow:0 2px 8px rgba(15,23,42,0.06)"}">
      <div style="text-align:center;padding:8px 8px 7px 8px;background:${highlight ? `linear-gradient(135deg,#fbbf24,${AMBER})` : "#f1f5f9"}${highlight ? `;background-color:${AMBER}` : ""}">
        <div style="font-size:9px;font-weight:800;letter-spacing:2px;color:${highlight ? NAVY : "#94a3b8"};text-transform:uppercase;line-height:1.3">${label}</div>
        <div style="font-size:34px;font-weight:800;color:${highlight ? NAVY : "#64748b"};line-height:1.15">#${rank}</div>
      </div>
      <img src="${url}" alt="${label} screenshot" width="100%" style="width:100%;height:auto;display:block" />
    </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:660px;margin:0 auto;padding:0 0 20px 0">

    <!-- Hero (extra bottom padding: the scorecard overlaps onto it) -->
    <div style="background:linear-gradient(150deg,#0b1120 0%,#1e293b 100%);background-color:${NAVY};padding:22px 28px 56px 28px;text-align:center">
      ${kicker(`${SENDER_ORG} · AI Ranking`)}
      <h1 style="margin:10px 0 6px 0;color:#fff;font-size:26px;line-height:1.2;letter-spacing:-0.5px">${tpl.heroHeadline}</h1>
      <p style="margin:0;color:#94a3b8;font-size:13px">${a.business}</p>
    </div>

    <!-- Overlapping scorecard -->
    <div style="background:#f8fafc;border-radius:0 0 18px 18px;border:1px solid #cbd5e1;border-top:0">
      <div style="margin:-42px 24px 0 24px;background:#fff;border:1px solid #e2e8f0;border-radius:16px;box-shadow:0 12px 32px rgba(15,23,42,0.18);padding:16px 20px;text-align:center">
        <div style="font-size:15px;color:${NAVY};font-weight:700;margin-bottom:6px">&ldquo;${a.keyword}&rdquo;</div>
        <span style="display:inline-block;padding:3px 12px;border-radius:14px;background:${pColor};color:#fff;font-size:11px;font-weight:700">${pLabel}</span>
        <div style="margin-top:8px;font-size:28px;font-weight:800;color:#b45309;line-height:1.1">&#9650; ${improved} spot${improved === 1 ? "" : "s"}</div>
        <div style="margin-top:5px;font-size:13px;font-weight:600;color:#64748b">#${a.beforeRank} &rarr; <span style="color:#b45309">#${a.afterRank}</span></div>
      </div>

      <!-- Intro copy -->
      <div style="padding:26px 30px 6px 30px">
        ${intro}
      </div>

      <!-- Proof: before vs after -->
      <div style="padding:10px 20px 0 20px">
        ${kicker("The proof")}
        <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-top:14px">
          <tr>
            <td style="width:47%;vertical-align:top">${shot("Before", a.beforeRank, a.beforeImageUrl, false)}</td>
            <td style="width:6%;text-align:center;vertical-align:middle">
              <div style="display:inline-block;width:30px;height:30px;line-height:30px;border-radius:15px;background:${NAVY};color:${AMBER};font-size:15px;font-weight:800">&rarr;</div>
            </td>
            <td style="width:47%;vertical-align:top">${shot("After", a.afterRank, a.afterImageUrl, true)}</td>
          </tr>
        </table>
        <p style="margin:12px 0 0 0;color:#94a3b8;font-size:11px;font-style:italic;text-align:center">Real device. Real query. Your business, named by ${pLabel}.</p>
      </div>

      <!-- Closing copy + CTA -->
      <div style="padding:20px 30px 6px 30px">
        ${offer}
      </div>
      <div style="padding:6px 24px 8px 24px;text-align:center">
        <a href="${ctaUrl}" style="display:inline-block;background:linear-gradient(135deg,#fbbf24,${AMBER});background-color:${AMBER};color:${NAVY};font-size:14px;font-weight:800;padding:14px 38px;border-radius:12px;text-decoration:none;box-shadow:0 6px 18px rgba(245,158,11,0.35)">${ctaLabel} &nbsp;&rarr;</a>
      </div>

      <!-- Signature -->
      <div style="padding:14px 30px 26px 30px">
        <p style="margin:0;color:#334155;font-size:14px;line-height:1.6">&mdash; ${SENDER_NAME}<br/><span style="color:#64748b">${SENDER_ORG}</span></p>
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
  template?: SalesTemplateKey;
}

interface SalesEmailScope {
  businessId: number | null;
  aeoPlanId: number | null;
}

/** resolveImprovement takes the scope through its query object (the same
 *  fields the /screenshot URL carries). */
function scopeQuery(clientId: number, scope: SalesEmailScope) {
  return {
    clientId: String(clientId),
    ...(scope.businessId ? { businessId: String(scope.businessId) } : {}),
    ...(scope.aeoPlanId ? { aeoPlanId: String(scope.aeoPlanId) } : {}),
  };
}

function parseScope(src: Record<string, unknown>): SalesEmailScope {
  const n = (v: unknown) => {
    const x = Number.parseInt(String(v ?? ""), 10);
    return Number.isFinite(x) && x > 0 ? x : null;
  };
  return { businessId: n(src.businessId), aeoPlanId: n(src.aeoPlanId) };
}

/** Contact first name for the greeting — first token of the client's account
 *  user name. Null when we have nothing usable (falls back to "Hi there,"). */
async function firstNameOfClient(clientId: number): Promise<string | null> {
  const [row] = await db
    .select({ name: clientsTable.accountUserName })
    .from(clientsTable)
    .where(eq(clientsTable.id, clientId))
    .limit(1);
  const token = (row?.name ?? "").trim().split(/\s+/)[0];
  return token && token.length > 1 ? token : null;
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
  scope: SalesEmailScope,
  firstName: string | null,
  avoidKeywordIds: Set<number>,
): { ok: true; prep: PreparedEmail } | { ok: false; reason: string } {
  // The update template auto-picks a keyword the client hasn't been emailed yet.
  const preferUnsent = resolveTemplate(copy.template).preferUnsent;
  const selection = pickSelection(data, keywordId, platform, {
    avoidKeywordIds: preferUnsent ? avoidKeywordIds : undefined,
  });
  if (!selection)
    return {
      ok: false,
      reason: "No improved keyword available for this client.",
    };
  const kwText = selection.entry.keyword ?? "";
  const imgUrl = (which: "first" | "current") =>
    buildScreenshotUrlByClient(clientId, kwText, selection.platform, which, {
      strict: strictMode,
      businessId: scope.businessId,
      aeoPlanId: scope.aeoPlanId,
    });
  // the SELECTED keyword's business, not the client's dominant one — they can
  // differ for multi-business clients
  const business = selection.entry.business || data.business;
  const html = buildSalesEmailHtml({
    business,
    keyword: kwText,
    platform: selection.platform,
    beforeRank: selection.ranks.first.rank,
    afterRank: selection.ranks.current.rank,
    beforeDate: selection.ranks.first.date,
    afterDate: selection.ranks.current.date,
    beforeImageUrl: imgUrl("first"),
    afterImageUrl: imgUrl("current"),
    firstName,
    ...copy,
  });
  return {
    ok: true,
    prep: {
      html,
      business,
      clientName: data.client.name,
      selection,
      strictMode,
    },
  };
}

/** Last successful sales-send timestamps for a client, in one round-trip:
 *  a per-keyword map (keyed by the keywordId stored in meta) plus the overall
 *  account-level max across ALL sales sends (including sends with no keywordId).
 *  Grouping on meta->>'keywordId' keeps null-keyword rows in the result so they
 *  still count toward the account-level value. */
async function getLastSentInfo(clientId: number): Promise<{
  perKeyword: Map<number, { lastSent: string; count: number }>;
  accountLast: string | null;
}> {
  const result = await db.execute(sql`
    SELECT meta->>'keywordId' AS kid, MAX(sent_at) AS last_sent, COUNT(*)::int AS n
    FROM email_sends
    WHERE client_id = ${clientId}
      AND kind = 'sales'
      AND status = 'sent'
    GROUP BY meta->>'keywordId'
  `);
  const rows = result.rows as Array<{
    kid: string | null;
    last_sent: Date;
    n: number;
  }>;
  const perKeyword = new Map<number, { lastSent: string; count: number }>();
  let accountLast: string | null = null;
  for (const row of rows) {
    if (!row.last_sent) continue;
    const iso = new Date(row.last_sent).toISOString();
    if (accountLast == null || iso > accountLast) accountLast = iso;
    const kid = row.kid != null ? Number.parseInt(row.kid, 10) : NaN;
    if (Number.isFinite(kid))
      perKeyword.set(kid, { lastSent: iso, count: row.n });
  }
  return { perKeyword, accountLast };
}

/* Keyword/platform options for the FE picker, strongest improvement first. */
function keywordOptions(
  data: ImprovementData,
  lastSentByKeyword: Map<number, { lastSent: string; count: number }>,
) {
  return data.keywords.map((k) => ({
    keywordId: k.keywordId,
    keyword: k.keyword,
    maxImproved: k.maxImproved,
    lastSentAt: lastSentByKeyword.get(k.keywordId)?.lastSent ?? null,
    sentCount: lastSentByKeyword.get(k.keywordId)?.count ?? 0,
    platforms: PLATFORM_ORDER.filter((p) => k.platforms[p]).map((p) => ({
      platform: p,
      beforeRank: k.platforms[p].first.rank,
      afterRank: k.platforms[p].current.rank,
      beforeDate: k.platforms[p].first.date,
      afterDate: k.platforms[p].current.date,
      improved: k.platforms[p].first.rank - k.platforms[p].current.rank,
      // OCR rank-visibility per screenshot: true = rank clearly in image,
      // false = not detected (bad screenshot), null = not checked.
      beforeRankVisible: k.platforms[p].first.rankVisible,
      afterRankVisible: k.platforms[p].current.rankVisible,
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
    const template = resolveTemplate(qs("template"));
    const copy: SalesEmailCopy = {
      introMessage: qs("introMessage"),
      offerText: qs("offerText"),
      ctaLabel: qs("ctaLabel"),
      ctaUrl: qs("ctaUrl"),
      template: template.key,
    };

    const scope = parseScope(req.query as Record<string, unknown>);
    const lastSent = await getLastSentInfo(clientId);
    const sentKeywordIds = new Set(lastSent.perKeyword.keys());
    const strictMode = process.env.GHL_SYNC_STRICT === "1";
    const r = await resolveImprovement(scopeQuery(clientId, scope), {
      strict: strictMode,
      // Operator UI: show every keyword that has a real screenshot and let the
      // sender review the preview. The automated CRM sync keeps positiveTop3.
      positiveTop3: false,
      includeUnimproved: true,
    });
    /* No-improvement is a valid preview state, not an error — the FE shows an
       empty state and disables Send. */
    if (!r.ok)
      return res.json({
        hasImprovement: false,
        reason: r.reason,
        html: null,
        selected: null,
        keywords: [],
        lastCommunicationAt: lastSent.accountLast,
        strictMode,
      });

    const firstName = await firstNameOfClient(clientId);
    const prepared = prepareSalesEmail(
      clientId,
      r.data,
      strictMode,
      keywordId != null && Number.isNaN(keywordId) ? null : keywordId,
      platform,
      copy,
      scope,
      firstName,
      sentKeywordIds,
    );
    if (!prepared.ok)
      return res.json({
        hasImprovement: false,
        reason: prepared.reason,
        html: null,
        selected: null,
        keywords: keywordOptions(r.data, lastSent.perKeyword),
        lastCommunicationAt: lastSent.accountLast,
        strictMode,
      });

    const sel = prepared.prep.selection;
    // The resolved default intro/offer text — the FE seeds the editable boxes
    // with these so the operator can see and extend the template.
    const dArgs: SalesEmailArgs = {
      business: prepared.prep.business,
      keyword: sel.entry.keyword ?? "",
      platform: sel.platform,
      beforeRank: sel.ranks.first.rank,
      afterRank: sel.ranks.current.rank,
      beforeDate: sel.ranks.first.date,
      afterDate: sel.ranks.current.date,
      beforeImageUrl: "",
      afterImageUrl: "",
      firstName,
    };
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
      template: template.key,
      defaultSubject: template.defaultSubject,
      defaultCtaLabel: template.defaultCtaLabel,
      defaultIntro: template.buildIntro(dArgs),
      defaultOffer: template.buildOffer(dArgs),
      keywords: keywordOptions(r.data, lastSent.perKeyword),
      lastCommunicationAt: lastSent.accountLast,
      strictMode,
    });
  } catch (err) {
    req.log.error({ err }, "Error building sales email preview");
    return res.status(500).json({ error: "Internal server error" });
  }
});

/* GET /api/sales/campaign-screenshots?clientId=&businessId?=&aeoPlanId?=
   Visual picker feed: every keyword × platform screenshot in the selected
   campaign scope, with presigned before/after images and the campaign's own
   street address(es). The operator eyeballs the thumbnails against the target
   address and clicks the one to feature — the DB has no per-capture street
   address to auto-match on (ranking_reports.search_address is null/city-level),
   so the address the AI cited lives only inside the image. */
router.get("/campaign-screenshots", requireSalesEmail, async (req, res) => {
  const clientId = Number.parseInt(String(req.query.clientId ?? ""), 10);
  if (Number.isNaN(clientId))
    return res.status(400).json({ error: "clientId required" });
  try {
    if (!(await isClientInSalesScope(req, clientId)))
      return res.status(403).json({ error: "Client outside your plan scope" });

    const scope = parseScope(req.query as Record<string, unknown>);
    const r = await resolveImprovement(scopeQuery(clientId, scope), {
      positiveTop3: false,
      includeUnimproved: true,
    });

    // The campaign's own street address(es) in scope — the match target the
    // operator checks each screenshot against.
    const plans = await db
      .select({
        id: clientAeoPlansTable.id,
        searchAddress: clientAeoPlansTable.searchAddress,
      })
      .from(clientAeoPlansTable)
      .where(
        and(
          eq(clientAeoPlansTable.clientId, clientId),
          scope.businessId
            ? eq(clientAeoPlansTable.businessId, scope.businessId)
            : undefined,
          scope.aeoPlanId
            ? eq(clientAeoPlansTable.id, scope.aeoPlanId)
            : undefined,
        ),
      );
    const targetAddresses = Array.from(
      new Set(
        plans
          .map((p) => p.searchAddress?.trim())
          .filter((a): a is string => !!a),
      ),
    );

    if (!r.ok) return res.json({ targetAddresses, shots: [] });

    const shots = (
      await Promise.all(
        r.data.keywords.flatMap((k) =>
          PLATFORM_ORDER.filter((p) => k.platforms[p]).map(async (p) => {
            const pr = k.platforms[p];
            const [beforeUrl, afterUrl] = await Promise.all([
              presign(pr.first.s3Uri),
              presign(pr.current.s3Uri),
            ]);
            return {
              keywordId: k.keywordId,
              keyword: k.keyword,
              platform: p,
              beforeRank: pr.first.rank,
              afterRank: pr.current.rank,
              beforeDate: pr.first.date,
              afterDate: pr.current.date,
              improved: pr.first.rank - pr.current.rank,
              afterRankVisible: pr.current.rankVisible,
              beforeUrl,
              afterUrl,
            };
          }),
        ),
      )
    ).filter((s) => s.afterUrl != null);

    // Strongest, verified-top-3-first — same order as the dropdown.
    shots.sort((a, b) => {
      const av = a.afterRank <= 3 && a.afterRankVisible === true ? 0 : 1;
      const bv = b.afterRank <= 3 && b.afterRankVisible === true ? 0 : 1;
      if (av !== bv) return av - bv;
      if (av === 0 && a.afterRank !== b.afterRank)
        return a.afterRank - b.afterRank;
      return b.improved - a.improved;
    });

    return res.json({ targetAddresses, shots });
  } catch (err) {
    req.log.error({ err }, "Error listing campaign screenshots");
    return res.status(500).json({ error: "Internal server error" });
  }
});

interface SendSalesEmailBody {
  clientId: number;
  businessId?: number | null;
  aeoPlanId?: number | null;
  keywordId?: number | null;
  platform?: string | null;
  recipients: string[];
  subject?: string;
  introMessage?: string;
  offerText?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  template?: SalesTemplateKey;
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
    // Sales emails carry their own SEO Local sender name (the ranking-report
    // emails keep SENDGRID_FROM_NAME). Override via SALES_FROM_NAME.
    const fromName =
      process.env.SALES_FROM_NAME ?? `${SENDER_NAME} — ${SENDER_ORG}`;
    if (!fromEmail) {
      return res.status(503).json({
        error: "Sender email not configured",
        code: "SENDER_NOT_CONFIGURED",
        detail:
          "No FROM address is set. Sending is disabled until you set SENDGRID_FROM_EMAIL in AWS Secrets Manager (aeo-admin/prod) and verify the address in SendGrid.",
      });
    }

    const scope = parseScope(body as Record<string, unknown>);
    const strictMode = process.env.GHL_SYNC_STRICT === "1";
    const r = await resolveImprovement(scopeQuery(body.clientId, scope), {
      strict: strictMode,
      // Operator UI: show every keyword that has a real screenshot and let the
      // sender review the preview. The automated CRM sync keeps positiveTop3.
      positiveTop3: false,
      includeUnimproved: true,
    });
    if (!r.ok) return res.status(409).json({ error: r.reason });
    const template = resolveTemplate(body.template);
    const lastSent = await getLastSentInfo(body.clientId);
    const sentKeywordIds = new Set(lastSent.perKeyword.keys());
    const firstName = await firstNameOfClient(body.clientId);
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
        template: template.key,
      },
      scope,
      firstName,
      sentKeywordIds,
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

    const subject = body.subject?.trim() || template.defaultSubject;

    /* Delivery routing:
       - GHL sending is disabled in safe mode (a test must never email a real
         client's GHL contact) and when no PIT token is set.
       - GHL_SEND_MODE=ghl_first (default when a token exists): deliver THROUGH
         GHL so the email is in the contact's conversation and replies thread
         back to GHL. SendGrid is the fallback (no GHL contact, or GHL errors).
       - GHL_SEND_MODE=sendgrid_only: always SendGrid, GHL gets a one-way note. */
    // Opt-in: default stays SendGrid+note (no behavior change on deploy). Set
    // GHL_SEND_MODE=ghl_first in the prod secret to route delivery through GHL.
    const sendMode = process.env.GHL_SEND_MODE ?? "sendgrid_only";
    const ghlEnabled = Boolean(process.env.GHL_PIT_TOKEN) && !safeOverride;

    // GHL contact — needed to send-via-GHL and/or to log the note. The contact's
    // own email is GHL's default "To"; any OTHER listed recipients are CC'd on the
    // GHL send (a GHL email is threaded to one contact, so extras ride as CC).
    let contactId: string | null = null;
    let contactPrimaryEmail: string | null = null;
    if (ghlEnabled) {
      try {
        const [clientRow] = await db
          .select({
            accountEmail: clientsTable.accountEmail,
            contactEmail: clientsTable.contactEmail,
          })
          .from(clientsTable)
          .where(eq(clientsTable.id, body.clientId))
          .limit(1);
        contactPrimaryEmail =
          clientRow?.accountEmail || clientRow?.contactEmail || null;
        contactId = contactPrimaryEmail
          ? await ghlFindContactIdByEmail(contactPrimaryEmail)
          : null;
      } catch (e) {
        req.log.warn({ err: e }, "GHL contact lookup failed");
      }
    }

    let deliveredVia: "ghl" | "sendgrid" | null = null;
    let messageId: string | undefined;
    let sendError: string | null = null;
    let ghlStatus: string | null = null;
    let storedSubject = subject;

    // GHL delivers to the CONTACT's own primary email (the client). Only route
    // through GHL when the operator actually kept the client in the recipient
    // list — otherwise a test send (client removed, your address typed in) would
    // still land in the client's inbox with you merely CC'd. When the client is
    // not a listed recipient, fall through to SendGrid, which honors the typed To.
    const primaryEmail = (contactPrimaryEmail ?? "").toLowerCase();
    const recipientsIncludeClient =
      primaryEmail.length > 0 &&
      intendedRecipients.some((e) => e.toLowerCase() === primaryEmail);

    // 1) Preferred: deliver through GHL (replies thread back into GHL).
    if (
      ghlEnabled &&
      sendMode === "ghl_first" &&
      contactId &&
      recipientsIncludeClient
    ) {
      try {
        const ccList = intendedRecipients.filter(
          (e) => e.toLowerCase() !== primaryEmail,
        );
        const r = await ghlSendEmail(contactId, {
          html,
          subject,
          ...(GHL_EMAIL_FROM ? { emailFrom: GHL_EMAIL_FROM } : {}),
          ...(ccList.length ? { emailCc: ccList } : {}),
        });
        deliveredVia = "ghl";
        messageId = r.messageId;
        ghlStatus = "sent_via_ghl";
      } catch (e) {
        ghlStatus = `ghl_send_failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`;
        req.log.warn({ err: e }, "GHL send failed — falling back to SendGrid");
      }
    }

    // 2) Fallback / default: SendGrid, then a one-way GHL note.
    if (deliveredVia == null) {
      const msg = {
        to: actualRecipients,
        from: { email: fromEmail, name: fromName },
        subject: safeOverride
          ? `[TEST → would have gone to: ${intendedRecipients.join(", ")}] ${subject}`
          : subject,
        html,
        // Keep it a 1:1 email, not a newsletter: no link-rewriting redirect,
        // no open pixel, no injected List-Unsubscribe header (all of which make
        // Gmail file it under Promotions/bulk).
        trackingSettings: {
          clickTracking: { enable: false, enableText: false },
          openTracking: { enable: false },
          subscriptionTracking: { enable: false },
        },
        mailSettings: { bypassListManagement: { enable: false } },
      };
      storedSubject = msg.subject;
      try {
        const sgResp = await sgMail.send(msg);
        messageId = sgResp?.[0]?.headers?.["x-message-id"] as
          | string
          | undefined;
        deliveredVia = "sendgrid";
      } catch (e: unknown) {
        sendError = e instanceof Error ? e.message : String(e);
      }
      if (!sendError) {
        if (!ghlEnabled)
          ghlStatus = safeOverride ? "skipped (safe mode)" : "disabled";
        else if (!contactId) ghlStatus = ghlStatus ?? "no_contact";
        // Client removed from recipients = a test send; don't touch the real
        // client's GHL contact timeline with a "SENT" note.
        else if (!recipientsIncludeClient)
          ghlStatus = "skipped_note (client not a recipient)";
        else {
          try {
            const pLabelNote =
              PLATFORM_LABELS[selection.platform] ?? selection.platform;
            const sentAtEt = new Date().toLocaleString("en-US", {
              timeZone: "America/New_York",
              dateStyle: "medium",
              timeStyle: "short",
            });
            await ghlCreateNote(
              contactId,
              [
                "📧 AEO Sales Email — SENT",
                `When: ${sentAtEt} ET`,
                `To: ${intendedRecipients.join(", ")}`,
                `From: ${fromName} <${fromEmail}>`,
                `Subject: ${subject}`,
                `Business: ${business}`,
                `Proof: "${selection.entry.keyword}" on ${pLabelNote} — #${selection.ranks.first.rank} → #${selection.ranks.current.rank}`,
                "Sent from the AEO admin panel via SendGrid.",
              ].join("\n"),
            );
            ghlStatus = ghlStatus ? `${ghlStatus} + noted` : "noted";
          } catch (e) {
            ghlStatus = `note_failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`;
            req.log.warn({ err: e }, "GHL note failed");
          }
        }
      }
    }

    const [logged] = await db
      .insert(emailSendsTable)
      .values({
        clientId: body.clientId,
        businessId: scope.businessId,
        aeoPlanId: scope.aeoPlanId,
        recipients: actualRecipients,
        intendedRecipients: safeOverride ? intendedRecipients : null,
        fromEmail,
        subject: storedSubject,
        status: sendError ? "failed" : "sent",
        sendgridMessageId:
          deliveredVia === "sendgrid" ? (messageId ?? null) : null,
        deliveredVia: deliveredVia ?? null,
        ghlMessageId: deliveredVia === "ghl" ? (messageId ?? null) : null,
        latestStatus: sendError ? "failed" : "sent",
        error: sendError,
        kind: "sales",
        html,
        meta: {
          keyword: selection.entry.keyword,
          keywordId: selection.entry.keywordId,
          platform: selection.platform,
          beforeRank: selection.ranks.first.rank,
          afterRank: selection.ranks.current.rank,
          beforeDate: selection.ranks.first.date,
          afterDate: selection.ranks.current.date,
          business,
          template: template.key,
          deliveredVia,
          messageId: messageId ?? null,
        },
        ghlStatus,
      })
      .returning({ id: emailSendsTable.id });

    if (sendError) {
      req.log.error(
        { sendError, sendId: logged.id },
        "Sales email delivery failed",
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
      deliveredVia,
      recipientsActual: actualRecipients,
      recipientsIntended: intendedRecipients,
      safeModeActive: Boolean(safeOverride),
      keyword: selection.entry.keyword,
      platform: selection.platform,
      beforeRank: selection.ranks.first.rank,
      afterRank: selection.ranks.current.rank,
      ghlStatus,
    });
  } catch (err) {
    req.log.error({ err }, "Error sending sales email");
    const detail = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: "Internal server error", detail });
  }
});

/* GET /api/sales/email-sends?clientId=&kind=
   Sent-email history for the Sent Emails page (html excluded — fetch the
   detail endpoint to replay one). Sales users only see their plan slice. */
router.get("/email-sends", requireSalesEmail, async (req, res) => {
  try {
    const clientId = req.query.clientId
      ? Number.parseInt(String(req.query.clientId), 10)
      : null;
    const kind = req.query.kind ? String(req.query.kind) : null;
    const planType = req.query.planType
      ? String(req.query.planType).trim()
      : null;
    const scopedIds = await getScopedClientIds(req);
    if (scopedIds !== null && scopedIds.length === 0)
      return res.json({ sends: [] });
    const rows = await db
      .select({
        id: emailSendsTable.id,
        clientId: emailSendsTable.clientId,
        clientName: clientsTable.businessName,
        campaignName: clientAeoPlansTable.name,
        planType: clientAeoPlansTable.planType,
        sentAt: emailSendsTable.sentAt,
        recipients: emailSendsTable.recipients,
        intendedRecipients: emailSendsTable.intendedRecipients,
        subject: emailSendsTable.subject,
        status: emailSendsTable.status,
        kind: emailSendsTable.kind,
        meta: emailSendsTable.meta,
        ghlStatus: emailSendsTable.ghlStatus,
        error: emailSendsTable.error,
        deliveredVia: emailSendsTable.deliveredVia,
        latestStatus: emailSendsTable.latestStatus,
        latestEventAt: emailSendsTable.latestEventAt,
        openedCount: emailSendsTable.openedCount,
        clickedCount: emailSendsTable.clickedCount,
      })
      .from(emailSendsTable)
      .leftJoin(clientsTable, eq(emailSendsTable.clientId, clientsTable.id))
      // Campaign = the plan of the keyword this email is about. Sends rarely set
      // aeo_plan_id directly, but sales emails carry meta.keywordId → keyword's plan.
      .leftJoin(
        keywordsTable,
        sql`${keywordsTable.id} = NULLIF(${emailSendsTable.meta} ->> 'keywordId', '')::int`,
      )
      .leftJoin(
        clientAeoPlansTable,
        sql`${clientAeoPlansTable.id} = COALESCE(${keywordsTable.aeoPlanId}, ${emailSendsTable.aeoPlanId})`,
      )
      .where(
        and(
          clientId != null && Number.isFinite(clientId)
            ? eq(emailSendsTable.clientId, clientId)
            : undefined,
          kind ? eq(emailSendsTable.kind, kind) : undefined,
          planType ? eq(clientAeoPlansTable.planType, planType) : undefined,
          scopedIds !== null
            ? inArray(emailSendsTable.clientId, scopedIds)
            : undefined,
        ),
      )
      .orderBy(desc(emailSendsTable.sentAt))
      .limit(200);
    return res.json({ sends: rows });
  } catch (err) {
    req.log.error({ err }, "Error listing sales email sends");
    return res.status(500).json({ error: "Internal server error" });
  }
});

/* POST /api/sales/email-sends/refresh-status?clientId=&kind=
   Pull the current GHL lifecycle status for recent, non-terminal GHL sends and
   advance latest_status. GHL workflow webhooks can't carry the message id, so
   this poll (by the messageId we store on send) is the source of truth for
   delivered/opened/clicked. Bounded + best-effort; returns {polled, updated}. */
router.post(
  "/email-sends/refresh-status",
  requireSalesEmail,
  async (req, res) => {
    try {
      const clientId = req.query.clientId
        ? Number.parseInt(String(req.query.clientId), 10)
        : null;
      const kind = req.query.kind ? String(req.query.kind) : null;
      const scopedIds = await getScopedClientIds(req);
      if (
        scopedIds !== null &&
        clientId != null &&
        !scopedIds.includes(clientId)
      )
        return res
          .status(403)
          .json({ error: "Client outside your plan scope" });
      const result = await refreshGhlSendStatuses({
        clientId:
          clientId != null && Number.isFinite(clientId) ? clientId : null,
        clientIds: scopedIds,
        kind,
      });
      return res.json(result);
    } catch (err) {
      req.log.error({ err }, "Error refreshing GHL email statuses");
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

/* GET /api/sales/email-sends/:id — full record incl. the exact HTML sent. */
router.get("/email-sends/:id", requireSalesEmail, async (req, res) => {
  const id = Number.parseInt(String(req.params.id), 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: "invalid id" });
  try {
    const [row] = await db
      .select()
      .from(emailSendsTable)
      .where(eq(emailSendsTable.id, id))
      .limit(1);
    if (!row) return res.status(404).json({ error: "not found" });
    if (
      row.clientId != null &&
      !(await isClientInSalesScope(req, row.clientId))
    )
      return res.status(403).json({ error: "Client outside your plan scope" });
    const events = await db
      .select({
        id: emailEventsTable.id,
        provider: emailEventsTable.provider,
        event: emailEventsTable.event,
        occurredAt: emailEventsTable.occurredAt,
        createdAt: emailEventsTable.createdAt,
      })
      .from(emailEventsTable)
      .where(eq(emailEventsTable.emailSendId, id))
      .orderBy(asc(emailEventsTable.occurredAt));
    return res.json({ ...row, events });
  } catch (err) {
    req.log.error({ err }, "Error fetching email send detail");
    return res.status(500).json({ error: "Internal server error" });
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
    businessId?: number | null;
    aeoPlanId?: number | null;
    keywordId?: number | null;
    platform?: string | null;
    instruction?: string;
  };
  if (!body.clientId)
    return res.status(400).json({ error: "clientId required" });
  try {
    if (!(await isClientInSalesScope(req, body.clientId)))
      return res.status(403).json({ error: "Client outside your plan scope" });

    const scope = parseScope(body as Record<string, unknown>);
    const strictMode = process.env.GHL_SYNC_STRICT === "1";
    const r = await resolveImprovement(scopeQuery(body.clientId, scope), {
      strict: strictMode,
      // Operator UI: show every keyword that has a real screenshot and let the
      // sender review the preview. The automated CRM sync keeps positiveTop3.
      positiveTop3: false,
      includeUnimproved: true,
    });
    if (!r.ok) return res.status(409).json({ error: r.reason });
    const selection = pickSelection(
      r.data,
      body.keywordId ?? null,
      body.platform ?? null,
    );
    if (!selection)
      return res.status(409).json({ error: "No improved keyword available." });

    const facts = {
      sender_org: SENDER_ORG,
      contact_first_name:
        (await firstNameOfClient(body.clientId)) ?? "the customer",
      business: r.data.business,
      keyword: selection.entry.keyword,
      platform: PLATFORM_LABELS[selection.platform] ?? selection.platform,
      before_rank: selection.ranks.first.rank,
      after_rank: selection.ranks.current.rank,
      spots_improved: selection.improved,
      other_improved_keywords: r.data.keywords.length - 1,
    };

    const systemPrompt = `You write warm, credible sales emails for ${SENDER_ORG}, a local SEO company, announcing a client's first AI-search (AEO) ranking result on ChatGPT, Gemini, and Perplexity. Voice: friendly, plain-spoken, low-hype — a trusted vendor sharing good news, not a pushy pitch. Match this proven template's flow.

HARD RULES:
- Use ONLY the values in the data. NEVER invent statistics, percentages, studies, or quotes.
- Plain text only. No markdown, no HTML, no subject line.
- Output EXACTLY two sections separated by a line containing only "---".
  Section 1 (intro, max 90 words): open with "Hi <contact_first_name>," then explain ${SENDER_ORG} added an AI Ranking Service that gets <business> named as the answer when people ask AI what they do. End with a line like "Here's your first keyword ranking:" — the before/after proof is shown right after this text.
  Section 2 (closing, max 70 words): confirm this is a real, screenshot-verified result — <business> now shows up as the AI answer for the keyword. Then say you'll rank a few more of their keywords over the next couple weeks, and invite them to reply or book a time. Do NOT write the button text or a sign-off.
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
