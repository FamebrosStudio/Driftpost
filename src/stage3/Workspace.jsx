import React, { useMemo, useRef, useState } from 'react';
import BrandIcon from '../brand.jsx';
import { assistCommunityPost, postsTabUrl } from './communityAssist.js';

const NAMES = { instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube', x: 'X' };
const FB_CTAS = ['', 'LEARN_MORE', 'SHOP_NOW', 'SIGN_UP', 'MESSAGE_PAGE'];
const CTA_LABEL = { '': 'No button', LEARN_MORE: 'Learn more', SHOP_NOW: 'Shop now', SIGN_UP: 'Sign up', MESSAGE_PAGE: 'Send message' };

function Field({ label, children }) {
  return <label className="s3-field"><span>{label}</span>{children}</label>;
}

// One platform workspace: account, media is shown beside it,
// fields always editable inline, options, reviewed + post.
export default function Workspace({
  pid, accounts, accountId, onAccount,
  values, onValues, cfg, onCfg,
  files, thumb, onThumb,
  greyed, greyReason,
  reviewed, onReviewed,
  result, posting, regenning, regenBusy,
  onPost, onRegen, onSchedule,
  onPostPhotoAsVideo, encoding,
}) {
  const thumbRef = useRef(null);
  const thumbUrl = useMemo(() => {
    try { return thumb?.raw ? URL.createObjectURL(thumb.raw) : null; }
    catch { return null; }
  }, [thumb]);
  // (Revoked on replace/unmount by the page vault write; short-lived preview.)

  const set = (k, v) => onValues(pid, { ...values, [k]: v });
  const setCfg = (patch) => onCfg(pid, { ...cfg, ...patch });
  const xLen = pid === 'x' ? Array.from(values.text || '').length : 0;
  const hasVideo = files.some((f) => f.type.startsWith('video/'));
  // YouTube's API only accepts video. A community post has no API at all, so
  // that path stages the photo + caption and hands off to Studio.
  const photoOnly = pid === 'youtube' && files.length > 0 && !hasVideo;
  const [assistMsg, setAssistMsg] = useState('');
  const channelId = accounts.find((a) => a.id === accountId)?.platform_account_id;

  const runAssist = async () => {
    setAssistMsg('Preparing…');
    const photo = files.find((f) => f?.raw && f.type.startsWith('image/'))?.raw || null;
    try {
      const r = await assistCommunityPost({ file: photo, values, channelId });
      const bits = [];
      if (r.copied) bits.push('Caption copied to clipboard');
      if (r.saved) bits.push('Photo saved to your downloads');
      if (r.opened) bits.push('Create-post box opened');
      setAssistMsg(bits.length
        ? `${bits.join(' · ')}.`
        : 'Your browser blocked the clipboard and popup. Allow them for this site, then try again.');
    } catch (e) {
      setAssistMsg(e.message || 'Could not prepare the post.');
    }
  };

  let error = '';
  if (!accountId) error = 'Pick an account for this platform first.';
  else if (pid === 'x' && xLen > 280) error = `Too long — ${xLen - 280} characters over.`;
  else if (pid === 'x' && cfg.pollOn && files.length > 0) error = 'Polls can’t carry photos — remove media in Stage 2 for a poll.';
  else if (pid === 'x' && cfg.pollOn && !(cfg.opts?.[0]?.trim() && cfg.opts?.[1]?.trim())) error = 'A poll needs at least 2 answers.';
  else if (pid === 'facebook' && cfg.cta && !cfg.link?.trim()) error = 'A button needs a website link above.';
  const blocked = !!error || photoOnly;

  const pill = result?.state === 'completed'
    ? <span className="s3-pill ok">Posted ✓</span>
    : result?.state === 'scheduled'
      ? <span className="s3-pill ok">Scheduled ✓</span>
      : result?.state === 'failed'
        ? <span className="s3-pill fail">Failed</span>
        : posting ? <span className="s3-pill work">Posting…</span>
          : reviewed ? <span className="s3-pill ok">Reviewed ✓</span>
            : <span className="s3-pill">Needs review</span>;

  return (
    <div className={greyed ? 's3-work greyed' : 's3-work'}>
      <div className="s3-work-head">
        <BrandIcon id={pid} size={18} />
        <b>{NAMES[pid]}</b>
        {pill}
        {greyed && <span className="s3-grey-note">{greyReason}</span>}
      </div>

      <Field label="Account">
        <select value={accountId} onChange={(e) => onAccount(pid, e.target.value)} disabled={!accounts.length}>
          {!accountId && <option value="">— pick —</option>}
          {accounts.map((c) => <option key={c.id} value={c.id}>{c.account_name}</option>)}
        </select>
      </Field>
      {!accounts.length && <p className="s3-err">No {NAMES[pid]} account connected — connect one, then come back.</p>}

      {regenning ? (
        <div aria-live="polite"><div className="s3-sk" /><div className="s3-sk" /></div>
      ) : (
        <>
          {pid === 'instagram' && <>
            <Field label="Caption"><textarea value={values.caption || ''} onChange={(e) => set('caption', e.target.value)} placeholder="Write the caption…" /></Field>
            <Field label="Hashtags"><input value={values.hashtags || ''} onChange={(e) => set('hashtags', e.target.value)} placeholder="#brand #fashion" /></Field>
            <div className="s3-row2">
              <Field label="Feed size">
                <select value={cfg.size || 'portrait'} onChange={(e) => setCfg({ size: e.target.value })}>
                  <option value="portrait">Portrait 4:5</option>
                  <option value="square">Square 1:1</option>
                  <option value="landscape">Landscape 1.91:1</option>
                </select>
              </Field>
              <div />
            </div>
            <label className="s3-check"><input type="checkbox" checked={!!cfg.shareFb} onChange={(e) => setCfg({ shareFb: e.target.checked })} /><span>Also post on Facebook<small>Single posts only — Post All always posts directly.</small></span></label>
            <label className="s3-check"><input type="checkbox" checked={!!cfg.story} onChange={(e) => setCfg({ story: e.target.checked })} /><span>Also post as Story (24h)<small>Same media as a story, in one tap.</small></span></label>
            <details className="s3-adv">
              <summary>More options (tags, partners…)</summary>
              <div className="s3-adv-in">
                <Field label="Topics · up to 3"><input value={cfg.topics || ''} onChange={(e) => setCfg({ topics: e.target.value })} placeholder="bridal, mumbai" /></Field>
                <Field label="Business partner"><input value={cfg.partner || ''} onChange={(e) => setCfg({ partner: e.target.value })} placeholder="brand handle, no @ needed" /></Field>
                <Field label="Co-authors · up to 3"><input value={cfg.collabs || ''} onChange={(e) => setCfg({ collabs: e.target.value })} placeholder="makeup_artist, photographer" /></Field>
                <Field label="Alt text (accessibility)"><input value={cfg.alt || ''} maxLength={500} onChange={(e) => setCfg({ alt: e.target.value })} placeholder="Describe the photo in one line" /></Field>
              </div>
            </details>
          </>}

          {pid === 'facebook' && <>
            <Field label="Post text"><textarea value={values.message || ''} onChange={(e) => set('message', e.target.value)} placeholder="What should this post say?" /></Field>
            <Field label="Website link · optional"><input value={cfg.link || ''} onChange={(e) => setCfg({ link: e.target.value })} placeholder="https://your-website.com/offer" /></Field>
            <label className="s3-check"><input type="checkbox" checked={!!cfg.syndIg} onChange={(e) => setCfg({ syndIg: e.target.checked })} /><span>Also post on Instagram<small>Single posts only — Post All always posts directly.</small></span></label>
            <details className="s3-adv">
              <summary>More options (button, audience…)</summary>
              <div className="s3-adv-in">
                <Field label="Button · needs a link above">
                  <select value={cfg.cta || ''} onChange={(e) => setCfg({ cta: e.target.value })}>
                    {FB_CTAS.map((c) => <option key={c} value={c}>{CTA_LABEL[c]}</option>)}
                  </select>
                </Field>
                <Field label="Audience">
                  <select value={cfg.age || ''} onChange={(e) => setCfg({ age: e.target.value })}>
                    <option value="">Everyone</option>
                    <option value="13">13 and older</option>
                    <option value="18">18 and older</option>
                    <option value="21">21 and older</option>
                  </select>
                </Field>
              </div>
            </details>
          </>}

          {pid === 'youtube' && <>
            <Field label={`Video title · ${(values.title || '').length}/100`}><input value={values.title || ''} maxLength={100} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Bridal glow-up at Velvet Salon" /></Field>
            <Field label="Description"><textarea value={values.description || ''} onChange={(e) => set('description', e.target.value)} placeholder="Tell viewers about this video…" /></Field>
            <Field label="Tags · comma separated"><input value={values.tags || ''} onChange={(e) => set('tags', e.target.value)} placeholder="salon, bridal, mumbai" /></Field>
            <div className="s3-row2">
              <Field label="Visibility">
                <select value={cfg.privacy || 'private'} onChange={(e) => setCfg({ privacy: e.target.value })}>
                  <option value="private">Private (only me)</option>
                  <option value="unlisted">Unlisted (link only)</option>
                  <option value="public">Public (everyone)</option>
                </select>
              </Field>
              <Field label="Cover image">
                <button type="button" className="s3-mini-btn" onClick={() => thumbRef.current?.click()}>
                  {thumb ? `✓ ${thumb.name.slice(0, 22)}` : 'Add cover'}
                </button>
                <input ref={thumbRef} type="file" accept="image/jpeg,image/png" hidden onChange={(e) => { const f = e.target.files[0]; if (f) onThumb({ raw: f, name: f.name }); e.target.value = ''; }} />
              </Field>
            </div>
            <details className="s3-adv">
              <summary>More options (category, kids…)</summary>
              <div className="s3-adv-in">
                <div className="s3-row2">
                  <Field label="Category">
                    <select value={cfg.category || ''} onChange={(e) => setCfg({ category: e.target.value })}>
                      <option value="">Auto (recommended)</option>
                      <option value="26">How-to &amp; Style</option>
                      <option value="22">People &amp; Blogs</option>
                      <option value="24">Entertainment</option>
                      <option value="10">Music</option>
                      <option value="27">Education</option>
                    </select>
                  </Field>
                  <Field label="Made for kids?">
                    <select value={cfg.kids || ''} onChange={(e) => setCfg({ kids: e.target.value })}>
                      <option value="">Not sure</option>
                      <option value="yes">Yes, for kids</option>
                      <option value="no">No, not for kids</option>
                    </select>
                  </Field>
                </div>
              </div>
            </details>
          </>}

          {pid === 'x' && <>
            <Field label={`Post · ${xLen}/280`}><textarea value={values.text || ''} maxLength={400} onChange={(e) => set('text', e.target.value)} placeholder="Short and sharp…" /></Field>
            {xLen > 280 && <p className="s3-err">Too long — shorten by {xLen - 280} characters.</p>}
            <label className="s3-check"><input type="checkbox" checked={!!cfg.pollOn} onChange={(e) => setCfg({ pollOn: e.target.checked })} /><span>Ask a question (poll)<small>No photo with polls — remove media in Stage 2 first.</small></span></label>
            {cfg.pollOn && <>
              {[0, 1, 2, 3].map((i) => (
                <Field key={i} label={i < 2 ? `Answer ${i + 1} · required` : `Answer ${i + 1} · optional`}>
                  <input value={cfg.opts?.[i] || ''} maxLength={25} onChange={(e) => {
                    const o = [...(cfg.opts || ['', '', '', ''])];
                    o[i] = e.target.value;
                    setCfg({ opts: o });
                  }} placeholder={i < 2 ? 'e.g. Yes' : 'Optional'} />
                </Field>
              ))}
              <Field label="Voting open for">
                <select value={cfg.mins || '1440'} onChange={(e) => setCfg({ mins: e.target.value })}>
                  <option value="60">1 hour</option>
                  <option value="1440">1 day</option>
                  <option value="10080">7 days</option>
                </select>
              </Field>
            </>}
            <Field label="Who can reply?">
              <select value={cfg.reply || 'everyone'} onChange={(e) => setCfg({ reply: e.target.value })}>
                <option value="everyone">Everyone</option>
                <option value="following">Only accounts I follow</option>
                <option value="mentionedUsers">Only people I mention</option>
              </select>
            </Field>
          </>}
        </>
      )}

      {error && <p className="s3-err">{error}</p>}
      {photoOnly && (
        <div className="s3-ytphoto">
          <p>
            <b>Post this photo to your YouTube Posts tab.</b>
            {' '}YouTube has no API for posts, so we stage it for you: the photo is
            saved to your downloads, the caption is copied, and the create-post box
            opens on your channel. Paste and hit Post.
          </p>
          <button type="button" className="go" onClick={runAssist} disabled={greyed || !accountId}>
            Copy caption + open create-post box →
          </button>
          {assistMsg && <p className="s3-ytphoto-msg" aria-live="polite">{assistMsg}</p>}
          <p className="s3-ytphoto-alt">
            The box didn&apos;t open?{' '}
            <a href={postsTabUrl(channelId)} target="_blank" rel="noreferrer" className="s3-link">
              open your Posts tab
            </a>
            {' · '}or{' '}
            <button
              type="button"
              className="s3-link"
              onClick={() => onPostPhotoAsVideo(pid)}
              disabled={posting || encoding || greyed || !accountId}
            >
              {encoding ? 'Making video…' : 'post it as a 6s Short instead'}
            </button>
          </p>
        </div>
      )}
      {result?.state === 'failed' && <p className="s3-err">{result.message}</p>}
      {result?.state === 'scheduled' && <p className="s3-note">{result.message}</p>}
      {result?.url && <a className="s3-view" href={result.url} target="_blank" rel="noreferrer">View your post →</a>}

      <div className="s3-acts">
        {!reviewed && result?.state !== 'completed' && result?.state !== 'scheduled' && (
          <button type="button" onClick={() => onReviewed(pid)} disabled={greyed}>Reviewed ✓</button>
        )}
        {reviewed && result?.state !== 'completed' && result?.state !== 'scheduled' && (
          <button type="button" className="ok" disabled>✓ Reviewed</button>
        )}
        <button type="button" onClick={() => onRegen(pid)} disabled={regenBusy || greyed} title="Fresh AI answer for this card">
          {regenning ? '…' : 'Regen'}
        </button>
        <button
          type="button"
          onClick={() => onSchedule(pid)}
          disabled={posting || greyed || blocked || result?.state === 'scheduled'}
          title="Publish automatically later"
        >
          {result?.state === 'scheduled' ? '✓ Scheduled' : 'Schedule'}
        </button>
        <button type="button" className="go" onClick={() => onPost(pid)} disabled={posting || greyed || blocked}>
          {posting ? 'Posting…' : `Post to ${NAMES[pid]}`}
        </button>
      </div>
    </div>
  );
}
