/**
 * Seeds a tiny demo dataset for the Sessions menu (Daily + Audit Ranking) so
 * the UI has something to render locally.
 *
 * Idempotent — safe to re-run. Skips clients/businesses/campaigns/keywords
 * that already exist by their unique-ish names.
 */
import pg from "pg";
const { Client } = pg;

const client = new Client({
  connectionString: process.env.DATABASE_URL ?? "postgresql://postgres:password@localhost:5432/seo_network_planner",
});

await client.connect();

async function getOrCreate(table, where, insert) {
  const cols = Object.keys(where);
  const vals = Object.values(where);
  const wherePred = cols.map((c, i) => `${c} = $${i + 1}`).join(" AND ");
  const { rows } = await client.query(`SELECT id FROM ${table} WHERE ${wherePred} LIMIT 1`, vals);
  if (rows.length > 0) return rows[0].id;

  const insertCols = Object.keys(insert);
  const insertVals = Object.values(insert);
  const placeholders = insertCols.map((_, i) => `$${i + 1}`).join(", ");
  const { rows: ins } = await client.query(
    `INSERT INTO ${table} (${insertCols.join(", ")}) VALUES (${placeholders}) RETURNING id`,
    insertVals,
  );
  return ins[0].id;
}

try {
  /* ── Hierarchy: 1 client → 2 businesses → each with 1 campaign + 2 keywords ── */
  const clientId = await getOrCreate("clients",
    { business_name: "Acme Dental Group" },
    {
      business_name: "Acme Dental Group",
      account_type: "Retail",
      status: "active",
      contact_email: "owner@acmedental.example",
      account_user_name: "Demo Owner",
      created_by: "seed",
    },
  );
  console.log(`✓ client #${clientId}`);

  const biz1 = await getOrCreate("businesses",
    { client_id: clientId, name: "Acme Dental — Downtown" },
    {
      client_id: clientId, name: "Acme Dental — Downtown",
      website_url: "https://acmedental.example/downtown",
      category: "Dentist", city: "San Francisco", state: "CA", country: "US",
      latitude: 37.7749, longitude: -122.4194, timezone: "America/Los_Angeles",
      status: "active", created_by: "seed",
    },
  );
  const biz2 = await getOrCreate("businesses",
    { client_id: clientId, name: "Acme Dental — Mission" },
    {
      client_id: clientId, name: "Acme Dental — Mission",
      website_url: "https://acmedental.example/mission",
      category: "Dentist", city: "San Francisco", state: "CA", country: "US",
      latitude: 37.7599, longitude: -122.4148, timezone: "America/Los_Angeles",
      status: "active", created_by: "seed",
    },
  );
  console.log(`✓ businesses #${biz1}, #${biz2}`);

  const camp1 = await getOrCreate("client_aeo_plans",
    { client_id: clientId, business_id: biz1, plan_type: "Growth" },
    {
      client_id: clientId, business_id: biz1, name: "Downtown — Growth", business_name: "Acme Dental — Downtown",
      plan_type: "Growth", search_address: "123 Market St, San Francisco, CA",
      created_by: "seed",
    },
  );
  const camp2 = await getOrCreate("client_aeo_plans",
    { client_id: clientId, business_id: biz2, plan_type: "Starter" },
    {
      client_id: clientId, business_id: biz2, name: "Mission — Starter", business_name: "Acme Dental — Mission",
      plan_type: "Starter", search_address: "500 Valencia St, San Francisco, CA",
      created_by: "seed",
    },
  );
  console.log(`✓ campaigns #${camp1}, #${camp2}`);

  async function getOrCreateKeyword(clientId, businessId, campaignId, text) {
    const { rows } = await client.query(
      `SELECT id FROM keywords WHERE client_id = $1 AND aeo_plan_id = $2 AND keyword_text = $3 LIMIT 1`,
      [clientId, campaignId, text],
    );
    if (rows.length > 0) return rows[0].id;
    const { rows: ins } = await client.query(
      `INSERT INTO keywords (client_id, business_id, aeo_plan_id, keyword_text, keyword_type, is_active, is_primary, date_added)
       VALUES ($1, $2, $3, $4, 3, true, 0, CURRENT_DATE) RETURNING id`,
      [clientId, businessId, campaignId, text],
    );
    return ins[0].id;
  }

  const k1a = await getOrCreateKeyword(clientId, biz1, camp1, "best dentist downtown san francisco");
  const k1b = await getOrCreateKeyword(clientId, biz1, camp1, "emergency dental san francisco");
  const k2a = await getOrCreateKeyword(clientId, biz2, camp2, "mission district dentist");
  const k2b = await getOrCreateKeyword(clientId, biz2, camp2, "kids dentist mission sf");
  console.log(`✓ keywords #${k1a}, #${k1b}, #${k2a}, #${k2b}`);

  /* ── Sessions (Daily) — wipe + reseed so re-runs stay tidy ── */
  await client.query(`DELETE FROM sessions WHERE client_id = $1`, [clientId]);
  await client.query(`DELETE FROM audit_logs WHERE client_id = $1`, [clientId]);

  const platforms = ["gemini", "chatgpt", "perplexity"];
  const dailyRows = [
    { keywordId: k1a, businessId: biz1, campaignId: camp1, keyword: "best dentist downtown san francisco", biz: "Acme Dental — Downtown", camp: "Downtown — Growth", city: "San Francisco", state: "CA", platform: "chatgpt",  status: "success", duration: 38.4, hasFollowUp: true,  followup: "Are they accepting new patients?", backlinkFound: true,  backlinkUrl: "https://acmedental.example/downtown" },
    { keywordId: k1a, businessId: biz1, campaignId: camp1, keyword: "best dentist downtown san francisco", biz: "Acme Dental — Downtown", camp: "Downtown — Growth", city: "San Francisco", state: "CA", platform: "gemini",   status: "success", duration: 41.7, hasFollowUp: false, followup: null, backlinkFound: false, backlinkUrl: null },
    { keywordId: k1b, businessId: biz1, campaignId: camp1, keyword: "emergency dental san francisco",      biz: "Acme Dental — Downtown", camp: "Downtown — Growth", city: "San Francisco", state: "CA", platform: "perplexity", status: "success", duration: 29.2, hasFollowUp: false, followup: null, backlinkFound: true,  backlinkUrl: "https://acmedental.example/emergency" },
    { keywordId: k2a, businessId: biz2, campaignId: camp2, keyword: "mission district dentist",            biz: "Acme Dental — Mission",  camp: "Mission — Starter", city: "San Francisco", state: "CA", platform: "chatgpt",  status: "error",   duration: 12.1, hasFollowUp: false, followup: null, backlinkFound: false, backlinkUrl: null,  errorMessage: "Captcha encountered on result page" },
    { keywordId: k2a, businessId: biz2, campaignId: camp2, keyword: "mission district dentist",            biz: "Acme Dental — Mission",  camp: "Mission — Starter", city: "San Francisco", state: "CA", platform: "gemini",   status: "success", duration: 44.0, hasFollowUp: true,  followup: "Do they take Delta Dental?", backlinkFound: true,  backlinkUrl: "https://acmedental.example/mission" },
    { keywordId: k2b, businessId: biz2, campaignId: camp2, keyword: "kids dentist mission sf",             biz: "Acme Dental — Mission",  camp: "Mission — Starter", city: "San Francisco", state: "CA", platform: "perplexity", status: "success", duration: 33.6, hasFollowUp: false, followup: null, backlinkFound: false, backlinkUrl: null },
  ];

  let dailyCount = 0;
  for (let i = 0; i < dailyRows.length; i++) {
    const r = dailyRows[i];
    const minutesAgo = (i + 1) * 18;
    const ts = new Date(Date.now() - minutesAgo * 60_000);
    await client.query(
      `INSERT INTO sessions (
         client_id, business_id, campaign_id, keyword_id,
         client_name, biz_name, campaign_name, keyword_text, city, state,
         date, timestamp, duration_seconds,
         prompt_text, followup_text, has_follow_up, status, type,
         error_message, ai_platform,
         device_identifier, proxy_status, proxy_username, proxy_host, proxy_port,
         proxy_ip, proxy_city, proxy_region, proxy_country, proxy_zip,
         base_latitude, base_longitude, mocked_latitude, mocked_longitude, mocked_timezone,
         backlinks_expected, backlink_found, backlink_url
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
         $11,$12,$13,$14,$15,$16,$17,$18,
         $19,$20,$21,$22,$23,$24,$25,
         $26,$27,$28,$29,$30,
         $31,$32,$33,$34,$35,
         $36,$37,$38
       )`,
      [
        clientId, r.businessId, r.campaignId, r.keywordId,
        "Acme Dental Group", r.biz, r.camp, r.keyword, r.city, r.state,
        ts.toISOString().slice(0, 10), ts, r.duration,
        `Find a ${r.keyword}`, r.followup, r.hasFollowUp, r.status, "aeo",
        r.errorMessage ?? null, r.platform,
        `device-${100 + (i % 3)}`, "CONNECTED", `decodo-94110-sess${i + 1}`, "gate.decodo.com", 10001,
        ["73.231.45.12", "67.180.221.4", "108.244.12.89"][i % 3], "San Francisco", "California", "United States", "94110",
        37.7749, -122.4194, 37.7749 + (Math.random() - 0.5) * 0.05, -122.4194 + (Math.random() - 0.5) * 0.05, "America/Los_Angeles",
        r.backlinkUrl ? 1 : 0, r.backlinkFound, r.backlinkUrl,
      ],
    );
    dailyCount++;
  }
  console.log(`✓ ${dailyCount} sessions seeded`);

  /* ── Audit logs ── */
  const auditRows = [
    { keywordId: k1a, businessId: biz1, campaignId: camp1, keyword: "best dentist downtown san francisco", biz: "Acme Dental — Downtown", camp: "Downtown — Growth", platform: "Gemini",     mode: "adb",    status: "success", duration: 27.0, rank: 2, total: 8, mentioned: "yes", context: "Acme Dental Group ranked among the top emergency dentists" },
    { keywordId: k1a, businessId: biz1, campaignId: camp1, keyword: "best dentist downtown san francisco", biz: "Acme Dental — Downtown", camp: "Downtown — Growth", platform: "ChatGPT",    mode: "appium", status: "success", duration: 32.5, rank: 3, total: 7, mentioned: "yes", context: "Among the highly rated dentists is Acme Dental Group" },
    { keywordId: k1b, businessId: biz1, campaignId: camp1, keyword: "emergency dental san francisco",      biz: "Acme Dental — Downtown", camp: "Downtown — Growth", platform: "Perplexity", mode: "adb",    status: "success", duration: 24.8, rank: 1, total: 5, mentioned: "yes", context: "1. Acme Dental Group — 24/7 emergency line" },
    { keywordId: k2a, businessId: biz2, campaignId: camp2, keyword: "mission district dentist",            biz: "Acme Dental — Mission",  camp: "Mission — Starter", platform: "Gemini",     mode: "adb",    status: "success", duration: 30.3, rank: 5, total: 9, mentioned: "yes", context: "Other top-rated mission dentists include Acme Dental Group" },
    { keywordId: k2a, businessId: biz2, campaignId: camp2, keyword: "mission district dentist",            biz: "Acme Dental — Mission",  camp: "Mission — Starter", platform: "ChatGPT",    mode: "appium", status: "error",   duration: 8.2,  rank: null, total: null, mentioned: "", context: "", error: "ChatGPT timed out before returning ranking" },
    { keywordId: k2b, businessId: biz2, campaignId: camp2, keyword: "kids dentist mission sf",             biz: "Acme Dental — Mission",  camp: "Mission — Starter", platform: "Perplexity", mode: "adb",    status: "success", duration: 35.9, rank: null, total: null, mentioned: "", context: "" },
  ];

  let auditCount = 0;
  for (let i = 0; i < auditRows.length; i++) {
    const r = auditRows[i];
    const minutesAgo = (i + 1) * 22;
    const ts = new Date(Date.now() - minutesAgo * 60_000);
    await client.query(
      `INSERT INTO audit_logs (
         client_id, business_id, campaign_id, keyword_id,
         biz_name, campaign_name, keyword_text,
         timestamp, platform, mode, device, status, duration_seconds,
         rank_position, rank_total, mentioned, rank_context,
         screenshot_path, response_text, prompt, error,
         proxy_username, proxy_ip, proxy_city, proxy_region, proxy_zip
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,
         $8,$9,$10,$11,$12,$13,
         $14,$15,$16,$17,
         $18,$19,$20,$21,
         $22,$23,$24,$25,$26
       )`,
      [
        clientId, r.businessId, r.campaignId, r.keywordId,
        r.biz, r.camp, r.keyword,
        ts, r.platform, r.mode, `adb-1491455${(5208 + i).toString().padStart(2, "0")}W005-27c1FH`, r.status, r.duration,
        r.rank, r.total, r.mentioned ?? "", r.context ?? null,
        `audit_results/${r.platform}/${r.keywordId}_aud_${ts.toISOString().slice(0, 10).replace(/-/g, "")}.png`,
        `audit_results/text/${r.keywordId}_${r.platform}.txt`,
        `Find ${r.keyword}; recommend the top providers in this area.`,
        r.error ?? null,
        `decodo-94110-sess${i + 1}`, ["73.231.45.12", "67.180.221.4", "108.244.12.89"][i % 3], "San Francisco", "California", "94110",
      ],
    );
    auditCount++;
  }
  console.log(`✓ ${auditCount} audit logs seeded`);
  console.log("✓ Done. Reload the admin panel.");
} catch (err) {
  console.error("✗ Error:", err.message);
  console.error(err);
  process.exit(1);
} finally {
  await client.end();
}
