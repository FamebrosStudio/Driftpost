import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { useSession, getSupabase, pokeSession } from './session.js';
import BrandIcon from './brand.jsx';

const Console = lazy(() => import('./console.jsx'));

function Loader() {
  return <div className="loader-wrap"><div className="bounce"><span className="circle" /><span className="circle" /><span className="circle" /><span className="shadow" /><span className="shadow" /><span className="shadow" /></div></div>;
}



function SpotLine({ text }) {
  const ref = useRef(null);
  const paint = (x) => {
    const el = ref.current;
    if (!el) return;
    const kids = el.children;
    for (let i = 0; i < kids.length; i++) {
      const r = kids[i].getBoundingClientRect();
      const d = Math.abs(x - (r.left + r.width / 2));
      const glow = Math.max(0, 1 - d / 220);
      kids[i].style.opacity = (0.3 + 0.7 * glow).toFixed(2);
    }
  };
  return (
    <span
      ref={ref}
      className="spot"
      onMouseMove={(e) => paint(e.clientX)}
      onMouseLeave={() => paint(-9999)}
    >
      {text.split('').map((ch, i) => <span key={i}>{ch === ' ' ? ' ' : ch}</span>)}
    </span>
  );
}

const PUB_PAGES = [
  { id: 'home', label: 'Home' },
  { id: 'about', label: 'About' },
  { id: 'how', label: 'How to use' },
  { id: 'platforms', label: 'Platforms' },
  { id: 'faq', label: 'FAQ' },
  { id: 'contact', label: 'Contact' },
  { id: 'privacy', label: 'Privacy', hidden: true },
  { id: 'terms', label: 'Terms', hidden: true },
  { id: 'data-deletion', label: 'Data Deletion', hidden: true },
];

