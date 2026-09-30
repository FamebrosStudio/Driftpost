create table if not exists public.instagram_automations (
  connection_id uuid primary key references public.platform_connections(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  rules jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists instagram_automations_user_id_idx
  on public.instagram_automations(user_id);

alter table public.instagram_automations enable row level security;
revoke all on public.instagram_automations from anon, authenticated;
grant all on public.instagram_automations to service_role;

create table if not exists public.instagram_automation_events (
  event_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid not null references public.platform_connections(id) on delete cascade,
  event_type text not null check (event_type in ('comment', 'message')),
  created_at timestamptz not null default now()
);

create index if not exists instagram_automation_events_created_at_idx
  on public.instagram_automation_events(created_at);

alter table public.instagram_automation_events enable row level security;
revoke all on public.instagram_automation_events from anon, authenticated;
grant all on public.instagram_automation_events to service_role;
