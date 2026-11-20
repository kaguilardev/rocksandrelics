(() => {
  "use strict";
  const { FORMS, esc, loadProducts, card, reveal, tilt } = window.SS;

  // Hero logo follows the pointer a little
  const logo = document.getElementById("heroLogo");
  if (logo && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    addEventListener("pointermove", (e) => {
      const x = e.clientX / innerWidth - 0.5, y = e.clientY / innerHeight - 0.5;
      logo.style.transform = `translate(${x * -24}px, ${y * -18}px) rotate(${x * -3}deg)`;
    }, { passive: true });
  }

  // Shop-by-form tiles
  const formsGrid = document.getElementById("formsGrid");
  function renderForms(counts = {}) {
    formsGrid.innerHTML = Object.entries(FORMS).map(([key, f], i) => `
      <a class="form-card reveal reveal-d${i % 4}" href="/shop?form=${key}" style="--glow:${f.glow}">
        ${counts[key] ? `<span class="count">${counts[key]} PIECE${counts[key] === 1 ? "" : "S"}</span>` : ""}
        <span class="gem-wrap"><span class="gem ${f.shape} ${f.style}"></span></span>
        <h3>${esc(f.label)}</h3>
        <p>${esc(f.blurb)}</p>
      </a>`).join("");
    reveal(formsGrid);
    tilt(formsGrid);
  }
  renderForms();

  // Featured carousel
  const featured = document.getElementById("featured");
  featured.innerHTML = Array.from({ length: 4 }, () => `<div class="skeleton"></div>`).join("");
  loadProducts().then((list) => {
    const counts = {};
    list.forEach((p) => { if (!window.SS.isSold(p)) counts[p.type] = (counts[p.type] || 0) + 1; });
    renderForms(counts);
    const items = list.slice(0, 10);
    featured.innerHTML = items.length
      ? items.map(card).join("")
      : `<div class="empty" style="grid-column:1/-1;min-width:100%"><strong>New pieces are on their way.</strong>Subscribe below to hear when the first collection drops.</div>`;
    reveal(featured);
    tilt(featured);
    document.querySelector(".carousel-nav").hidden = items.length <= 4;
  });
  const step = (dir) => featured.scrollBy({ left: dir * featured.clientWidth * 0.8, behavior: "smooth" });
  document.getElementById("prevBtn").addEventListener("click", () => step(-1));
  document.getElementById("nextBtn").addEventListener("click", () => step(1));
})();
