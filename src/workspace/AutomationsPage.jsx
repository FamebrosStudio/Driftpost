import React, { useEffect, useState } from 'react';
import BrandIcon from '../brand.jsx';
import { api } from '../lib.js';
import { WorkspaceNav } from './Workspace.jsx';
import './workspace.css';

const EMPTY = { comment_enabled: false, comment_keyword: '', public_reply: '', private_reply: '', dm_keyword: '', dm_reply: '', default_reply: '' };

export default function AutomationsPage({ session, onNavigate, onSignOut }) {
  const [platform, setPlatform] = useState('instagram');
  const platformName = platform === 'facebook' ? 'Facebook' : 'Instagram';
  const [accounts, setAccounts] = useState([]);
  const [selected, setSelected] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [rules, setRules] = useState(EMPTY);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setMessage(''); setAccounts([]); setSelected('');
    api(`/api/automations/${platform}`, session.access_token)
      .then((data) => {
        if (!active) return;
        const list = data.accounts || [];
        setAccounts(list); setReady(!!data.webhook_ready);
        setSelected(list[0]?.id || '');
      })
      .catch((e) => { if (active) setError(e.message || 'Could not load automation.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [session.access_token, platform]);

  useEffect(() => {
    const account = accounts.find((item) => item.id === selected);
    if (!account) return;
    setEnabled(account.enabled);
    setRules({ ...EMPTY, ...(account.rules || {}) });
    setMessage(''); setError('');
  }, [accounts, selected]);

  const set = (key, value) => setRules((current) => ({ ...current, [key]: value }));
  const save = async () => {
    if (!selected || saving) return;
    setSaving(true); setError(''); setMessage('');
    try {
      const data = await api(`/api/automations/${platform}/${encodeURIComponent(selected)}`, session.access_token, {
        method: 'PUT', body: JSON.stringify({ enabled, ...rules }),
      });
      setAccounts((current) => current.map((item) => item.id === selected ? { ...item, enabled: data.enabled, rules: data.rules } : item));
      setMessage(data.enabled ? 'Automation saved and enabled.' : 'Automation saved and paused.');
    } catch (e) { setError(e.message || 'Could not save your automation.'); }
    finally { setSaving(false); }
  };

  const field = (label, key, placeholder, hint, multiline = false) => <label className="automation-field"><span>{label}</span>{multiline ? <textarea rows="3" maxLength={1000} value={rules[key]} onChange={(e) => set(key, e.target.value)} placeholder={placeholder} /> : <input maxLength={80} value={rules[key]} onChange={(e) => set(key, e.target.value)} placeholder={placeholder} />}{hint && <small>{hint}</small>}</label>;

  return <div className="ws"><WorkspaceNav page="automations" onNavigate={onNavigate} email={session.user?.email} onSignOut={onSignOut} />
    <main className="ws-main"><div className="ws-heading"><div><span className="ws-eyebrow">{platformName} engagement</span><h1>Auto DM & replies</h1><p>Reply to comment keywords and inbound {platformName} messages automatically.</p></div><button className="ws-primary" disabled={!selected || saving} onClick={save}>{saving ? 'Saving…' : 'Save automation'}</button></div>
      <section className="ws-panel automation-account"><label><span>Platform</span><select value={platform} disabled={saving} onChange={(e) => { setSelected(''); setAccounts([]); setLoading(true); setPlatform(e.target.value); }}><option value="instagram">Instagram</option><option value="facebook">Facebook</option></select></label></section>
      {!ready && <section className="ws-panel automation-setup"><b>Connect your account to enable replies</b><p>Automatic replies need messaging and comment access from Meta. Reconnect your account after those permissions are enabled.</p></section>}
      {error && <p className="approval-error" role="alert">{error}</p>}{message && <p className="automation-saved" role="status">{message}</p>}
      {loading ? <div className="ws-inline-state">Loading {platformName} accounts…</div> : !accounts.length ? <section className="ws-panel ws-empty"><b>Connect {platform === 'facebook' ? 'a Facebook Page' : 'an Instagram professional account'}</b><small>Auto replies are available for connected {platformName} accounts.</small><button onClick={() => onNavigate('accounts')}>Open connected accounts</button></section> : <>
        <section className="ws-panel automation-account"><label><span>{platformName} account</span><select value={selected} disabled={saving} onChange={(e) => setSelected(e.target.value)}>{accounts.map((item) => <option key={item.id} value={item.id}>{item.name} · replies {item.enabled ? 'ON' : 'PAUSED'}</option>)}</select></label><label className="automation-toggle"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /><span><b>Automation is {enabled ? 'on' : 'paused'}</b><small>Pause instantly without deleting your reply rules.</small></span></label></section>
        <div className="automation-grid">
          <section className="ws-panel"><div className="automation-title"><span className="ws-icon"><BrandIcon id={platform} size={18} /></span><div><h2>Comment to DM</h2><p>Match a keyword in a post comment, then send a public reply, a private message, or both.</p></div></div>
            <label className="automation-toggle"><input type="checkbox" checked={rules.comment_enabled} onChange={(e) => set('comment_enabled', e.target.checked)} /><span><b>Enable comment trigger</b><small>Leave keyword empty to match any comment.</small></span></label>
            {field('Comment keyword', 'comment_keyword', 'e.g. PRICE', 'Matching ignores uppercase and lowercase.')}
            {field('Public comment reply', 'public_reply', 'Thanks for asking! Check your messages.', 'Optional. Appears under the comment.', true)}
            {rules.comment_enabled && !rules.private_reply.trim() && <p className="automation-setup" role="status"><b>Comment DMs are not configured.</b> A public reply can still appear under the comment, but no private message will be sent until you add one below.</p>}
            {field('Private reply to the comment', 'private_reply', 'Here are the details you asked for…', 'Add a message here to DM the commenter. Meta allows one private reply per comment.', true)}
          </section>
          <section className="ws-panel"><div className="automation-title"><span className="ws-icon"><BrandIcon id={platform} size={18} /></span><div><h2>Reply to incoming DMs</h2><p>Send a saved reply when someone messages your connected {platformName} account.</p></div></div>
            {field('DM keyword', 'dm_keyword', 'e.g. HOURS', 'Leave empty to use only the default reply.')}
            {field('Reply when keyword matches', 'dm_reply', 'We are open Monday to Saturday…', '', true)}
            {field('Default reply', 'default_reply', 'Thanks for messaging us. We will get back to you soon.', 'Sent for inbound messages when no keyword matches.', true)}
          </section>
        </div>
        <p className="ws-footnote">{platformName} messaging is subject to Meta permissions and messaging windows. A comment-triggered private reply alone does not open an ongoing conversation; the person needs to respond before follow-up messages are available.</p>
      </>}
    </main>
  </div>;
}
