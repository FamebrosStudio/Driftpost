-- Tighten storage writes now that the browser uses server-issued signed upload
-- URLs, and address the current Supabase database linter findings.
drop policy if exists "anon upload driftpost-media" on storage.objects;

create index if not exists post_history_user_id_idx
  on public.post_history (user_id);

create index if not exists scheduled_posts_user_id_idx
  on public.scheduled_posts (user_id);

create index if not exists instagram_automation_events_user_id_idx
  on public.instagram_automation_events (user_id);

create index if not exists instagram_automation_events_connection_id_idx
  on public.instagram_automation_events (connection_id);

-- update_updated_at only calls pg_catalog.now(); pinning search_path prevents
-- an object in another schema from shadowing functions it may use.
alter function public.update_updated_at() set search_path = pg_catalog;
