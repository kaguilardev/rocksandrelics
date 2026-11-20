/* Shared across every storefront page: header, footer, stardust, cart, reveals, product cards. */
(() => {
  "use strict";

  const PAGES = [
    ["/", "Home"],
    ["/shop", "Shop"],
    ["/about", "Our Story"],
    ["/contact", "Contact"],
  ];
  const FORMS = {
    orb: { label: "Orbs & Spheres", short: "Orbs", blurb: "Polished and round", shape: "gem-orb", style: "amethyst", glow: "rgba(155,79,230,.35)" },
    tower: { label: "Towers & Points", short: "Towers", blurb: "Standing crystals", shape: "gem-tower", style: "aura", glow: "rgba(143,211,255,.3)" },
    figure: { label: "Figures & Shapes", short: "Figures", blurb: "Hearts, moons, carvings", shape: "gem-heart", style: "rose", glow: "rgba(255,158,232,.28)" },
    raw: { label: "Raw Stones", short: "Raw", blurb: "Natural and unpolished", shape: "gem-raw", style: "labradorite", glow: "rgba(62,224,216,.28)" },
    cluster: { label: "Clusters & Geodes", short: "Clusters", blurb: "Natural formations", shape: "gem-cluster", style: "fluorite", glow: "rgba(139,92,246,.32)" },
  };

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (cents) => `$${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;
  const gem = (p) => `<span class="gem ${FORMS[p.type]?.shape || "gem-raw"} ${esc(p.style || FORMS[p.type]?.style || "amethyst")}"></span>`;
  const isSold = (p) => p.status === "sold" || p.stock === 0;
  const productUrl = (p) => `/product?p=${encodeURIComponent(p.slug)}`;
  const here = location.pathname.replace(/\.html$/, "").replace(/\/index$/, "/") || "/";

  // ---------- header / footer ----------
  const navLinks = PAGES.map(([href, label]) => `<a href="${href}"${here === href ? ' aria-current="page"' : ""}>${label}</a>`).join("");
  const header = document.getElementById("site-header");
  if (header) {
    header.className = "site-header";
    header.innerHTML = `
      <div class="nav" id="nav">
        <div class="wrap nav-inner">
          <a href="/" class="brand-word" aria-label="Stardust &amp; Stoneworks home">Stardust <span class="amp">&amp;</span> Stoneworks</a>
          <nav class="links" aria-label="Main">${navLinks}</nav>
          <div class="nav-actions">
            <a class="icon-btn" href="/cart" aria-label="Cart">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 7h12l-1.2 12.2a1 1 0 0 1-1 .8H8.2a1 1 0 0 1-1-.8z M9 7a3 3 0 0 1 6 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
              <span class="cart-count" id="cartCount" hidden>0</span>
            </a>
            <button class="icon-btn menu-btn" id="menuBtn" type="button" aria-label="Menu" aria-expanded="false" aria-controls="mobileMenu">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h16M4 16h16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
            </button>
          </div>
        </div>
      </div>
      <nav class="mobile-menu" id="mobileMenu" aria-label="Mobile">${navLinks}<a href="/cart"${here === "/cart" ? ' aria-current="page"' : ""}>Cart</a></nav>`;
    const nav = document.getElementById("nav");
    const onScroll = () => nav.classList.toggle("scrolled", scrollY > 10);
    addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    const menuBtn = document.getElementById("menuBtn");
    const menu = document.getElementById("mobileMenu");
    menuBtn.addEventListener("click", () => {
      const open = menu.classList.toggle("open");
      menuBtn.setAttribute("aria-expanded", open);
      document.body.style.overflow = open ? "hidden" : "";
    });
  }

  const footer = document.getElementById("site-footer");
  if (footer) {
    footer.className = "footer";
    footer.innerHTML = `
      <div class="wrap">
        <div class="footer-grid">
          <div>
            <a href="/" class="brand-word">Stardust <span class="amp">&amp;</span> Stoneworks</a>
            <p style="max-width:22rem;margin:1rem 0 0">Crystals, stones and minerals, chosen by hand and photographed as they are.</p>
          </div>
          <div><h4>Shop</h4><ul>${Object.entries(FORMS).map(([k, f]) => `<li><a href="/shop?form=${k}">${f.label}</a></li>`).join("")}</ul></div>
          <div><h4>Studio</h4><ul><li><a href="/about">Our story</a></li><li><a href="/contact">Contact</a></li><li><a href="/contact#faq">Shipping &amp; care</a></li></ul></div>
          <div><h4>Account</h4><ul><li><a href="/cart">Your cart</a></li><li><a href="/admin">Staff login</a></li></ul></div>
        </div>
        <div class="footer-bottom"><span>© ${new Date().getFullYear()} Stardust &amp; Stoneworks</span><span>Made with stardust ✦</span></div>
      </div>`;
  }

  // ---------- stardust canvas ----------
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  (function stardust() {
    const neb = document.createElement("div");
    neb.className = "nebula";
    const canvas = document.createElement("canvas");
    canvas.id = "stardust";
    canvas.setAttribute("aria-hidden", "true");
    document.body.prepend(neb, canvas);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const COLORS = ["255,255,255", "255,255,255", "255,255,255", "197,140,255", "62,224,216", "224,169,130"];
    let w, h, dpr, stars = [], shooting = null, mouseX = 0, mouseY = 0;

    function resize() {
      dpr = Math.min(devicePixelRatio || 1, 2);
      w = innerWidth; h = innerHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.round(Math.min(220, (w * h) / 7000));
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        r: Math.random() * 1.3 + 0.2,
        z: Math.random() * 0.8 + 0.2,
        c: COLORS[(Math.random() * COLORS.length) | 0],
        t: Math.random() * Math.PI * 2,
        s: 0.005 + Math.random() * 0.02,
      }));
    }
    function draw() {
      ctx.clearRect(0, 0, w, h);
      const px = (mouseX / w - 0.5) * 18, py = (mouseY / h - 0.5) * 18;
      for (const s of stars) {
        s.t += s.s;
        if (!reduceMotion) { s.y -= s.z * 0.08; if (s.y < -2) { s.y = h + 2; s.x = Math.random() * w; } }
        const a = 0.25 + 0.75 * Math.abs(Math.sin(s.t));
        const x = s.x + px * s.z, y = s.y + py * s.z;
        ctx.beginPath();
        ctx.fillStyle = `rgba(${s.c},${a * s.z})`;
        ctx.arc(x, y, s.r, 0, Math.PI * 2);
        ctx.fill();
        if (s.r > 1.25 && a > 0.9) {
          ctx.strokeStyle = `rgba(${s.c},${(a - 0.9) * 4 * s.z})`;
          ctx.lineWidth = 0.6;
          ctx.beginPath(); ctx.moveTo(x - 5, y); ctx.lineTo(x + 5, y); ctx.moveTo(x, y - 5); ctx.lineTo(x, y + 5); ctx.stroke();
        }
      }
      if (!reduceMotion) {
        if (!shooting && Math.random() < 0.003) {
          shooting = { x: Math.random() * w * 0.7 + w * 0.2, y: Math.random() * h * 0.4, vx: -(6 + Math.random() * 4), vy: 2.5 + Math.random() * 2, life: 1 };
        }
        if (shooting) {
          const g = ctx.createLinearGradient(shooting.x, shooting.y, shooting.x - shooting.vx * 14, shooting.y - shooting.vy * 14);
          g.addColorStop(0, `rgba(255,255,255,${shooting.life})`);
          g.addColorStop(1, "rgba(197,140,255,0)");
          ctx.strokeStyle = g; ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.moveTo(shooting.x, shooting.y); ctx.lineTo(shooting.x - shooting.vx * 14, shooting.y - shooting.vy * 14); ctx.stroke();
          shooting.x += shooting.vx; shooting.y += shooting.vy; shooting.life -= 0.014;
          if (shooting.life <= 0) shooting = null;
        }
      }
      if (!document.hidden) requestAnimationFrame(draw);
    }
    resize();
    addEventListener("resize", resize);
    addEventListener("pointermove", (e) => { mouseX = e.clientX; mouseY = e.clientY; }, { passive: true });
    document.addEventListener("visibilitychange", () => { if (!document.hidden) requestAnimationFrame(draw); });
    requestAnimationFrame(draw);
  })();

  // ---------- reveal on scroll ----------
  const io = "IntersectionObserver" in window
    ? new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { threshold: 0.12, rootMargin: "0px 0px -40px 0px" })
    : null;
  function reveal(root = document) {
    root.querySelectorAll(".reveal:not(.in)").forEach((el) => (io ? io.observe(el) : el.classList.add("in")));
  }

  // ---------- card tilt + glow ----------
  function tilt(root = document) {
    if (reduceMotion || matchMedia("(hover: none)").matches) return;
    root.querySelectorAll(".card, .form-card").forEach((el) => {
      if (el.dataset.tilt) return;
      el.dataset.tilt = "1";
      el.addEventListener("pointermove", (e) => {
        const r = el.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        el.style.setProperty("--mx", `${x * 100}%`);
        el.style.setProperty("--my", `${y * 100}%`);
        el.style.transform = `perspective(900px) rotateX(${(0.5 - y) * 6}deg) rotateY(${(x - 0.5) * 6}deg) translateY(-4px)`;
      });
      el.addEventListener("pointerleave", () => { el.style.transform = ""; });
    });
  }

  // ---------- toast ----------
  const toastEl = document.createElement("div");
  toastEl.className = "toast";
  toastEl.setAttribute("role", "status");
  toastEl.setAttribute("aria-live", "polite");
  document.body.append(toastEl);
  let toastTimer;
  function toast(msg, withCartLink = false) {
    toastEl.innerHTML = `<span>${esc(msg)}</span>${withCartLink ? '<a href="/cart">View cart</a>' : ""}`;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 3200);
  }

  // ---------- cart (kept in this browser) ----------
  const CART_KEY = "ss-cart";
  function readCart() {
    try { const c = JSON.parse(localStorage.getItem(CART_KEY) || "[]"); return Array.isArray(c) ? c : []; } catch { return []; }
  }
  function writeCart(items) {
    try { localStorage.setItem(CART_KEY, JSON.stringify(items)); } catch { /* storage unavailable */ }
    updateCount(true);
    document.dispatchEvent(new CustomEvent("cart:change"));
  }
  function updateCount(bump) {
    const el = document.getElementById("cartCount");
    if (!el) return;
    const n = readCart().reduce((a, i) => a + i.qty, 0);
    el.textContent = n;
    el.hidden = n === 0;
    if (bump && n) { el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump"); }
  }
  function addToCart(p, qty = 1) {
    const items = readCart();
    const max = p.stock > 0 ? p.stock : 99;
    const found = items.find((i) => i.slug === p.slug);
    if (found) found.qty = Math.min(max, found.qty + qty);
    else items.push({ slug: p.slug, name: p.name, price_cents: p.price_cents, image: p.images?.[0] ?? null, type: p.type, style: p.style, qty: Math.min(max, qty), max });
    writeCart(items);
    toast(`${p.name} added to your cart`, true);
  }
  updateCount(false);

  // ---------- products ----------
  let productsPromise;
  function loadProducts() {
    productsPromise ||= fetch("/api/products")
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => [])
      .then((d) => (Array.isArray(d) ? d : []));
    return productsPromise;
  }
  function card(p, i = 0) {
    const sold = isSold(p);
    const badge = sold ? `<span class="tag sold">Sold out</span>` : p.tag ? `<span class="tag">${esc(p.tag)}</span>` : "";
    const sub = p.note || [FORMS[p.type]?.short, p.material].filter(Boolean).join(" · ");
    return `
      <article class="card reveal reveal-d${i % 4}">
        <a href="${productUrl(p)}" class="card-link" aria-label="${esc(p.name)}">
          <div class="card-art">
            ${badge}
            ${p.images?.length ? `<img src="/img/${p.images[0]}" alt="${esc(p.name)}" loading="lazy" />` : gem(p)}
          </div>
          <div class="card-body">
            <div><h3>${esc(p.name)}</h3>${sub ? `<p>${esc(sub)}</p>` : ""}</div>
            <span class="price">${money(p.price_cents)}</span>
          </div>
        </a>
        ${sold ? "" : `<button class="quick-add" type="button" data-add="${esc(p.slug)}" aria-label="Add ${esc(p.name)} to cart">+</button>`}
      </article>`;
  }
  // Quick-add buttons anywhere on the page
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-add]");
    if (!btn) return;
    e.preventDefault();
    const list = await loadProducts();
    const p = list.find((x) => x.slug === btn.dataset.add);
    if (p && !isSold(p)) addToCart(p);
  });

  // ---------- newsletter forms ----------
  document.querySelectorAll(".signup-form").forEach((f) =>
    f.addEventListener("submit", (e) => {
      e.preventDefault();
      toast("You're on the list ✦ watch for new drops.");
      f.reset();
    })
  );

  reveal();
  tilt();

  window.SS = { FORMS, esc, money, gem, isSold, productUrl, loadProducts, card, reveal, tilt, toast, readCart, writeCart, addToCart };
})();
