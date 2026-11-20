// Sales sync: reads new orders from Etsy and eBay, takes them off stock here,
// and passes the new stock to the other marketplaces so an item can't sell twice.
const { pool, query } = require("../db");
const store = require("./store");

const CHANNELS = { etsy: require("./etsy"), ebay: require("./ebay") };
const OVERLAP_MS = 2 * 60 * 60 * 1000; // re-read the last 2h each run: orders can show up late
const LOCK_ID = 727_001; // Postgres advisory lock so only one server instance syncs at a time

const liveRemote = (link) => Boolean(link.remote_id || (link.options && link.options.offer_id));

/** Push one product's current stock to every connected marketplace it's listed on (except `except`). */
async function pushQuantity(productId, { except } = {}) {
  const p = await store.loadProduct(productId);
  if (!p) return;
  const qty = p.status === "sold" ? 0 : p.stock;
  for (const [key, ch] of Object.entries(CHANNELS)) {
    if (key === except) continue;
    const link = await store.getLink(productId, key);
    if (!liveRemote(link) || link.state === "none") continue;
    const account = await store.getAccount(key);
    if (!account || account.broken) continue;
    try {
      await ch.setQuantity(account, link, p, qty);
      link.last_error = null;
      link.last_synced_at = new Date();
    } catch (e) {
      link.last_error = `Stock sync: ${e.expose ? e.message : "could not update the quantity."}`;
      if (!e.expose) console.error(e);
    }
    await store.saveLink(link);
  }
}

/** Find which of our products an order line belongs to. */
async function matchProduct(channel, line) {
  const skuMatch = /^ss-(\d+)$/.exec(line.sku || "");
  if (skuMatch) {
    const { rows } = await query("SELECT id FROM products WHERE id = $1", [skuMatch[1]]);
    if (rows[0]) return rows[0].id;
  }
  if (line.remote_listing_id) {
    const { rows } = await query("SELECT product_id FROM marketplace_listings WHERE channel = $1 AND remote_id = $2", [channel, line.remote_listing_id]);
    if (rows[0]) return rows[0].product_id;
  }
  return null;
}

/** Record one order line and take it off stock. Returns the product id if stock changed. */
async function applySale(channel, line) {
  const productId = await matchProduct(channel, line);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ins = await client.query(
      `INSERT INTO marketplace_sales (channel, line_id, order_id, product_id, title, quantity, sold_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (channel, line_id) DO NOTHING RETURNING line_id`,
      [channel, line.line_id, line.order_id, productId, String(line.title || "").slice(0, 200), line.quantity, line.sold_at]
    );
    let changed = null;
    if (ins.rows[0] && productId) {
      await client.query(
        `UPDATE products SET
           stock = GREATEST(stock - $2, 0),
           status = CASE WHEN stock - $2 <= 0 AND status = 'published' THEN 'sold' ELSE status END,
           updated_at = now()
         WHERE id = $1`,
        [productId, line.quantity]
      );
      changed = productId;
    }
    await client.query("COMMIT");
    return changed;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function syncChannel(key) {
  const ch = CHANNELS[key];
  const account = await store.getAccount(key);
  if (!account || account.broken) return { channel: key, skipped: true };
  if (!ch.canReadOrders(account)) {
    await query("UPDATE marketplace_accounts SET last_sync_error = $2 WHERE channel = $1", [key, `Reconnect ${ch.name} to turn on sales sync.`]);
    return { channel: key, skipped: true };
  }
  const startedAt = new Date();
  const cursor = account.sync_cursor ? new Date(account.sync_cursor) : startedAt;
  try {
    const lines = await ch.fetchSales(account, new Date(cursor.getTime() - OVERLAP_MS));
    const changed = new Set();
    for (const line of lines) {
      const id = await applySale(key, line);
      if (id) changed.add(id);
    }
    for (const id of changed) await pushQuantity(id, { except: key });
    await query("UPDATE marketplace_accounts SET sync_cursor = $2, last_sync_at = now(), last_sync_error = NULL WHERE channel = $1", [key, startedAt]);
    return { channel: key, orders: lines.length, updated: changed.size };
  } catch (e) {
    const msg = e.expose ? e.message : "Could not read orders.";
    if (!e.expose) console.error(e);
    await query("UPDATE marketplace_accounts SET last_sync_at = now(), last_sync_error = $2 WHERE channel = $1", [key, msg]);
    return { channel: key, error: msg };
  }
}

/** One sync pass over every connected marketplace. Safe to call concurrently or from several instances. */
async function runSync() {
  const client = await pool.connect();
  let locked = false;
  try {
    locked = (await client.query("SELECT pg_try_advisory_lock($1) AS ok", [LOCK_ID])).rows[0].ok;
    if (!locked) return { busy: true };
    const results = [];
    for (const key of Object.keys(CHANNELS)) results.push(await syncChannel(key));
    return { results };
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock($1)", [LOCK_ID]).catch(() => {});
    client.release();
  }
}

function startScheduler() {
  const minutes = Number(process.env.MARKETPLACE_SYNC_MINUTES ?? 10);
  if (!minutes || minutes < 1) return;
  const tick = () => runSync().catch((e) => console.error("Sales sync failed:", e));
  setTimeout(tick, 30_000).unref();
  setInterval(tick, minutes * 60_000).unref();
}

module.exports = { runSync, startScheduler, pushQuantity };
