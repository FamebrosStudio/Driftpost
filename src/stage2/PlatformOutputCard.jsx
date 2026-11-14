import React, { useState } from 'react';
import BorderGlow from '../components/reactbits/BorderGlow.jsx';
import BrandIcon from '../brand.jsx';

// Per-platform editable fields.
// Instagram has no separate hashtags field: the server keeps hashtags above
// the [keywords] bracket inside the caption itself, so the caption box is the
// single source of truth for what publishes.
const FIELDS = {
  instagram: [
    { k: 'caption', label: 'Caption', ta: true, maxLength: 2200 },
  ],
  facebook: [{ k: 'message', label: 'Post copy', ta: true }],
  youtube: [
    { k: 'title', label: 'Title', ta: false, maxLength: 100 },
    { k: 'description', label: 'Description', ta: true, maxLength: 5000 },
    { k: 'tags', label: 'Tags · comma separated', ta: false },
  ],
  x: [{ k: 'text', label: 'Post', ta: true, maxLength: 280 }],
};
const NAMES = { instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube', x: 'X' };

export function composeOutput(pid, v) {
  if (pid === 'youtube') return [v.title, v.description, v.tags ? `Tags: ${v.tags}` : ''].filter(Boolean).join('\n\n');
  // Instagram caption already ends with footer → hashtags → [keywords] in
  // that order (see server/src/ai.js). Do not append anything below it.
  if (pid === 'instagram') return v.caption || '';
  if (pid === 'facebook') return v.message || '';
  return v.text || '';
}

export default function PlatformOutputCard({ pid, values, onSave, regenning, regenBusy, onRegen }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(values);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const fields = FIELDS[pid] || [];

  const startEdit = () => { setDraft(values); setEditing(true); };
  const saveEdit = () => { onSave(pid, draft); setEditing(false); };
  const copy = async () => {
    setCopyError('');
    try {
      await navigator.clipboard.writeText(composeOutput(pid, editing ? draft : values));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopyError('Clipboard access failed. Select the text and copy it manually.');
    }
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
          {editing ? <label htmlFor={`s2-output-${pid}-${f.k}`}>{f.label}</label> : <span>{f.label}</span>}
          {editing ? (
            f.ta ? (
              <textarea id={`s2-output-${pid}-${f.k}`} value={draft[f.k] || ''} maxLength={f.maxLength} onChange={(e) => setDraft({ ...draft, [f.k]: e.target.value })} />
            ) : (
              <input id={`s2-output-${pid}-${f.k}`} value={draft[f.k] || ''} maxLength={f.maxLength} onChange={(e) => setDraft({ ...draft, [f.k]: e.target.value })} />
            )
          ) : (
            <p>{values[f.k] || '—'}</p>
          )}
        </div>
      ))}
      {pid === 'x' && <div className={xLen > 280 ? 's2-xcount over' : 's2-xcount'}>{xLen}/280{xLen > 280 ? ' — too long' : ''}</div>}
      <div className="s2-out-acts">
        <BorderGlow asChild className="btn-glow" backgroundColor="#071019" borderRadius={0} glowColor="199 95 74" colors={['#7dd3fc', '#4dc3f7', '#a5ddfa']} fillOpacity={0.3} glowRadius={12}><button type="button" onClick={copy}>{copied ? 'Copied ✓' : 'Copy'}</button></BorderGlow>
        {editing ? (
          <BorderGlow asChild className="btn-glow" backgroundColor="#071019" borderRadius={0} glowColor="199 95 74" colors={['#7dd3fc', '#4dc3f7', '#a5ddfa']} fillOpacity={0.3} glowRadius={12}><button type="button" onClick={saveEdit}>Save</button></BorderGlow>
        ) : (
          <BorderGlow asChild className="btn-glow" backgroundColor="#071019" borderRadius={0} glowColor="199 95 74" colors={['#7dd3fc', '#4dc3f7', '#a5ddfa']} fillOpacity={0.3} glowRadius={12}><button type="button" onClick={startEdit}>Edit</button></BorderGlow>
        )}
        {onRegen && <BorderGlow asChild className="btn-glow" backgroundColor="#071019" borderRadius={0} glowColor="199 95 74" colors={['#7dd3fc', '#4dc3f7', '#a5ddfa']} fillOpacity={0.3} glowRadius={12}><button type="button" disabled={regenBusy} title="Fresh AI answer for this card only" onClick={() => onRegen(pid)}>
          {regenning ? '…' : 'Regen'}
        </button></BorderGlow>}
      </div>
      {(copied || copyError) && <small className={`s2-copy-status${copyError ? ' err' : ''}`} role="status">{copyError || 'Copied to clipboard.'}</small>}
    </div>
  );
}
