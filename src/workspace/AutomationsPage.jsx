import React, { useEffect, useState } from 'react';
import BorderGlow from '../components/reactbits/BorderGlow.jsx';
import BrandIcon from '../brand.jsx';
import { api } from '../lib.js';
import { WorkspaceNav } from './Workspace.jsx';
import './workspace.css';

const EMPTY = {
  comment_enabled: false,
  public_reply_enabled: false,
  comment_keyword: '',
  public_reply: '',
  private_reply: '',
  dm_keyword: '',
  dm_reply: '',
  default_reply: '',
  excluded_words: '',
  dm_excluded_words: '',
  mode: 'default',
  reply_text: '',
  minimum_rating: 1,
};

const HAIR_MATCH_REPLY =
  'We\u2019re sorry our service didn\u2019t meet your expectations. We\u2019ll review your concerns with our team and work towards providing you with a better experience at Hair Match Salon.';

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

const PLATFORMS = [
  { id: 'instagram', label: 'Instagram', icon: 'instagram' },
  { id: 'facebook', label: 'Facebook', icon: 'facebook' },
  { id: 'google-business', label: 'Google Business', icon: 'google' },
];

function PlatformIcon({ icon }) {
  if (icon === 'google') {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M21.805 10.023H12v3.955h5.617c-.242 1.298-.977 2.398-2.082 3.133v2.602h3.367c1.97-1.813 3.103-4.484 3.103-7.656 0-.68-.062-1.355-.2-2.034z"
          fill="#4285F4"
        />
        <path
          d="M12 22c2.81 0 5.168-.93 6.891-2.518l-3.367-2.602c-.934.625-2.129.996-3.524.996-2.711 0-5.008-1.832-5.828-4.293H2.695v2.688C4.41 19.676 7.93 22 12 22z"
          fill="#34A853"
        />
        <path
          d="M6.172 13.583A5.97 5.97 0 0 1 5.852 12c0-.551.098-1.086.32-1.583V7.729H2.695A9.996 9.996 0 0 0 2 12c0 1.613.387 3.141 1.07 4.488l3.102-2.905z"
          fill="#FBBC05"
        />
        <path
          d="M12 6.125c1.527 0 2.898.523 3.977 1.555l2.984-2.984C17.164 3.016 14.805 2 12 2 7.93 2 4.41 4.324 2.695 7.729l3.477 2.688C6.992 7.957 9.289 6.125 12 6.125z"
          fill="#EA4335"
        />
      </svg>
    );
  }
  return <BrandIcon id={icon} size={15} />;
}

function AutoCard({ className = '', children }) {
  return (
    <BorderGlow
      className="bg-glow auto-glow-wrap"
      backgroundColor="#0e0f16"
      borderRadius={16}
      glowColor="250 85 74"
      colors={['#a78bfa', '#7c6df2', '#c4b5fd']}
      fillOpacity={0.12}
      glowRadius={22}
    >
      <section className={`auto-card ${className}`.trim()}>{children}</section>
    </BorderGlow>
  );
}

function ToggleSwitch({ checked, onChange, label, description }) {
  return (
    <label className="auto-toggle-row">
      <div className="auto-toggle-text">
        <span className="auto-toggle-label">{label}</span>
        {description ? <span className="auto-toggle-desc">{description}</span> : null}
      </div>
      <span className={`auto-switch ${checked ? 'is-on' : ''}`}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="auto-switch-thumb" />
      </span>
    </label>
  );
}

