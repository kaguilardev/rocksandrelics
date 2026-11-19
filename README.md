# Rocks and Relics

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
- `public/`: storefront; `public/admin/`: admin dashboard
