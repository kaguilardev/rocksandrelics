(() => {
  "use strict";

  const app = document.getElementById("app");
  const toastEl = document.getElementById("toast");
  let me = null;

  const TYPES = [["orb", "Orb / Sphere"], ["tower", "Tower / Point"], ["figure", "Figure / Shape"], ["raw", "Raw stone"], ["cluster", "Cluster / Geode"]];
  const STATUSES = [["draft", "Draft (hidden)"], ["published", "Published"], ["sold", "Sold out"]];
  const STYLES = ["amethyst", "aura", "rose", "labradorite", "fluorite", "obsidian", "citrine", "moonstone", "malachite", "galaxy", "tiger", "lapis"];

  const LOGO = "";

  // ---------- helpers ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (cents) => `$${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;
  const opts = (list, val) => list.map(([v, l]) => `<option value="${v}"${v === val ? " selected" : ""}>${esc(l)}</option>`).join("");
  const timeAgo = (iso) => {
    const s = (Date.now() - new Date(iso)) / 1000;
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return new Date(iso).toLocaleDateString();
  };

  let toastTimer;
  function toast(msg, isErr = false) {
    toastEl.textContent = msg;
    toastEl.classList.toggle("err", isErr);
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2600);
  }

  async function api(path, { method = "GET", body, form } = {}) {
    const headers = { "X-Requested-With": "fetch" };
    let payload;
    if (form) payload = form;
    else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const res = await fetch(path, { method, headers, body: payload, credentials: "same-origin" });
    let data = null;
    try { data = await res.json(); } catch { /* no body */ }
    if (res.status === 401 && path !== "/api/admin/login") {
      me = null;
      renderLogin();
      throw new Error("Please log in.");
    }
    if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
    return data;
  }

  /** Shrink photos in the browser before upload: max 1600px, JPEG. */
  async function resizeImage(file, max = 1600, quality = 0.86) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error(`${file.name}: use JPG, PNG or WebP.`);
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => null);
    if (!bitmap) return file;
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 900 * 1024) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", quality));
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  }

  // ---------- login ----------
  function renderLogin() {
    document.title = "Log in · Stardust & Stoneworks";
    app.innerHTML = `
      <div class="login-wrap">
        <form class="login" id="loginForm">
          <div class="brand">${LOGO}<span>Stardust &amp; Stoneworks Admin</span></div>
          <div class="field"><label for="em">Email</label><input id="em" type="email" autocomplete="username" required /></div>
          <div class="field"><label for="pw">Password</label><input id="pw" type="password" autocomplete="current-password" required /></div>
          <button class="btn btn-primary" type="submit">Log in</button>
          <p class="error" id="loginErr"></p>
        </form>
      </div>`;
    const form = document.getElementById("loginForm");
    form.em.focus();
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = form.querySelector("button");
      btn.disabled = true;
      try {
        const { user } = await api("/api/admin/login", { method: "POST", body: { email: form.em.value, password: form.pw.value } });
        me = user;
        if (!location.hash || location.hash === "#/") location.hash = "#/listings";
        route();
      } catch (err) {
        document.getElementById("loginErr").textContent = err.message;
        btn.disabled = false;
      }
    });
  }

  // ---------- shell ----------
  function shell(active, inner) {
    app.innerHTML = `
      <header class="topbar">
        <div class="brand">${LOGO}<span>Stardust &amp; Stoneworks</span></div>
        <nav class="tabs">
          <a href="#/listings" class="${active === "listings" ? "active" : ""}">Listings</a>
          <a href="#/channels" class="${active === "channels" ? "active" : ""}">Channels</a>
          <a href="#/team" class="${active === "team" ? "active" : ""}">Team</a>
          <a href="#/account" class="${active === "account" ? "active" : ""}">Account</a>
        </nav>
        <div class="who">
          <a href="/" target="_blank" rel="noopener" class="btn btn-sm">View site ↗</a>
          <span class="email">${esc(me.email)}</span>
          <button class="btn btn-sm" id="logout">Log out</button>
        </div>
      </header>
      <main class="main">${inner}</main>`;
    document.getElementById("logout").onclick = async () => {
      await api("/api/admin/logout", { method: "POST" }).catch(() => {});
      me = null;
      location.hash = "";
      renderLogin();
    };
  }

  // ---------- listings ----------
  async function renderListings() {
    document.title = "Listings · Stardust & Stoneworks";
    shell("listings", `<p class="muted">Loading listings…</p>`);
    const products = await api("/api/admin/products");
    const main = app.querySelector(".main");
    main.innerHTML = `
      <div class="page-head">
        <div><h1>Listings</h1><p class="muted" style="margin:.25rem 0 0">${products.length} total · ${products.filter((p) => p.status === "published").length} live on the site</p></div>
        <a href="#/listings/new" class="btn btn-primary">+ New listing</a>
      </div>
      <div class="toolbar">
        <input id="q" type="search" placeholder="Search listings…" />
        <select id="st"><option value="">All statuses</option>${opts(STATUSES.map(([v]) => [v, v[0].toUpperCase() + v.slice(1)]))}</select>
      </div>
      <div id="tbl"></div>`;

    const draw = () => {
      const q = main.querySelector("#q").value.trim().toLowerCase();
      const st = main.querySelector("#st").value;
      const list = products.filter((p) => (!st || p.status === st) && (!q || `${p.name} ${p.material} ${p.type}`.toLowerCase().includes(q)));
      const tbl = main.querySelector("#tbl");
      if (!products.length) {
        tbl.innerHTML = `<div class="panel empty"><p>No listings yet.</p><a href="#/listings/new" class="btn btn-primary">Post your first listing</a></div>`;
        return;
      }
      if (!list.length) {
        tbl.innerHTML = `<div class="panel empty">No listings match.</div>`;
        return;
      }
      tbl.innerHTML = `
        <table class="table">
          <thead><tr><th>Item</th><th>Status</th><th>Price</th><th class="hide-sm">Stock</th><th class="hide-sm">Updated</th></tr></thead>
          <tbody>${list.map((p) => `
            <tr data-id="${p.id}" tabindex="0">
              <td><div class="name-cell">${p.images[0] ? `<img class="thumb" src="/img/${p.images[0].id}" alt="" loading="lazy" />` : `<span class="thumb"></span>`}<span>${esc(p.name)}<br /><span class="muted" style="font-weight:400;font-size:.8rem">${esc(TYPES.find((t) => t[0] === p.type)?.[1] || p.type)}${p.material ? " · " + esc(p.material) : ""}</span>${channelBadges(p.channels)}</span></div></td>
              <td><span class="pill ${p.status}">${p.status}</span></td>
              <td>${money(p.price_cents)}</td>
              <td class="hide-sm">${p.stock}</td>
              <td class="hide-sm muted">${timeAgo(p.updated_at)}</td>
            </tr>`).join("")}
          </tbody>
        </table>`;
      tbl.querySelectorAll("tr[data-id]").forEach((tr) => {
        const go = () => (location.hash = `#/listings/${tr.dataset.id}`);
        tr.onclick = go;
        tr.onkeydown = (e) => e.key === "Enter" && go();
      });
    };
    main.querySelector("#q").oninput = draw;
    main.querySelector("#st").onchange = draw;
    draw();
  }

  async function renderEditor(id) {
    const isNew = id === "new";
    document.title = `${isNew ? "New listing" : "Edit listing"} · Stardust & Stoneworks`;
    shell("listings", `<p class="muted">Loading…</p>`);
    const p = isNew
      ? { name: "", type: "orb", status: "draft", price_cents: 0, stock: 1, material: "", note: "", tag: "", description: "", style: "amethyst", images: [] }
      : await api(`/api/admin/products/${id}`);

    const main = app.querySelector(".main");
    main.innerHTML = `
      <div class="page-head">
        <div><a href="#/listings" class="muted" style="text-decoration:none">← Listings</a><h1 style="margin-top:.35rem">${isNew ? "New listing" : esc(p.name)}</h1></div>
        ${!isNew && p.status !== "draft" ? `<a class="btn btn-sm" href="/#item-${esc(p.slug)}" target="_blank" rel="noopener">View on site ↗</a>` : ""}
      </div>
      <form id="ed" class="editor" novalidate>
        <div class="panel">
          <h2>Details</h2>
          <div class="field"><label for="name">Name</label><input id="name" name="name" maxlength="120" required value="${esc(p.name)}" placeholder="e.g. Amethyst Sphere" /></div>
          <div class="row">
            <div class="field"><label for="type">Form</label><select id="type" name="type">${opts(TYPES, p.type)}</select></div>
            <div class="field"><label for="material">Stone / material</label><input id="material" name="material" maxlength="80" value="${esc(p.material)}" placeholder="e.g. Amethyst" /></div>
          </div>
          <div class="row">
            <div class="field"><label for="price">Price (USD)</label><input id="price" name="price" type="number" min="0" step="0.01" inputmode="decimal" value="${(p.price_cents / 100).toFixed(2)}" /></div>
            <div class="field"><label for="stock">In stock</label><input id="stock" name="stock" type="number" min="0" step="1" value="${p.stock}" /></div>
          </div>
          <div class="field"><label for="note">Short detail line</label><input id="note" name="note" maxlength="120" value="${esc(p.note)}" placeholder="e.g. Brazil · 60mm · 320g" /><p class="hint">Shown under the name on the product card.</p></div>
          <div class="field"><label for="description">Description</label><textarea id="description" name="description" maxlength="5000" placeholder="Origin, size, weight, what makes this piece special…">${esc(p.description)}</textarea></div>
        </div>

        <div>
          <div class="panel">
            <h2>Publishing</h2>
            <div class="field"><label for="status">Status</label><select id="status" name="status">${opts(STATUSES, p.status)}</select><p class="hint">Only Published and Sold out listings appear on the site.</p></div>
            <div class="field"><label for="tag">Badge (optional)</label><input id="tag" name="tag" maxlength="24" value="${esc(p.tag)}" placeholder="New, Rare, Bestseller…" /></div>
            <div class="field"><label for="style">Placeholder color</label><select id="style" name="style">${STYLES.map((s) => `<option value="${s}"${s === p.style ? " selected" : ""}>${s[0].toUpperCase() + s.slice(1)}</option>`).join("")}</select><p class="hint">Used only when the listing has no photos.</p></div>
          </div>

          ${isNew ? "" : `<div class="panel"><h2>Etsy &amp; eBay</h2><div id="mk"><p class="muted" style="margin:0">Loading…</p></div></div>`}

          <div class="panel">
            <h2>Photos</h2>
            ${isNew
              ? `<p class="muted" style="margin:0">Save the listing first, then add photos.</p>`
              : `<div class="photos" id="photos">${p.images.map((img, i) => `
                  <div class="photo">
                    <img src="/img/${img.id}" alt="" loading="lazy" />
                    ${i === 0 ? `<span class="cover">Cover</span>` : ""}
                    <div class="acts">
                      ${i > 0 ? `<button type="button" data-cover="${img.id}">Make cover</button>` : ""}
                      <button type="button" data-del="${img.id}">Remove</button>
                    </div>
                  </div>`).join("")}</div>
                <div class="drop" id="drop" tabindex="0" role="button">Drop photos here or <u>browse</u><br /><span class="hint">JPG, PNG or WebP · up to 8 per listing</span></div>
                <input type="file" id="file" accept="image/jpeg,image/png,image/webp" multiple hidden />`}
          </div>

          <div class="actions">
            <div>${isNew ? "" : `<span id="delWrap"><button type="button" class="btn btn-danger" id="del">Delete</button></span>`}</div>
            <button type="submit" class="btn btn-primary" id="save">${isNew ? "Create listing" : "Save changes"}</button>
          </div>
          <p class="error" id="edErr"></p>
        </div>
      </form>`;

    const form = main.querySelector("#ed");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = main.querySelector("#save");
      const err = main.querySelector("#edErr");
      err.textContent = "";
      const body = Object.fromEntries(new FormData(form).entries());
      if (!body.name.trim()) { err.textContent = "Give the listing a name."; form.name.focus(); return; }
      btn.disabled = true;
      try {
        if (isNew) {
          const { id: newId } = await api("/api/admin/products", { method: "POST", body });
          toast("Listing created. Now add photos.");
          location.hash = `#/listings/${newId}`;
        } else {
          await api(`/api/admin/products/${id}`, { method: "PATCH", body });
          toast("Saved");
          renderEditor(id);
        }
      } catch (ex) {
        err.textContent = ex.message;
        btn.disabled = false;
      }
    });

    if (isNew) return;

    renderMarketPanel(id, main.querySelector("#mk"), async () => {
      // Push what's on screen, not what was last saved.
      const body = Object.fromEntries(new FormData(form).entries());
      if (!body.name.trim()) throw new Error("Give the listing a name.");
      await api(`/api/admin/products/${id}`, { method: "PATCH", body });
    }).catch((ex) => { main.querySelector("#mk").innerHTML = `<p class="error">${esc(ex.message)}</p>`; });

    // delete with inline confirm
    const delWrap = main.querySelector("#delWrap");
    main.querySelector("#del").onclick = () => {
      delWrap.innerHTML = `<span class="confirm"><span class="muted">Delete for good?${(p.channels || []).length ? " (Etsy/eBay copies stay up.)" : ""}</span><button type="button" class="btn btn-danger btn-sm" id="delYes">Yes, delete</button><button type="button" class="btn btn-sm" id="delNo">Cancel</button></span>`;
      delWrap.querySelector("#delNo").onclick = () => renderEditor(id);
      delWrap.querySelector("#delYes").onclick = async () => {
        try {
          await api(`/api/admin/products/${id}`, { method: "DELETE" });
          toast("Listing deleted");
          location.hash = "#/listings";
        } catch (ex) { toast(ex.message, true); }
      };
    };

    // photos
    const fileInput = main.querySelector("#file");
    const drop = main.querySelector("#drop");
    const uploadFiles = async (files) => {
      if (!files.length) return;
      drop.textContent = `Uploading ${files.length} photo${files.length > 1 ? "s" : ""}…`;
      try {
        const fd = new FormData();
        for (const f of files) fd.append("images", await resizeImage(f));
        await api(`/api/admin/products/${id}/images`, { method: "POST", form: fd });
        toast("Photos added");
      } catch (ex) {
        toast(ex.message, true);
      }
      renderEditor(id);
    };
    drop.onclick = () => fileInput.click();
    drop.onkeydown = (e) => (e.key === "Enter" || e.key === " ") && fileInput.click();
    fileInput.onchange = () => uploadFiles([...fileInput.files]);
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
    drop.ondragleave = () => drop.classList.remove("over");
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); uploadFiles([...e.dataTransfer.files]); };

    main.querySelector("#photos").onclick = async (e) => {
      const cover = e.target.dataset.cover;
      const del = e.target.dataset.del;
      try {
        if (cover) await api(`/api/admin/products/${id}/images/${cover}/cover`, { method: "POST" });
        else if (del) await api(`/api/admin/products/${id}/images/${del}`, { method: "DELETE" });
        else return;
        renderEditor(id);
      } catch (ex) { toast(ex.message, true); }
    };
  }

  // ---------- marketplaces (Etsy / eBay) ----------
  const CH_NAMES = { etsy: "Etsy", ebay: "eBay" };
  const STATE_LABEL = { none: "Not listed", draft: "Draft", active: "Live", inactive: "Inactive", ended: "Ended", sold_out: "Sold out", expired: "Expired", edit: "Draft" };

  function channelBadges(list) {
    if (!list || !list.length) return "";
    return `<span class="ch-badges">${list.map((c) => `<span class="ch-badge ${c.error ? "err" : c.state}" title="${CH_NAMES[c.channel]}: ${c.error ? "last push failed" : STATE_LABEL[c.state] || c.state}">${CH_NAMES[c.channel]}</span>`).join("")}</span>`;
  }

  /** Search box that lets you pick a marketplace category. onPick({id, name}). */
  function categoryPicker(el, { searchUrl, current, onPick, placeholder }) {
    el.innerHTML = `
      <div class="picker">
        <div class="picked">${current.id ? `<span>${esc(current.name || `#${current.id}`)}</span> <button type="button" class="link" data-clear>Change</button>` : ""}</div>
        <input type="search" placeholder="${esc(placeholder)}" class="${current.id ? "hidden" : ""}" />
        <div class="picker-results"></div>
      </div>`;
    const input = el.querySelector("input");
    const results = el.querySelector(".picker-results");
    const clear = el.querySelector("[data-clear]");
    if (clear) clear.onclick = () => { el.querySelector(".picked").innerHTML = ""; input.classList.remove("hidden"); input.focus(); };
    let timer;
    input.oninput = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const q = input.value.trim();
        if (q.length < 2) { results.innerHTML = ""; return; }
        try {
          const list = await api(`${searchUrl}?q=${encodeURIComponent(q)}`);
          results.innerHTML = list.length
            ? list.map((c) => `<button type="button" data-id="${esc(c.id)}" data-name="${esc(c.name)}">${esc(c.name)}</button>`).join("")
            : `<p class="muted">No matches.</p>`;
        } catch (ex) { results.innerHTML = `<p class="error">${esc(ex.message)}</p>`; }
      }, 300);
    };
    results.onclick = (e) => {
      const b = e.target.closest("button[data-id]");
      if (!b) return;
      onPick({ id: b.dataset.id, name: b.dataset.name });
      categoryPicker(el, { searchUrl, current: { id: b.dataset.id, name: b.dataset.name }, onPick, placeholder });
    };
  }

  async function renderMarketPanel(productId, el, saveFirst) {
    const [channels, links] = await Promise.all([api("/api/admin/marketplaces"), api(`/api/admin/products/${productId}/marketplaces`)]);
    el.innerHTML = channels.map((c) => {
      const l = links.find((x) => x.channel === c.channel);
      const name = esc(c.name);
      if (!c.connected) {
        return `<div class="mk"><div class="mk-head"><strong>${name}</strong><span class="pill draft">Not connected</span></div>
          <p class="hint" style="margin:.2rem 0 0">${c.configured ? `Connect ${name} on the <a href="#/channels">Channels</a> page.` : `Add ${name} API keys to the server first (see <a href="#/channels">Channels</a>).`}</p></div>`;
      }
      const listed = l.state !== "none";
      const live = l.state === "active";
      const btns = [];
      if (!listed) {
        btns.push(`<button type="button" class="btn btn-sm" data-push="draft">Send as draft</button>`);
        btns.push(`<button type="button" class="btn btn-sm btn-primary" data-push="live">Publish</button>`);
      } else {
        btns.push(`<button type="button" class="btn btn-sm" data-push="draft">Update</button>`);
        if (live) btns.push(`<button type="button" class="btn btn-sm btn-danger" data-end>End listing</button>`);
        else btns.push(`<button type="button" class="btn btn-sm btn-primary" data-push="live">${l.state === "draft" ? "Publish" : "Relist"}</button>`);
      }
      const catDefault = c.channel === "etsy" ? c.settings.taxonomy_name || c.settings.taxonomy_id : c.settings.category_name || c.settings.category_id;
      return `
        <div class="mk" data-ch="${c.channel}">
          <div class="mk-head">
            <strong>${name}</strong>
            <span class="pill mk-${l.state}">${STATE_LABEL[l.state] || esc(l.state)}</span>
            ${l.remote_url ? `<a href="${esc(l.remote_url)}" target="_blank" rel="noopener" class="muted">View ↗</a>` : ""}
          </div>
          ${l.last_error ? `<p class="error" style="margin:.35rem 0">${esc(l.last_error)}</p>` : ""}
          ${c.missing.length ? `<p class="hint">Finish setup on <a href="#/channels">Channels</a>: ${esc(c.missing.join(", "))}.</p>` : ""}
          <div class="mk-btns">${btns.join("")}</div>
          <details class="mk-more">
            <summary>Options${l.last_synced_at ? ` · synced ${timeAgo(l.last_synced_at)}` : ""}</summary>
            <label>Category for this listing</label>
            <div data-cat></div>
            <p class="hint">Leave empty to use the default${catDefault ? ` (${esc(catDefault)})` : ""}.${l.options.category_id ? ` <button type="button" class="link" data-cat-reset>Use default</button>` : ""}</p>
            ${c.channel === "ebay" ? `
              <label style="margin-top:.75rem">eBay item specifics</label>
              <div class="aspects" data-aspects>${[...Object.entries(l.options.aspects), ["", ""]].map(([k, v]) => `
                <div class="aspect"><input placeholder="Name (e.g. Color)" value="${esc(k)}" maxlength="65" /><input placeholder="Value" value="${esc(v)}" maxlength="65" /></div>`).join("")}
              </div>
              <div style="display:flex;gap:.4rem;margin-top:.4rem"><button type="button" class="btn btn-sm" data-aspect-add>+ Add</button><button type="button" class="btn btn-sm" data-aspect-save>Save specifics</button></div>
              <p class="hint">Some eBay categories require extra details. If a push asks for one, add it here.</p>` : ""}
            ${listed ? `<p class="hint" style="margin-top:.75rem"><button type="button" class="link" data-unlink>Unlink</button>: forget the ${name} listing here without changing it on ${name}.</p>` : ""}
          </details>
        </div>`;
    }).join("") + `<p class="hint" style="margin:.5rem 0 0">Pushing saves your changes first. ${channels.some((c) => c.channel === "etsy" && c.connected) ? "Etsy charges $0.20 per published listing. " : ""}${channels.some((c) => c.channel === "ebay" && c.connected) ? "eBay insertion fees may apply." : ""}</p>`;

    const reload = () => renderMarketPanel(productId, el, saveFirst).catch((ex) => toast(ex.message, true));

    el.querySelectorAll(".mk[data-ch]").forEach((box) => {
      const ch = box.dataset.ch;
      const l = links.find((x) => x.channel === ch);
      const base = `/api/admin/products/${productId}/marketplaces/${ch}`;
      const busy = (on) => box.querySelectorAll(".mk-btns button").forEach((b) => (b.disabled = on));

      box.querySelectorAll("[data-push]").forEach((b) => (b.onclick = async () => {
        busy(true);
        const label = b.textContent;
        b.textContent = "Working…";
        try {
          await saveFirst();
          const r = await api(`${base}/push`, { method: "POST", body: { publish: b.dataset.push === "live" } });
          toast(`${CH_NAMES[ch]}: ${STATE_LABEL[r.state] || r.state}`);
        } catch (ex) { toast(ex.message, true); }
        b.textContent = label;
        reload();
      }));

      const endBtn = box.querySelector("[data-end]");
      if (endBtn) endBtn.onclick = () => {
        const wrapEl = box.querySelector(".mk-btns");
        wrapEl.innerHTML = `<span class="muted">End on ${CH_NAMES[ch]}?</span><button type="button" class="btn btn-sm btn-danger" data-yes>Yes, end it</button><button type="button" class="btn btn-sm" data-no>Cancel</button>`;
        wrapEl.querySelector("[data-no]").onclick = reload;
        wrapEl.querySelector("[data-yes]").onclick = async () => {
          try { await api(`${base}/end`, { method: "POST" }); toast(`Ended on ${CH_NAMES[ch]}`); } catch (ex) { toast(ex.message, true); }
          reload();
        };
      };

      categoryPicker(box.querySelector("[data-cat]"), {
        searchUrl: ch === "etsy" ? "/api/admin/marketplaces/etsy/taxonomy" : "/api/admin/marketplaces/ebay/categories",
        current: { id: l.options.category_id, name: l.options.category_name },
        placeholder: "Search categories…",
        onPick: async (cat) => {
          try { await api(base, { method: "PATCH", body: { category_id: cat.id, category_name: cat.name } }); toast("Category saved"); } catch (ex) { toast(ex.message, true); }
        },
      });
      const catReset = box.querySelector("[data-cat-reset]");
      if (catReset) catReset.onclick = async () => {
        try { await api(base, { method: "PATCH", body: { category_id: "" } }); } catch (ex) { toast(ex.message, true); }
        reload();
      };

      const unlink = box.querySelector("[data-unlink]");
      if (unlink) unlink.onclick = async () => {
        try { await api(base, { method: "DELETE" }); toast("Unlinked"); } catch (ex) { toast(ex.message, true); }
        reload();
      };

      const aspectsEl = box.querySelector("[data-aspects]");
      if (aspectsEl) {
        box.querySelector("[data-aspect-add]").onclick = () => aspectsEl.insertAdjacentHTML("beforeend",
          `<div class="aspect"><input placeholder="Name" maxlength="65" /><input placeholder="Value" maxlength="65" /></div>`);
        box.querySelector("[data-aspect-save]").onclick = async () => {
          const aspects = {};
          aspectsEl.querySelectorAll(".aspect").forEach((row) => {
            const [k, v] = row.querySelectorAll("input");
            if (k.value.trim() && v.value.trim()) aspects[k.value.trim()] = v.value.trim();
          });
          try { await api(base, { method: "PATCH", body: { aspects } }); toast("Item specifics saved"); } catch (ex) { toast(ex.message, true); }
        };
      }
    });
  }

  async function renderChannels(params) {
    document.title = "Channels · Stardust & Stoneworks";
    shell("channels", `<p class="muted">Loading…</p>`);
    if (params.get("connected")) toast(`${params.get("connected")} connected`);
    if (params.get("error")) toast(params.get("error"), true);
    if (params.toString()) history.replaceState(null, "", "#/channels");

    const channels = await api("/api/admin/marketplaces");
    const isOwner = me.role === "owner";
    const main = app.querySelector(".main");
    main.innerHTML = `
      <div class="page-head"><div><h1>Channels</h1><p class="muted" style="margin:.25rem 0 0">Connect your Etsy shop and eBay account, then push any listing from its edit page.${isOwner ? "" : " Only the owner can connect accounts or change these settings."}</p></div></div>
      ${channels.some((c) => c.connected) ? `<div class="panel sales" id="sales"><p class="muted" style="margin:0">Loading sales…</p></div>` : ""}
      ${channels.map((c) => `
        <div class="panel channel" data-ch="${c.channel}">
          <div class="channel-head">
            <div>
              <h2 style="margin:0">${esc(c.name)}${c.sandbox ? ` <span class="pill draft">Sandbox</span>` : ""}</h2>
              <p class="muted" style="margin:.2rem 0 0">${
                !c.configured ? "API keys not set on the server." :
                c.broken ? "Connection needs to be renewed." :
                c.connected ? `Connected to <strong>${esc(c.account_name)}</strong> · ${timeAgo(c.connected_at)}` : "Not connected."}</p>
              ${c.connected && c.last_sync_error ? `<p class="error" style="margin:.3rem 0 0">Sales sync: ${esc(c.last_sync_error)}</p>` : ""}
            </div>
            <div class="channel-acts">${isOwner && c.configured ? (c.connected
              ? `<button class="btn btn-sm" data-connect>Reconnect</button><button class="btn btn-sm btn-danger" data-disconnect>Disconnect</button>`
              : `<button class="btn btn-primary" data-connect>Connect ${esc(c.name)}</button>`) : ""}</div>
          </div>
          ${!c.configured ? setupHelp(c.channel) : ""}
          ${c.connected ? `<div class="channel-settings"><p class="muted">Loading ${esc(c.name)} settings…</p></div>` : ""}
        </div>`).join("")}
      <div class="panel channel" id="whatnot"><p class="muted" style="margin:0">Loading Whatnot…</p></div>`;

    main.querySelectorAll(".channel").forEach((box) => {
      const c = channels.find((x) => x.channel === box.dataset.ch);
      const connect = box.querySelector("[data-connect]");
      if (connect) connect.onclick = async () => {
        connect.disabled = true;
        try { location.href = (await api(`/api/admin/marketplaces/${c.channel}/connect`, { method: "POST" })).url; }
        catch (ex) { toast(ex.message, true); connect.disabled = false; }
      };
      const disc = box.querySelector("[data-disconnect]");
      if (disc) disc.onclick = () => {
        const acts = box.querySelector(".channel-acts");
        acts.innerHTML = `<span class="muted">Disconnect? Listings already on ${esc(c.name)} stay up.</span><button class="btn btn-sm btn-danger" data-yes>Disconnect</button><button class="btn btn-sm" data-no>Cancel</button>`;
        acts.querySelector("[data-no]").onclick = () => renderChannels(new URLSearchParams());
        acts.querySelector("[data-yes]").onclick = async () => {
          try { await api(`/api/admin/marketplaces/${c.channel}/disconnect`, { method: "POST" }); toast("Disconnected"); } catch (ex) { toast(ex.message, true); }
          renderChannels(new URLSearchParams());
        };
      };
      if (c.connected) renderChannelSettings(box.querySelector(".channel-settings"), c, isOwner)
        .catch((ex) => { box.querySelector(".channel-settings").innerHTML = `<p class="error">${esc(ex.message)}</p>`; });
    });

    renderWhatnot(main.querySelector("#whatnot")).catch((ex) => { main.querySelector("#whatnot").innerHTML = `<p class="error">${esc(ex.message)}</p>`; });

    const salesEl = main.querySelector("#sales");
    if (salesEl) renderSales(salesEl, channels).catch((ex) => { salesEl.innerHTML = `<p class="error">${esc(ex.message)}</p>`; });
  }

  async function renderWhatnot(el) {
    const o = await api("/api/admin/marketplaces/whatnot/options");
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem("whatnotExport") || "{}"); } catch { /* storage blocked */ }
    const shipping = saved.shipping || "8-11 oz";
    el.innerHTML = `
      <div class="channel-head">
        <div>
          <h2 style="margin:0">Whatnot <span class="pill draft">CSV export</span></h2>
          <p class="muted" style="margin:.2rem 0 0">Whatnot doesn't offer automatic connections yet, so download your listings as a file and import it on Whatnot.</p>
        </div>
      </div>
      <form class="channel-form" id="wnForm" style="margin-top:1rem">
        <div class="row">
          <div class="field"><label for="wnType">Listing type</label><select id="wnType" name="type">${o.types.map((t) => `<option${t === saved.type ? " selected" : ""}>${esc(t)}</option>`).join("")}</select><p class="hint">For auctions, your price becomes the starting bid.</p></div>
          <div class="field"><label for="wnShip">Shipping profile</label><input id="wnShip" name="shipping" list="wnShipList" value="${esc(shipping)}" /><datalist id="wnShipList">${o.shipping_profiles.map((s) => `<option value="${esc(s)}">`).join("")}</datalist><p class="hint">A Whatnot weight band, or the exact name of a custom profile you made on Whatnot. Applies to every row; change single rows in the file if needed.</p></div>
        </div>
        <div class="field"><label class="check"><input type="checkbox" name="offerable"${saved.offerable ? " checked" : ""} /> Let buyers make offers (Buy it Now only)</label></div>
        <div class="field"><label class="check"><input type="checkbox" name="drafts"${saved.drafts ? " checked" : ""} /> Include draft listings (normally only published, in-stock items)</label></div>
        <button class="btn btn-primary" type="submit">Download Whatnot CSV</button>
      </form>
      <div class="setup-help">
        <p><strong>Then on whatnot.com</strong> (desktop): Seller Hub → <strong>Inventory</strong> → <strong>Import from CSV</strong>. Items arrive as drafts for you to check and publish. Everything goes under ${esc(o.category)}.</p>
        <p><strong>When something sells on Whatnot</strong>, lower its stock here (or mark it Sold out). That updates Etsy straight away so it can't sell twice.</p>
        <p>Importing the same file twice creates duplicates on Whatnot, so delete old drafts there before re-importing.</p>
      </div>`;
    el.querySelector("#wnForm").onsubmit = (e) => {
      e.preventDefault();
      const f = e.target.elements;
      const opts = { type: f.namedItem("type").value, shipping: f.namedItem("shipping").value.trim(), offerable: f.namedItem("offerable").checked, drafts: f.namedItem("drafts").checked };
      try { localStorage.setItem("whatnotExport", JSON.stringify(opts)); } catch { /* storage blocked */ }
      const q = new URLSearchParams({ type: opts.type, shipping: opts.shipping, offerable: opts.offerable ? "1" : "0", drafts: opts.drafts ? "1" : "0" });
      location.href = `/api/admin/marketplaces/whatnot/export.csv?${q}`;
    };
  }

  async function renderSales(el, channels) {
    const sales = await api("/api/admin/marketplaces/sales");
    const connected = channels.filter((c) => c.connected);
    const lastSync = connected.map((c) => c.last_sync_at).filter(Boolean).sort().pop();
    el.innerHTML = `
      <div class="channel-head">
        <div>
          <h2 style="margin:0">Sales sync</h2>
          <p class="muted" style="margin:.2rem 0 0">When something sells on ${connected.map((c) => esc(c.name)).join(" or ")}, its stock here drops${connected.length > 1 ? " and the other marketplace is updated" : " and the item is marked sold out when none are left"}, so it can't sell twice. Checks every 10 minutes.${lastSync ? ` Last check ${timeAgo(lastSync)}.` : ""}</p>
          ${connected.filter((c) => !c.sales_sync).map((c) => `<p class="error" style="margin:.3rem 0 0">${esc(c.name)} was connected before sales sync existed. ${me.role === "owner" ? "Click Reconnect below" : "Ask the owner to reconnect it"} to turn it on.</p>`).join("")}
        </div>
        <div class="channel-acts"><button class="btn btn-sm" id="syncNow">Sync now</button></div>
      </div>
      ${sales.length ? `
        <table class="table sales-table">
          <thead><tr><th>Sold</th><th>Item</th><th>Where</th><th>Qty</th><th class="hide-sm">Left here</th></tr></thead>
          <tbody>${sales.map((s) => `
            <tr data-id="${s.product_id}" tabindex="0">
              <td class="muted">${timeAgo(s.sold_at)}</td>
              <td>${esc(s.name)}</td>
              <td>${CH_NAMES[s.channel] || esc(s.channel)}</td>
              <td>${s.quantity}</td>
              <td class="hide-sm">${s.status === "sold" ? `<span class="pill sold">sold</span>` : s.stock}</td>
            </tr>`).join("")}</tbody>
        </table>` : `<p class="muted" style="margin:1rem 0 0">No marketplace sales of your listings yet.</p>`}`;

    el.querySelectorAll("tr[data-id]").forEach((tr) => (tr.onclick = () => (location.hash = `#/listings/${tr.dataset.id}`)));
    const btn = el.querySelector("#syncNow");
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = "Syncing…";
      try {
        const r = await api("/api/admin/marketplaces/sync", { method: "POST" });
        const updated = r.results.reduce((n, x) => n + (x.updated || 0), 0);
        const errs = r.results.filter((x) => x.error);
        if (errs.length) toast(errs.map((x) => `${CH_NAMES[x.channel]}: ${x.error}`).join(" "), true);
        else toast(updated ? `${updated} listing${updated > 1 ? "s" : ""} updated from new sales` : "Up to date. No new sales.");
      } catch (ex) { toast(ex.message, true); }
      renderChannels(new URLSearchParams());
    };
  }

  function setupHelp(ch) {
    const env = ch === "etsy"
      ? "<code>ETSY_API_KEY</code> (keystring) and <code>ETSY_SHARED_SECRET</code>"
      : "<code>EBAY_CLIENT_ID</code>, <code>EBAY_CLIENT_SECRET</code> and <code>EBAY_RUNAME</code>";
    const where = ch === "etsy"
      ? `Create an app at <a href="https://www.etsy.com/developers/your-apps" target="_blank" rel="noopener">etsy.com/developers</a> and add this callback URL: <code>${esc(location.origin)}/api/admin/marketplaces/etsy/callback</code>`
      : `Create a keyset at <a href="https://developer.ebay.com/my/keys" target="_blank" rel="noopener">developer.ebay.com</a>, then under User Tokens add a RuName whose "auth accepted URL" is <code>${esc(location.origin)}/api/admin/marketplaces/ebay/callback</code>`;
    return `<div class="setup-help"><p>${where}.</p><p>Then set ${env} in the server's environment and restart.</p></div>`;
  }

  async function renderChannelSettings(el, c, isOwner) {
    const o = await api(`/api/admin/marketplaces/${c.channel}/options`);
    const s = c.settings;
    const sel = (name, label, list, val, hint = "") => {
      if (list && list.error) return `<div class="field"><label>${label}</label><p class="error" style="margin:0">${esc(list.error)}</p></div>`;
      const items = (list && list.items) || [];
      return `<div class="field"><label for="${c.channel}-${name}">${label}</label>
        <select id="${c.channel}-${name}" name="${name}"><option value="">${items.length ? "Choose…" : "None found"}</option>${items.map((i) => `<option value="${esc(i.id)}"${String(i.id) === String(val) ? " selected" : ""}>${esc(i.name)}</option>`).join("")}</select>
        ${hint ? `<p class="hint">${hint}</p>` : ""}</div>`;
    };
    const check = (name, label, val, hint) => `<div class="field"><label class="check"><input type="checkbox" name="${name}"${val ? " checked" : ""} /> ${label}</label>${hint ? `<p class="hint">${hint}</p>` : ""}</div>`;

    const catField = c.channel === "etsy" ? "taxonomy" : "category";
    let body = `
      <h3>Defaults for new listings</h3>
      <div class="field"><label>Default category</label><div data-cat></div>
        <p class="hint">Each listing can override this on its edit page.</p></div>`;
    if (c.channel === "etsy") {
      body += `
        <div class="row">
          ${sel("shipping_profile_id", "Shipping profile", o.shipping_profiles, s.shipping_profile_id, "Required. Create one in Shop Manager → Settings → Shipping if the list is empty.")}
          ${sel("readiness_state_id", "Processing profile", o.readiness_states, s.readiness_state_id, "How long you take to ship.")}
          ${sel("return_policy_id", "Return policy", o.return_policies, s.return_policy_id)}
        </div>
        <div class="row">
          <div class="field"><label for="etsy-who">Who made it?</label><select id="etsy-who" name="who_made">${opts([["i_did", "I did"], ["someone_else", "Another company or person"], ["collective", "A member of my shop"]], s.who_made)}</select></div>
          <div class="field"><label for="etsy-when">When was it made?</label><input id="etsy-when" name="when_made" list="etsy-when-list" value="${esc(s.when_made)}" /><datalist id="etsy-when-list">${o.when_made.map((w) => `<option value="${w}">`).join("")}</datalist><p class="hint">Etsy's value, e.g. made_to_order or 2020_2025.</p></div>
        </div>
        ${check("is_supply", "List as a craft supply", s.is_supply, "Etsy only allows handmade, vintage or craft-supply items. Raw stones and specimens usually go under craft supplies.")}
        ${check("auto_publish", "Publish straight away (instead of saving as an Etsy draft)", s.auto_publish, "Etsy charges $0.20 per published listing.")}`;
    } else {
      body += `
        <div class="row">
          ${sel("fulfillment_policy_id", "Shipping policy", o.fulfillment_policies, s.fulfillment_policy_id)}
          ${sel("payment_policy_id", "Payment policy", o.payment_policies, s.payment_policy_id)}
          ${sel("return_policy_id", "Return policy", o.return_policies, s.return_policy_id)}
        </div>
        <div class="row">
          ${sel("merchant_location_key", "Ship-from location", o.locations, s.merchant_location_key)}
          <div class="field"><label for="ebay-cond">Condition</label><select id="ebay-cond" name="condition">${opts(o.conditions.map((x) => [x, x.replace(/_/g, " ").toLowerCase().replace(/^\w/, (m) => m.toUpperCase())]), s.condition)}</select></div>
        </div>
        ${isOwner && o.locations.items && !o.locations.items.length ? `
          <div class="field newloc"><label>Add a ship-from location</label>
            <div style="display:flex;gap:.5rem;flex-wrap:wrap"><input name="_pc" placeholder="Postal code" style="max-width:160px" /><input name="_cc" value="US" maxlength="2" style="max-width:70px" /><button type="button" class="btn btn-sm" data-loc>Add location</button></div></div>` : ""}
        ${check("auto_publish", "Publish straight away (instead of keeping an unpublished eBay offer)", s.auto_publish, "eBay insertion fees may apply once a listing is live.")}`;
    }
    el.innerHTML = `<form class="channel-form">${body}
      ${isOwner ? `<div style="display:flex;gap:.5rem;align-items:center"><button class="btn btn-primary" type="submit">Save ${esc(c.name)} settings</button><span class="muted" data-missing>${c.missing.length ? `Still needed: ${esc(c.missing.join(", "))}` : "Ready to push listings."}</span></div>` : ""}
    </form>`;

    const form = el.querySelector("form");
    if (!isOwner) form.querySelectorAll("input,select").forEach((i) => (i.disabled = true));
    const cat = { id: s[`${catField}_id`], name: s[`${catField}_name`] };
    categoryPicker(el.querySelector("[data-cat]"), {
      searchUrl: c.channel === "etsy" ? "/api/admin/marketplaces/etsy/taxonomy" : "/api/admin/marketplaces/ebay/categories",
      current: cat,
      placeholder: c.channel === "etsy" ? "Search, e.g. crystals" : "Search, e.g. amethyst sphere",
      onPick: (picked) => { cat.id = picked.id; cat.name = picked.name; },
    });

    const locBtn = el.querySelector("[data-loc]");
    if (locBtn) locBtn.onclick = async () => {
      try {
        await api("/api/admin/marketplaces/ebay/location", { method: "POST", body: { postalCode: form._pc.value, country: form._cc.value } });
        toast("Location added");
        renderChannels(new URLSearchParams());
      } catch (ex) { toast(ex.message, true); }
    };

    form.onsubmit = async (e) => {
      e.preventDefault();
      const data = {};
      form.querySelectorAll("select[name],input[name]:not([name^='_'])").forEach((i) => (data[i.name] = i.type === "checkbox" ? i.checked : i.value));
      data[`${catField}_id`] = cat.id || "";
      data[`${catField}_name`] = cat.name || "";
      try {
        const r = await api(`/api/admin/marketplaces/${c.channel}/settings`, { method: "PUT", body: data });
        c.missing = r.missing;
        el.querySelector("[data-missing]").textContent = r.missing.length ? `Still needed: ${r.missing.join(", ")}` : "Ready to push listings.";
        toast(`${c.name} settings saved`);
      } catch (ex) { toast(ex.message, true); }
    };
  }

  // ---------- team ----------
  async function renderTeam() {
    document.title = "Team · Stardust & Stoneworks";
    shell("team", `<p class="muted">Loading…</p>`);
    const users = await api("/api/admin/users");
    const isOwner = me.role === "owner";
    const main = app.querySelector(".main");
    main.innerHTML = `
      <div class="page-head"><div><h1>Team</h1><p class="muted" style="margin:.25rem 0 0">Everyone here can log in and manage listings.${isOwner ? "" : " Only the owner can add or remove people."}</p></div></div>
      <div class="panel">
        <div class="team-list">${users.map((u) => `
          <div class="member" data-id="${u.id}">
            <div class="info"><strong>${esc(u.name || u.email)} ${u.id === me.id ? `<span class="muted" style="font-weight:400">(you)</span>` : ""}</strong><span class="muted">${esc(u.email)}</span></div>
            <div class="acts">
              <span class="pill ${u.role}">${u.role}</span>
              ${isOwner && u.role !== "owner" ? `<button class="btn btn-sm" data-reset="${u.id}">Reset password</button><button class="btn btn-sm btn-danger" data-remove="${u.id}">Remove</button>` : ""}
            </div>
          </div>`).join("")}
        </div>
      </div>
      ${isOwner ? `
      <form class="panel" id="addForm">
        <h2>Add a staff member</h2>
        <div class="row">
          <div class="field"><label for="nm">Name</label><input id="nm" maxlength="80" placeholder="Their name" /></div>
          <div class="field"><label for="ne">Email</label><input id="ne" type="email" required placeholder="name@example.com" /></div>
          <div class="field"><label for="np">Temporary password</label><input id="np" type="text" minlength="10" required autocomplete="new-password" placeholder="At least 10 characters" /></div>
        </div>
        <p class="hint" style="margin-top:-.4rem">Share the temporary password with them privately. They can change it under Account.</p>
        <button class="btn btn-primary" type="submit">Add staff member</button>
        <p class="error" id="addErr"></p>
      </form>` : ""}`;

    if (!isOwner) return;

    main.querySelector("#addForm").onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      try {
        await api("/api/admin/users", { method: "POST", body: { name: f.nm.value, email: f.ne.value, password: f.np.value } });
        toast("Staff member added");
        renderTeam();
      } catch (ex) { main.querySelector("#addErr").textContent = ex.message; }
    };

    main.querySelector(".team-list").onclick = (e) => {
      const resetId = e.target.dataset.reset;
      const removeId = e.target.dataset.remove;
      const acts = e.target.closest(".acts");
      if (resetId) {
        acts.innerHTML = `<input type="text" placeholder="New password (10+ chars)" style="width:200px" /><button class="btn btn-sm btn-primary">Set</button><button class="btn btn-sm" data-cancel>Cancel</button>`;
        acts.querySelector("[data-cancel]").onclick = renderTeam;
        acts.querySelector(".btn-primary").onclick = async () => {
          try {
            await api(`/api/admin/users/${resetId}/password`, { method: "POST", body: { password: acts.querySelector("input").value } });
            toast("Password updated. They've been signed out.");
            renderTeam();
          } catch (ex) { toast(ex.message, true); }
        };
      } else if (removeId) {
        acts.innerHTML = `<span class="muted">Remove access?</span><button class="btn btn-sm btn-danger">Yes, remove</button><button class="btn btn-sm" data-cancel>Cancel</button>`;
        acts.querySelector("[data-cancel]").onclick = renderTeam;
        acts.querySelector(".btn-danger").onclick = async () => {
          try {
            await api(`/api/admin/users/${removeId}`, { method: "DELETE" });
            toast("Removed");
            renderTeam();
          } catch (ex) { toast(ex.message, true); }
        };
      }
    };
  }

  // ---------- account ----------
  function renderAccount() {
    document.title = "Account · Stardust & Stoneworks";
    shell("account", `
      <div class="page-head"><div><h1>Account</h1><p class="muted" style="margin:.25rem 0 0">${esc(me.name || "")} · ${esc(me.email)} · <span class="pill ${me.role}">${me.role}</span></p></div></div>
      <form class="panel" id="pwForm" style="max-width:460px">
        <h2>Change password</h2>
        <div class="field"><label for="cur">Current password</label><input id="cur" type="password" autocomplete="current-password" required /></div>
        <div class="field"><label for="nw">New password</label><input id="nw" type="password" minlength="10" autocomplete="new-password" required /><p class="hint">At least 10 characters.</p></div>
        <button class="btn btn-primary" type="submit">Update password</button>
        <p class="error" id="pwErr"></p>
      </form>`);
    document.getElementById("pwForm").onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      try {
        await api("/api/admin/me/password", { method: "POST", body: { current: f.cur.value, next: f.nw.value } });
        f.reset();
        toast("Password updated");
      } catch (ex) { document.getElementById("pwErr").textContent = ex.message; }
    };
  }

  // ---------- router ----------
  async function route() {
    if (!me) return renderLogin();
    const [path, qs = ""] = location.hash.replace(/^#\/?/, "").split("?");
    const parts = (path || "listings").split("/");
    try {
      if (parts[0] === "listings" && parts[1]) await renderEditor(parts[1]);
      else if (parts[0] === "channels") await renderChannels(new URLSearchParams(qs));
      else if (parts[0] === "team") await renderTeam();
      else if (parts[0] === "account") renderAccount();
      else await renderListings();
    } catch (ex) {
      if (me) toast(ex.message, true);
    }
  }
  window.addEventListener("hashchange", route);

  (async () => {
    try {
      const { user } = await api("/api/admin/me");
      me = user;
    } catch { me = null; }
    route();
  })();
})();
