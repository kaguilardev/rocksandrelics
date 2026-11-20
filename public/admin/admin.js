(() => {
  "use strict";

  const app = document.getElementById("app");
  const toastEl = document.getElementById("toast");
  let me = null;

  const TYPES = [["orb", "Orb / Sphere"], ["tower", "Tower / Point"], ["figure", "Figure / Shape"], ["raw", "Raw stone"], ["cluster", "Cluster / Geode"]];
  const STATUSES = [["draft", "Draft (hidden)"], ["published", "Published"], ["sold", "Sold out"]];
  const STYLES = ["amethyst", "aura", "rose", "labradorite", "fluorite", "obsidian", "citrine", "moonstone", "malachite", "galaxy", "tiger", "lapis"];

  const LOGO = `<img class="brand-mark" src="/brand/geode-mark.png" alt="" width="404" height="172" />`;

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
              <td><div class="name-cell">${p.images[0] ? `<img class="thumb" src="/img/${p.images[0].id}" alt="" loading="lazy" />` : `<span class="thumb"></span>`}<span>${esc(p.name)}<br /><span class="muted" style="font-weight:400;font-size:.8rem">${esc(TYPES.find((t) => t[0] === p.type)?.[1] || p.type)}${p.material ? " · " + esc(p.material) : ""}</span></span></div></td>
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

    // delete with inline confirm
    const delWrap = main.querySelector("#delWrap");
    main.querySelector("#del").onclick = () => {
      delWrap.innerHTML = `<span class="confirm"><span class="muted">Delete for good?</span><button type="button" class="btn btn-danger btn-sm" id="delYes">Yes, delete</button><button type="button" class="btn btn-sm" id="delNo">Cancel</button></span>`;
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
    const parts = (location.hash.replace(/^#\/?/, "") || "listings").split("/");
    try {
      if (parts[0] === "listings" && parts[1]) await renderEditor(parts[1]);
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
