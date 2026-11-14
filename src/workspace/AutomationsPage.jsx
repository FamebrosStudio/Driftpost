import BorderGlow from '../components/reactbits/BorderGlow.jsx';
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
  const [googleConnections, setGoogleConnections] = useState([]);
  const [refreshingConnection, setRefreshingConnection] = useState('');
  const [selected, setSelected] = useState('');
  const [accountSearch, setAccountSearch] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [rules, setRules] = useState(EMPTY);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(() => new URLSearchParams(window.location.search).get('google_business_error') || '');
  const [message, setMessage] = useState(() => new URLSearchParams(window.location.search).get('connected') === 'google-business' ? 'Google Business Profile account connected.' : '');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('oauth_error')) setError(`Google connection failed: ${params.get('oauth_error')}`);
    if (params.has('connected') || params.has('oauth_error') || params.has('google_business_error')) window.history.replaceState({}, '', window.location.pathname);
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true); setAccounts([]); setSelected(''); setAccountSearch('');
    api(platform === 'google-business' ? '/api/automations/google-business' : `/api/automations/${platform}`, session.access_token)
      .then((data) => {
        if (!active) return;
        setGoogleConnections(platform === 'google-business' ? (data.connections || []) : []);
        if (platform === 'google-business' && (data.connections || []).length) setError('');
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

  const refreshLocations = async (connectionId) => {
    if (refreshingConnection) return;
    setRefreshingConnection(connectionId); setError(''); setMessage('');
    try {
      const result = await api(`/api/automations/google-business/connections/${encodeURIComponent(connectionId)}/refresh`, session.access_token, { method: 'POST' });
      const data = await api('/api/automations/google-business', session.access_token);
      setGoogleConnections(data.connections || []);
      const locations = (data.locations || []).map((item) => ({ ...item, name: item.location_name })).sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base', numeric: true }));
      setAccounts(locations);
      setSelected((current) => current && locations.some((item) => item.id === current) ? current : (locations[0]?.id || ''));
      setMessage(result.count ? `Found ${result.count} business location${result.count === 1 ? '' : 's'}.` : 'Google account connected. No Business Profile locations are currently available for this account.');
    } catch (e) { setError(e.message || 'Could not refresh Google business locations.'); }
    finally { setRefreshingConnection(''); }
  };

  const field = (label, key, placeholder, hint, multiline = false) => <label className="automation-field"><span>{label}</span>{multiline ? <textarea rows="3" maxLength={1000} value={rules[key]} onChange={(e) => set(key, e.target.value)} placeholder={placeholder} /> : <input maxLength={80} value={rules[key]} onChange={(e) => set(key, e.target.value)} placeholder={placeholder} />}{hint && <small>{hint}</small>}</label>;

  return <div className="ws"><WorkspaceNav page="automations" onNavigate={onNavigate} email={session.user?.email} onSignOut={onSignOut} />
    <main className="ws-main"><div className="ws-heading"><div><span className="ws-eyebrow">{platformName} engagement</span><h1>{platform === 'google-business' ? 'Review auto-replies' : 'Auto DM & replies'}</h1><p>{platform === 'google-business' ? 'Manage review reply rules separately for each connected business location.' : `Reply to comment keywords and inbound ${platformName} messages automatically.`}</p></div><BorderGlow className="btn-glow ws-btn-glow" backgroundColor="#071019" borderRadius={0} glowColor="199 95 74" colors={['#7dd3fc', '#4dc3f7', '#a5ddfa']} fillOpacity={0.3} glowRadius={22}><button className="ws-primary" disabled={!selected || saving} onClick={save}>{saving ? 'Saving…' : 'Save automation'}</button></BorderGlow></div>
       <BorderGlow className="bg-glow" backgroundColor="#071019" borderRadius={0} glowColor="199 95 74" colors={['#7dd3fc', '#4dc3f7', '#a5ddfa']} fillOpacity={0.12} glowRadius={22}><section className="ws-panel automation-account"><label><span>Platform</span><select value={platform} disabled={saving} onChange={(e) => { setSelected(''); setAccounts([]); setGoogleConnections([]); setAccountSearch(''); setLoading(true); setError(''); setMessage(''); setPlatform(e.target.value); }}><option value="instagram">Instagram</option><option value="facebook">Facebook</option><option value="google-business">Google Business Profile reviews</option></select></label></section></BorderGlow>
       {platform === 'google-business' && <BorderGlow className="bg-glow" backgroundColor="#071019" borderRadius={0} glowColor="199 95 74" colors={['#7dd3fc', '#4dc3f7', '#a5ddfa']} fillOpacity={0.12} glowRadius={22}><section className="ws-panel automation-setup"><b>Connect business locations</b><p>Connect any Google account that manages a Business Profile. Accounts remain connected even if Google temporarily prevents location discovery; use Retry to load locations again.</p><BorderGlow className="btn-glow ws-btn-glow" backgroundColor="#071019" borderRadius={0} glowColor="199 95 74" colors={['#7dd3fc', '#4dc3f7', '#a5ddfa']} fillOpacity={0.3} glowRadius={22}><button type="button" className="ws-primary" disabled={saving} onClick={() => api('/api/oauth/google-business/start', session.access_token, { method: 'POST' }).then((data) => { try { localStorage.setItem('driftpost-after-google-business-connect', 'automations'); } catch {} window.location.assign(data.url); }).catch((e) => setError(e.message || 'Could not start Google connection.'))}>Connect another Google business account</button></BorderGlow>
         {googleConnections.map((connection) => <div key={connection.id} className="automation-google-connection"><div><b>{connection.google_email}</b><small>{connection.locations_count ? `${connection.locations_count} location${connection.locations_count === 1 ? '' : 's'} found` : 'No locations found yet'}{connection.locations_synced_at ? ` · Last checked ${new Date(connection.locations_synced_at).toLocaleString()}` : ''}</small>{connection.location_sync_error && <small className="approval-error" role="alert">{connection.location_sync_error}</small>}</div><BorderGlow className="btn-glow ws-btn-glow" backgroundColor="#071019" borderRadius={0} glowColor="199 95 74" colors={['#7dd3fc', '#4dc3f7', '#a5ddfa']} fillOpacity={0.3} glowRadius={22}><button type="button" className="ws-secondary" disabled={!!refreshingConnection} onClick={() => refreshLocations(connection.id)}>{refreshingConnection === connection.id ? 'Checking…' : 'Retry location discovery'}</button></BorderGlow></div>)}
       </section></BorderGlow>}
      {platform !== 'google-business' && !ready && <BorderGlow className="bg-glow" backgroundColor="#071019" borderRadius={0} glowColor="199 95 74" colors={['#7dd3fc', '#4dc3f7', '#a5ddfa']} fillOpacity={0.12} glowRadius={22}><section className="ws-panel automation-setup"><b>Connect your account to enable replies</b><p>Automatic replies need messaging and comment access from Meta. Reconnect your account after those permissions are enabled.</p></section></BorderGlow>}
      {error && <p className="approval-error" role="alert">{error}</p>}{message && <p className="automation-saved" role="status">{message}</p>}
      {loading ? <div className="ws-inline-state">Loading {platformName} accounts…</div> : !accounts.length ? <BorderGlow className="bg-glow" backgroundColor="#071019" borderRadius={0} glowColor="199 95 74" colors={['#7dd3fc', '#4dc3f7', '#a5ddfa']} fillOpacity={0.12} glowRadius={22}><section className="ws-panel ws-empty"><b>{platform === 'google-business' ? 'No business locations connected yet' : `Connect ${platform === 'facebook' ? 'a Facebook Page' : 'an Instagram professional account'}`}</b><small>{platform === 'google-business' ? 'Connect a Google account above; all Business Profile locations it manages will appear here.' : `Auto replies are available for connected ${platformName} accounts.`}</small>{platform !== 'google-business' && <button onClick={() => onNavigate('accounts')}>Open connected accounts</button>}</section></BorderGlow> : <>
        <BorderGlow className="bg-glow" backgroundColor="#071019" borderRadius={0} glowColor="199 95 74" colors={['#7dd3fc', '#4dc3f7', '#a5ddfa']} fillOpacity={0.12} glowRadius={22}><section className="ws-panel automation-account"><label><span>{platform === 'google-business' ? 'Business location' : `${platformName} account`}</span><input type="search" value={accountSearch} onChange={(e) => setAccountSearch(e.target.value)} placeholder={`Search ${platformName} accounts`} aria-label={`Search ${platformName} accounts`} /><select value={selected} disabled={saving} onChange={(e) => setSelected(e.target.value)}>{selectedOutsideSearch && <optgroup label="Current selection"><option value={selected}>{selectedAccount.name} · replies {selectedAccount.enabled ? 'ON' : 'PAUSED'}</option></optgroup>}{matchingAccounts.map((item) => <option key={item.id} value={item.id}>{item.name}{item.address ? ` · ${item.address}` : ''} · replies {item.enabled ? 'ON' : 'PAUSED'}</option>)}</select></label>{platform !== 'google-business' && <label className="automation-toggle"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /><span><b>Automation is {enabled ? 'on' : 'paused'}</b><small>Pause instantly without deleting your reply rules.</small></span></label>}</section></BorderGlow>
        {platform === 'google-business' ? <div className="automation-grid"><BorderGlow className="bg-glow" backgroundColor="#071019" borderRadius={0} glowColor="199 95 74" colors={['#7dd3fc', '#4dc3f7', '#a5ddfa']} fillOpacity={0.12} glowRadius={22}><section className="ws-panel"><div className="automation-title"><span className="ws-icon"><BrandIcon id="google" size={18} /></span><div><h2>Review auto-reply</h2><p>Only new reviews without an existing owner reply are eligible. Replies are checked every five minutes.</p></div></div><label className="automation-toggle"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /><span><b>Automation is {enabled ? 'on' : 'paused'}</b><small>Disable immediately to stop processing future reviews.</small></span></label>{field('Reply template', 'reply_text', 'Thank you for taking the time to leave us a review!', 'Use a fixed, human-reviewed response. Replies are public and sent as your business.', true)}<label className="automation-field"><span>Minimum star rating</span><select value={rules.minimum_rating || 1} onChange={(e) => set('minimum_rating', Number(e.target.value))}>{[1,2,3,4,5].map((rating) => <option key={rating} value={rating}>{rating}+ stars</option>)}</select><small>Lower ratings are left for personal follow-up.</small></label><p className="ws-footnote">Template-only mode is intentional: generated replies can publish publicly. Each review event is deduplicated before replying; existing owner replies are never overwritten.</p></section></BorderGlow></div> : <div className="automation-grid">
          <BorderGlow className="bg-glow" backgroundColor="#071019" borderRadius={0} glowColor="199 95 74" colors={['#7dd3fc', '#4dc3f7', '#a5ddfa']} fillOpacity={0.12} glowRadius={22}><section className="ws-panel"><div className="automation-title"><span className="ws-icon"><BrandIcon id={platform} size={18} /></span><div><h2>Replies to comments</h2><p>Choose whether matching comments get a public reply, a private DM, or both. Each action has its own switch.</p></div></div>
            <label className="automation-toggle"><input type="checkbox" checked={rules.public_reply_enabled} onChange={(e) => set('public_reply_enabled', e.target.checked)} /><span><b>Auto-reply publicly to comments</b><small>Post a reply under each matching comment. Turn this off to stop public replies.</small></span></label>
            {field('Comment keyword filter (optional)', 'comment_keyword', 'e.g. PRICE', 'Leave blank to match every new comment. This filter applies to both auto-DM and public replies.')}
            {field('Public comment reply', 'public_reply', 'Thanks for asking! Check your messages.', 'Optional. Appears under the comment.', true)}
            {rules.comment_enabled && !rules.private_reply.trim() && <p className="automation-setup" role="status"><b>Comment DMs are not configured.</b> A public reply can still appear under the comment, but no private message will be sent until you add one below.</p>}
            {field('Private reply to the comment', 'private_reply', 'Here are the details you asked for…', 'Add a message here to DM the commenter. Meta allows one private reply per comment.', true)}
          </section></BorderGlow>
          <BorderGlow className="bg-glow" backgroundColor="#071019" borderRadius={0} glowColor="199 95 74" colors={['#7dd3fc', '#4dc3f7', '#a5ddfa']} fillOpacity={0.12} glowRadius={22}><section className="ws-panel"><div className="automation-title"><span className="ws-icon"><BrandIcon id={platform} size={18} /></span><div><h2>DM replies</h2><p>Set replies for incoming messages and separately choose whether to DM people who comment.</p></div></div>
            <label className="automation-toggle"><input type="checkbox" checked={rules.comment_enabled} onChange={(e) => set('comment_enabled', e.target.checked)} /><span><b>Auto DM commenters</b><small>Send a private message for matching comments. This does not control replies to incoming DMs.</small></span></label>
            {field('DM keyword', 'dm_keyword', 'e.g. HOURS', 'Leave empty to use only the default reply.')}
            {field('Reply when keyword matches', 'dm_reply', 'We are open Monday to Saturday…', '', true)}
            {field('Default reply', 'default_reply', 'Thanks for messaging us. We will get back to you soon.', 'Sent for inbound messages when no keyword matches.', true)}
          </section></BorderGlow>
        </div>}
        {platform !== 'google-business' && <p className="ws-footnote">{platformName} messaging is subject to Meta permissions and messaging windows. A comment-triggered private reply alone does not open an ongoing conversation; the person needs to respond before follow-up messages are available.</p>}
      </>}
    </main>
  </div>;
}
