import pg from "pg";
const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

// Pre-check — don't double-insert if the row already exists.
const existing = await c.query(
  "SELECT id, email, role FROM users WHERE email = $1",
  ["sales@signalaeo.com"],
);
if (existing.rowCount > 0) {
  console.log("User already exists:", existing.rows[0]);
  console.log("If you need to reset the password, run the password-update SQL separately.");
  await c.end();
  process.exit(0);
}

const PASSWORD_HASH =
  "78f357ab33ab47e66c9be7beb26f8cb3fd56f7ab42a43ceeb541f6ad261ef4dc";

const result = await c.query(
  `INSERT INTO users (email, password_hash, name, role)
   VALUES ($1, $2, $3, $4)
   RETURNING id, email, name, role`,
  ["sales@signalaeo.com", PASSWORD_HASH, "Sales Team", "sales"],
);
console.log("Sales user created:", result.rows[0]);
await c.end();
