import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { api, groupBrands } from '../lib.js';
import BrandIcon from '../brand.jsx';
import ProgressIndicator from './ProgressIndicator.jsx';
import SetupCard from './SetupCard.jsx';
import PlatformSelector from './PlatformSelector.jsx';
import ExistingTrioSelector from './ExistingTrioSelector.jsx';
import ContinueButton from './ContinueButton.jsx';
import './stage1.css';

const BrandSelectorModal = lazy(() => import('./BrandSelectorModal.jsx'));
const TrioBuilder = lazy(() => import('./TrioBuilder.jsx'));

const Svg = ({ d }) => (
  <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
const ICONS = {
  brand: <Svg d="M4 7l1.2-4h13.6L20 7 M4 7h16 M4 7v13h16V7 M9.5 20v-6h5v6" />,
  platforms: <Svg d="M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z" />,
  trio: <Svg d="M12 3l9 5-9 5-9-5z M3 12.5l9 5 9-5 M3 17l9 5 9-5" />,
  saved: <Svg d="M7 3h10v18l-5-4-5 4z" />,
};

function load(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? fallback;
  } catch { return fallback; }
}
function save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

export default function StageOnePage({ session, onSignOut }) {
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState(() => load('driftpost-stage1-type', ''));
  const [brandKey, setBrandKey] = useState(() => load('driftpost-stage1-brand', ''));
  const [platforms, setPlatforms] = useState(() => load('driftpost-stage1-platforms', []));
  const [trios, setTrios] = useState(() => load('driftpost-trios', []));
  const [activeTrioId, setActiveTrioId] = useState(() => load('driftpost-stage1-trio', ''));
  const [brandOpen, setBrandOpen] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [savedTick, setSavedTick] = useState(false);

  useEffect(() => {
    document.title = 'Stage 1 · Driftpost';
  }, []);

  useEffect(() => {
    let live = true;
    api('/api/connections', session.access_token)
      .then((d) => { if (live) setConnections(d.connections || []); })
      .catch(() => {})
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [session]);

  const brands = useMemo(() => groupBrands(connections), [connections]);
  const brand = brands.find((b) => b.key === brandKey) || null;
  useEffect(() => {
    if (!loading && brands.length && brandKey && !brands.some((b) => b.key === brandKey)) setBrandKey('');
  }, [loading, brands, brandKey]);

  const connById = useMemo(() => Object.fromEntries(connections.map((c) => [c.id, c])), [connections]);
  const counts = useMemo(() => {
    const c = {};
    connections.forEach((x) => { c[x.platform] = (c[x.platform] || 0) + 1; });
    return c;
  }, [connections]);

  const valid =
    type === 'common_brand' ? !!brand :
    type === 'platform_selection' ? platforms.length > 0 :
    type === 'create_trios' ? trios.length > 0 :
    type === 'existing_trios' ? trios.some((t) => t.id === activeTrioId) : false;

  const pick = (t) => { setType(t); save('driftpost-stage1-type', t); setSavedTick(false); };
  const chooseBrand = (k) => { setBrandKey(k); save('driftpost-stage1-brand', k); setBrandOpen(false); };
  const togglePlatform = (id) => setPlatforms((p) => {
    const n = p.includes(id) ? p.filter((x) => x !== id) : [...p, id];
    save('driftpost-stage1-platforms', n);
    return n;
  });
  const addTrio = (trio) => {
    setTrios((ts) => { const n = [...ts.slice(-19), trio]; save('driftpost-trios', n); return n; });
    setActiveTrioId(trio.id); save('driftpost-stage1-trio', trio.id);
    setBuilderOpen(false);
  };
  const pickTrio = (id) => { setActiveTrioId(id); save('driftpost-stage1-trio', id); };
  const accountName = (id) => connById[id]?.account_name || '';
  const brandPlats = (b) => ['instagram', 'facebook', 'youtube', 'x'].filter((pid) => b.map[pid]);

  const cont = () => {
    save('driftpost-stage1-type', type);
    save('driftpost-stage1-done', true);
    setSavedTick(true);
    setTimeout(() => setSavedTick(false), 1600);
  };

  return (
    <div className="stage1">
      <div className="stage1-in">
        <div className="stage1-top">
          <button type="button" className="stage1-signout" onClick={onSignOut}>Sign out</button>
        </div>
        <header className="stage1-head">
          <span className="stage1-badge">Stage 1 of 3</span>
          <h1>How do you want to organize your accounts?</h1>
          <p>Choose the setup that works best for your workflow. You can change this later.</p>
        </header>
        <ProgressIndicator current={1} />
        {loading ? (
          <div className="stage1-loading">Loading your accounts…</div>
        ) : (
          <div className="stage1-cards" role="radiogroup" aria-label="Account setup options">
            <SetupCard id="common_brand" selected={type === 'common_brand'} onSelect={pick} icon={ICONS.brand} title="Pick One Common Brand" summary="Choose one brand and manage all connected platforms together.">
              {brand ? (
                <div className="s1-pick">
                  <span className="s1-icons">{brandPlats(brand).map((pid) => <BrandIcon key={pid} id={pid} size={14} />)}</span>
                  <b>{brand.label}</b>
                  <small>{brandPlats(brand).length} accounts</small>
                  <button type="button" className="s1-mini" onClick={() => setBrandOpen(true)}>Change</button>
                </div>
              ) : (
                <button type="button" className="s1-btn" onClick={() => setBrandOpen(true)}>Choose a brand</button>
              )}
              {!brands.length && <p className="s1-note">No accounts connected yet — connect accounts first, then pick a brand here.</p>}
            </SetupCard>

            <SetupCard id="platform_selection" selected={type === 'platform_selection'} onSelect={pick} icon={ICONS.platforms} title="Select Platforms" summary="Just pick the platforms. Nothing more.">
              <PlatformSelector selected={platforms} counts={counts} onToggle={togglePlatform} />
              <p className="s1-note">Minimum 1 platform required{platforms.length ? ` · ${platforms.length} selected` : ''}.</p>
            </SetupCard>

            <SetupCard id="create_trios" selected={type === 'create_trios'} onSelect={pick} icon={ICONS.trio} title="Create Trios" summary="Group 2–3 accounts that share the same post.">
              <button type="button" className="s1-btn" onClick={() => setBuilderOpen(true)}>Create a trio</button>
              {trios.map((t) => (
                <div key={t.id} className="trio-mini"><b>{t.name}</b><small>{(t.accountIds || []).length} accounts</small></div>
              ))}
            </SetupCard>

            <SetupCard id="existing_trios" selected={type === 'existing_trios'} onSelect={pick} icon={ICONS.saved} title="Select Created Trios" summary="Reuse a group you already built.">
              <ExistingTrioSelector trios={trios} activeId={activeTrioId} accountName={accountName} onPick={pickTrio} />
            </SetupCard>
          </div>
        )}
      </div>
      <ContinueButton disabled={!valid} saved={savedTick} onClick={cont} />
      {brandOpen && (
        <Suspense fallback={null}>
          <BrandSelectorModal brands={brands} activeKey={brandKey} onPick={chooseBrand} onClose={() => setBrandOpen(false)} />
        </Suspense>
      )}
      {builderOpen && (
        <Suspense fallback={null}>
          <TrioBuilder connections={connections} onSave={addTrio} onClose={() => setBuilderOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}