const hashPage = () => {
  const h = String(window.location.hash || '').replace(/^#\/?/, '').split('?')[0];
  return PUB_PAGES.some((p) => p.id === h) ? h : 'home';
};

const PUB_CONTENT = {
  about: {
    kicker: 'What is Drift Post',
    title: 'One screen for every audience you own.',
    intro: 'Driftpost is a publishing console for people who run many brands — agencies, studios, creators. Instead of opening YouTube Studio, Meta Business Suite, and X in twelve tabs, you pick the brand once and post to all four platforms from four side-by-side cards.',
    sections: [
      { h: 'Brand-first, not platform-first', p: 'Agencies think in clients: Velvet Salon, SK Furniture, Sarang Hospital. Driftpost groups every connected account under its brand and auto-matches the same brand across YouTube, Instagram, Facebook and X.' },
      { h: 'Every native option', p: 'Titles, tags, thumbnails and visibility for YouTube. Captions, alt text and collaborators for Instagram. Links, buttons and age limits for Facebook. Polls and reply controls for X. If the platform API allows it, the card has it.' },
      { h: 'Direct publishing only', p: 'Nothing is scheduled, queued, or automated behind your back. Every post goes out the second you press publish — from your accounts, with your tokens, encrypted at rest.' },
    ],
  },
  how: {
    kicker: 'How to use',
    title: 'Live in five minutes.',
    intro: 'Follow these once. After that, posting for any brand takes under a minute.',
    sections: [
      { h: '1 · Sign in', p: 'Open the site, press Get started, continue with Google or email. You land on the home page first every visit — press Enter console.' },
      { h: '2 · Connect accounts', p: 'Go to Accounts and connect YouTube (Google login), Facebook + Instagram (one Meta login covers both), and X. Each brand owner connects once. Take the 30-second tour when offered.' },
      { h: '3 · Pick your brand', p: 'Back on Platforms, choose the brand from the menu. Its accounts load into the four cards automatically. Star active clients with the ⋯ menu; hide the rest.' },
      { h: '4 · Drop media, write once', p: 'Add one photo or video and one caption. Shared content fills every card; open a card to fine-tune that platform only.' },
      { h: '5 · Publish', p: 'Press a card to publish one platform, or Publish all for everything. Done ✓ links appear under each card.' },
    ],
  },
  platforms: {
    kicker: 'Platforms',
    title: 'Four platforms. Zero tabs.',
    intro: 'Each card mirrors what the platform itself asks for — nothing missing, nothing invented.',
    sections: [
      { h: 'YouTube', p: 'Video + title, description, tags, visibility, thumbnail, category, made-for-kids, license, embedding, stats visibility, subscriber notifications. Private first, public when ready.' },
      { h: 'Instagram', p: 'Photo or reel + caption, alt text, topics, paid-partner mentions, up-to-3 collaborators, location, one-tap mirror to the Facebook Page.' },
      { h: 'Facebook', p: 'Message, link with custom preview title/caption/image, call-to-action buttons, 13/18/21/25+ age limits, unpublished dark posts, mirror to Instagram.' },
      { h: 'X', p: '280 characters with live counter, photos/GIF/video, 2–4 choice polls with durations, who-can-reply controls.' },
    ],
  },
  faq: {
    kicker: 'FAQ',
    title: 'Asked often.',
    intro: '',
    sections: [
      { h: 'Is it free?', p: 'Yes while in beta. YouTube, Meta and Supabase free tiers cover normal agency volume. X may need a paid tier if you post at high volume — that is X billing you, not us.' },
      { h: 'Why is a page missing after connecting?', p: 'Meta only returns what the logged-in Facebook user manages and what was ticked in the grant dialog. Portfolio-owned pages need their portfolio selected during login. Reconnect with “all current and future” and tick everything.' },
      { h: 'Where are my tokens?', p: 'Encrypted in your Supabase project. The app servers never log them, and disconnecting deletes them.' },
      { h: 'Can clients share one login?', p: 'Yes — connect every portfolio under one login and switch brands from the menu. Or give each client their own login for strict isolation. Both work.' },
      { h: 'Does it schedule posts?', p: 'No. Driftpost publishes the second you press the button — direct publishing only, by design.' },
    ],
  },
  contact: {
    kicker: 'Contact',
    title: 'Talk to a human.',
    intro: 'Bug reports, brand onboarding help, feature asks — everything lands in one place.',
    sections: [
      { h: 'GitHub', p: 'Open an issue at github.com/FamebrosStudio/Driftpost — fastest for bugs, paste the exact error text.' },
      { h: 'Email', p: 'Write to famebros.studio@gmail.com with your brand name and a screenshot.' },
      { h: 'What to include', p: 'Platform (YouTube/Instagram/Facebook/X), brand name, what you clicked, and what the card said. That is everything needed to fix it.' },
    ],
  },
  privacy: {
    kicker: 'Privacy Policy',
    title: 'Your data stays yours.',
    intro: 'Last updated September 2026. Driftpost publishes to your accounts — it does not sell, rent, or share your data with anyone.',
    sections: [
      { h: 'What we store', p: 'Your login email (Supabase Auth), your connected social accounts (names and IDs), and AES-256-GCM encrypted OAuth tokens. Uploaded media passes through encrypted transit to the platform you chose; Instagram copies travel via your private Supabase storage bucket.' },
      { h: 'What we never do', p: 'No resale of data, no advertising profiles, no analytics on other users, no automated posting. Posts go out only when you press publish.' },
      { h: 'Platform data', p: 'Publishing uses the official YouTube, Meta, and X APIs under permissions you grant. Each platform applies its own privacy policy to content you publish there.' },
      { h: 'Deletion', p: 'Disconnect an account on the Accounts page to delete its tokens immediately. To erase everything, email famebros.studio@gmail.com with your login email.' },
      { h: 'Contact', p: 'Questions: famebros.studio@gmail.com.' },
    ],
  },
  terms: {
    kicker: 'Terms of Service',
    title: 'Simple rules.',
    intro: 'Last updated September 2026. By using Driftpost you agree to the following.',
    sections: [
      { h: 'The service', p: 'Driftpost is provided as-is while in beta: a console that publishes content you compose to social accounts you connect. We may change or pause features at any time.' },
      { h: 'Your responsibility', p: 'You own what you publish. Follow YouTube, Meta, and X rules, respect copyright, and only connect accounts you are allowed to post to. Platform rate limits and API changes are outside our control.' },
      { h: 'Acceptable use', p: 'No spam, no bulk automation abuse, no unlawful content, no reselling access to the console without permission.' },
      { h: 'Accounts', p: 'Keep your login safe. We may suspend accounts that abuse the service.' },
      { h: 'Contact', p: 'famebros.studio@gmail.com.' },
    ],
  },
  'data-deletion': {
    kicker: 'Data Deletion',
    title: 'Delete your data, anytime.',
    intro: 'You control your data. Removing a connection deletes its tokens immediately — no waiting, no email needed.',
    sections: [
      { h: 'Delete one account', p: 'Console → Accounts → Disconnect next to the account. Its encrypted tokens are deleted from our database at once. This also revokes posting access.' },
      { h: 'Delete everything', p: 'Disconnect all accounts, then email famebros.studio@gmail.com from your login email with subject "Delete my data". We erase your connections, history and login within 7 days and confirm by reply.' },
      { h: 'Removed our Facebook integration?', p: 'If you removed Drift Post from Facebook settings, Meta notifies us automatically and we purge your stored Meta tokens. Use the steps above for full erasure.' },
      { h: 'What we keep', p: 'Nothing after deletion. We hold no backups of tokens and never sold or shared your data.' },
    ],
  },
};

function DocPage({ page }) {
  const c = PUB_CONTENT[page];
  if (!c) return null;
  return (
    <div className="doc-wrap">
      <div className="landing-kicker">{c.kicker}</div>
      <h1 className="doc-title">{c.title}</h1>
      {c.intro && <p className="doc-intro">{c.intro}</p>}
      <div className="doc-list">
        {c.sections.map((s, i) => (
          <div key={i} className="zig-copy"><span className="zig-n">{String(i + 1).padStart(2, '0')}</span><h2>{s.h}</h2><p>{s.p}</p></div>
        ))}
      </div>
    </div>
  );
}

function Landing({ onEnter, session, pubPage, setPubPage }) {
  const dock = [
    { id: 'youtube', tip: 'YouTube — video, titles, tags', href: 'https://www.youtube.com' },
    { id: 'instagram', tip: 'Instagram — reels, captions', href: 'https://www.instagram.com' },
    { id: 'facebook', tip: 'Facebook — pages, links', href: 'https://www.facebook.com' },
    { id: 'x', tip: 'X — 280 chars, media', href: 'https://x.com' },
  ];
  const cards = [
    { id: 'youtube', t: 'YouTube, handled', d: 'Titles, descriptions, tags, thumbnails, visibility — every upload setting, zero Studio tabs.' },
    { id: 'instagram', t: 'Instagram, handled', d: 'Captions, alt text, collaborators, topics, location — reels and photos from one card.' },
    { id: 'facebook', t: 'Facebook, handled', d: 'Messages, links with custom previews, action buttons, age limits, dark posts.' },
    { id: 'x', t: 'X, handled', d: '280 characters, polls, reply controls, media — posted in one click.' },
  ];
  const steps = [
    { n: '01', t: 'Connect once', d: 'Each brand owner links YouTube, Facebook, Instagram and X one time. Tokens stay encrypted; reconnects are one click.' },
    { n: '02', t: 'Pick the brand', d: 'Choose Hair Match Salon, SK Furniture, Velvet Salon — Driftpost auto-loads that brand on all four platforms.' },
    { n: '03', t: 'Drop and write', d: 'One photo or video, one caption. Shared everywhere instantly, then fine-tune per platform.' },
    { n: '04', t: 'Fire everywhere', d: 'Publish per platform or hit Publish all. Watch Done ✓ roll across all four phones with view links.' },
  ];
  return (
    <div className="landing">
      <div className="rain" />
      <nav className="land-nav">
        <button className="land-logo" onClick={() => setPubPage('home')} title="Driftpost home"><img className="logo-img logo-d" src="/logo-dark-620.png" srcSet="/logo-dark-620.png 620w, /logo-dark.png 1984w" sizes="248px" width="1984" height="512" fetchpriority="high" decoding="async" alt="Driftpost" /></button>
        <div className="land-links">
          {PUB_PAGES.filter((p) => !p.hidden).map((p) => (
            <button key={p.id} className={pubPage === p.id ? 'on' : ''} onClick={() => setPubPage(p.id)}>{p.label}</button>
          ))}
        </div>
        <button className="skew-btn grad" onClick={onEnter}><span>{session ? 'Enter console →' : 'Get started →'}</span></button>
      </nav>
      {pubPage === 'home' ? <>
      <header className="landing-in">
        <div className="landing-kicker">Driftpost — publish everywhere</div>
        <h1><SpotLine text="Post once." /><br /><SpotLine text="Everywhere." /></h1>
        <p>Pick a brand. Drop one file. Tune each platform exactly like its own app — then fire YouTube, Instagram, Facebook and X together.</p>
        <div className="landing-cta">
          <button className="skew-btn grad" onClick={onEnter}><span>{session ? 'Enter console →' : 'Get started free →'}</span></button>
        </div>
        <div className="social-dock">
          {dock.map((d) => (
            <span key={d.id} className="icon-content">
              <a data-social={d.id} href={d.href} target="_blank" rel="noreferrer" aria-label={d.tip}><span className="filled" /><BrandIcon id={d.id} size={22} /></a>
              <span className="tooltip">{d.tip}</span>
            </span>
          ))}
        </div>
        <div className="landing-stats">
          <span><b>4</b>platforms</span>
          <span><b>40+</b>brands</span>
          <span><b>1</b>screen</span>
        </div>
        <div className="scroll-hint">Scroll for the tour ↓</div>
      </header>
      <div className="hstrip-wrap">
        <div className="hstrip-label">Drag sideways — every platform, covered ↓</div>
        <div className="hstrip">
          {cards.map((c) => (
            <div key={c.id} className="hcard">
              <span className="hcard-ic"><BrandIcon id={c.id} size={26} /></span>
              <b>{c.t}</b>
              <p>{c.d}</p>
            </div>
          ))}
          <div className="hcard hot">
            <b>40+ brands, one menu</b>
            <p>Salons, jewellers, clinics, resorts — switch clients faster than opening tabs.</p>
          </div>
        </div>
      </div>
      <section className="zig">
        {steps.map((s, i) => (
          <div key={s.n} className={i % 2 ? 'zig-row flip' : 'zig-row'}>
            <div className="zig-copy"><span className="zig-n">{s.n}</span><h2>{s.t}</h2><p>{s.d}</p></div>
            <div className="zig-art"><span className="zig-big">{s.n}</span></div>
          </div>
        ))}
      </section>
      <div className="marquee" aria-hidden="true"><div className="marquee-in">
        {['Velvet Salon', 'SK Furniture', 'Kanchanmala Jewellers', 'Sarang Hospital', 'Luxxe Nail Studio', 'MAP Clothing', 'Pixi Grow', 'Anand Furniture', 'Velvet Salon', 'SK Furniture', 'Kanchanmala Jewellers', 'Sarang Hospital', 'Luxxe Nail Studio', 'MAP Clothing', 'Pixi Grow', 'Anand Furniture'].map((b, i) => <span key={i}>{b} ✦</span>)}
      </div></div>
      </> : <DocPage page={pubPage} />}
      <footer className="land-foot">
        <h2>Stop opening four apps.</h2>
        <button className="skew-btn grad" onClick={onEnter}><span>{session ? 'Enter console →' : 'Start free →'}</span></button>
        <div className="land-fine">
          <span>Free while in beta · Your logins never leave the platforms · © {new Date().getFullYear()} Driftpost</span>
          <span className="land-legal"><button className="link" onClick={() => setPubPage('privacy')}>Privacy</button> · <button className="link" onClick={() => setPubPage('terms')}>Terms</button></span>
        </div>
      </footer>
    </div>
  );
}

function Auth({ mode, setMode, onBack, markFresh }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(''); setInfo('');
    const client = await getSupabase();
    if (!client) { setError('Supabase is not configured. Add VITE_SUPABASE_URL + key.'); setBusy(false); return; }
    const res = mode === 'login'
      ? await client.auth.signInWithPassword({ email, password })
      : await client.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
    if (res.error) setError(res.error.message);
    else if (mode === 'signup' && !res.data.session) setInfo('Check your inbox to confirm email, then sign in.');
    else { pokeSession(); markFresh?.(); }
    setBusy(false);
  };

  const google = async () => {
    setBusy(true); setError(''); setInfo('');
    const client = await getSupabase();
    if (!client) { setError('Supabase is not configured.'); setBusy(false); return; }
    markFresh?.();
    const { error } = await client.auth.signInWithOAuth({
      provider: 'google', options: { redirectTo: window.location.origin, queryParams: { prompt: 'select_account' } }
    });
    if (error) { setError(error.message); setBusy(false); }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="brand"><img className="logo-img logo-d" src="/logo-dark.png" width="1984" height="512" decoding="async" alt="Driftpost" /><img className="logo-img logo-l" src="/logo-light.png" width="1908" height="512" decoding="async" alt="Driftpost" /></div>
        <h1>{mode === 'login' ? 'Welcome back.' : 'Start posting.'}</h1>
        <p>One calm composer for YouTube, Instagram, Facebook and X. No noise.</p>
        <form className="login-form" onSubmit={submit}>
          <button className="skew-btn ghost" type="button" disabled={busy} onClick={google}><span>{mode === 'login' ? 'Continue with Google' : 'Sign up with Google'}</span></button>
          <div className="input-span"><span className="label">Email address</span><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></div>
          <div className="input-span"><span className="label">Password</span><input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" /></div>
          {error && <div className="alert err">{error}</div>}
          {info && <div className="banner">{info}</div>}
          <button className="skew-btn grad submit" disabled={busy}><span>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</span></button>
        </form>
        <p className="note" style={{ textAlign: 'center' }}>
          {mode === 'login' ? 'New here?' : 'Have an account?'}{' '}
          <button className="link" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); setInfo(''); }}>{mode === 'login' ? 'Create account' : 'Sign in'}</button>
          {' · '}<button className="link" onClick={onBack}>← Back</button>
        </p>
      </div>
    </div>
  );
}

