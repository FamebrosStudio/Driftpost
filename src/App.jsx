import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { useSession, getSupabase, pokeSession } from './session.js';
import BrandIcon from './brand.jsx';

const Console = lazy(() => import('./console.jsx'));

function Loader() {
  return <div className="loader-wrap"><div className="bounce"><span className="circle" /><span className="circle" /><span className="circle" /><span className="shadow" /><span className="shadow" /><span className="shadow" /></div></div>;
}



function SpotLine({ text }) {
  const ref = useRef(null);
  const centers = useRef(null);
  const raf = useRef(0);
  // Same glow math as before — but char positions are measured once and
  // cached, and repaints run at most once per animation frame. Identical
  // pixels, zero layout-thrash while scrolling or moving the mouse.
  const measure = () => {
    const el = ref.current;
    if (!el) return [];
    const kids = el.children;
    const out = new Array(kids.length);
    for (let i = 0; i < kids.length; i++) {
      const r = kids[i].getBoundingClientRect();
      out[i] = r.left + r.width / 2;
    }
    return out;
  };
  const paint = (x) => {
    const el = ref.current;
    if (!el) return;
    if (!centers.current) centers.current = measure();
    const kids = el.children;
    const cs = centers.current;
    for (let i = 0; i < kids.length; i++) {
      const d = Math.abs(x - (cs[i] || 0));
      const glow = Math.max(0, 1 - d / 220);
      kids[i].style.opacity = (0.3 + 0.7 * glow).toFixed(2);
    }
  };
  const onMove = (e) => {
    const x = e.clientX;
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => { raf.current = 0; paint(x); });
  };
  const onLeave = () => {
    if (raf.current) { cancelAnimationFrame(raf.current); raf.current = 0; }
    paint(-9999);
  };
  useEffect(() => {
    const drop = () => { centers.current = null; };
    window.addEventListener('scroll', drop, { passive: true });
    window.addEventListener('resize', drop);
    return () => {
      window.removeEventListener('scroll', drop);
      window.removeEventListener('resize', drop);
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, []);
  return (
    <span
      ref={ref}
      className="spot"
      onMouseMove={onMove}
      onMouseLeave={onLeave}
    >
      {text.split('').map((ch, i) => <span key={i}>{ch}</span>)}
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
  { id: 'acceptable-use', label: 'Acceptable Use', hidden: true },
  { id: 'ai-disclaimer', label: 'AI Disclaimer', hidden: true },
  { id: 'platforms-disclaimer', label: 'Platform Disclaimer', hidden: true },
  { id: 'copyright', label: 'Copyright', hidden: true },
  { id: 'cookies', label: 'Cookies', hidden: true },
  { id: 'refunds', label: 'Refunds', hidden: true },
  { id: 'security', label: 'Security', hidden: true },
];

const pageFromUrl = () => {
  // Real multi-page URLs (/privacy) first, legacy hash (#/privacy) second.
  const path = String(window.location.pathname || '/').replace(/^\/+|\/+$/g, '').split('/')[0];
  if (path && PUB_PAGES.some((p) => p.id === path)) return path;
  const h = String(window.location.hash || '').replace(/^#\/?/, '').split('?')[0];
  return PUB_PAGES.some((p) => p.id === h) ? h : 'home';
};

const hashPage = pageFromUrl;

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
      { h: 'What we store', p: 'Login email (Supabase Auth); connected social accounts (names and IDs); AES-256-GCM encrypted OAuth access/refresh tokens; captions, prompts and AI briefs you submit; uploaded media in transit (Instagram copies via your private Supabase storage bucket); publish history (platform, time, URL); IP, device and browser data in hosting access logs for security and diagnostics; support messages. Billing data, if paid plans ever launch, is handled by our payment provider — we never store card numbers.' },
      { h: 'Why each item exists', p: 'Email identifies your account. Account IDs route your posts. Tokens let the official platform APIs publish as you. Prompts and media are the content you asked us to publish. Logs keep the service secure and diagnose failures.' },
      { h: 'Social tokens are secrets', p: 'Tokens are encrypted at rest, held server-side only, never placed in frontend code, logs, analytics or this repo, and never shown in any dashboard. Disconnecting an account deletes its tokens immediately.' },
      { h: 'AI processing', p: 'Caption text you submit is processed by our AI provider (xAI/Grok) solely to generate your caption. We do not use your content to train shared AI models. Do not paste passwords, OTPs or other secrets into the AI writer.' },
      { h: 'Your content stays yours', p: 'You keep full ownership of uploads and captions. You grant Driftpost only the limited licence to store, process and transmit them to platforms you chose. We claim no ownership over client brand content.' },
      { h: 'Your rights', p: 'Access, correct or erase your data anytime: Disconnect removes tokens instantly; the Data Deletion page explains full erasure within 7 days. Contact: famebros.studio@gmail.com.' },
      { h: 'What we never do', p: 'No resale of data, no advertising profiles, no analytics on other users, no automated posting. Posts go out only when you press publish.' },
      { h: 'Platform data', p: 'Publishing uses the official YouTube, Meta, and X APIs under permissions you grant. Each platform applies its own privacy policy to content you publish there.' },
    ],
  },
  terms: {
    kicker: 'Terms of Service',
    title: 'Simple rules.',
    intro: 'Last updated September 2026. By using Driftpost you agree to the following. These terms do not override mandatory consumer-protection law.',
    sections: [
      { h: 'The service', p: 'Driftpost is provided as-is while in beta: a console that publishes content you compose to social accounts you connect. We may change or pause features at any time.' },
      { h: 'Your account', p: 'You are responsible for your login credentials and everything done through your account. Minimum age follows each connected platform\'s own rules.' },
      { h: 'Connect only what is yours', p: 'You represent that you own or are authorised to manage every account, Page, portfolio or profile you connect. Connecting someone else\'s account without permission is your violation, not ours, and will get your access suspended.' },
      { h: 'Your content, your licence to us', p: 'You keep ownership of uploads and captions. You grant Driftpost a limited licence to store, process, resize and transmit them only to deliver the service. You confirm you hold the rights to everything you upload and publish.' },
      { h: 'Review before you publish', p: 'You are responsible for reviewing every post — especially AI-generated captions — before publishing. See the AI Content Disclaimer. Driftpost never auto-publishes; every post goes out because you pressed the button.' },
      { h: 'Platforms are third parties', p: 'YouTube, Meta and X control their APIs, approvals, reach and suspensions. We cannot guarantee a post is accepted, timing is exact, or an account stays in good standing. See the Platform Disclaimer.' },
      { h: 'Acceptable use', p: 'No spam, phishing, scams, impersonation, harassment, IP infringement, bulk abuse, policy circumvention or unlawful content. Breaches mean suspension or termination. See the Acceptable Use Policy.' },
      { h: 'Liability limit', p: 'To the maximum extent permitted by law, Driftpost is not liable for indirect losses — including platform downtime, suspensions, rejected posts, lost reach, revenue or followers. Direct liability, where it applies, is capped at what you paid us in the prior 3 months (currently nothing while free).' },
      { h: 'Contact', p: 'famebros.studio@gmail.com.' },
    ],
  },
  'data-deletion': {
    kicker: 'Data Deletion',
    title: 'Delete your data, anytime.',
    intro: 'You control your data. Removing a connection deletes its tokens immediately — no waiting, no email needed. Full erasure completes within 7 days of request.',
    sections: [
      { h: 'Delete one account', p: 'Console → Accounts → Disconnect next to the account. Its encrypted tokens are deleted from our database at once. This also revokes posting access.' },
      { h: 'Delete everything', p: 'Press Delete account in the account menu (removes connections, history and login), or disconnect all accounts and email famebros.studio@gmail.com from your login email with subject "Delete my data". We confirm by reply within 7 days.' },
      { h: 'Removed our Facebook integration?', p: 'If you removed Drift Post from Facebook settings, Meta sends us a revocation notice. That notice does not identify your local account, so finish with Disconnect on the Accounts page or email us — then erasure is complete.' },
      { h: 'What we keep', p: 'Nothing after deletion except records the law requires (e.g. billing invoices, if paid service launches). We hold no backups of tokens and never sold or shared your data.' },
    ],
  },
  'acceptable-use': {
    kicker: 'Acceptable Use Policy',
    title: 'Keep it clean.',
    intro: 'Driftpost is a publishing tool, not a spam cannon. Breaking these rules means suspension or termination, with no refund of any paid plan.',
    sections: [
      { h: 'Never publish', p: 'Spam, phishing, scams, fraud, impersonation, harassment, hate, malware, illegal material, or anything infringing copyright or trademarks.' },
      { h: 'Never abuse accounts', p: 'Connecting accounts you do not own or manage, fake engagement manipulation, bulk abusive posting, scraping where prohibited, or bypassing platform restrictions.' },
      { h: 'Never abuse Driftpost', p: 'Attacking, probing or overloading the service, sharing logins to evade plan limits, reselling access without permission, or using the AI writer to generate disallowed content.' },
      { h: 'Platform rules apply', p: 'Every post must also satisfy YouTube, Meta and X policies. Their rejection or suspension of your account is governed by them, not us.' },
      { h: 'Report abuse', p: 'Forward evidence to famebros.studio@gmail.com with subject "Abuse report".' },
    ],
  },
  'ai-disclaimer': {
    kicker: 'AI Content Disclaimer',
    title: 'The AI drafts. You decide.',
    intro: 'Driftpost\'s caption writer assists you. It does not replace your judgment, and you own every word you publish.',
    sections: [
      { h: 'Review everything', p: 'AI output may contain errors, awkward phrasing, wrong facts or unsuitable material. You must review, edit and approve every caption before publishing.' },
      { h: 'No guarantees', p: 'We do not guarantee copyright or trademark clearance, legal or advertising compliance, factual accuracy, platform-policy compliance, or any reach, engagement or sales.' },
      { h: 'Your responsibility', p: 'If a caption triggers a complaint, takedown or legal notice, it is your published content and your responsibility. When in doubt, rewrite it yourself or do not post.' },
      { h: 'How it works', p: 'Your brief is matched against your saved brand profile locally, then processed by our AI provider (xAI/Grok) to draft the caption. Your content is not used to train shared AI models.' },
    ],
  },
  'platforms-disclaimer': {
    kicker: 'Third-Party Platform Disclaimer',
    title: 'Their playground, their rules.',
    intro: 'Driftpost publishes through official APIs owned by third parties. We build the best console we can; they control the rest.',
    sections: [
      { h: 'No guarantees', p: 'We cannot guarantee Instagram, Facebook, YouTube or X will accept any post, publish at an exact second, preserve any API, or keep any account in good standing.' },
      { h: 'Permissions are minimal', p: 'We request only the scopes each feature needs (read connected account, publish content, basic profile). If a feature needs more, we ask at that time — never in advance.' },
      { h: 'Your platform standing', p: 'Suspensions, rejections, rate limits and policy strikes are decided by the platforms under your agreement with them. Keep backups of important content.' },
      { h: 'Changes happen', p: 'Platforms change APIs, permissions and review requirements without notice. Features may pause while we adapt; we will say so openly.' },
    ],
  },
  copyright: {
    kicker: 'Copyright & IP Policy',
    title: 'Respect creators.',
    intro: 'You confirm you hold the rights to everything you upload and publish through Driftpost. Brand content you upload stays yours.',
    sections: [
      { h: 'Your promise', p: 'Only upload photos, logos, music and text you own or are licensed to use. AI captions are drafts — verify they do not copy protected expression before publishing.' },
      { h: 'Complaints', p: 'Rights holders: email famebros.studio@gmail.com with subject "Copyright complaint", including the infringing URL, your work, and your contact. We act on valid notices expeditiously, including removal and, for repeat offenders, account termination.' },
      { h: 'Counter-notices', p: 'If your content was removed and you believe it was a mistake, reply with your basis and consent to be contacted. Misuse of this process has consequences.' },
    ],
  },
  cookies: {
    kicker: 'Cookie Policy',
    title: 'Almost none.',
    intro: 'Driftpost uses the minimum storage needed to run. No advertising trackers.',
    sections: [
      { h: 'What we set', p: 'Supabase authentication tokens (keeps you signed in), theme preference, tour/hide-brand preferences. That is the full list while no analytics product is installed.' },
      { h: 'What we do not set', p: 'No ad cookies, no cross-site trackers, no data-broker pixels.' },
      { h: 'If that changes', p: 'Should analytics or advertising cookies ever be added, this page will list them first with an opt-out.' },
    ],
  },
  refunds: {
    kicker: 'Refund & Cancellation Policy',
    title: 'Free while in beta.',
    intro: 'Driftpost currently charges nothing, so there is nothing to refund. These terms apply the moment paid plans launch.',
    sections: [
      { h: 'Today', p: 'All features are free. No card is collected, no trial converts into anything.' },
      { h: 'When paid plans launch', p: 'Prices show exclusive/inclusive of GST, billing frequency, renewal, trial length and cancellation path before you pay. Cancel anytime; access runs to the end of the paid period.' },
      { h: 'Refunds', p: 'Monthly plans: refund within 7 days of first charge if unused. Annual plans: pro-rated refund within 30 days. After that, no refunds except where mandatory law requires.' },
      { h: 'How to cancel', p: 'Billing settings → Cancel, or email famebros.studio@gmail.com from your login email. Confirmation within 2 business days.' },
    ],
  },
  security: {
    kicker: 'Security & Trust Center',
    title: 'How we protect you.',
    intro: 'Plain claims only — everything below describes controls that actually exist in Driftpost today.',
    sections: [
      { h: 'Your passwords stay yours', p: 'Connections happen through official OAuth only. Driftpost will never ask for your social-media password, OTP, UPI PIN or card PIN. Anyone asking is a scammer — report to famebros.studio@gmail.com.' },
      { h: 'Tokens locked down', p: 'Social OAuth tokens are AES-256-GCM encrypted, stored server-side, never in frontend code, logs, analytics or this repo, and never displayed in any dashboard. In transit everything runs over HTTPS.' },
      { h: 'Isolation', p: 'Row-level security confines every query to your own user ID. Brand A can never read Brand B. Brand knowledge lives per brand and never leaks across them.' },
      { h: 'Abuse guards', p: 'Rate limits on AI generation, OAuth, publishing and account-data endpoints; signed OAuth state; upload type and size validation.' },
      { h: 'Your content', p: 'Your uploads and captions remain yours; our licence is limited to delivering the service. AI briefs are processed by xAI/Grok to draft captions and are not used to train shared models.' },
      { h: 'Your controls', p: 'Per-account Disconnect (tokens die instantly), full Delete account button, data deletion within 7 days, publish history recording who posted what, where and when.' },
    ],
  },
};

