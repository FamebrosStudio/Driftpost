// Shared Stage 2/3 media vault (IndexedDB): uploads + YouTube cover
// survive refresh. Same-origin only. Files stored as Blobs.
function open() {
  return new Promise((res, rej) => {
    try {
      const r = indexedDB.open('driftpost-stage2', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('media');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    } catch (e) { rej(e); }
  });
}

export async function readVault(key) {
  try {
    const db = await open();
    const v = await new Promise((res, rej) => {
      const tx = db.transaction('media', 'readonly');
      const rq = tx.objectStore('media').get(key);
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
    db.close();
    return v || null;
  } catch { return null; }
}

export async function writeVault(key, value) {
  try {
    const db = await open();
    await new Promise((res, rej) => {
      const tx = db.transaction('media', 'readwrite');
      tx.objectStore('media').put(value, key);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
    db.close();
  } catch {}
}

export const vaultFiles = (vault) => (vault?.files || [])
  .filter((f) => f.blob instanceof Blob)
  .map((f) => {
    const raw = f.blob instanceof File ? f.blob : new File([f.blob], f.name || 'media', { type: f.type || 'image/jpeg' });
    return { raw, name: f.name || raw.name, size: `${(raw.size / 1024 / 1024).toFixed(1)} MB`, type: raw.type };
  });
