# Driftpost MCP integration for Osien-Stack

This folder adds a **local stdio MCP** that lets an AI client in Osien-Stack use the signed-in user's Driftpost accounts. It calls the live Driftpost API; it does not contain API keys, refresh tokens, or service-role credentials.

## What it provides

- `driftpost_health` — check API health/revision
- `driftpost_list_accounts` — list connected accounts
- `driftpost_generate_captions` — create drafts only
- `driftpost_prepare_video_post` — validate a video and show a preview; does not upload or publish
- `driftpost_publish_confirmed_video` — publish/schedule only after the approval phrase is supplied
- `driftpost_wait_for_publish` — return the final publish status

The `driftpost` skill defines a preview → user approval → publish workflow. Nothing is posted by the caption or preview tools.

## Add to Osien-Stack

1. Copy this bundle's `mcp-server/driftpost-server.js` and `mcp-server/test/driftpost.js` into the matching paths in the target repo.
2. Copy `skills/driftpost/SKILL.md` into the target repo's `skills/driftpost/SKILL.md`.
3. Install the skill using that repo's normal installer. For OpenCode, copy `skills/driftpost/` to `%USERPROFILE%\.config\opencode\skills\driftpost\` (or copy all `skills/*` as `AI_INSTALL.md` describes).
4. Install dependencies in this bundle with `npm install`, or use the existing `mcp-server` package if it already depends on `@modelcontextprotocol/sdk` and `zod`.
5. Merge `config/opencode.mcp.jsonc` into the target repo's `.opencode/opencode.json` under `mcp.servers`. Preserve any existing MCP entries and replace the absolute `command` path with the target repo's path.
6. Run `opencode mcp list` from the target repo; `driftpost` should show connected. Restart OpenCode if it was already open.

## One-time authentication (Windows)

1. Sign in to `https://driftpost.vercel.app`.
2. In browser DevTools → Application → Local Storage, find `sb-<project-ref>-auth-token`. Copy its `refresh_token` locally. Never send it to an AI, paste it into chat, or commit it.
3. Create `%USERPROFILE%\.config\opencode\secrets\driftpost-session.json`:

   ```json
   { "refresh_token": "YOUR_REFRESH_TOKEN" }
   ```

   The MCP rotates and saves the refresh token with owner-only file permissions. Keep this file private.
4. Set user environment variables `DRIFTPOST_SUPABASE_URL` and `DRIFTPOST_SUPABASE_PUBLISHABLE_KEY` to the matching Driftpost Supabase project values. The publishable key is not a service-role key. Restart OpenCode so it inherits the variables.
5. For Driftpost's restricted internal AI accounts only, optionally set `DRIFTPOST_AI_UNLOCK_PASSPHRASE` as a local environment variable. Do not put it in the MCP config or source control.

The API URL defaults to `https://driftpost-production.up.railway.app`. Override with `DRIFTPOST_API_URL` if using another Driftpost environment.

## Verify

From this bundle folder:

```powershell
npm install
npm test
```

The smoke test only lists tools and calls the public health endpoint. It does not publish. A real signed-in session is required for accounts, caption generation, preview, and publishing.
