const crypto = require("crypto");

const TYPE_LABELS = { orb: "Crystal Sphere", tower: "Crystal Tower", figure: "Crystal Carving", raw: "Raw Stone", cluster: "Crystal Cluster" };

const base64url = (buf) => Buffer.from(buf).toString("base64url");
const randomToken = (n = 32) => base64url(crypto.randomBytes(n));
const pkceChallenge = (verifier) => base64url(crypto.createHash("sha256").update(verifier).digest());

function clip(s, max) {
  s = String(s || "").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trim();
}

/** A marketplace title: name plus material/form if they add information. */
function buildTitle(p, max) {
  const parts = [p.name];
  if (p.material && !p.name.toLowerCase().includes(p.material.toLowerCase())) parts.push(p.material);
  if (p.note) parts.push(p.note);
  return clip(parts.join(" · ").replace(/\s+/g, " "), max);
}

function buildDescription(p) {
  const lines = [];
  if (p.description) lines.push(p.description.trim());
  else lines.push(`${p.name}${p.material ? `, ${p.material}` : ""}.`);
  if (p.note) lines.push("", p.note);
  return lines.join("\n");
}

/** Short keyword tags derived from the listing. */
function buildTags(p) {
  const words = [p.material, TYPE_LABELS[p.type], p.tag, "crystal", "gemstone", "natural stone", "healing crystal", "mineral"];
  if (p.type === "orb") words.push("crystal ball", "sphere");
  if (p.type === "tower") words.push("crystal point", "obelisk");
  if (p.type === "raw") words.push("raw crystal", "rough stone");
  if (p.type === "cluster") words.push("geode", "druzy");
  if (p.type === "figure") words.push("carving", "figurine");
  return words;
}

const dollars = (cents) => Math.round(cents) / 100;

module.exports = { TYPE_LABELS, randomToken, pkceChallenge, clip, buildTitle, buildDescription, buildTags, dollars };
