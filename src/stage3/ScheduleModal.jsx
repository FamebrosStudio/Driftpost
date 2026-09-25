import React, { useEffect, useMemo, useState } from 'react';

// Pick when to publish. Validates a real future time before it can fire.
function defaultWhen() {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setSeconds(0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function ScheduleModal({ platforms, accountFor, busy, onClose, onSchedule, platform }) {
  const [when, setWhen] = useState(defaultWhen);
  const [sel, setSel] = useState(platforms[0] || '');
  const [err, setErr] = useState('');

  const quick = useMemo(() => {
    const mk = (mins, label) => {
      const d = new Date(Date.now() + mins * 60000);
      const pad = (n) => String(n).padStart(2, '0');
      return { label, value: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}` };
    };
    return [mk(60, '1 hour'), mk(60 * 24, 'Tomorrow'), mk(60 * 24 * 7, 'Next week')];
  }, []);

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const submit = () => {
    const t = Date.parse(when);
    if (!Number.isFinite(t)) return setErr('Pick a valid date and time.');
    if (t < Date.now() + 60 * 1000) return setErr('Choose a time at least 1 minute from now.');
    if (!accountFor(sel)) return setErr('Pick an account for that platform first.');
    setErr('');
    onSchedule(sel, new Date(t).toISOString());
  };

  return (
    <div className="s3-overlay" onClick={onClose}>
      <div className="s3-sched" role="dialog" aria-modal="true" aria-label="Schedule this post" onClick={(e) => e.stopPropagation()}>
        <h2>Schedule instead of posting now</h2>
        <p className="sub">We publish automatically at the time you pick. You can cancel any time before it runs.</p>

        <label className="s3-field">
          <span>Platforms to publish</span>
          <select value={sel} onChange={(e) => setSel(e.target.value)}>
            {platforms.map((p) => (
              <option key={p} value={p} disabled={!accountFor(p)}>
                {p[0].toUpperCase() + p.slice(1)}{accountFor(p) ? '' : ' · no account'}
              </option>
            ))}
          </select>
        </label>

        <div className="s3-quick">
          {quick.map((q) => (
            <button key={q.label} type="button" onClick={() => setWhen(q.value)}>{q.label}</button>
          ))}
        </div>

        <label className="s3-field">
          <span>Date and time</span>
          <input type="datetime-local" value={when} min={defaultWhen()} onChange={(e) => setWhen(e.target.value)} />
        </label>

        {err && <p className="s3-err">{err}</p>}

        <div className="s3-acts">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" className="go" disabled={busy} onClick={submit}>
            {busy ? 'Scheduling…' : 'Schedule it'}
          </button>
        </div>
      </div>
    </div>
  );
}
