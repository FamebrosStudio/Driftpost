import React, { useEffect, useMemo, useRef, useState } from 'react';
import { apiUrl, api, PLATFORMS, isActiveBrand, groupBrands } from './lib.js';
import BrandIcon from './brand.jsx';
import { getSupabase } from './session.js';

const THEMES = [
  { id: 'auto', label: 'Auto (follows PC)' },
  { id: 'dark', label: 'Black' },
  { id: 'light', label: 'White' },
];

function useTheme() {
  const [mode, setMode] = useState(() => {
    const s = localStorage.getItem('driftpost-theme');
    return ['auto', 'light', 'dark'].includes(s) ? s : 'auto';
  });
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const apply = () => {
      const eff = mode === 'auto' ? (mq.matches ? 'light' : 'dark') : mode;
      document.documentElement.dataset.theme = eff;
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', eff === 'light' ? '#ffffff' : '#000000');
    };
    apply();
    mq.addEventListener?.('change', apply);
    try { localStorage.setItem('driftpost-theme', mode); } catch {}
    return () => mq.removeEventListener?.('change', apply);
  }, [mode]);
  return [mode, setMode];
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

function Tip({ text }) {
  return (
    <span className="tip" tabIndex={0} aria-label={text}>?
      <span className="tip-bubble">{text}</span>
    </span>
  );
}

