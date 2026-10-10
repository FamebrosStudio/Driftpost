-- Media must not be anonymously readable. The API issues time-limited signed
-- URLs only when Meta needs to fetch media for a publish operation.
update storage.buckets
set public = false,
    file_size_limit = 419430400,
    allowed_mime_types = array[
      'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/heic', 'image/heif', 'image/bmp',
      'video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v', 'video/mpeg', 'video/3gpp',
      'video/3gpp2', 'video/x-msvideo', 'video/ogg', 'video/x-matroska'
    ]::text[]
where id = 'driftpost-media';

drop policy if exists "public read driftpost-media" on storage.objects;
