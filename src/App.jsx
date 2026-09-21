import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase, apiUrl, api, PLATFORMS, isActiveBrand, groupBrands } from './lib.js';

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

function useLocalSet(key) {
  const [set, setSet] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(key) || '[]')); }
    catch { return new Set(); }
  });
  const save = (next) => { setSet(next); localStorage.setItem(key, JSON.stringify([...next])); };
  const add = (id) => save(new Set([...set, id]));
  const remove = (id) => { const n = new Set(set); n.delete(id); save(n); };
  return [set, add, remove];
}

const isEffectiveActive = (conn, manual) => manual.has(conn.id) || isActiveBrand(conn.account_name);

function DotsMenu({ active, hidden, onToggleActive, onToggleHidden }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="dots">
      <button className="mini" onClick={() => setOpen((o) => !o)}>⋯</button>
      {open && <>
        <span className="dd-backdrop" onClick={() => setOpen(false)} />
        <span className="dots-menu">
          <button onClick={() => { onToggleActive(); setOpen(false); }}>{active ? '★ Unmark Active' : '☆ Mark Active'}</button>
          <button onClick={() => { onToggleHidden(); setOpen(false); }}>{hidden ? 'Unhide' : 'Hide'}</button>
        </span>
      </>}
    </span>
  );
}

function BrandPicker({ brands, brandKey, onPick, isActive }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const current = brands.find((b) => b.key === brandKey);
  const list = brands.filter((b) => !q.trim() || b.label.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className={open ? 'dd open' : 'dd'}>
      <button className="dd-btn" onClick={() => setOpen((o) => !o)}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{current ? current.label : 'Pick a brand…'}</span>
        <small>{brands.length} brands</small>
        <span className="chev">▾</span>
      </button>
      {open && <>
        <div className="dd-backdrop" onClick={() => setOpen(false)} />
        <div className="dd-menu">
          <input className="dd-search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type to filter…" />
          {list.map((b) => (
            <button key={b.key} className={b.key === brandKey ? 'dd-item sel' : 'dd-item'} onClick={() => { onPick(b.key); setOpen(false); setQ(''); }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.label}</span>
              {(isActive ? isActive(b) : isActiveBrand(b.label)) && <span className="star">★ active</span>}
            </button>
          ))}
          {!list.length && <div className="banner" style={{ margin: 4 }}>No brand matches.</div>}
        </div>
      </>}
    </div>
  );
}

