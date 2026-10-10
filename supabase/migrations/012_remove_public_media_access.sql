-- Close legacy anonymous policies from migration 008. The browser now gets
-- short-lived, path-scoped signed upload URLs from the authenticated API;
-- files must never be publicly readable or anonymously insertable.
drop policy if exists "anon upload driftpost-media" on storage.objects;
drop policy if exists "public read driftpost-media" on storage.objects;

update storage.buckets
set public = false
where id = 'driftpost-media';
