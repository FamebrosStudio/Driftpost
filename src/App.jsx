import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase, apiUrl, api, PLATFORMS, isActiveBrand } from './lib.js';

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
        <p>One calm composer for YouTube, Instagram, Facebook and X. No noise.</p>
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

const visibleConns = (connections, hidden) => connections.filter((c) => !hidden.has(c.id));
const connsFor = (connections, hidden, pid) => visibleConns(connections, hidden).filter((c) => c.platform === pid);

function Composer({ session, connections, reload }) {
  const [selected, setSelected] = useState([]);
  const [connFor, setConnFor] = useState({});
  const [file, setFile] = useState(null);
  const [thumb, setThumb] = useState(null);
  const [caption, setCaption] = useState('');
  const [yt, setYt] = useState({ title: '', description: '', tags: '', privacy: 'private' });
  const [ig, setIg] = useState({ caption: '' });
  const [fb, setFb] = useState({ message: '', link: '' });
  const [x, setX] = useState({ text: '' });
  const [busy, setBusy] = useState({});
  const [results, setResults] = useState({});
  const [hidden] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(`driftpost-hidden:${session.user.id}`) || '[]')); }
    catch { return new Set(); }
  });
  const inputRef = useRef();
  const thumbRef = useRef();

  const pickFile = (f) => {
    if (!f) return;
    setFile({ raw: f, name: f.name, size: `${(f.size / 1024 / 1024).toFixed(1)} MB`, type: f.type });
  };

  const toggle = (id) => {
    const list = connsFor(connections, hidden, id);
    if (!list.length) return;
    if (selected.includes(id)) {
      setSelected((s) => s.filter((v) => v !== id));
    } else {
      setSelected((s) => [...s, id]);
      if (!connFor[id]) setConnFor((m) => ({ ...m, [id]: list[0].id }));
    }
  };

  const xLen = Array.from((x.text || caption).trim()).length;

  const buildForm = (platform) => {
    const form = new FormData();
    form.append('platform', platform);
    form.append('connection_id', connFor[platform] || '');
    form.append('text', caption);
    form.append('title', yt.title);
    form.append('privacy', yt.privacy);
    form.append('yt_title', yt.title);
    form.append('yt_description', yt.description);
    form.append('yt_tags', yt.tags);
    form.append('yt_privacy', yt.privacy);
    form.append('ig_caption', ig.caption);
    form.append('fb_message', fb.message);
    form.append('fb_link', fb.link);
    form.append('x_text', x.text);
    if (file?.raw) form.append('media', file.raw);
    if (platform === 'youtube' && thumb?.raw) form.append('thumbnail', thumb.raw);
    return form;
  };

  const runOne = async (platform, out) => {
    out[platform] = { state: 'uploading', progress: 5 };
    setResults({ ...out });
    const res = await fetch(`${apiUrl}/api/publish`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
      body: buildForm(platform),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Publish failed');
    const jobId = data.job.id;
    for (;;) {
      await new Promise((r) => setTimeout(r, 1500));
      const j = await api(`/api/jobs/${jobId}`, session.access_token);
      out[platform] = { state: j.job.state, progress: j.job.progress || 50, url: j.job.url, message: j.job.message };
      setResults({ ...out });
      if (j.job.state === 'completed') return;
      if (j.job.state === 'failed') throw new Error(j.job.message);
    }
  };

  const publishOne = async (platform) => {
    if (busy[platform]) return;
    setBusy((b) => ({ ...b, [platform]: true }));
    const out = { ...results };
    try { await runOne(platform, out); }
    catch (e) { out[platform] = { state: 'failed', message: e.message }; setResults({ ...out }); }
    setBusy((b) => ({ ...b, [platform]: false }));
    reload();
  };

  const publishAll = async () => {
    if (!selected.length) return;
    const out = { ...results };
    for (const platform of selected) {
      try { await runOne(platform, out); }
      catch (e) { out[platform] = { state: 'failed', message: e.message }; setResults({ ...out }); }
    }
    reload();
  };

  const applyCaptionEverywhere = () => {
    setIg((v) => ({ ...v, caption }));
    setFb((v) => ({ ...v, message: caption }));
    setX((v) => ({ ...v, text: caption.slice(0, 280) }));
    setYt((v) => ({ ...v, description: caption }));
  };

  const sectionState = (pid) => {
    const r = results[pid];
    if (!r) return 'Ready';
    if (r.state === 'completed') return 'Done';
    if (r.state === 'failed') return 'Failed';
    return `${r.progress || 5}%`;
  };

  return (
    <div className="grid">
      <section className="card">
        <h3>1 · Brand</h3>
        <p className="sub">YouTube, Instagram, Facebook, X — visible accounts only. Hidden ones stay in Accounts.</p>
        <div className="plat-grid">
          {PLATFORMS.map((p) => {
            const list = connsFor(connections, hidden, p.id);
            const on = selected.includes(p.id);
            return (
              <button key={p.id} className={on ? 'plat on' : list.length ? 'plat' : 'plat off'} onClick={() => toggle(p.id)} disabled={!list.length}>
                <b>{p.name}</b>
                <small>{list.length ? `${list.length} account${list.length === 1 ? '' : 's'}` : 'Not connected'}</small>
                <small>{p.hint}</small>
              </button>
            );
          })}
        </div>

        <h3 style={{ marginTop: 22 }}>2 · Media (shared)</h3>
        <p className="sub">{selected.includes('youtube') ? 'YouTube needs a video.' : 'One file reused everywhere. Facebook also accepts text-only.'}</p>
        {!file ? (
          <div className="drop" onClick={() => inputRef.current.click()}>
            <input ref={inputRef} type="file" accept="image/*,video/*" hidden onChange={(e) => pickFile(e.target.files[0])} />
            <b>Drop media here or browse</b>
            Images · Video up to 2 GB
          </div>
        ) : (
          <div className="file-row"><div><b>{file.name}</b><small>{file.size} · {file.type}</small></div><button onClick={() => setFile(null)}>Remove</button></div>
        )}

        <h3 style={{ marginTop: 22 }}>3 · Shared caption</h3>
        <p className="sub">Used everywhere a section is left empty. <button className="link" onClick={applyCaptionEverywhere}>Copy into all sections</button></p>
        <label className="field"><span>Caption <i>{caption.length}/2200</i></span><textarea value={caption} maxLength={2200} onChange={(e) => setCaption(e.target.value)} placeholder="Write once…" /></label>

        <h3 style={{ marginTop: 22 }}>4 · Per-platform details</h3>
        <p className="sub">Each platform, exactly like its own app. Empty fields fall back to the shared caption.</p>
        {!selected.length && <div className="banner">Select a platform above to edit its details.</div>}

        {selected.includes('youtube') && (
          <div className="card" style={{ marginTop: 10, boxShadow: 'none' }}>
            <h3>YouTube</h3>
            <p className="sub">Video + title + visibility, like YouTube Studio.</p>
            <label className="field"><span>Publish to</span>
              <select value={connFor.youtube || ''} onChange={(e) => setConnFor((m) => ({ ...m, youtube: e.target.value }))}>
                {connsFor(connections, hidden, 'youtube').map((c) => <option key={c.id} value={c.id}>{c.account_name}</option>)}
              </select>
            </label>
            <label className="field"><span>Title <i>{yt.title.length}/100</i></span><input value={yt.title} maxLength={100} onChange={(e) => setYt({ ...yt, title: e.target.value })} placeholder="Video title (required)" /></label>
            <label className="field"><span>Description</span><textarea value={yt.description} onChange={(e) => setYt({ ...yt, description: e.target.value })} placeholder="Falls back to shared caption" /></label>
            <label className="field"><span>Tags <i>comma separated</i></span><input value={yt.tags} onChange={(e) => setYt({ ...yt, tags: e.target.value })} placeholder="salon, bridal, mumbai" /></label>
            <div className="row2">
              <label className="field"><span>Visibility</span>
                <select value={yt.privacy} onChange={(e) => setYt({ ...yt, privacy: e.target.value })}>
                  <option value="private">Private</option>
                  <option value="unlisted">Unlisted</option>
                  <option value="public">Public</option>
                </select>
              </label>
              <label className="field"><span>Thumbnail <i>{thumb ? thumb.name : 'auto'}</i></span>
                <button className="ghost" style={{ marginTop: 0 }} onClick={() => thumbRef.current.click()}>{thumb ? 'Change' : 'Upload JPG/PNG ≤2MB'}</button>
                <input ref={thumbRef} type="file" accept="image/jpeg,image/png" hidden onChange={(e) => { const f = e.target.files[0]; if (f) setThumb({ raw: f, name: f.name }); }} />
              </label>
            </div>
            <button className="primary" disabled={!!busy.youtube} onClick={() => publishOne('youtube')}>{busy.youtube ? 'Publishing…' : 'Publish to YouTube'} · {sectionState('youtube')}</button>
            {results.youtube?.state === 'failed' && <div className="alert err">{results.youtube.message}</div>}
            {results.youtube?.url && <a href={results.youtube.url} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>View on YouTube →</a>}
          </div>
        )}

        {selected.includes('instagram') && (
          <div className="card" style={{ marginTop: 10, boxShadow: 'none' }}>
            <h3>Instagram</h3>
            <p className="sub">Photo or reel + caption.</p>
            <label className="field"><span>Publish to</span>
              <select value={connFor.instagram || ''} onChange={(e) => setConnFor((m) => ({ ...m, instagram: e.target.value }))}>
                {connsFor(connections, hidden, 'instagram').map((c) => <option key={c.id} value={c.id}>{c.account_name}</option>)}
              </select>
            </label>
            <label className="field"><span>Caption <i>{(ig.caption || caption).length}/2200</i></span><textarea value={ig.caption} onChange={(e) => setIg({ caption: e.target.value })} placeholder="Falls back to shared caption" /></label>
            <button className="primary" disabled={!!busy.instagram} onClick={() => publishOne('instagram')}>{busy.instagram ? 'Publishing…' : 'Publish to Instagram'} · {sectionState('instagram')}</button>
            {results.instagram?.state === 'failed' && <div className="alert err">{results.instagram.message}</div>}
            {results.instagram?.url && <a href={results.instagram.url} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>View on Instagram →</a>}
          </div>
        )}

        {selected.includes('facebook') && (
          <div className="card" style={{ marginTop: 10, boxShadow: 'none' }}>
            <h3>Facebook</h3>
            <p className="sub">Message, optional link, optional media.</p>
            <label className="field"><span>Publish to</span>
              <select value={connFor.facebook || ''} onChange={(e) => setConnFor((m) => ({ ...m, facebook: e.target.value }))}>
                {connsFor(connections, hidden, 'facebook').map((c) => <option key={c.id} value={c.id}>{c.account_name}</option>)}
              </select>
            </label>
            <label className="field"><span>Message</span><textarea value={fb.message} onChange={(e) => setFb({ ...fb, message: e.target.value })} placeholder="Falls back to shared caption" /></label>
            <label className="field"><span>Link <i>optional</i></span><input value={fb.link} onChange={(e) => setFb({ ...fb, link: e.target.value })} placeholder="https://…" /></label>
            <button className="primary" disabled={!!busy.facebook} onClick={() => publishOne('facebook')}>{busy.facebook ? 'Publishing…' : 'Publish to Facebook'} · {sectionState('facebook')}</button>
            {results.facebook?.state === 'failed' && <div className="alert err">{results.facebook.message}</div>}
            {results.facebook?.url && <a href={results.facebook.url} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>View on Facebook →</a>}
          </div>
        )}

        {selected.includes('x') && (
          <div className="card" style={{ marginTop: 10, boxShadow: 'none' }}>
            <h3>X</h3>
            <p className="sub">280 characters + optional media.</p>
            <label className="field"><span>Publish to</span>
              <select value={connFor.x || ''} onChange={(e) => setConnFor((m) => ({ ...m, x: e.target.value }))}>
                {connsFor(connections, hidden, 'x').map((c) => <option key={c.id} value={c.id}>{c.account_name}</option>)}
              </select>
            </label>
            <label className="field"><span>Post <i>{xLen}/280</i></span><textarea value={x.text} maxLength={400} onChange={(e) => setX({ text: e.target.value })} placeholder="Falls back to shared caption" /></label>
            {xLen > 280 && <div className="alert err">Too long for X — shorten it.</div>}
            <button className="primary" disabled={!!busy.x || xLen > 280} onClick={() => publishOne('x')}>{busy.x ? 'Publishing…' : 'Publish to X'} · {sectionState('x')}</button>
            {results.x?.state === 'failed' && <div className="alert err">{results.x.message}</div>}
            {results.x?.url && <a href={results.x.url} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>View on X →</a>}
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
              <div><b style={{ fontSize: 13 }}>{pid}</b>
                {r && r.state !== 'failed' && <span className="prog"><i style={{ width: `${r.progress || 10}%` }} /></span>}
              </div>
              <span className={r?.state === 'failed' ? 'st fail' : 'st'}>{r ? (r.state === 'completed' ? 'Done' : r.state === 'failed' ? 'Failed' : `${r.progress || 5}%`) : 'Ready'}</span>
            </div>
          );
        })}
        <button className="primary" disabled={!selected.length || Object.values(busy).some(Boolean)} onClick={publishAll}>Publish all</button>
        <p className="note">Direct publish only. No scheduling, no background automation. Tokens stay encrypted in Supabase.</p>
      </aside>
    </div>
  );
}

