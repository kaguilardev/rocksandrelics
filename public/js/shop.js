(() => {
  "use strict";
  const { FORMS, esc, loadProducts, card, reveal, tilt, isSold } = window.SS;

  const params = new URLSearchParams(location.search);
  const state = {
    form: FORMS[params.get("form")] ? params.get("form") : "all",
    q: params.get("q") || "",
    sort: params.get("sort") || "new",
    inStock: params.get("stock") === "1",
  };
  let products = [];

  const grid = document.getElementById("grid");
  const formList = document.getElementById("formList");
  const q = document.getElementById("q");
  const sort = document.getElementById("sort");
  const inStock = document.getElementById("inStock");
  const resultCount = document.getElementById("resultCount");
  const title = document.getElementById("shopTitle");
  q.value = state.q;
  sort.value = state.sort;
  inStock.checked = state.inStock;

  function syncUrl() {
    const p = new URLSearchParams();
    if (state.form !== "all") p.set("form", state.form);
    if (state.q) p.set("q", state.q);
    if (state.sort !== "new") p.set("sort", state.sort);
    if (state.inStock) p.set("stock", "1");
    history.replaceState(null, "", `/shop${p.toString() ? `?${p}` : ""}`);
  }

  function renderForms() {
    const count = (k) => products.filter((p) => k === "all" || p.type === k).length;
    const rows = [["all", "Everything"], ...Object.entries(FORMS).map(([k, f]) => [k, f.label])];
    formList.innerHTML = rows.map(([k, label]) =>
      `<button type="button" data-form="${k}" class="${state.form === k ? "on" : ""}" aria-pressed="${state.form === k}">${esc(label)}<small>${count(k)}</small></button>`
    ).join("");
    title.innerHTML = state.form === "all"
      ? `Every stone, <span class="accent">every form.</span>`
      : `${esc(FORMS[state.form].label.split(" & ")[0])} <span class="accent">&amp; ${esc(FORMS[state.form].label.split(" & ")[1] || "more")}</span>`;
  }

  function render() {
    grid.setAttribute("aria-busy", "false");
    const needle = state.q.trim().toLowerCase();
    let list = products.filter((p) =>
      (state.form === "all" || p.type === state.form) &&
      (!state.inStock || !isSold(p)) &&
      (!needle || [p.name, p.material, p.note, p.description, p.tag].some((v) => String(v || "").toLowerCase().includes(needle)))
    );
    if (state.sort === "low") list = [...list].sort((a, b) => a.price_cents - b.price_cents);
    if (state.sort === "high") list = [...list].sort((a, b) => b.price_cents - a.price_cents);
    if (state.sort === "name") list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    resultCount.textContent = `${list.length} piece${list.length === 1 ? "" : "s"}`;
    if (!products.length) {
      grid.innerHTML = `<div class="empty"><strong>New pieces are on their way.</strong>The first collection is being photographed now. Check back soon.</div>`;
    } else if (!list.length) {
      grid.innerHTML = `<div class="empty"><strong>Nothing matches… yet.</strong>Try another form or clear your search.</div>`;
    } else {
      grid.innerHTML = list.map(card).join("");
    }
    reveal(grid);
    tilt(grid);
    renderForms();
    syncUrl();
  }

  formList.addEventListener("click", (e) => {
    const b = e.target.closest("[data-form]");
    if (!b) return;
    state.form = b.dataset.form;
    render();
  });
  let t;
  q.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { state.q = q.value; render(); }, 150); });
  sort.addEventListener("change", () => { state.sort = sort.value; render(); });
  inStock.addEventListener("change", () => { state.inStock = inStock.checked; render(); });

  const filters = document.getElementById("filters");
  const toggle = document.getElementById("filterToggle");
  toggle.addEventListener("click", () => {
    const open = filters.classList.toggle("open");
    toggle.setAttribute("aria-expanded", open);
  });

  grid.innerHTML = Array.from({ length: 6 }, () => `<div class="skeleton"></div>`).join("");
  renderForms();
  loadProducts().then((list) => { products = list; render(); });
})();
