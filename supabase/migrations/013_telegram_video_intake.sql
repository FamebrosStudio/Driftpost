-- Private bot intake queue. Only the backend service_role may access it.
create table if not exists public.telegram_video_jobs (
  id uuid primary key default gen_random_uuid(),
  update_id text not null unique,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  chat_id text not null,
  sender_id text not null,
  message_id text not null,
  telegram_file_id text not null,
  file_name text not null,
  mime_type text not null,
  file_size bigint not null default 0 check (file_size >= 0),
  account_name text not null default '',
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'publishing', 'completed', 'partial', 'failed')),
  result jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists telegram_video_jobs_worker_idx
  on public.telegram_video_jobs (status, created_at);

alter table public.telegram_video_jobs enable row level security;
revoke all on public.telegram_video_jobs from anon, authenticated;
grant all on public.telegram_video_jobs to service_role;

drop trigger if exists update_telegram_video_jobs_updated_at on public.telegram_video_jobs;
create trigger update_telegram_video_jobs_updated_at
  before update on public.telegram_video_jobs
  for each row execute function public.update_updated_at();
