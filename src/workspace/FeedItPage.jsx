import React, { useEffect, useMemo, useState } from 'react';
import { WorkspaceNav } from './Workspace.jsx';
import { api } from '../lib.js';
import { isAiAccount } from '../ai-access.js';

function buildResearchPrompt(brandQuery) {
  const target = String(brandQuery || '').trim() || '[WRITE BRAND NAME & CITY HERE]';
  return `Research the brand "${target}" thoroughly using web search, Google Maps/Business listings, Instagram, Facebook, and official pages. Give me ONLY verified, accurate details (never guess phone numbers, addresses, offers, or handles — mark anything unconfirmed as "Not confirmed").

Return the complete brand profile in this exact simple format so I can paste it directly into Driftpost:

Brand Name: ${target}
Aliases: 
Category: 
Location: 
Address: 
Phone: 
Instagram: @
Language: 
Tone: 
Products / Services & USP: 
Target Audience: 
Approved Footer:
📍 [Confirmed Address]
📞 [Confirmed Phone]
💫 Managed by: @famebrosstudio
Hashtags: #BrandTag #NicheTag #CityTag
SEO Keywords: [keyword 1, keyword 2, keyword 3, keyword 4, keyword 5]
Strict Rules / Do's & Don'ts: `;
}

export default function FeedItPage({ session, onNavigate, onSignOut }) {
  const allowed = isAiAccount(session?.user?.email);
  const [researchTarget, setResearchTarget] = useState('');
  const [copied, setCopied] = useState(false);

  const [brandName, setBrandName] = useState('');
  const [rawText, setRawText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedBrand, setSavedBrand] = useState(null);

  const [brands, setBrands] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [search, setSearch] = useState('');

  // Direct Saved Caption Data Editor state
  const [captionBrands, setCaptionBrands] = useState([]);
  const [captionSearch, setCaptionSearch] = useState('');
  const [selectedCaptionId, setSelectedCaptionId] = useState('');
  const [capDraft, setCapDraft] = useState(null);
  const [capSaving, setCapSaving] = useState(false);
  const [capMsg, setCapMsg] = useState('');
  const [capErr, setCapErr] = useState('');

  const promptText = useMemo(() => buildResearchPrompt(researchTarget), [researchTarget]);

  const loadBrands = () => {
    if (!allowed) {
      setLoadingList(false);
      return;
    }
    setLoadingList(true);
    Promise.all([
      api('/api/ai/feed-it', session.access_token),
      api('/api/ai/feed-it/captions', session.access_token).catch(() => ({ brands: [] })),
    ])
      .then(([fedData, capData]) => {
        setBrands(Array.isArray(fedData?.brands) ? fedData.brands : []);
        const caps = Array.isArray(capData?.brands) ? capData.brands : [];
        setCaptionBrands(caps);
      })
      .catch((e) => setError(e?.message || 'Could not load saved brands.'))
      .finally(() => setLoadingList(false));
  };

  useEffect(() => {
    loadBrands();
  }, [session?.access_token, allowed]);

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(promptText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy automatically. Select and copy the prompt text manually.');
    }
  };

  const handleSave = async (event) => {
    event.preventDefault();
    setError('');
    setSavedBrand(null);
    if (!brandName.trim() && !rawText.trim()) {
      setError('Enter the brand name or paste the brand details first.');
      return;
    }
    setSaving(true);
    try {
      const data = await api('/api/ai/feed-it', session.access_token, {
        method: 'POST',
        body: JSON.stringify({ brandName: brandName.trim(), rawText: rawText.trim() }),
      });
      setSavedBrand(data?.brand || null);
      setBrandName('');
      setRawText('');
      loadBrands();
    } catch (e) {
      setError(e?.message || 'Could not save brand data.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id, name) => {
    if (!window.confirm(`Remove "${name}" from Feed It?`)) return;
    setError('');
    try {
      await api(`/api/ai/feed-it/${encodeURIComponent(id)}`, session.access_token, { method: 'DELETE' });
      setBrands((prev) => prev.filter((b) => b.id !== id));
    } catch (e) {
      setError(e?.message || 'Could not delete brand.');
    }
  };

  const loadIntoEditor = (item) => {
    setBrandName(item.name || '');
    setRawText(item.rawText || '');
    setSavedBrand(null);
    setError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const filteredBrands = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return brands;
    return brands.filter((b) =>
      [b.name, b.category, b.location, b.ig, ...(b.phones || [])].some((v) => String(v || '').toLowerCase().includes(q)),
    );
  }, [brands, search]);

  const filteredCaptionBrands = useMemo(() => {
    const q = captionSearch.trim().toLowerCase();
    if (!q) return captionBrands;
    return captionBrands.filter((b) =>
      [b.name, b.id, b.category, b.location, b.ig].some((v) => String(v || '').toLowerCase().includes(q)),
    );
  }, [captionBrands, captionSearch]);

  const selectCaptionBrand = (item) => {
    if (!item) return;
    setSelectedCaptionId(item.id);
    setCapMsg('');
    setCapErr('');
    setCapDraft({
      name: item.name || '',
      ig: item.ig || '',
      tone: item.tone || '',
      phones: (item.phones || []).join(', '),
      address: item.address || '',
      footer: (item.footer || []).join('\n'),
      hashtags: (item.hashtags || []).join(' '),
      kw: (item.kw || []).join(', '),
      sampleCaption: item.sampleCaption || '',
    });
  };

  const handleSaveCaptionData = async (e) => {
    e.preventDefault();
    if (!selectedCaptionId || !capDraft || capSaving) return;
    setCapSaving(true);
    setCapErr('');
    setCapMsg('');
    try {
      const res = await api(`/api/ai/feed-it/captions/${encodeURIComponent(selectedCaptionId)}`, session.access_token, {
        method: 'PATCH',
        body: JSON.stringify(capDraft),
      });
      if (res?.brand) {
        setCaptionBrands((prev) => prev.map((b) => (b.id === res.brand.id ? res.brand : b)));
        selectCaptionBrand(res.brand);
        setCapMsg(`Saved caption changes for "${res.brand.name}"${res.brand.persisted === 'cloud' ? ' (cloud-synced)' : ''}.`);
      }
    } catch (err) {
      setCapErr(err?.message || 'Could not update saved caption data.');
    } finally {
      setCapSaving(false);
    }
  };

  return (
    <div className="ws feed-it-page">
      <WorkspaceNav page="feed-it" onNavigate={onNavigate} email={session?.user?.email} onSignOut={onSignOut} />
      <main className="ws-main feed-it-main">
        <div className="ws-heading">
          <div>
            <span className="ws-eyebrow">PRIVATE TEAM BRAND ONBOARDING</span>
            <h1>Feed It</h1>
            <p>Add any new client brand in two simple steps: copy the AI research prompt, run it in another AI, and paste all brand details below.</p>
          </div>
        </div>

        {!allowed ? (
          <div className="team-video-alert" role="alert">
            Feed It is only available to authorized team accounts (famebros.studio@gmail.com and kabirsayed.k@gmail.com).
          </div>
        ) : (
          <div className="feed-it-grid">
            <section className="ws-panel feed-it-card">
              <div className="feed-it-step-head">
                <span className="feed-it-step-badge">STEP 1</span>
                <div>
                  <h2>Copy AI Research Prompt</h2>
                  <p>Type the brand name below, copy the prompt, and paste it into ChatGPT, Gemini, or Perplexity.</p>
                </div>
              </div>
              <div className="feed-it-form">
                <label className="feed-it-field">
                  <span>Brand Name &amp; City (optional)</span>
                  <input
                    type="text"
                    value={researchTarget}
                    onChange={(e) => setResearchTarget(e.target.value)}
                    placeholder="e.g. Zam Zam Motors, Mulund West Mumbai"
                  />
                </label>
                <div className="feed-it-prompt-box">
                  <pre>{promptText}</pre>
                </div>
                <div className="feed-it-actions">
                  <button type="button" className="ws-secondary" onClick={copyPrompt}>
                    {copied ? 'Copied Prompt ✓' : 'Copy AI Research Prompt'}
                  </button>
                </div>
              </div>
            </section>

            <section className="ws-panel feed-it-card">
              <div className="feed-it-step-head">
                <span className="feed-it-step-badge">STEP 2</span>
                <div>
                  <h2>Paste &amp; Save Brand Data</h2>
                  <p>Paste everything you have for this brand. Driftpost automatically extracts phones, address, Instagram handle, and keywords.</p>
                </div>
              </div>

              <form onSubmit={handleSave} className="feed-it-form">
                <label className="feed-it-field">
                  <span>Brand Name</span>
                  <input
                    type="text"
                    value={brandName}
                    onChange={(e) => setBrandName(e.target.value)}
                    placeholder="e.g. Zam Zam Motors (or leave blank if included in text below)"
                  />
                </label>

                <label className="feed-it-field">
                  <span>Brand Details (Paste Everything Here)</span>
                  <textarea
                    rows={12}
                    value={rawText}
                    onChange={(e) => setRawText(e.target.value)}
                    placeholder={"Paste the AI research result or all client details here...\n\nBrand Name: ...\nAddress: ...\nPhone: ...\nInstagram: @...\nLanguage & Tone: ...\nServices / Offers / Rules: ..."}
                  />
                </label>

                {error && <div className="feed-it-alert" role="alert">{error}</div>}
                {savedBrand && (
                  <div className="feed-it-success" role="status">
                    <strong>
                      Saved "{savedBrand.name}" to Driftpost
                      {savedBrand.persisted === 'cloud' ? ' (cloud-synced)' : ' (local only)'}!
                    </strong>
                    <small>
                      {[
                        savedBrand.ig ? `IG: ${savedBrand.ig}` : '',
                        savedBrand.phones?.length ? `Phone: ${savedBrand.phones.join(' / ')}` : '',
                        savedBrand.address ? `Address: ${savedBrand.address}` : '',
                      ].filter(Boolean).join(' · ') || 'Ready for captions and automated workflows.'}
                    </small>
                  </div>
                )}

                <div className="feed-it-actions">
                  <button type="submit" className="ws-primary" disabled={saving}>
                    {saving ? 'Saving…' : 'Save Brand to Driftpost'}
                  </button>
                  {(brandName || rawText) && (
                    <button
                      type="button"
                      className="ws-secondary"
                      onClick={() => { setBrandName(''); setRawText(''); setError(''); setSavedBrand(null); }}
                    >
                      Clear
                    </button>
                  )}
                </div>
              </form>
            </section>

            <section className="ws-panel feed-it-card feed-it-list-card">
              <div className="feed-it-step-head">
                <span className="feed-it-step-badge">EDIT CAPTIONS</span>
                <div>
                  <h2>Edit Saved Caption Data ({captionBrands.length})</h2>
                  <p>Pick any saved brand to directly update its sample caption, branch footer, phone numbers, hashtags, or SEO keywords.</p>
                </div>
              </div>

              <div className="feed-it-form">
                <input
                  type="search"
                  className="feed-it-search"
                  value={captionSearch}
                  onChange={(e) => setCaptionSearch(e.target.value)}
                  placeholder="Search any saved brand (e.g. Zivara Salon, Velvet Salon, SK Furniture)..."
                />
                <div className="feed-it-list" style={{ maxHeight: '460px', overflowY: 'auto' }}>
                  {filteredCaptionBrands.map((item) => (
                    <div key={item.id} className={selectedCaptionId === item.id ? 'feed-it-item active' : 'feed-it-item'}>
                      <div className="feed-it-item-info">
                        <strong>{item.name}</strong>
                        <small>{[item.category, item.location, item.ig].filter(Boolean).join(' · ') || item.id}</small>
                      </div>
                      <div className="feed-it-item-actions">
                        <button type="button" className="ws-secondary" onClick={() => selectCaptionBrand(item)}>
                          {selectedCaptionId === item.id ? 'Editing' : 'Edit Caption'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {capDraft && (
                  <form onSubmit={handleSaveCaptionData} className="feed-it-form" style={{ marginTop: '14px', paddingTop: '14px', borderTop: '1px solid var(--line)' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '10px' }}>
                      <label className="feed-it-field">
                        <span>Brand Name</span>
                        <input type="text" value={capDraft.name} onChange={(e) => setCapDraft({ ...capDraft, name: e.target.value })} />
                      </label>
                      <label className="feed-it-field">
                        <span>Instagram Handle</span>
                        <input type="text" value={capDraft.ig} onChange={(e) => setCapDraft({ ...capDraft, ig: e.target.value })} placeholder="@handle" />
                      </label>
                      <label className="feed-it-field">
                        <span>Phones (comma-separated)</span>
                        <input type="text" value={capDraft.phones} onChange={(e) => setCapDraft({ ...capDraft, phones: e.target.value })} placeholder="8655715221, 9920581281" />
                      </label>
                      <label className="feed-it-field">
                        <span>Tone</span>
                        <input type="text" value={capDraft.tone} onChange={(e) => setCapDraft({ ...capDraft, tone: e.target.value })} />
                      </label>
                      <label className="feed-it-field" style={{ gridColumn: '1 / -1' }}>
                        <span>Address / Showroom Location</span>
                        <input type="text" value={capDraft.address || ''} onChange={(e) => setCapDraft({ ...capDraft, address: e.target.value })} placeholder="Full showroom or branch address" />
                      </label>
                    </div>

                    <label className="feed-it-field">
                      <span>Sample / Template Caption</span>
                      <textarea rows={7} value={capDraft.sampleCaption} onChange={(e) => setCapDraft({ ...capDraft, sampleCaption: e.target.value })} />
                    </label>

                    <label className="feed-it-field">
                      <span>Approved Footer (one line per line)</span>
                      <textarea rows={5} value={capDraft.footer} onChange={(e) => setCapDraft({ ...capDraft, footer: e.target.value })} />
                    </label>

                    <label className="feed-it-field">
                      <span>Hashtags</span>
                      <input type="text" value={capDraft.hashtags} onChange={(e) => setCapDraft({ ...capDraft, hashtags: e.target.value })} placeholder="#ZivaraSalon #SalonMembership #BeautyOffers" />
                    </label>

                    <label className="feed-it-field">
                      <span>SEO Keywords (comma-separated)</span>
                      <input type="text" value={capDraft.kw} onChange={(e) => setCapDraft({ ...capDraft, kw: e.target.value })} />
                    </label>

                    {capErr && <div className="feed-it-alert" role="alert">{capErr}</div>}
                    {capMsg && <div className="feed-it-success" role="status"><strong>{capMsg}</strong></div>}

                    <div className="feed-it-actions">
                      <button type="submit" className="ws-primary" disabled={capSaving}>
                        {capSaving ? 'Saving Caption Data…' : 'Save Caption Changes'}
                      </button>
                      <button
                        type="button"
                        className="ws-secondary"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(capDraft.sampleCaption || '');
                            setCapMsg('Copied sample caption to clipboard.');
                          } catch {
                            setCapErr('Could not copy automatically.');
                          }
                        }}
                      >
                        Copy Sample Caption
                      </button>
                      <button type="button" className="ws-secondary" onClick={() => { setSelectedCaptionId(''); setCapDraft(null); setCapMsg(''); setCapErr(''); }}>
                        Close Editor
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </section>

            <section className="ws-panel feed-it-card feed-it-list-card">
              <details className="dp-collapse">
                <summary><span>Team-Fed Brands ({brands.length})</span></summary>
                <div className="dp-collapse-body feed-it-collapse-body">
                  <input
                    type="search"
                    className="feed-it-search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search fed brands..."
                  />
                  {loadingList ? (
                    <p className="feed-it-empty">Loading saved brands…</p>
                  ) : !filteredBrands.length ? (
                    <p className="feed-it-empty">
                      {brands.length ? 'No matching fed brands found.' : 'No brands fed yet. Use Step 1 and Step 2 above to add your first new client brand.'}
                    </p>
                  ) : (
                    <div className="feed-it-list">
                      {filteredBrands.map((item) => (
                        <div key={item.id} className="feed-it-item">
                          <div className="feed-it-item-info">
                            <strong>{item.name}</strong>
                            <small>
                              {[
                                item.category,
                                item.location,
                                item.ig,
                                item.phones?.length ? item.phones.join(' / ') : '',
                              ].filter(Boolean).join(' · ') || 'Custom brand profile'}
                            </small>
                          </div>
                          <div className="feed-it-item-actions">
                            <button type="button" className="ws-secondary" onClick={() => loadIntoEditor(item)}>
                              Edit
                            </button>
                            <button type="button" className="ws-secondary feed-it-del" onClick={() => handleDelete(item.id, item.name)}>
                              Delete
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </details>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
