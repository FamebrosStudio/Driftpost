-- 008_telegram_sessions.sql
-- State for the Telegram -> n8n -> Driftpost bot.
-- One row per Telegram chat. n8n upserts on video, toggles platforms via
-- inline keyboard callbacks, and deletes on done/cancel.
-- Run in Supabase SQL Editor.

create table if not exists public.telegram_sessions (
  chat_id bigint primary key,
  file_id text not null,
  file_unique_id text,
  brand text not null default '',
  summary text not null default '',
  selected text[] not null default '{}',
  status text not null default 'awaiting_platform',
  message_id bigint,
  updated_at timestamptz not null default now()
);

alter table public.telegram_sessions enable row level security;

-- n8n uses the SERVICE (secret) key which bypasses RLS, so no policies are
-- needed for the bot. Explicitly block anon/authenticated direct access.
drop policy if exists "no direct access" on public.telegram_sessions;
create policy "no direct access" on public.telegram_sessions
  for all using (false) with check (false);
