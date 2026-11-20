const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.warn("DATABASE_URL is not set. The admin and listings API will not work until it is.");
}

// Render's *internal* URL needs no SSL; the external URL (…render.com) does.
const url = process.env.DATABASE_URL || "";
const needsSsl = process.env.PGSSL === "true" || /render\.com/.test(url);

const pool = new Pool({
  connectionString: url || undefined,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  max: 5,
});

const query = (text, params) => pool.query(text, params);

async function migrate() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      name          TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('owner','staff')),
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS products (
      id           SERIAL PRIMARY KEY,
      slug         TEXT NOT NULL UNIQUE,
      name         TEXT NOT NULL,
      type         TEXT NOT NULL DEFAULT 'raw' CHECK (type IN ('orb','tower','figure','raw','cluster')),
      material     TEXT NOT NULL DEFAULT '',
      style        TEXT NOT NULL DEFAULT 'amethyst',
      description  TEXT NOT NULL DEFAULT '',
      note         TEXT NOT NULL DEFAULT '',
      price_cents  INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
      stock        INTEGER NOT NULL DEFAULT 1 CHECK (stock >= 0),
      tag          TEXT NOT NULL DEFAULT '',
      status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','sold')),
      created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS product_images (
      id          SERIAL PRIMARY KEY,
      product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      mime        TEXT NOT NULL,
      data        BYTEA NOT NULL,
      bytes       INTEGER NOT NULL,
      position    INTEGER NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS product_images_product_idx ON product_images(product_id, position);
    CREATE INDEX IF NOT EXISTS products_status_idx ON products(status, created_at DESC);

    -- Connected Etsy / eBay seller accounts (tokens are encrypted at rest)
    CREATE TABLE IF NOT EXISTS marketplace_accounts (
      channel        TEXT PRIMARY KEY CHECK (channel IN ('etsy','ebay')),
      account_name   TEXT NOT NULL DEFAULT '',
      account_id     TEXT NOT NULL DEFAULT '',
      tokens         TEXT NOT NULL,
      settings       JSONB NOT NULL DEFAULT '{}',
      connected_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
      connected_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- One row per product per marketplace it has been pushed to
    CREATE TABLE IF NOT EXISTS marketplace_listings (
      product_id     INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      channel        TEXT NOT NULL CHECK (channel IN ('etsy','ebay')),
      remote_id      TEXT,
      remote_url     TEXT,
      state          TEXT NOT NULL DEFAULT 'none',
      options        JSONB NOT NULL DEFAULT '{}',
      last_error     TEXT,
      last_synced_at TIMESTAMPTZ,
      PRIMARY KEY (product_id, channel)
    );

    -- Order sync: where each account's order polling is up to
    ALTER TABLE marketplace_accounts ADD COLUMN IF NOT EXISTS sync_cursor TIMESTAMPTZ;
    ALTER TABLE marketplace_accounts ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ;
    ALTER TABLE marketplace_accounts ADD COLUMN IF NOT EXISTS last_sync_error TEXT;

    -- Every marketplace order line we've counted against stock (makes syncing safe to repeat)
    CREATE TABLE IF NOT EXISTS marketplace_sales (
      channel     TEXT NOT NULL,
      line_id     TEXT NOT NULL,
      order_id    TEXT NOT NULL,
      product_id  INTEGER REFERENCES products(id) ON DELETE SET NULL,
      title       TEXT NOT NULL DEFAULT '',
      quantity    INTEGER NOT NULL,
      sold_at     TIMESTAMPTZ NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (channel, line_id)
    );
    CREATE INDEX IF NOT EXISTS marketplace_sales_recent_idx ON marketplace_sales(sold_at DESC);
  `);
}

module.exports = { pool, query, migrate };
