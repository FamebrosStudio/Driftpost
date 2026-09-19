create extension if not exists pgcrypto;

create table if not exists public.platform_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('youtube', 'instagram', 'facebook')),
  platform_account_id text not null,
  account_name text not null,
  avatar_url text,
  encrypted_tokens text not null,
  token_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, platform, platform_account_id)
);

alter table public.platform_connections enable row level security;

drop policy if exists "Users read own connections" on public.platform_connections;
create policy "Users read own connections"
on public.platform_connections for select
to authenticated
using ((select auth.uid()) = user_id);

revoke all on public.platform_connections from anon;
grant select on public.platform_connections to authenticated;
