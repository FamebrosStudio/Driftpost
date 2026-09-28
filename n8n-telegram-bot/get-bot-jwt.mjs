// Prints BOT_USER_ID + BOT_JWT for the n8n variables.
// Reads everything from environment — no secrets in this file.
// Usage:
//   $env:SUPABASE_URL="https://xyz.supabase.co"
//   $env:BOT_EMAIL="bot@example.com"
//   $env:BOT_PASSWORD="...long-random..."
//   node get-bot-jwt.mjs
const url = process.env.SUPABASE_URL;
const email = process.env.BOT_EMAIL;
const password = process.env.BOT_PASSWORD;
if (!url || !email || !password) {
  console.error('Set SUPABASE_URL, BOT_EMAIL, BOT_PASSWORD env vars first.');
  process.exit(1);
}
const anonKey = process.env.SUPABASE_ANON_KEY;
if (!anonKey) {
  console.error('Set SUPABASE_ANON_KEY too (Supabase → Settings → API → anon public key).');
  process.exit(1);
}
const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: anonKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
const data = await res.json();
if (!res.ok) {
  console.error('Login failed:', data.error_description || data.msg || JSON.stringify(data));
  process.exit(1);
}
console.log('BOT_USER_ID=' + data.user.id);
console.log('BOT_JWT=' + data.access_token);
console.log('(BOT_JWT expires ~1h — re-run to refresh, or use a service-side refresh.)');
