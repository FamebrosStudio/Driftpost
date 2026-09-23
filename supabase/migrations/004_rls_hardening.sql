-- Security hardening for existing databases where 001/002 already ran.
-- Adds missing INSERT/UPDATE/DELETE RLS policies so the anon/publishable key
-- cannot be abused, and grants stay scoped to the record owner.
-- Safe to run multiple times.

alter table public.platform_connections enable row level security;
alter table public.post_history enable row level security;

drop policy if exists "Users insert own connections" on public.platform_connections;
create policy "Users insert own connections"
on public.platform_connections for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users update own connections" on public.platform_connections;
create policy "Users update own connections"
on public.platform_connections for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users delete own connections" on public.platform_connections;
create policy "Users delete own connections"
on public.platform_connections for delete
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users insert own history" on public.post_history;
create policy "Users insert own history"
on public.post_history for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users update own history" on public.post_history;
create policy "Users update own history"
on public.post_history for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users delete own history" on public.post_history;
create policy "Users delete own history"
on public.post_history for delete
to authenticated
using ((select auth.uid()) = user_id);

revoke all on public.platform_connections from anon;
revoke all on public.post_history from anon;
grant select, insert, update, delete on public.platform_connections to authenticated;
grant select, insert, update, delete on public.post_history to authenticated;

create or replace function public.update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists update_platform_connections_updated_at on public.platform_connections;
create trigger update_platform_connections_updated_at
  before update on public.platform_connections
  for each row
  execute function public.update_updated_at();
