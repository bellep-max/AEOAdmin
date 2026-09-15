/**
 * Weekly Campaign Report email — the post-conversion template.
 *
 * The proof emails (first_proof / second_keyword / third_keyword) sell one
 * keyword on one platform with a before/after pair and a booking CTA. This one
 * is the opposite: it reports on a live paying campaign — every tracked keyword,
 * all three AI platforms, a reporting period, and no sales offer.
 */

const NAVY = "#0f172a";
const AMBER = "#f59e0b";
const TOP3 = 3;
/* An email that lists 40 keywords gets clipped by Gmail. Show the strongest and
   say how many more are tracked. */
const MAX_ROWS = 12;

export interface WeeklyReportRow {
  keyword: string;
  platform: string;
  beforeRank: number;
  afterRank: number;
}

export interface WeeklyReportShot {
  platform: string;
  rank: number;
  url: string;
}

export interface WeeklyReportArgs {
  business: string;
  planLabel: string;
  periodStart: string | null;
  periodEnd: string | null;
  firstName?: string | null;
  /** Editable "Weekly Summary" copy. */
  summary: string;
  /** Editable "Progress This Week" copy. */
  progress: string;
  rows: WeeklyReportRow[];
  totalKeywords: number;
  shots: WeeklyReportShot[];
  senderName: string;
  senderOrg: string;
  platformLabels: Record<string, string>;
  platformColor: (p: string) => string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function paragraphs(text: string): string {
  return escapeHtml(text)
    .trim()
    .split(/\n{2,}/)
    .map(
      (p) =>
        `<p style="margin:0 0 14px 0;color:#334155;font-size:14px;line-height:1.7;white-space:pre-wrap">${p.trim()}</p>`,
    )
    .join("");
}

function trendCell(before: number, after: number): string {
  if (after < before)
    return `<span style="color:#047857;font-weight:700">&#9650; Up ${before - after}</span>`;
  if (after > before)
    return `<span style="color:#b91c1c;font-weight:700">&#9660; Down ${after - before}</span>`;
  return `<span style="color:#64748b;font-weight:700">&rarr; Holding</span>`;
}

function bullet(text: string): string {
  return `<div style="color:#334155;font-size:14px;line-height:1.9">&#9989; ${escapeHtml(text)}</div>`;
}

function focusItem(text: string): string {
  return `<div style="color:#334155;font-size:14px;line-height:1.9">&bull; ${escapeHtml(text)}</div>`;
}

function periodLabel(start: string | null, end: string | null): string {
  if (start && end) return `${start} &ndash; ${end}`;
  return end ?? start ?? "Current period";
}

export function buildWeeklyReportHtml(a: WeeklyReportArgs): string {
  const label = (p: string) => a.platformLabels[p] ?? p;
  const shown = a.rows.slice(0, MAX_ROWS);
  const hidden = Math.max(0, a.totalKeywords - shown.length);
  const greeting = a.firstName?.trim()
    ? `Hello ${escapeHtml(a.firstName.trim())},`
    : "Hello,";

  const statusRows = a.shots
    .map((s) => {
      const recommended = s.rank <= TOP3;
      return `<tr>
        <td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;color:${NAVY};font-weight:600">
          <span style="display:inline-block;width:8px;height:8px;border-radius:4px;background:${a.platformColor(s.platform)};margin-right:8px"></span>${label(s.platform)}
        </td>
        <td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;text-align:right;color:${recommended ? "#047857" : "#b45309"};font-weight:700">
          ${recommended ? `&#9989; Recommended &middot; #${s.rank}` : `&#9203; Improving &middot; #${s.rank}`}
        </td>
      </tr>`;
    })
    .join("");

  const keywordRows = shown
    .map(
      (r) => `<tr>
        <td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;color:${NAVY}">
          ${escapeHtml(r.keyword)}
          <div style="font-size:11px;color:#94a3b8">${label(r.platform)}</div>
        </td>
        <td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;text-align:center;color:#64748b;font-weight:600">#${r.beforeRank}</td>
        <td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;text-align:center;color:#b45309;font-weight:700">#${r.afterRank}</td>
        <td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;font-size:12px;text-align:right">${trendCell(r.beforeRank, r.afterRank)}</td>
      </tr>`,
    )
    .join("");

  const evidence = a.shots
    .map(
      (s) => `<div style="margin-bottom:16px">
        <div style="font-size:12px;font-weight:800;letter-spacing:1px;color:${a.platformColor(s.platform)};text-transform:uppercase;margin-bottom:6px">&#128248; ${label(s.platform)} &middot; #${s.rank}</div>
        <img src="${s.url}" alt="${label(s.platform)} screenshot" width="100%" style="width:100%;height:auto;display:block;border:1px solid #e2e8f0;border-radius:12px" />
      </div>`,
    )
    .join("");

  const card = (title: string, inner: string) => `
    <div style="padding:18px 26px 4px 26px">
      <div style="font-size:11px;font-weight:800;letter-spacing:2px;color:${AMBER};text-transform:uppercase;margin-bottom:10px">${title}</div>
      ${inner}
    </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:660px;margin:0 auto;padding:0 0 20px 0">

    <div style="background:linear-gradient(150deg,#0b1120 0%,#1e293b 100%);background-color:${NAVY};padding:24px 28px;text-align:center">
      <div style="font-size:11px;font-weight:800;letter-spacing:3px;color:${AMBER};text-transform:uppercase">${escapeHtml(a.senderOrg)} &middot; Weekly Campaign Report</div>
      <h1 style="margin:10px 0 6px 0;color:#fff;font-size:24px;line-height:1.25;letter-spacing:-0.5px">${escapeHtml(a.business)}</h1>
      <p style="margin:0;color:#94a3b8;font-size:13px">${escapeHtml(a.planLabel)} &middot; ${periodLabel(a.periodStart, a.periodEnd)}</p>
      <p style="margin:8px 0 0 0;color:#34d399;font-size:12px;font-weight:700">&#128994; Campaign active</p>
    </div>

    <div style="background:#f8fafc;border-radius:0 0 18px 18px;border:1px solid #cbd5e1;border-top:0">

      ${card(
        "Weekly summary",
        `<p style="margin:0 0 12px 0;color:${NAVY};font-size:14px;font-weight:600">${greeting}</p>${paragraphs(a.summary)}`,
      )}

      ${card(
        "Campaign highlights",
        [
          bullet("Campaign actively monitored"),
          bullet("AI visibility reviewed across supported platforms"),
          bullet("Recommendation opportunities evaluated"),
          bullet("Keyword performance tracked"),
          bullet("Campaign remains active and healthy"),
        ].join(""),
      )}

      ${
        statusRows
          ? card(
              "AI recommendation status",
              `<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">${statusRows}</table>`,
            )
          : ""
      }

      ${evidence ? card("Recommendation evidence", evidence) : ""}

      ${
        keywordRows
          ? card(
              "Keyword performance",
              `<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
                 <tr style="background:#f1f5f9">
                   <th style="padding:8px 12px;text-align:left;font-size:11px;letter-spacing:1px;color:#64748b;text-transform:uppercase">Search term</th>
                   <th style="padding:8px 12px;text-align:center;font-size:11px;letter-spacing:1px;color:#64748b;text-transform:uppercase">Previous</th>
                   <th style="padding:8px 12px;text-align:center;font-size:11px;letter-spacing:1px;color:#64748b;text-transform:uppercase">Current</th>
                   <th style="padding:8px 12px;text-align:right;font-size:11px;letter-spacing:1px;color:#64748b;text-transform:uppercase">Trend</th>
                 </tr>
                 ${keywordRows}
               </table>
               ${hidden > 0 ? `<p style="margin:8px 0 0 0;color:#94a3b8;font-size:11px">and ${hidden} more keyword${hidden === 1 ? "" : "s"} tracked this period.</p>` : ""}`,
            )
          : ""
      }

      ${card("Progress this week", paragraphs(a.progress))}

      ${card(
        "Next week's focus",
        [
          focusItem("Monitor your AI visibility"),
          focusItem("Track recommendation consistency"),
          focusItem("Continue improving keyword performance"),
          focusItem("Watch for new recommendation opportunities"),
          focusItem("Maintain your campaign's overall health"),
        ].join(""),
      )}

      ${card(
        "Campaign health",
        `<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
           <tr><td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#64748b">Campaign status</td><td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;text-align:right;color:#047857;font-weight:700">&#128994; Healthy</td></tr>
           <tr><td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#64748b">Visibility trend</td><td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;text-align:right;color:${NAVY};font-weight:700">Improving</td></tr>
           <tr><td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#64748b">Recommendation coverage</td><td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;text-align:right;color:${NAVY};font-weight:700">Active</td></tr>
           <tr><td style="padding:9px 12px;font-size:13px;color:#64748b">Monitoring</td><td style="padding:9px 12px;font-size:13px;text-align:right;color:${NAVY};font-weight:700">Ongoing</td></tr>
         </table>`,
      )}

      <div style="padding:18px 26px 26px 26px">
        <p style="margin:0 0 14px 0;color:#334155;font-size:14px;line-height:1.7">Thank you for choosing ${escapeHtml(a.senderOrg)}. We appreciate the opportunity to support your business, and our team will keep monitoring your campaign and working to improve your visibility across AI-powered search platforms. You'll get another update in next week's report.</p>
        <p style="margin:0;color:#334155;font-size:14px;line-height:1.6">&mdash; ${escapeHtml(a.senderName)}<br/><span style="color:#64748b">${escapeHtml(a.senderOrg)} &middot; Be the Answer.</span></p>
      </div>
    </div>

  </div>
</body>
</html>`;
}
