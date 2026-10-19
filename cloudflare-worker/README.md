# Her Motorsport — Cloudflare Worker Rewrite

A modern, high-performance edge rewrite of the **Her Motorsport** website, powered by **Cloudflare Workers with Static Assets**, **Hono**, and **Cloudflare D1 (Serverless SQLite)**.

---

## 🏎️ Key Enhancements Over the Original

1. **Global Real-Time Driver Grid**:
   - The original static site kept registered drivers inside each individual browser's `localStorage` or required a client-side Supabase SDK.
   - This version uses **Cloudflare D1 SQLite at the edge**. Every registered driver immediately appears on the global grid roster for everyone worldwide.

2. **Sub-50ms Global Asset Delivery**:
   - Built on Cloudflare's **Workers with Static Assets**. All HTML, CSS, JavaScript, and images are cached and served directly from Cloudflare's 300+ edge data centers.

3. **Backend API Security**:
   - Driver password hashing using the native **Web Crypto API** (SHA-256) on the edge.
   - No database credentials, keys, or tokens exposed to the client.
   - Built-in edge HTTP security headers and CORS protection.

4. **Clean URLs & Edge Routing**:
   - Clean 301 edge redirects for `/conduct`, `/portal`, and `/paddock`.

---

## 📁 Directory Structure

```text
cloudflare-worker/
├── public/                     # Static website assets (served via Cloudflare edge)
│   ├── index.html              # Main SPA homepage & portal
│   ├── conduct.html            # Code of Conduct page
│   └── assets/
│       ├── css/style.css       # Responsive racing theme
│       ├── js/main.js          # SPA navigation & mobile menu
│       ├── js/members.js       # Edge-connected driver portal
│       └── img/                # Logos, SVG badges, banners
├── src/
│   ├── index.ts                # Hono Cloudflare Worker entrypoint & REST API
│   └── db/
│       └── schema.sql          # D1 SQLite table definition & initial drivers
├── wrangler.jsonc              # Cloudflare configuration with D1 & Assets bindings
├── package.json
└── tsconfig.json
```

---

## 🚀 Quickstart & Local Development

### 1. Install Dependencies
```powershell
cd cloudflare-worker
npm install
```

### 2. Initialize Local D1 Database
Create the local SQLite database and populate initial paddock drivers:
```powershell
npm run db:init:local
```

### 3. Start Local Edge Dev Server
```powershell
npm run dev
```
Open [http://localhost:8787](http://localhost:8787) in your browser. Both the static site and the edge `/api/*` routes are fully functional locally!

---

## 🌐 Deploying to Cloudflare

### 1. Authenticate with Cloudflare
```powershell
npx wrangler login
```

### 2. Create the Production D1 Database
```powershell
npx wrangler d1 create hm-db
```
Wrangler will output your unique `database_id`, for example:
```jsonc
{
  "binding": "DB",
  "database_name": "hm-db",
  "database_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
}
```
Update `wrangler.jsonc` with your production `database_id`.

### 3. Apply Schema to Production D1
```powershell
npm run db:init:remote
```

### 4. Deploy
```powershell
npm run deploy
```
Wrangler will upload your static assets to Cloudflare's edge CDN and deploy the Worker code to your custom domain or `*.workers.dev` subdomain.

---

## 🔌 Edge API Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/roster` | Returns all active paddock drivers for the global grid |
| `POST` | `/api/auth/register` | Registers a new driver pass into D1 with hashed password |
| `POST` | `/api/auth/login` | Authenticates a driver against D1 credentials |
| `POST` | `/api/driver/profile` | Updates driver profile details (sim, division, handles) |
| `POST` | `/api/driver/account` | Updates driver email or password |
| `POST` | `/api/auth/forgot-password` | Handles password reset requests |
| `GET` | `/conduct` | Edge 301 redirect to `/#conduct` |
| `GET` | `/*` | Edge CDN serving of files in `public/` |

---

## HMS Data Sync rendezvous (`/api/sync/v1`)

The HMS Data Sync desktop app uses the Worker only to help members find each other while they are online. **No files, rosters, paints or recordings are ever stored here**; members share directly with each other.

| Route | Purpose |
| --- | --- |
| `POST /announce` | Signed by the member's Ed25519 key: name, optional iRacing ID, listen port, listed or not. The address is the one Cloudflare sees. |
| `POST /leave` | Signed: stop being found. The iRacing ID stays claimed. |
| `GET /members` | Members who chose to be listed and are online (last 10 minutes). |
| `GET /lookup?id=<member id>` / `?iracingId=<n>` | Where one member is now. By member ID for anyone online; by iRacing ID only for listed members. |

One iRacing ID can belong to one member key (first claim wins, the holder can release it). There are no accounts, tokens or quotas beyond a limit on new members per address. Table: `sync_presence` (`src/db/migration_03_sync_presence.sql`). Tests: `npm test` (real routes on a real SQLite database; no network, no deploy). Deploying and applying the migration remotely need the owner's approval.
