import React, { useEffect, useMemo, useState } from 'react';
import { api, groupBrands, PLATFORMS } from '../lib.js';
import BrandIcon from '../brand.jsx';
import './connect.css';

const HINTS = {
  youtube: 'Google OAuth · one channel per login',
  instagram: 'Meta · needs a Business/Creator account linked to a Page',
  facebook: 'Meta · Facebook Login with your Page',
  x: 'x.com OAuth2 · post and reply permissions',
};

const BrandDot = ({ pid }) => <BrandIcon id={pid} size={14} />;

export default function ConnectPage({ session, onContinue, onHistory, onSignOut }) {
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [msgKind, setMsgKind] = useState('ok');
  const say = (m, k = 'ok') => { setMsg(m); setMsgKind(k); };

  useEffect(() => { document.title = 'Connect accounts · Driftpost'; }, []);

  const load = () => {
    setLoading(true);
    api('/api/connections', session.access_token)
      .then((d) => setConnections(d.connections || []))
      .catch(() => say('Could not load your accounts. Check the API and try again.', 'err'))
      .finally(() => setLoading(false));
  };
  useEffect(load, [session.access_token]);

  // OAuth returns here with ?connected=platform or ?oauth_error=msg
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const ok = p.get('connected');
    const bad = p.get('oauth_error');
    if (ok) say(`${ok[0].toUpperCase() + ok.slice(1)} connected.`);
    if (bad) say(`Connection failed: ${bad}`, 'err');
    if (ok || bad) {
      window.history.replaceState({}, '', window.location.pathname);
      load();
    }
  }, []);

  const connect = async (platform) => {
    setBusy(platform);
    say('');
    try {
      const data = await api(`/api/oauth/${platform}/start`, session.access_token, { method: 'POST' });
      window.location.assign(data.url);
    } catch (e) {
      say(e.message || 'Could not start the connection.', 'err');
      setBusy('');
    }
  };

  const disconnect = async (c) => {
    if (!window.confirm(`Disconnect ${c.account_name}? You can reconnect any time.`)) return;
    setBusy(c.id);
    try {
      await api(`/api/connections/${c.id}`, session.access_token, { method: 'DELETE' });
      setConnections((cs) => cs.filter((x) => x.id !== c.id));
      say(`${c.account_name} disconnected.`);
    } catch (e) {
      say(e.message || 'Disconnect failed.', 'err');
    }
    setBusy('');
  };

  const listFor = (pid) => connections.filter((c) => c.platform === pid);
  const brands = useMemo(() => groupBrands(connections), [connections]);
  const total = connections.length;

  return (
    <div className="connect">
      <div className="connect-in">
        <div className="cn-top">
          <span />
          <span className="cn-top-right">
            <button type="button" className="cn-link" onClick={onHistory}>History</button>
            <button type="button" className="cn-link" onClick={onSignOut}>Sign out</button>
          </span>
        </div>

        <header className="cn-head">
          <span className="cn-badge">Before you start</span>
          <h1>Connect your accounts</h1>
          <p>Link the social accounts you post from. You choose how to organise them in the next step.</p>
        </header>

        <div className="cn-strip" aria-label="Your journey">
          <span className="cn-step now"><b>1</b> Accounts</span>
          <span className="cn-step"><b>2</b> Account Setup</span>
          <span className="cn-step"><b>3</b> Content</span>
          <span className="cn-step"><b>4</b> Publishing</span>
        </div>

        {msg && <div className={msgKind === 'err' ? 'cn-msg err' : 'cn-msg ok'}>{msg}</div>}

        {loading ? (
          <div className="cn-empty" style={{ marginTop: 22 }}>Loading your accounts…</div>
        ) : (
          <>
            <div className="cn-summary">
              {PLATFORMS.map((p) => {
                const n = listFor(p.id).length;
                return (
                  <span key={p.id} className={n ? 'cn-pill has' : 'cn-pill'}>
                    <BrandDot pid={p.id} /> {p.name} {n}
                  </span>
                );
              })}
            </div>

            <div className="cn-grid">
              {PLATFORMS.map((p) => {
                const list = listFor(p.id);
                return (
                  <div key={p.id} className={list.length ? 'cn-card linked' : 'cn-card'}>
                    <div className="cn-card-head">
                      <span className="cn-ic"><BrandIcon id={p.id} size={18} /></span>
                      <span>
                        <b>{p.name}</b>
                        <small>{list.length ? `${list.length} connected` : 'Not connected'}</small>
                      </span>
                    </div>
                    <p className="cn-hint">{HINTS[p.id]}</p>
                    <div className="cn-list">
                      {list.length ? list.map((c) => (
                        <div key={c.id} className="cn-acct">
                          <span className="cn-av">{(c.account_name || '?')[0].toUpperCase()}</span>
                          <span style={{ minWidth: 0 }}>
                            <b title={c.account_name}>{c.account_name}</b>
                            <small>{p.name}</small>
                          </span>
                          <button type="button" className="cn-drop" disabled={!!busy} onClick={() => disconnect(c)}>
                            {busy === c.id ? '…' : 'Disconnect'}
                          </button>
                        </div>
                      )) : (
                        <div className="cn-empty">No {p.name} account yet.</div>
                      )}
                    </div>
                    <button
                      type="button"
                      className={list.length ? 'cn-connect ghost' : 'cn-connect'}
                      disabled={!!busy}
                      onClick={() => connect(p.id)}
                    >
                      {busy === p.id ? 'Opening…' : list.length ? `Connect another ${p.name} account` : `Connect ${p.name}`}
                    </button>
                  </div>
                );
              })}
            </div>

            {brands.length > 0 && (
              <div className="cn-brands">
                <h2>Brands we found</h2>
                <p className="sub">We matched your connected accounts into {brands.length} brand{brands.length === 1 ? '' : 's'} — you can change this next.</p>
                {brands.slice(0, 12).map((b) => (
                  <div key={b.key} className="cn-brand-row">
                    <b title={b.label}>{b.label}</b>
                    <span className="cn-dots">
                      {Object.keys(b.map).map((pid) => <BrandDot key={pid} pid={pid} />)}
                    </span>
                    <small style={{ color: 'var(--faint)' }}>{Object.keys(b.map).length} acct</small>
                  </div>
                ))}
                {brands.length > 12 && <p className="cn-hint" style={{ marginTop: 10 }}>+ {brands.length - 12} more brands</p>}
              </div>
            )}
          </>
        )}
      </div>

      <div className="cn-bar">
        <button type="button" className="cn-next" disabled={!total || loading} onClick={onContinue}>
          Continue to Account Setup →
        </button>
        {!total && <p className="cn-hintline">Connect at least one account to continue</p>}
      </div>
    </div>
  );
}
