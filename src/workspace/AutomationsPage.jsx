import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib.js';
import BrandIcon from '../brand.jsx';
import { WorkspaceNav } from './Workspace.jsx';

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
};

const DEFAULT_STAR_REPLIES = {
  '5': 'Thank you so much for the 5-star review! We really appreciate your support and look forward to welcoming you again.',
  '4': 'Thank you for the 4-star review! We appreciate your feedback and hope to make your next visit a 5-star experience.',
  '3': 'Thank you for sharing your feedback. We are always looking to improve—please reach out so we can make your next visit even better.',
  '2': 'We are sorry your experience did not meet expectations. Please contact us directly so we can look into this and make things right.',
  '1': 'We sincerely apologize for your experience. Your feedback is important to us—please reach out directly so we can address this right away.',
};

const HAIR_MATCH_SALON_REPLY =
  'Thank you so much for your kind words and for choosing Hair Match Salon! We are thrilled you loved your experience and look forward to seeing you again soon.';

const defaultStarDraftFor = (acct) => {
  const existing = acct?.star_replies && typeof acct.star_replies === 'object' ? acct.star_replies : {};
  return {
    '5': existing['5'] ?? DEFAULT_STAR_REPLIES['5'],
    '4': existing['4'] ?? DEFAULT_STAR_REPLIES['4'],
    '3': existing['3'] ?? DEFAULT_STAR_REPLIES['3'],
    '2': existing['2'] ?? DEFAULT_STAR_REPLIES['2'],
    '1': existing['1'] ?? DEFAULT_STAR_REPLIES['1'],
  };
};

