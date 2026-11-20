// Etsy Open API v3 connector: OAuth 2.0 (PKCE), draft/active listings, photos, price + stock.
const store = require("./store");
const { MarketError } = store;
const { pkceChallenge, clip, buildTitle, buildDescription, buildTags, dollars } = require("./common");

const API = "https://api.etsy.com/v3";
const KEY = process.env.ETSY_API_KEY || "";
const SECRET = process.env.ETSY_SHARED_SECRET || "";
const SCOPES = "listings_r listings_w listings_d shops_r transactions_r";
const SCOPE_VERSION = 2; // bump when SCOPES grows, so older connections are asked to reconnect

const WHO_MADE = ["i_did", "someone_else", "collective"];
// Suggestions only: Etsy shifts the most recent range every few years, so any value Etsy accepts is allowed.
const WHEN_MADE = ["made_to_order", "2020_2025", "2010_2019", "2006_2009", "before_2006", "2000_2005", "1990s", "1980s", "1970s", "1960s", "1950s", "1900s", "1800s", "before_1700"];

const configured = () => Boolean(KEY && SECRET);
const apiKeyHeader = () => `${KEY}:${SECRET}`;

function authUrl({ redirectUri, state, verifier }) {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: KEY,
    redirect_uri: redirectUri,
    scope: SCOPES,
    state,
    code_challenge: pkceChallenge(verifier),
    code_challenge_method: "S256",
  });
  return `https://www.etsy.com/oauth/connect?${q}`;
}

