import pkg from 'pg';
const { Pool } = pkg;
import crypto from 'crypto';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/seo_network_planner';
const SESSION_SECRET = process.env.SESSION_SECRET || 'signal-aeo-dev-secret';

const pool = new Pool({ connectionString: DATABASE_URL });

async function createTables() {
  console.log('Creating database tables...');
  
  // Create users table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(512) NOT NULL,
      name VARCHAR(255) NOT NULL,
      role VARCHAR(50) NOT NULL DEFAULT 'admin',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // Create clients table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS clients (
      id SERIAL PRIMARY KEY,
      business_name VARCHAR(255) NOT NULL,
      gmb_url VARCHAR(512),
      website_url VARCHAR(512),
      published_address TEXT,
      search_address TEXT,
      city VARCHAR(255),
      state VARCHAR(100),
      status VARCHAR(50) DEFAULT 'active',
      plan_name VARCHAR(255),
      address_type INTEGER DEFAULT 1,
      place_id VARCHAR(512),
      location_ref VARCHAR(512),
      contact_email VARCHAR(255),
      website_published_on_gmb VARCHAR(50),
      website_linked_on_gmb VARCHAR(50),
      account_user VARCHAR(255),
      account_type VARCHAR(50),
      account_user_name VARCHAR(255),
      account_email VARCHAR(255),
      billing_email VARCHAR(255),
      start_date VARCHAR(50),
      next_bill_date VARCHAR(50),
      subscription_id VARCHAR(255),
      last_four_card VARCHAR(4),
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      timezone VARCHAR(100),
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // Create keywords table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS keywords (
      id SERIAL PRIMARY KEY,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      keyword_text VARCHAR(512) NOT NULL,
      keyword_type INTEGER DEFAULT 3,
      is_primary BOOLEAN DEFAULT false,
      is_active BOOLEAN DEFAULT true,
      date_added DATE DEFAULT CURRENT_DATE,
      initial_search_count_30_days INTEGER DEFAULT 0,
      followup_search_count_30_days INTEGER DEFAULT 0,
      initial_search_count_life INTEGER DEFAULT 0,
      followup_search_count_life INTEGER DEFAULT 0,
      verification_status VARCHAR(50),
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // Create keyword_links table (multiple links per keyword)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS keyword_links (
      id SERIAL PRIMARY KEY,
      keyword_id INTEGER NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
      link_url TEXT,
      link_type_label VARCHAR(100),
      link_active BOOLEAN DEFAULT true,
      initial_rank_report_link VARCHAR(512),
      current_rank_report_link VARCHAR(512),
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // Create session_platforms table (for tracking searches per platform)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS session_platforms (
      id SERIAL PRIMARY KEY,
      keyword_id INTEGER REFERENCES keywords(id) ON DELETE CASCADE,
      platform VARCHAR(50) NOT NULL,
      search_count_30_days INTEGER DEFAULT 0,
      search_count_life INTEGER DEFAULT 0,
      last_searched TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // Create devices table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS devices (
      id SERIAL PRIMARY KEY,
      device_name VARCHAR(255) NOT NULL,
      model VARCHAR(255),
      status VARCHAR(50) DEFAULT 'Available',
      retired_today BOOLEAN DEFAULT false,
      last_used TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // Create proxies table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS proxies (
      id SERIAL PRIMARY KEY,
      proxy_url VARCHAR(512) NOT NULL,
      proxy_type VARCHAR(50),
      status VARCHAR(50) DEFAULT 'active',
      last_used TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // Create plans table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS plans (
      id SERIAL PRIMARY KEY,
      plan_name VARCHAR(255) NOT NULL,
      price DECIMAL(10, 2),
      billing_period VARCHAR(50),
      features TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // Create service_tiers table (AEO plans and pricing tiers)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS service_tiers (
      id SERIAL PRIMARY KEY,
      tier_name VARCHAR(255) NOT NULL,
      tier_label VARCHAR(100) NOT NULL UNIQUE,
      description TEXT,
      monthly_price DECIMAL(10, 2),
      keyword_limit INTEGER,
      searches_per_day INTEGER,
      searches_per_month INTEGER,
      devices_included INTEGER,
      features TEXT,
      is_active BOOLEAN DEFAULT true,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // Create client_service_tiers table (client tier assignments)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS client_service_tiers (
      id SERIAL PRIMARY KEY,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      tier_id INTEGER NOT NULL REFERENCES service_tiers(id) ON DELETE RESTRICT,
      start_date TIMESTAMP DEFAULT NOW(),
      end_date TIMESTAMP,
      is_active BOOLEAN DEFAULT true,
      custom_price DECIMAL(10, 2),
      custom_keyword_limit INTEGER,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // Create sessions table (for AEO sessions, not express sessions)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
      device_id INTEGER REFERENCES devices(id) ON DELETE SET NULL,
      proxy_id INTEGER REFERENCES proxies(id) ON DELETE SET NULL,
      ai_platform VARCHAR(50),
      type VARCHAR(50) DEFAULT 'aeo',
      error_class TEXT,
      keyword_used VARCHAR(512),
      prompt_type VARCHAR(100),
      session_date TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // Create ranking_reports table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ranking_reports (
      id SERIAL PRIMARY KEY,
      client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
      keyword_id INTEGER REFERENCES keywords(id) ON DELETE CASCADE,
      ranking_position INTEGER,
      reason_recommended TEXT,
      maps_presence BOOLEAN DEFAULT FALSE,
      maps_url TEXT,
      is_initial_ranking BOOLEAN DEFAULT FALSE,
      platform VARCHAR(50),
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // Create tasks table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      title VARCHAR(512) NOT NULL,
      description TEXT,
      status VARCHAR(50) DEFAULT 'todo',
      priority VARCHAR(50),
      assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  console.log('✓ Tables created successfully');
}

async function seedAdmin() {
  console.log('Seeding admin user...');
  
  const passwordHash = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update('Admin123!')
    .digest('hex');

  await pool.query(`
    INSERT INTO users (email, password_hash, name, role)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (email) DO UPDATE
    SET password_hash = EXCLUDED.password_hash,
        name = EXCLUDED.name
  `, ['admin@signalaeo.com', passwordHash, 'Signal AEO Admin', 'admin']);

  console.log('✓ Admin user created');
  console.log('  Email: admin@signalaeo.com');
  console.log('  Password: Admin123!');
}

async function main() {
  try {
    console.log('Setting up database...\n');
    await createTables();
    await seedAdmin();
    console.log('\n✓ Database setup complete!');
    process.exit(0);
  } catch (error) {
    console.error('Error setting up database:', error);
    process.exit(1);
  }
}

main();
