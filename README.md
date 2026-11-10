# Driftpost

One calm composer for **YouTube, Instagram, Facebook and X**. Remake of Social-Flow: dark-gold brand-first UI, split frontend + unified publish API + Supabase.

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
3. **SQL Editor → run every migration** in `supabase/migrations/` in numeric order (`001` through `015`).
4. **Storage → create public bucket** named `driftpost-media` (required for Instagram: API uploads the reel/photo there to get a public URL for Meta).
5. **Google Cloud (YouTube):** APIs & Services → enable *YouTube Data API v3* → OAuth consent screen (External) → scopes `youtube.upload`, `youtube.readonly` → Credentials → Web app → redirect URI = `http://localhost:10000/api/oauth/youtube/callback` (add prod URL later). Copy ID/secret into `server/.env` as `GOOGLE_*`.
6. **Meta (Facebook + Instagram):** developers.facebook.com → Create App (Business) → add *Facebook Login* → Valid OAuth redirect = `http://localhost:10000/api/oauth/meta/callback`. You need:
   - a Facebook **Page**
   - an Instagram **Business/Creator account linked to that Page** (Page Settings → Linked accounts), otherwise Instagram connection will not appear — this is a Meta requirement, not a bug.
   - Copy App ID/secret into `server/.env` as `META_*`.
   - The login must grant `pages_manage_posts`, `instagram_basic`, and `instagram_content_publish`. After changing these scopes, disconnect and reconnect Meta accounts so the new Instagram publishing permission is included.
   - For Instagram Auto DM, configure the Meta app's Instagram webhook subscription for `comments` and `messages`, point it to `https://<your-api-host>/api/meta/webhook`, set the matching `META_WEBHOOK_VERIFY_TOKEN`, request Meta's comment and messaging permissions/review, and reconnect Instagram accounts. Meta must approve those permissions before real accounts can use the automation.
   - **Allow users outside the app team:** Meta apps in Development mode only allow app roles/testers to connect. To let any Driftpost user connect, switch the Meta app to Live after completing Business Verification and App Review/Advanced Access for the Page and Instagram permissions the app uses (`pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, and `instagram_content_publish`). For Auto DM, also request `instagram_manage_comments` and `instagram_manage_messages`, and include them in the Instagram Login for Business configuration identified by `META_CONFIG_ID`. Code cannot override Meta's app mode, review, or account eligibility.
7. **Secrets:** generate and put in `server/.env`:
   - `TOKEN_ENCRYPTION_KEY`: 32 random bytes, base64. PowerShell: `[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Max 256 }))`
   - `STATE_SIGNING_SECRET`: any long random string.
   - `FRONTEND_URL=http://localhost:5173`, `VITE_API_URL=http://localhost:10000`.
8. **Deploy:** frontend env `VITE_API_URL` = public API URL; backend `FRONTEND_URL` = public site URL; add both prod redirect URIs to Google + Meta consoles.

Without items 1–7 the app opens and auth screen shows, but Connect/Publish will return “not configured” — that is expected until keys exist.

## Deploy (frontend → Vercel, API → Railway)

The API accepts uploads up to 400 MB per file with local temp files, which Vercel serverless can't do
(4.5 MB payload cap) — so: **frontend on Vercel, API on Railway**. The API was moved off Render
because Render's outbound limits were too tight for media publishing.

1. **API → Railway:** create a service from `FamebrosStudio/Driftpost` with root dir `server`
   (Railway uses `server/Dockerfile`; the Docker build installs locked production dependencies
   and starts `npm start`). Set the healthcheck path to `/health`. Fill env vars (same values as
   `server/.env`). Note your URL: `https://driftpost-production.up.railway.app`.
2. **Frontend → Vercel:** vercel.com → Add New Project → import `FamebrosStudio/Driftpost`
   (`vercel.json` is already in the repo). Env vars:
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`
   - `VITE_API_URL=https://driftpost-production.up.railway.app` (Vite bakes this at build time —
     set it **before** deploying, or redeploy after changing it).
   - Set AI_UNLOCK_PASSPHRASE in the Railway API environment to enable AI for the two approved
     Gmail accounts. Keep it in Railway's secret variable settings; do not put it in Vercel or
     commit it to the repository.
     Note your URL: `https://driftpost.vercel.app`.

