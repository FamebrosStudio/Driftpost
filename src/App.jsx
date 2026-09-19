import React, { useEffect, useRef, useState } from 'react';
import { supabase, apiUrl, api, PLATFORMS } from './lib.js';

function useSession() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { setSession(s); setLoading(false); });
    return () => sub.subscription.unsubscribe();
  }, []);
  return { session, loading };
}

function Auth({ mode, setMode }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(''); setInfo('');
    if (!supabase) { setError('Supabase is not configured. Add VITE_SUPABASE_URL + key.'); setBusy(false); return; }
    const res = mode === 'login'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
    if (res.error) setError(res.error.message);
    else if (mode === 'signup' && !res.data.session) setInfo('Check your inbox to confirm email, then sign in.');
    setBusy(false);
  };

  const google = async () => {
    setBusy(true); setError('');
    if (!supabase) { setError('Supabase is not configured.'); setBusy(false); return; }
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google', options: { redirectTo: window.location.origin, queryParams: { prompt: 'select_account' } }
    });
    if (error) { setError(error.message); setBusy(false); }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="brand"><span className="brand-mark">〜</span>Driftpost</div>
        <h1>{mode === 'login' ? 'Welcome back.' : 'Start posting.'}</h1>
        <p>One calm composer for YouTube, Instagram and Facebook. No noise.</p>
        <button className="ghost" onClick={google} disabled={busy}>Continue with Google</button>
        <form onSubmit={submit}>
          <label className="field"><span>Email</span><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></label>
          <label className="field"><span>Password</span><input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" /></label>
          {error && <div className="alert err">{error}</div>}
          {info && <div className="banner">{info}</div>}
          <button className="primary" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
        </form>
        <p className="note" style={{ textAlign: 'center' }}>
          {mode === 'login' ? 'New here?' : 'Have an account?'}{' '}
          <button className="link" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>{mode === 'login' ? 'Create account' : 'Sign in'}</button>
        </p>
      </div>
    </div>
  );
}