async function tokenRequest(params) {
  const res = await fetch(`${API}/public/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "x-api-key": apiKeyHeader() },
    body: new URLSearchParams({ client_id: KEY, ...params }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new MarketError(`Etsy sign-in failed: ${data.error_description || data.error || res.status}`);
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in || 3600) * 1000,
    user_id: String(data.access_token).split(".")[0],
  };
}

async function connect({ code, redirectUri, verifier }) {
  const tokens = await tokenRequest({ grant_type: "authorization_code", redirect_uri: redirectUri, code, code_verifier: verifier });
  const shop = await rawCall(tokens.access_token, "GET", `/application/users/${tokens.user_id}/shops`);
  if (!shop || !shop.shop_id) throw new MarketError("That Etsy account doesn't have a shop yet. Open an Etsy shop first, then connect.");
  tokens.scope_version = SCOPE_VERSION;
  return { tokens, account_name: shop.shop_name, account_id: String(shop.shop_id) };
}

async function accessToken(account) {
  const t = account.tokens;
  if (t.expires_at - 60_000 > Date.now()) return t.access_token;
  const fresh = await tokenRequest({ grant_type: "refresh_token", refresh_token: t.refresh_token }).catch(() => {
    throw new MarketError("Etsy connection expired. Reconnect Etsy on the Channels page.", 401);
  });
  account.tokens = { ...t, ...fresh };
  await store.saveTokens("etsy", account.tokens);
  return fresh.access_token;
}

async function rawCall(token, method, path, { form, json, multipart } = {}) {
  const headers = { "x-api-key": apiKeyHeader() };
  if (token) headers.Authorization = `Bearer ${token}`;
  let body;
  if (form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(form)) if (v !== undefined && v !== null && v !== "") p.set(k, Array.isArray(v) ? v.join(",") : String(v));
    body = p;
  } else if (json) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(json);
  } else if (multipart) body = multipart;

  const res = await fetch(`${API}${path}`, { method, headers, body });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (data && (data.error_description || data.error)) || `HTTP ${res.status}`;
    const e = new MarketError(`Etsy: ${msg}`, res.status === 401 ? 401 : 400);
    e.httpStatus = res.status;
    throw e;
  }
  return data;
}

async function call(account, method, path, opts) {
  return rawCall(await accessToken(account), method, path, opts);
}

// ---------- settings ----------
function defaultSettings() {
  return { who_made: "someone_else", when_made: "2020_2025", is_supply: false, taxonomy_id: "", shipping_profile_id: "", return_policy_id: "", readiness_state_id: "", auto_publish: false };
}

function readSettings(body) {
  const s = { ...defaultSettings() };
  const id = (v) => (v === "" || v == null ? "" : /^\d+$/.test(String(v)) ? String(v) : null);
  for (const k of ["taxonomy_id", "shipping_profile_id", "return_policy_id", "readiness_state_id"]) {
    const v = id(body[k]);
    if (v === null) throw new MarketError(`${k.replace(/_/g, " ")} must be a number.`);
    s[k] = v;
  }
  if (body.who_made && !WHO_MADE.includes(body.who_made)) throw new MarketError("Unknown 'who made' value.");
  if (body.when_made && !/^[a-z0-9_]{3,20}$/.test(body.when_made)) throw new MarketError("Unknown 'when made' value.");
  s.who_made = body.who_made || s.who_made;
  s.when_made = body.when_made || s.when_made;
  s.taxonomy_name = String(body.taxonomy_name || "").slice(0, 300);
  s.is_supply = Boolean(body.is_supply);
  s.auto_publish = Boolean(body.auto_publish);
  return s;
}

function missingSettings(settings) {
  const s = { ...defaultSettings(), ...settings };
  const missing = [];
  if (!s.taxonomy_id) missing.push("Category");
  if (!s.shipping_profile_id) missing.push("Shipping profile");
  return missing;
}

/** Shop-specific choices for the settings form. Each list fails soft so one bad call doesn't block the rest. */
async function options(account) {
  const shop = account.account_id;
  const soft = (p) => p.then((r) => r?.results || []).catch((e) => ({ error: e.message }));
  const [shipping, returns, readiness] = await Promise.all([
    soft(call(account, "GET", `/application/shops/${shop}/shipping-profiles`)),
    soft(call(account, "GET", `/application/shops/${shop}/policies/return`)),
    soft(call(account, "GET", `/application/shops/${shop}/readiness-state-definitions?limit=100`)),
  ]);
  const list = (r, map) => (Array.isArray(r) ? { items: r.map(map) } : r);
  return {
    shipping_profiles: list(shipping, (x) => ({ id: String(x.shipping_profile_id), name: x.title })),
    return_policies: list(returns, (x) => ({
      id: String(x.return_policy_id),
      name: x.accepts_returns ? `Returns within ${x.return_deadline} days${x.accepts_exchanges ? " + exchanges" : ""}` : "No returns",
    })),
    readiness_states: list(readiness, (x) => ({
      id: String(x.readiness_state_id),
      name: `${x.readiness_state === "ready_to_ship" ? "Ready to ship" : "Made to order"}, ${x.min_processing_time}-${x.max_processing_time} ${x.processing_time_unit || "days"}`,
    })),
    who_made: WHO_MADE,
    when_made: WHEN_MADE,
  };
}

// Etsy's category tree changes rarely; cache it for a day.
let taxonomyCache = { at: 0, list: [] };
async function searchTaxonomy(q) {
  if (Date.now() - taxonomyCache.at > 86_400_000) {
    const data = await rawCall(null, "GET", "/application/seller-taxonomy/nodes");
    const out = [];
    const walk = (nodes, trail) => {
      for (const n of nodes || []) {
        const path = [...trail, n.name];
        if (!n.children || !n.children.length) out.push({ id: String(n.id), name: path.join(" › ") });
        walk(n.children, path);
      }
    };
    walk(data.results, []);
    taxonomyCache = { at: Date.now(), list: out };
  }
  const words = String(q || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return taxonomyCache.list.filter((n) => words.every((w) => n.name.toLowerCase().includes(w))).slice(0, 30);
}

// ---------- listing text ----------
function etsyTags(p) {
  const seen = new Set();
  const tags = [];
  for (const raw of buildTags(p)) {
    const t = clip(String(raw || "").replace(/[^\p{L}\p{N}\s\-'™©®]/gu, " ").replace(/\s+/g, " ").toLowerCase(), 20);
    if (t && !seen.has(t)) { seen.add(t); tags.push(t); }
    if (tags.length === 13) break;
  }
  return tags;
}

function listingFields(p, s, link) {
  return {
    title: buildTitle(p, 140).replace(/[^\p{L}\p{N}\p{P}\p{Zs}]/gu, ""),
    description: buildDescription(p),
    who_made: s.who_made,
    when_made: s.when_made,
    is_supply: s.is_supply ? "true" : "false",
    taxonomy_id: link.options.taxonomy_id || s.taxonomy_id,
    shipping_profile_id: s.shipping_profile_id,
    return_policy_id: s.return_policy_id || undefined,
    readiness_state_id: s.readiness_state_id || undefined,
    tags: etsyTags(p),
    materials: p.material ? [clip(p.material.replace(/[^\p{L}\p{N}\s]/gu, ""), 45)] : undefined,
  };
}

// ---------- push ----------
async function syncInventory(account, listingId, p) {
  const inv = await call(account, "GET", `/application/listings/${listingId}/inventory`);
  const products = (inv.products || []).map((prod) => ({
    sku: prod.sku || "",
    property_values: (prod.property_values || []).map((v) => ({
      property_id: v.property_id, value_ids: v.value_ids, scale_id: v.scale_id, property_name: v.property_name, values: v.values,
    })),
    offerings: (prod.offerings || []).filter((o) => !o.is_deleted).map((o) => {
      const out = { price: dollars(p.price_cents), quantity: p.stock, is_enabled: o.is_enabled !== false };
      if (o.readiness_state_id) out.readiness_state_id = o.readiness_state_id;
      return out;
    }),
  }));
  if (products.length !== 1) return; // listings with variations are managed on Etsy
  await call(account, "PUT", `/application/listings/${listingId}/inventory`, {
    json: { products, price_on_property: inv.price_on_property || [], quantity_on_property: inv.quantity_on_property || [], sku_on_property: inv.sku_on_property || [] },
  });
}

async function syncImages(account, listingId, p, link) {
  const shop = account.account_id;
  const map = { ...(link.options.images || {}) }; // local image id -> Etsy listing_image_id
  const localIds = p.images.map((i) => String(i.id));

  for (const [localId, remoteId] of Object.entries(map)) {
    if (!localIds.includes(localId)) {
      await call(account, "DELETE", `/application/shops/${shop}/listings/${listingId}/images/${remoteId}`).catch(() => {});
      delete map[localId];
    }
  }
  for (const [i, img] of p.images.slice(0, 10).entries()) {
    if (map[img.id]) continue;
    const file = await store.loadImageData(img.id);
    if (!file) continue;
    const fd = new FormData();
    fd.append("image", new Blob([file.data], { type: file.mime }), `photo-${img.id}.${file.mime.split("/")[1]}`);
    fd.append("rank", String(i + 1));
    const r = await call(account, "POST", `/application/shops/${shop}/listings/${listingId}/images`, { multipart: fd });
    map[img.id] = String(r.listing_image_id);
  }
  link.options.images = map;
}

async function push(account, p, link, { publish }) {
  const s = { ...defaultSettings(), ...account.settings };
  const missing = missingSettings(s);
  if (missing.length && !link.options.taxonomy_id) throw new MarketError(`Finish Etsy setup first: ${missing.join(", ")}.`);
  if (!s.shipping_profile_id) throw new MarketError("Pick an Etsy shipping profile on the Channels page first.");
  if (p.price_cents < 20) throw new MarketError("Etsy needs a price of at least $0.20.");
  if (p.stock < 1 && !link.remote_id) throw new MarketError("Set stock to at least 1 before sending to Etsy.");

  const shop = account.account_id;
  const fields = listingFields(p, s, link);
  let listing;

  if (link.remote_id) {
    try {
      listing = await call(account, "PATCH", `/application/shops/${shop}/listings/${link.remote_id}`, { form: fields });
    } catch (e) {
      if (e.httpStatus !== 404) throw e;
      link.remote_id = null; // deleted on Etsy: create it again
      link.options.images = {};
    }
  }
  if (!link.remote_id) {
    listing = await call(account, "POST", `/application/shops/${shop}/listings`, {
      form: { ...fields, quantity: Math.max(1, p.stock), price: dollars(p.price_cents) },
    });
    link.remote_id = String(listing.listing_id);
    link.options.images = {};
  } else {
    await syncInventory(account, link.remote_id, p);
  }

  await syncImages(account, link.remote_id, p, link);

  const wantLive = publish || (s.auto_publish && listing.state === "draft") || listing.state === "active";
  if (wantLive && listing.state !== "active" && p.stock > 0) {
    if (!p.images.length) throw new MarketError("Add at least one photo before publishing on Etsy.");
    listing = await call(account, "PATCH", `/application/shops/${shop}/listings/${link.remote_id}`, { form: { state: "active" } });
  }

  link.state = listing.state || "draft";
  link.remote_url = listing.url || `https://www.etsy.com/listing/${link.remote_id}`;
  return link;
}

async function end(account, link) {
  if (!link.remote_id) throw new MarketError("This listing isn't on Etsy.");
  const r = await call(account, "PATCH", `/application/shops/${account.account_id}/listings/${link.remote_id}`, { form: { state: "inactive" } });
  link.state = r.state || "inactive";
  return link;
}

// ---------- sales sync ----------
const canReadOrders = (account) => (account.tokens.scope_version || 1) >= SCOPE_VERSION;

/** Order lines created since `since` (Date). Cancelled orders are skipped. */
async function fetchSales(account, since) {
  const out = [];
  const minCreated = Math.floor(since.getTime() / 1000);
  for (let offset = 0; offset < 2000; offset += 100) {
    const page = await call(account, "GET", `/application/shops/${account.account_id}/receipts?min_created=${minCreated}&limit=100&offset=${offset}`);
    for (const r of page.results || []) {
      if (/cancel/i.test(r.status || "")) continue;
      for (const t of r.transactions || []) {
        out.push({
          order_id: String(r.receipt_id),
          line_id: String(t.transaction_id),
          remote_listing_id: String(t.listing_id),
          sku: t.sku || "",
          title: t.title || "",
          quantity: t.quantity || 1,
          sold_at: new Date(((t.created_timestamp || t.create_timestamp || r.created_timestamp || r.create_timestamp) || minCreated) * 1000),
        });
      }
    }
    if (!page.results || page.results.length < 100) break;
  }
  return out;
}

/** Bring the Etsy listing's stock in line with ours. Zero stock deactivates it (Etsy can't hold 0). */
async function setQuantity(account, link, p, qty) {
  if (!link.remote_id || !["active", "draft", "inactive", "sold_out", "edit"].includes(link.state)) return link;
  const shop = account.account_id;
  if (qty < 1) {
    if (link.state === "active") {
      const r = await call(account, "PATCH", `/application/shops/${shop}/listings/${link.remote_id}`, { form: { state: "inactive" } });
      link.state = r.state || "inactive";
    }
    return link;
  }
  await syncInventory(account, link.remote_id, { ...p, stock: qty });
  return link;
}

module.exports = { name: "Etsy", configured, canReadOrders, fetchSales, setQuantity, authUrl, connect, readSettings, defaultSettings, missingSettings, options, searchTaxonomy, push, end };
