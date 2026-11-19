(() => {
  "use strict";

  const SHAPES = { orb: "gem-orb", tower: "gem-tower", figure: "gem-heart", raw: "gem-raw", cluster: "gem-cluster" };
  const TYPE_LABEL = { orb: "Orb", tower: "Tower", figure: "Figure", raw: "Raw stone", cluster: "Cluster" };

  const grid = document.getElementById("productGrid");
  const cartCountEl = document.getElementById("cartCount");
  const toastEl = document.getElementById("toast");
  const modal = document.getElementById("productModal");
  const pmBody = document.getElementById("pmBody");

  let products = [];
  let filter = "all";
  let cartCount = 0;

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (cents) => `$${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;
  const gem = (p) => `<span class="gem ${SHAPES[p.type] || "gem-raw"} ${esc(p.style)}"></span>`;

  let toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2200);
  }

  function render() {
    grid.setAttribute("aria-busy", "false");
    if (!products.length) {
      grid.innerHTML = `<div class="grid-empty"><strong style="color:var(--text)">New pieces are on their way.</strong><br />Subscribe below to hear when the first collection drops.</div>`;
      return;
    }
    const list = filter === "all" ? products : products.filter((p) => p.type === filter);
    if (!list.length) {
      grid.innerHTML = `<div class="grid-empty">Nothing in this collection right now. Check back soon.</div>`;
      return;
    }
    grid.innerHTML = list
      .map((p) => {
        const sold = p.status === "sold" || p.stock === 0;
        const badge = sold ? `<span class="tag sold">Sold out</span>` : p.tag ? `<span class="tag">${esc(p.tag)}</span>` : "";
        return `
        <button class="card" type="button" data-slug="${esc(p.slug)}">
          <div class="card-art">
            ${badge}
            ${p.images.length ? `<img src="/img/${p.images[0]}" alt="${esc(p.name)}" loading="lazy" />` : gem(p)}
          </div>
          <div class="card-body">
            <h3>${esc(p.name)}</h3>
            ${p.note ? `<p>${esc(p.note)}</p>` : ""}
            <span class="price">${money(p.price_cents)}</span>
          </div>
        </button>`;
      })
      .join("");
  }

  function setFilter(next) {
    filter = next;
    document.querySelectorAll(".chip").forEach((c) => {
      const on = c.dataset.filter === next;
      c.classList.toggle("active", on);
      c.setAttribute("aria-selected", on);
    });
    render();
  }

  function openProduct(slug) {
    const p = products.find((x) => x.slug === slug);
    if (!p) return;
    const sold = p.status === "sold" || p.stock === 0;
    const meta = [TYPE_LABEL[p.type], p.material].filter(Boolean).map(esc).join(" · ");
    pmBody.innerHTML = `
      <div class="pm-gallery">
        <div class="pm-main" id="pmMain">${p.images.length ? `<img src="/img/${p.images[0]}" alt="${esc(p.name)}" />` : gem(p)}</div>
        ${p.images.length > 1 ? `<div class="pm-thumbs">${p.images.map((id, i) => `<button type="button" data-img="${id}" class="${i === 0 ? "on" : ""}" aria-label="Photo ${i + 1}"><img src="/img/${id}" alt="" loading="lazy" /></button>`).join("")}</div>` : ""}
      </div>
      <div class="pm-info">
        <span class="pm-meta">${meta}</span>
        <h3 id="pmTitle">${esc(p.name)}</h3>
        ${p.note ? `<span class="pm-meta">${esc(p.note)}</span>` : ""}
        <span class="pm-price">${money(p.price_cents)}</span>
        ${p.description ? `<p class="pm-desc">${esc(p.description)}</p>` : ""}
        <button class="btn btn-primary" type="button" data-add="${esc(p.name)}" ${sold ? "disabled" : ""}>${sold ? "Sold out" : "Add to cart"}</button>
      </div>`;
    pmBody.querySelectorAll("[data-img]").forEach((b) =>
      b.addEventListener("click", () => {
        pmBody.querySelectorAll("[data-img]").forEach((x) => x.classList.toggle("on", x === b));
        document.getElementById("pmMain").innerHTML = `<img src="/img/${b.dataset.img}" alt="${esc(p.name)}" />`;
      })
    );
    if (!modal.open) modal.showModal();
    history.replaceState(null, "", `#item-${p.slug}`);
  }

  // ---------- events ----------
  document.querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => setFilter(c.dataset.filter)));
  document.querySelectorAll(".collection").forEach((c) =>
    c.addEventListener("click", () => {
      setFilter(c.dataset.filter);
      document.getElementById("shop").scrollIntoView({ behavior: "smooth" });
    })
  );
  grid.addEventListener("click", (e) => {
    const card = e.target.closest(".card");
    if (card) openProduct(card.dataset.slug);
  });

  modal.querySelector(".modal-close").addEventListener("click", () => modal.close());
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.close(); });
  modal.addEventListener("close", () => {
    if (location.hash.startsWith("#item-")) history.replaceState(null, "", location.pathname);
  });
  pmBody.addEventListener("click", (e) => {
    const add = e.target.closest("[data-add]");
    if (!add || add.disabled) return;
    cartCount++;
    cartCountEl.textContent = cartCount;
    cartCountEl.hidden = false;
    toast(`${add.dataset.add} added to cart`);
  });

  document.getElementById("signupForm").addEventListener("submit", (e) => {
    e.preventDefault();
    document.getElementById("formNote").textContent = "Thanks! You're on the list.";
    e.target.reset();
  });

  document.getElementById("year").textContent = new Date().getFullYear();

  // ---------- load ----------
  grid.innerHTML = Array.from({ length: 4 }, () => `<div class="skeleton"></div>`).join("");
  fetch("/api/products")
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => [])
    .then((data) => {
      products = Array.isArray(data) ? data : [];
      render();
      const m = location.hash.match(/^#item-(.+)$/);
      if (m) openProduct(decodeURIComponent(m[1]));
    });
})();
