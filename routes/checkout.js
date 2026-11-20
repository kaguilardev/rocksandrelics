// Stripe Checkout: the cart is sent here, prices and stock are checked against the database,
// and the buyer is sent to a Stripe-hosted payment page. A webhook takes paid orders off stock.
const express = require("express");
const { query } = require("../db");
const sync = require("../marketplaces/sync");

const router = express.Router();

const stripeKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeKey ? require("stripe")(stripeKey) : null;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
const SHIP_COUNTRIES = (process.env.STRIPE_SHIP_COUNTRIES || "US")
  .split(",")
  .map((c) => c.trim().toUpperCase())
  .filter(Boolean);
const SHIPPING_CENTS = Number.parseInt(process.env.STRIPE_SHIPPING_CENTS || "0", 10) || 0;

function baseUrl(req) {
  return (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
}

function absoluteImage(req, imageId) {
  const url = `${baseUrl(req)}/img/${imageId}`;
  return url.startsWith("https://") ? [url] : undefined; // Stripe only shows https images
}

router.get("/api/checkout/config", (_req, res) => {
  res.json({ enabled: Boolean(stripe) });
});

router.post("/api/checkout", async (req, res, next) => {
  if (!stripe) return res.status(503).json({ error: "Online checkout isn't set up yet." });
  try {
    const raw = Array.isArray(req.body && req.body.items) ? req.body.items.slice(0, 50) : [];
    const wanted = new Map();
    for (const i of raw) {
      const slug = typeof i.slug === "string" ? i.slug : "";
      const qty = Number.parseInt(i.qty, 10);
      if (slug && qty > 0) wanted.set(slug, (wanted.get(slug) || 0) + Math.min(qty, 99));
    }
    if (!wanted.size) return res.status(400).json({ error: "Your cart is empty." });

    const { rows } = await query(
      `SELECT p.id, p.slug, p.name, p.price_cents, p.stock, p.status,
              (SELECT i.id FROM product_images i WHERE i.product_id = p.id ORDER BY i.position, i.id LIMIT 1) AS image
       FROM products p WHERE p.slug = ANY($1)`,
      [[...wanted.keys()]]
    );
    const bySlug = new Map(rows.map((r) => [r.slug, r]));

    const problems = [];
    const lineItems = [];
    for (const [slug, qty] of wanted) {
      const p = bySlug.get(slug);
      if (!p || p.status !== "published" || p.stock <= 0) {
        problems.push({ slug, error: `${p ? p.name : "An item"} is no longer available.` });
        continue;
      }
      if (qty > p.stock) {
        problems.push({ slug, error: `Only ${p.stock} of ${p.name} left.`, max: p.stock });
        continue;
      }
      if (p.price_cents < 50) {
        problems.push({ slug, error: `${p.name} can't be bought online. Please contact us.` });
        continue;
      }
      lineItems.push({
        quantity: qty,
        price_data: {
          currency: "usd",
          unit_amount: p.price_cents,
          product_data: {
            name: p.name,
            images: p.image ? absoluteImage(req, p.image) : undefined,
            metadata: { product_id: String(p.id) },
          },
        },
      });
    }
    if (problems.length) return res.status(409).json({ error: problems[0].error, problems });

    const base = baseUrl(req);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: lineItems,
      shipping_address_collection: { allowed_countries: SHIP_COUNTRIES },
      shipping_options: [
        {
          shipping_rate_data: {
            display_name: SHIPPING_CENTS ? "Standard shipping" : "Free shipping",
            type: "fixed_amount",
            fixed_amount: { amount: SHIPPING_CENTS, currency: "usd" },
          },
        },
      ],
      phone_number_collection: { enabled: true },
      success_url: `${base}/cart?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/cart?checkout=cancelled`,
    });
    res.json({ url: session.url });
  } catch (e) {
    if (e && e.type && e.type.startsWith("Stripe")) {
      console.error("Stripe checkout error:", e.message);
      return res.status(502).json({ error: "Couldn't start checkout. Please try again." });
    }
    next(e);
  }
});

/** Take a paid Checkout Session off stock (safe to repeat: each line is only counted once). */
async function fulfil(sessionId) {
  const items = await stripe.checkout.sessions.listLineItems(sessionId, { limit: 100, expand: ["data.price.product"] });
  const changed = new Set();
  for (const li of items.data) {
    const productId = li.price && li.price.product && li.price.product.metadata && li.price.product.metadata.product_id;
    const id = await sync.applySale("stripe", {
      line_id: li.id,
      order_id: sessionId,
      sku: productId ? `ss-${productId}` : "",
      title: li.description,
      quantity: li.quantity,
      sold_at: new Date(),
    });
    if (id) changed.add(id);
  }
  // Pass the new stock to Etsy/eBay so a one-of-a-kind piece can't sell twice.
  for (const id of changed) await sync.pushQuantity(id).catch((e) => console.error(e));
}

// Mounted before express.json() in server.js: Stripe signs the raw body.
const webhook = express.Router();
webhook.post("/api/stripe/webhook", express.raw({ type: "application/json", limit: "1mb" }), async (req, res) => {
  if (!stripe || !webhookSecret) return res.status(503).end();
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.get("stripe-signature"), webhookSecret);
  } catch (e) {
    return res.status(400).send(`Webhook error: ${e.message}`);
  }
  try {
    if (
      (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") &&
      event.data.object.payment_status === "paid"
    ) {
      await fulfil(event.data.object.id);
    }
    res.json({ received: true });
  } catch (e) {
    console.error("Stripe webhook failed:", e);
    res.status(500).end(); // Stripe will retry
  }
});

module.exports = { router, webhook };
