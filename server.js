const path = require("path");
const express = require("express");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const { pool, migrate } = require("./db");
const auth = require("./auth");

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === "production" || Boolean(process.env.RENDER);

let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  sessionSecret = require("crypto").randomBytes(32).toString("hex");
  if (isProd) console.warn("SESSION_SECRET is not set. Using a temporary one, so logins reset on every deploy.");
}

app.set("trust proxy", 1); // Render sits behind a proxy (needed for secure cookies + req.ip)
app.disable("x-powered-by");

app.use((_req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.set("X-Frame-Options", "DENY");
  next();
});

// Health check for Render
app.get("/healthz", (_req, res) => res.json({ status: "ok" }));

app.use(express.json({ limit: "200kb" }));

app.use(
  session({
    name: "ss.sid",
    store: new PgSession({ pool, tableName: "session", createTableIfMissing: true }),
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: isProd,
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    },
  })
);
app.use(auth.loadUser);

app.use(require("./routes/public"));
app.use(require("./routes/admin"));

// Admin single-page app
app.get(["/admin", "/admin/"], (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.sendFile(path.join(__dirname, "public", "admin", "index.html"));
});

// Static site
app.use(
  express.static(path.join(__dirname, "public"), {
    extensions: ["html"],
    maxAge: isProd ? "1h" : 0,
  })
);

app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

app.use((_req, res) => {
  res.status(404).sendFile(path.join(__dirname, "public", "index.html"));
});

// Errors
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err && err.code === "LIMIT_FILE_SIZE") return res.status(400).json({ error: "Each photo must be under 4 MB." });
  console.error(err);
  res.status(500).json({ error: "Something went wrong." });
});

async function start() {
  if (process.env.DATABASE_URL) {
    await migrate();
    await auth.bootstrapOwner();
  }
  app.listen(PORT, () => console.log(`Stardust & Stoneworks running on http://localhost:${PORT}`));
}

start().catch((e) => {
  console.error("Failed to start:", e);
  process.exit(1);
});
