(() => {
  "use strict";
  const { FORMS, esc, loadProducts, isSold, tilt } = window.SS;

  document.getElementById("year").textContent = new Date().getFullYear();

  // Hero logo follows the pointer a little
  const logo = document.getElementById("heroLogo");
  if (logo && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    addEventListener("pointermove", (e) => {
      const x = e.clientX / innerWidth - 0.5, y = e.clientY / innerHeight - 0.5;
      logo.style.transform = `translate(${x * -24}px, ${y * -18}px) rotate(${x * -3}deg)`;
    }, { passive: true });
  }

  // Shop-by-form tiles, each one opens the shop filtered to that form
  const strip = document.getElementById("formStrip");
  function render(counts = {}) {
    strip.innerHTML = Object.entries(FORMS).map(([key, f]) => `
      <a class="form-tile" href="/shop?form=${key}" style="--glow:${f.glow}">
        <span class="gem ${f.shape} ${f.style}"></span>
        <span class="form-tile-text"><strong>${esc(f.label)}</strong><small>${counts[key] ? `${counts[key]} piece${counts[key] === 1 ? "" : "s"}` : esc(f.blurb)}</small></span>
      </a>`).join("");
    tilt(strip);
  }
  render();
  loadProducts().then((list) => {
    const counts = {};
    list.forEach((p) => { if (!isSold(p)) counts[p.type] = (counts[p.type] || 0) + 1; });
    render(counts);
  });
})();
