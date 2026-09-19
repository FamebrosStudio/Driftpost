create table if not exists public.post_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('youtube', 'instagram', 'facebook')),
  status text not null default 'published',
  url text,
  caption text,
  created_at timestamptz not null default now()
);

alter table public.post_history enable row level security;

drop policy if exists "Users read own history" on public.post_history;
create policy "Users read own history"
on public.post_history for select
to authenticated
using ((select auth.uid()) = user_id);

revoke all on public.post_history from anon;
grant select on public.post_history to authenticated;
