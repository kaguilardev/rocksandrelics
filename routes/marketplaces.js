const crypto = require("crypto");
const express = require("express");
const auth = require("../auth");
const store = require("../marketplaces/store");
const { randomToken } = require("../marketplaces/common");
const sync = require("../marketplaces/sync");
const whatnot = require("../marketplaces/whatnot");
const { query } = require("../db");

const CHANNELS = { etsy: require("../marketplaces/etsy"), ebay: require("../marketplaces/ebay") };

const router = express.Router();
router.use("/api/admin", auth.requireXHR);
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function baseUrl(req) {
  return (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
}

function channelParam(req, res, next) {
  const ch = CHANNELS[req.params.channel];
  if (!ch) return res.status(404).json({ error: "Unknown marketplace." });
  req.channel = req.params.channel;
  req.ch = ch;
  next();
}

async function connectedAccount(req) {
  const account = await store.getAccount(req.channel);
  if (!account) throw new store.MarketError(`${req.ch.name} isn't connected yet. Connect it on the Channels page.`);
  if (account.broken) throw new store.MarketError(`${req.ch.name} needs to be reconnected on the Channels page.`);
  return account;
}

const publicLink = (l) => ({
  channel: l.channel,
  state: l.state,
  remote_id: l.remote_id,
  remote_url: l.remote_url,
  last_error: l.last_error,
  last_synced_at: l.last_synced_at,
  options: {
    category_id: l.options?.taxonomy_id || l.options?.category_id || "",
    category_name: l.options?.category_name || "",
    aspects: l.options?.aspects || {},
  },
});

// ---------------- channel accounts ----------------
router.get("/api/admin/marketplaces", auth.requireAuth, wrap(async (_req, res) => {
  const out = [];
  for (const [key, ch] of Object.entries(CHANNELS)) {
    const a = await store.getAccount(key);
    const settings = { ...ch.defaultSettings(), ...(a?.settings || {}) };
    out.push({
      channel: key,
      name: ch.name,
      sandbox: Boolean(ch.sandbox),
      configured: ch.configured(),
      connected: Boolean(a && !a.broken),
      broken: Boolean(a && a.broken),
      account_name: a?.account_name || "",
      connected_at: a?.connected_at || null,
      settings,
      missing: a ? ch.missingSettings(settings) : [],
      sales_sync: a && !a.broken ? ch.canReadOrders(a) : false,
      last_sync_at: a?.last_sync_at || null,
      last_sync_error: a?.last_sync_error || null,
    });
  }
  res.json(out);
}));

router.post("/api/admin/marketplaces/sync", auth.requireAuth, wrap(async (_req, res) => {
  const r = await sync.runSync();
  if (r.busy) return res.status(409).json({ error: "A sync is already running. Try again in a minute." });
  res.json(r);
}));

router.get("/api/admin/marketplaces/sales", auth.requireAuth, wrap(async (_req, res) => {
  const { rows } = await query(
    `SELECT s.channel, s.order_id, s.quantity, s.sold_at, s.title, p.id AS product_id, p.name, p.stock, p.status
     FROM marketplace_sales s JOIN products p ON p.id = s.product_id
     ORDER BY s.sold_at DESC LIMIT 25`
  );
  res.json(rows);
}));

router.post("/api/admin/marketplaces/:channel/connect", auth.requireOwner, channelParam, (req, res) => {
  if (!req.ch.configured()) return res.status(400).json({ error: `${req.ch.name} API keys aren't set on the server yet.` });
  const state = randomToken(24);
  const verifier = randomToken(48);
  const redirectUri = `${baseUrl(req)}/api/admin/marketplaces/${req.channel}/callback`;
  req.session.marketOAuth = { channel: req.channel, state, verifier, redirectUri, at: Date.now() };
  res.json({ url: req.ch.authUrl({ redirectUri, state, verifier }) });
});

// Browser lands here after approving access on Etsy / eBay.
router.get("/api/admin/marketplaces/:channel/callback", channelParam, wrap(async (req, res) => {
  const back = (msg, ok = false) => res.redirect(`/admin#/channels?${ok ? "connected" : "error"}=${encodeURIComponent(msg)}`);
  const pending = req.session.marketOAuth;
  delete req.session.marketOAuth;
  if (!req.user || req.user.role !== "owner") return back("Log in as the owner, then connect again.");
  if (req.query.error) return back(`${req.ch.name} access was not granted.`);
  const state = String(req.query.state || "");
  if (
    !pending || pending.channel !== req.channel || Date.now() - pending.at > 15 * 60 * 1000 ||
    state.length !== pending.state.length || !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(pending.state))
  ) return back("That sign-in link expired. Try connecting again.");
  try {
    const result = await req.ch.connect({ code: String(req.query.code || ""), redirectUri: pending.redirectUri, verifier: pending.verifier });
    await store.saveAccount(req.channel, { ...result, connected_by: req.user.id });
    back(req.ch.name, true);
  } catch (e) {
    back(e.expose ? e.message : `Could not connect ${req.ch.name}.`);
    if (!e.expose) console.error(e);
  }
}));

