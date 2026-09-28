# Fill the values ONCE, then run this instead of `n8n start`.
# (n8n Variables need Enterprise — env vars work on every plan.)
# Your Driftpost API must already run on :10000 in another terminal.
# If you use a cloudflared/ngrok public URL for Telegram, add:
#   $env:WEBHOOK_URL="https://YOUR-URL"

$env:TELEGRAM_BOT_TOKEN = ""
$env:DRIFTPOST_API_URL = "http://localhost:10000"
$env:SUPABASE_URL = ""
$env:SUPABASE_SERVICE_KEY = ""
$env:BOT_USER_ID = ""
$env:BOT_JWT = ""
$env:XAI_API_KEY = ""

foreach ($v in @("TELEGRAM_BOT_TOKEN", "SUPABASE_URL", "SUPABASE_SERVICE_KEY", "BOT_USER_ID", "BOT_JWT", "XAI_API_KEY")) {
  if (-not [System.Environment]::GetEnvironmentVariable($v)) { Write-Warning "$v is empty — edit this script first." }
}

n8n start