export default function AutomationsPage({ session, onNavigate, onSignOut }) {
  const [platform, setPlatform] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('connected') === 'google-business' || params.has('google_business_error')
      ? 'google-business'
      : 'instagram';
  });
  const platformName =
    platform === 'facebook'
      ? 'Facebook'
      : platform === 'google-business'
        ? 'Google Business Profile'
        : 'Instagram';

  const [accounts, setAccounts] = useState([]);
  const [googleConnections, setGoogleConnections] = useState([]);
  const [showConnections, setShowConnections] = useState(false);
  const [refreshingConnection, setRefreshingConnection] = useState('');
  const [checkingReviews, setCheckingReviews] = useState(false);
  const [starDraft, setStarDraft] = useState(() => defaultStarDraftFor('', null));
  const [showStarReplies, setShowStarReplies] = useState(false);
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
  const [error, setError] = useState(
    () => new URLSearchParams(window.location.search).get('google_business_error') || ''
  );
  const [message, setMessage] = useState(() =>
    new URLSearchParams(window.location.search).get('connected') === 'google-business'
      ? 'Google Business Profile account connected.'
      : ''
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('oauth_error')) {
      setError(`Google connection failed: ${params.get('oauth_error')}`);
    }
    if (
      params.has('connected') ||
      params.has('oauth_error') ||
      params.has('google_business_error')
    ) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setAccounts([]);
    setSelected('');
    setAccountSearch('');
    api(
      platform === 'google-business'
        ? '/api/automations/google-business'
        : `/api/automations/${platform}`,
      session?.access_token
    )
      .then((data) => {
        if (!active) return;
        const conns = platform === 'google-business' ? data.connections || [] : [];
        setGoogleConnections(conns);
        if (platform === 'google-business' && conns.length === 0) {
          setShowConnections(true);
        }
        if (platform === 'google-business' && conns.length) {
          setError('');
        }
        const list = [
          ...(platform === 'google-business'
            ? (data.locations || []).map((item) => ({ ...item, name: item.location_name }))
            : data.accounts || []),
        ].sort((a, b) =>
          String(a.name || '').localeCompare(String(b.name || ''), undefined, {
            sensitivity: 'base',
            numeric: true,
          })
        );
        setAccounts(list);
        setReady(Boolean(data.webhook_ready));
        setSelected(list[0]?.id || '');
      })
      .catch((e) => {
        if (active) setError(e.message || 'Could not load automation.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [session?.access_token, platform]);

  useEffect(() => {
    const account = accounts.find((item) => item.id === selected);
    if (!account) return;
    setEnabled(Boolean(account.enabled));
    const savedRules = account.rules || {};
    const loadedRules = { ...EMPTY, ...savedRules };
    if (savedRules.public_reply_enabled === undefined && savedRules.comment_enabled) {
      loadedRules.comment_enabled = Boolean(String(savedRules.private_reply || '').trim());
      loadedRules.public_reply_enabled = Boolean(String(savedRules.public_reply || '').trim());
    }
    setRules(loadedRules);
    setStarDraft(defaultStarDraftFor(account.name, savedRules.star_replies));
  }, [accounts, selected]);

  useEffect(() => {
    setMessage('');
    setError('');
    setReviews([]);
    setReplyDrafts({});
  }, [selected]);

  const set = (key, value) => setRules((current) => ({ ...current, [key]: value }));

  const sortedAccounts = [...accounts].sort((a, b) =>
    String(a.name || '').localeCompare(String(b.name || ''), undefined, {
      sensitivity: 'base',
      numeric: true,
    })
  );
  const matchingAccounts = sortedAccounts.filter((account) =>
    String(account.name || '')
      .toLocaleLowerCase()
      .includes(accountSearch.trim().toLocaleLowerCase())
  );
  const selectedAccount = accounts.find((account) => account.id === selected);
  const selectedOutsideSearch =
    selectedAccount &&
    accountSearch &&
    !matchingAccounts.some((account) => account.id === selected);

  const save = async () => {
    if (!selected || saving) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const reviewMode = rules.mode === 'template' ? 'template' : 'default';
      const star_replies = {};
      for (const star of [1, 2, 3, 4, 5]) {
        star_replies[star] = String(starDraft[star] || '')
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean);
      }
      const payload =
        platform === 'google-business'
          ? {
              enabled,
              mode: reviewMode,
              reply_text: rules.reply_text || '',
              minimum_rating: rules.minimum_rating || 1,
              star_replies,
            }
          : { enabled, ...rules };
      const data = await api(
        platform === 'google-business'
          ? `/api/automations/google-business/${encodeURIComponent(selected)}`
          : `/api/automations/${platform}/${encodeURIComponent(selected)}`,
        session?.access_token,
        {
          method: 'PUT',
          body: JSON.stringify(payload),
        }
      );
      setAccounts((current) =>
        current.map((item) =>
          item.id === selected ? { ...item, enabled: data.enabled, rules: data.rules } : item
        )
      );
      if (data.background_sync) {
        setMessage(
          platform === 'google-business'
            ? 'Saved & enabled! Checking and replying to unreplied Google reviews in the background.'
            : `Saved & enabled! Subscribing webhooks and replying to unreplied ${platformName} comments in the background.`
        );
      } else {
        setMessage(data.enabled ? 'Automation saved and enabled.' : 'Automation saved and paused.');
      }
    } catch (e) {
      setError(e.message || 'Could not save your automation.');
    } finally {
      setSaving(false);
    }
  };

  const loadLocationReviews = async (locationId = selected) => {
    if (!locationId || platform !== 'google-business') return;
    setLoadingReviews(true);
    try {
      const data = await api(
        `/api/automations/google-business/${encodeURIComponent(locationId)}/reviews`,
        session?.access_token
      );
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

  const saveSingleReviewReply = async (reviewId, overrideComment) => {
    if (!selected || !reviewId || savingReviewId) return;
    const comment = String(
      overrideComment !== undefined ? overrideComment : replyDrafts[reviewId] || ''
    ).trim();
    if (!comment) {
      setError('Write a reply before updating Google.');
      return;
    }
    setSavingReviewId(reviewId);
    setError('');
    setMessage('');
    try {
      const data = await api(
        `/api/automations/google-business/${encodeURIComponent(selected)}/reviews/${encodeURIComponent(reviewId)}/reply`,
        session?.access_token,
        {
          method: 'PUT',
          body: JSON.stringify({ comment }),
        }
      );
      setReviews((prev) =>
        prev.map((r) => (r.reviewId === reviewId ? { ...r, replyComment: data.comment } : r))
      );
      setReplyDrafts((prev) => ({ ...prev, [reviewId]: data.comment }));
      setMessage('Updated review reply on Google Business Profile.');
    } catch (e) {
      setError(e.message || 'Could not update review reply.');
    } finally {
      setSavingReviewId('');
    }
  };

  const checkMetaCommentsNow = async () => {
    if (!selected || checkingReviews || saving) return;
    setCheckingReviews(true);
    setError('');
    setMessage('');
    try {
      const data = await api(
        `/api/automations/${platform}/${encodeURIComponent(selected)}/check`,
        session?.access_token,
        { method: 'POST' }
      );
      const { checked = 0, replied = 0 } = data;
      setMessage(
        `Checked ${checked} recent comment${checked === 1 ? '' : 's'}, sent ${replied} repl${replied === 1 ? 'y' : 'ies'}.`
      );
    } catch (e) {
      setError(e.message || `Could not check ${platformName} comments.`);
    } finally {
      setCheckingReviews(false);
    }
  };

  const checkReviewsNow = async () => {
    if (!selected || checkingReviews || saving) return;
    setCheckingReviews(true);
    setError('');
    setMessage('');
    try {
      const data = await api(
        `/api/automations/google-business/${encodeURIComponent(selected)}/check`,
        session?.access_token,
        { method: 'POST' }
      );
      const { checked = 0, replied = 0 } = data;
      setMessage(
        `Checked ${checked} review${checked === 1 ? '' : 's'}, sent ${replied} repl${replied === 1 ? 'y' : 'ies'}.`
      );
    } catch (e) {
      setError(e.message || 'Could not check Google reviews.');
    } finally {
      setCheckingReviews(false);
    }
  };

  const refreshLocations = async (connectionId) => {
    if (refreshingConnection) return;
    setRefreshingConnection(connectionId);
    setError('');
    setMessage('');
    try {
      const result = await api(
        `/api/automations/google-business/connections/${encodeURIComponent(connectionId)}/refresh`,
        session?.access_token,
        { method: 'POST' }
      );
      const data = await api('/api/automations/google-business', session?.access_token);
      setGoogleConnections(data.connections || []);
      const locations = (data.locations || [])
        .map((item) => ({ ...item, name: item.location_name }))
        .sort((a, b) =>
          String(a.name || '').localeCompare(String(b.name || ''), undefined, {
            sensitivity: 'base',
            numeric: true,
          })
        );
      setAccounts(locations);
      setSelected((current) =>
        current && locations.some((item) => item.id === current) ? current : locations[0]?.id || ''
      );
      setMessage(
        result.count
          ? `Found ${result.count} business location${result.count === 1 ? '' : 's'}.`
          : 'Google account connected. No Business Profile locations are currently available for this account.'
      );
    } catch (e) {
      setError(e.message || 'Could not refresh Google business locations.');
    } finally {
      setRefreshingConnection('');
    }
  };

  const connectGoogleAccount = () => {
    api('/api/oauth/google-business/start', session?.access_token, { method: 'POST' })
      .then((data) => {
        try {
          localStorage.setItem('driftpost-after-google-business-connect', 'automations');
        } catch {
          // ignore storage quota errors
        }
        window.location.assign(data.url);
      })
      .catch((e) => setError(e.message || 'Could not start Google connection.'));
  };

  const isGoogle = platform === 'google-business';

  return (
    <div className="ws">
      <WorkspaceNav
        page="automations"
        onNavigate={onNavigate}
        email={session?.user?.email}
        onSignOut={onSignOut}
      />
      <main className="ws-main auto-page">
        {/* Top Header */}
        <header className="auto-header">
          <div>
            <h1 className="auto-title">
              {isGoogle ? 'Google Review Auto-Replies' : `${platformName} Automations`}
            </h1>
            <p className="auto-subtitle">
              {isGoogle
                ? 'Automatically reply to 1★–5★ Google Business Profile reviews.'
                : `Automatically reply to ${platformName} comments and incoming DMs.`}
            </p>
          </div>
          <div className="auto-header-actions">
            {!isGoogle ? (
              <span className={`auto-status-pill ${ready ? 'is-ready' : ''}`}>
                <span className="auto-status-dot" />
                {ready ? 'Webhook active' : 'Setup required'}
              </span>
            ) : null}
            <button
              type="button"
              className="auto-btn-primary"
              disabled={saving || !selected}
              onClick={save}
            >
              {saving ? 'Saving…' : 'Save automation'}
            </button>
          </div>
        </header>

        {/* Segmented Platform Switcher */}
        <div className="auto-segmented" role="tablist" aria-label="Platform">
          {PLATFORMS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={platform === p.id}
              disabled={saving}
              className={`auto-seg-btn ${platform === p.id ? 'is-active' : ''}`}
              onClick={() => {
                if (platform === p.id) return;
                setSelected('');
                setAccounts([]);
                setGoogleConnections([]);
                setAccountSearch('');
                setLoading(true);
                setError('');
                setMessage('');
                setPlatform(p.id);
              }}
            >
              <PlatformIcon icon={p.icon} />
              <span>{p.label}</span>
            </button>
          ))}
        </div>

        {/* Feedback Banners */}
        {error ? <div className="auto-banner is-error">{error}</div> : null}
        {message ? <div className="auto-banner is-success">{message}</div> : null}

        {/* Google Business Connections Bar */}
        {isGoogle ? (
          <section className="auto-card auto-connections-card">
            <div className="auto-connections-top">
              <div className="auto-connections-summary">
                <span className="auto-card-title">Connected Google Accounts</span>
                <span className="auto-muted">
                  {googleConnections.length === 0
                    ? 'Connect a Google account that manages your Business Profile locations.'
                    : `${googleConnections.length} Google account${googleConnections.length > 1 ? 's' : ''} linked · ${accounts.length} location${accounts.length === 1 ? '' : 's'}`}
                </span>
              </div>
              <div className="auto-connections-actions">
                <button
                  type="button"
                  className="auto-btn-secondary"
                  disabled={saving}
                  onClick={connectGoogleAccount}
                >
                  + Connect Google Account
                </button>
                {googleConnections.length > 0 ? (
                  <button
                    type="button"
                    className="auto-btn-ghost"
                    onClick={() => setShowConnections((v) => !v)}
                  >
                    {showConnections ? 'Hide accounts' : 'Manage accounts'}
                  </button>
                ) : null}
              </div>
            </div>

            {showConnections && googleConnections.length > 0 ? (
              <div className="auto-connections-list">
                {googleConnections.map((conn) => (
                  <div key={conn.id} className="auto-conn-row">
                    <div className="auto-conn-info">
                      <span className="auto-conn-name">{conn.google_email}</span>
                      <span className="auto-muted">
                        {conn.locations_count
                          ? `${conn.locations_count} location${conn.locations_count === 1 ? '' : 's'} found`
                          : 'No locations found yet'}
                        {conn.locations_synced_at
                          ? ` · Synced ${new Date(conn.locations_synced_at).toLocaleString()}`
                          : ''}
                      </span>
                      {conn.location_sync_error ? (
                        <span className="auto-conn-err">{conn.location_sync_error}</span>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="auto-btn-secondary"
                      disabled={Boolean(refreshingConnection)}
                      onClick={() => refreshLocations(conn.id)}
                    >
                      {refreshingConnection === conn.id ? 'Checking…' : 'Retry location discovery'}
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}

        {/* Account / Location Selector + Master Toggle */}
        {loading ? (
          <div className="auto-empty">Loading {platformName} accounts…</div>
        ) : accounts.length === 0 ? (
          <div className="auto-empty">
            <p style={{ margin: '0 0 10px', fontWeight: 600, color: '#f5f5f7' }}>
              {isGoogle
                ? 'No business locations connected yet'
                : `No connected ${platformName} accounts found`}
            </p>
            <p style={{ margin: '0 0 14px' }}>
              {isGoogle
                ? 'Connect a Google account above so your Business Profile locations appear here.'
                : `Connect your ${platformName} account in Accounts to configure automatic replies.`}
            </p>
            {!isGoogle ? (
              <button
                type="button"
                className="auto-btn-primary"
                onClick={() => onNavigate('accounts')}
              >
                Open connected accounts
              </button>
            ) : null}
          </div>
        ) : (
          <>
            <section className="auto-card auto-account-bar">
              <div className="auto-account-controls">
                <div className="auto-field">
                  <label className="auto-label" htmlFor="auto-search">
                    Search {isGoogle ? 'locations' : 'accounts'}
                  </label>
                  <input
                    id="auto-search"
                    type="search"
                    className="auto-input"
                    placeholder={`Filter ${accounts.length} ${isGoogle ? 'locations' : 'accounts'}…`}
                    value={accountSearch}
                    onChange={(e) => setAccountSearch(e.target.value)}
                  />
                </div>

                <div className="auto-field auto-field-grow">
                  <label className="auto-label" htmlFor="auto-select">
                    {isGoogle ? 'Business Location' : `${platformName} Account`} ({matchingAccounts.length})
                  </label>
                  <select
                    id="auto-select"
                    className="auto-select"
                    value={selected}
                    disabled={saving}
                    onChange={(e) => setSelected(e.target.value)}
                  >
                    {selectedOutsideSearch ? (
                      <optgroup label="Current selection">
                        <option value={selected}>
                          {selectedAccount.name} · {selectedAccount.enabled ? 'ON' : 'PAUSED'}
                        </option>
                      </optgroup>
                    ) : null}
                    {matchingAccounts.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                        {item.address ? ` · ${item.address}` : ''} ·{' '}
                        {item.enabled ? 'ON' : 'PAUSED'}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="auto-account-toggle">
                <ToggleSwitch
                  checked={enabled}
                  onChange={setEnabled}
                  label={enabled ? 'Automation ON' : 'Automation Paused'}
                  description={selectedAccount?.name || 'Selected account'}
                />
              </div>
            </section>

            {isGoogle ? (
              <div className="auto-stack">
                {/* Google Auto-Reply Rules */}
                <AutoCard>
                  <div className="auto-card-head">
                    <div>
                      <h2 className="auto-card-title">Review Auto-Reply Rules</h2>
                      <p className="auto-card-sub">
                        All 1★–5★ replies are pre-configured. Runs automatically when saved and every few minutes.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="auto-btn-secondary"
                      disabled={!selected || checkingReviews || saving || !selectedAccount?.enabled}
                      onClick={checkReviewsNow}
                    >
                      {checkingReviews ? 'Checking reviews…' : 'Check & reply now'}
                    </button>
                  </div>

                  <div className="auto-grid-2">
                    <div className="auto-field">
                      <label className="auto-label" htmlFor="gb-mode">
                        Reply style
                      </label>
                      <select
                        id="gb-mode"
                        className="auto-select"
                        value={rules.mode === 'template' ? 'template' : 'default'}
                        onChange={(e) => set('mode', e.target.value)}
                      >
                        <option value="default">1★–5★ star-based replies (automatic)</option>
                        <option value="template">Single custom reply template</option>
                      </select>
                    </div>

                    <div className="auto-field">
                      <label className="auto-label" htmlFor="gb-min-rating">
                        Minimum star rating
                      </label>
                      <select
                        id="gb-min-rating"
                        className="auto-select"
                        value={rules.minimum_rating || 1}
                        onChange={(e) => set('minimum_rating', Number(e.target.value))}
                      >
                        {[1, 2, 3, 4, 5].map((rating) => (
                          <option key={rating} value={rating}>
                            {rating}+ stars
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {rules.mode === 'template' ? (
                    <div className="auto-field" style={{ marginTop: 14 }}>
                      <label className="auto-label" htmlFor="gb-template">
                        Reply template
                      </label>
                      <textarea
                        id="gb-template"
                        className="auto-textarea"
                        rows={3}
                        maxLength={1000}
                        value={rules.reply_text || ''}
                        onChange={(e) => set('reply_text', e.target.value)}
                        placeholder="Thank you for taking the time to leave us a review!"
                      />
                    </div>
                  ) : (
                    <div className="auto-star-section">
                      <div className="auto-star-bar">
                        <button
                          type="button"
                          className="auto-btn-secondary"
                          onClick={() => setShowStarReplies((v) => !v)}
                        >
                          {showStarReplies
                            ? 'Hide 1★–5★ reply templates'
                            : 'Edit 1★–5★ reply templates (one per line)'}
                        </button>
                        <div className="auto-star-presets">
                          <button
                            type="button"
                            className="auto-btn-secondary"
                            onClick={() => {
                              setStarDraft((prev) => ({
                                ...prev,
                                1: HAIR_MATCH_REPLY,
                                2: HAIR_MATCH_REPLY,
                              }));
                              setShowStarReplies(true);
                            }}
                          >
                            Use Hair Match Salon apology for 1★–2★
                          </button>
                          <button
                            type="button"
                            className="auto-btn-ghost"
                            onClick={() =>
                              setStarDraft(defaultStarDraftFor(selectedAccount?.name, null))
                            }
                          >
                            Reset defaults
                          </button>
                        </div>
                      </div>

                      {showStarReplies ? (
                        <div className="auto-star-list">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <div key={star} className="auto-field">
                              <label className="auto-label" htmlFor={`star-${star}`}>
                                {star}★ Review Replies (
                                {
                                  String(starDraft[star] || '')
                                    .split(/\r?\n/)
                                    .filter((s) => s.trim()).length
                                }{' '}
                                variations)
                              </label>
                              <textarea
                                id={`star-${star}`}
                                className="auto-textarea"
                                rows={3}
                                value={starDraft[star] || ''}
                                onChange={(e) =>
                                  setStarDraft((prev) => ({ ...prev, [star]: e.target.value }))
                                }
                                placeholder={`Enter ${star}-star replies (one per line)`}
                              />
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  )}
                </AutoCard>

                {/* Recent Google Reviews Editor */}
                <AutoCard>
                  <div className="auto-card-head">
                    <div>
                      <h2 className="auto-card-title">
                        Posted Google Reviews {reviews.length ? `(${reviews.length})` : ''}
                      </h2>
                      <p className="auto-card-sub">
                        Load recent reviews to manually write, edit, or replace any owner reply on Google.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="auto-btn-secondary"
                      disabled={!selected || loadingReviews}
                      onClick={() => loadLocationReviews(selected)}
                    >
                      {loadingReviews
                        ? 'Loading reviews…'
                        : reviews.length
                          ? 'Refresh reviews'
                          : 'Load & edit posted review replies'}
                    </button>
                  </div>

                  {reviews.length > 0 ? (
                    <div className="auto-reviews-list">
                      {reviews.map((rev) => (
                        <div key={rev.reviewId} className="auto-review-item">
                          <div className="auto-review-meta">
                            <span className="auto-review-author">
                              {rev.reviewerName} ·{' '}
                              <span className="auto-review-stars">
                                {'★'.repeat(rev.starRating || 0)}
                              </span>{' '}
                              ({rev.starRating}★)
                            </span>
                            <span className="auto-muted">
                              {rev.replyComment ? 'Replied' : 'No owner reply yet'}
                            </span>
                          </div>
                          {rev.comment ? <p className="auto-review-body">{rev.comment}</p> : null}
                          <div className="auto-review-reply-row">
                            <textarea
                              className="auto-textarea"
                              rows={3}
                              placeholder="Write or edit owner reply…"
                              value={replyDrafts[rev.reviewId] ?? ''}
                              onChange={(e) =>
                                setReplyDrafts((prev) => ({
                                  ...prev,
                                  [rev.reviewId]: e.target.value,
                                }))
                              }
                            />
                            <div className="auto-review-actions">
                              <button
                                type="button"
                                className="auto-btn-primary"
                                disabled={savingReviewId === rev.reviewId}
                                onClick={() => saveSingleReviewReply(rev.reviewId)}
                              >
                                {savingReviewId === rev.reviewId
                                  ? 'Updating…'
                                  : rev.replyComment
                                    ? 'Replace reply on Google'
                                    : 'Send reply on Google'}
                              </button>
                              <button
                                type="button"
                                className="auto-btn-secondary"
                                disabled={savingReviewId === rev.reviewId}
                                onClick={() => {
                                  setReplyDrafts((prev) => ({
                                    ...prev,
                                    [rev.reviewId]: HAIR_MATCH_REPLY,
                                  }));
                                  void saveSingleReviewReply(rev.reviewId, HAIR_MATCH_REPLY);
                                }}
                              >
                                Replace with Hair Match Salon reply
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </AutoCard>
              </div>
            ) : (
              /* Instagram & Facebook 2-Column Rules */
              <div className="auto-grid-2">
                {/* Replies to comments */}
                <AutoCard>
                  <div className="auto-card-head">
                    <div>
                      <h2 className="auto-card-title">Replies to Comments</h2>
                      <p className="auto-card-sub">
                        Reply publicly under matching comments, send a private DM, or both.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="auto-btn-secondary"
                      disabled={!selected || checkingReviews || saving || !selectedAccount?.enabled}
                      onClick={checkMetaCommentsNow}
                    >
                      {checkingReviews ? 'Checking…' : 'Check & reply now'}
                    </button>
                  </div>

                  <div className="auto-fields">
                    <ToggleSwitch
                      checked={Boolean(rules.public_reply_enabled)}
                      onChange={(v) => set('public_reply_enabled', v)}
                      label="Auto-reply publicly to comments"
                      description="Post a reply under each matching comment"
                    />

                    <div className="auto-field">
                      <label className="auto-label" htmlFor="ig-comment-kw">
                        Comment keyword filter (optional)
                      </label>
                      <input
                        id="ig-comment-kw"
                        className="auto-input"
                        maxLength={80}
                        value={rules.comment_keyword}
                        onChange={(e) => set('comment_keyword', e.target.value)}
                        placeholder="e.g. PRICE (leave blank to match all comments)"
                      />
                    </div>

                    <div className="auto-field">
                      <label className="auto-label" htmlFor="ig-comment-excl">
                        Excluded words (optional)
                      </label>
                      <input
                        id="ig-comment-excl"
                        className="auto-input"
                        maxLength={80}
                        value={rules.excluded_words}
                        onChange={(e) => set('excluded_words', e.target.value)}
                        placeholder="e.g. spam, refund, scam"
                      />
                    </div>

                    <div className="auto-field">
                      <label className="auto-label" htmlFor="ig-public-reply">
                        Public comment reply
                      </label>
                      <textarea
                        id="ig-public-reply"
                        className="auto-textarea"
                        rows={3}
                        maxLength={1000}
                        value={rules.public_reply}
                        onChange={(e) => set('public_reply', e.target.value)}
                        placeholder="Thanks for asking! Check your messages."
                      />
                    </div>

                    <div className="auto-field">
                      <label className="auto-label" htmlFor="ig-private-reply">
                        Private DM reply to the comment
                      </label>
                      <textarea
                        id="ig-private-reply"
                        className="auto-textarea"
                        rows={3}
                        maxLength={1000}
                        value={rules.private_reply}
                        onChange={(e) => set('private_reply', e.target.value)}
                        placeholder="Here are the details you asked for…"
                      />
                    </div>
                  </div>
                </AutoCard>

                {/* DM replies */}
                <AutoCard>
                  <div className="auto-card-head">
                    <div>
                      <h2 className="auto-card-title">DM Replies</h2>
                      <p className="auto-card-sub">
                        Auto-reply to incoming DMs and choose whether to DM people who comment.
                      </p>
                    </div>
                  </div>

                  <div className="auto-fields">
                    <ToggleSwitch
                      checked={Boolean(rules.comment_enabled)}
                      onChange={(v) => set('comment_enabled', v)}
                      label="Auto DM commenters"
                      description="Send the private reply when a comment matches"
                    />

                    <div className="auto-field">
                      <label className="auto-label" htmlFor="ig-dm-kw">
                        DM keyword (optional)
                      </label>
                      <input
                        id="ig-dm-kw"
                        className="auto-input"
                        maxLength={80}
                        value={rules.dm_keyword}
                        onChange={(e) => set('dm_keyword', e.target.value)}
                        placeholder="e.g. HOURS (leave empty to use default reply)"
                      />
                    </div>

                    <div className="auto-field">
                      <label className="auto-label" htmlFor="ig-dm-excl">
                        Excluded words (optional)
                      </label>
                      <input
                        id="ig-dm-excl"
                        className="auto-input"
                        maxLength={80}
                        value={rules.dm_excluded_words}
                        onChange={(e) => set('dm_excluded_words', e.target.value)}
                        placeholder="e.g. spam, refund, scam"
                      />
                    </div>

                    <div className="auto-field">
                      <label className="auto-label" htmlFor="ig-dm-reply">
                        Reply when keyword matches
                      </label>
                      <textarea
                        id="ig-dm-reply"
                        className="auto-textarea"
                        rows={3}
                        maxLength={1000}
                        value={rules.dm_reply}
                        onChange={(e) => set('dm_reply', e.target.value)}
                        placeholder="We are open Monday to Saturday…"
                      />
                    </div>

                    <div className="auto-field">
                      <label className="auto-label" htmlFor="ig-default-reply">
                        Default reply
                      </label>
                      <textarea
                        id="ig-default-reply"
                        className="auto-textarea"
                        rows={3}
                        maxLength={1000}
                        value={rules.default_reply}
                        onChange={(e) => set('default_reply', e.target.value)}
                        placeholder="Thanks for messaging us. We will get back to you soon."
                      />
                    </div>
                  </div>
                </AutoCard>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
