import React, { useEffect, useState } from 'react';
import BrandIcon from '../brand.jsx';

// Option 3 tool: build a trio — 2+ accounts sharing one post.
// Click to add/remove, or drag accounts into the trio box.
export default function TrioBuilder({ connections, onSave, onClose }) {
  const [name, setName] = useState('');
  const [ids, setIds] = useState([]);
  const [over, setOver] = useState(false);
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const add = (id) => setIds((s) => (s.includes(id) ? s : [...s, id]));
  const remove = (id) => setIds((s) => s.filter((x) => x !== id));
  const ready = name.trim().length > 0 && ids.length >= 2;
  const byId = Object.fromEntries(connections.map((c) => [c.id, c]));

  return (
    <div className="s1-overlay" onClick={onClose}>
      <div className="s1-modal" role="dialog" aria-modal="true" aria-label="Create a trio" onClick={(e) => e.stopPropagation()}>
        <h2>Create a trio</h2>
        <p className="sub">A trio is 2–3 accounts that share the same post. Pick the accounts, name it, save.</p>
        <input className="s1-field" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Trio name — e.g. Salon trio" aria-label="Trio name" />
        <div className="s1-cols">
          <div className="s1-col">
            <h4>Available accounts</h4>
            {!connections.length && <p className="s1-empty">No accounts connected yet.</p>}
            {connections.map((c) => (
              <button
                key={c.id}
                type="button"
                draggable
                onDragStart={(e) => e.dataTransfer.setData('text/plain', c.id)}
                onClick={() => (ids.includes(c.id) ? remove(c.id) : add(c.id))}
                className={ids.includes(c.id) ? 's1-acct in' : 's1-acct'}
                title="Click to add, or drag into the trio"
              >
                <BrandIcon id={c.platform} size={14} />
                <span>{c.account_name}</span>
              </button>
            ))}
          </div>
          <div className="s1-col">
            <h4>Trio · {ids.length} selected</h4>
            <div
              className={over ? 's1-drop over' : 's1-drop'}
              onDragOver={(e) => { e.preventDefault(); setOver(true); }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); const id = e.dataTransfer.getData('text/plain'); if (id && byId[id]) add(id); }}
            >
              {!ids.length && <p className="s1-empty">Click or drop accounts here.</p>}
              {ids.map((id) => (
                <button key={id} type="button" className="s1-acct in" onClick={() => remove(id)} title="Remove from trio">
                  <BrandIcon id={byId[id]?.platform} size={14} />
                  <span>{byId[id]?.account_name || 'Removed account'}</span>
                  <small>✕</small>
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="s1-row">
          <button type="button" className="s1-ghost" style={{ marginTop: 0 }} onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="s1-primary"
            disabled={!ready}
            title={ready ? 'Save trio' : 'Name it and pick at least 2 accounts'}
            onClick={() => onSave({ id: `t${Date.now()}`, name: name.trim().slice(0, 60), accountIds: ids })}
          >
            Save trio
          </button>
        </div>
      </div>
    </div>
  );
}