const PLATFORMS = [
  { id: 'instagram', label: 'Instagram' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'google-business', label: 'Google Reviews' },
];

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
  const [platform, setPlatform] = useState('instagram');
  const [accounts, setAccounts] = useState([]);
  const [googleConnections, setGoogleConnections] = useState([]);
  const [showConnections, setShowConnections] = useState(false);
  const [refreshingConnection, setRefreshingConnection] = useState('');
  const [checkingReviews, setCheckingReviews] = useState(false);
  const [starDraft, setStarDraft] = useState(DEFAULT_STAR_REPLIES);
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
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async (targetPlatform, preferredAccountId = null) => {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const data = await api(
        targetPlatform === 'google-business'
          ? '/api/automations/google-business'
          : `/api/automations/${targetPlatform}`
      );
      setReady(Boolean(data.ready));
      const list = data.accounts || [];
      setAccounts(list);
      setGoogleConnections(data.connections || []);
      if ((data.connections || []).length === 0) {
        setShowConnections(true);
      }
      const next =
        (preferredAccountId && list.find((a) => a.id === preferredAccountId)) ||
        list[0];
      if (next) {
        setSelected(next.id);
        setEnabled(Boolean(next.enabled));
        setRules({ ...EMPTY, ...(next.rules || {}) });
        setStarDraft(defaultStarDraftFor(next));
      } else {
        setSelected('');
        setEnabled(false);
        setRules(EMPTY);
        setStarDraft(DEFAULT_STAR_REPLIES);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(platform);
  }, [platform, load]);

  const filteredAccounts = useMemo(() => {
    const q = accountSearch.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter((a) =>
      `${a.label || ''} ${a.account_name || ''} ${a.account_id || ''}`
        .toLowerCase()
        .includes(q)
    );
  }, [accounts, accountSearch]);

  const selectAccount = (id) => {
    setSelected(id);
    const acct = accounts.find((a) => a.id === id);
    setEnabled(Boolean(acct?.enabled));
    setRules({ ...EMPTY, ...(acct?.rules || {}) });
    setStarDraft(defaultStarDraftFor(acct));
    setReviews([]);
    setReplyDrafts({});
    setMessage('');
    setError('');
  };

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await api(
        platform === 'google-business'
          ? `/api/automations/google-business/${selected}`
          : `/api/automations/${platform}/${selected}`,
        {
          method: 'PUT',
          body: JSON.stringify(
            platform === 'google-business'
              ? {
                  enabled,
                  reply_template: rules.reply_template ?? '',
                  minimum_rating: Number(rules.minimum_rating || 1),
                  mode: rules.mode || 'default',
                  star_replies: starDraft,
                }
              : { enabled, rules }
          ),
        }
      );
      setMessage('Saved');
      await load(platform, selected);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const checkReviewsNow = async () => {
    if (!selected) return;
    setCheckingReviews(true);
    setError('');
    setMessage('');
    try {
      const res = await api(`/api/automations/google-business/${selected}/check`, {
        method: 'POST',
      });
      setMessage(
        `Checked ${res.checked || 0} reviews · Replied ${res.replied || 0} · Skipped ${res.skipped || 0}`
      );
      await load(platform, selected);
    } catch (e) {
      setError(e.message);
    } finally {
      setCheckingReviews(false);
    }
  };

  const loadLocationReviews = async (locationId = selected) => {
    if (!locationId) return;
    setLoadingReviews(true);
    setError('');
    try {
      const res = await api(`/api/automations/google-business/${locationId}/reviews`);
      const list = res.reviews || [];
      setReviews(list);
      const nextDrafts = {};
      for (const r of list) {
        nextDrafts[r.id] = r.reply?.comment || '';
      }
      setReplyDrafts(nextDrafts);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingReviews(false);
    }
  };

  const saveSingleReviewReply = async (reviewId, overrideComment = null) => {
    if (!selected || !reviewId) return;
    const comment = String(overrideComment ?? replyDrafts[reviewId] ?? '').trim();
    if (!comment) {
      setError('Reply text cannot be empty');
      return;
    }
    setSavingReviewId(reviewId);
    setError('');
    setMessage('');
    try {
      await api(`/api/automations/google-business/${selected}/reviews/${reviewId}/reply`, {
        method: 'PUT',
        body: JSON.stringify({ comment }),
      });
      setMessage('Review reply updated on Google');
      await loadLocationReviews(selected);
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingReviewId('');
    }
  };

  const refreshLocations = async (connectionId) => {
    setRefreshingConnection(connectionId);
    setError('');
    setMessage('');
    try {
      const res = await api(
        `/api/automations/google-business/connections/${connectionId}/refresh`,
        { method: 'POST' }
      );
      setMessage(`Synced ${res.locations || 0} business location(s).`);
      await load('google-business', selected);
    } catch (e) {
      setError(e.message);
    } finally {
      setRefreshingConnection('');
    }
  };

  const selectedAccount = accounts.find((a) => a.id === selected);
  const isGoogle = platform === 'google-business';

  return (
    <div className="auto-page">
      <WorkspaceNav
        active="automations"
        session={session}
        onNavigate={onNavigate}
        onSignOut={onSignOut}
      />
      {/* Top Header */}
      <header className="auto-header">
        <div>
          <h1 className="auto-title">Automations</h1>
          <p className="auto-subtitle">
            Auto-reply to comments, DMs, and Google reviews.
          </p>
        </div>
        <div className="auto-header-actions">
          <span className={`auto-status-pill ${ready ? 'is-ready' : ''}`}>
            <span className="auto-status-dot" />
            {ready ? 'Active' : 'Not configured'}
          </span>
          <button
            type="button"
            className="auto-btn-primary"
            disabled={saving || !selected}
            onClick={save}
          >
            {saving ? 'Saving…' : 'Save'}
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
            className={`auto-seg-btn ${platform === p.id ? 'is-active' : ''}`}
            onClick={() => {
              setPlatform(p.id);
              setAccountSearch('');
            }}
          >
            <BrandIcon id={p.id === 'google-business' ? 'google' : p.id} size={15} />
            <span>{p.label}</span>
          </button>
        ))}
      </div>

      {/* Feedback Banners */}
      {error ? <div className="auto-banner is-error">{error}</div> : null}
      {message ? <div className="auto-banner is-success">{message}</div> : null}

      {/* Google Connections Bar (compact & collapsible when connected) */}
      {isGoogle ? (
        <section className="auto-card auto-connections-card">
          <div className="auto-connections-top">
            <div className="auto-connections-summary">
              <span className="auto-card-title">Google Business Accounts</span>
              <span className="auto-muted">
                {googleConnections.length === 0
                  ? 'No Google account connected yet'
                  : `${googleConnections.length} account${googleConnections.length > 1 ? 's' : ''} connected`}
              </span>
            </div>
            <div className="auto-connections-actions">
              <a
                className="auto-btn-secondary"
                href="/api/oauth/google-business/start"
              >
                + Connect Google
              </a>
              {googleConnections.length > 0 ? (
                <button
                  type="button"
                  className="auto-btn-ghost"
                  onClick={() => setShowConnections((v) => !v)}
                >
                  {showConnections ? 'Hide' : 'Manage'}
                </button>
              ) : null}
            </div>
          </div>

          {showConnections && googleConnections.length > 0 ? (
            <div className="auto-connections-list">
              {googleConnections.map((conn) => (
                <div key={conn.id} className="auto-conn-row">
                  <div className="auto-conn-info">
                    <span className="auto-conn-name">{conn.email || conn.display_name}</span>
                    {conn.status_error ? (
                      <span className="auto-conn-err">{conn.status_error}</span>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="auto-btn-secondary"
                    disabled={refreshingConnection === conn.id}
                    onClick={() => refreshLocations(conn.id)}
                  >
                    {refreshingConnection === conn.id ? 'Syncing…' : 'Sync locations'}
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Account / Location Selector + Master Toggle */}
      <section className="auto-card auto-account-bar">
        <div className="auto-account-controls">
          <div className="auto-field">
            <label className="auto-label" htmlFor="auto-search">
              Search {isGoogle ? 'locations' : 'accounts'}
            </label>
            <input
              id="auto-search"
              className="auto-input"
              placeholder={isGoogle ? 'Filter locations…' : 'Filter accounts…'}
              value={accountSearch}
              onChange={(e) => setAccountSearch(e.target.value)}
            />
          </div>

          <div className="auto-field auto-field-grow">
            <label className="auto-label" htmlFor="auto-select">
              {isGoogle ? 'Business Location' : 'Account'} ({filteredAccounts.length})
            </label>
            <select
              id="auto-select"
              className="auto-select"
              value={selected}
              onChange={(e) => selectAccount(e.target.value)}
              disabled={loading || filteredAccounts.length === 0}
            >
              {filteredAccounts.length === 0 ? (
                <option value="">
                  {loading
                    ? 'Loading…'
                    : isGoogle
                      ? 'No locations found'
                      : 'No matching accounts'}
                </option>
              ) : (
                filteredAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label || a.account_name || a.account_id}
                    {a.enabled ? ' • ON' : ''}
                  </option>
                ))
              )}
            </select>
          </div>
        </div>

        <div className="auto-account-toggle">
          <ToggleSwitch
            checked={enabled}
            onChange={setEnabled}
            label={enabled ? 'Automation ON' : 'Automation OFF'}
            description={
              selectedAccount
                ? selectedAccount.label || selectedAccount.account_name
                : 'Select an account'
            }
          />
        </div>
      </section>

      {/* Main Workspace */}
      {!selected ? (
        <div className="auto-empty">
          {loading
            ? 'Loading…'
            : isGoogle
              ? 'Connect a Google Business account above to configure auto-replies.'
              : 'No connected accounts found for this platform.'}
        </div>
      ) : isGoogle ? (
        <div className="auto-stack">
          {/* Google Auto-Reply Rules */}
          <section className="auto-card">
            <div className="auto-card-head">
              <div>
                <h2 className="auto-card-title">Auto-Reply Rules</h2>
                <p className="auto-card-sub">
                  Replies automatically to new reviews every 2 minutes when enabled.
                </p>
              </div>
              <button
                type="button"
                className="auto-btn-secondary"
                disabled={checkingReviews}
                onClick={checkReviewsNow}
              >
                {checkingReviews ? 'Checking…' : 'Check & reply now'}
              </button>
            </div>

            <div className="auto-grid-2">
              <div className="auto-field">
                <label className="auto-label" htmlFor="gb-mode">
                  Reply mode
                </label>
                <select
                  id="gb-mode"
                  className="auto-select"
                  value={rules.mode || 'default'}
                  onChange={(e) => setRules({ ...rules, mode: e.target.value })}
                >
                  <option value="default">Default 1★–5★ replies</option>
                  <option value="template">Single custom template</option>
                </select>
              </div>

              <div className="auto-field">
                <label className="auto-label" htmlFor="gb-min-rating">
                  Minimum rating
                </label>
                <select
                  id="gb-min-rating"
                  className="auto-select"
                  value={String(rules.minimum_rating || 1)}
                  onChange={(e) =>
                    setRules({ ...rules, minimum_rating: Number(e.target.value) })
                  }
                >
                  <option value="1">All reviews (1★ – 5★)</option>
                  <option value="3">3★ and above</option>
                  <option value="4">4★ and above</option>
                  <option value="5">5★ only</option>
                </select>
              </div>
            </div>

            {rules.mode === 'template' ? (
              <div className="auto-field" style={{ marginTop: 14 }}>
                <label className="auto-label" htmlFor="gb-template">
                  Custom reply template
                </label>
                <textarea
                  id="gb-template"
                  className="auto-textarea"
                  rows={3}
                  value={rules.reply_template || ''}
                  onChange={(e) => setRules({ ...rules, reply_template: e.target.value })}
                  placeholder="Thanks {{reviewer_name}} for the {{star_rating}}-star review!"
                />
              </div>
            ) : (
              <div className="auto-star-section">
                <div className="auto-star-bar">
                  <button
                    type="button"
                    className="auto-btn-ghost"
                    onClick={() => setShowStarReplies((v) => !v)}
                  >
                    {showStarReplies ? 'Hide 1★–5★ replies' : 'Customize 1★–5★ replies'}
                  </button>
                  <div className="auto-star-presets">
                    <button
                      type="button"
                      className="auto-btn-secondary"
                      onClick={() => {
                        setStarDraft((prev) => ({
                          ...prev,
                          '5': HAIR_MATCH_SALON_REPLY,
                          '4': HAIR_MATCH_SALON_REPLY,
                        }));
                        setMessage('Applied Hair Match Salon reply to 4★ & 5★. Click Save.');
                      }}
                    >
                      Hair Match Salon preset
                    </button>
                    <button
                      type="button"
                      className="auto-btn-ghost"
                      onClick={() => setStarDraft(DEFAULT_STAR_REPLIES)}
                    >
                      Reset defaults
                    </button>
                  </div>
                </div>

                {showStarReplies ? (
                  <div className="auto-star-list">
                    {['5', '4', '3', '2', '1'].map((star) => (
                      <div key={star} className="auto-field">
                        <label className="auto-label" htmlFor={`star-${star}`}>
                          {star}★ reply
                        </label>
                        <textarea
                          id={`star-${star}`}
                          className="auto-textarea"
                          rows={2}
                          value={starDraft[star] || ''}
                          onChange={(e) =>
                            setStarDraft((prev) => ({ ...prev, [star]: e.target.value }))
                          }
                        />
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            )}
          </section>

          {/* Recent Google Reviews */}
          <section className="auto-card">
            <div className="auto-card-head">
              <div>
                <h2 className="auto-card-title">Recent Reviews</h2>
                <p className="auto-card-sub">
                  View and edit replies directly on Google.
                </p>
              </div>
              <button
                type="button"
                className="auto-btn-secondary"
                disabled={loadingReviews}
                onClick={() => loadLocationReviews(selected)}
              >
                {loadingReviews ? 'Loading…' : reviews.length ? 'Refresh reviews' : 'Load reviews'}
              </button>
            </div>

            {reviews.length > 0 ? (
              <div className="auto-reviews-list">
                {reviews.map((r) => (
                  <div key={r.id} className="auto-review-item">
                    <div className="auto-review-meta">
                      <span className="auto-review-author">{r.reviewer}</span>
                      <span className="auto-review-stars">{'★'.repeat(r.rating || 0)}</span>
                    </div>
                    {r.comment ? <p className="auto-review-body">{r.comment}</p> : null}
                    <div className="auto-review-reply-row">
                      <textarea
                        className="auto-textarea"
                        rows={2}
                        placeholder="Write a reply…"
                        value={replyDrafts[r.id] ?? ''}
                        onChange={(e) =>
                          setReplyDrafts((prev) => ({ ...prev, [r.id]: e.target.value }))
                        }
                      />
                      <div className="auto-review-actions">
                        <button
                          type="button"
                          className="auto-btn-secondary"
                          disabled={savingReviewId === r.id}
                          onClick={() => saveSingleReviewReply(r.id)}
                        >
                          {savingReviewId === r.id ? 'Saving…' : 'Update reply'}
                        </button>
                        <button
                          type="button"
                          className="auto-btn-ghost"
                          disabled={savingReviewId === r.id}
                          onClick={() => {
                            setReplyDrafts((prev) => ({
                              ...prev,
                              [r.id]: HAIR_MATCH_SALON_REPLY,
                            }));
                            saveSingleReviewReply(r.id, HAIR_MATCH_SALON_REPLY);
                          }}
                        >
                          Use Hair Match Salon
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </section>
        </div>
      ) : (
        /* Instagram & Facebook 2-Column Rules */
        <div className="auto-grid-2">
          {/* Comment Replies */}
          <section className="auto-card">
            <div className="auto-card-head">
              <div>
                <h2 className="auto-card-title">Comment Replies</h2>
                <p className="auto-card-sub">
                  Reply publicly to comments or send a private DM.
                </p>
              </div>
            </div>

            <div className="auto-fields">
              <ToggleSwitch
                checked={Boolean(rules.public_reply_enabled)}
                onChange={(v) => setRules({ ...rules, public_reply_enabled: v })}
                label="Public comment reply"
                description="Post a reply under matching comments"
              />

              <div className="auto-field">
                <label className="auto-label" htmlFor="ig-comment-kw">
                  Trigger keywords
                </label>
                <input
                  id="ig-comment-kw"
                  className="auto-input"
                  value={rules.comment_keyword}
                  onChange={(e) => setRules({ ...rules, comment_keyword: e.target.value })}
                  placeholder="e.g. PRICE, INFO (blank = all comments)"
                />
              </div>

              <div className="auto-field">
                <label className="auto-label" htmlFor="ig-comment-excl">
                  Excluded words
                </label>
                <input
                  id="ig-comment-excl"
                  className="auto-input"
                  value={rules.excluded_words}
                  onChange={(e) => setRules({ ...rules, excluded_words: e.target.value })}
                  placeholder="e.g. spam, scam, refund"
                />
              </div>

              <div className="auto-field">
                <label className="auto-label" htmlFor="ig-public-reply">
                  Public reply text
                </label>
                <textarea
                  id="ig-public-reply"
                  className="auto-textarea"
                  rows={3}
                  value={rules.public_reply}
                  onChange={(e) => setRules({ ...rules, public_reply: e.target.value })}
                  placeholder="Sent you the details in your DM!"
                />
              </div>

              <div className="auto-field">
                <label className="auto-label" htmlFor="ig-private-reply">
                  Private DM to commenter
                </label>
                <textarea
                  id="ig-private-reply"
                  className="auto-textarea"
                  rows={3}
                  value={rules.private_reply}
                  onChange={(e) => setRules({ ...rules, private_reply: e.target.value })}
                  placeholder="Hey! Here is the link you asked for…"
                />
              </div>
            </div>
          </section>

          {/* Direct Messages */}
          <section className="auto-card">
            <div className="auto-card-head">
              <div>
                <h2 className="auto-card-title">Direct Messages</h2>
                <p className="auto-card-sub">
                  Auto-reply to incoming DMs and optionally DM commenters.
                </p>
              </div>
            </div>

            <div className="auto-fields">
              <ToggleSwitch
                checked={Boolean(rules.comment_enabled)}
                onChange={(v) => setRules({ ...rules, comment_enabled: v })}
                label="Auto DM commenters"
                description="Send a DM when a comment matches"
              />

              <div className="auto-field">
                <label className="auto-label" htmlFor="ig-dm-kw">
                  DM trigger keywords
                </label>
                <input
                  id="ig-dm-kw"
                  className="auto-input"
                  value={rules.dm_keyword}
                  onChange={(e) => setRules({ ...rules, dm_keyword: e.target.value })}
                  placeholder="e.g. HOURS, BOOKING"
                />
              </div>

              <div className="auto-field">
                <label className="auto-label" htmlFor="ig-dm-excl">
                  Excluded words
                </label>
                <input
                  id="ig-dm-excl"
                  className="auto-input"
                  value={rules.dm_excluded_words}
                  onChange={(e) => setRules({ ...rules, dm_excluded_words: e.target.value })}
                  placeholder="e.g. stop, unsubscribe, spam"
                />
              </div>

              <div className="auto-field">
                <label className="auto-label" htmlFor="ig-dm-reply">
                  Keyword DM reply
                </label>
                <textarea
                  id="ig-dm-reply"
                  className="auto-textarea"
                  rows={3}
                  value={rules.dm_reply}
                  onChange={(e) => setRules({ ...rules, dm_reply: e.target.value })}
                  placeholder="We are open Monday to Saturday, 10 AM – 8 PM."
                />
              </div>

              <div className="auto-field">
                <label className="auto-label" htmlFor="ig-default-reply">
                  Default fallback reply
                </label>
                <textarea
                  id="ig-default-reply"
                  className="auto-textarea"
                  rows={3}
                  value={rules.default_reply}
                  onChange={(e) => setRules({ ...rules, default_reply: e.target.value })}
                  placeholder="Thanks for messaging us! We will get back to you soon."
                />
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
