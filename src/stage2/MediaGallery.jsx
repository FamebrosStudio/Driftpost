import React, { useEffect, useMemo } from 'react';

// One media card: preview, name, type, size, edit (images) + delete.
function MediaCard({ entry, index, onRemove, onEdit }) {
  const url = useMemo(() => URL.createObjectURL(entry.raw), [entry]);
  useEffect(() => () => { try { URL.revokeObjectURL(url); } catch {} }, [url]);
  const isVideo = entry.type.startsWith('video/');

  return (
    <div className="s2-media">
      <span className="s2-kind">{isVideo ? 'VIDEO' : 'IMAGE'}</span>
      {isVideo
        ? <video src={url} preload="metadata" muted playsInline />
        : <img src={url} alt={entry.name} />}
      <div className="meta">
        <b title={entry.name}>{entry.name}</b>
        <small>{entry.size}</small>
      </div>
      <div className="acts">
        <button type="button" onClick={() => onEdit(index)}>Edit</button>
        <button type="button" className="danger" onClick={() => onRemove(index)}>Delete</button>
      </div>
    </div>
  );
}

export default function MediaGallery({ files, onRemove, onEdit }) {
  if (!files.length) return null;
  return (
    <div className="s2-grid">
      {files.map((f, i) => (
        <MediaCard key={`${f.name}-${i}`} entry={f} index={i} onRemove={onRemove} onEdit={onEdit} />
      ))}
    </div>
  );
}