function Composer({ session, connections, reload }) {
  const [selected, setSelected] = useState([]);
  const [connFor, setConnFor] = useState({});
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [privacy, setPrivacy] = useState('private');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState({});
  const inputRef = useRef();

  const pickFile = (f) => {
    if (!f) return;
    setFile({ raw: f, name: f.name, size: `${(f.size / 1024 / 1024).toFixed(1)} MB`, type: f.type });
  };

  const toggle = (id) => {
    const list = connections.filter((c) => c.platform === id);
    if (!list.length) return;
    if (selected.includes(id)) {
      setSelected((s) => s.filter((x) => x !== id));
      setConnFor((m) => { const n = { ...m }; delete n[id]; return n; });
    } else {
      setSelected((s) => [...s, id]);
      if (list[0] && !connFor[id]) setConnFor((m) => ({ ...m, [id]: list[0].id }));
    }
  };

  const publish = async () => {
    if (!selected.length || busy) return;
    setBusy(true);
    const out = {};
    for (const platform of selected) {
      try {
        out[platform] = { state: 'uploading', progress: 5 };
        setResults({ ...out });
        const form = new FormData();
        form.append('platform', platform);
        form.append('connection_id', connFor[platform] || '');
        form.append('title', title);
        form.append('text', caption);
        form.append('privacy', privacy);
        if (file?.raw) form.append('media', file.raw);
        const res = await fetch(`${apiUrl}/api/publish`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.access_token}` },
          body: form,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Publish failed');
        // poll job
        const jobId = data.job.id;
        for (;;) {
          await new Promise((r) => setTimeout(r, 1500));
          const j = await api(`/api/jobs/${jobId}`, session.access_token);
          out[platform] = { state: j.job.state, progress: j.job.progress || 50, url: j.job.url, message: j.job.message };
          setResults({ ...out });
          if (j.job.state === 'completed') break;
          if (j.job.state === 'failed') throw new Error(j.job.message);
        }
      } catch (e) {
        out[platform] = { state: 'failed', message: e.message };
        setResults({ ...out });
      }
    }
    setBusy(false);
    reload();
  };

  return (
    <div className="grid">
      <section className="card">
        <h3>1 · Destinations</h3>
        <p className="sub">YouTube, Instagram, Facebook — connected accounts only.</p>
        <div className="plat-grid">
          {PLATFORMS.map((p) => {
            const list = connections.filter((c) => c.platform === p.id);
            const on = selected.includes(p.id);
            return (
              <button key={p.id} className={on ? 'plat on' : list.length ? 'plat' : 'plat off'} onClick={() => toggle(p.id)} disabled={!list.length}>
                <b>{p.name}</b>
                <small>{list.length ? (connFor[p.id] ? list.find((x) => x.id === connFor[p.id])?.account_name : list[0].account_name) : 'Not connected'}</small>
                <small>{p.hint}</small>
              </button>
            );
          })}
        </div>
        {selected.some((s) => (connections.filter((c) => c.platform === s).length > 1)) && (
          <div style={{ marginTop: 10 }}>
            {selected.map((pid) => {
              const list = connections.filter((c) => c.platform === pid);
              if (list.length < 2) return null;
              return (
                <label key={pid} className="field"><span>{pid} account</span>
                  <select value={connFor[pid] || ''} onChange={(e) => setConnFor((m) => ({ ...m, [pid]: e.target.value }))}>
                    {list.map((c) => <option key={c.id} value={c.id}>{c.account_name}</option>)}
                  </select>
                </label>
              );
            })}
          </div>
        )}

        <h3 style={{ marginTop: 22 }}>2 · Media</h3>
        <p className="sub">{selected.includes('youtube') ? 'YouTube needs a video.' : 'Photo or video. Facebook also accepts text-only.'}</p>
        {!file ? (
          <div className="drop" onClick={() => inputRef.current.click()}>
            <input ref={inputRef} type="file" accept="image/*,video/*" hidden onChange={(e) => pickFile(e.target.files[0])} />
            <b>Drop media here or browse</b>
            Images 5 MB · Video up to 2 GB
          </div>
        ) : (
          <div className="file-row"><div><b>{file.name}</b><small>{file.size} · {file.type}</small></div><button onClick={() => setFile(null)}>Remove</button></div>
        )}

        <h3 style={{ marginTop: 22 }}>3 · Words</h3>
        <p className="sub">Keep it short. Minimal wins.</p>
        {selected.includes('youtube') && (
          <label className="field"><span>Title <i>{title.length}/100</i></span><input value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} placeholder="Video title" /></label>
        )}
        <label className="field"><span>Caption <i>{caption.length}/2200</i></span><textarea value={caption} maxLength={2200} onChange={(e) => setCaption(e.target.value)} placeholder="Write once…" /></label>
        {selected.includes('youtube') && (
          <div className="row2">
            <label className="field"><span>Visibility</span>
              <select value={privacy} onChange={(e) => setPrivacy(e.target.value)}>
                <option value="private">Private</option>
                <option value="unlisted">Unlisted</option>
                <option value="public">Public</option>
              </select>
            </label>
          </div>
        )}
      </section>

      <aside className="card">
        <h3>Ready?</h3>
        <p className="sub">{selected.length} selected</p>
        {selected.length === 0 && <div className="banner">Pick at least one destination above.</div>}
        {selected.map((pid) => {
          const r = results[pid];
          return (
            <div key={pid} className="dest">
              <div><b style={{ fontSize: 13 }}>{pid}</b><small>{connFor[pid] ? 'account chosen' : 'default account'}</small>
                {r && r.state !== 'failed' && <span className="prog"><i style={{ width: `${r.progress || 10}%` }} /></span>}
              </div>
              <span className={r?.state === 'failed' ? 'st fail' : 'st'}>{r ? (r.state === 'completed' ? 'Done' : r.state === 'failed' ? 'Failed' : `${r.progress || 5}%`) : 'Ready'}</span>
            </div>
          );
        })}
        {Object.entries(results).map(([k, r]) => (
          <div key={k}>
            {r.url && <a href={r.url} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>View on {k} →</a>}
            {r.state === 'failed' && <div className="alert err">{r.message}</div>}
          </div>
        ))}
        <button className="primary" disabled={!selected.length || busy} onClick={publish}>{busy ? 'Publishing…' : 'Publish'}</button>
        <p className="note">Direct publish only. No scheduling, no background automation. Tokens stay encrypted in Supabase.</p>
      </aside>
    </div>
  );
}

function Accounts({ session, connections, setConnections }) {
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState('');

  const params = new URLSearchParams(window.location.search);
  useEffect(() => {
    if (params.get('connected')) { setMsg(`${params.get('connected')} connected.`); window.history.replaceState({}, '', window.location.pathname); }
    if (params.get('oauth_error')) { setMsg(`Connection failed: ${params.get('oauth_error')}`); window.history.replaceState({}, '', window.location.pathname); }
  }, []);

  const connect = async (platform) => {
    setBusy(platform); setMsg('');
    try {
      const data = await api(`/api/oauth/${platform}/start`, session.access_token, { method: 'POST' });
      window.location.assign(data.url);
    } catch (e) { setMsg(e.message); setBusy(''); }
  };

  const disconnect = async (id) => {
    setBusy(id);
    try {
      await api(`/api/connections/${id}`, session.access_token, { method: 'DELETE' });
      setConnections((c) => c.filter((x) => x.id !== id));
      setMsg('Disconnected.');
    } catch (e) { setMsg(e.message); }
    setBusy('');
  };

  return (
    <div className="card" style={{ maxWidth: 640 }}>
      <h3>Accounts</h3>
      <p className="sub">Each connection belongs only to your login.</p>
      {msg && <div className="banner">{msg}</div>}
      {PLATFORMS.map((p) => {
        const list = connections.filter((c) => c.platform === p.id);
        return (
          <div key={p.id}>
            <div className="list-row">
              <div><b style={{ fontSize: 13 }}>{p.name}</b><small style={{ display: 'block', color: '#6b6b6b' }}>{list.length ? `${list.length} connected` : 'Not connected'}</small></div>
              <span style={{ marginLeft: 'auto' }} />
              <button className="mini" disabled={!!busy} onClick={() => connect(p.id)}>{busy === p.id ? 'Opening…' : list.length ? 'Connect another' : 'Connect'}</button>
            </div>
            {list.map((c) => (
              <div key={c.id} className="list-row">
                <span className="avatar">{(c.account_name || '?')[0].toUpperCase()}</span>
                <div><b style={{ fontSize: 13 }}>{c.account_name}</b><small style={{ display: 'block', color: '#6b6b6b' }}>{p.name}</small></div>
                <span className="badge ok">Connected</span>
                <button className="mini" disabled={!!busy} onClick={() => disconnect(c.id)}>Disconnect</button>
              </div>
            ))}
          </div>
        );
      })}
      <p className="note">YouTube uses Google OAuth. Instagram + Facebook use Meta (Facebook Login → Page → linked Instagram business account).</p>
    </div>
  );
}

export default function App() {
  const { session, loading } = useSession();
  const [mode, setMode] = useState('login');
  const [view, setView] = useState('create');
  const [connections, setConnections] = useState([]);
  const [online, setOnline] = useState(null);

  useEffect(() => {
    if (!session) return;
    api('/api/connections', session.access_token).then((d) => setConnections(d.connections || [])).catch(() => {});
  }, [session]);

  useEffect(() => {
    if (!apiUrl) { setOnline(false); return; }
    fetch(`${apiUrl}/health`).then((r) => setOnline(r.ok)).catch(() => setOnline(false));
  }, []);

  if (loading) return <div className="auth-wrap"><div>Loading…</div></div>;
  if (!session) return <Auth mode={mode} setMode={setMode} />;

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><span className="brand-mark">〜</span>Driftpost</div>
        <button className={view === 'create' ? 'nav-btn active' : 'nav-btn'} onClick={() => setView('create')}>Create</button>
        <button className={view === 'accounts' ? 'nav-btn active' : 'nav-btn'} onClick={() => setView('accounts')}>Accounts <em>{connections.length}</em></button>
        <div className="side-foot">
          <button className="user-chip" onClick={() => supabase?.auth.signOut()}>
            <span className="avatar">{(session.user.email || '?')[0].toUpperCase()}</span>
            <span><b style={{ fontSize: 12 }}>{session.user.email?.split('@')[0]}</b><small>{session.user.email}</small></span>
          </button>
        </div>
      </aside>
      <div className="main">
        <div className="top">
          <div><h1>{view === 'create' ? 'Compose' : 'Accounts'}</h1><p>Write once · publish to YouTube, Instagram, Facebook</p></div>
          <span className={online === false ? 'pill bad' : 'pill'}>{online === null ? 'checking…' : online ? 'API online' : 'API offline'}</span>
        </div>
        <div className="page">
          {view === 'create'
            ? <Composer session={session} connections={connections} reload={() => api('/api/connections', session.access_token).then((d) => setConnections(d.connections || [])).catch(() => {})} />
            : <Accounts session={session} connections={connections} setConnections={setConnections} />}
        </div>
      </div>
    </div>
  );
}
