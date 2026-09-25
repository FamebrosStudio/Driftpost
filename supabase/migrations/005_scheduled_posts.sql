-- Scheduled posts: content queued by the user to publish automatically.
-- Media lives in Supabase Storage (path recorded per file) so the worker can
-- re-assemble the upload at fire time without the browser being involved.
create table if not exists public.scheduled_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('youtube', 'instagram', 'facebook', 'x')),
  connection_id uuid not null,
  scheduled_at timestamptz not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'publishing', 'published', 'failed', 'cancelled')),
  body jsonb not null default '{}'::jsonb,
  media jsonb not null default '[]'::jsonb,
  thumb_path text,
  result_url text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.scheduled_posts enable row level security;

drop policy if exists "Users read own schedules" on public.scheduled_posts;
create policy "Users read own schedules"
on public.scheduled_posts for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users insert own schedules" on public.scheduled_posts;
create policy "Users insert own schedules"
on public.scheduled_posts for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users update own schedules" on public.scheduled_posts;
create policy "Users update own schedules"
on public.scheduled_posts for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users delete own schedules" on public.scheduled_posts;
create policy "Users delete own schedules"
on public.scheduled_posts for delete
to authenticated
using ((select auth.uid()) = user_id);

revoke all on public.scheduled_posts from anon;
grant select, insert, update, delete on public.scheduled_posts to authenticated;

-- The worker scans for due rows; keep that lookup cheap.
create index if not exists scheduled_posts_due_idx
  on public.scheduled_posts (status, scheduled_at);