The schedule worker runs inside the API process and checks due posts every 15 seconds. It needs an always-on API host to publish at the scheduled time; a free host that sleeps while idle can delay a due post until the service wakes.

## After the URLs change (localhost → prod), update these 6 places

1. **Railway env:** `FRONTEND_URL=https://driftpost.vercel.app` (CORS) → restart service.
2. **Google Cloud Console** (OAuth client): add Authorized redirect URI
   `https://driftpost-production.up.railway.app/api/oauth/youtube/callback`;
   set backend `GOOGLE_REDIRECT_URI` to the same → restart API.
3. **Meta App** (Facebook Login → Settings): add Valid OAuth Redirect URI
   `https://driftpost-production.up.railway.app/api/oauth/meta/callback`;
   set backend `META_REDIRECT_URI` to the same → restart API.
   (Business Login configuration uses the same redirect — no separate change.)
4. **X Developer Portal** (auth settings): Callback URI
   `https://driftpost-production.up.railway.app/api/oauth/x/callback`;
   set backend `X_REDIRECT_URI` to the same → restart API.
5. **Supabase** → Auth → URL Configuration: Site URL + Redirect URLs → add
   `https://driftpost.vercel.app`.
6. **Reconnect every account** (Accounts → Disconnect → Connect): OAuth tokens and
   Supabase sessions from localhost do not transfer to prod.

Keep the localhost URIs alongside prod ones during testing — both can coexist.

## Uptime monitoring

See [docs/uptime-monitoring.md](docs/uptime-monitoring.md) for UptimeRobot setup.
Monitor `https://driftpost-production.up.railway.app/health` every five minutes and enable
email alerts for downtime/recovery. The owner must confirm UptimeRobot's
activation email before its monitoring starts. The existing GitHub Actions
check remains a backup; neither monitor guarantees that every publish succeeds.

## Railway API deployment details

Railway is now the live API host. For the exact service setup, required variables
and cutover steps, see [docs/railway-temporary-migration.md](docs/railway-temporary-migration.md).
The frontend stays on Vercel and Supabase remains the persistent
database/auth/media store.

## Osien Stack MCP

Osien Stack connects without asking users for OAuth client IDs, client secrets, API keys, or social passwords. It uses the Driftpost production API by default; set `DRIFTPOST_API_URL` only when self-hosting. The user signs in to Driftpost in a browser and approves Osien, then links social profiles through Driftpost's provider OAuth. Tokens are hashed on Driftpost, and the scoped MCP bearer token is stored in Osien's owner-only config file. Migration `015_mcp_device_authorization.sql` creates the device and access-token tables.

## Instagram and Facebook automatic replies

The Auto DM screen supports Instagram professional accounts and Facebook Pages. Select a platform and account, add comment/public/private reply and incoming-message rules, then save. An empty comment keyword matches any new comment. Facebook ignores comment edits, removals, Page-authored comments and nested comment replies.

Both platforms use the existing connection-keyed automation and event tables (`instagram_automations` and `instagram_automation_events`) for compatibility; no schema migration is required. Each request checks the authenticated owner and connection platform. Webhook signatures and per-action deduplication apply to both platforms.

Meta configuration:
- Instagram object: `comments`, `messages`; Page object: `feed`, `messages`, `messaging_postbacks`, using the API callback `/api/meta/webhook`.
- Instagram comment private replies use the linked Page's `/messages` endpoint with `recipient.comment_id`. Required permissions include `instagram_manage_comments` and `pages_messaging` for Facebook Login.
- Facebook automation needs `pages_manage_metadata`, `pages_manage_engagement`, and `pages_messaging`, in addition to Page discovery/read permissions. Add Messenger to the app use cases and select the permissions in the Business Login configuration. Reconnect to grant new permissions.
- Facebook connect uses `META_FB_CONFIG_ID` when set, otherwise the shared `META_CONFIG_ID`. Without either, it retains legacy Facebook Login. Instagram uses `META_CONFIG_ID`.
- Other business owners need Meta Advanced Access/App Review and any required business/access verification. Publishing the app alone does not approve permissions. Do not represent a role-account test as proof of public onboarding or submit invented review evidence.

Verification on 2026-11-10: the owner confirmed Instagram inbound DM, public comment reply and comment-triggered private reply from live events. Facebook automation requires its own live Page test after subscription and permission setup.
