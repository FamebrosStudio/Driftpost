import React, { useEffect, useState } from 'react';
import BrandIcon from '../brand.jsx';
import { apiUrl } from '../lib.js';
import './workspace.css';

const platformName = (id) => ({ instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube', x: 'X' })[id] || id;

export default function ApprovalPage({ id }) {
  const [review, setReview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [comment, setComment] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setDone('');
    fetch(`${apiUrl}/api/approvals/${encodeURIComponent(id)}`)
      .then(async (res) => { const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || 'This review link is unavailable.'); return data.review; })
      .then((data) => { if (active) setReview(data); })
      .catch((e) => { if (active) setError(e.message || 'Could not load this review.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id]);

  const decide = async (decision) => {
    setBusy(true); setError('');
    try {
      const res = await fetch(`${apiUrl}/api/approvals/${encodeURIComponent(id)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, comment }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not save your decision.');
      setDone(decision === 'approved' ? 'This post is approved and will publish at its scheduled time.' : 'Changes have been requested. The post was removed from the publishing queue.');
      setReview(null);
    } catch (e) { setError(e.message || 'Could not save your decision.'); }
    finally { setBusy(false); }
  };

  return <main className="approval-page">
    <a className="approval-brand" href="/"><img src="/logo-dark-620.png" alt="Driftpost" /></a>
    <section className="approval-card">
      <span className="ws-eyebrow">Post review</span>
      <h1>Review scheduled post</h1>
      {loading ? <p className="approval-state">Loading post…</p> : error && !review ? <p className="approval-error" role="alert">{error}</p> : done ? <p className="approval-done" role="status">{done}</p> : review && <>
        <div className="approval-platform"><span className="ws-icon"><BrandIcon id={review.platform} size={18} /></span><div><b>{platformName(review.platform)}</b><small>Scheduled for {new Date(review.scheduled_at).toLocaleString()}</small></div></div>
        <div className="approval-content">{review.text || 'No caption or message.'}</div>
        {!!review.media?.length && <div className="approval-media">{review.media.map((item, index) => item.mimetype.startsWith('video/') ? <video key={`${item.url}-${index}`} controls preload="metadata" src={item.url} /> : <img key={`${item.url}-${index}`} src={item.url} alt={item.name} />)}</div>}
        <label className="approval-comment"><span>Comment for the post owner (optional)</span><textarea rows="3" maxLength="500" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Share feedback or requested changes" /></label>
        {error && <p className="approval-error" role="alert">{error}</p>}
        <div className="approval-actions"><button type="button" disabled={busy} onClick={() => decide('rejected')}>{busy ? 'Saving…' : 'Request changes'}</button><button type="button" className="approval-approve" disabled={busy} onClick={() => decide('approved')}>{busy ? 'Saving…' : 'Approve post'}</button></div>
        <p className="approval-footnote">Anyone with this private link can review this scheduled post.</p>
      </>}
    </section>
  </main>;
}
