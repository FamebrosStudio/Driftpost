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

// Apply a read/modify/write in one IndexedDB readwrite transaction. Separate
// Stage 2 media and Stage 3 cover saves must not overwrite one another's
// changes when they happen close together.
export async function updateVault(key, update) {
  let db;
  try {
    db = await open();
    await new Promise((res, rej) => {
      const tx = db.transaction('media', 'readwrite');
      const store = tx.objectStore('media');
      const rq = store.get(key);
      rq.onsuccess = () => {
        try { store.put(update(rq.result || null), key); }
        catch (error) { tx.abort(); rej(error); }
      };
      rq.onerror = () => rej(rq.error);
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error || new Error('Media save was interrupted.'));
    });
  } catch {} finally { db?.close(); }
}

export const vaultFiles = (vault) => (vault?.files || [])
  .filter((f) => f.blob instanceof Blob)
  .map((f) => {
    const raw = f.blob instanceof File ? f.blob : new File([f.blob], f.name || 'media', { type: f.type || 'image/jpeg' });
    const musicOriginalRaw = f.musicOriginalRaw instanceof Blob
      ? (f.musicOriginalRaw instanceof File ? f.musicOriginalRaw : new File([f.musicOriginalRaw], `${String(f.name || raw.name).replace(/\.[^.]+$/, '')}-original${raw.name.match(/\.[^.]+$/)?.[0] || ''}`, { type: f.musicOriginalRaw.type || raw.type }))
      : null;
    return { raw, musicOriginalRaw, musicTrack: f.musicTrack || null, name: f.name || raw.name, size: `${(raw.size / 1024 / 1024).toFixed(1)} MB`, type: raw.type };
  });
