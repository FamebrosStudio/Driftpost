# Driftpost uptime monitoring

UptimeRobot runs outside Driftpost. It can send HTTP requests while the API
is idle or unavailable; a timer inside the API cannot wake a sleeping API.

## Primary monitor: UptimeRobot

- Type: HTTP(s)
- Friendly name: UptimeRobot - Driftpost API
- URL: https://driftpost.onrender.com/health
- Interval: 5 minutes (300 seconds)
- Expected result: HTTP 200 and a JSON body containing `"ok":true`
- Alerts: the owner-selected email; notify on downtime and recovery

Use Render's direct health URL. Monitoring only the Vercel homepage does not
check whether the publishing API is running. Do not add authentication headers
or point the monitor at `/api/publish`: health checks must never create posts.

To request setup without an API key, set `UPTIMEROBOT_EMAIL` to the email the
owner selected and run `node scripts/setup-uptimerobot.mjs` once. Open the
activation email and click Activate on the confirmation page. The API's HTTP
200 submission result does not prove the monitor exists or is active.

Alternatively, create the monitor manually in the UptimeRobot dashboard using
the settings above. Rename the monitor there if the quick setup uses the URL
as its default name.

## Backup: GitHub Actions

`.github/workflows/render-keepalive.yml` checks Render directly every five
minutes and verifies browser CORS preflight. This backup is already enabled.
GitHub schedules can be delayed, so it does not replace a dedicated monitor.
Use GitHub's Actions notification settings to receive failed-run alerts.

## What this does and does not cover

Render Free normally sleeps after 15 minutes without inbound traffic. Regular
health requests help avoid idle sleep. Monitoring also detects HTTP outages,
but cannot prevent platform restarts, memory exhaustion, application errors,
or failures returned by Meta, YouTube, Supabase, or other providers. Render
may restart free services at any time; this setup is not an uptime guarantee.

`/health` reports the deployed revision and process uptime. A falling uptime
indicates a process restart. Publish logs include RSS memory readings at the
start and end of jobs. The health route does not validate account permissions
or prove that a reel can be published.

Official references:

- https://uptimerobot.com/quick-monitor-setup/
- https://help.uptimerobot.com/en/articles/11358364-how-to-create-your-first-monitor-on-uptimerobot-quick-setup-guide
- https://render.com/docs/free
