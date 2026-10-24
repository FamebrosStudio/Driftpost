-- OAuth-style device authorization for trusted local MCP clients.
-- Secrets are stored only as SHA-256 hashes; provider OAuth tokens remain in
-- platform_connections and continue to use the existing encrypted storage.

create table if not exists public.mcp_device_authorizations (
  id uuid primary key default gen_random_uuid(),
  device_code_hash text not null unique,
  user_code text not null unique,
  status text not null default 'pending'
    check (status in ('pending', 'authorized', 'consuming', 'consumed')),
  user_id uuid references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  authorized_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists mcp_device_authorizations_expiry_idx
  on public.mcp_device_authorizations (expires_at);

create table if not exists public.mcp_access_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  label text not null default 'Osien Stack',
  scopes text[] not null default '{}',
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists mcp_access_tokens_user_idx
  on public.mcp_access_tokens (user_id, created_at desc);

alter table public.mcp_device_authorizations enable row level security;
alter table public.mcp_access_tokens enable row level security;
revoke all on public.mcp_device_authorizations from public, anon, authenticated;
revoke all on public.mcp_access_tokens from public, anon, authenticated;
grant all on public.mcp_device_authorizations to service_role;
grant all on public.mcp_access_tokens to service_role;
