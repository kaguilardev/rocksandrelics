# Stardust & Stoneworks

Stones, crystals and rocks of every kind: shapes, figures, orbs, towers, clusters and raw specimens.

## Run locally

```bash
npm install
npm start
```

Then open http://localhost:3000.

## Deploy (Render)

- **Build command:** `npm install`
- **Start command:** `npm start`
- **Health check path:** `/healthz`

### Environment variables

| Key | What it is |
|---|---|
| `DATABASE_URL` | The Postgres **Internal Database URL** from Render |
| `SESSION_SECRET` | A long random string (use Render's **Generate** button) |
| `ADMIN_EMAIL` | Email for the owner login, used once on first start |
| `ADMIN_PASSWORD` | Password for the owner login (10+ characters), used once on first start. Remove it after you've logged in |
| `ADMIN_NAME` | Optional display name for the owner |
| `PUBLIC_BASE_URL` | Your site's public address, e.g. `https://stardust.example.com` (used for marketplace callbacks and photo links) |
| `ETSY_API_KEY`, `ETSY_SHARED_SECRET` | From your Etsy app (optional, enables Etsy) |
| `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_RUNAME` | From your eBay keyset (optional, enables eBay) |
| `EBAY_ENV` | `sandbox` to test against eBay's sandbox; leave unset for live |
| `EBAY_VERIFICATION_TOKEN` | Any 32–80 character string, for eBay's account-deletion notifications |
| `MARKETPLACE_SYNC_MINUTES` | Optional. How often to check Etsy/eBay for new sales (default 10, `0` turns it off) |
| `MARKETPLACE_SECRET` | Optional. Encrypts stored Etsy/eBay tokens; defaults to `SESSION_SECRET`. Changing it means reconnecting |

## Online checkout (Stripe)

The cart's **Checkout** button sends buyers to a Stripe-hosted payment page. Prices and stock are always re-checked against the database, so a changed cart in the browser can't change what's charged.

1. In the [Stripe Dashboard](https://dashboard.stripe.com/apikeys), copy your **secret key** (`sk_test_…` to test, `sk_live_…` for real sales) into `STRIPE_SECRET_KEY`.
2. Under **Developers → Webhooks**, add the endpoint `https://YOUR-SITE/api/stripe/webhook` and select the events `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Copy its **signing secret** (`whsec_…`) into `STRIPE_WEBHOOK_SECRET`.
3. Optional: `STRIPE_SHIPPING_CENTS` (flat shipping per order, e.g. `899`; default free) and `STRIPE_SHIP_COUNTRIES` (comma list, default `US`).
4. Set `PUBLIC_BASE_URL` so buyers come back to the right address after paying.

When a payment succeeds, the webhook takes the items off stock (marking one-of-a-kind pieces **Sold out**) and passes the new stock to Etsy and eBay. Orders and customer details are in the Stripe Dashboard under **Payments**. Until `STRIPE_SECRET_KEY` is set, the cart shows "Checkout coming soon".

## Selling on Etsy and eBay

Connect your accounts under **Admin → Channels**, then push any listing from its edit page. The site stays the source of truth: when you edit a listing here, press **Update** to send the new title, description, price, stock and photos.

**Etsy**
1. Create an app at [etsy.com/developers/your-apps](https://www.etsy.com/developers/your-apps). Add the callback URL `https://YOUR-SITE/api/admin/marketplaces/etsy/callback`.
2. Set `ETSY_API_KEY` (the keystring) and `ETSY_SHARED_SECRET`, then restart.
3. Under Channels, click **Connect Etsy**, then pick a default category and a shipping profile. You also need a shipping profile set up in Etsy Shop Manager.
4. Listings go to Etsy as drafts unless you click **Publish**. Etsy charges $0.20 per published listing.

**eBay**
1. Create a keyset at [developer.ebay.com](https://developer.ebay.com/my/keys). Under *User Tokens → Get a Token from eBay via Your Application*, add a RuName and set its **auth accepted URL** to `https://YOUR-SITE/api/admin/marketplaces/ebay/callback`.
2. For production keys, eBay requires an account-deletion endpoint. Use `https://YOUR-SITE/api/marketplaces/ebay/account-deletion` with the same `EBAY_VERIFICATION_TOKEN`.
3. Set the `EBAY_*` variables, restart, then click **Connect eBay** under Channels.
4. Turn on Business Policies in your eBay account, then choose shipping, payment and return policies, a ship-from location and a default category.
5. eBay downloads photos from your site, so the site must be on public **https**. Some categories need *item specifics* (like Color). If a push asks for one, add it in the listing's eBay options.

### Whatnot (CSV export)

Whatnot's Seller API is invite-only, so Whatnot works by file: **Channels → Whatnot → Download Whatnot CSV**, then on whatnot.com go to Seller Hub → Inventory → **Import from CSV**. The file follows Whatnot's US bulk-import template, puts everything under *Rocks & Crystals*, and includes each listing's photos as links. When something sells on Whatnot, lower its stock here: that updates Etsy straight away.

### Sales sync

Every 10 minutes the server reads new orders from Etsy and eBay:

- A sale takes the quantity off stock here. When stock reaches 0, the listing is marked **Sold out** on the site.
- The new stock goes to the *other* marketplace straight away, so a one-of-a-kind piece can't sell twice. At 0, the Etsy listing is deactivated and the eBay listing goes out of stock.
- Changing stock or marking a listing sold in the admin also updates Etsy and eBay.
- Cancelled orders are ignored, and each order line is only ever counted once.

**Channels → Sales sync** shows recent sales and has a **Sync now** button. Don't also lower stock by hand for a marketplace sale, or it will be counted twice.

Notes:
- Accounts connected before sales sync was added need one **Reconnect**, which grants permission to read orders.
- On Render's free plan the server sleeps when idle, so checks pause until someone visits the site. Use a paid instance, or press **Sync now**, if that matters.
- Set `MARKETPLACE_SYNC_MINUTES` to change the interval, or `0` to turn automatic checks off.

## Admin

Go to `/admin` to log in. From there you can:

- **Listings:** create, edit, publish/unpublish and delete listings, and upload up to 8 photos each (photos are resized in the browser and stored in Postgres).
- **Team** (owner only): add staff logins with a temporary password, reset passwords and remove access.
- **Account:** change your own password.

Only listings marked **Published** or **Sold out** appear on the storefront.

## Structure

- `server.js`: Express app, sessions, routing
- `db.js`: Postgres connection and schema (tables are created automatically on start)
- `auth.js`: password hashing, login throttling, auth middleware
- `routes/public.js`: storefront API (`/api/products`) and photos (`/img/:id`)
- `routes/admin.js`: admin API (`/api/admin/*`)
- `routes/marketplaces.js`: Etsy/eBay connect, settings and push API
- `marketplaces/`: Etsy and eBay connectors plus token storage
- `public/`: storefront; `public/admin/`: admin dashboard
