export const SIGNED_MEDIA_TTL_SECONDS = 6 * 60 * 60;

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';

export function isOwnedMediaPath(userId, value) {
  const id = String(userId || '').toLowerCase();
  const objectPath = String(value || '');
  if (!new RegExp(`^${UUID}$`, 'i').test(id)) return false;
  const safeFilename = '[A-Za-z0-9][A-Za-z0-9._-]{0,119}';
  return new RegExp(`^(?:${id}/${UUID}\\.[A-Za-z0-9]{1,8}|scheduled/${id}/${UUID}/${safeFilename})$`, 'i').test(objectPath);
}

export async function createTemporaryMediaUrl(storage, objectPath, expiresIn = SIGNED_MEDIA_TTL_SECONDS) {
  const { data, error } = await storage.createSignedUrl(objectPath, expiresIn);
  if (error || !data?.signedUrl) throw new Error('Could not create a temporary media link. Please re-upload the media and try again.');
  return data.signedUrl;
}
