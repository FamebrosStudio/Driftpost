export async function listStorageFiles(storage, prefix) {
  const files = [];
  const walk = async (folder) => {
    let offset = 0;
    for (;;) {
      const { data, error } = await storage.list(folder, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } });
      if (error) throw error;
      const entries = data || [];
      for (const entry of entries) {
        const name = String(entry?.name || '');
        if (!name || name.includes('/') || name === '.' || name === '..') continue;
        const key = `${folder}/${name}`;
        if (entry.id || entry.metadata) files.push(key);
        else await walk(key);
      }
      if (entries.length < 1000) break;
      offset += entries.length;
    }
  };
  await walk(prefix);
  return files;
}

export async function eraseUserMedia(storage, userId) {
  const files = [...new Set([
    ...await listStorageFiles(storage, userId),
    ...await listStorageFiles(storage, `scheduled/${userId}`),
  ])];
  for (let offset = 0; offset < files.length; offset += 100) {
    const { error } = await storage.remove(files.slice(offset, offset + 100));
    if (error) throw error;
  }
}
