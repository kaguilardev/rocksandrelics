// eBay Sell APIs connector: OAuth 2.0 user consent, Inventory API (inventory item -> offer -> publish).
const store = require("./store");
const { MarketError } = store;
const { buildTitle, buildDescription, TYPE_LABELS, dollars } = require("./common");

const SANDBOX = process.env.EBAY_ENV === "sandbox";
const API = SANDBOX ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";
const APIZ = SANDBOX ? "https://apiz.sandbox.ebay.com" : "https://apiz.ebay.com";
const AUTH = SANDBOX ? "https://auth.sandbox.ebay.com" : "https://auth.ebay.com";
const ITEM_URL = SANDBOX ? "https://sandbox.ebay.com/itm/" : "https://www.ebay.com/itm/";

const CLIENT_ID = process.env.EBAY_CLIENT_ID || "";
const CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET || "";
const RUNAME = process.env.EBAY_RUNAME || "";
const MARKETPLACE = process.env.EBAY_MARKETPLACE || "EBAY_US";
const CURRENCY = process.env.EBAY_CURRENCY || "USD";
const LANG = process.env.EBAY_LANGUAGE || "en-US";

const SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account",
  "https://api.ebay.com/oauth/api_scope/commerce.identity.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
].join(" ");
const SCOPE_VERSION = 2; // bump when SCOPES grows, so older connections are asked to reconnect

const CONDITIONS = ["NEW", "LIKE_NEW", "USED_EXCELLENT", "USED_VERY_GOOD", "USED_GOOD", "USED_ACCEPTABLE"];

const configured = () => Boolean(CLIENT_ID && CLIENT_SECRET && RUNAME);
const basic = () => `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`;

// eBay's redirect_uri is the RuName; the actual callback URL is set on the RuName in the developer portal.
function authUrl({ state }) {
  const q = new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: RUNAME, response_type: "code", scope: SCOPES, state });
  return `${AUTH}/oauth2/authorize?${q}`;
}

