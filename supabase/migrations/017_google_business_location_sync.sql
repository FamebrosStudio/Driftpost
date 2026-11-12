alter table public.google_business_connections
  add column if not exists location_sync_error text,
  add column if not exists locations_synced_at timestamptz,
  add column if not exists locations_count integer not null default 0;
