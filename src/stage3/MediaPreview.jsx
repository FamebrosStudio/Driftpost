import React, { useEffect, useMemo, useState } from 'react';
import BorderGlow from '../components/reactbits/BorderGlow.jsx';

// Media preview: main file + count, click to zoom (lightbox with prev/next).
export default function MediaPreview({ files, cover, children }) {
  const [light, setLight] = useState(-1);
  const urls = useMemo(
    () => (files || []).map((f) => {
      try { return f?.raw ? URL.createObjectURL(f.raw) : null; }
      catch { return null; }
    }),
    [files]
  );
  const coverUrl = useMemo(() => {
    try { return cover?.raw ? URL.createObjectURL(cover.raw) : null; }
    catch { return null; }
  }, [cover]);
  useEffect(() => () => { if (coverUrl) URL.revokeObjectURL(coverUrl); }, [coverUrl]);
  useEffect(() => () => {
    urls.forEach((u) => { try { if (u) URL.revokeObjectURL(u); } catch {} });
  }, [urls]);

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') setLight(-1); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  if (!files.length) {
    return <div className="s3-media-column"><p className="s3-media-cap">No media — add some in Stage 2 for a visual post, or publish text-only.</p>{children}</div>;
  }
  const first = files[0];
  const firstUrl = urls[0];
  const isVideo = first.type.startsWith('video/');

  return (
      <div className="s3-media-column">
      <div className="s3-media" onClick={() => setLight(0)} title="Click to zoom">
        {isVideo && coverUrl
          ? <img src={coverUrl} alt="Selected video thumbnail" />
          : isVideo
          ? (firstUrl ? <video src={firstUrl} preload="metadata" muted playsInline /> : null)
          : (firstUrl ? <img src={firstUrl} alt={first.name} /> : null)}
        <span className="zoom">Zoom +</span>
      </div>
      <p className="s3-media-cap">
        {files.length > 1 ? `${files.length} files — first shown, all publish together.` : `${first.name} · ${first.size}`}
      </p>
      {children}
      {light >= 0 && files[light] && (
        <div className="s3-light" onClick={() => setLight(-1)}>
          {files.length > 1 && (
            <>
              <BorderGlow asChild className="btn-glow" backgroundColor="#071019" borderRadius={0} glowColor="199 95 74" colors={['#7dd3fc', '#4dc3f7', '#a5ddfa']} fillOpacity={0.3} glowRadius={12}><button type="button" aria-label="Previous" style={{ position: 'fixed', left: 14, top: '50%', fontSize: 30, background: 'none', border: 0, color: '#fff' }} onClick={(e) => { e.stopPropagation(); setLight((light - 1 + files.length) % files.length); }}>‹</button></BorderGlow>
              <BorderGlow asChild className="btn-glow" backgroundColor="#071019" borderRadius={0} glowColor="199 95 74" colors={['#7dd3fc', '#4dc3f7', '#a5ddfa']} fillOpacity={0.3} glowRadius={12}><button type="button" aria-label="Next" style={{ position: 'fixed', right: 14, top: '50%', fontSize: 30, background: 'none', border: 0, color: '#fff' }} onClick={(e) => { e.stopPropagation(); setLight((light + 1) % files.length); }}>›</button></BorderGlow>
            </>
          )}
          <div onClick={(e) => e.stopPropagation()}>
            {files[light].type.startsWith('video/') && urls[light]
              ? <video src={urls[light]} controls muted playsInline preload="metadata" />
              : urls[light] && <img src={urls[light]} alt={files[light].name} />}
          </div>
        </div>
      )}
    </div>
  );
}
