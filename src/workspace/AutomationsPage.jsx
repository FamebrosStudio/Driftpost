import BorderGlow from '../components/reactbits/BorderGlow.jsx';
import React, { useEffect, useState } from 'react';
import BrandIcon from '../brand.jsx';
import { api } from '../lib.js';
import { WorkspaceNav } from './Workspace.jsx';
import './workspace.css';

const EMPTY = { comment_enabled: false, public_reply_enabled: false, comment_keyword: '', public_reply: '', private_reply: '', dm_keyword: '', dm_reply: '', default_reply: '', excluded_words: '' };
const HAIR_MATCH_REPLY = 'We\u2019re sorry our service didn\u2019t meet your expectations. We\u2019ll review your concerns with our team and work towards providing you with a better experience at Hair Match Salon.';
const DEFAULT_STAR_REPLIES = {
  1: [
    'We are sorry you had a bad experience. We will try to do better.',
    'Sorry to hear this. Your feedback is important to us.',
    'We are sorry we could not make you happy. We hope to do better next time.',
    'Thank you for telling us. We will work on making things better.',
    'We are sorry you feel this way. We would like to know what went wrong.',
    'Sorry for the trouble. We hope you give us another chance.',
    'We feel bad that you did not have a good experience. We will try our best to improve.',
    'We are sorry to hear this. Please contact us so we can understand the problem.',
  ],
  2: [
    'Thank you for your review. We will try to make your next visit better.',
    'Sorry we could not meet your hopes. We will work on improving.',
    'Thank you for sharing your thoughts. We will try to do better.',
    'We are sorry you were not fully happy. Your feedback helps us improve.',
    'Thank you for being honest. We hope to give you a better experience next time.',
    'We are sorry things did not go well. We will keep working to improve.',
    'Thank you for your feedback. We hope to make you happier next time.',
    'We are sorry for any trouble. Thank you for helping us get better.',
  ],
  3: [
    'Thank you for your review! We hope to make your next visit even better.',
    'Thanks for your feedback. We are always trying to improve.',
    'Thank you for visiting us! We hope to see you again soon.',
    'We are happy you shared your thoughts. We will keep working to do better.',
    'Thanks for your rating! We hope to earn five stars next time.',
    'Thank you for choosing us. We hope your next experience is even better.',
    'Your review means a lot to us. Thank you for helping us improve.',
    'Thanks for sharing your experience! We hope to see you again.',
  ],
  4: [
    'Thank you so much! We are happy you liked our service.',
    'Thanks for your lovely review! Hope to see you again soon.',
    'We are happy you had a good experience. Thank you!',
    'Thank you for your support! It means a lot to us.',
    'So happy to see your rating! Thanks for choosing us.',
    'Thank you! We are glad you enjoyed your visit.',
    'Your kind review made us smile! Hope to see you again.',
    'Thanks for the four stars! We hope to make your next visit even better.',
  ],
  5: [
    'Thank you so much for the five stars! We are so happy!',
    'Wow! Thank you for your lovely review. Hope to see you again!',
    'Your five stars made our day! Thank you for your love and support.',
    'Thank you! We are so glad you had a great time with us.',
    'We love happy customers! Thanks for your amazing review.',
    'Big thanks for the five stars! We hope to see you again soon.',
    'Thank you for choosing us! Your support means a lot.',
    'We are so happy you liked us! Thank you for your five-star rating.',
  ],
};

function defaultStarDraftFor(accountName, savedStarReplies) {
  const isHairMatch = /hair\s*match/i.test(String(accountName || ''));
  const draft = {};
  for (const star of [1, 2, 3, 4, 5]) {
    const saved = savedStarReplies?.[star] || savedStarReplies?.[String(star)];
    if (Array.isArray(saved) && saved.length) {
      draft[star] = saved.join('\n');
    } else if (typeof saved === 'string' && saved.trim()) {
      draft[star] = saved.trim();
    } else if (isHairMatch && star <= 2) {
      draft[star] = HAIR_MATCH_REPLY;
    } else {
      draft[star] = DEFAULT_STAR_REPLIES[star].join('\n');
    }
  }
  return draft;
}

