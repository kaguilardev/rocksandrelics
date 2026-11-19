const express = require("express");
const multer = require("multer");
const { query, pool } = require("../db");
const auth = require("../auth");

const router = express.Router();
router.use("/api/admin", auth.requireXHR);

const TYPES = ["orb", "tower", "figure", "raw", "cluster"];
const STATUSES = ["draft", "published", "sold"];
const STYLES = ["amethyst", "aura", "rose", "labradorite", "fluorite", "obsidian", "citrine", "moonstone", "malachite", "galaxy", "tiger", "lapis"];
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_IMAGES_PER_PRODUCT = 8;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: MAX_IMAGES_PER_PRODUCT },
  fileFilter: (_req, file, cb) => cb(null, IMAGE_TYPES.includes(file.mimetype)),
});

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function slugify(s) {
  return String(s).toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_-]+/g, "-").slice(0, 60) || "item";
}

async function uniqueSlug(name, excludeId = null) {
  const base = slugify(name);
  let slug = base;
  for (let i = 2; ; i++) {
    const { rows } = await query("SELECT 1 FROM products WHERE slug = $1 AND id IS DISTINCT FROM $2", [slug, excludeId]);
    if (!rows.length) return slug;
    slug = `${base}-${i}`;
  }
}

/** Validate + normalize a product body. Returns { data } or { error }. */
function readProduct(body, partial = false) {
  const d = {};
  const str = (v, max) => String(v ?? "").trim().slice(0, max);

  if (!partial || body.name !== undefined) {
    d.name = str(body.name, 120);
    if (!d.name) return { error: "Name is required." };
  }
  if (body.type !== undefined) {
    if (!TYPES.includes(body.type)) return { error: "Unknown type." };
    d.type = body.type;
  }
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) return { error: "Unknown status." };
    d.status = body.status;
  }
  if (body.style !== undefined) {
    if (!STYLES.includes(body.style)) return { error: "Unknown color style." };
    d.style = body.style;
  }
  if (body.material !== undefined) d.material = str(body.material, 80);
  if (body.note !== undefined) d.note = str(body.note, 120);
  if (body.tag !== undefined) d.tag = str(body.tag, 24);
  if (body.description !== undefined) d.description = str(body.description, 5000);
  if (body.price !== undefined) {
    const n = Number(body.price);
    if (!Number.isFinite(n) || n < 0 || n > 1_000_000) return { error: "Price must be a positive number." };
    d.price_cents = Math.round(n * 100);
  }
  if (body.stock !== undefined) {
    const n = Number.parseInt(body.stock, 10);
    if (!Number.isInteger(n) || n < 0 || n > 100000) return { error: "Stock must be 0 or more." };
    d.stock = n;
  }
  return { data: d };
}

const ADMIN_PRODUCT_FIELDS = `
  p.*, u.name AS created_by_name,
  COALESCE((SELECT json_agg(json_build_object('id', i.id, 'bytes', i.bytes) ORDER BY i.position, i.id)
            FROM product_images i WHERE i.product_id = p.id), '[]') AS images`;

// ---------------- session ----------------
router.post("/api/admin/login", wrap(async (req, res) => {
  const { email, password } = req.body || {};
  const result = await auth.login(email, password, req.ip);
  if (result.error) return res.status(result.status).json({ error: result.error });
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: "Could not start session." });
    req.session.userId = result.user.id;
    res.json({ user: auth.publicUser(result.user) });
  });
}));

router.post("/api/admin/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("ss.sid");
    res.json({ ok: true });
  });
});

router.get("/api/admin/me", (req, res) => {
  res.json({ user: auth.publicUser(req.user) || null });
});

router.post("/api/admin/me/password", auth.requireAuth, wrap(async (req, res) => {
  const { current, next: nextPw } = req.body || {};
  const check = await auth.login(req.user.email, current, req.ip);
  if (check.error) return res.status(400).json({ error: "Current password is incorrect." });
  if (!auth.validPassword(nextPw)) return res.status(400).json({ error: `New password must be at least ${auth.MIN_PASSWORD} characters.` });
  await query("UPDATE users SET password_hash = $1 WHERE id = $2", [await auth.hashPassword(nextPw), req.user.id]);
  res.json({ ok: true });
}));

// ---------------- products ----------------
router.get("/api/admin/products", auth.requireAuth, wrap(async (_req, res) => {
  const { rows } = await query(
    `SELECT ${ADMIN_PRODUCT_FIELDS} FROM products p LEFT JOIN users u ON u.id = p.created_by ORDER BY p.updated_at DESC`
  );
  res.json(rows);
}));

router.get("/api/admin/products/:id", auth.requireAuth, wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT ${ADMIN_PRODUCT_FIELDS} FROM products p LEFT JOIN users u ON u.id = p.created_by WHERE p.id = $1`,
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Listing not found." });
  res.json(rows[0]);
}));

router.post("/api/admin/products", auth.requireAuth, wrap(async (req, res) => {
  const { data, error } = readProduct(req.body || {});
  if (error) return res.status(400).json({ error });
  data.slug = await uniqueSlug(data.name);
  data.created_by = req.user.id;
  const keys = Object.keys(data);
  const { rows } = await query(
    `INSERT INTO products (${keys.join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")}) RETURNING id`,
    keys.map((k) => data[k])
  );
  res.status(201).json({ id: rows[0].id });
}));

