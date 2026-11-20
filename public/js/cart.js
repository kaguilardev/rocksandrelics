(() => {
  "use strict";
  const { esc, money, gem, readCart, writeCart, reveal } = window.SS;
  const root = document.getElementById("cartRoot");
  let checkoutEnabled = false;

  // Back from Stripe
  const params = new URLSearchParams(location.search);
  const returned = params.get("checkout");
  if (returned) history.replaceState(null, "", "/cart");
  if (returned === "success") writeCart([]);

  function render() {
    const items = readCart();
    if (!items.length && returned === "success") {
      root.innerHTML = `<div class="empty reveal" style="margin-bottom:5rem"><strong>Thank you for your order!</strong>Your payment went through and a receipt is on its way to your email. We'll let you know when it ships. <div style="margin-top:1.5rem"><a href="/shop" class="btn btn-primary">Keep exploring</a></div></div>`;
      reveal(root);
      return;
    }
    if (!items.length) {
      root.innerHTML = `<div class="empty reveal" style="margin-bottom:5rem"><strong>Your cart is empty.</strong>The stones are waiting. <div style="margin-top:1.5rem"><a href="/shop" class="btn btn-primary">Explore the shop</a></div></div>`;
      reveal(root);
      return;
    }
    const subtotal = items.reduce((a, i) => a + i.price_cents * i.qty, 0);
    root.innerHTML = `
      <div class="cart-layout">
        <div class="cart-list">
          ${items.map((i) => `
            <div class="line" data-slug="${esc(i.slug)}">
              <a class="line-art" href="/product?p=${encodeURIComponent(i.slug)}">${i.image ? `<img src="/img/${i.image}" alt="" />` : gem(i)}</a>
              <div>
                <h3><a href="/product?p=${encodeURIComponent(i.slug)}">${esc(i.name)}</a></h3>
                <span class="price">${money(i.price_cents)}</span>
              </div>
              <div class="line-actions">
                <div class="qty">
                  <button type="button" data-d="-1" aria-label="Less">−</button><span>${i.qty}</span><button type="button" data-d="1" aria-label="More">+</button>
                </div>
                <button class="remove" type="button" data-remove>Remove</button>
              </div>
            </div>`).join("")}
        </div>
        <aside class="panel summary">
          <h2 style="font-size:1.8rem;margin-bottom:1rem">Summary</h2>
          <div class="summary-row"><span>Subtotal</span><span>${money(subtotal)}</span></div>
          <div class="summary-row"><span>Shipping</span><span>Calculated at checkout</span></div>
          <div class="summary-row total"><span>Total</span><span>${money(subtotal)}</span></div>
          ${checkoutEnabled
            ? `<button class="btn btn-primary btn-block" type="button" style="margin-top:1.25rem" data-checkout>Checkout</button>
               <p class="muted" style="font-size:.82rem;margin:.9rem 0 0;text-align:center">Secure payment by Stripe.</p>`
            : `<button class="btn btn-primary btn-block" type="button" style="margin-top:1.25rem" disabled>Checkout coming soon</button>
               <p class="muted" style="font-size:.82rem;margin:.9rem 0 0;text-align:center">Online checkout is on its way. <a href="/contact" class="link-arrow">Contact us to order</a></p>`}
          <p class="checkout-error" role="alert" style="color:#ff8a8a;font-size:.85rem;margin:.75rem 0 0;text-align:center" hidden></p>
        </aside>
      </div>`;
  }

  function showError(msg) {
    const btn = root.querySelector("[data-checkout]");
    if (btn) { btn.disabled = false; btn.textContent = "Checkout"; }
    const el = root.querySelector(".checkout-error");
    if (el) { el.textContent = msg; el.hidden = false; }
  }

  async function startCheckout(btn) {
    btn.disabled = true;
    btn.textContent = "Opening secure checkout…";
    let data = {};
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: readCart().map((i) => ({ slug: i.slug, qty: i.qty })) }),
      });
      data = await res.json().catch(() => ({}));
      if (res.ok && data.url) { location.href = data.url; return; }
    } catch { /* network error */ }

    // Stock changed since the cart was filled: fix the cart up, then explain.
    if (Array.isArray(data.problems)) {
      const cart = readCart();
      for (const p of data.problems) {
        const item = cart.find((i) => i.slug === p.slug);
        if (item && p.max) { item.qty = p.max; item.max = p.max; }
      }
      writeCart(cart.filter((i) => !data.problems.some((p) => p.slug === i.slug && !p.max)));
    }
    showError(data.error || "Couldn't start checkout. Please try again.");
  }

  root.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-checkout]");
    if (btn) { startCheckout(btn); return; }
    const line = e.target.closest(".line");
    if (!line) return;
    const items = readCart();
    const item = items.find((i) => i.slug === line.dataset.slug);
    if (!item) return;
    if (e.target.closest("[data-remove]")) {
      writeCart(items.filter((i) => i !== item));
    } else {
      const d = Number(e.target.closest("[data-d]")?.dataset.d || 0);
      if (!d) return;
      item.qty = Math.max(1, Math.min(item.max || 99, item.qty + d));
      writeCart(items);
    }
  });
  document.addEventListener("cart:change", render);
  addEventListener("storage", render);
  // The back button can restore a page with a disabled "Opening…" button
  addEventListener("pageshow", (e) => { if (e.persisted) render(); });
  render();
  fetch("/api/checkout/config")
    .then((r) => r.json())
    .then((c) => { checkoutEnabled = Boolean(c.enabled); render(); })
    .catch(() => {});
})();
