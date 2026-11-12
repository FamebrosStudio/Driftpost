create table if not exists public.google_business_connections (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  google_email text not null, encrypted_tokens text not null, token_expires_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(user_id, google_email)
);
create table if not exists public.google_business_locations (
  id uuid primary key default gen_random_uuid(), connection_id uuid not null references public.google_business_connections(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade, account_id text not null, location_id text not null,
  resource_name text not null, location_name text not null, address text not null default '',
  enabled boolean not null default false, rules jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(connection_id, account_id, location_id)
);
create table if not exists public.google_business_review_events (
  event_id text primary key, user_id uuid not null references auth.users(id) on delete cascade,
  location_row_id uuid not null references public.google_business_locations(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists google_business_locations_user_idx on public.google_business_locations(user_id);
create index if not exists google_business_review_events_created_idx on public.google_business_review_events(created_at);
alter table public.google_business_connections enable row level security;
alter table public.google_business_locations enable row level security;
alter table public.google_business_review_events enable row level security;
revoke all on public.google_business_connections, public.google_business_locations, public.google_business_review_events from anon, authenticated;
grant all on public.google_business_connections, public.google_business_locations, public.google_business_review_events to service_role;
