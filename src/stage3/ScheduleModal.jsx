import React, { useEffect, useMemo, useState } from 'react';

// Pick when to publish. Validates a real future time before it can fire.
function defaultWhen() {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setSeconds(0, 0);
  return formatLocal(d);
}

function formatLocal(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function calendarWhen() {
  try {
    const raw = sessionStorage.getItem('driftpost-calendar-prefill');
    sessionStorage.removeItem('driftpost-calendar-prefill');
    const item = JSON.parse(raw || 'null');
    if (!item || Date.now() - item.createdAt > 6 * 60 * 60 * 1000 || !/^\d{4}-\d{2}-\d{2}$/.test(item.date)) return defaultWhen();
    const [year, month, day] = item.date.split('-').map(Number);
    const d = new Date(year, month - 1, day, 9, 0, 0, 0);
    if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day || d.getTime() < Date.now() + 60_000) return defaultWhen();
    return formatLocal(d);
  } catch { return defaultWhen(); }
}

function minimumWhen() {
  return formatLocal(new Date(Date.now() + 60_000));
}

function parseCsv(text) {
  const rows = [];
  let row = []; let cell = ''; let quoted = false;
  const source = String(text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted && ch === '"' && source[i + 1] === '"') { cell += '"'; i++; }
    else if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && source[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((part) => part.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (quoted) throw new Error('The CSV has an unfinished quoted field.');
  row.push(cell);
  if (row.some((part) => part.trim())) rows.push(row);
  if (rows.length < 2) throw new Error('Add a header row and at least one post row.');
  const headers = rows.shift().map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_'));
  const atIndex = headers.indexOf('scheduled_at');
  const dateIndex = headers.indexOf('date');
  const timeIndex = headers.indexOf('time');
  const textIndex = ['caption', 'text', 'message'].map((h) => headers.indexOf(h)).find((i) => i >= 0);
  if ((atIndex < 0 && dateIndex < 0) || textIndex == null) throw new Error('CSV headers must include scheduled_at (or date and time) plus caption.');
  if (atIndex < 0 && timeIndex < 0) throw new Error('Add a time column when using separate date and time columns.');
  const data = rows.filter((r) => r.some((part) => part.trim())).map((r, i) => {
    const rawWhen = atIndex >= 0 ? r[atIndex] : `${r[dateIndex] || ''}T${r[timeIndex] || ''}`;
    const text = String(r[textIndex] || '').trim();
    const timestamp = Date.parse(String(rawWhen || '').trim());
    if (!Number.isFinite(timestamp)) throw new Error(`Row ${i + 2}: enter a valid date and time.`);
    if (timestamp < Date.now() + 60_000) throw new Error(`Row ${i + 2}: choose a future time at least one minute from now.`);
    if (timestamp > Date.now() + 365 * 24 * 3600 * 1000) throw new Error(`Row ${i + 2}: schedule within the next year.`);
    if (!text) throw new Error(`Row ${i + 2}: caption cannot be empty.`);
    return { when: new Date(timestamp).toISOString(), text };
  });
  if (!data.length) throw new Error('The CSV does not contain any posts.');
  if (data.length > 10) throw new Error('Import up to 10 posts at a time.');
  return data;
}

export default function ScheduleModal({ platforms, accountFor, invalidFor, busy, onClose, onSchedule, platform }) {
  const [when, setWhen] = useState(calendarWhen);
  // Preselect the tab the user scheduled from — not just platforms[0].
  const [sel, setSel] = useState(platform && platforms.includes(platform) ? platform : (platforms[0] || ''));
  const [err, setErr] = useState('');
  const [repeatEveryDays, setRepeatEveryDays] = useState(0);
  const [repeatRemaining, setRepeatRemaining] = useState(3);
  const [bulkRows, setBulkRows] = useState([]);
  const [bulkError, setBulkError] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [requestApproval, setRequestApproval] = useState(false);

  const quick = useMemo(() => {
    const mk = (mins, label) => {
      const d = new Date(Date.now() + mins * 60000);
      const pad = (n) => String(n).padStart(2, '0');
      return { label, value: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}` };
    };
    return [mk(60, '1 hour'), mk(60 * 24, 'Tomorrow'), mk(60 * 24 * 7, 'Next week')];
  }, []);
  const csvTemplate = useMemo(() => {
    const one = new Date(); one.setDate(one.getDate() + 1); one.setHours(9, 0, 0, 0);
    const two = new Date(one); two.setDate(two.getDate() + 2); two.setHours(14, 30, 0, 0);
    return `scheduled_at,caption\n${formatLocal(one)},"A caption for the first post"\n${formatLocal(two)},"A second caption"`;
  }, []);

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const submit = () => {
    if (bulkError) return setErr('Fix the CSV import or clear it before scheduling.');
    const t = Date.parse(when);
    if (!bulkRows.length && !Number.isFinite(t)) return setErr('Pick a valid date and time.');
    if (!bulkRows.length && t < Date.now() + 60 * 1000) return setErr('Choose a time at least 1 minute from now.');
    if (bulkRows.some((r) => Date.parse(r.when) < Date.now() + 60_000)) return setErr('A CSV time has passed. Import an updated CSV.');
    if (!accountFor(sel)) return setErr('Pick an account for that platform first.');
    const bad = invalidFor?.(sel);
    if (bad) return setErr(`Fix the card first: ${bad}`);
    setErr('');
    onSchedule(sel, bulkRows[0]?.when || new Date(t).toISOString(), { repeatEveryDays: bulkRows.length ? 0 : repeatEveryDays, repeatRemaining: bulkRows.length ? 0 : repeatEveryDays ? repeatRemaining : 0 }, bulkRows, requestApproval);
  };

  const importCsv = async (file) => {
    setBulkError(''); setBulkRows([]);
    if (!file) return;
    setBulkBusy(true);
    try { setBulkRows(parseCsv(await file.text())); setRepeatEveryDays(0); }
    catch (e) { setBulkError(e.message || 'Could not read this CSV.'); }
    finally { setBulkBusy(false); }
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
          <input type="datetime-local" value={when} min={minimumWhen()} onChange={(e) => setWhen(e.target.value)} />
        </label>

        <div className="s3-repeat-row">
          <label className="s3-field">
            <span>Repeat</span>
            <select value={repeatEveryDays} onChange={(e) => setRepeatEveryDays(Number(e.target.value))}>
              <option value={0}>Does not repeat</option>
              <option value={7}>Every week</option>
              <option value={14}>Every 2 weeks</option>
              <option value={30}>Every 30 days</option>
            </select>
          </label>
          {repeatEveryDays > 0 && <label className="s3-field">
            <span>Additional posts</span>
            <select value={repeatRemaining} onChange={(e) => setRepeatRemaining(Number(e.target.value))}>
              {[1, 2, 3, 4, 5, 8, 12].map((count) => <option key={count} value={count}>{count} more</option>)}
            </select>
          </label>}
        </div>
        {repeatEveryDays > 0 && <p className="s3-repeat-note">This post will publish once at the selected time, then repeat {repeatRemaining} additional time{repeatRemaining === 1 ? '' : 's'}. You can cancel each upcoming post from Calendar or History.</p>}

        <label className="s3-approval-choice"><input type="checkbox" checked={requestApproval} onChange={(e) => { setRequestApproval(e.target.checked); if (e.target.checked) setRepeatEveryDays(0); }} /><span><b>Request approval before publishing</b><small>Creates a private review link. The post will wait until it is approved. Repeats are turned off so each post is reviewed individually.</small></span></label>

        <details className="s3-bulk-import">
          <summary>Import a CSV batch</summary>
          <p>Schedule up to 10 caption variants for this platform. The current media and account settings are reused for every row.</p>
          <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(csvTemplate)}`} download="driftpost-schedule-template.csv">Download CSV template</a>
          <input type="file" accept=".csv,text/csv" aria-label="Import scheduled post CSV" onChange={(e) => importCsv(e.target.files?.[0])} />
          {bulkBusy && <small>Reading CSV…</small>}
          {bulkError && <small className="s3-bulk-error" role="alert">{bulkError}</small>}
          {bulkError && <button type="button" className="s3-bulk-clear" onClick={() => { setBulkError(''); setBulkRows([]); setErr(''); }}>Clear CSV import</button>}
        {bulkRows.length > 0 && <small className="s3-bulk-success" role="status">{bulkRows.length} posts ready. Repeat scheduling is turned off for this batch.{requestApproval ? ' Each post gets its own review link.' : ''}</small>}
        </details>

        {err && <p className="s3-err">{err}</p>}

        <div className="s3-acts">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" className="go" disabled={busy || bulkBusy || !!bulkError} onClick={submit}>
            {busy ? 'Scheduling…' : 'Schedule it'}
          </button>
        </div>
      </div>
    </div>
  );
}
