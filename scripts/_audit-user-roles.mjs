import pg from "pg";
const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();
const r = await c.query(
  `SELECT id, email, name, role,
          client_id IS NOT NULL as has_client_link
     FROM users
     ORDER BY role, id`,
);
console.log(`${r.rows.length} users total:`);
console.log("─────────────────────────────────────────────────────────");
const byRole = new Map();
for (const row of r.rows) {
  const arr = byRole.get(row.role) ?? [];
  arr.push(row);
  byRole.set(row.role, arr);
}
for (const [role, users] of [...byRole.entries()].sort()) {
  console.log(`\n[${role}] — ${users.length}`);
  for (const u of users) {
    console.log(
      `  #${u.id}  ${u.email.padEnd(35)} ${u.name}${u.has_client_link ? "  (linked to client)" : ""}`,
    );
  }
}
await c.end();