export default function App() {
  const { session } = useSession();
  const [mode, setMode] = useState('login');
  const [entry, setEntry] = useState('landing');
  const [entered, setEntered] = useState(false);
  const [pubPage, setPubPageState] = useState(() => (typeof window !== 'undefined' ? hashPage() : 'home'));
  const setPubPage = (id) => {
    setPubPageState(id);
    try { window.location.hash = `#/${id}`; } catch {}
  };
  useEffect(() => {
    const onHash = () => setPubPageState(hashPage());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const FRESH_KEY = 'driftpost-fresh-login';
  const markFreshLogin = () => { try { sessionStorage.setItem(FRESH_KEY, '1'); } catch {} };

  useEffect(() => {
    // Every page open starts on the landing page — even logged in.
    // Only a fresh sign-in inside this visit skips straight to the console
    // (the Auth screen marks it; restored sessions never carry the mark).
    try {
      if (session && sessionStorage.getItem(FRESH_KEY)) {
        sessionStorage.removeItem(FRESH_KEY);
        setEntered(true);
      }
    } catch {}
    if (!session) { setEntered(false); }
  }, [session]);

  useEffect(() => {
    document.title = !session
      ? entry === 'landing'
        ? (pubPage === 'home' ? 'Driftpost — Publish Everywhere' : `${PUB_PAGES.find((p) => p.id === pubPage)?.label} · Driftpost`)
        : 'Sign in · Driftpost'
      : 'Console · Driftpost';
    // Landing pages are public and indexable; the console and auth stay private.
    const isPublic = !session && entry === 'landing';
    document.querySelector('meta[name="robots"]')?.setAttribute('content', isPublic ? 'index, follow, max-image-preview:large' : 'noindex, nofollow');
  }, [session, entry, pubPage]);

  useEffect(() => { window.scrollTo(0, 0); }, [pubPage]);

  // Logged-out visitors render instantly — nothing waits on the auth library.
  if (!session) return entry === 'landing' ? <Landing session={false} pubPage={pubPage} setPubPage={setPubPage} onEnter={() => setEntry('auth')} /> : <Auth mode={mode} setMode={setMode} onBack={() => setEntry('landing')} markFresh={markFreshLogin} />;
  if (!entered) return <Landing session pubPage={pubPage} setPubPage={setPubPage} onEnter={() => setEntered(true)} />;

  return (
    <Suspense fallback={<Loader />}>
      <Console session={session} onSwitchAccount={() => setEntry('auth')} onSignOut={() => setEntry('landing')} />
    </Suspense>
  );
}
