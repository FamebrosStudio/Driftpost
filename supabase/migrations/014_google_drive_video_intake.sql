-- Private Google Drive inbox for the Famebros production team.
-- OAuth credentials and intake state are only readable by service_role.
create table if not exists public.google_drive_intake_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  google_email text not null,
  drive_folder_id text not null,
  encrypted_tokens text,
  token_expires_at timestamptz,
  status text not null default 'connected' check (status in ('connected', 'disconnected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.google_drive_video_jobs (
  id uuid primary key default gen_random_uuid(),
  drive_file_id text not null unique,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  drive_folder_id text not null,
  file_name text not null,
  mime_type text not null,
  file_size bigint not null default 0 check (file_size >= 0),
  account_name text not null default '',
  platforms text[] not null default '{}',
  status text not null default 'queued' check (status in ('queued', 'processing', 'publishing', 'completed', 'partial', 'failed')),
  result jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists google_drive_video_jobs_worker_idx
  on public.google_drive_video_jobs (status, created_at);
create index if not exists google_drive_video_jobs_owner_idx
  on public.google_drive_video_jobs (owner_user_id, created_at desc);

alter table public.google_drive_intake_connections enable row level security;
alter table public.google_drive_video_jobs enable row level security;
revoke all on public.google_drive_intake_connections from anon, authenticated;
revoke all on public.google_drive_video_jobs from anon, authenticated;
grant all on public.google_drive_intake_connections to service_role;
grant all on public.google_drive_video_jobs to service_role;

drop trigger if exists update_google_drive_intake_connections_updated_at on public.google_drive_intake_connections;
create trigger update_google_drive_intake_connections_updated_at
  before update on public.google_drive_intake_connections
  for each row execute function public.update_updated_at();
drop trigger if exists update_google_drive_video_jobs_updated_at on public.google_drive_video_jobs;
create trigger update_google_drive_video_jobs_updated_at
  before update on public.google_drive_video_jobs
  for each row execute function public.update_updated_at();
