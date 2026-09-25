import React, { useState } from 'react';
import BrandIcon from '../brand.jsx';

// Per-platform editable fields.
const FIELDS = {
  instagram: [
    { k: 'caption', label: 'Caption', ta: true },
    { k: 'hashtags', label: 'Hashtags', ta: false },
  ],
  facebook: [{ k: 'message', label: 'Post copy', ta: true }],
  youtube: [
    { k: 'title', label: 'Title', ta: false },
    { k: 'description', label: 'Description', ta: true },
    { k: 'tags', label: 'Tags · comma separated', ta: false },
  ],
  x: [{ k: 'text', label: 'Post', ta: true }],
};
const NAMES = { instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube', x: 'X' };

function compose(pid, v) {
  if (pid === 'youtube') return [v.title, v.description, v.tags ? `Tags: ${v.tags}` : ''].filter(Boolean).join('\n\n');
  if (pid === 'instagram') return [v.caption, v.hashtags].filter(Boolean).join('\n\n');
  if (pid === 'facebook') return v.message || '';
  return v.text || '';
}

export default function PlatformOutputCard({ pid, values, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(values);
  const [copied, setCopied] = useState(false);
  const fields = FIELDS[pid] || [];

  const startEdit = () => { setDraft(values); setEditing(true); };
  const saveEdit = () => { onSave(pid, draft); setEditing(false); };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(compose(pid, editing ? draft : values));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };
  const xLen = pid === 'x' ? Array.from(((editing ? draft : values).text || '')).length : 0;

  return (
    <div className="s2-out">
      <div className="s2-out-head">
        <BrandIcon id={pid} size={16} />
        <b>{NAMES[pid] || pid}</b>
      </div>
      {fields.map((f) => (
        <div key={f.k} className="s2-field">
          <span>{f.label}</span>
          {editing ? (
            f.ta ? (
              <textarea value={draft[f.k] || ''} maxLength={2200} onChange={(e) => setDraft({ ...draft, [f.k]: e.target.value })} />
            ) : (
              <input value={draft[f.k] || ''} maxLength={500} onChange={(e) => setDraft({ ...draft, [f.k]: e.target.value })} />
            )
          ) : (
            <p>{values[f.k] || '—'}</p>
          )}
        </div>
      ))}
      {pid === 'x' && <div className={xLen > 280 ? 's2-xcount over' : 's2-xcount'}>{xLen}/280{xLen > 280 ? ' — too long' : ''}</div>}
      <div className="s2-out-acts">
        <button type="button" onClick={copy}>{copied ? 'Copied ✓' : 'Copy'}</button>
        {editing ? (
          <button type="button" onClick={saveEdit}>Save</button>
        ) : (
          <button type="button" onClick={startEdit}>Edit</button>
        )}
      </div>
    </div>
  );
}
