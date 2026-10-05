# Temporary Railway API deployment

This project keeps the frontend on Vercel and deploys only the Node API from
`server/`. Supabase remains the database/auth/media store; do not add a Railway
database or media volume for this temporary move.

## Railway service setup

1. Create a new Railway project/environment for the temporary migration and
   deploy the GitHub repository `FamebrosStudio/Driftpost` as a service.
2. Set the service root directory to `/server`. Railway will use
   `server/Dockerfile`; the Docker build installs the locked production
   dependencies and starts `npm start` as the unprivileged `node` user.
3. Generate a public Railway domain. Set the deployment healthcheck path to
   `/health`. The API already listens on Railway's injected `PORT` and binds
   `0.0.0.0`.
4. Add the backend variables listed below in Railway's Variables tab. Do not
   upload `.env` files or commit secrets.
5. Deploy, then verify `https://<railway-domain>/health` returns HTTP 200 before
   changing the frontend or OAuth settings.

## Backend variables

Required for the API to start:

- `FRONTEND_URL` — `https://driftpostpage.vercel.app` (comma-separated origins
  may be used when additional frontend origins are needed)
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `TOKEN_ENCRYPTION_KEY` — copy the exact existing production value; changing
  it makes already stored social OAuth tokens unreadable
- `STATE_SIGNING_SECRET` — copy the existing value so in-flight OAuth state
  remains valid

Add the existing values for the integrations Driftpost uses:

- Google/YouTube: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
  `GOOGLE_REDIRECT_URI`
- Meta: `META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI`,
  `META_WEBHOOK_VERIFY_TOKEN`, `META_CONFIG_ID`, `META_FB_SCOPES`
- X: `X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_REDIRECT_URI`
- AI/music, if enabled: `XAI_API_KEY`, `XAI_MODEL`,
  `AI_UNLOCK_PASSPHRASE`, `EPIDEMIC_SOUND_API_KEY`
- `MEDIA_BUCKET` — use the existing bucket name (normally `driftpost-media`)

Do not manually set `PORT`; Railway supplies it. Do not paste placeholder values
from `.env.example` into production.

## URLs and cutover

After Railway provides the actual domain, set:

- Railway `GOOGLE_REDIRECT_URI` to
  `https://<railway-domain>/api/oauth/youtube/callback`
- Railway `META_REDIRECT_URI` to
  `https://<railway-domain>/api/oauth/meta/callback`
- Railway `X_REDIRECT_URI` to
  `https://<railway-domain>/api/oauth/x/callback`
- Railway `FRONTEND_URL` to the production Vercel origin
- Vercel `VITE_API_URL` to `https://<railway-domain>`, then redeploy Vercel

Add each new callback URL to the matching Google, Meta, and X developer-console
allowlists before reconnecting accounts. If Meta webhooks are enabled, update
their callback URL to `https://<railway-domain>/api/meta/webhook` as well.

Keep the existing Render service and Vercel API setting until the Railway health
check, login, media upload, and a low-risk test post all succeed. Then switch the
frontend API URL. This is a temporary parallel deployment, not an automatic
transfer of accounts or queued jobs.

## Runtime notes

- Persistent media and scheduled-post records stay in Supabase. Upload temp
  files live under the container's temporary directory and are cleaned after
  requests/jobs; they are not durable across restarts or deployments.
- The due-schedule poller runs inside the API process every 15 seconds. Keep the
  API service running continuously and start with one replica during the trial.
- Railway service storage and outbound traffic are plan-metered. Large concurrent
  multipart uploads can consume ephemeral disk, so monitor usage and avoid
  launching a full 50-video batch during the initial smoke test.
- No Railway project, domain, variables, or deployment is created by these files;
  the service still needs to be connected and configured in Railway.
