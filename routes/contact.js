// Contact form: every message is saved (Admin → Messages) and, if email is set up, sent to the shop's inbox.
const express = require("express");
const { query } = require("../db");
const auth = require("../auth");

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const TOPICS = ["A stone I'm looking for", "An existing order", "Shipping", "Something else"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---- simple per-IP limit so the form can't be used to flood the inbox ----
const recent = new Map();
const LIMIT_WINDOW_MS = 30 * 60 * 1000;
const LIMIT_COUNT = 5;
function overLimit(ip) {
  const now = Date.now();
  const list = (recent.get(ip) || []).filter((t) => now - t < LIMIT_WINDOW_MS);
  if (list.length >= LIMIT_COUNT) return true;
  list.push(now);
  recent.set(ip, list);
  if (recent.size > 5000) recent.clear();
  return false;
}

const oneLine = (s, max) => String(s || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, max);

function emailConfig() {
  const to = (process.env.CONTACT_TO_EMAIL || "").split(",").map((s) => s.trim()).filter(Boolean);
  return {
    apiKey: process.env.RESEND_API_KEY,
    to,
    from: process.env.CONTACT_FROM_EMAIL || "Stardust & Stoneworks <onboarding@resend.dev>",
    ready: Boolean(process.env.RESEND_API_KEY && to.length),
  };
}

/** Send one saved message to the shop's inbox via Resend. Records the result on the row. */
async function notify(msg) {
  const cfg = emailConfig();
  if (!cfg.ready) return;
  let error = null;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: cfg.from,
        to: cfg.to,
        reply_to: msg.email,
        subject: `New message: ${oneLine(msg.topic, 60)} (from ${oneLine(msg.name, 60)})`,
        text:
          `${msg.name} <${msg.email}> wrote through the contact form:\n\n` +
          `Topic: ${msg.topic}\n\n${msg.message}\n\n` +
          `Reply to this email to answer them directly.\n` +
          `All messages: ${(process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "")}/admin#/messages`,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      error = `Email service said: ${body.message || res.status}`.slice(0, 300);
    }
  } catch (e) {
    error = `Email could not be sent (${e.name === "TimeoutError" ? "timed out" : "network error"}).`;
  }
  if (error) console.error("Contact email failed:", error);
  await query(
    "UPDATE contact_messages SET emailed_at = CASE WHEN $2::text IS NULL THEN now() END, email_error = $2 WHERE id = $1",
    [msg.id, error]
  ).catch((e) => console.error(e));
}

// ---- public: the contact form posts here ----
router.post("/api/contact", wrap(async (req, res) => {
  const b = req.body || {};
  if (b.website) return res.json({ ok: true }); // hidden honeypot field: only bots fill it in
  const name = oneLine(b.name, 100);
  const email = oneLine(b.email, 200);
  const topic = TOPICS.includes(b.topic) ? b.topic : "Something else";
  const message = String(b.message || "").trim().slice(0, 5000);
  if (!name) return res.status(400).json({ error: "Please add your name." });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "Please check your email address." });
  if (!message) return res.status(400).json({ error: "Please write a message." });
  if (overLimit(req.ip)) return res.status(429).json({ error: "You've sent a few messages already. Please try again a little later." });

  const { rows } = await query(
    "INSERT INTO contact_messages (name, email, topic, message) VALUES ($1, $2, $3, $4) RETURNING id",
    [name, email, topic, message]
  );
  await notify({ id: rows[0].id, name, email, topic, message });
  res.json({ ok: true });
}));

// ---- admin: read and manage messages ----
router.use("/api/admin/messages", auth.requireXHR, auth.requireAuth);

router.get("/api/admin/messages", wrap(async (_req, res) => {
  const { rows } = await query(
    `SELECT id, name, email, topic, message, read_at, emailed_at, email_error, created_at
     FROM contact_messages ORDER BY created_at DESC LIMIT 300`
  );
  const cfg = emailConfig();
  res.json({ messages: rows, email: { ready: cfg.ready } });
}));

router.get("/api/admin/messages/unread", wrap(async (_req, res) => {
  const { rows } = await query("SELECT count(*)::int AS n FROM contact_messages WHERE read_at IS NULL");
  res.json({ unread: rows[0].n });
}));

router.patch("/api/admin/messages/:id", wrap(async (req, res) => {
  const read = Boolean(req.body && req.body.read);
  const { rowCount } = await query(
    "UPDATE contact_messages SET read_at = CASE WHEN $2 THEN COALESCE(read_at, now()) END WHERE id = $1",
    [req.params.id, read]
  );
  if (!rowCount) return res.status(404).json({ error: "Message not found." });
  res.json({ ok: true });
}));

router.delete("/api/admin/messages/:id", wrap(async (req, res) => {
  const { rowCount } = await query("DELETE FROM contact_messages WHERE id = $1", [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: "Message not found." });
  res.json({ ok: true });
}));

module.exports = router;
