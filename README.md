# Driftpost 〜

One calm composer for **YouTube, Instagram, Facebook and X**. Remake of Social-Flow: dark-gold brand-first UI, split frontend + unified publish API + Supabase.

## What changed vs Social-Flow
- Name: `Driftpost` (unique, calm, post-anywhere).
- Platforms: YouTube + Instagram + Facebook + X (X re-added with OAuth2 + publishing).
- UI: dark-gold theme, brand-first 4-phone composer (Metricool-style), per-platform sections, brand filter/hide, Active badges, animated dropdowns.
- Code: `App.jsx` + `lib.js` (brand grouping); backend `google.js` / `youtube-upload.js` / `meta.js` / `x.js` / `x-publish.js`; single `POST /api/publish` + `GET /api/jobs/:id`.
- DB: `platform_connections` (yt/ig/fb/x) + `post_history`.

## Run locally
```powershell
# frontend
cd C:\Users\faiza\Driftpost
npm install
Copy-Item .env.example .env
npm run dev   # http://localhost:5173

# backend (second terminal)
cd C:\Users\faiza\Driftpost\server
npm install
Copy-Item .env.example .env
npm run dev   # http://localhost:10000
```

## Supabase — everything you must provide (you have nothing yet)
1. **Create project** at supabase.com → get:
   - `VITE_SUPABASE_URL` (frontend) = `SUPABASE_URL` (backend), e.g. `https://xyz.supabase.co`
   - `VITE_SUPABASE_PUBLISHABLE_KEY` (frontend, `sb_publishable_…`)
   - `SUPABASE_SECRET_KEY` (backend only, `sb_secret_…` — never put in frontend)
2. **Auth → Providers → enable Email + Google.**
   - Google: create OAuth client in Google Cloud Console, paste client ID/secret into Supabase Auth → Google provider.
   - Supabase → Auth → URL Configuration → add `http://localhost:5173` and your prod URL to Redirect URLs.
3. **SQL Editor → run** `supabase/migrations/001_platform_connections.sql` then `002_post_history.sql`.
4. **Storage → create public bucket** named `driftpost-media` (required for Instagram: API uploads the reel/photo there to get a public URL for Meta).
5. **Google Cloud (YouTube):** APIs & Services → enable *YouTube Data API v3* → OAuth consent screen (External) → scopes `youtube.upload`, `youtube.readonly` → Credentials → Web app → redirect URI = `http://localhost:10000/api/oauth/youtube/callback` (add prod URL later). Copy ID/secret into `server/.env` as `GOOGLE_*`.
6. **Meta (Facebook + Instagram):** developers.facebook.com → Create App (Business) → add *Facebook Login* → Valid OAuth redirect = `http://localhost:10000/api/oauth/meta/callback`. You need:
   - a Facebook **Page**
   - an Instagram **Business/Creator account linked to that Page** (Page Settings → Linked accounts), otherwise Instagram connection will not appear — this is a Meta requirement, not a bug.
   - Copy App ID/secret into `server/.env` as `META_*`.
7. **Secrets:** generate and put in `server/.env`:
   - `TOKEN_ENCRYPTION_KEY`: 32 random bytes, base64. PowerShell: `[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Max 256 }))`
   - `STATE_SIGNING_SECRET`: any long random string.
   - `FRONTEND_URL=http://localhost:5173`, `VITE_API_URL=http://localhost:10000`.
8. **Deploy:** frontend env `VITE_API_URL` = public API URL; backend `FRONTEND_URL` = public site URL; add both prod redirect URIs to Google + Meta consoles.

Without items 1–7 the app opens and auth screen shows, but Connect/Publish will return “not configured” — that is expected until keys exist.

## Deploy (frontend → Vercel, API → Render)

The API does resumable 2 GB uploads with local temp files, which Vercel serverless can't do
(4.5 MB payload cap) — so: **frontend on Vercel, API on Render**. Both free.

1. **API → Render:** Dashboard → New → Web Service → select repo (or use `server/render.yaml`
   blueprint) → root dir `server`, build `npm install`, start `node src/index.js`.
   Fill env vars (same values as `server/.env`). Note your URL:
   `https://driftpost-api.onrender.com`.
2. **Frontend → Vercel:** vercel.com → Add New Project → import `FamebrosStudio/Driftpost`
   (`vercel.json` is already in the repo). Env vars:
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`
   - `VITE_API_URL=https://driftpost-api.onrender.com` (Vite bakes this at build time —
     set it **before** deploying, or redeploy after changing it).
   Note your URL: `https://driftpost.vercel.app`.

## After the URLs change (localhost → prod), update these 6 places

1. **Render env:** `FRONTEND_URL=https://driftpost.vercel.app` (CORS) → restart service.
2. **Google Cloud Console** (OAuth client): add Authorized redirect URI
   `https://driftpost-api.onrender.com/api/oauth/youtube/callback`;
   set backend `GOOGLE_REDIRECT_URI` to the same → restart API.
3. **Meta App** (Facebook Login → Settings): add Valid OAuth Redirect URI
   `https://driftpost-api.onrender.com/api/oauth/meta/callback`;
   set backend `META_REDIRECT_URI` to the same → restart API.
   (Business Login configuration uses the same redirect — no separate change.)
4. **X Developer Portal** (auth settings): Callback URI
   `https://driftpost-api.onrender.com/api/oauth/x/callback`;
   set backend `X_REDIRECT_URI` to the same → restart API.
5. **Supabase** → Auth → URL Configuration: Site URL + Redirect URLs → add
   `https://driftpost.vercel.app`.
6. **Reconnect every account** (Accounts → Disconnect → Connect): OAuth tokens and
   Supabase sessions from localhost do not transfer to prod.

Keep the localhost URIs alongside prod ones during testing — both can coexist.
