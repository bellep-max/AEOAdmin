import sgMail from "@sendgrid/mail";
import { db } from "@workspace/db";
import { emailSendsTable } from "@workspace/db/schema";

/**
 * Free-trial signup emails: a welcome to the new customer and an alert to the
 * owners. These are ADMIN/owner-originated mails and send FROM `ADMIN_FROM_EMAIL`
 * (mary@signalaeo.com) — deliberately separate from the client-facing sales
 * sender (`SENDGRID_FROM_EMAIL`) that chuckslocal uses, so the two never mix.
 *
 * Fail-soft by design: a SendGrid hiccup must never fail a signup. The DB write
 * is the source of truth; these emails are best-effort.
 */

interface Logger {
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

type MailStatus = "sent" | "skipped" | "failed";

export interface FreeTrialEmailInput {
  businessName: string;
  recipientEmail: string;
  clientId: number;
  proofClientSlug: string;
  brand: string | null;
  leadRef: string | null;
  source: string | null;
  /** Customer first name for the greeting; falls back to "Hi there," when null. */
  firstName: string | null;
  /** City, used to localize the welcome copy ("...in {city}"); may be null. */
  city: string | null;
  /** Direct (paid) signup vs free trial — changes the welcome copy. */
  isDirect: boolean;
}

export interface FreeTrialEmailResult {
  welcome: MailStatus;
  ownerAlert: MailStatus;
  errors: string[];
}

/** Minimal shape we build; kept loose so a test can pass a fake sender. */
interface OutboundMail {
  to: string[];
  from: { email: string; name: string };
  subject: string;
  html: string;
}

type SendFn = (msg: OutboundMail) => Promise<unknown>;

interface SendOptions {
  /** Injected in tests; defaults to the real SendGrid client. */
  send?: SendFn;
  log?: Logger;
}

const WELCOME_SUBJECT_TRIAL =
  "Welcome to Signal AEO — your free trial is live 🎉";
const WELCOME_SUBJECT_DIRECT = "Welcome to Signal AEO 🎉";
const DEFAULT_OWNER_EMAILS = [
  "admin@signalaeo.com",
  "erven.i@appstango.com",
  "mary@signalaeo.com",
  "belle.p@appstango.com",
];
const DEFAULT_FROM_NAME = "Signal AEO";

function ownerEmails(): string[] {
  const raw = process.env.OWNER_NOTIFY_EMAILS?.trim();
  if (!raw) return DEFAULT_OWNER_EMAILS;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const CALENDLY_URL =
  "https://calendly.com/contact-signalaeo/fix-my-ai-ranking-15-min";

function welcomeHtml(
  businessName: string,
  firstName: string | null,
  isDirect: boolean,
  city: string | null,
): string {
  const b = escapeHtml(businessName);
  const c = city?.trim() ? escapeHtml(city.trim()) : null;
  const inCity = c ? ` in ${c}` : ""; // localizes the copy only when we have a city
  const greeting = firstName?.trim()
    ? `Hi ${escapeHtml(firstName.trim())},`
    : "Hi there,";
  const openingLine = isDirect
    ? `Welcome to Signal AEO! We're getting started on <strong>${b}</strong>${inCity} now.`
    : `Welcome to Signal AEO! Your free trial for <strong>${b}</strong>${inCity} is now active.`;
  // Trial signups get the "we'll convert you when you rank top 3" promise;
  // direct (already-paid) signups just get the sit-back line.
  const closingLine = isDirect
    ? `<p>There's nothing you need to do right now — just sit back while we go to work.</p>`
    : `<p>There's nothing you need to do right now. Just sit back while we go to work. We'll convert your free trial to the paid plan when we send you proof that you're ranking in the top 3.</p>`;
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:560px">
  <p>${greeting}</p>
  <p>${openingLine}</p>
  <p>Here's what happens next: we've started working to get ${b} named in AI searches${inCity}. When people${inCity} ask ChatGPT, Gemini, and Perplexity for businesses like yours, we make sure you show up in the answer.</p>
  <p>Over the next couple of weeks you'll start seeing ${b} appear in those AI answers — and we'll send you the proof (real screenshots) as your rankings come in.</p>
  ${closingLine}
  <p>Questions? Just reply to this email or <a href="${CALENDLY_URL}">schedule a call with us here</a>.</p>
  <p>Welcome aboard,<br/><strong>The Signal AEO Team</strong></p>
</div>`;
}

function ownerAlertHtml(input: FreeTrialEmailInput): string {
  const rows: Array<[string, string | null]> = [
    ["Signup type", input.isDirect ? "Direct (Signal AEO Plan)" : "Free trial"],
    ["Business", input.businessName],
    ["Contact", input.firstName],
    ["Email", input.recipientEmail],
    ["Client ID", String(input.clientId)],
    ["Proof slug", input.proofClientSlug],
    ["Brand", input.brand],
    ["Lead ref", input.leadRef],
    ["Source", input.source],
  ];
  const cells = rows
    .filter(([, v]) => v != null && v !== "")
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#666">${escapeHtml(k)}</td><td style="padding:4px 0"><strong>${escapeHtml(String(v))}</strong></td></tr>`,
    )
    .join("");
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a">
  <p>A new free trial just started.</p>
  <table style="border-collapse:collapse">${cells}</table>
</div>`;
}

/**
 * Send the welcome + owner-alert emails for a new free-trial signup.
 * Never throws — returns per-mail status and any error strings for logging.
 */
export async function sendFreeTrialEmails(
  input: FreeTrialEmailInput,
  opts: SendOptions = {},
): Promise<FreeTrialEmailResult> {
  const log = opts.log;
  const errors: string[] = [];

  const apiKey = process.env.SENDGRID_API_KEY;
  const fromEmail =
    process.env.ADMIN_FROM_EMAIL?.trim() ||
    process.env.SENDGRID_FROM_EMAIL?.trim();
  const fromName =
    process.env.ADMIN_FROM_NAME?.trim() ||
    process.env.SENDGRID_FROM_NAME?.trim() ||
    DEFAULT_FROM_NAME;

  if (!apiKey || !fromEmail) {
    const reason = !apiKey ? "SENDGRID_API_KEY not set" : "no admin FROM email";
    log?.warn({ reason }, "free-trial emails skipped");
    return { welcome: "skipped", ownerAlert: "skipped", errors: [reason] };
  }

  let send = opts.send;
  if (!send) {
    sgMail.setApiKey(apiKey);
    send = (msg) => sgMail.send(msg as Parameters<typeof sgMail.send>[0]);
  }

  // In safe mode ALL mail is redirected to the override address so a test never
  // reaches a real signup or the owners; the subject is tagged with the true To.
  const safeOverride = process.env.SAFE_RECIPIENT_OVERRIDE?.trim() || null;
  const from = { email: fromEmail, name: fromName };

  const deliver = async (
    label: "welcome" | "ownerAlert",
    intendedTo: string[],
    subject: string,
    html: string,
  ): Promise<MailStatus> => {
    const to = safeOverride ? [safeOverride] : intendedTo;
    const finalSubject = safeOverride
      ? `[TEST → would have gone to: ${intendedTo.join(", ")}] ${subject}`
      : subject;
    try {
      await send!({ to, from, subject: finalSubject, html });
      return "sent";
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${label}: ${msg}`);
      log?.error({ err, label }, "free-trial email send failed");
      return "failed";
    }
  };

  const [welcome, ownerAlert] = await Promise.all([
    deliver(
      "welcome",
      [input.recipientEmail],
      input.isDirect ? WELCOME_SUBJECT_DIRECT : WELCOME_SUBJECT_TRIAL,
      welcomeHtml(
        input.businessName,
        input.firstName,
        input.isDirect,
        input.city,
      ),
    ),
    deliver(
      "ownerAlert",
      ownerEmails(),
      `New ${input.isDirect ? "direct" : "free trial"} signup: ${input.businessName}`,
      ownerAlertHtml(input),
    ),
  ]);

  // Record the client-facing welcome send so it shows up (typed "Welcome") on
  // the Sent Emails page. Fail-soft: a logging failure must never break signup.
  if (input.clientId != null) {
    try {
      await db.insert(emailSendsTable).values({
        clientId: input.clientId,
        recipients: safeOverride ? [safeOverride] : [input.recipientEmail],
        intendedRecipients: safeOverride ? [input.recipientEmail] : null,
        fromEmail,
        subject: input.isDirect
          ? WELCOME_SUBJECT_DIRECT
          : WELCOME_SUBJECT_TRIAL,
        status: welcome === "sent" ? "sent" : "failed",
        latestStatus: welcome === "sent" ? "sent" : "failed",
        deliveredVia: "sendgrid",
        kind: "welcome",
        html: welcomeHtml(
          input.businessName,
          input.firstName,
          input.isDirect,
          input.city,
        ),
        meta: {
          isDirect: input.isDirect,
          leadRef: input.leadRef ?? null,
          source: input.source ?? null,
        },
        error: welcome === "sent" ? null : "welcome send failed",
      });
    } catch (err) {
      log?.error({ err }, "failed to record welcome email send");
    }
  }

  return { welcome, ownerAlert, errors };
}