function StepsHeader({ step, setStep, ready }) {
  const steps = [
    { n: 1, t: 'Brand', d: 'Who is this for?' },
    { n: 2, t: 'Content', d: 'Photo + words' },
    { n: 3, t: 'Review & Post', d: 'Check + publish' },
  ];
  return (
    <div className="steps">
      {steps.map((s) => {
        const done = step > s.n;
        const cur = step === s.n;
        const locked = s.n === 3 && !ready;
        return (
          <button
            key={s.n}
            disabled={locked && !cur}
            onClick={() => { if (!locked) setStep(s.n); }}
            className={cur ? 'step cur' : done ? 'step done' : 'step'}
            title={locked ? 'Add a photo/video and some text first' : s.d}
          >
            <span className="step-n">{done ? '✓' : s.n}</span>
            <span className="step-t"><b>{s.t}</b><small>{s.d}</small></span>
          </button>
        );
      })}
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
  const [step, setStep] = useState(1);
  const [tab, setTab] = useState('youtube');
  const [showAdv, setShowAdv] = useState({});
  const [over, setOver] = useState({});
  const [file, setFile] = useState(null);
  const [thumb, setThumb] = useState(null);
  const [caption, setCaption] = useState('');
  const [yt, setYt] = useState({ title: '', description: '', tags: '', privacy: 'private', category: '', kids: '', license: '', embed: '', stats: '', notify: 'on' });
  const [ig, setIg] = useState({ caption: '', alt: '', topics: '', partner: '', collabs: '', location: '', shareFb: false });
  const [fb, setFb] = useState({ message: '', link: '', syndIg: false, age: '', cta: '', linkName: '', linkCaption: '', linkDesc: '', linkPic: '', unpublished: false });
  const [x, setX] = useState({ text: '', reply: 'everyone', pollOn: false, opts: ['', '', '', ''], mins: '1440' });
  const [busy, setBusy] = useState({});
  const [enabled, setEnabled] = useState({ youtube: true, instagram: true, facebook: true, x: true });
  const [aiBrief, setAiBrief] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState('');
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
    form.append('ig_topics', ig.topics);
    form.append('ig_partner', ig.partner);
    form.append('ig_collabs', ig.collabs);
    form.append('ig_location', ig.location);
    form.append('ig_share_fb', ig.shareFb ? '1' : '');
    form.append('fb_connection_id', pick('facebook'));
    form.append('fb_message', fb.message);
    form.append('fb_link', fb.link);
    form.append('fb_synd_ig', fb.syndIg ? '1' : '');
    form.append('ig_connection_id', pick('instagram'));
    form.append('fb_age', fb.age);
    form.append('fb_cta', fb.cta);
    form.append('fb_link_name', fb.linkName);
    form.append('fb_link_caption', fb.linkCaption);
    form.append('fb_link_desc', fb.linkDesc);
    form.append('fb_link_pic', fb.linkPic);
    form.append('fb_unpublished', fb.unpublished ? '1' : '');
    form.append('x_text', x.text);
    form.append('x_reply', x.reply);
    form.append('x_poll_options', JSON.stringify(x.pollOn ? x.opts : []));
    form.append('x_poll_minutes', x.mins);
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
      out[platform] = { state: j.job.state, progress: j.job.progress || 50, url: j.job.url, message: j.job.message, warning: j.job.warning };
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
    const targets = PLATFORMS.map((p) => p.id).filter((pid) => pick(pid) && enabled[pid]);
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

  const writeWithAi = async () => {
    if (aiBusy || !aiBrief.trim()) return;
    setAiBusy(true); setAiMsg('');
    try {
      const data = await api('/api/ai/captions', session.access_token, {
        method: 'POST',
        body: JSON.stringify({
          summary: aiBrief,
          brand: brand?.label || '',
          asset_description: file ? `${file.name} (${file.type})` : '',
          goal: 'enquiries',
        }),
      });
      const c = data.captions || data;
      setYt((v) => ({ ...v, title: c.youtube.title || v.title, description: c.youtube.description || v.description, tags: c.youtube.tags.join(', ') || v.tags }));
      setIg((v) => ({ ...v, caption: c.instagram.caption || v.caption }));
      setCaption((prev) => prev || c.instagram.caption || '');
      setFb((v) => ({ ...v, message: c.facebook.message || v.message }));
      setX((v) => ({ ...v, text: c.x.text.slice(0, 280) || v.text }));
      const tags = [...(c.youtube.tags || []), ...(c.instagram.hashtags || [])].filter(Boolean);
      if (tags.length) setYt((v) => ({ ...v, tags: v.tags || tags.slice(0, 8).join(', ') }));
      setAiMsg(data.fromMemory ? `Using ${data.fromMemory} memory — review each phone, then publish.` : 'Written for all 4 platforms — review each phone, then publish.');
    } catch (e) {
      setAiMsg(e.message);
    }
    setAiBusy(false);
  };

  const secState = (pid) => {
    const r = results[pid];
    if (!r) return 'Ready';
    if (r.state === 'completed') return 'Done';
    if (r.state === 'failed') return 'Failed';
    return `${r.progress || 5}%`;
  };

  const contentReady = !!(file || caption.trim() || yt.title.trim() || x.text.trim());
  const toggleAdv = (k) => setShowAdv((m) => ({ ...m, [k]: !m[k] }));

  return (
    <div className="composer">
      <StepsHeader step={step} setStep={setStep} ready={contentReady} />

      {step === 1 && (
      <div className="step-panel">
        <div className="card step-card">
          <span className="scope-badge everywhere">Step 1 · Who is this for?</span>
          <h3>Pick a brand</h3>
          <p className="sub">One brand = one client. We auto-match their accounts on all 4 platforms.</p>
          <BrandPicker brands={brands} brandKey={brandKey} isActive={(b) => brandActive(b)} onPick={(k) => { setBrandKey(k); setResults({}); }} />
          {!brands.length && <div className="banner" style={{ marginTop: 12 }}>No accounts yet. Go to Accounts → Connect YouTube / Facebook / Instagram / X first.</div>}
        </div>

        <div className="card step-card">
          <span className="scope-badge everywhere">Where to post?</span>
          <h3>Choose platforms</h3>
          <p className="sub">Only ticked platforms will post. Unticked ones are skipped.</p>
          <div className="plat-pick">
            {PLATFORMS.map((p) => {
              const list = listFor(p.id);
              const chosen = pick(p.id);
              return (
                <div key={p.id} className={enabled[p.id] && chosen ? 'plat-row on' : 'plat-row'}>
                  <button
                    className={enabled[p.id] ? 'plat-check on' : 'plat-check'}
                    onClick={() => setEnabled((m) => ({ ...m, [p.id]: !m[p.id] }))}
                    aria-label={`Toggle ${p.name}`}
                  >{enabled[p.id] ? '✓' : ''}</button>
                  <span className="plat-ic"><BrandIcon id={p.id} size={18} /></span>
                  <span className="plat-meta"><b>{p.name}</b><small>{chosen ? list.find((c) => c.id === chosen)?.account_name : `No account — ${list.length} connected`}</small></span>
                  <select value={chosen} onChange={(e) => setPick(p.id, e.target.value)} aria-label={`${p.name} account`}>
                    {!chosen && <option value="">Pick account…</option>}
                    {list.map((c) => <option key={c.id} value={c.id}>{c.account_name}</option>)}
                  </select>
                </div>
              );
            })}
          </div>
          <div className="step-nav">
            <span />
            <button className="skew-btn grad" onClick={() => setStep(2)} disabled={!brand}><span>Next: add content →</span></button>
          </div>
        </div>
      </div>
      )}

      {step === 2 && (
      <div className="step-panel">
      <div className="share-row stepped">
        <div className="card step-card">
          <span className="scope-badge everywhere">Used everywhere</span>
          <h3>1 · Photo or video <Tip text="One file shared to every ticked platform. YouTube needs a video. Instagram / Facebook / X accept photo or video up to 2 GB." /></h3>
          <p className="sub">Add once — it appears on every platform.</p>
          <input ref={inputRef} type="file" accept="image/*,video/*" hidden onChange={(e) => pickFile(e.target.files[0])} />
          {!file ? (
            <div className="drop big" onClick={() => inputRef.current.click()}><b>＋ Add photo or video</b>Click to browse · up to 2 GB</div>
          ) : (
            <div>
              {mediaUrl && <img className="media-preview" src={mediaUrl} alt="Shared media preview" />}
              <div className="file-row"><div><b>{file.name}</b><small>{file.size} · {file.type}</small></div><button onClick={() => setFile(null)}>Remove</button></div>
            </div>
          )}
        </div>
        <div className="card step-card">
          <span className="scope-badge everywhere">Used everywhere</span>
          <h3>2 · Write once <Tip text="This text is copied into YouTube description, Instagram caption, Facebook message and X post. You can still edit each platform separately in the next step." /></h3>
          <p className="sub">Write here, tweak per platform later. <button className="link" onClick={applyCaptionEverywhere}>Copy to all now</button></p>
          <label className="field" style={{ marginBottom: 0 }}><span>Your message <i>{caption.length}/2200</i></span><textarea value={caption} maxLength={2200} onChange={(e) => setCaption(e.target.value)} placeholder="e.g. Diwali offer at Velvet Salon — 20% off bridal packages this week…" /></label>
        </div>
        <div className="card step-card ai">
          <span className="scope-badge ai-badge">Optional helper</span>
          <h3>✨ AI writer</h3>
          <p className="sub">Stuck? Type a short summary, we draft all 4 captions.</p>
          <label className="field" style={{ marginBottom: 0 }}><span>What is this post about? <i>optional</i></span><textarea value={aiBrief} maxLength={500} onChange={(e) => setAiBrief(e.target.value)} placeholder="e.g. bridal haircut reel for Velvet Salon in Mumbai" style={{ minHeight: 70 }} /></label>
          {aiMsg && <div className={/written for all/i.test(aiMsg) ? 'banner' : 'alert err'} style={{ marginTop: 10 }}>{aiMsg}</div>}
          <button className="skew-btn grad" style={{ width: '100%', marginTop: 10 }} disabled={aiBusy || !aiBrief.trim()} onClick={writeWithAi}><span>{aiBusy ? 'Writing…' : '✨ Write captions'}</span></button>
          {aiBusy && <div className="progress-loader" style={{ marginTop: 10 }}><div className="progress" /></div>}
        </div>
      </div>
        <div className="step-nav">
          <button className="skew-btn ghost" onClick={() => setStep(1)}><span>← Back</span></button>
          <button className="skew-btn grad" onClick={() => setStep(3)}><span>Next: review & post →</span></button>
        </div>
      </div>
      )}

      {step === 3 && (
      <div className="step-panel">
      <div className="brandbar tight">
        <BrandPicker brands={brands} brandKey={brandKey} isActive={(b) => brandActive(b)} onPick={(k) => { setBrandKey(k); setResults({}); }} />
        <button className="skew-btn grad pub-all" onClick={publishAll} disabled={Object.values(busy).some(Boolean)}><span>🚀 Post to all ticked</span></button>
      </div>
      <div className="ptabs" role="tablist">
        {PLATFORMS.map((p) => {
          const r = results[p.id];
          const dot = r?.state === 'completed' ? '✓' : r?.state === 'failed' ? '!' : busy[p.id] ? '…' : '';
          return (
            <button key={p.id} role="tab" aria-selected={tab === p.id} className={tab === p.id ? 'ptab on' : 'ptab'} onClick={() => setTab(p.id)}>
              <BrandIcon id={p.id} size={15} /> {p.name}
              {dot && <span className={r?.state === 'failed' ? 'pdot fail' : 'pdot'}>{dot}</span>}
              {!pick(p.id) && <span className="pdot warn">no acct</span>}
            </button>
          );
        })}
      </div>
      <div className="phones single" key={brandKey + tab}>
        {PLATFORMS.filter((p) => p.id === tab).map((p, idx) => {
          const pid = p.id;
          const list = listFor(pid);
          const chosen = pick(pid);
          const r = results[pid];
          const HINTS = { youtube: 'Needs a video + title', instagram: 'Needs a photo or video', facebook: 'Text, photo or video', x: 'Max 280 characters' };
          return (
            <div key={pid} className={chosen ? 'phone' : 'phone off'}>
              <div className="phone-head"><span className="idx">0{idx + 1}</span><span className="p-icon"><BrandIcon id={pid} size={15} /></span><span><b>{p.name}</b><small>{list.length} account{list.length === 1 ? '' : 's'} · {HINTS[pid]}</small></span><span className="led" /></div>
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
                  <span className="scope-badge only">Only YouTube</span>
                  <label className="field-mini"><span>Video title · {yt.title.length}/100 <Tip text="Required. This is the headline people see on YouTube." /></span><input value={yt.title} maxLength={100} onChange={(e) => setYt({ ...yt, title: e.target.value })} placeholder="e.g. Bridal glow-up at Velvet Salon" /></label>
                  <label className="field-mini"><span>About this video <Tip text="Shown under your video. If empty, we use your message from Step 2." /></span><textarea value={yt.description} onChange={(e) => setYt({ ...yt, description: e.target.value })} placeholder="Uses your Step 2 message if left empty" /></label>
                  <label className="field-mini"><span>Search words · comma separated <Tip text="Helps people find your video. Example: salon, bridal, mumbai." /></span><input value={yt.tags} onChange={(e) => setYt({ ...yt, tags: e.target.value })} placeholder="salon, bridal, mumbai" /></label>
                  <div className="row2">
                    <label className="field-mini"><span>Who can watch? <Tip text="Private = only you. Unlisted = anyone with link. Public = everyone on YouTube." /></span>
                      <select value={yt.privacy} onChange={(e) => setYt({ ...yt, privacy: e.target.value })}>
                        <option value="private">🔒 Private (only me)</option>
                        <option value="unlisted">🔗 Unlisted (link only)</option>
                        <option value="public">🌍 Public (everyone)</option>
                      </select>
                    </label>
                    <label className="field-mini"><span>Cover image <Tip text="The thumbnail people click on. JPG or PNG." /></span>
                      <button className="mini wide" onClick={() => thumbRef.current.click()}>{thumb ? '✓ Cover added' : '＋ Add cover'}</button>
                      <input ref={thumbRef} type="file" accept="image/jpeg,image/png" hidden onChange={(e) => { const f = e.target.files[0]; if (f) setThumb({ raw: f, name: f.name }); }} />
                    </label>
                  </div>
                  <button className={showAdv['yt'] ? 'adv-toggle open' : 'adv-toggle'} onClick={() => toggleAdv('yt')}>{showAdv['yt'] ? '▾ Hide extra YouTube options' : '▸ Extra YouTube options (kids, category…)'}</button>
                  {showAdv['yt'] && (
                  <div className="adv-box">
                  <div className="row2">
                    <label className="field-mini"><span>Video type <Tip text="Pick what fits best. Helps YouTube suggest your video." /></span>
                      <select value={yt.category} onChange={(e) => setYt({ ...yt, category: e.target.value })}>
                        <option value="">Auto (recommended)</option>
                        <option value="26">How-to & Style</option>
                        <option value="22">People & Blogs</option>
                        <option value="24">Entertainment</option>
                        <option value="10">Music</option>
                        <option value="20">Gaming</option>
                        <option value="27">Education</option>
                        <option value="28">Science & Tech</option>
                        <option value="19">Travel & Events</option>
                        <option value="17">Sports</option>
                        <option value="23">Comedy</option>
                      </select>
                    </label>
                    <label className="field-mini"><span>Is it made for kids? <Tip text="YouTube law: say Yes if the video is for children under 13." /></span>
                      <select value={yt.kids} onChange={(e) => setYt({ ...yt, kids: e.target.value })}>
                        <option value="">Not sure</option>
                        <option value="yes">Yes, for kids</option>
                        <option value="no">No, not for kids</option>
                      </select>
                    </label>
                  </div>
                  <div className="row2">
                    <label className="field-mini"><span>Allow others to share? <Tip text="Allow = other websites can show your video." /></span>
                      <select value={yt.embed} onChange={(e) => setYt({ ...yt, embed: e.target.value })}>
                        <option value="">Yes, allow sharing</option>
                        <option value="yes">Yes, allow</option>
                        <option value="no">No, YouTube only</option>
                      </select>
                    </label>
                    <label className="field-mini"><span>Tell subscribers? <Tip text="On = followers get a notification. Off = quiet upload." /></span>
                      <select value={yt.notify} onChange={(e) => setYt({ ...yt, notify: e.target.value })}>
                        <option value="on">Yes, notify them</option>
                        <option value="off">No, keep quiet</option>
                      </select>
                    </label>
                  </div>
                  </div>
                  )}
                </>}

                {pid === 'instagram' && <>
                  <span className="scope-badge only">Only Instagram</span>
                  <label className="field-mini"><span>Caption · {(ig.caption || caption).length}/2200 <Tip text="Text under your photo/reel. If empty, we use your Step 2 message." /></span><textarea value={ig.caption} onChange={(e) => setIg({ ...ig, caption: e.target.value })} placeholder="Uses your Step 2 message if left empty" /></label>
                  <label className="ck"><input type="checkbox" checked={ig.shareFb} onChange={(e) => setIg({ ...ig, shareFb: e.target.checked })} /><svg viewBox="0 0 64 64"><path className="path" d="M8 33 L26 51 L56 13" /></svg><span>Also post this on Facebook</span></label>
                  <button className={showAdv['ig'] ? 'adv-toggle open' : 'adv-toggle'} onClick={() => toggleAdv('ig')}>{showAdv['ig'] ? '▾ Hide extra Instagram options' : '▸ Extra options (tags, partners…)'}</button>
                  {showAdv['ig'] && (
                  <div className="adv-box">
                    <label className="field-mini"><span>Topics · up to 3 <Tip text="Simple words like fitness, bridal. Helps new people discover you." /></span><input value={ig.topics} onChange={(e) => setIg({ ...ig, topics: e.target.value })} placeholder="e.g. bridal, mumbai" /></label>
                    <label className="field-mini"><span>Tag a business partner <Tip text="If a brand paid for this post, type their @name here." /></span><input value={ig.partner} onChange={(e) => setIg({ ...ig, partner: e.target.value })} placeholder="e.g. lakmeindia (no @ needed)" /></label>
                    <label className="field-mini"><span>Invite co-authors · up to 3 <Tip text="Other accounts shown as authors alongside you." /></span><input value={ig.collabs} onChange={(e) => setIg({ ...ig, collabs: e.target.value })} placeholder="e.g. makeup_artist, photographer" /></label>
                    <label className="field-mini"><span>Describe for blind users <Tip text="One sentence describing the photo. Read aloud by screen readers." /></span><input value={ig.alt} maxLength={500} onChange={(e) => setIg({ ...ig, alt: e.target.value })} placeholder="e.g. Bride smiling with red lehenga" /></label>
                  </div>
                  )}
                </>}

                {pid === 'facebook' && <>
                  <span className="scope-badge only">Only Facebook</span>
                  <label className="field-mini"><span>What to say? <Tip text="Text shown above your photo/video. If empty, we use your Step 2 message." /></span><textarea value={fb.message} onChange={(e) => setFb({ ...fb, message: e.target.value })} placeholder="Uses your Step 2 message if left empty" /></label>
                  <label className="field-mini"><span>Website link · optional <Tip text="e.g. your booking page. Leave empty for photo/video only." /></span><input value={fb.link} onChange={(e) => setFb({ ...fb, link: e.target.value })} placeholder="https://your-website.com/offer" /></label>
                  <label className="ck"><input type="checkbox" checked={fb.syndIg} onChange={(e) => setFb({ ...fb, syndIg: e.target.checked })} /><svg viewBox="0 0 64 64"><path className="path" d="M8 33 L26 51 L56 13" /></svg><span>Also post this on Instagram</span></label>
                  <button className={showAdv['fb'] ? 'adv-toggle open' : 'adv-toggle'} onClick={() => toggleAdv('fb')}>{showAdv['fb'] ? '▾ Hide extra Facebook options' : '▸ Extra options (button, age, ads…)'}</button>
                  {showAdv['fb'] && (
                  <div className="adv-box">
                    <label className="field-mini"><span>Add a button · needs a link above <Tip text="Shows Shop now / Learn more under your post." /></span>
                      <select value={fb.cta} onChange={(e) => setFb({ ...fb, cta: e.target.value })}>
                        <option value="">No button</option>
                        <option value="LEARN_MORE">Learn more</option>
                        <option value="SHOP_NOW">Shop now</option>
                        <option value="SIGN_UP">Sign up</option>
                        <option value="MESSAGE_PAGE">Send message</option>
                      </select>
                    </label>
                    <label className="field-mini"><span>Who can see it? <Tip text="Hide from young viewers if needed. Everyone = no limit." /></span>
                      <select value={fb.age} onChange={(e) => setFb({ ...fb, age: e.target.value })}>
                        <option value="">Everyone</option>
                        <option value="13">13 and older</option>
                        <option value="18">18 and older</option>
                        <option value="21">21 and older</option>
                        <option value="25">25 and older</option>
                      </select>
                    </label>
                    <label className="ck"><input type="checkbox" checked={fb.unpublished} onChange={(e) => setFb({ ...fb, unpublished: e.target.checked })} /><svg viewBox="0 0 64 64"><path className="path" d="M8 33 L26 51 L56 13" /></svg><span>Hide from page — ads only <Tip text="Advanced: post exists but visitors won't see it on your page. Only used for ads." /></span></label>
                    <label className="field-mini"><span>Link headline · optional <Tip text="Custom title shown on the link box. Leave empty to use the website's own title." /></span><input value={fb.linkName} onChange={(e) => setFb({ ...fb, linkName: e.target.value })} placeholder="Leave empty = auto" /></label>
                    <label className="field-mini"><span>Link description · optional</span><input value={fb.linkDesc} onChange={(e) => setFb({ ...fb, linkDesc: e.target.value })} placeholder="Leave empty = auto" /></label>
                  </div>
                  )}
                </>}

                {pid === 'x' && <>
                  <span className="scope-badge only">Only X</span>
                  <label className="field-mini"><span>Your post · {xLen}/280 <Tip text="Short and sharp works best. If empty, we use your Step 2 message (cut to 280)." /></span><textarea value={x.text} maxLength={400} onChange={(e) => setX({ ...x, text: e.target.value })} placeholder="Uses your Step 2 message if left empty" /></label>
                  {xLen > 280 && <div className="sec-err">Too long — {xLen - 280} characters over. Shorten it.</div>}
                  <label className="ck"><input type="checkbox" checked={x.pollOn} onChange={(e) => setX({ ...x, pollOn: e.target.checked })} /><svg viewBox="0 0 64 64"><path className="path" d="M8 33 L26 51 L56 13" /></svg><span>Ask a question (poll) instead</span></label>
                  {x.pollOn && <>
                    {[0, 1].map((i) => (
                      <label key={i} className="field-mini"><span>Answer {i + 1} · required</span><input value={x.opts[i]} maxLength={25} onChange={(e) => { const o = [...x.opts]; o[i] = e.target.value; setX({ ...x, opts: o }); }} placeholder="e.g. Yes" /></label>
                    ))}
                    {[2, 3].map((i) => (
                      <label key={i} className="field-mini"><span>Answer {i + 1} · optional</span><input value={x.opts[i]} maxLength={25} onChange={(e) => { const o = [...x.opts]; o[i] = e.target.value; setX({ ...x, opts: o }); }} placeholder="Optional" /></label>
                    ))}
                    <label className="field-mini"><span>Keep voting open for</span>
                      <select value={x.mins} onChange={(e) => setX({ ...x, mins: e.target.value })}>
                        <option value="60">1 hour</option>
                        <option value="1440">1 day</option>
                        <option value="10080">7 days</option>
                      </select>
                    </label>
                    {file && <div className="sec-err">Polls can't have a photo. Remove the Step 2 photo to run this poll.</div>}
                  </>}
                  <label className="field-mini"><span>Who can reply? <Tip text="Everyone = open chat. Followed = safer. Mentioned = private." /></span>
                    <select value={x.reply} onChange={(e) => setX({ ...x, reply: e.target.value })}>
                      <option value="everyone">Everyone can reply</option>
                      <option value="following">Only accounts I follow</option>
                      <option value="mentionedUsers">Only people I mention</option>
                    </select>
                  </label>
                </>}

                <div className="status-line">
                  <span className={r?.state === 'failed' ? 'status-pill fail' : r?.state === 'completed' ? 'status-pill ok' : 'status-pill'}>
                    {busy[pid] ? '● Sending…' : r?.state === 'completed' ? '✓ Posted' : r?.state === 'failed' ? '✕ Failed' : '○ Ready to post'}
                  </span>
                  {enabled[pid] ? <span className="status-hint">Included in “Post to all”</span> : <span className="status-hint">Skipped in “Post to all”</span>}
                </div>
                {busy[pid] && <div className="progress-loader"><div className="progress" /></div>}
                {r?.state === 'failed' && <div className="sec-err">{r.message}</div>}
                {r?.warning && r?.state !== 'failed' && <div className="banner" style={{ margin: 0 }}>{r.warning}</div>}
                {r?.url && <a className="phone-link big" href={r.url} target="_blank" rel="noreferrer">View your post →</a>}
                <div className="phone-actions">
                  <label className="ck"><input type="checkbox" checked={!!enabled[pid]} onChange={(e) => setEnabled((m) => ({ ...m, [pid]: e.target.checked }))} /><svg viewBox="0 0 64 64"><path className="path" d="M8 33 L26 51 L56 13" /></svg><span>Include in “post to all”</span></label>
                  <button className="post-btn" disabled={!!busy[pid] || (pid === 'x' && (xLen > 280 || (x.pollOn && !!file)))} onClick={() => publishOne(pid)}>{busy[pid] ? 'Posting…' : `Post to ${p.name} →`}</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
        <div className="step-nav">
          <button className="skew-btn ghost" onClick={() => setStep(2)}><span>← Back to content</span></button>
          <span className="step-hint">Posts go live the second you press a button — nothing is scheduled.</span>
        </div>
      </div>
      )}
      <p className="note center">🔒 Direct post only · Your passwords/tokens stay locked in Supabase.</p>
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
      <div className="row2" style={{ marginBottom: 6, alignItems: 'end' }}>
        <div className="messageBox"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search brands…" /><span className="send">⌕</span></div>
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
                <div><b style={{ fontSize: 13 }}>{c.account_name}</b><small style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#8b949e', marginTop: 2 }}><BrandIcon id={p.id} size={12} />{p.name}</small></div>
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

const TOUR_STEPS = [
  { t: 'Welcome to Driftpost', d: 'Post for all your brands from one screen. This 30-second tour shows you how — plain and simple.' },
  { t: 'Step 1 · Connect accounts', d: 'Open Accounts and connect YouTube, Facebook, Instagram and X. Each brand owner connects once, then it just works.' },
  { t: 'Step 2 · Pick your brand', d: 'Use the brand menu at the top. Driftpost automatically finds that brand on all 4 platforms. Star your active clients with the ⋯ menu.' },
  { t: 'Step 3 · Add photo and words', d: 'Drop one photo or video and write one caption. It fills every platform for you.' },
  { t: 'Step 4 · Adjust and publish', d: 'Each platform has its own card — YouTube titles, Instagram captions, Facebook links, X polls. Publish one by one, or press Publish all.' },
];

function TourOverlay({ step, setStep, onDone }) {
  const last = step === TOUR_STEPS.length - 1;
  return (
    <div className="tour-backdrop">
      <div className="tour-card">
        <div className="tour-count">Step {step + 1} of {TOUR_STEPS.length}</div>
        <h2>{TOUR_STEPS[step].t}</h2>
        <p>{TOUR_STEPS[step].d}</p>
        <div className="tour-dots">{TOUR_STEPS.map((_, i) => <span key={i} className={i === step ? 'on' : ''} />)}</div>
        <div className="tour-actions">
          {step > 0 && <button className="skew-btn ghost" onClick={() => setStep(step - 1)}><span>← Back</span></button>}
          <button className="skew-btn ghost" onClick={onDone}><span>Skip</span></button>
          <button className="skew-btn grad" onClick={() => (last ? onDone() : setStep(step + 1))}><span>{last ? 'Start posting →' : 'Next →'}</span></button>
        </div>
      </div>
    </div>
  );
}

export default function Console({ session, onSwitchAccount, onSignOut }) {
  const [view, setView] = useState('create');
  const [navOpen, setNavOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [theme, setTheme] = useTheme();
  const [copyMsg, setCopyMsg] = useState('');
  const [connections, setConnections] = useState([]);
  const [tour, setTour] = useState(null); // null | 'ask' | number (step index)

  const reloadConnections = () => api('/api/connections', session.access_token).then((d) => setConnections(d.connections || [])).catch(() => {});

  useEffect(() => { reloadConnections(); }, [session]);

  useEffect(() => {
    if (tour === null && !localStorage.getItem(`driftpost-tour:${session.user.id}`)) {
      setTour('ask');
    }
  }, []);

  const finishTour = () => {
    try { localStorage.setItem(`driftpost-tour:${session.user.id}`, '1'); } catch {}
    setTour(null);
  };

  const counts = useMemo(() => {
    const c = {};
    connections.forEach((x) => { c[x.platform] = (c[x.platform] || 0) + 1; });
    return c;
  }, [connections]);

  useEffect(() => {
    document.title = view === 'accounts' ? 'Accounts · Driftpost' : 'Platforms · Driftpost';
    document.querySelector('meta[name="robots"]')?.setAttribute('content', 'noindex, nofollow');
  }, [view]);

  const signOutTo = async (where) => {
    try { (await getSupabase())?.auth.signOut(); } catch {}
    setUserOpen(false);
    if (where === 'auth') onSwitchAccount();
    else onSignOut();
  };

  if (!['create', 'accounts'].includes(view)) {
    return (
      <div className="shell">
        <div className="page"><div className="card"><h3>404 — lost in the flow</h3><p className="sub">That view does not exist.</p><button className="skew-btn grad" onClick={() => setView('create')}><span>← Back to Platforms</span></button></div></div>
      </div>
    );
  }

  return (
    <div className="shell">
      {tour === 'ask' && (
        <div className="tour-backdrop">
          <div className="tour-card">
            <h2>New here?</h2>
            <p>Take the 30-second tour and posting will feel obvious. Or skip and explore yourself.</p>
            <div className="tour-actions">
              <button className="skew-btn ghost" onClick={finishTour}><span>Continue</span></button>
              <button className="skew-btn grad" onClick={() => setTour(0)}><span>Get the tour →</span></button>
            </div>
          </div>
        </div>
      )}
      {typeof tour === 'number' && <TourOverlay step={tour} setStep={setTour} onDone={finishTour} />}
      <aside className={navOpen ? 'side open' : 'side'}>
        <button className="brand brand-btn" onClick={() => { setView('create'); setNavOpen(false); }} title="Driftpost home"><img className="logo-img logo-d" src="/logo-dark.png" width="1984" height="512" alt="Driftpost" /><img className="logo-img logo-l" src="/logo-light.png" width="1908" height="512" alt="Driftpost" /></button>
        <div className="radio-container">
          <input type="radio" name="side-nav" id="nav-compose" checked={view === 'create'} onChange={() => { setView('create'); setNavOpen(false); }} />
          <label htmlFor="nav-compose">Compose</label>
          <input type="radio" name="side-nav" id="nav-accounts" checked={view === 'accounts'} onChange={() => { setView('accounts'); setNavOpen(false); }} />
          <label htmlFor="nav-accounts">Accounts <em>{connections.length}</em></label>
          <div className="glider-container"><div className="glider" /></div>
        </div>
        <div className="side-foot">
          <div className="pro-card" style={{ background: '#101838', border: '1px solid #2c3d66', padding: 12, fontSize: 11, color: '#aeb9d8' }}>
            YouTube {counts.youtube || 0} · IG {counts.instagram || 0} · FB {counts.facebook || 0} · X {counts.x || 0}
          </div>
          <div className="user-chip" onClick={() => setUserOpen((o) => !o)} title="Account & theme">
            <span className="avatar">{(session.user.email || '?')[0].toUpperCase()}</span>
            <span><b style={{ fontSize: 12 }}>{session.user.email?.split('@')[0]}</b><small>{session.user.email}</small></span>
            {userOpen && <>
              <span className="dd-backdrop" onClick={(e) => { e.stopPropagation(); setUserOpen(false); }} />
              <span className="user-menu" onClick={(e) => e.stopPropagation()}>
                <span className="um-head">
                  <span className="avatar">{(session.user.email || '?')[0].toUpperCase()}</span>
                  <span><b>{session.user.email?.split('@')[0]}</b><small>{session.user.email}</small></span>
                </span>
                <div className="um-label">Website colors</div>
                <div className="swatches">
                  {THEMES.map((t) => (
                    <button key={t.id} title={t.label} className={theme === t.id ? `swatch sw-${t.id} sel` : `swatch sw-${t.id}`} onClick={() => setTheme(t.id)} />
                  ))}
                  <span className="sw-name">{THEMES.find((t) => t.id === theme)?.label}</span>
                </div>
                <button onClick={() => { try { navigator.clipboard.writeText(session.user.email); setCopyMsg('Email copied'); } catch { setCopyMsg('Copy failed'); } setTimeout(() => setCopyMsg(''), 1500); }}>⧉ Copy email{copyMsg ? ` — ${copyMsg}` : ''}</button>
                <button onClick={() => signOutTo('auth')}>⇄ Switch account</button>
                <button onClick={() => signOutTo('landing')}>⏻ Sign out</button>
              </span>
            </>}
          </div>
        </div>
      </aside>
      {navOpen && <div className="scrim" onClick={() => setNavOpen(false)} />}
      <div className="main">
        <div className="top">
          <button className="menu-btn" onClick={() => setNavOpen(true)} aria-label="Open menu">☰</button>
          <div><h1>{view === 'create' ? 'Platforms' : 'Accounts'}</h1><p>Pick a brand, post everywhere — no tech skills needed</p></div>
          <button className="mini" title="Replay the guided tour" onClick={() => setTour(0)}>◉ Tour</button>
        </div>
        <div className="page">
          {view === 'create'
            ? <Composer session={session} connections={connections} reload={reloadConnections} />
            : <Accounts session={session} connections={connections} setConnections={setConnections} />}
        </div>
        <footer className="foot">
          <span>© {new Date().getFullYear()} Driftpost</span>
          <span className="foot-links">
            <a href="https://github.com/FamebrosStudio/Driftpost" target="_blank" rel="noreferrer">GitHub</a>
            <a href="https://driftpost.onrender.com/health" target="_blank" rel="noreferrer">API status</a>
            <a href="https://driftpostpage.vercel.app">Home</a>
          </span>
        </footer>
      </div>
    </div>
  );
}
