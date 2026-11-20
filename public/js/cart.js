(() => {
  "use strict";
  const { esc, money, gem, readCart, writeCart, reveal } = window.SS;
  const root = document.getElementById("cartRoot");

  function render() {
    const items = readCart();
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
          <button class="btn btn-primary btn-block" type="button" style="margin-top:1.25rem" disabled>Checkout coming soon</button>
          <p class="muted" style="font-size:.82rem;margin:.9rem 0 0;text-align:center">Online checkout is on its way. <a href="/contact" class="link-arrow">Contact us to order</a></p>
        </aside>
      </div>`;
  }

  root.addEventListener("click", (e) => {
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
  render();
})();