function Composer({ session, connections, reload }) {
  const [hidden] = useLocalSet(`driftpost-hidden:${session.user.id}`);
  const [manualActive] = useLocalSet(`driftpost-active:${session.user.id}`);
  const vis = useMemo(() => connections.filter((c) => !hidden.has(c.id)), [connections, hidden]);
  const brands = useMemo(() => groupBrands(vis), [vis]);
  const brandActive = (b) => isActiveBrand(b.label) || Object.values(b.map).some((id) => manualActive.has(id));
  const [brandKey, setBrandKey] = useState('');
  const [over, setOver] = useState({});
  const [file, setFile] = useState(null);
  const [thumb, setThumb] = useState(null);
  const [caption, setCaption] = useState('');
  const [yt, setYt] = useState({ title: '', description: '', tags: '', privacy: 'private', category: '', kids: '', license: '', embed: '', stats: '', notify: 'on' });
  const [ig, setIg] = useState({ caption: '', alt: '' });
  const [fb, setFb] = useState({ message: '', link: '' });
  const [x, setX] = useState({ text: '', reply: 'everyone' });
  const [busy, setBusy] = useState({});
  const [results, setResults] = useState({});
  const inputRef = useRef();
  const thumbRef = useRef();

  useEffect(() => {
    if (!brandKey && brands.length) {
      setBrandKey((brands.find((b) => brandActive(b)) || brands[0]).key);
    }
  }, [brands, brandKey]);

  const brand = brands.find((b) => b.key === brandKey) || null;
  const listFor = (pid) => vis.filter((c) => c.platform === pid);
  const pick = (pid) => over[`${brand?.key}:${pid}`] || brand?.map[pid] || '';
  const setPick = (pid, id) => setOver((m) => ({ ...m, [`${brand?.key}:${pid}`]: id }));

  const mediaUrl = useMemo(
    () => (file?.raw && file.type.startsWith('image/') ? URL.createObjectURL(file.raw) : null),
    [file]
  );

  const pickFile = (f) => {
    if (!f) return;
    setFile({ raw: f, name: f.name, size: `${(f.size / 1024 / 1024).toFixed(1)} MB`, type: f.type });
  };

  const xLen = Array.from((x.text || caption).trim()).length;

  const buildForm = (platform) => {
    const form = new FormData();
    form.append('platform', platform);
    form.append('connection_id', pick(platform));
    form.append('text', caption);
    form.append('title', yt.title);
    form.append('privacy', yt.privacy);
    form.append('yt_title', yt.title);
    form.append('yt_description', yt.description);
    form.append('yt_tags', yt.tags);
    form.append('yt_privacy', yt.privacy);
    form.append('yt_category', yt.category);
    form.append('yt_kids', yt.kids);
    form.append('yt_license', yt.license);
    form.append('yt_embed', yt.embed);
    form.append('yt_stats', yt.stats);
    form.append('yt_notify', yt.notify);
    form.append('ig_caption', ig.caption);
    form.append('ig_alt', ig.alt);
    form.append('fb_message', fb.message);
    form.append('fb_link', fb.link);
    form.append('x_text', x.text);
    form.append('x_reply', x.reply);
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
    if (!pick(platform)) {
      setResults((r) => ({ ...r, [platform]: { state: 'failed', message: 'No account for this brand — pick one in the phone.' } }));
      return;
    }
    setBusy((b) => ({ ...b, [platform]: true }));
    const out = { ...results };
    try { await runOne(platform, out); }
    catch (e) { out[platform] = { state: 'failed', message: e.message }; setResults({ ...out }); }
    setBusy((b) => ({ ...b, [platform]: false }));
    reload();
  };

  const publishAll = async () => {
    const targets = PLATFORMS.map((p) => p.id).filter((pid) => pick(pid));
    if (!targets.length) return;
    const out = { ...results };
    for (const platform of targets) {
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

  const secState = (pid) => {
    const r = results[pid];
    if (!r) return 'Ready';
    if (r.state === 'completed') return 'Done';
    if (r.state === 'failed') return 'Failed';
    return `${r.progress || 5}%`;
  };

  return (
    <div>
      <div className="brandbar">
        <BrandPicker brands={brands} brandKey={brandKey} isActive={(b) => brandActive(b)} onPick={(k) => { setBrandKey(k); setResults({}); }} />
        <button className="primary" style={{ width: 'auto', marginTop: 0, padding: '10px 26px' }} onClick={publishAll} disabled={Object.values(busy).some(Boolean)}>Publish all</button>
      </div>

      <div className="share-row">
        <div className="card">
          <h3>Shared media</h3>
          <p className="sub">One file reused in every phone. YouTube needs video.</p>
          <input ref={inputRef} type="file" accept="image/*,video/*" hidden onChange={(e) => pickFile(e.target.files[0])} />
          {!file ? (
            <div className="drop" onClick={() => inputRef.current.click()}><b>Drop media here or browse</b>Images · Video up to 2 GB</div>
          ) : (
            <div className="file-row"><div><b>{file.name}</b><small>{file.size} · {file.type}</small></div><button onClick={() => setFile(null)}>Remove</button></div>
          )}
        </div>
        <div className="card">
          <h3>Shared caption</h3>
          <p className="sub">Fills every phone left empty. <button className="link" onClick={applyCaptionEverywhere}>Copy into all phones</button></p>
          <label className="field" style={{ marginBottom: 0 }}><span>Caption <i>{caption.length}/2200</i></span><textarea value={caption} maxLength={2200} onChange={(e) => setCaption(e.target.value)} placeholder="Write once…" /></label>
        </div>
      </div>

      <div className="phones" key={brandKey}>
        {PLATFORMS.map((p, idx) => {
          const pid = p.id;
          const list = listFor(pid);
          const chosen = pick(pid);
          const r = results[pid];
          const HINTS = { youtube: 'Video + Title required', instagram: 'Photo or reel + caption', facebook: 'Text, photo or video', x: '280 characters max' };
          return (
            <div key={pid} className={chosen ? 'phone' : 'phone off'}>
              <div className="phone-head"><span className="idx">0{idx + 1}</span><span><b>{p.name}</b><small>{list.length} account{list.length === 1 ? '' : 's'} · {HINTS[pid]}</small></span><span className="led" /></div>
              <div className="phone-screen">
                <label className="field-mini"><span>Account</span>
                  <select value={chosen} onChange={(e) => setPick(pid, e.target.value)}>
                    {!chosen && <option value="">— pick —</option>}
                    {list.map((c) => <option key={c.id} value={c.id}>{c.account_name}</option>)}
                  </select>
                </label>

                <div className="media-thumb" onClick={() => inputRef.current.click()}>
                  {mediaUrl ? <img src={mediaUrl} alt="Shared media" /> : file ? <span>{file.name}<br />{file.size}</span> : <span>Media</span>}
                </div>

                {pid === 'youtube' && <>
                  <label className="field-mini"><span>Title · {yt.title.length}/100</span><input value={yt.title} maxLength={100} onChange={(e) => setYt({ ...yt, title: e.target.value })} placeholder="Video title (required)" /></label>
                  <label className="field-mini"><span>Description</span><textarea value={yt.description} onChange={(e) => setYt({ ...yt, description: e.target.value })} placeholder="Shared caption if empty" /></label>
                  <label className="field-mini"><span>Tags · comma separated</span><input value={yt.tags} onChange={(e) => setYt({ ...yt, tags: e.target.value })} placeholder="salon, bridal, mumbai" /></label>
                  <div className="row2">
                    <label className="field-mini"><span>Category</span>
                      <select value={yt.category} onChange={(e) => setYt({ ...yt, category: e.target.value })}>
                        <option value="">YouTube default</option>
                        <option value="1">Film & Animation</option>
                        <option value="2">Autos & Vehicles</option>
                        <option value="10">Music</option>
                        <option value="15">Pets & Animals</option>
                        <option value="17">Sports</option>
                        <option value="19">Travel & Events</option>
                        <option value="20">Gaming</option>
                        <option value="22">People & Blogs</option>
                        <option value="23">Comedy</option>
                        <option value="24">Entertainment</option>
                        <option value="25">News & Politics</option>
                        <option value="26">Howto & Style</option>
                        <option value="27">Education</option>
                        <option value="28">Science & Technology</option>
                      </select>
                    </label>
                    <label className="field-mini"><span>Made for kids</span>
                      <select value={yt.kids} onChange={(e) => setYt({ ...yt, kids: e.target.value })}>
                        <option value="">Not sure (default)</option>
                        <option value="yes">Yes, for kids</option>
                        <option value="no">No, not for kids</option>
                      </select>
                    </label>
                  </div>
                  <div className="row2">
                    <label className="field-mini"><span>License</span>
                      <select value={yt.license} onChange={(e) => setYt({ ...yt, license: e.target.value })}>
                        <option value="">Standard (default)</option>
                        <option value="youtube">Standard YouTube</option>
                        <option value="creativeCommon">Creative Commons</option>
                      </select>
                    </label>
                    <label className="field-mini"><span>Embedding</span>
                      <select value={yt.embed} onChange={(e) => setYt({ ...yt, embed: e.target.value })}>
                        <option value="">Allow (default)</option>
                        <option value="yes">Allow embedding</option>
                        <option value="no">Block embedding</option>
                      </select>
                    </label>
                  </div>
                  <div className="row2">
                    <label className="field-mini"><span>Public stats</span>
                      <select value={yt.stats} onChange={(e) => setYt({ ...yt, stats: e.target.value })}>
                        <option value="">Show (default)</option>
                        <option value="yes">Show view counts</option>
                        <option value="no">Hide view counts</option>
                      </select>
                    </label>
                    <label className="field-mini"><span>Notify subs</span>
                      <select value={yt.notify} onChange={(e) => setYt({ ...yt, notify: e.target.value })}>
                        <option value="on">Notify (default)</option>
                        <option value="off">Silent upload</option>
                      </select>
                    </label>
                  </div>
                  <div className="row2">
                    <label className="field-mini"><span>Visibility</span>
                      <select value={yt.privacy} onChange={(e) => setYt({ ...yt, privacy: e.target.value })}>
                        <option value="private">Private</option>
                        <option value="unlisted">Unlisted</option>
                        <option value="public">Public</option>
                      </select>
                    </label>
                    <label className="field-mini"><span>Thumbnail</span>
                      <button className="phone-btn" style={{ padding: '9px' }} onClick={() => thumbRef.current.click()}>{thumb ? '✓ picked' : 'Upload'}</button>
                      <input ref={thumbRef} type="file" accept="image/jpeg,image/png" hidden onChange={(e) => { const f = e.target.files[0]; if (f) setThumb({ raw: f, name: f.name }); }} />
                    </label>
                  </div>
                </>}

                {pid === 'instagram' && <>
                  <label className="field-mini"><span>Caption · {(ig.caption || caption).length}/2200</span><textarea value={ig.caption} onChange={(e) => setIg({ ...ig, caption: e.target.value })} placeholder="Shared caption if empty" /></label>
                  <label className="field-mini"><span>Alt text · accessibility</span><input value={ig.alt} maxLength={500} onChange={(e) => setIg({ ...ig, alt: e.target.value })} placeholder="Describe the photo/video" /></label>
                </>}

                {pid === 'facebook' && <>
                  <label className="field-mini"><span>Message</span><textarea value={fb.message} onChange={(e) => setFb({ ...fb, message: e.target.value })} placeholder="Shared caption if empty" /></label>
                  <label className="field-mini"><span>Link · optional</span><input value={fb.link} onChange={(e) => setFb({ ...fb, link: e.target.value })} placeholder="https://…" /></label>
                </>}

                {pid === 'x' && <>
                  <label className="field-mini"><span>Post · {xLen}/280</span><textarea value={x.text} maxLength={400} onChange={(e) => setX({ ...x, text: e.target.value })} placeholder="Shared caption if empty" /></label>
                  <label className="field-mini"><span>Who can reply</span>
                    <select value={x.reply} onChange={(e) => setX({ ...x, reply: e.target.value })}>
                      <option value="everyone">Everyone (default)</option>
                      <option value="following">Accounts I follow</option>
                      <option value="mentionedUsers">Only mentioned</option>
                    </select>
                  </label>
                  {xLen > 280 && <div className="sec-err">Too long for X.</div>}
                </>}

                <div className={r?.state === 'failed' ? 'phone-status fail' : 'phone-status'}>{secState(pid)}</div>
                {r?.state === 'failed' && <div className="sec-err">{r.message}</div>}
                {r?.url && <a className="phone-link" href={r.url} target="_blank" rel="noreferrer">View post →</a>}
                <button className="phone-btn" disabled={!!busy[pid] || (pid === 'x' && xLen > 280)} onClick={() => publishOne(pid)}>{busy[pid] ? 'Sending…' : `Publish ${p.name}`}</button>
              </div>
            </div>
          );
        })}
      </div>
      <p className="note">Direct publish only. Tokens stay encrypted in Supabase. Switch brands above to post for another client.</p>
    </div>
  );
}

function Accounts({ session, connections, setConnections }) {
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState('');
  const [search, setSearch] = useState('');
  const [activeOnly, setActiveOnly] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [hiddenSet, hideId, unhideId] = useLocalSet(`driftpost-hidden:${session.user.id}`);
  const [manualActive, markActive, unmarkActive] = useLocalSet(`driftpost-active:${session.user.id}`);

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
    if (!showHidden && hiddenSet.has(c.id)) return false;
    if (showHidden && !hiddenSet.has(c.id)) return false;
    if (activeOnly && !isEffectiveActive(c, manualActive)) return false;
    if (q && !c.account_name.toLowerCase().includes(q)) return false;
    return true;
  };
  const visibleCount = connections.filter((c) => !hiddenSet.has(c.id)).length;

  return (
    <div className="card" style={{ maxWidth: 680 }}>
      <h3>Accounts</h3>
      <p className="sub">{visibleCount} visible · {hiddenSet.size} hidden · ★ = your active brands.</p>
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
            {list.map((c) => {
              const effActive = isEffectiveActive(c, manualActive);
              const isHidden = hiddenSet.has(c.id);
              return (
              <div key={c.id} className="list-row">
                <span className="avatar">{(c.account_name || '?')[0].toUpperCase()}</span>
                <div><b style={{ fontSize: 13 }}>{c.account_name}</b><small style={{ display: 'block', color: '#6b6b6b' }}>{p.name}</small></div>
                {effActive && <span className="badge ok">★ Active</span>}
                <DotsMenu
                  active={effActive}
                  hidden={isHidden}
                  onToggleActive={() => { manualActive.has(c.id) ? unmarkActive(c.id) : markActive(c.id); }}
                  onToggleHidden={() => { isHidden ? unhideId(c.id) : hideId(c.id); }}
                />
                <button className="mini" disabled={!!busy} onClick={() => disconnect(c.id)}>Disconnect</button>
              </div>
              );
            })}
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
          <div className="pro-card" style={{ background: '#101838', border: '1px solid #2c3d66', borderRadius: 12, padding: 12, fontSize: 11, color: '#aeb9d8' }}>
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
