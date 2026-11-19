const bcrypt = require("bcryptjs");
const { query } = require("./db");

const MIN_PASSWORD = 10;

async function hashPassword(pw) {
  return bcrypt.hash(pw, 12);
}

function validPassword(pw) {
  return typeof pw === "string" && pw.length >= MIN_PASSWORD && pw.length <= 200;
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

/** Create the first owner account from env vars if no users exist yet. */
async function bootstrapOwner() {
  const { rows } = await query("SELECT COUNT(*)::int AS n FROM users");
  if (rows[0].n > 0) return;

  const email = normalizeEmail(process.env.ADMIN_EMAIL);
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.warn("No admin users yet. Set ADMIN_EMAIL and ADMIN_PASSWORD to create the owner account.");
    return;
  }
  if (!validPassword(password)) {
    console.warn(`ADMIN_PASSWORD must be at least ${MIN_PASSWORD} characters. Owner account not created.`);
    return;
  }
  await query(
    "INSERT INTO users (email, name, password_hash, role) VALUES ($1, $2, $3, 'owner') ON CONFLICT (email) DO NOTHING",
    [email, process.env.ADMIN_NAME || "Owner", await hashPassword(password)]
  );
  console.log(`Owner account created for ${email}. You can remove ADMIN_PASSWORD from the environment now.`);
}

// ---- simple in-memory login throttle (per IP + email) ----
const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;

function throttled(key) {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || now - a.first > WINDOW_MS) return false;
  return a.count >= MAX_ATTEMPTS;
}
function recordFail(key) {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || now - a.first > WINDOW_MS) attempts.set(key, { first: now, count: 1 });
  else a.count++;
}
function clearFails(key) {
  attempts.delete(key);
}

let dummyHash = null;

async function login(email, password, ip) {
  const key = `${ip}|${normalizeEmail(email)}`;
  if (throttled(key)) return { error: "Too many attempts. Try again in 15 minutes.", status: 429 };

  const { rows } = await query("SELECT * FROM users WHERE email = $1", [normalizeEmail(email)]);
  const user = rows[0];
  // Compare against a dummy hash when the user doesn't exist to keep timing similar.
  if (!dummyHash) dummyHash = await bcrypt.hash("not-a-real-password", 12);
  const ok = await bcrypt.compare(String(password || ""), user ? user.password_hash : dummyHash);
  if (!user || !ok) {
    recordFail(key);
    return { error: "Email or password is incorrect.", status: 401 };
  }
  clearFails(key);
  return { user };
}

function publicUser(u) {
  return u && { id: u.id, email: u.email, name: u.name, role: u.role, created_at: u.created_at };
}

// ---- middleware ----
async function loadUser(req, _res, next) {
  if (!req.session || !req.session.userId) return next();
  try {
    const { rows } = await query("SELECT * FROM users WHERE id = $1", [req.session.userId]);
    if (rows[0]) req.user = rows[0];
    else req.session.userId = null;
  } catch (e) {
    return next(e);
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Please log in." });
  next();
}

function requireOwner(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Please log in." });
  if (req.user.role !== "owner") return res.status(403).json({ error: "Only the owner can do that." });
  next();
}

/** Blocks cross-site form posts: admin API calls must come from our own fetch(). */
function requireXHR(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.get("X-Requested-With") !== "fetch") return res.status(403).json({ error: "Bad request origin." });
  next();
}

module.exports = {
  MIN_PASSWORD,
  hashPassword,
  validPassword,
  normalizeEmail,
  bootstrapOwner,
  login,
  publicUser,
  loadUser,
  requireAuth,
  requireOwner,
  requireXHR,
};