router.patch("/api/admin/products/:id", auth.requireAuth, wrap(async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const { data, error } = readProduct(req.body || {}, true);
  if (error) return res.status(400).json({ error });
  if (data.name) data.slug = await uniqueSlug(data.name, id);
  const keys = Object.keys(data);
  if (!keys.length) return res.json({ ok: true });
  const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
  const { rowCount } = await query(
    `UPDATE products SET ${sets}, updated_at = now() WHERE id = $${keys.length + 1}`,
    [...keys.map((k) => data[k]), id]
  );
  if (!rowCount) return res.status(404).json({ error: "Listing not found." });
  res.json({ ok: true });
}));

router.delete("/api/admin/products/:id", auth.requireAuth, wrap(async (req, res) => {
  const { rowCount } = await query("DELETE FROM products WHERE id = $1", [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: "Listing not found." });
  res.json({ ok: true });
}));

// ---------------- images ----------------
router.post(
  "/api/admin/products/:id/images",
  auth.requireAuth,
  upload.array("images", MAX_IMAGES_PER_PRODUCT),
  wrap(async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: "Choose JPG, PNG or WebP photos under 4 MB." });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const p = await client.query("SELECT id FROM products WHERE id = $1 FOR UPDATE", [id]);
      if (!p.rows[0]) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Listing not found." });
      }
      const { rows } = await client.query(
        "SELECT COUNT(*)::int AS n, COALESCE(MAX(position), -1) AS maxpos FROM product_images WHERE product_id = $1",
        [id]
      );
      if (rows[0].n + files.length > MAX_IMAGES_PER_PRODUCT) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: `A listing can have up to ${MAX_IMAGES_PER_PRODUCT} photos.` });
      }
      let pos = rows[0].maxpos + 1;
      for (const f of files) {
        await client.query(
          "INSERT INTO product_images (product_id, mime, data, bytes, position) VALUES ($1, $2, $3, $4, $5)",
          [id, f.mimetype, f.buffer, f.size, pos++]
        );
      }
      await client.query("UPDATE products SET updated_at = now() WHERE id = $1", [id]);
      await client.query("COMMIT");
      res.status(201).json({ ok: true, added: files.length });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  })
);

router.post("/api/admin/products/:id/images/:imageId/cover", auth.requireAuth, wrap(async (req, res) => {
  const { rowCount } = await query(
    "UPDATE product_images SET position = CASE WHEN id = $2 THEN -1 ELSE position END WHERE product_id = $1",
    [req.params.id, req.params.imageId]
  );
  if (!rowCount) return res.status(404).json({ error: "Photo not found." });
  // re-number so positions stay tidy
  await query(
    `UPDATE product_images i SET position = r.rn FROM (
       SELECT id, ROW_NUMBER() OVER (ORDER BY position, id) - 1 AS rn FROM product_images WHERE product_id = $1
     ) r WHERE i.id = r.id`,
    [req.params.id]
  );
  res.json({ ok: true });
}));

router.delete("/api/admin/products/:id/images/:imageId", auth.requireAuth, wrap(async (req, res) => {
  const { rowCount } = await query("DELETE FROM product_images WHERE id = $1 AND product_id = $2", [
    req.params.imageId,
    req.params.id,
  ]);
  if (!rowCount) return res.status(404).json({ error: "Photo not found." });
  res.json({ ok: true });
}));

// ---------------- team (owner only) ----------------
router.get("/api/admin/users", auth.requireAuth, wrap(async (_req, res) => {
  const { rows } = await query("SELECT id, email, name, role, created_at FROM users ORDER BY role, created_at");
  res.json(rows);
}));

router.post("/api/admin/users", auth.requireOwner, wrap(async (req, res) => {
  const email = auth.normalizeEmail(req.body?.email);
  const name = String(req.body?.name || "").trim().slice(0, 80);
  const password = req.body?.password;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Enter a valid email." });
  if (!auth.validPassword(password)) return res.status(400).json({ error: `Temporary password must be at least ${auth.MIN_PASSWORD} characters.` });
  const { rows } = await query(
    "INSERT INTO users (email, name, password_hash, role) VALUES ($1, $2, $3, 'staff') ON CONFLICT (email) DO NOTHING RETURNING id",
    [email, name, await auth.hashPassword(password)]
  );
  if (!rows[0]) return res.status(409).json({ error: "Someone with that email already has an account." });
  res.status(201).json({ id: rows[0].id });
}));

router.post("/api/admin/users/:id/password", auth.requireOwner, wrap(async (req, res) => {
  const password = req.body?.password;
  if (!auth.validPassword(password)) return res.status(400).json({ error: `Password must be at least ${auth.MIN_PASSWORD} characters.` });
  const { rowCount } = await query("UPDATE users SET password_hash = $1 WHERE id = $2", [await auth.hashPassword(password), req.params.id]);
  if (!rowCount) return res.status(404).json({ error: "User not found." });
  // sign that user out everywhere
  await query("DELETE FROM session WHERE (sess->>'userId')::int = $1", [req.params.id]).catch(() => {});
  res.json({ ok: true });
}));

router.delete("/api/admin/users/:id", auth.requireOwner, wrap(async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (id === req.user.id) return res.status(400).json({ error: "You can't remove your own account." });
  const { rowCount } = await query("DELETE FROM users WHERE id = $1 AND role <> 'owner'", [id]);
  if (!rowCount) return res.status(404).json({ error: "Staff member not found." });
  await query("DELETE FROM session WHERE (sess->>'userId')::int = $1", [id]).catch(() => {});
  res.json({ ok: true });
}));

module.exports = router;
