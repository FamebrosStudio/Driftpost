# Telegram → Driftpost Automation Setup Guide

## Overview
This workflow receives videos via Telegram bot, generates AI captions using Grok/xAI, and publishes to YouTube/Instagram/Facebook/X via Driftpost API.

## Prerequisites

1. **Driftpost backend running**: `npx n8n start --tunnel -o`
2. **Supabase project** with platform_connections table
3. **xAI API key** (Grok)
4. **Telegram bot token** from @BotFather
5. **n8n** installed and running via tunnel

## Step 1: Get Supabase Credentials

1. Go to https://supabase.com → create project
2. Get:
   - `VITE_SUPABASE_URL` = `SUPABASE_URL`
   - `SUPABASE_SECRET_KEY` (server-only)
3. Run SQL migrations from `C:\Users\faiza\Driftpost\server\supabase\migrations\`
4. Create bucket `driftpost-media` (public)

## Step 2: Configure Driftpost Server

Edit `C:\Users\faiza\Driftpost\server\.env`:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=sb_secret_your_key
TOKEN_ENCRYPTION_KEY=your_base64_32byte_key
STATE_SIGNING_SECRET=your_random_string
XAI_API_KEY=your_xai_api_key_here
XAI_MODEL=grok-4
MEDIA_BUCKET=driftpost-media
PORT=10000
FRONTEND_URL=http://localhost:5173
```

Get `TOKEN_ENCRYPTION_KEY`:
```powershell
powershell -Command "[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Max 256 }))"
```

Then start Driftpost:
```powershell
cd C:\Users\faiza\Driftpost\server
npm install
npm run dev
```

## Step 3: Get Telegram Bot Token

1. Message @BotFather on Telegram
2. `/newbot` → follow instructions
3. Copy the token
4. In n8n, create credential: **Telegram API** → paste token

## Step 4: Set Up n8n Credentials

In n8n UI (opened via tunnel URL):

### Credential 1: Telegram
- **Type**: Telegram API
- **Token**: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz` (from BotFather)
- **Name**: `Telegram Bot Credential`

### Credential 2: HTTP Header Auth (for Driftpost)
- **Type**: HTTP Header Auth
- **Name**: `Driftpost Auth`
- **Header Name**: `Authorization`
- **Header Value**: `Bearer YOUR_SUPABASE_JWT_TOKEN`

To get a Supabase JWT token:
```powershell
# Use Supabase CLI or get from browser after signing in
# Or generate manually:
```

Actually, the simplest approach: use the Supabase Service Role key directly (it bypasses auth):
- **Header Value**: `Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRvc2lja2V0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczNTY4NjQwMCwiZXhwIjoyMDQ5OTk5OTk5fQ.YOUR_SIGNING_KEY`

**WARNING**: Service role key gives full access. Never expose publicly.

## Step 5: Import the Workflow

1. Open n8n via tunnel URL
2. Go to **Workflows** → **Import**
3. Paste the JSON from `workflow-telegram-driftpost.json`
4. Update credential references in each node

## Step 6: Configure the Workflow

### In the workflow JSON, update these values:

**Telegram Trigger node** (`telegram-trigger`):
- Change credential `id` to your actual Telegram credential ID

**HTTP Request nodes** that call `http://localhost:10000`:
- If running n8n on same machine: keep as-is
- If n8n is separate: change to your Driftpost server URL

**Supabase Token** (in `supabaseToken` fields):
- Replace `{{ $json.supabaseToken }}` with your actual Supabase service role key or JWT

**Connection IDs** (in `parse-platform` Code node):
- After setting up platform connections in Driftpost, get the connection IDs from `GET /api/connections`
- Replace `YOUTUBE_CONNECTION_ID`, `INSTAGRAM_CONNECTION_ID`, etc.

## Step 7: Connect Platforms

In Driftpost UI or API:
1. Go to **Connections** → connect YouTube, Instagram, Facebook, X
2. Each connection gets an ID
3. Update the `connections` mapping in the `Parse Platform Choice` Code node

## Step 8: Test

1. Start n8n with tunnel: `npx n8n start --tunnel -o`
2. Open the tunnel URL in browser
3. Execute the workflow
4. Send a video to your Telegram bot
5. Reply with platform number (1-4)
6. Watch it generate caption and publish

## Quick Fix: Simplified Single-Platform Version

If the full flow is too complex, use this simplified workflow:

1. **Telegram Trigger** (video) → downloads video
2. **Code node**: hardcode platform + brand + caption
3. **HTTP Request** → POST to `http://localhost:10000/api/publish`
4. **Telegram**: send success message

## Brand Data

Brand dataset location: `C:\Users\faiza\Driftpost\server\src\brand-memory\brands.compact.json`
- Contains 41 brands with tone, CTA, footer, keywords
- Each brand has: name, tone, cta, footer, kw, ig handle

## Driftpost API Endpoints Used

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/ai/captions` | POST | Generate captions per brand/platform |
| `/api/publish` | POST | Publish to platform (multipart/form-data) |
| `/api/ai/brands` | GET | List all brands |
| `/api/connections` | GET | List connected platform accounts |

## Troubleshooting

- **"AI is not configured"**: Set `XAI_API_KEY` in Driftpost `.env`
- **"Sign in required"**: Use correct Supabase token
- **"Connection not found"**: Connect platforms in Driftpost first
- **Video too large**: Max 400MB video, 10MB image
- **Tunnel not working**: Ensure `npx n8n start --tunnel` is running
