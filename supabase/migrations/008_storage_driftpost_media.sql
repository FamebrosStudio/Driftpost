-- Allow the website's pre-upload (anon key) to write into driftpost-media,
-- and let anyone read it back (public bucket). Run once in Supabase SQL Editor.
-- Without this, the Stage 3 pre-upload POST fails with 400/403 and every
-- publish falls back to the slower direct upload path.

create policy "anon upload driftpost-media"
on storage.objects for insert to anon
with check (bucket_id = 'driftpost-media');

create policy "public read driftpost-media"
on storage.objects for select to anon, authenticated
using (bucket_id = 'driftpost-media');
