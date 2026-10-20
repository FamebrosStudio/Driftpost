---
name: driftpost
description: Use Driftpost MCP to create, review, schedule and publish social video posts to connected YouTube, Instagram, Facebook and X accounts.
---

# Driftpost publishing workflow

Use the `driftpost` MCP tools; do not call the API directly or bypass its account and media validation.

## Mandatory workflow

1. Call `driftpost_health` to verify the API is reachable.
2. Call `driftpost_list_accounts`; choose the exact connected account and platform. Never guess or substitute an account ID.
3. Ask what the post should say if the user hasn't provided a brief. `driftpost_generate_captions` is review-only and never publishes. Show generated copy and let the user edit it.
4. Call `driftpost_prepare_video_post` with the exact platform, connection ID, absolute local video path, reviewed caption, and YouTube title if applicable. This only creates a local preview; it does not upload or publish.
5. Show the preview, account, platform, filename, size, caption/title, and scheduled time. **Wait for explicit user approval before publishing.**
6. Only after approval, call `driftpost_publish_confirmed_video` using the preview ID and exact approval phrase `PUBLISH THIS VIDEO`.
7. For an immediate post, call `driftpost_wait_for_publish` with the returned job ID. Report the final status and provider URL/error. For a scheduled post, report its returned schedule ID/time.

## Guardrails

- Never publish, schedule, change a caption, or choose a different account without the user's approval.
- A preview expires after 10 minutes. If it expires or the file changes, prepare a new preview.
- Videos must be local files no larger than 400 MB. The Driftpost server enforces format/platform limits too.
- Do not include passwords, OAuth credentials, refresh tokens, API keys, or private user data in a caption.
- Do not claim a post succeeded until `wait_for_publish` reports `completed` and provides its result.
- If the MCP reports missing authentication, ask the user to complete the local setup in `mcp-server/DRIFTPOST.md`. Never ask them to paste tokens into chat.
