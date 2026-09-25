// Small local logs for the History page. Same-origin localStorage only.
function read(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? fallback;
  } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

// Disconnected accounts (swipe-to-disconnect). Reconnect happens via OAuth.
export const readDisconnectLog = () => read('driftpost-disconnect-log', []);
export function logDisconnect({ account_name, platform }) {
  const list = [{ account_name, platform, at: Date.now() }, ...readDisconnectLog()].slice(0, 50);
  write('driftpost-disconnect-log', list);
}
export function removeDisconnectLog(at) {
  write('driftpost-disconnect-log', readDisconnectLog().filter((e) => e.at !== at));
}

// Generated captions worth keeping.
export const readCaptionLog = () => read('driftpost-caption-log', []);
export function logCaptions({ brand, entries }) {
  const now = Date.now();
  const fresh = (entries || [])
    .filter((e) => e && e.text && String(e.text).trim())
    .map((e, i) => ({ platform: e.platform, text: String(e.text).trim(), brand: brand || '', at: now - i }));
  if (!fresh.length) return;
  write('driftpost-caption-log', [...fresh, ...readCaptionLog()].slice(0, 50));
}

// Posted things. Stage 3 writes entries {at, platform, text, url};
// delete works locally here, edit/repost arrive with Stage 3.
export const readPostLog = () => read('driftpost-post-log', []);
export function logPost({ platform, text, url }) {
  const list = [{ platform, text: String(text || '').slice(0, 140), url: url || '', at: Date.now() }, ...readPostLog()].slice(0, 50);
  write('driftpost-post-log', list);
}
export function removePostLog(at) {
  write('driftpost-post-log', readPostLog().filter((e) => e.at !== at));
}
