import pg from "pg";
const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

// Match across clients + businesses. Country lives on businesses; address fields
// on clients may also have a province-like value. Cast a wide net.
const r = await c.query(`
  SELECT c.id AS client_id,
         c.business_name AS client_name,
         c.account_email,
         c.city AS client_city,
         c.state AS client_state,
         b.id AS business_id,
         b.name AS business_name,
         b.city AS biz_city,
         b.state AS biz_state,
         b.country AS biz_country
  FROM clients c
  LEFT JOIN businesses b ON b.client_id = c.id
  WHERE b.country ILIKE '%canada%' OR b.country = 'CA'
     OR b.state IN ('Ontario','Quebec','British Columbia','Alberta','Manitoba',
                    'Saskatchewan','Nova Scotia','New Brunswick','Newfoundland',
                    'Newfoundland and Labrador','Prince Edward Island','PEI',
                    'Yukon','Northwest Territories','Nunavut',
                    'ON','QC','BC','AB','MB','SK','NS','NB','NL','PE','YT','NT','NU')
     OR c.state IN ('Ontario','Quebec','British Columbia','Alberta','Manitoba',
                    'Saskatchewan','Nova Scotia','New Brunswick','Newfoundland',
                    'Newfoundland and Labrador','Prince Edward Island','PEI',
                    'Yukon','Northwest Territories','Nunavut',
                    'ON','QC','BC','AB','MB','SK','NS','NB','NL','PE','YT','NT','NU')
  ORDER BY c.id
`);

console.log(`Canada matches: ${r.rowCount}`);
for (const row of r.rows) {
  console.log(`  client #${row.client_id} "${row.client_name}"  (${row.account_email ?? "—"})`);
  console.log(`    client.city/state: ${row.client_city ?? "—"} / ${row.client_state ?? "—"}`);
  if (row.business_id) {
    console.log(`    business #${row.business_id} "${row.business_name}"  loc: ${row.biz_city ?? "—"} / ${row.biz_state ?? "—"} / ${row.biz_country ?? "—"}`);
  }
}
await c.end();
