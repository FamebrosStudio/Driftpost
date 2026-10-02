export function buildScheduleForm({ platform, connectionId, when, body, files = [], instagramFiles = [], facebookFiles = [], thumb = null, instagramCover = null, facebookCover = null, repeatEveryDays = 0, repeatRemaining = 0 }) {
  const form = new FormData();
  for (const [key, value] of Object.entries(body || {})) form.set(key, value == null ? '' : String(value));
  // These explicit selections take precedence over the shared publishing body.
  // append() here would turn duplicate fields into arrays in multer.
  form.set('platform', platform);
  form.set('connection_id', connectionId || '');
  form.set('scheduled_at', when);
  form.set('repeat_every_days', String(repeatEveryDays || 0));
  form.set('repeat_remaining', String(repeatRemaining || 0));
  for (const [field, entries] of [['media', files], ['instagram_media', instagramFiles], ['facebook_media', facebookFiles]]) {
    for (const file of entries) if (file?.raw) form.append(field, file.raw, file.name);
  }
  for (const [field, file] of [['thumbnail', thumb], ['cover_instagram', instagramCover], ['cover_facebook', facebookCover]]) {
    if (file?.raw) form.append(field, file.raw, file.name);
  }
  return form;
}
