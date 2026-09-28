# Driftpost Telegram Bot (n8n)

Send a video to `@drift_post_sender_bot`, pick platforms (multi-select), it posts everywhere.

## Flow

1. User sends video, caption first line = brand (e.g. `Hair Match Salon`)
2. No caption brand? Bot asks for it.
3. Bot shows inline keyboard: YouTube / Instagram / Facebook / X (toggle ✅/⬜, many allowed) + 🚀 POST NOW / ❌ Cancel
4. On POST NOW: downloads video → **Grok Vision watches 5 frames** (setting, actions, visible text/offers) → Grok captions (`/api/ai/captions`, brand voice + what the video shows) → matches brand to `platform_connections` → publishes each via `/api/publish` → polls `/api/jobs/:id` → replies ✅/❌ per platform.

## Files

- `workflow.json` — import into n8n (Workflows → Import from file)
- `telegram_sessions.sql` — run once in Supabase SQL Editor (also at `supabase/migrations/008_telegram_sessions.sql`)
- `get-bot-jwt.mjs` — prints the bot user's JWT for n8n variables
- `VARIABLES.example` — n8n variables to set (values stay in n8n, never committed)

## Setup

1. Driftpost backend running (`server/.env` filled, `npm run dev` on :10000). Connect YT/IG/FB/X accounts in the Driftpost UI first.
2. Run `telegram_sessions.sql` in Supabase.
3. Create a Supabase auth user for the bot, then `node get-bot-jwt.mjs` to get `BOT_USER_ID` + `BOT_JWT`.
4. Fill values once in `start-bot.ps1` (names in `VARIABLES.example`), run it
   instead of `n8n start`, attach your Telegram credential to the Trigger node,
   delete duplicate imports, activate the ONE workflow. (n8n Variables need the
   Enterprise plan — this project uses `$env.*`, which works everywhere.)

## Brand data (captions use your DataSet)

The bot does not write captions itself — the `Gen Captions (Grok)` node calls
`POST /api/ai/captions` with the brand name from the Telegram caption, and the
backend injects that brand's full knowledge pack (contact, footer, CTA/hashtag
banks, genre rules, SEO keywords) into Grok. Verified wiring:

- `server/src/brand-memory/brands.full.json` is byte-identical (SHA256) to
  `DataSet/Famebros_Brand_Caption_Dataset.json`.
- `server/src/brand-memory/brands/` now holds all 39 `Specific-brands` deep
  files (synced 8 missing: Pixi Grow, Sarang Hospital, GS Shetty School,
  Seven Cube Footwear, Sarama Furniture, OLVKIIXK, Anand Furniture,
  Uvafashions). `resolveBrand` + `fullPack` verified for each via node.
- Existing server copies of the Kurla/Chembur/Ghatla jewellers, Devi, Asma and
  Roopali files were kept (server versions are newer than the DataSet copies).

Brand matching is loose (threshold 20, typo/handle tolerant), so reply with the
brand name as in Driftpost, e.g. `Hair Match Salon`. Unknown names fall back to
a generic caption and get auto-filed for learning.

## Video understanding (Option B is built in)

Grok sees the video, not just your typed summary: `Save Video File` →
`Extract Frames` (`extract-frames.ps1`, needs the ffmpeg path above, grabs up
to 5 frames at 768px) → `Describe Video (Grok Vision)` transcribes scenes AND
visible text/offers → that description feeds `Gen Captions` as both summary
context and `asset_description`. Requires the extra `XAI_API_KEY` variable
(same key as the backend). If vision ever fails, captions fall back to your
typed summary — posting never blocks on it.

Open item: `31_Asma_Women_Clothing_AI_Knowledge (2).json` renames the brand to
"HerChoice by Asma" — server still uses "Asma Women Clothing". Confirm the
rename before syncing.

## Critical fixes vs the old `workflow-telegram-driftpost.json`

- Old flow used `sb_secret_...` as the Driftpost Bearer token — the API expects a Supabase **user JWT** (`BOT_JWT`), so every call 401'd. Fixed.
- Old flow lost the video between "send video" and "reply 1-4" (no state) and allowed one platform only. State now lives in `telegram_sessions`, selection is multi-toggle.
- OAuth redirect URIs must point at the **backend API** (`.../api/oauth/...`), not the Vercel frontend — fix `GOOGLE_REDIRECT_URI`, `META_REDIRECT_URI`, `X_REDIRECT_URI` in `server/.env`.