router.post("/api/admin/marketplaces/:channel/disconnect", auth.requireOwner, channelParam, wrap(async (req, res) => {
  await store.deleteAccount(req.channel);
  res.json({ ok: true });
}));

router.get("/api/admin/marketplaces/:channel/options", auth.requireAuth, channelParam, wrap(async (req, res) => {
  res.json(await req.ch.options(await connectedAccount(req)));
}));

router.put("/api/admin/marketplaces/:channel/settings", auth.requireOwner, channelParam, wrap(async (req, res) => {
  await connectedAccount(req);
  const settings = req.ch.readSettings(req.body || {});
  await store.saveSettings(req.channel, settings);
  res.json({ ok: true, settings, missing: req.ch.missingSettings(settings) });
}));

router.get("/api/admin/marketplaces/etsy/taxonomy", auth.requireAuth, wrap(async (req, res) => {
  res.json(await CHANNELS.etsy.searchTaxonomy(req.query.q));
}));

router.get("/api/admin/marketplaces/ebay/categories", auth.requireAuth, wrap(async (req, res) => {
  res.json(await CHANNELS.ebay.searchCategories(req.query.q));
}));

router.get("/api/admin/marketplaces/ebay/aspects/:categoryId", auth.requireAuth, wrap(async (req, res) => {
  if (!/^\d+$/.test(req.params.categoryId)) return res.status(400).json({ error: "Bad category." });
  res.json(await CHANNELS.ebay.requiredAspects(req.params.categoryId));
}));

router.post("/api/admin/marketplaces/ebay/location", auth.requireOwner, wrap(async (req, res) => {
  req.channel = "ebay";
  req.ch = CHANNELS.ebay;
  const account = await connectedAccount(req);
  const key = await CHANNELS.ebay.createLocation(account, req.body || {});
  await store.saveSettings("ebay", { ...CHANNELS.ebay.defaultSettings(), ...account.settings, merchant_location_key: key });
  res.json({ ok: true, key });
}));

// ---------------- Whatnot (CSV export) ----------------
router.get("/api/admin/marketplaces/whatnot/options", auth.requireAuth, (_req, res) => {
  res.json({ types: whatnot.TYPES, shipping_profiles: whatnot.SHIPPING_PROFILES, category: whatnot.CATEGORY });
});

router.get("/api/admin/marketplaces/whatnot/export.csv", auth.requireAuth, wrap(async (req, res) => {
  const opts = whatnot.readOptions(req.query);
  const statuses = opts.includeDrafts ? ["published", "draft"] : ["published"];
  const { rows: ids } = await query(
    "SELECT id FROM products WHERE status = ANY($1) AND stock > 0 ORDER BY created_at DESC",
    [statuses]
  );
  const products = [];
  for (const { id } of ids) products.push(await store.loadProduct(id));
  const base = baseUrl(req);
  const csv = whatnot.toCsv(products, opts, (imgId) => `${base}/img/${imgId}?sig=${store.imageSig(imgId)}`);
  const date = new Date().toISOString().slice(0, 10);
  res.set("Content-Type", "text/csv; charset=utf-8");
  res.set("Content-Disposition", `attachment; filename="whatnot-listings-${date}.csv"`);
  res.set("Cache-Control", "no-store");
  res.send(csv);
}));

