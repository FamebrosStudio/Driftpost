import React, { useEffect, useState } from 'react';
import BrandIcon from '../brand.jsx';
import { api } from '../lib.js';
import { WorkspaceNav } from './Workspace.jsx';
import './workspace.css';

const EMPTY = { comment_enabled: false, public_reply_enabled: false, comment_keyword: '', public_reply: '', private_reply: '', dm_keyword: '', dm_reply: '', default_reply: '' };

export default function AutomationsPage({ session, onNavigate, onSignOut }) {
  const [platform, setPlatform] = useState('instagram');
  const platformName = platform === 'facebook' ? 'Facebook' : platform === 'google-business' ? 'Google Business Profile' : 'Instagram';
  const [accounts, setAccounts] = useState([]);
  const [selected, setSelected] = useState('');
  const [accountSearch, setAccountSearch] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [rules, setRules] = useState(EMPTY);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('connected') === 'google-business') setMessage('Google Business Profile connected. Choose a location and configure its review replies.');
    if (params.get('oauth_error')) setError(`Google connection failed: ${params.get('oauth_error')}`);
    if (params.has('connected') || params.has('oauth_error')) window.history.replaceState({}, '', window.location.pathname);
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setMessage(''); setAccounts([]); setSelected(''); setAccountSearch('');
    api(platform === 'google-business' ? '/api/automations/google-business' : `/api/automations/${platform}`, session.access_token)
      .then((data) => {
        if (!active) return;
        const list = [...(platform === 'google-business' ? (data.locations || []).map((item) => ({ ...item, name: item.location_name })) : (data.accounts || []))].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base', numeric: true }));
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
    const savedRules = account.rules || {};
    const loadedRules = { ...EMPTY, ...savedRules };
    // Migrate the old combined comment trigger into independent switches in
    // the UI without changing the user's former public/private reply behavior.
    if (savedRules.public_reply_enabled === undefined && savedRules.comment_enabled) {
      loadedRules.comment_enabled = !!String(savedRules.private_reply || '').trim();
      loadedRules.public_reply_enabled = !!String(savedRules.public_reply || '').trim();
    }
    setRules(loadedRules);
    setMessage(''); setError('');
  }, [accounts, selected]);

  const set = (key, value) => setRules((current) => ({ ...current, [key]: value }));
  const sortedAccounts = [...accounts].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base', numeric: true }));
  const matchingAccounts = sortedAccounts.filter((account) => String(account.name || '').toLocaleLowerCase().includes(accountSearch.trim().toLocaleLowerCase()));
  const selectedAccount = accounts.find((account) => account.id === selected);
  const selectedOutsideSearch = selectedAccount && accountSearch && !matchingAccounts.some((account) => account.id === selected);
  const save = async () => {
    if (!selected || saving) return;
    setSaving(true); setError(''); setMessage('');
    try {
      const payload = platform === 'google-business'
        ? { enabled, mode: 'template', reply_text: rules.reply_text || '', minimum_rating: rules.minimum_rating || 1 }
        : { enabled, ...rules };
      const data = await api(platform === 'google-business' ? `/api/automations/google-business/${encodeURIComponent(selected)}` : `/api/automations/${platform}/${encodeURIComponent(selected)}`, session.access_token, {
        method: 'PUT', body: JSON.stringify(payload),
      });
      setAccounts((current) => current.map((item) => item.id === selected ? { ...item, enabled: data.enabled, rules: data.rules } : item));
      setMessage(data.enabled ? 'Automation saved and enabled.' : 'Automation saved and paused.');
    } catch (e) { setError(e.message || 'Could not save your automation.'); }
    finally { setSaving(false); }
  };

  const field = (label, key, placeholder, hint, multiline = false) => <label className="automation-field"><span>{label}</span>{multiline ? <textarea rows="3" maxLength={1000} value={rules[key]} onChange={(e) => set(key, e.target.value)} placeholder={placeholder} /> : <input maxLength={80} value={rules[key]} onChange={(e) => set(key, e.target.value)} placeholder={placeholder} />}{hint && <small>{hint}</small>}</label>;

  return <div className="ws"><WorkspaceNav page="automations" onNavigate={onNavigate} email={session.user?.email} onSignOut={onSignOut} />
    <main className="ws-main"><div className="ws-heading"><div><span className="ws-eyebrow">{platformName} engagement</span><h1>{platform === 'google-business' ? 'Review auto-replies' : 'Auto DM & replies'}</h1><p>{platform === 'google-business' ? 'Manage review reply rules separately for each connected business location.' : `Reply to comment keywords and inbound ${platformName} messages automatically.`}</p></div><button className="ws-primary" disabled={!selected || saving} onClick={save}>{saving ? 'Saving…' : 'Save automation'}</button></div>
      <section className="ws-panel automation-account"><label><span>Platform</span><select value={platform} disabled={saving} onChange={(e) => { setSelected(''); setAccounts([]); setAccountSearch(''); setLoading(true); setPlatform(e.target.value); }}><option value="instagram">Instagram</option><option value="facebook">Facebook</option><option value="google-business">Google Business Profile reviews</option></select></label></section>
      {platform === 'google-business' && <section className="ws-panel automation-setup"><b>Connect business locations</b><p>Connect any verified Google account that manages the business. Driftpost imports every location that account can manage; select a location below to configure its own independent reply automation. Google API approval and enablement are required.</p><button type="button" className="ws-primary" disabled={saving} onClick={() => api('/api/oauth/google-business/start', session.access_token, { method: 'POST' }).then((data) => { try { localStorage.setItem('driftpost-after-google-business-connect', 'automations'); } catch {} window.location.assign(data.url); }).catch((e) => setError(e.message || 'Could not start Google connection.'))}>Connect another Google business account</button></section>}
      {platform !== 'google-business' && !ready && <section className="ws-panel automation-setup"><b>Connect your account to enable replies</b><p>Automatic replies need messaging and comment access from Meta. Reconnect your account after those permissions are enabled.</p></section>}
      {error && <p className="approval-error" role="alert">{error}</p>}{message && <p className="automation-saved" role="status">{message}</p>}
      {loading ? <div className="ws-inline-state">Loading {platformName} accounts…</div> : !accounts.length ? <section className="ws-panel ws-empty"><b>{platform === 'google-business' ? 'No business locations connected yet' : `Connect ${platform === 'facebook' ? 'a Facebook Page' : 'an Instagram professional account'}`}</b><small>{platform === 'google-business' ? 'Connect a Google account above; all Business Profile locations it manages will appear here.' : `Auto replies are available for connected ${platformName} accounts.`}</small>{platform !== 'google-business' && <button onClick={() => onNavigate('accounts')}>Open connected accounts</button>}</section> : <>
        <section className="ws-panel automation-account"><label><span>{platform === 'google-business' ? 'Business location' : `${platformName} account`}</span><input type="search" value={accountSearch} onChange={(e) => setAccountSearch(e.target.value)} placeholder={`Search ${platformName} accounts`} aria-label={`Search ${platformName} accounts`} /><select value={selected} disabled={saving} onChange={(e) => setSelected(e.target.value)}>{selectedOutsideSearch && <optgroup label="Current selection"><option value={selected}>{selectedAccount.name} · replies {selectedAccount.enabled ? 'ON' : 'PAUSED'}</option></optgroup>}{matchingAccounts.map((item) => <option key={item.id} value={item.id}>{item.name}{item.address ? ` · ${item.address}` : ''} · replies {item.enabled ? 'ON' : 'PAUSED'}</option>)}</select></label>{platform !== 'google-business' && <label className="automation-toggle"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /><span><b>Automation is {enabled ? 'on' : 'paused'}</b><small>Pause instantly without deleting your reply rules.</small></span></label>}</section>
        {platform === 'google-business' ? <div className="automation-grid"><section className="ws-panel"><div className="automation-title"><span className="ws-icon"><BrandIcon id="google" size={18} /></span><div><h2>Review auto-reply</h2><p>Only new reviews without an existing owner reply are eligible. Replies are checked every five minutes.</p></div></div><label className="automation-toggle"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /><span><b>Automation is {enabled ? 'on' : 'paused'}</b><small>Disable immediately to stop processing future reviews.</small></span></label>{field('Reply template', 'reply_text', 'Thank you for taking the time to leave us a review!', 'Use a fixed, human-reviewed response. Replies are public and sent as your business.', true)}<label className="automation-field"><span>Minimum star rating</span><select value={rules.minimum_rating || 1} onChange={(e) => set('minimum_rating', Number(e.target.value))}>{[1,2,3,4,5].map((rating) => <option key={rating} value={rating}>{rating}+ stars</option>)}</select><small>Lower ratings are left for personal follow-up.</small></label><p className="ws-footnote">Template-only mode is intentional: generated replies can publish publicly. Each review event is deduplicated before replying; existing owner replies are never overwritten.</p></section></div> : <div className="automation-grid">
          <section className="ws-panel"><div className="automation-title"><span className="ws-icon"><BrandIcon id={platform} size={18} /></span><div><h2>Replies to comments</h2><p>Choose whether matching comments get a public reply, a private DM, or both. Each action has its own switch.</p></div></div>
            <label className="automation-toggle"><input type="checkbox" checked={rules.public_reply_enabled} onChange={(e) => set('public_reply_enabled', e.target.checked)} /><span><b>Auto-reply publicly to comments</b><small>Post a reply under each matching comment. Turn this off to stop public replies.</small></span></label>
            {field('Comment keyword filter (optional)', 'comment_keyword', 'e.g. PRICE', 'Leave blank to match every new comment. This filter applies to both auto-DM and public replies.')}
            {field('Public comment reply', 'public_reply', 'Thanks for asking! Check your messages.', 'Optional. Appears under the comment.', true)}
            {rules.comment_enabled && !rules.private_reply.trim() && <p className="automation-setup" role="status"><b>Comment DMs are not configured.</b> A public reply can still appear under the comment, but no private message will be sent until you add one below.</p>}
            {field('Private reply to the comment', 'private_reply', 'Here are the details you asked for…', 'Add a message here to DM the commenter. Meta allows one private reply per comment.', true)}
          </section>
          <section className="ws-panel"><div className="automation-title"><span className="ws-icon"><BrandIcon id={platform} size={18} /></span><div><h2>DM replies</h2><p>Set replies for incoming messages and separately choose whether to DM people who comment.</p></div></div>
            <label className="automation-toggle"><input type="checkbox" checked={rules.comment_enabled} onChange={(e) => set('comment_enabled', e.target.checked)} /><span><b>Auto DM commenters</b><small>Send a private message for matching comments. This does not control replies to incoming DMs.</small></span></label>
            {field('DM keyword', 'dm_keyword', 'e.g. HOURS', 'Leave empty to use only the default reply.')}
            {field('Reply when keyword matches', 'dm_reply', 'We are open Monday to Saturday…', '', true)}
            {field('Default reply', 'default_reply', 'Thanks for messaging us. We will get back to you soon.', 'Sent for inbound messages when no keyword matches.', true)}
          </section>
        </div>}
        {platform !== 'google-business' && <p className="ws-footnote">{platformName} messaging is subject to Meta permissions and messaging windows. A comment-triggered private reply alone does not open an ongoing conversation; the person needs to respond before follow-up messages are available.</p>}
      </>}
    </main>
  </div>;
}