function Accounts({ session, connections, setConnections }) {
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState('');
  const [search, setSearch] = useState('');
  const [activeOnly, setActiveOnly] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const hidKey = `driftpost-hidden:${session.user.id}`;
  const [hidden, setHidden] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(hidKey) || '[]')); }
    catch { return new Set(); }
  });
  const saveHidden = (next) => {
    setHidden(next);
    localStorage.setItem(hidKey, JSON.stringify([...next]));
  };
  const hide = (id) => saveHidden(new Set([...hidden, id]));
  const unhide = (id) => { const n = new Set(hidden); n.delete(id); saveHidden(n); };

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

  const q = search.trim().toLowerCase();
  const matchFilters = (c) => {
    if (!showHidden && hidden.has(c.id)) return false;
    if (showHidden && !hidden.has(c.id)) return false;
    if (activeOnly && !isActiveBrand(c.account_name)) return false;
    if (q && !c.account_name.toLowerCase().includes(q)) return false;
    return true;
  };
  const visibleCount = connections.filter((c) => !hidden.has(c.id)).length;

  return (
    <div className="card" style={{ maxWidth: 680 }}>
      <h3>Accounts</h3>
      <p className="sub">{visibleCount} visible · {hidden.size} hidden · Active badge = your 40 brands.</p>
      {msg && <div className="banner">{msg}</div>}
      <div className="row2" style={{ marginBottom: 6 }}>
        <label className="field" style={{ margin: 0 }}><span>Search</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Salon, jewellers…" /></label>
        <label className="field" style={{ margin: 0 }}><span>Filter</span>
          <select value={showHidden ? 'hidden' : activeOnly ? 'active' : 'all'} onChange={(e) => { setShowHidden(e.target.value === 'hidden'); setActiveOnly(e.target.value === 'active'); }}>
            <option value="all">All accounts</option>
            <option value="active">Active brands only</option>
            <option value="hidden">Hidden</option>
          </select>
        </label>
      </div>
      {PLATFORMS.map((p) => {
        const list = connections.filter((c) => c.platform === p.id && matchFilters(c));
        const total = connections.filter((c) => c.platform === p.id).length;
        if (!showHidden && !q && !activeOnly && !list.length && !total) {
          return (
            <div key={p.id} className="list-row">
              <div><b style={{ fontSize: 13 }}>{p.name}</b><small style={{ display: 'block', color: '#6b6b6b' }}>Not connected</small></div>
              <span style={{ marginLeft: 'auto' }} />
              <button className="mini" disabled={!!busy} onClick={() => connect(p.id)}>{busy === p.id ? 'Opening…' : 'Connect'}</button>
            </div>
          );
        }
        if (!list.length) return null;
        return (
          <div key={p.id}>
            <div className="list-row">
              <div><b style={{ fontSize: 13 }}>{p.name}</b><small style={{ display: 'block', color: '#6b6b6b' }}>{list.length}{total !== list.length ? ` of ${total}` : ''} shown</small></div>
              <span style={{ marginLeft: 'auto' }} />
              <button className="mini" disabled={!!busy} onClick={() => connect(p.id)}>{busy === p.id ? 'Opening…' : 'Connect another'}</button>
            </div>
            {list.map((c) => (
              <div key={c.id} className="list-row">
                <span className="avatar">{(c.account_name || '?')[0].toUpperCase()}</span>
                <div><b style={{ fontSize: 13 }}>{c.account_name}</b><small style={{ display: 'block', color: '#6b6b6b' }}>{p.name}</small></div>
                {isActiveBrand(c.account_name) && <span className="badge ok">Active</span>}
                {!showHidden
                  ? <button className="mini" onClick={() => hide(c.id)}>Hide</button>
                  : <button className="mini" onClick={() => unhide(c.id)}>Unhide</button>}
                <button className="mini" disabled={!!busy} onClick={() => disconnect(c.id)}>Disconnect</button>
              </div>
            ))}
          </div>
        );
      })}
      <p className="note">Hide removes inactive brands from Compose without disconnecting. YouTube = Google OAuth · IG/FB = Meta · X = x.com.</p>
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

  const counts = useMemo(() => {
    const c = {};
    connections.forEach((x) => { c[x.platform] = (c[x.platform] || 0) + 1; });
    return c;
  }, [connections]);

  if (loading) return <div className="auth-wrap"><div>Loading…</div></div>;
  if (!session) return <Auth mode={mode} setMode={setMode} />;

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><span className="brand-mark">〜</span>Driftpost</div>
        <button className={view === 'create' ? 'nav-btn active' : 'nav-btn'} onClick={() => setView('create')}>Compose</button>
        <button className={view === 'accounts' ? 'nav-btn active' : 'nav-btn'} onClick={() => setView('accounts')}>Accounts <em>{connections.length}</em></button>
        <div className="side-foot">
          <div className="pro-card" style={{ background: '#f6f6f5', border: '1px solid #ececec', borderRadius: 12, padding: 12, fontSize: 11, color: '#6b6b6b' }}>
            YouTube {counts.youtube || 0} · IG {counts.instagram || 0} · FB {counts.facebook || 0} · X {counts.x || 0}
          </div>
          <button className="user-chip" onClick={() => supabase?.auth.signOut()}>
            <span className="avatar">{(session.user.email || '?')[0].toUpperCase()}</span>
            <span><b style={{ fontSize: 12 }}>{session.user.email?.split('@')[0]}</b><small>{session.user.email}</small></span>
          </button>
        </div>
      </aside>
      <div className="main">
        <div className="top">
          <div><h1>{view === 'create' ? 'Compose' : 'Accounts'}</h1><p>Metricool-style · one brand, four platforms, per-platform details</p></div>
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
