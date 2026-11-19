const express = require("express");
const { query } = require("../db");

const router = express.Router();

const PRODUCT_FIELDS = `
  p.id, p.slug, p.name, p.type, p.material, p.style, p.description, p.note,
  p.price_cents, p.stock, p.tag, p.status,
  COALESCE(
    (SELECT json_agg(i.id ORDER BY i.position, i.id) FROM product_images i WHERE i.product_id = p.id),
    '[]'
  ) AS images`;

// Published (and sold) listings for the storefront
router.get("/api/products", async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT ${PRODUCT_FIELDS} FROM products p
       WHERE p.status IN ('published','sold')
       ORDER BY (p.status = 'sold'), p.created_at DESC`
    );
    res.set("Cache-Control", "public, max-age=30");
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.get("/api/products/:slug", async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT ${PRODUCT_FIELDS} FROM products p WHERE p.slug = $1 AND p.status IN ('published','sold')`,
      [req.params.slug]
    );
    if (!rows[0]) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

// Product photos stored in Postgres
router.get("/img/:id", async (req, res, next) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).end();
  try {
    const { rows } = await query(
      `SELECT i.mime, i.data FROM product_images i
       JOIN products p ON p.id = i.product_id
       WHERE i.id = $1 AND (p.status IN ('published','sold') OR $2::boolean)`,
      [id, Boolean(req.user)]
    );
    if (!rows[0]) return res.status(404).end();
    res.set("Content-Type", rows[0].mime);
    // Images are immutable (replacing a photo creates a new id), so cache hard.
    res.set("Cache-Control", `${req.user ? "private" : "public"}, max-age=31536000, immutable`);
    res.send(rows[0].data);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
