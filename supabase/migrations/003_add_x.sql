alter table public.platform_connections drop constraint if exists platform_connections_platform_check;
alter table public.platform_connections
  add constraint platform_connections_platform_check
  check (platform in ('youtube', 'instagram', 'facebook', 'x'));

alter table public.post_history drop constraint if exists post_history_platform_check;
alter table public.post_history
  add constraint post_history_platform_check
  check (platform in ('youtube', 'instagram', 'facebook', 'x'));
