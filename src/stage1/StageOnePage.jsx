import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { api, groupBrands } from '../lib.js';
import BrandIcon from '../brand.jsx';
import ProgressIndicator from './ProgressIndicator.jsx';
import SetupCard from './SetupCard.jsx';
import PlatformSelector from './PlatformSelector.jsx';
import ExistingGroupSelector from './ExistingGroupSelector.jsx';
import ContinueButton from './ContinueButton.jsx';
import './stage1.css';

const BrandSelectorModal = lazy(() => import('./BrandSelectorModal.jsx'));
const GroupBuilder = lazy(() => import('./GroupBuilder.jsx'));

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

export default function StageOnePage({ session, onSignOut, onNext, onHistory, onBackAccounts }) {
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [connsOk, setConnsOk] = useState(false);
  const [connsError, setConnsError] = useState('');
  const [reloadTick, setReloadTick] = useState(0);
  const [type, setType] = useState(() => {
    const t = load('driftpost-stage1-type', '');
    // One-time carryover from the old "trios" naming.
    if (t === 'create_trios') return 'create_groups';
    if (t === 'existing_trios') return 'existing_groups';
    return t;
  });
  const [brandKey, setBrandKey] = useState(() => load('driftpost-stage1-brand', ''));
  const [platforms, setPlatforms] = useState(() => load('driftpost-stage1-platforms', []));
  const [groups, setGroups] = useState(() => {
    const g = load('driftpost-groups', null) ?? load('driftpost-trios', []);
    return Array.isArray(g) ? g : [];
  });
  const [activeGroupId, setActiveGroupId] = useState(() => load('driftpost-stage1-group', load('driftpost-stage1-trio', '')));
  const [brandOpen, setBrandOpen] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [savedTick, setSavedTick] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem('driftpost-groups') == null && localStorage.getItem('driftpost-trios') != null) {
        localStorage.setItem('driftpost-groups', localStorage.getItem('driftpost-trios'));
      }
      // One-time cleanup of the retired "trios" keys.
      localStorage.removeItem('driftpost-trios');
      localStorage.removeItem('driftpost-stage1-trio');
    } catch {}
  }, []);

  useEffect(() => {
    document.title = 'Stage 1 · Driftpost';
  }, []);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setConnsError('');
    api('/api/connections', session.access_token)
      .then((d) => { if (live) { setConnections(d.connections || []); setConnsOk(true); } })
      .catch(() => { if (live) setConnsError('Could not load your accounts — the server may be waking up.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [session, reloadTick]);

  const brands = useMemo(() => groupBrands(connections), [connections]);
  const brand = brands.find((b) => b.key === brandKey) || null;
  useEffect(() => {
    // Clear a stale saved brand once accounts are known — including the
    // empty list (all disconnected), which the old guard never handled.
    if (!connsOk) return;
    if (brandKey && !brands.some((b) => b.key === brandKey)) {
      setBrandKey('');
      save('driftpost-stage1-brand', '');
    }
  }, [connsOk, brands, brandKey]);

  const connById = useMemo(() => Object.fromEntries(connections.map((c) => [c.id, c])), [connections]);
  const counts = useMemo(() => {
    const c = {};
    connections.forEach((x) => { c[x.platform] = (c[x.platform] || 0) + 1; });
    return c;
  }, [connections]);
  const ORDER = ['instagram', 'facebook', 'youtube', 'x'];
  // Per-group platform selection: a group only feeds its ticked platforms
  // into Stage 2/3. Stored on the group itself (g.platforms); groups saved
  // before this feature behave as "all member platforms".
  const activeGroup = groups.find((g) => g.id === activeGroupId) || null;
  const activeMemberPlats = useMemo(() => (
    ORDER.filter((pid) => (activeGroup?.accountIds || []).some((id) => connById[id]?.platform === pid))
  ), [activeGroup, connById]);
  const activeSelected = activeGroup && Array.isArray(activeGroup.platforms) && activeGroup.platforms.length
    ? activeGroup.platforms.filter((p) => activeMemberPlats.includes(p))
    : activeMemberPlats;
  const groupCounts = useMemo(() => {
    const c = {};
    (activeGroup?.accountIds || []).forEach((id) => {
      const p = connById[id]?.platform;
      if (p) c[p] = (c[p] || 0) + 1;
    });
    return c;
  }, [activeGroup, connById]);
  const toggleGroupPlatform = (pid) => {
    if (!activeGroup || !(groupCounts[pid] > 0)) return;
    const cur = activeSelected.includes(pid)
      ? activeSelected.filter((x) => x !== pid)
      : [...ORDER.filter((p) => p === pid || activeSelected.includes(p))];
    if (!cur.length) return; // keep at least one platform on the group
    setGroups((gs) => {
      const n = gs.map((g) => (g.id === activeGroup.id ? { ...g, platforms: cur } : g));
      save('driftpost-groups', n);
      return n;
    });
  };
  const groupPlatsLabel = (g) => {
    const member = ORDER.filter((pid) => (g.accountIds || []).some((id) => connById[id]?.platform === pid));
    const sel = Array.isArray(g.platforms) && g.platforms.length ? g.platforms.filter((p) => member.includes(p)) : member;
    return sel.length ? sel.join(' · ') : 'no live accounts';
  };
  // Option 2 pills follow the picked brand: platforms the brand is not
  // linked to go grey and unclickable. With no brand, any connected
  // platform counts. Selected-but-unavailable entries are pruned.
  const availablePids = useMemo(() => (
    brand ? ORDER.filter((pid) => brand.map[pid]) : ORDER.filter((pid) => (counts[pid] || 0) > 0)
  ), [brand, counts]);
  useEffect(() => {
    // Only prune after accounts load: pruning against an empty list would
    // wipe a valid saved selection on every refresh.
    if (!connsOk) return;
    setPlatforms((p) => {
      const n = p.filter((id) => availablePids.includes(id));
      if (n.length === p.length) return p;
      save('driftpost-stage1-platforms', n);
      return n;
    });
  }, [availablePids, connsOk]);

  // Live platforms across all groups (member accounts only, honouring each
  // group's own platform selection) — drives create_groups validity.
  const groupLivePlats = useMemo(() => {
    const s = new Set();
    (groups || []).forEach((g) => (g.accountIds || []).forEach((id) => {
      const p = connById[id]?.platform;
      if (!p) return;
      const sel = Array.isArray(g.platforms) && g.platforms.length ? g.platforms : null;
      if (!sel || sel.includes(p)) s.add(p);
    }));
    return s;
  }, [groups, connById]);

  const valid =
    type === 'common_brand' ? !!brand :
    type === 'platform_selection' ? (connsOk && platforms.length > 0 && platforms.every((p) => (counts[p] || 0) > 0)) :
    type === 'create_groups' ? (connsOk ? groupLivePlats.size > 0 : groups.length > 0) :
    type === 'existing_groups' ? (!!activeGroup && activeSelected.length > 0) : false;

  const pick = (t) => { setType(t); save('driftpost-stage1-type', t); setSavedTick(false); };
  // Outputs belong to one brand's brief — switching brands drops the old
  // cards so yesterday's caption can never publish under a new brand.
  const clearOutputs = () => { try { localStorage.removeItem('driftpost-stage2-outputs'); } catch {} };
  const chooseBrand = (k) => { setBrandKey(k); save('driftpost-stage1-brand', k); setBrandOpen(false); clearOutputs(); };
  const clearBrand = () => { setBrandKey(''); save('driftpost-stage1-brand', ''); clearOutputs(); };
  const togglePlatform = (id) => setPlatforms((p) => {
    const n = p.includes(id) ? p.filter((x) => x !== id) : [...p, id];
    save('driftpost-stage1-platforms', n);
    return n;
  });
  const addGroup = (group) => {
    setGroups((gs) => { const n = [...gs.slice(-19), group]; save('driftpost-groups', n); return n; });
    setActiveGroupId(group.id); save('driftpost-stage1-group', group.id);
    setBuilderOpen(false);
  };
  const pickGroup = (id) => { setActiveGroupId(id); save('driftpost-stage1-group', id); };
  const removeGroup = (id) => {
    setGroups((gs) => { const n = gs.filter((g) => g.id !== id); save('driftpost-groups', n); return n; });
    if (activeGroupId === id) { setActiveGroupId(''); save('driftpost-stage1-group', ''); }
  };
  const accountName = (id) => connById[id]?.account_name || '';
  const brandPlats = (b) => ['instagram', 'facebook', 'youtube', 'x'].filter((pid) => b.map[pid]);

  const cont = () => {
    save('driftpost-stage1-type', type);
    save('driftpost-stage1-done', true);
    setSavedTick(true);
    setTimeout(() => setSavedTick(false), 1600);
    if (onNext) onNext();
  };

  return (
    <div className="stage1">
      <div className="stage1-in">
        <div className="stage1-top">
          {onBackAccounts && <button type="button" className="stage1-signout" onClick={onBackAccounts}>← Accounts</button>}
          <button type="button" className="stage1-signout" onClick={onHistory}>History</button>
          <button type="button" className="stage1-signout" onClick={onSignOut}>Sign out</button>
        </div>
        <header className="stage1-head">
          <span className="stage1-badge">Stage 1 of 3</span>
          <h1>How do you want to organize your accounts?</h1>
          <p>Choose the setup that works best for your workflow. You can change this later.</p>
        </header>
        <ProgressIndicator current={1} />
        <p className="s1-ways">Two ways to set up — post for <b>one brand</b>, or bundle accounts into a <b>group</b>. Pick one.</p>
        {connsError && (
          <p className="s1-loaderr">{connsError} <button type="button" className="s1-mini" onClick={() => setReloadTick((t) => t + 1)}>Retry</button></p>
        )}
        {loading ? (
          <div className="stage1-loading">Loading your accounts…</div>
        ) : (
          <div className="stage1-cards" role="radiogroup" aria-label="Account setup options">
            <SetupCard id="common_brand" selected={type === 'common_brand'} onSelect={pick} icon={ICONS.brand} title="Pick One Common Brand" summary="Choose one brand and manage all connected platforms together.">
              {brand ? (
                <div className="s1-pick">
                  <span className="s1-icons">{brandPlats(brand).map((pid) => <BrandIcon key={pid} id={pid} size={14} />)}</span>
                  <b title={brand.label}>{brand.label}</b>
                  <small>{brandPlats(brand).length} accounts</small>
                  <button type="button" className="s1-mini" onClick={() => setBrandOpen(true)}>Change</button>
                  <button type="button" className="s1-mini" onClick={clearBrand} title="Clear brand — platforms follow all connected accounts">Clear</button>
                </div>
              ) : (
                <button type="button" className="s1-btn" onClick={() => setBrandOpen(true)}>Choose a brand</button>
              )}
              {!brands.length && <p className="s1-note">No accounts connected yet — connect accounts first, then pick a brand here.</p>}
            </SetupCard>

            <SetupCard id="platform_selection" selected={type === 'platform_selection'} onSelect={pick} icon={ICONS.platforms} title="Select Platforms" summary="Just pick the platforms. Nothing more.">
              <PlatformSelector selected={platforms} counts={counts} brand={brand} onToggle={togglePlatform} />
              <p className="s1-note">Minimum 1 platform required{platforms.length ? ` · ${platforms.length} selected` : ''}.{brand ? ` Showing ${brand.label}’s linked platforms — unlinked ones stay grey.` : ''}</p>
            </SetupCard>

            <div className="s1-divider" role="separator" aria-label="Or bundle into groups"><span>or bundle into groups</span></div>
            <SetupCard id="create_groups" selected={type === 'create_groups'} onSelect={pick} icon={ICONS.trio} title="Create Groups" summary="Group 2 or more accounts that share the same content, caption and media.">
              <button type="button" className="s1-btn" onClick={() => setBuilderOpen(true)}>Create a group</button>
              {groups.map((g) => (
                <div key={g.id} className="trio-mini"><b title={g.name}>{g.name}</b><small>{(g.accountIds || []).length} accounts · {groupPlatsLabel(g)}</small><button type="button" className="s1-mini danger" title={`Delete ${g.name}`} onClick={() => { if (window.confirm(`Delete group “${g.name}”? Your accounts stay connected.`)) removeGroup(g.id); }}>✕</button></div>
              ))}
            </SetupCard>

            <SetupCard id="existing_groups" selected={type === 'existing_groups'} onSelect={pick} icon={ICONS.saved} title="Select Created Groups" summary="Reuse a group you already built.">
              <ExistingGroupSelector groups={groups} activeId={activeGroupId} accountName={accountName} onPick={pickGroup} onDelete={removeGroup} />
              {activeGroup && (
                <>
                  <p className="s1-note" style={{ marginTop: 8 }}>Platforms for <b>{activeGroup.name}</b> — untick to leave one out. Only ticked platforms reach Stage 2/3.</p>
                  <PlatformSelector selected={activeSelected} counts={groupCounts} brand={null} onToggle={toggleGroupPlatform} />
                </>
              )}
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
          <GroupBuilder connections={connections} token={session.access_token} onConnectionsChange={setConnections} onSave={addGroup} onClose={() => setBuilderOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}
