export const AI_ACCESS_HEADER = 'X-Driftpost-AI-Grant';

const AI_EMAILS = new Set([
  'famebros.studio@gmail.com',
  'kabirsayed.k@gmail.com',
]);

export function isAiAccount(email) {
  return AI_EMAILS.has(String(email || '').trim().toLowerCase());
}

export function aiGrantStorageKey(userId) {
  return `driftpost:ai-device-grant:${userId}`;
}

export function readAiGrant(userId) {
  if (!userId) return '';
  try { return localStorage.getItem(aiGrantStorageKey(userId)) || ''; }
  catch { return ''; }
}

export function saveAiGrant(userId, grant) {
  if (!userId || !grant) return false;
  try {
    localStorage.setItem(aiGrantStorageKey(userId), grant);
    return true;
  } catch { return false; }
}

export function clearAiGrant(userId) {
  if (!userId) return;
  try { localStorage.removeItem(aiGrantStorageKey(userId)); } catch {}
}

export function hasAiAccess(session) {
  return isAiAccount(session?.user?.email) && !!readAiGrant(session?.user?.id);
}

export function readAiGrantForAccessToken(token) {
  try {
    const part = String(token || '').split('.')[1];
    if (!part) return '';
    const payload = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    return readAiGrant(payload.sub);
  } catch { return ''; }
}