// ---------------- per-listing ----------------
router.get("/api/admin/products/:id/marketplaces", auth.requireAuth, wrap(async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const links = await Promise.all(Object.keys(CHANNELS).map((c) => store.getLink(id, c)));
  res.json(links.map(publicLink));
}));

router.patch("/api/admin/products/:id/marketplaces/:channel", auth.requireAuth, channelParam, wrap(async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!(await store.loadProduct(id))) return res.status(404).json({ error: "Listing not found." });
  const link = await store.getLink(id, req.channel);
  const b = req.body || {};
  const numOrEmpty = (v) => {
    const s = String(v ?? "").trim();
    if (s && !/^\d+$/.test(s)) throw new store.MarketError("Category must be a number.");
    return s;
  };
  const field = req.channel === "etsy" ? "taxonomy_id" : "category_id";
  if (b.category_id !== undefined) {
    link.options[field] = numOrEmpty(b.category_id);
    link.options.category_name = link.options[field] ? String(b.category_name || "").slice(0, 300) : "";
  }
  if (req.channel === "ebay" && b.aspects !== undefined) {
    const aspects = {};
    for (const [k, v] of Object.entries(b.aspects || {}).slice(0, 30)) {
      const key = String(k).trim().slice(0, 65);
      const val = String(v ?? "").trim().slice(0, 65);
      if (key && val) aspects[key] = val;
    }
    link.options.aspects = aspects;
  }
  await store.saveLink(link);
  res.json(publicLink(link));
}));

router.post("/api/admin/products/:id/marketplaces/:channel/push", auth.requireAuth, channelParam, wrap(async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const product = await store.loadProduct(id);
  if (!product) return res.status(404).json({ error: "Listing not found." });
  const account = await connectedAccount(req);
  const link = await store.getLink(id, req.channel);
  const base = baseUrl(req);
  try {
    await req.ch.push(account, product, link, {
      publish: Boolean(req.body?.publish),
      baseUrl: base,
      imageUrl: (imgId) => `${base}/img/${imgId}?sig=${store.imageSig(imgId)}`,
    });
    link.last_error = null;
    link.last_synced_at = new Date();
    await store.saveLink(link);
    res.json(publicLink(link));
  } catch (e) {
    link.last_error = e.expose ? e.message : "Something went wrong talking to the marketplace.";
    await store.saveLink(link); // keep any ids created before the failure
    if (!e.expose) console.error(e);
    res.status(e.status && e.status < 500 ? e.status : 502).json({ error: link.last_error, link: publicLink(link) });
  }
}));

router.post("/api/admin/products/:id/marketplaces/:channel/end", auth.requireAuth, channelParam, wrap(async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const account = await connectedAccount(req);
  const link = await store.getLink(id, req.channel);
  await req.ch.end(account, link);
  link.last_error = null;
  link.last_synced_at = new Date();
  await store.saveLink(link);
  res.json(publicLink(link));
}));

// Forget the link (the marketplace listing itself is left alone).
router.delete("/api/admin/products/:id/marketplaces/:channel", auth.requireAuth, channelParam, wrap(async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const link = await store.getLink(id, req.channel);
  await store.saveLink({ ...link, remote_id: null, remote_url: null, state: "none", last_error: null, last_synced_at: null,
    options: { taxonomy_id: link.options.taxonomy_id, category_id: link.options.category_id, category_name: link.options.category_name, aspects: link.options.aspects } });
  res.json({ ok: true });
}));

// ---------------- eBay Marketplace Account Deletion notifications ----------------
// eBay requires this endpoint for production API keys. We store no eBay buyer data, so we only acknowledge.
router.get("/api/marketplaces/ebay/account-deletion", (req, res) => {
  const token = process.env.EBAY_VERIFICATION_TOKEN;
  const code = String(req.query.challenge_code || "");
  if (!token || !code) return res.status(400).json({ error: "Not configured" });
  const endpoint = `${baseUrl(req)}/api/marketplaces/ebay/account-deletion`;
  const challengeResponse = crypto.createHash("sha256").update(code + token + endpoint).digest("hex");
  res.json({ challengeResponse });
});
router.post("/api/marketplaces/ebay/account-deletion", (_req, res) => res.status(204).end());

module.exports = router;
