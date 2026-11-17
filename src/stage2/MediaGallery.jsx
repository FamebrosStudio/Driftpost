import React, { useEffect, useMemo } from 'react';
import DriftIcon from '../components/DriftIcons.jsx';

// One media card: preview, name, type, size, music badge, Studio Edit + Delete.
function MediaCard({ entry, index, onRemove, onEdit }) {
  const url = useMemo(() => URL.createObjectURL(entry.raw), [entry]);
  useEffect(() => () => { try { URL.revokeObjectURL(url); } catch {} }, [url]);
  const isVideo = entry.type.startsWith('video/');

  return (
    <div className="s2-media">
      <div className="s2-media-preview-wrap" onClick={() => onEdit(index)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onEdit(index); } }} title="Click to open in Studio Editor">
        <span className="s2-kind">
          <DriftIcon name={isVideo ? 'film' : 'photo'} size={12} /> {isVideo ? 'VIDEO' : 'PHOTO'}
        </span>
        {entry.musicTrack && (
          <span className="s2-music-badge" title={entry.musicTrack.title || entry.musicTrack.name || 'Soundtrack attached'}>
            <DriftIcon name="music" size={12} /> Audio
          </span>
        )}
        {isVideo
          ? <video src={url} preload="metadata" muted playsInline />
          : <img src={url} alt={entry.name} />}
      </div>
      <div className="meta">
        <b title={entry.name}>{entry.name}</b>
        <small>{entry.size}{entry.musicTrack ? ` · ${entry.musicTrack.title || entry.musicTrack.name || 'Soundtrack'}` : ''}</small>
      </div>
      <div className="acts">
        <button type="button" className="s2-edit-btn" onClick={() => onEdit(index)}>
          <DriftIcon name="sparkles" size={13} /> Studio Edit
        </button>
        <button type="button" className="danger" onClick={() => onRemove(index)}>Remove</button>
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
