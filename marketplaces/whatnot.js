// Whatnot CSV export, matching Whatnot's bulk-import template (US / AU / NL, non-coins).
// Whatnot's Seller API is invite-only, so this is a one-way export you upload in Seller Hub → Inventory → Import from CSV.
const { buildTitle, buildDescription, dollars } = require("./common");

const HEADERS = [
  "Category", "Sub Category", "Title", "Description", "Quantity", "Type", "Price", "Shipping Profile",
  "Offerable", "Hazmat", "Condition", "Cost Per Item", "SKU",
  "Image URL 1", "Image URL 2", "Image URL 3", "Image URL 4", "Image URL 5", "Image URL 6", "Image URL 7", "Image URL 8",
];

// Values must match the template's "Values" tab exactly.
const CATEGORY = "Rocks & Crystals";
const SUB_CATEGORIES = ["Crystals & Gems", "Mineral Specimens", "Fossils", "Other Rocks"];
const SUB_BY_TYPE = { orb: "Crystals & Gems", tower: "Crystals & Gems", figure: "Crystals & Gems", cluster: "Mineral Specimens", raw: "Mineral Specimens" };
const SHIPPING_PROFILES = ["0-1 oz", "1-3 oz", "4-7 oz", "8-11 oz", "12-15 oz", "1 lb", "1-2 lbs", "2-3 lbs", "3-4 lbs", "4-6 lbs", "10-14 lbs"];
const TYPES = ["Buy it Now", "Auction"];

/** Quote a CSV cell; neutralise spreadsheet formulas in free text. */
function cell(v, { text = false } = {}) {
  let s = String(v ?? "");
  if (text && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

function readOptions(q) {
  const type = TYPES.includes(q.type) ? q.type : TYPES[0];
  const shipping = String(q.shipping || "").trim().slice(0, 80) || "8-11 oz";
  return {
    type,
    shipping, // a template weight band, or the name of a custom profile already created on Whatnot
    offerable: type === "Buy it Now" && (q.offerable === "1" || q.offerable === "true"),
    includeDrafts: q.drafts === "1" || q.drafts === "true",
  };
}

function toCsv(products, opts, imageUrl) {
  const lines = [HEADERS.map((h) => cell(h)).join(",")];
  for (const p of products) {
    const images = p.images.slice(0, 8).map((i) => imageUrl(i.id));
    while (images.length < 8) images.push("");
    lines.push([
      cell(CATEGORY),
      cell(SUB_BY_TYPE[p.type] || "Other Rocks"),
      cell(buildTitle(p, 80), { text: true }),
      cell(buildDescription(p), { text: true }),
      cell(p.stock),
      cell(opts.type),
      cell(dollars(p.price_cents).toFixed(2)),
      cell(opts.shipping, { text: true }),
      cell(opts.offerable ? "TRUE" : "FALSE"),
      cell("Not Hazmat"),
      cell(""), // Condition isn't required for Rocks & Crystals
      cell(""),
      cell(`ss-${p.id}`),
      ...images.map((u) => cell(u)),
    ].join(","));
  }
  return lines.join("\r\n") + "\r\n"; // no BOM: it would become part of the "Category" header on import
}

module.exports = { HEADERS, CATEGORY, SUB_CATEGORIES, SHIPPING_PROFILES, TYPES, readOptions, toCsv };