export default function AutomationsPage({ session, onNavigate, onSignOut }) {
  const [platform, setPlatform] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('connected') === 'google-business' || params.has('google_business_error') ? 'google-business' : 'instagram';
  });
  const platformName = platform === 'facebook' ? 'Facebook' : platform === 'google-business' ? 'Google Business Profile' : 'Instagram';
  const [accounts, setAccounts] = useState([]);
  const [googleConnections, setGoogleConnections] = useState([]);
  const [refreshingConnection, setRefreshingConnection] = useState('');
  const [checkingReviews, setCheckingReviews] = useState(false);
  const [starDraft, setStarDraft] = useState(() => defaultStarDraftFor('', null));
  const [reviews, setReviews] = useState([]);
  const [loadingReviews, setLoadingReviews] = useState(false);
  const [replyDrafts, setReplyDrafts] = useState({});
  const [savingReviewId, setSavingReviewId] = useState('');
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
    setStarDraft(defaultStarDraftFor(account.name, savedRules.star_replies));
  }, [accounts, selected]);

  const loadLocationReviews = async (locationId = selected) => {
    if (!locationId || platform !== 'google-business') return;
    setLoadingReviews(true);
    try {
      const data = await api(`/api/automations/google-business/${encodeURIComponent(locationId)}/reviews`, session.access_token);
      const list = Array.isArray(data.reviews) ? data.reviews : [];
      setReviews(list);
      const drafts = {};
      for (const r of list) {
        drafts[r.reviewId] = r.replyComment || '';
      }
      setReplyDrafts(drafts);
    } catch (e) {
      setError(e.message || 'Could not load Google reviews.');
    } finally {
      setLoadingReviews(false);
    }
  };

  useEffect(() => {
    setMessage('');
    setError('');
    setReviews([]);
    setReplyDrafts({});
  }, [selected]);

  const set = (key, value) => setRules((current) => ({ ...current, [key]: value }));
  const sortedAccounts = [...accounts].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base', numeric: true }));
  const matchingAccounts = sortedAccounts.filter((account) => String(account.name || '').toLocaleLowerCase().includes(accountSearch.trim().toLocaleLowerCase()));
  const selectedAccount = accounts.find((account) => account.id === selected);
  const selectedOutsideSearch = selectedAccount && accountSearch && !matchingAccounts.some((account) => account.id === selected);
  const save = async () => {
    if (!selected || saving) return;
    setSaving(true); setError(''); setMessage('');
    try {
      const reviewMode = rules.mode === 'template' ? 'template' : 'default';
      const star_replies = {};
      for (const star of [1, 2, 3, 4, 5]) {
        star_replies[star] = String(starDraft[star] || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      }
      const payload = platform === 'google-business'
        ? { enabled, mode: reviewMode, reply_text: rules.reply_text || '', minimum_rating: rules.minimum_rating || 1, star_replies }
        : { enabled, ...rules };
      const data = await api(platform === 'google-business' ? `/api/automations/google-business/${encodeURIComponent(selected)}` : `/api/automations/${platform}/${encodeURIComponent(selected)}`, session.access_token, {
        method: 'PUT', body: JSON.stringify(payload),
      });
      setAccounts((current) => current.map((item) => item.id === selected ? { ...item, enabled: data.enabled, rules: data.rules } : item));
      if (platform === 'google-business' && data.review_sync) {
        if (data.review_sync.error) {
          setMessage('Automation saved and enabled.');
          setError(data.review_sync.error);
        } else {
          const { checked = 0, replied = 0 } = data.review_sync;
          setMessage(`Automation saved and enabled. Checked ${checked} review${checked === 1 ? '' : 's'}, sent ${replied} repl${replied === 1 ? 'y' : 'ies'}.`);
        }
      } else {
        setMessage(data.enabled ? 'Automation saved and enabled.' : 'Automation saved and paused.');
      }
    } catch (e) { setError(e.message || 'Could not save your automation.'); }
    finally { setSaving(false); }
  };

  const saveSingleReviewReply = async (reviewId, overrideComment) => {
    if (!selected || !reviewId || savingReviewId) return;
    const comment = String(overrideComment !== undefined ? overrideComment : (replyDrafts[reviewId] || '')).trim();
    if (!comment) {
      setError('Write a reply before updating Google.');
      return;
    }
    setSavingReviewId(reviewId); setError(''); setMessage('');
    try {
      const data = await api(`/api/automations/google-business/${encodeURIComponent(selected)}/reviews/${encodeURIComponent(reviewId)}/reply`, session.access_token, {
        method: 'PUT',
        body: JSON.stringify({ comment }),
      });
      setReviews((prev) => prev.map((r) => (r.reviewId === reviewId ? { ...r, replyComment: data.comment } : r)));
      setReplyDrafts((prev) => ({ ...prev, [reviewId]: data.comment }));
      setMessage('Updated review reply on Google Business Profile.');
    } catch (e) {
      setError(e.message || 'Could not update review reply.');
    } finally {
      setSavingReviewId('');
    }
  };

  const checkReviewsNow = async () => {
    if (!selected || checkingReviews || saving) return;
    setCheckingReviews(true); setError(''); setMessage('');
    try {
      const data = await api(`/api/automations/google-business/${encodeURIComponent(selected)}/check`, session.access_token, { method: 'POST' });
      const { checked = 0, replied = 0 } = data;
      setMessage(`Checked ${checked} review${checked === 1 ? '' : 's'}, sent ${replied} repl${replied === 1 ? 'y' : 'ies'}.`);
    } catch (e) { setError(e.message || 'Could not check Google reviews.'); }
    finally { setCheckingReviews(false); }
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
        {platform === 'google-business' ? <div className="automation-grid"><BorderGlow className="bg-glow" backgroundColor="#071019" borderRadius={0} glowColor="199 95 74" colors={['#7dd3fc', '#4dc3f7', '#a5ddfa']} fillOpacity={0.12} glowRadius={22}><section className="ws-panel"><div className="automation-title"><span className="ws-icon"><BrandIcon id="google" size={18} /></span><div><h2>Review auto-reply</h2><p>All 1★–5★ replies are set by default. Turn it on for this business or edit any star rating's replies below.</p></div></div><label className="automation-toggle"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /><span><b>Automation is {enabled ? 'on' : 'paused'}</b><small>Replies run immediately when saved and every five minutes.</small></span></label><label className="automation-field"><span>Reply style</span><select value={rules.mode === 'template' ? 'template' : 'default'} onChange={(e) => set('mode', e.target.value)}><option value="default">1★–5★ star-based replies (automatic)</option><option value="template">Single custom reply template</option></select><small>Star-based mode automatically picks a matching reply for 1, 2, 3, 4, and 5 star reviews.</small></label>{rules.mode === 'template' ? field('Reply template', 'reply_text', 'Thank you for taking the time to leave us a review!', 'Use a fixed, human-reviewed response. Replies are public and sent as your business.', true) : <details className="automation-field" style={{ marginTop: '4px' }}><summary style={{ cursor: 'pointer', fontWeight: 600 }}>Edit 1★–5★ reply templates (one reply per line)</summary><div style={{ display: 'grid', gap: '10px', marginTop: '10px' }}>{[1, 2, 3, 4, 5].map((star) => <label key={star} className="automation-field"><span>{star}★ Review Replies ({String(starDraft[star] || '').split(/\r?\n/).filter((s) => s.trim()).length})</span><textarea rows={3} value={starDraft[star] || ''} onChange={(e) => setStarDraft((prev) => ({ ...prev, [star]: e.target.value }))} placeholder={`Enter ${star}-star replies (one per line)`} /></label>)}<div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}><button type="button" className="ws-secondary" onClick={() => setStarDraft((prev) => ({ ...prev, 1: HAIR_MATCH_REPLY, 2: HAIR_MATCH_REPLY }))}>Use Hair Match Salon apology for 1★–2★</button><button type="button" className="ws-secondary" onClick={() => setStarDraft(defaultStarDraftFor(selectedAccount?.name, null))}>Reset to default 1★–5★ replies</button></div></div></details>}<label className="automation-field"><span>Minimum star rating</span><select value={rules.minimum_rating || 1} onChange={(e) => set('minimum_rating', Number(e.target.value))}>{[1,2,3,4,5].map((rating) => <option key={rating} value={rating}>{rating}+ stars</option>)}</select><small>Keep at 1+ stars to reply to every rating automatically.</small></label><div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '8px' }}><button type="button" className="ws-secondary" disabled={!selected || checkingReviews || saving || !selectedAccount?.enabled} onClick={checkReviewsNow}>{checkingReviews ? 'Checking reviews…' : 'Check & reply now'}</button><button type="button" className="ws-secondary" disabled={!selected || loadingReviews} onClick={() => loadLocationReviews(selected)}>{loadingReviews ? 'Loading reviews…' : 'Load & edit posted review replies'}</button></div>{reviews.length > 0 && <div style={{ display: 'grid', gap: '12px', marginTop: '14px', paddingTop: '14px', borderTop: '1px solid rgba(255,255,255,0.1)' }}><b>Recent Google Reviews ({reviews.length}) — Edit or replace any reply</b>{reviews.map((rev) => <div key={rev.reviewId} style={{ padding: '12px', border: '1px solid rgba(255,255,255,0.12)', display: 'grid', gap: '8px' }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}><strong>{rev.reviewerName} · {'★'.repeat(rev.starRating || 0)} ({rev.starRating}★)</strong><small>{rev.replyComment ? 'Replied' : 'No owner reply yet'}</small></div>{rev.comment && <p style={{ margin: 0, opacity: 0.9 }}>{rev.comment}</p>}<textarea rows={3} value={replyDrafts[rev.reviewId] ?? ''} onChange={(e) => setReplyDrafts((prev) => ({ ...prev, [rev.reviewId]: e.target.value }))} placeholder="Write or edit owner reply…" /><div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}><button type="button" className="ws-primary" disabled={savingReviewId === rev.reviewId} onClick={() => saveSingleReviewReply(rev.reviewId)}>{savingReviewId === rev.reviewId ? 'Updating…' : (rev.replyComment ? 'Replace reply on Google' : 'Send reply on Google')}</button><button type="button" className="ws-secondary" disabled={savingReviewId === rev.reviewId} onClick={() => { setReplyDrafts((prev) => ({ ...prev, [rev.reviewId]: HAIR_MATCH_REPLY })); void saveSingleReviewReply(rev.reviewId, HAIR_MATCH_REPLY); }}>Replace with Hair Match Salon reply</button></div></div>)}</div>}<p className="ws-footnote">Each review event is deduplicated before auto-replying; use the review editor above anytime to manually edit or replace a reply on Google.</p></section></BorderGlow></div> : <div className="automation-grid">
          <BorderGlow className="bg-glow" backgroundColor="#071019" borderRadius={0} glowColor="199 95 74" colors={['#7dd3fc', '#4dc3f7', '#a5ddfa']} fillOpacity={0.12} glowRadius={22}><section className="ws-panel"><div className="automation-title"><span className="ws-icon"><BrandIcon id={platform} size={18} /></span><div><h2>Replies to comments</h2><p>Choose whether matching comments get a public reply, a private DM, or both. Each action has its own switch.</p></div></div>
            <label className="automation-toggle"><input type="checkbox" checked={rules.public_reply_enabled} onChange={(e) => set('public_reply_enabled', e.target.checked)} /><span><b>Auto-reply publicly to comments</b><small>Post a reply under each matching comment. Turn this off to stop public replies.</small></span></label>
            {field('Comment keyword filter (optional)', 'comment_keyword', 'e.g. PRICE', 'Leave blank to match every new comment. This filter applies to both auto-DM and public replies.')}
            {field('Excluded words (optional)', 'excluded_words', 'e.g. spam, refund, scam', 'Comma-separated words or phrases. Comments or DMs containing any of these will be ignored.')}
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
