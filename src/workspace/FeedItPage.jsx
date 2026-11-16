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

  const promptText = useMemo(() => buildResearchPrompt(researchTarget), [researchTarget]);

  const loadBrands = () => {
    if (!allowed) {
      setLoadingList(false);
      return;
    }
    setLoadingList(true);
    api('/api/ai/feed-it', session.access_token)
      .then((data) => setBrands(Array.isArray(data?.brands) ? data.brands : []))
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
        body: { brandName: brandName.trim(), rawText: rawText.trim() },
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
                  <h2>Get Brand Details From Any AI</h2>
                  <p>Type the brand name below, copy the prompt, and paste it into ChatGPT, Gemini, or Perplexity.</p>
                </div>
              </div>

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
                    <strong>Saved "{savedBrand.name}" to Driftpost!</strong>
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
              <div className="ws-panel-head">
                <div>
                  <span className="ws-eyebrow">SAVED VIA FEED IT</span>
                  <h2>Team-Fed Brands ({brands.length})</h2>
                </div>
                <input
                  type="search"
                  className="feed-it-search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search fed brands..."
                />
              </div>

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
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
