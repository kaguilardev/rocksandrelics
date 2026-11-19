// ---------- Products (placeholder catalog) ----------
const products = [
  { name: "Amethyst Orb",          type: "orb",     shape: "gem-orb",     mat: "amethyst",    price: 68,  note: "Brazil · 60mm sphere",           tag: "Bestseller" },
  { name: "Aura Quartz Tower",     type: "tower",   shape: "gem-tower",   mat: "aura",        price: 54,  note: "Titanium-bonded · 4in point",    tag: "New" },
  { name: "Rose Quartz Heart",     type: "figure",  shape: "gem-heart",   mat: "rose",        price: 32,  note: "Madagascar · hand-carved" },
  { name: "Raw Labradorite",       type: "raw",     shape: "gem-raw",     mat: "labradorite", price: 26,  note: "Flashes teal & electric blue" },
  { name: "Rainbow Fluorite Cluster", type: "cluster", shape: "gem-cluster", mat: "fluorite", price: 89,  note: "Natural formation · display piece", tag: "Rare" },
  { name: "Galaxy Obsidian Sphere", type: "orb",    shape: "gem-orb",     mat: "galaxy",      price: 74,  note: "Silver-sheen inclusions" },
  { name: "Moonstone Crescent",    type: "figure",  shape: "gem-moon",    mat: "moonstone",   price: 38,  note: "Blue-flash moonstone carving" },
  { name: "Citrine Point",         type: "tower",   shape: "gem-tower",   mat: "citrine",     price: 46,  note: "Golden glow · polished" },
  { name: "Malachite Egg",         type: "figure",  shape: "gem-egg",     mat: "malachite",   price: 58,  note: "Congo · banded green" },
  { name: "Raw Black Obsidian",    type: "raw",     shape: "gem-raw",     mat: "obsidian",    price: 18,  note: "Volcanic glass · unpolished" },
  { name: "Lapis Lazuli Pyramid",  type: "figure",  shape: "gem-pyramid", mat: "lapis",       price: 42,  note: "Golden pyrite flecks" },
  { name: "Tiger's Eye Tumbled",   type: "raw",     shape: "gem-tumbled", mat: "tiger",       price: 9,   note: "Pocket stone · chatoyant" },
];

const grid = document.getElementById("productGrid");
const cartCountEl = document.getElementById("cartCount");
const cartBtn = document.querySelector(".cart");
const toast = document.getElementById("toast");
let cartCount = 0;

function render(filter = "all") {
  const list = filter === "all" ? products : products.filter((p) => p.type === filter);
  grid.innerHTML = list
    .map(
      (p, i) => `
      <article class="card" style="animation-delay:${i * 50}ms">
        ${p.tag ? `<span class="tag">${p.tag}</span>` : ""}
        <div class="card-art"><span class="gem ${p.shape} ${p.mat}"></span></div>
        <div class="card-body">
          <h3>${p.name}</h3>
          <p>${p.note}</p>
          <div class="card-foot">
            <span class="price">$${p.price}</span>
            <button class="add" type="button" data-name="${p.name}">Add to cart</button>
          </div>
        </div>
      </article>`
    )
    .join("");
}

function setFilter(filter) {
  document.querySelectorAll(".chip").forEach((c) => {
    const on = c.dataset.filter === filter;
    c.classList.toggle("active", on);
    c.setAttribute("aria-selected", on);
  });
  render(filter);
}

let toastTimer;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
}

document.querySelectorAll(".chip").forEach((c) =>
  c.addEventListener("click", () => setFilter(c.dataset.filter))
);

document.querySelectorAll(".collection").forEach((c) =>
  c.addEventListener("click", () => {
    setFilter(c.dataset.filter);
    document.getElementById("shop").scrollIntoView({ behavior: "smooth" });
  })
);

grid.addEventListener("click", (e) => {
  const btn = e.target.closest(".add");
  if (!btn) return;
  cartCount++;
  cartCountEl.textContent = cartCount;
  cartBtn.classList.remove("bump");
  void cartBtn.offsetWidth;
  cartBtn.classList.add("bump");
  showToast(`✦ ${btn.dataset.name} added to your cart`);
});

document.getElementById("signupForm").addEventListener("submit", (e) => {
  e.preventDefault();
  document.getElementById("formNote").textContent = "✦ You're on the list. Watch the skies (and your inbox).";
  e.target.reset();
});

document.getElementById("year").textContent = new Date().getFullYear();
render();

// ---------- Starfield ----------
(function stars() {
  const canvas = document.getElementById("stars");
  const ctx = canvas.getContext("2d");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const colors = ["#ffffff", "#7cf5ff", "#b48cff", "#8fd3ff", "#ff9ee8"];
  let w, h, dpr, field = [];

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.width = innerWidth * dpr;
    h = canvas.height = innerHeight * dpr;
    const count = Math.round((innerWidth * innerHeight) / 4500);
    field = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: (Math.random() * 1.2 + 0.2) * dpr,
      c: colors[Math.random() < 0.75 ? 0 : Math.floor(Math.random() * colors.length)],
      t: Math.random() * Math.PI * 2,
      s: 0.005 + Math.random() * 0.02,
      v: 0.02 + Math.random() * 0.08,
    }));
  }

  function draw() {
    ctx.clearRect(0, 0, w, h);
    for (const st of field) {
      st.t += st.s;
      if (!reduce) {
        st.y -= st.v * dpr;
        if (st.y < 0) st.y = h;
      }
      ctx.globalAlpha = 0.35 + Math.abs(Math.sin(st.t)) * 0.65;
      ctx.fillStyle = st.c;
      ctx.beginPath();
      ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
      ctx.fill();
    }
    if (!reduce) requestAnimationFrame(draw);
  }

  resize();
  draw();
  addEventListener("resize", () => { resize(); if (reduce) draw(); });
})();
