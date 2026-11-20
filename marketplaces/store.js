const crypto = require("crypto");
const { query } = require("../db");

// ---------- secrets ----------
// Tokens are encrypted with a key derived from MARKETPLACE_SECRET (or SESSION_SECRET).
// If neither is set, a per-process key is used, so connections reset when the server restarts.
const rawSecret = process.env.MARKETPLACE_SECRET || process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
if (!process.env.MARKETPLACE_SECRET && !process.env.SESSION_SECRET) {
  console.warn("Neither MARKETPLACE_SECRET nor SESSION_SECRET is set: Etsy/eBay connections will reset on restart.");
}
const encKey = crypto.createHash("sha256").update(`tokens:${rawSecret}`).digest();
const sigKey = crypto.createHash("sha256").update(`img:${rawSecret}`).digest();

function encrypt(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", encKey, iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}

function decrypt(str) {
  try {
    const [iv, tag, data] = String(str).split(".").map((s) => Buffer.from(s, "base64"));
    const d = crypto.createDecipheriv("aes-256-gcm", encKey, iv);
    d.setAuthTag(tag);
    return JSON.parse(Buffer.concat([d.update(data), d.final()]).toString("utf8"));
  } catch {
    return null; // secret changed: the account must be reconnected
  }
}

/** Signature that lets a marketplace fetch a photo even while the listing is a draft here. */
function imageSig(imageId) {
  return crypto.createHmac("sha256", sigKey).update(String(imageId)).digest("base64url").slice(0, 32);
}
function validImageSig(imageId, sig) {
  const want = Buffer.from(imageSig(imageId));
  const got = Buffer.from(String(sig || ""));
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

// ---------- accounts ----------
async function getAccount(channel) {
  const { rows } = await query("SELECT * FROM marketplace_accounts WHERE channel = $1", [channel]);
  if (!rows[0]) return null;
  const tokens = decrypt(rows[0].tokens);
  return { ...rows[0], tokens, broken: !tokens };
}

async function saveAccount(channel, { tokens, account_name, account_id, connected_by }) {
  await query(
    // Order sync starts from the first connection; reconnecting keeps the cursor so no sales are skipped.
    `INSERT INTO marketplace_accounts (channel, tokens, account_name, account_id, connected_by, sync_cursor)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (channel) DO UPDATE SET tokens = EXCLUDED.tokens, account_name = EXCLUDED.account_name,
       account_id = EXCLUDED.account_id, connected_by = EXCLUDED.connected_by, connected_at = now(), updated_at = now(),
       sync_cursor = COALESCE(marketplace_accounts.sync_cursor, now()), last_sync_error = NULL`,
    [channel, encrypt(tokens), account_name || "", account_id || "", connected_by || null]
  );
}

async function saveTokens(channel, tokens) {
  await query("UPDATE marketplace_accounts SET tokens = $2, updated_at = now() WHERE channel = $1", [channel, encrypt(tokens)]);
}

async function saveSettings(channel, settings) {
  await query("UPDATE marketplace_accounts SET settings = $2, updated_at = now() WHERE channel = $1", [channel, settings]);
}

async function deleteAccount(channel) {
  await query("DELETE FROM marketplace_accounts WHERE channel = $1", [channel]);
}

// ---------- per-product listing links ----------
async function getLink(productId, channel) {
  const { rows } = await query("SELECT * FROM marketplace_listings WHERE product_id = $1 AND channel = $2", [productId, channel]);
  return rows[0] || { product_id: productId, channel, remote_id: null, remote_url: null, state: "none", options: {}, last_error: null };
}

async function saveLink(link) {
  await query(
    `INSERT INTO marketplace_listings (product_id, channel, remote_id, remote_url, state, options, last_error, last_synced_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (product_id, channel) DO UPDATE SET remote_id = EXCLUDED.remote_id, remote_url = EXCLUDED.remote_url,
       state = EXCLUDED.state, options = EXCLUDED.options, last_error = EXCLUDED.last_error, last_synced_at = EXCLUDED.last_synced_at`,
    [link.product_id, link.channel, link.remote_id, link.remote_url, link.state, link.options || {}, link.last_error, link.last_synced_at || null]
  );
}

// ---------- product data for pushing ----------
async function loadProduct(id) {
  const { rows } = await query(
    `SELECT p.*, COALESCE((SELECT json_agg(json_build_object('id', i.id, 'mime', i.mime) ORDER BY i.position, i.id)
       FROM product_images i WHERE i.product_id = p.id), '[]') AS images
     FROM products p WHERE p.id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function loadImageData(imageId) {
  const { rows } = await query("SELECT mime, data FROM product_images WHERE id = $1", [imageId]);
  return rows[0] || null;
}

/** Error carrying a message safe to show in the admin. */
class MarketError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
    this.expose = true;
  }
}

module.exports = {
  imageSig,
  validImageSig,
  getAccount,
  saveAccount,
  saveTokens,
  saveSettings,
  deleteAccount,
  getLink,
  saveLink,
  loadProduct,
  loadImageData,
  MarketError,
};