async function tokenRequest(params) {
  const res = await fetch(`${API}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: basic() },
    body: new URLSearchParams(params),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new MarketError(`eBay sign-in failed: ${data.error_description || data.error || res.status}`);
  return data;
}

async function connect({ code }) {
  const d = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: RUNAME });
  const tokens = {
    access_token: d.access_token,
    refresh_token: d.refresh_token,
    expires_at: Date.now() + (d.expires_in || 7200) * 1000,
    refresh_expires_at: Date.now() + (d.refresh_token_expires_in || 47_304_000) * 1000,
    scope_version: SCOPE_VERSION,
  };
  let account_name = "eBay seller";
  let account_id = "";
  try {
    const me = await rawCall(tokens.access_token, "GET", `${APIZ}/commerce/identity/v1/user/`);
    account_name = me.username || account_name;
    account_id = me.userId || "";
  } catch { /* identity is a nice-to-have */ }
  return { tokens, account_name, account_id };
}

async function accessToken(account) {
  const t = account.tokens;
  if (t.expires_at - 60_000 > Date.now()) return t.access_token;
  let d;
  try {
    d = await tokenRequest({ grant_type: "refresh_token", refresh_token: t.refresh_token, scope: SCOPES });
  } catch {
    throw new MarketError("eBay connection expired. Reconnect eBay on the Channels page.", 401);
  }
  account.tokens = { ...t, access_token: d.access_token, expires_at: Date.now() + (d.expires_in || 7200) * 1000 };
  await store.saveTokens("ebay", account.tokens);
  return d.access_token;
}

function ebayError(data, status) {
  const errs = (data && data.errors) || [];
  const first = errs[0];
  const msg = errs.map((e) => e.longMessage || e.message).filter(Boolean).join(" ") || `HTTP ${status}`;
  const e = new MarketError(`eBay: ${msg}`, status === 401 ? 401 : 400);
  e.httpStatus = status;
  e.errorId = first && first.errorId;
  e.errors = errs;
  return e;
}

async function rawCall(token, method, url, json) {
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json", "Accept-Language": LANG };
  if (json !== undefined) {
    headers["Content-Type"] = "application/json";
    headers["Content-Language"] = LANG;
  }
  const res = await fetch(url.startsWith("http") ? url : `${API}${url}`, { method, headers, body: json === undefined ? undefined : JSON.stringify(json) });
  if (res.status === 204) return null;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw ebayError(data, res.status);
  return data;
}

async function call(account, method, path, json) {
  return rawCall(await accessToken(account), method, path, json);
}

// App-level token for the public Taxonomy API (category search)
let appToken = { token: null, exp: 0 };
async function applicationToken() {
  if (appToken.exp - 60_000 > Date.now()) return appToken.token;
  const d = await tokenRequest({ grant_type: "client_credentials", scope: "https://api.ebay.com/oauth/api_scope" });
  appToken = { token: d.access_token, exp: Date.now() + d.expires_in * 1000 };
  return appToken.token;
}
let treeId = null;
async function categoryTreeId() {
  if (treeId) return treeId;
  const d = await rawCall(await applicationToken(), "GET", `/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=${MARKETPLACE}`);
  treeId = d.categoryTreeId;
  return treeId;
}

async function searchCategories(q) {
  if (!String(q || "").trim()) return [];
  const tree = await categoryTreeId();
  const d = await rawCall(await applicationToken(), "GET", `/commerce/taxonomy/v1/category_tree/${tree}/get_category_suggestions?q=${encodeURIComponent(q)}`).catch((e) => {
    if (e.httpStatus === 204 || e.httpStatus === 404) return null;
    throw e;
  });
  return ((d && d.categorySuggestions) || []).map((s) => ({
    id: s.category.categoryId,
    name: [...(s.categoryTreeNodeAncestors || []).map((a) => a.categoryName).reverse(), s.category.categoryName].join(" › "),
  }));
}

const aspectCache = new Map();
async function requiredAspects(categoryId) {
  if (aspectCache.has(categoryId)) return aspectCache.get(categoryId);
  const tree = await categoryTreeId();
  const d = await rawCall(await applicationToken(), "GET", `/commerce/taxonomy/v1/category_tree/${tree}/get_item_aspects_for_category?category_id=${categoryId}`);
  const req = (d.aspects || [])
    .filter((a) => a.aspectConstraint && a.aspectConstraint.aspectRequired)
    .map((a) => ({ name: a.localizedAspectName, values: (a.aspectValues || []).slice(0, 50).map((v) => v.localizedValue) }));
  aspectCache.set(categoryId, req);
  return req;
}

// ---------- settings ----------
function defaultSettings() {
  return { category_id: "", condition: "NEW", fulfillment_policy_id: "", payment_policy_id: "", return_policy_id: "", merchant_location_key: "", auto_publish: false };
}

function readSettings(body) {
  const s = { ...defaultSettings() };
  for (const k of ["category_id", "fulfillment_policy_id", "payment_policy_id", "return_policy_id"]) {
    const v = String(body[k] ?? "").trim();
    if (v && !/^\d+$/.test(v)) throw new MarketError(`${k.replace(/_/g, " ")} must be a number.`);
    s[k] = v;
  }
  const loc = String(body.merchant_location_key ?? "").trim();
  if (loc && !/^[\w-]{1,36}$/.test(loc)) throw new MarketError("Unknown inventory location.");
  s.merchant_location_key = loc;
  if (body.condition && !CONDITIONS.includes(body.condition)) throw new MarketError("Unknown condition.");
  s.condition = body.condition || s.condition;
  s.category_name = String(body.category_name || "").slice(0, 300);
  s.auto_publish = Boolean(body.auto_publish);
  return s;
}

function missingSettings(settings) {
  const s = { ...defaultSettings(), ...settings };
  const missing = [];
  if (!s.category_id) missing.push("Category");
  if (!s.fulfillment_policy_id) missing.push("Shipping policy");
  if (!s.payment_policy_id) missing.push("Payment policy");
  if (!s.return_policy_id) missing.push("Return policy");
  if (!s.merchant_location_key) missing.push("Ship-from location");
  return missing;
}

async function options(account) {
  const soft = (p, key, map) =>
    p.then((r) => ({ items: ((r && r[key]) || []).map(map) })).catch((e) => ({
      error: e.errorId === 20403 || /business polic|not eligible|opt/i.test(e.message)
        ? "Turn on Business Policies in your eBay account (Account → Business policies), then reload."
        : e.message,
    }));
  const policy = (idKey) => (x) => ({ id: x[idKey], name: x.name });
  const [fulfillment, payment, returns, locations] = await Promise.all([
    soft(call(account, "GET", `/sell/account/v1/fulfillment_policy?marketplace_id=${MARKETPLACE}`), "fulfillmentPolicies", policy("fulfillmentPolicyId")),
    soft(call(account, "GET", `/sell/account/v1/payment_policy?marketplace_id=${MARKETPLACE}`), "paymentPolicies", policy("paymentPolicyId")),
    soft(call(account, "GET", `/sell/account/v1/return_policy?marketplace_id=${MARKETPLACE}`), "returnPolicies", policy("returnPolicyId")),
    soft(call(account, "GET", "/sell/inventory/v1/location?limit=100"), "locations", (x) => ({
      id: x.merchantLocationKey,
      name: `${x.name || x.merchantLocationKey}${x.location?.address?.postalCode ? ` (${x.location.address.postalCode})` : ""}`,
    })),
  ]);
  return { fulfillment_policies: fulfillment, payment_policies: payment, return_policies: returns, locations, conditions: CONDITIONS };
}

async function createLocation(account, { postalCode, country, name }) {
  const pc = String(postalCode || "").trim().slice(0, 20);
  const cc = String(country || "US").trim().toUpperCase();
  if (!pc) throw new MarketError("Enter the postal code you ship from.");
  if (!/^[A-Z]{2}$/.test(cc)) throw new MarketError("Country must be a 2-letter code like US.");
  const key = "main-" + pc.replace(/[^\w]/g, "").toLowerCase();
  await call(account, "POST", `/sell/inventory/v1/location/${key}`, {
    location: { address: { postalCode: pc, country: cc } },
    locationTypes: ["WAREHOUSE"],
    name: String(name || "Main").slice(0, 100),
    merchantLocationStatus: "ENABLED",
  }).catch((e) => {
    if (e.errorId !== 25803) throw e; // 25803 = already exists, which is fine
  });
  return key;
}

// ---------- listing ----------
const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const htmlDescription = (p) => escHtml(buildDescription(p)).split(/\n{2,}/).map((para) => `<p>${para.replace(/\n/g, "<br>")}</p>`).join("");

/** Fill required item specifics from the listing where we can; the rest come from the per-listing overrides. */
async function buildAspects(p, categoryId, overrides) {
  const aspects = {};
  const guess = {
    type: TYPE_LABELS[p.type],
    brand: "Unbranded",
    "stone/mineral": p.material,
    mineral: p.material,
    "gemstone/mineral": p.material,
    "main stone": p.material,
    material: p.material,
    stone: p.material,
    "crystal/mineral": p.material,
    "country/region of manufacture": undefined,
  };
  let required = [];
  try { required = await requiredAspects(categoryId); } catch { /* best effort */ }
  for (const a of required) {
    const g = guess[a.name.toLowerCase()];
    if (g) aspects[a.name] = [g];
  }
  if (p.material && !Object.keys(aspects).some((k) => /mineral|stone|material/i.test(k))) aspects["Material"] = [p.material];
  for (const [k, v] of Object.entries(overrides || {})) if (k && v) aspects[k] = [String(v)];
  const missing = required.filter((a) => !aspects[a.name]).map((a) => a.name);
  return { aspects, missing };
}

async function push(account, p, link, { publish, baseUrl, imageUrl }) {
  const s = { ...defaultSettings(), ...account.settings };
  const categoryId = link.options.category_id || s.category_id;
  const missing = missingSettings({ ...s, category_id: categoryId });
  if (missing.length) throw new MarketError(`Finish eBay setup first: ${missing.join(", ")}.`);
  if (p.price_cents < 99) throw new MarketError("eBay needs a price of at least $0.99.");
  if (!p.images.length) throw new MarketError("eBay needs at least one photo.");
  if (!/^https:\/\//.test(baseUrl)) throw new MarketError("eBay fetches photos from your site, so it must be on a public https address. Set PUBLIC_BASE_URL.");

  const { aspects, missing: missingAspects } = await buildAspects(p, categoryId, link.options.aspects);
  if (missingAspects.length) throw new MarketError(`This eBay category needs item specifics: ${missingAspects.join(", ")}. Add them under eBay item specifics below.`);

  const sku = `ss-${p.id}`;
  await call(account, "PUT", `/sell/inventory/v1/inventory_item/${sku}`, {
    availability: { shipToLocationAvailability: { quantity: p.stock } },
    condition: s.condition,
    product: {
      title: buildTitle(p, 80),
      description: buildDescription(p).slice(0, 4000),
      aspects,
      imageUrls: p.images.slice(0, 12).map((i) => imageUrl(i.id)),
    },
  });

  const offer = {
    sku,
    marketplaceId: MARKETPLACE,
    format: "FIXED_PRICE",
    availableQuantity: p.stock,
    categoryId,
    listingDescription: htmlDescription(p),
    listingPolicies: { fulfillmentPolicyId: s.fulfillment_policy_id, paymentPolicyId: s.payment_policy_id, returnPolicyId: s.return_policy_id },
    pricingSummary: { price: { value: dollars(p.price_cents).toFixed(2), currency: CURRENCY } },
    merchantLocationKey: s.merchant_location_key,
  };

  let offerId = link.options.offer_id;
  if (offerId) {
    try {
      await call(account, "PUT", `/sell/inventory/v1/offer/${offerId}`, offer);
    } catch (e) {
      if (e.httpStatus !== 404) throw e;
      offerId = null;
    }
  }
  if (!offerId) {
    try {
      offerId = (await call(account, "POST", "/sell/inventory/v1/offer", offer)).offerId;
    } catch (e) {
      if (e.errorId !== 25002) throw e; // offer already exists for this SKU
      const existing = await call(account, "GET", `/sell/inventory/v1/offer?sku=${sku}&marketplace_id=${MARKETPLACE}`);
      offerId = existing.offers[0].offerId;
      await call(account, "PUT", `/sell/inventory/v1/offer/${offerId}`, offer);
    }
    link.options.offer_id = offerId;
  }

  // A published offer's live listing updates automatically when the offer changes.
  const live = link.state === "active";
  if (!live && (publish || s.auto_publish) && p.stock > 0) {
    const r = await call(account, "POST", `/sell/inventory/v1/offer/${offerId}/publish`, {});
    link.remote_id = r.listingId;
    link.state = "active";
  } else if (!live) {
    link.state = "draft";
  }
  link.remote_url = link.remote_id && link.state === "active" ? `${ITEM_URL}${link.remote_id}` : null;
  return link;
}

async function end(account, link) {
  if (!link.options.offer_id || link.state !== "active") throw new MarketError("This listing isn't live on eBay.");
  await call(account, "POST", `/sell/inventory/v1/offer/${link.options.offer_id}/withdraw`, {});
  link.state = "ended";
  link.remote_url = null;
  return link;
}

// ---------- sales sync ----------
const canReadOrders = (account) => (account.tokens.scope_version || 1) >= SCOPE_VERSION;

/** Order lines created since `since` (Date). Cancelled orders are skipped. */
async function fetchSales(account, since) {
  const out = [];
  const filter = encodeURIComponent(`creationdate:[${since.toISOString()}..]`);
  let url = `/sell/fulfillment/v1/order?filter=${filter}&limit=200`;
  for (let page = 0; url && page < 20; page++) {
    const d = await call(account, "GET", url);
    for (const o of (d && d.orders) || []) {
      if (o.cancelStatus && o.cancelStatus.cancelState === "CANCELED") continue;
      for (const li of o.lineItems || []) {
        out.push({
          order_id: o.orderId,
          line_id: li.lineItemId,
          remote_listing_id: li.legacyItemId || "",
          sku: li.sku || "",
          title: li.title || "",
          quantity: li.quantity || 1,
          sold_at: new Date(o.creationDate),
        });
      }
    }
    url = d && d.next ? d.next.replace(/^https:\/\/[^/]+/, "") : null;
  }
  return out;
}

/** Bring the eBay offer's stock in line with ours. Zero makes the listing out of stock (or ends it). */
async function setQuantity(account, link, _p, qty) {
  const offerId = link.options && link.options.offer_id;
  if (!offerId) return link;
  const r = await call(account, "POST", "/sell/inventory/v1/bulk_update_price_quantity", {
    requests: [{ sku: `ss-${link.product_id}`, shipToLocationAvailability: { quantity: qty }, offers: [{ offerId, availableQuantity: qty }] }],
  });
  // The bulk call answers 200 even when an item fails; the real result is per item.
  const failed = ((r && r.responses) || []).find((x) => x.statusCode >= 400);
  if (failed) throw ebayError(failed, failed.statusCode);
  return link;
}

module.exports = {
  name: "eBay",
  canReadOrders,
  fetchSales,
  setQuantity,
  sandbox: SANDBOX,
  configured,
  authUrl,
  connect,
  readSettings,
  defaultSettings,
  missingSettings,
  options,
  searchCategories,
  requiredAspects,
  createLocation,
  push,
  end,
};
