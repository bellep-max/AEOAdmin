// Seed realistic dummy data for the customer portal demo.
//
// Idempotent: re-running deletes the previous demo user/client (and cascades
// through businesses → campaigns → keywords → keyword_links → ranking_reports)
// before re-inserting.
//
// Usage: node --env-file=.env scripts/seed-portal-demo.mjs

import pg from "pg";
import crypto from "crypto";

const DEMO_EMAIL = "demo@acme.test";
const DEMO_PASSWORD = "demo1234";
const DEMO_NAME = "Demo Acme";
const DEMO_CLIENT_BUSINESS_NAME = "Acme Roasters Inc.";

const PLATFORMS = ["chatgpt", "gemini", "perplexity"];

function hashPassword(password) {
  const salt = process.env.SESSION_SECRET ?? "signal-aeo-dev-secret";
  return crypto.createHmac("sha256", salt).update(password).digest("hex");
}

function isoUtc(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function deleteExistingDemo(db) {
  const { rows } = await db.query(
    `SELECT id, client_id FROM users WHERE email = $1`,
    [DEMO_EMAIL],
  );
  if (rows.length === 0) return;

  const userRow = rows[0];
  const clientId = userRow.client_id;

  // Unlink user.client_id first so the clients delete won't FK-block.
  await db.query(`UPDATE users SET client_id = NULL WHERE id = $1`, [userRow.id]);
  await db.query(`DELETE FROM users WHERE id = $1`, [userRow.id]);

  if (clientId != null) {
    // ON DELETE CASCADE on businesses → keywords → keyword_links → ranking_reports
    // and on client_aeo_plans. So a single client delete clears the whole tree.
    await db.query(`DELETE FROM clients WHERE id = $1`, [clientId]);
  }
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("DATABASE_URL is not set. Run with: node --env-file=.env scripts/seed-portal-demo.mjs");
    process.exit(1);
  }

  const db = new pg.Client({ connectionString: dbUrl });
  await db.connect();

  try {
    await db.query("BEGIN");

    await deleteExistingDemo(db);

    // ── clients ────────────────────────────────────────────────────────────
    const { rows: [clientRow] } = await db.query(
      `INSERT INTO clients (
         business_name, contact_email, account_user, account_user_name, status,
         city, state, timezone, plan_name, created_by
       ) VALUES (
         $1, $2, $3, $4, 'active',
         'San Francisco', 'CA', 'America/Los_Angeles', 'Growth', 'seed-portal-demo'
       )
       RETURNING id`,
      [DEMO_CLIENT_BUSINESS_NAME, DEMO_EMAIL, DEMO_NAME, DEMO_NAME],
    );
    const clientId = clientRow.id;

    // ── users (linked to client) ───────────────────────────────────────────
    const { rows: [userRow] } = await db.query(
      `INSERT INTO users (email, password_hash, name, role, client_id)
       VALUES ($1, $2, $3, 'customer', $4)
       RETURNING id`,
      [DEMO_EMAIL, hashPassword(DEMO_PASSWORD), DEMO_NAME, clientId],
    );
    const userId = userRow.id;

    // ── businesses ─────────────────────────────────────────────────────────
    const businessSeeds = [
      {
        key: "downtown",
        name: "Acme Coffee Roasters — Downtown",
        gmbUrl: "https://maps.app.goo.gl/abc1",
        publishedAddress: "123 Market St, San Francisco, CA",
        city: "San Francisco",
        state: "CA",
        country: "US",
        placeId: "ChIJDOWNTOWN001",
        websiteUrl: "https://acmeroasters.com/downtown",
        timezone: "America/Los_Angeles",
      },
      {
        key: "mission",
        name: "Acme Coffee Roasters — Mission",
        gmbUrl: "https://maps.app.goo.gl/abc2",
        publishedAddress: "456 Valencia St, San Francisco, CA",
        city: "San Francisco",
        state: "CA",
        country: "US",
        placeId: "ChIJMISSION002",
        websiteUrl: "https://acmeroasters.com/mission",
        timezone: "America/Los_Angeles",
      },
      {
        key: "berkeley",
        name: "Acme Coffee Roasters — Berkeley",
        gmbUrl: "https://maps.app.goo.gl/abc3",
        publishedAddress: "789 Telegraph Ave, Berkeley, CA",
        city: "Berkeley",
        state: "CA",
        country: "US",
        placeId: "ChIJBERKELEY003",
        websiteUrl: "https://acmeroasters.com/berkeley",
        timezone: "America/Los_Angeles",
      },
    ];

    const businessIdByKey = {};
    for (const b of businessSeeds) {
      const { rows: [row] } = await db.query(
        `INSERT INTO businesses (
           client_id, name, gmb_url, website_url, category, published_address,
           city, state, country, place_id, timezone, status, created_by
         ) VALUES (
           $1, $2, $3, $4, 'Coffee shop', $5,
           $6, $7, $8, $9, $10, 'active', 'seed-portal-demo'
         )
         RETURNING id`,
        [
          clientId, b.name, b.gmbUrl, b.websiteUrl, b.publishedAddress,
          b.city, b.state, b.country, b.placeId, b.timezone,
        ],
      );
      businessIdByKey[b.key] = { id: row.id, name: b.name, websiteUrl: b.websiteUrl };
    }

    // ── campaigns (client_aeo_plans) ───────────────────────────────────────
    const campaignSeeds = [
      {
        name: "Downtown SF Visibility Q2",
        businessKey: "downtown",
        planType: "growth",
        budget: 1500,
        questions: [
          "best coffee shop downtown SF",
          "specialty coffee near financial district",
          "cafes with outdoor seating SF",
        ],
        keywords: ["best coffee shop SF", "downtown SF coffee", "specialty coffee FiDi"],
      },
      {
        name: "Mission District Push",
        businessKey: "mission",
        planType: "starter",
        budget: 800,
        questions: ["best coffee in Mission District", "brunch coffee shops Mission SF"],
        keywords: ["Mission coffee SF", "Valencia street coffee"],
      },
      {
        name: "Berkeley Brand Awareness",
        businessKey: "berkeley",
        planType: "growth",
        budget: 1200,
        questions: ["best coffee Berkeley", "independent cafes Berkeley near UC"],
        keywords: ["Berkeley coffee", "UC Berkeley cafes", "best coffee Telegraph Ave"],
      },
      {
        name: "Catering & Wholesale",
        businessKey: "downtown",
        planType: "enterprise",
        budget: 2500,
        questions: ["coffee catering San Francisco", "wholesale coffee bean suppliers Bay Area"],
        keywords: ["SF coffee catering", "wholesale coffee Bay Area", "office coffee SF"],
      },
      {
        name: "New Product — Cold Brew Line",
        businessKey: "mission",
        planType: "growth",
        budget: 900,
        questions: ["best cold brew San Francisco", "organic cold brew coffee Mission"],
        keywords: ["best cold brew SF", "organic cold brew", "cold brew Mission"],
      },
    ];

    const campaignIds = [];
    for (const c of campaignSeeds) {
      const biz = businessIdByKey[c.businessKey];
      const { rows: [row] } = await db.query(
        `INSERT INTO client_aeo_plans (
           client_id, business_id, name, business_name, plan_type,
           sample_question_1, sample_question_2, sample_question_3,
           current_answer_presence, search_boost_target, monthly_aeo_budget,
           schema_implementor, search_address, created_by
         ) VALUES (
           $1, $2, $3, $4, $5,
           $6, $7, $8,
           $9, $10, $11,
           'us', $12, 'seed-portal-demo'
         )
         RETURNING id`,
        [
          clientId, biz.id, c.name, biz.name, c.planType,
          c.questions[0] ?? null, c.questions[1] ?? null, c.questions[2] ?? null,
          `${randInt(5, 35)}%`, randInt(50, 500), c.budget,
          businessSeeds.find((b) => b.key === c.businessKey).publishedAddress,
        ],
      );
      campaignIds.push({ id: row.id, businessId: biz.id, businessName: biz.name, websiteUrl: biz.websiteUrl, keywords: c.keywords });
    }

    // ── keywords ───────────────────────────────────────────────────────────
    const keywordRecords = [];
    let kwIndex = 0;
    for (const camp of campaignIds) {
      for (let i = 0; i < camp.keywords.length; i += 1) {
        const text = camp.keywords[i];
        const isPrimary = i === 0 ? 1 : 0;
        const verificationStatus = kwIndex % 2 === 0 ? "verified" : "pending";
        kwIndex += 1;

        const { rows: [row] } = await db.query(
          `INSERT INTO keywords (
             client_id, business_id, aeo_plan_id, keyword_text, keyword_type,
             is_primary, is_active, verification_status, status, date_added
           ) VALUES (
             $1, $2, $3, $4, 1,
             $5, true, $6, 'active', CURRENT_DATE
           )
           RETURNING id`,
          [clientId, camp.businessId, camp.id, text, isPrimary, verificationStatus],
        );
        keywordRecords.push({
          id: row.id,
          text,
          businessId: camp.businessId,
          businessName: camp.businessName,
          websiteUrl: camp.websiteUrl,
        });
      }
    }

    // ── keyword_links ──────────────────────────────────────────────────────
    let linkCount = 0;
    for (const kw of keywordRecords) {
      // Each keyword gets 1-3 links.
      const linkSeeds = [
        { url: kw.websiteUrl, label: "website" },
      ];
      const extras = randInt(0, 2);
      if (extras >= 1) {
        linkSeeds.push({
          url: `https://www.yelp.com/biz/acme-coffee-${kw.businessName.toLowerCase().includes("berkeley") ? "berkeley" : "sf"}`,
          label: "directory",
        });
      }
      if (extras >= 2) {
        linkSeeds.push({
          url: `https://www.tripadvisor.com/Restaurant_Review-acme-${kw.id}`,
          label: "directory",
        });
      }

      for (const link of linkSeeds) {
        await db.query(
          `INSERT INTO keyword_links (
             keyword_id, link_url, link_type_label, link_active
           ) VALUES ($1, $2, $3, true)`,
          [kw.id, link.url, link.label],
        );
        linkCount += 1;
      }
    }

    // ── ranking_reports ────────────────────────────────────────────────────
    // Sprinkle ~35 rows across keywords + platforms + last 30 days.
    const REPORT_COUNT = 36;
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    // First, give each keyword one "initial ranking" (~5 total selected at random).
    const initialKwIds = new Set();
    while (initialKwIds.size < Math.min(5, keywordRecords.length)) {
      initialKwIds.add(pickRandom(keywordRecords).id);
    }

    let reportCount = 0;
    for (let i = 0; i < REPORT_COUNT; i += 1) {
      const kw = pickRandom(keywordRecords);
      const platform = PLATFORMS[i % PLATFORMS.length];
      const daysAgo = randInt(0, 29);
      const ts = new Date(now - daysAgo * dayMs - randInt(0, 12) * 60 * 60 * 1000);
      const dateStr = ts.toISOString().slice(0, 10);

      // ~85% success, ~15% error
      const isError = Math.random() < 0.15;
      const status = isError ? "error" : "success";

      // Ranked vs not-ranked among successes
      const ranked = !isError && Math.random() < 0.75;
      const rankingPosition = ranked ? randInt(1, 30) : null;
      const rankingTotal = ranked ? "50" : null;
      const mapsPresence = ranked && Math.random() < 0.5 ? "true" : "false";

      const isInitial = initialKwIds.has(kw.id) && Math.random() < 0.4;
      if (isInitial) initialKwIds.delete(kw.id);

      await db.query(
        `INSERT INTO ranking_reports (
           client_id, business_id, keyword_id,
           client_name, biz_name, keyword,
           timestamp, date, platform,
           status, duration_seconds,
           ranking_position, ranking_total,
           maps_presence, is_initial_ranking,
           reason_recommended,
           failure_step, error,
           created_at
         ) VALUES (
           $1, $2, $3,
           $4, $5, $6,
           $7, $8, $9,
           $10, $11,
           $12, $13,
           $14, $15,
           $16,
           $17, $18,
           $19
         )`,
        [
          clientId, kw.businessId, kw.id,
          DEMO_CLIENT_BUSINESS_NAME, kw.businessName, kw.text,
          isoUtc(ts), dateStr, platform,
          status, randInt(10, 60),
          rankingPosition, rankingTotal,
          mapsPresence, isInitial,
          ranked ? `Cited in answer for "${kw.text}" — recommended for proximity, reviews, and menu match.` : null,
          isError ? "search" : null,
          isError ? "Timed out waiting for answer panel" : null,
          isoUtc(ts),
        ],
      );
      reportCount += 1;
    }

    await db.query("COMMIT");

    // ── Verification counts ────────────────────────────────────────────────
    const counts = {};
    for (const t of ["businesses", "client_aeo_plans", "keywords", "ranking_reports"]) {
      const { rows } = await db.query(
        `SELECT COUNT(*)::int AS n FROM ${t} WHERE client_id = $1`,
        [clientId],
      );
      counts[t] = rows[0].n;
    }
    const { rows: linkRows } = await db.query(
      `SELECT COUNT(*)::int AS n
       FROM keyword_links kl
       JOIN keywords k ON k.id = kl.keyword_id
       WHERE k.client_id = $1`,
      [clientId],
    );
    counts.keyword_links = linkRows[0].n;

    console.log("Seeded:");
    console.log(`  user        id=${userId} email=${DEMO_EMAIL} password=${DEMO_PASSWORD}`);
    console.log(`  client      id=${clientId} "${DEMO_CLIENT_BUSINESS_NAME}"`);
    console.log(`  businesses  ${counts.businesses} inserted`);
    console.log(`  campaigns   ${counts.client_aeo_plans} inserted`);
    console.log(`  keywords    ${counts.keywords} inserted`);
    console.log(`  links       ${counts.keyword_links} inserted`);
    console.log(`  reports     ${counts.ranking_reports} inserted`);
  } catch (err) {
    await db.query("ROLLBACK").catch(() => {});
    console.error("Seed failed:", err);
    process.exit(1);
  } finally {
    await db.end();
  }
}

main();
