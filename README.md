# Driftpost 〜

One calm composer for **YouTube, Instagram and Facebook**. Remake of Social-Flow: minimalist UI, no X/Twitter, split frontend + unified publish API + Supabase.

## What changed vs Social-Flow
- Name: `Driftpost` (unique, calm, post-anywhere).
- Platforms: YouTube + Instagram + Facebook only. All X code removed.
- UI: minimalist light theme, system font, 2 views (Compose / Accounts), no gradients, no dark gamer theme.
- Code: `main.jsx` (567 lines) split into `App.jsx` + `lib.js`; backend split into `google.js` / `youtube-upload.js` / `meta.js`; single `POST /api/publish` + `GET /api/jobs/:id`.
- DB: `platform_connections` (yt/ig/fb only) + new `post_history`.

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
