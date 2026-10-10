# Telegram video intake

Editors send videos to a private Telegram bot, not to the Driftpost website. The video message caption must identify the destination using the exact connected account name:

```text
Account: Famebros Studio
```

Driftpost accepts the upload, matches the name to a saved brand and an exact connected account, extracts frames, transcribes speech, writes platform captions from the saved brand profile, chooses platform covers, and queues the posts through the existing publishing worker. The bot replies when processing starts and when each destination finishes. If the match is ambiguous or a destination fails, the bot reports that instead of silently choosing a different account.

## Required configuration

1. Create a bot with Telegram `@BotFather` and set its token as `TELEGRAM_BOT_TOKEN` in the backend environment.
2. Set `TELEGRAM_WEBHOOK_SECRET` to a random value of 32 or more characters and set `TELEGRAM_WEBHOOK_URL` to `https://<Driftpost API host>/api/intake/telegram/webhook`. The backend registers the webhook on startup.
3. Set `TELEGRAM_ALLOWED_CHAT_IDS` and `TELEGRAM_ALLOWED_USER_IDS` to comma-separated numeric IDs. Both the chat and sender must be allowlisted. For a private bot chat, the chat ID and sender ID are normally the editor's user ID. Never leave these empty in production.
4. Set `TELEGRAM_DRIFTPOST_USER_ID` to the confirmed Supabase user ID that owns the publishing accounts. That user must be one of the approved Famebros accounts and must have the destination accounts connected in Driftpost.
5. Apply `supabase/migrations/013_telegram_video_intake.sql` to the production Supabase project.
6. Ensure the backend container includes `ffmpeg` and `ffprobe`; the supplied server Dockerfile installs them.

## Large videos

Telegram's hosted Bot API only permits bots to download files up to 20 MB. Driftpost's intake supports up to 400 MB, so production must use a self-hosted Telegram Bot API server in local mode and set `TELEGRAM_BOT_API_URL` to its private API URL. Telegram requires an API ID and API hash from [my.telegram.org](https://my.telegram.org). Follow the official [local Bot API server instructions](https://core.telegram.org/bots/api#using-a-local-bot-api-server), including logging the bot out of the hosted Bot API once before switching it to the local server. Keep that server private to the backend network.

If the hosted Telegram Bot API is used instead, messages over 20 MB will fail to download even though the Driftpost worker limit is 400 MB.

## Delivery behavior

- Editors send one video as a Telegram video or video document and include `Account: <connected account name>` in the message caption.
- Exact matching account names on multiple platforms publish to each matching connected destination. An ambiguous brand/account match is rejected.
- Captions and covers are generated automatically. Successful drafts are inserted into Driftpost's durable scheduled-post queue for immediate publishing.
- The bot reports per-platform success/failure in the Telegram chat. Failed analysis jobs are retained in `telegram_video_jobs` for diagnosis; the editor can resend after the issue is corrected.
- This is an automatic publishing path. Editors must send only approved, final media and identify the correct destination account.