function DocPage({ page }) {
  const c = PUB_CONTENT[page];
  if (!c) return null;
  return (
    <div className="doc-wrap">
      <div className="landing-kicker">{c.kicker}</div>
      <h1 className="doc-title"><SpotLine text={c.title} /></h1>
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
  const rootRef = useRef(null);
  const gridRef = useRef(null);
  const mouseRaf = useRef(0);
  // Grid interactivity: a glow follows the cursor and the whole grid drifts
  // a few pixels against it. rAF-throttled, transform/opacity only.
  const onGridMouse = (e) => {
    if (mouseRaf.current) return;
    const { clientX, clientY } = e;
    mouseRaf.current = requestAnimationFrame(() => {
      mouseRaf.current = 0;
      const g = gridRef.current;
      if (!g) return;
      const r = g.getBoundingClientRect();
      const nx = Math.min(0.5, Math.max(-0.5, (clientX - r.left) / Math.max(1, r.width) - 0.5));
      const ny = Math.min(0.5, Math.max(-0.5, (clientY - r.top) / Math.max(1, r.height) - 0.5));
      g.style.setProperty('--mx', `${((nx + 0.5) * 100).toFixed(1)}%`);
      g.style.setProperty('--my', `${((ny + 0.5) * 100).toFixed(1)}%`);
      const shift = g.firstChild;
      if (shift) shift.style.transform = `translate3d(${(nx * -22).toFixed(1)}px, ${(ny * -22).toFixed(1)}px, 0)`;
    });
  };
  // Animations are part of the look — but repainting invisible pixels is pure
  // waste. Pause rain + marquee the moment they leave the viewport; they
  // resume pixel-identical the instant they return.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !('IntersectionObserver' in window)) return;
    const els = root.querySelectorAll('.grid-bg, .marquee-in');
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) en.target.classList.toggle('paused', !en.isIntersecting);
    }, { threshold: 0 });
    els.forEach((el) => io.observe(el));
    return () => { io.disconnect(); if (mouseRaf.current) cancelAnimationFrame(mouseRaf.current); };
  }, [pubPage]);
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
    <div className="landing" ref={rootRef} onMouseMove={onGridMouse}>
      <div className="grid-bg" ref={gridRef} aria-hidden="true"><div className="grid-shift"><div className="grid-pan" /><div className="grid-glow" /></div></div>
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
          <span className="land-legal"><button className="link" onClick={() => setPubPage('terms')}>Terms</button> · <button className="link" onClick={() => setPubPage('privacy')}>Privacy</button> · <button className="link" onClick={() => setPubPage('cookies')}>Cookies</button> · <button className="link" onClick={() => setPubPage('acceptable-use')}>Acceptable Use</button> · <button className="link" onClick={() => setPubPage('ai-disclaimer')}>AI Disclaimer</button> · <button className="link" onClick={() => setPubPage('platforms-disclaimer')}>Platforms</button> · <button className="link" onClick={() => setPubPage('copyright')}>Copyright</button> · <button className="link" onClick={() => setPubPage('refunds')}>Refunds</button> · <button className="link" onClick={() => setPubPage('data-deletion')}>Data Deletion</button> · <button className="link" onClick={() => setPubPage('security')}>Security</button> · <button className="link" onClick={() => setPubPage('contact')}>Contact</button></span>
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
  const [agreed, setAgreed] = useState(false);
  const TOS_VERSION = '2026-09-1';

  const submit = async (e) => {
    e.preventDefault();
    if (mode === 'signup' && !agreed) { setError('Please accept the Terms of Service and Privacy Policy first.'); return; }
    setBusy(true); setError(''); setInfo('');
    const client = await getSupabase();
    if (!client) { setError('Supabase is not configured. Add VITE_SUPABASE_URL + key.'); setBusy(false); return; }
    const res = mode === 'login'
      ? await client.auth.signInWithPassword({ email, password })
      : await client.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin, data: { tos_accepted_at: new Date().toISOString(), tos_version: TOS_VERSION, privacy_version: TOS_VERSION } } });
    if (res.error) setError(res.error.message);
    else if (mode === 'signup' && !res.data.session) setInfo('Check your inbox to confirm email, then sign in.');
    else { pokeSession(); markFresh?.(); }
    setBusy(false);
  };

  const google = async () => {
    setBusy(true); setError(''); setInfo('');
    if (mode === 'signup' && !agreed) { setError('Please accept the Terms of Service and Privacy Policy first.'); setBusy(false); return; }
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
          {mode === 'signup' && (
            <label className="ck" style={{ alignItems: 'start' }}><input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} /><svg viewBox="0 0 64 64"><path className="path" d="M8 33 L26 51 L56 13" /></svg><span style={{ fontWeight: 400 }}>I agree to the <a href="/terms" target="_blank" rel="noreferrer">Terms of Service</a> and <a href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a></span></label>
          )}
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
    try { window.history.pushState({}, '', id === 'home' ? '/' : `/${id}`); } catch {}
  };
  useEffect(() => {
    const onUrl = () => setPubPageState(pageFromUrl());
    window.addEventListener('popstate', onUrl);
    window.addEventListener('hashchange', onUrl);
    return () => { window.removeEventListener('popstate', onUrl); window.removeEventListener('hashchange', onUrl); };
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
    // Landing pages are public and indexable for everyone; the console and
    // auth stay private. Based on page, never on login state — the same URL
    // must serve the same directive to every visitor (and every crawler).
    const isPublic = entry === 'landing';
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
