(() => {
  "use strict";
  const { FORMS, esc, money, gem, isSold, loadProducts, card, reveal, tilt, addToCart } = window.SS;

  const slug = new URLSearchParams(location.search).get("p") || "";
  const root = document.getElementById("productRoot");
  const crumbs = document.getElementById("crumbs");

  function notFound() {
    root.setAttribute("aria-busy", "false");
    document.title = "Not found · Stardust & Stoneworks";
    root.innerHTML = `<div class="empty" style="margin-bottom:4rem"><strong>This stone has wandered off.</strong>It may have found a new home. <a class="link-arrow" href="/shop" style="margin-top:1rem">Browse the shop</a></div>`;
  }

  function render(p, all) {
    root.setAttribute("aria-busy", "false");
    const f = FORMS[p.type];
    const sold = isSold(p);
    document.title = `${p.name} · Stardust & Stoneworks`;
    crumbs.innerHTML = `<a href="/shop">Shop</a><span aria-hidden="true">✦</span>${f ? `<a href="/shop?form=${p.type}">${esc(f.label)}</a><span aria-hidden="true">✦</span>` : ""}<span>${esc(p.name)}</span>`;
    const specs = [["Form", f?.label], ["Stone", p.material], ["Details", p.note], ["Availability", sold ? "Sold out" : p.stock > 0 ? `${p.stock} available` : "In stock"]].filter(([, v]) => v);
    root.innerHTML = `
      <div class="product">
        <div class="reveal">
          <div class="gallery-main" id="mainImg">${p.images.length ? `<img src="/img/${p.images[0]}" alt="${esc(p.name)}" />` : gem(p)}</div>
          ${p.images.length > 1 ? `<div class="thumbs">${p.images.map((id, i) => `<button type="button" data-img="${id}" class="${i ? "" : "on"}" aria-label="Photo ${i + 1}"><img src="/img/${id}" alt="" loading="lazy" /></button>`).join("")}</div>` : ""}
        </div>
        <div class="p-info reveal reveal-d1">
          ${p.tag && !sold ? `<span class="eyebrow" style="margin:0">${esc(p.tag)}</span>` : ""}
          <h1>${esc(p.name)}</h1>
          <span class="p-price">${money(p.price_cents)}</span>
          ${p.description ? `<p class="p-desc">${esc(p.description)}</p>` : ""}
          <dl class="specs">${specs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
          <div class="buy-row">
            <div class="qty" ${sold ? "hidden" : ""}>
              <button type="button" id="minus" aria-label="Less">−</button><span id="qty" aria-live="polite">1</span><button type="button" id="plus" aria-label="More">+</button>
            </div>
            <button class="btn btn-primary" type="button" id="addBtn" ${sold ? "disabled" : ""}>${sold ? "Sold out" : "Add to cart"}</button>
          </div>
          <ul class="perks">
            <li>Photographed exactly as it is</li>
            <li>Carefully packed and insured shipping</li>
            <li>Ethically sourced</li>
          </ul>
        </div>
      </div>`;

    // gallery + hover zoom
    const main = document.getElementById("mainImg");
    root.querySelectorAll("[data-img]").forEach((b) => b.addEventListener("click", () => {
      root.querySelectorAll("[data-img]").forEach((x) => x.classList.toggle("on", x === b));
      main.innerHTML = `<img src="/img/${b.dataset.img}" alt="${esc(p.name)}" />`;
    }));
    if (p.images.length && matchMedia("(hover: hover)").matches) {
      main.addEventListener("pointermove", (e) => {
        const r = main.getBoundingClientRect();
        const img = main.querySelector("img");
        if (img) img.style.transformOrigin = `${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`;
      });
      main.addEventListener("pointerenter", () => main.classList.add("zoom"));
      main.addEventListener("pointerleave", () => main.classList.remove("zoom"));
    }

    // quantity + add
    let qty = 1;
    const max = p.stock > 0 ? p.stock : 99;
    const qtyEl = document.getElementById("qty");
    document.getElementById("minus")?.addEventListener("click", () => { qty = Math.max(1, qty - 1); qtyEl.textContent = qty; });
    document.getElementById("plus")?.addEventListener("click", () => { qty = Math.min(max, qty + 1); qtyEl.textContent = qty; });
    document.getElementById("addBtn").addEventListener("click", () => { if (!sold) addToCart(p, qty); });

    // related
    const related = all.filter((x) => x.slug !== p.slug && !isSold(x)).sort((a, b) => (b.type === p.type) - (a.type === p.type)).slice(0, 3);
    if (related.length) {
      document.getElementById("relatedSection").hidden = false;
      const rel = document.getElementById("related");
      rel.innerHTML = related.map(card).join("");
      reveal(rel);
      tilt(rel);
    }
    reveal(root);
  }

  if (!slug) return notFound();
  Promise.all([
    fetch(`/api/products/${encodeURIComponent(slug)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    loadProducts(),
  ]).then(([p, all]) => (p ? render(p, all) : notFound()));
})();
