/* Populate keyword_verdicts: for each (keyword_id, platform) candidate, an LLM
   judge reads the latest audit_logs.response_text and decides whether the AI
   answer GENUINELY recommends the business (ignoring the coerced [RANK] line).
   Resumable — skips combos already judged. Scope: matched-GHL clients by default,
   or pass "all" to judge every client's candidate combos.

   Run:  node scripts/judge-keyword-verdicts.mjs           (matched clients)
         node scripts/judge-keyword-verdicts.mjs all       (all clients)
*/
import { Client } from "pg";

const SCOPE = process.argv[2] === "all" ? "all" : "matched";
const CONCURRENCY = 6;
const MAX_RANK = 50;

const c = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

async function matchedClientIds() {
  const rows = (
    await c.query(
      `SELECT id, lower(account_email) ae, lower(contact_email) ce FROM clients WHERE status='active'`,
    )
  ).rows;
  const byEmail = new Map();
  for (const r of rows)
    for (const e of [r.ae, r.ce]) if (e) byEmail.set(e, r.id);
  const TOKEN = process.env.GHL_PIT_TOKEN,
    LOC = process.env.GHL_LOCATION_ID;
  const H = { Authorization: `Bearer ${TOKEN}`, Version: "2021-07-28", Accept: "application/json" };
  const ids = new Set();
  let after = null, afterId = null, pages = 0;
  while (pages < 200) {
    let url = `https://services.leadconnectorhq.com/contacts/?locationId=${LOC}&limit=100`;
    if (afterId) url += `&startAfterId=${afterId}&startAfter=${after}`;
    const j = await (await fetch(url, { headers: H })).json();
    const cs = j.contacts || [];
    for (const ct of cs) {
      const e = (ct.email || "").toLowerCase();
      if (e && byEmail.has(e)) ids.add(byEmail.get(e));
    }
    const meta = j.meta || {};
    pages++;
    if (!cs.length || !meta.startAfterId) break;
    afterId = meta.startAfterId;
    after = meta.startAfter;
  }
  return [...ids];
}

let clientFilter = "";
if (SCOPE === "matched") {
  const ids = await matchedClientIds();
  if (!ids.length) {
    console.log("no matched clients");
    process.exit(0);
  }
  clientFilter = `AND rr.client_id IN (${ids.join(",")})`;
  console.log(`scope: ${ids.length} matched clients`);
}

// candidate combos not yet judged
const combos = (
  await c.query(`
  SELECT DISTINCT rr.keyword_id, lower(rr.platform) platform
  FROM ranking_reports rr
  WHERE rr.ranking_position BETWEEN 1 AND ${MAX_RANK} AND rr.screenshot_url LIKE 's3://%'
    ${clientFilter}
    AND NOT EXISTS (SELECT 1 FROM keyword_verdicts v WHERE v.keyword_id=rr.keyword_id AND v.platform=lower(rr.platform))
`)
).rows;
console.log(`combos to judge: ${combos.length}`);

async function judge(biz, keyword, text) {
  const sys =
    "You analyze an AI assistant's 'best businesses for X' answer and judge how a TARGET business actually placed. The answer was forced to include a '[RANK: X/Y]' line — IGNORE it; judge ONLY from the real recommended list and prose about the target. Reply ONLY compact JSON.";
  const usr = `Target business: ${biz}\nKeyword: ${keyword}\n\nAI answer:\n${(text || "").slice(0, 3500)}\n\nReturn JSON: {"listed":bool,"genuine_top":bool,"sentiment":"positive"|"neutral"|"negative","note":"<=10 words"}`;
  const r = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "deepseek-chat",
      temperature: 0,
      max_tokens: 120,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: usr },
      ],
    }),
  });
  const j = await r.json();
  let t = (j.choices?.[0]?.message?.content || "").trim().replace(/```json|```/g, "").trim();
  return JSON.parse(t);
}

async function processOne(combo) {
  const a = (
    await c.query(
      `SELECT biz_name, keyword_text, response_text, created_at::date d
       FROM audit_logs WHERE keyword_id=$1 AND lower(platform)=$2 AND NULLIF(btrim(response_text),'') IS NOT NULL
       ORDER BY created_at DESC LIMIT 1`,
      [combo.keyword_id, combo.platform],
    )
  ).rows[0];
  if (!a) return "no_text";
  let v;
  try {
    v = await judge(a.biz_name, a.keyword_text, a.response_text);
  } catch {
    return "judge_err";
  }
  await c.query(
    `INSERT INTO keyword_verdicts (keyword_id, platform, genuine, sentiment, note, response_date, judged_at)
     VALUES ($1,$2,$3,$4,$5,$6, now())
     ON CONFLICT (keyword_id, platform) DO UPDATE SET genuine=EXCLUDED.genuine, sentiment=EXCLUDED.sentiment, note=EXCLUDED.note, response_date=EXCLUDED.response_date, judged_at=now()`,
    [combo.keyword_id, combo.platform, v.genuine_top === true, v.sentiment ?? null, (v.note ?? "").slice(0, 200), a.d],
  );
  return v.genuine_top === true ? "genuine" : "not_genuine";
}

let done = 0, genuine = 0, notgen = 0, errs = 0;
for (let i = 0; i < combos.length; i += CONCURRENCY) {
  const batch = combos.slice(i, i + CONCURRENCY);
  const res = await Promise.all(batch.map(processOne));
  for (const r of res) {
    done++;
    if (r === "genuine") genuine++;
    else if (r === "not_genuine") notgen++;
    else errs++;
  }
  if (done % 30 === 0 || done === combos.length)
    console.log(`${done}/${combos.length} | genuine=${genuine} not_genuine=${notgen} skipped/err=${errs}`);
}
console.log(`DONE. genuine=${genuine} not_genuine=${notgen} skipped/err=${errs}`);
await c.end();
