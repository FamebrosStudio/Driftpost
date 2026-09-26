import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// Crop + resize only (per wireframe): aspect pills, rotate, flip,
// fit-or-crop, done. Images export exact-size JPEG; videos re-encode
// (full duration, capped 1280px, original audio kept) as WebM.
const RATIOS = { Original: null, '4:5': 4 / 5, '1:1': 1, '16:9': 16 / 9, '9:16': 9 / 16 };

function fitBox(nw, nh, ratio) {
  if (!ratio) return { fx: 0.04, fy: 0.04, fw: 0.92, fh: 0.92 };
  let fh = 0.92;
  let fw = fh * (nh / nw) * ratio;
  if (fw > 0.92) { fw = 0.92; fh = fw * (nw / nh) / ratio; }
  return { fx: (1 - fw) / 2, fy: (1 - fh) / 2, fw, fh };
}

// True when the media already matches the target ratio (within 1.5%):
// cropping would change nothing, so we keep the full frame instead.
function fitsRatio(nw, nh, ratio) {
  if (!ratio || !nw || !nh) return true;
  return Math.abs(nw / nh - ratio) / ratio < 0.015;
}
const FULL = { fx: 0, fy: 0, fw: 1, fh: 1 };

// Paint a source into an exact-ratio canvas without losing content:
// a blurred cover-fill behind, the untouched frame centred on top.
function drawFit(ctx, src, sw, sh, W, H) {
  ctx.clearRect(0, 0, W, H);
  if (!sw || !sh) return;
  const cover = Math.max(W / sw, H / sh);
  ctx.save();
  ctx.filter = 'blur(26px) saturate(1.25) brightness(0.75)';
  ctx.drawImage(src, (W - sw * cover) / 2, (H - sh * cover) / 2, sw * cover, sh * cover);
  ctx.restore();
  const fit = Math.min(W / sw, H / sh);
  const dw = sw * fit;
  const dh = sh * fit;
  ctx.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

// Paint the user's crop window, snapped so the output is exactly the
// target ratio (a hair of rounding drift can otherwise creep in).
function cropWindow(box, sw, sh, ratio) {
  const b = box || FULL;
  let x = Math.round(b.fx * sw);
  let y = Math.round(b.fy * sh);
  let w = Math.round(b.fw * sw);
  let h = Math.round(b.fh * sh);
  if (ratio) {
    h = Math.round(w / ratio);
    if (h > sh) { h = sh; w = Math.round(h * ratio); }
    if (w > sw) { w = sw; h = Math.round(w / ratio); }
    x = Math.min(Math.max(0, x), sw - w);
    y = Math.min(Math.max(0, y), sh - h);
  }
  return { x, y, w: Math.max(1, w), h: Math.max(1, h) };
}

export default function MediaEditor({ entry, onClose, onApply }) {
  const isVideo = entry.type.startsWith('video/');
  const [bmp, setBmp] = useState(null);
  const [vidEl, setVidEl] = useState(null);
  const [rot, setRot] = useState(0); // quarter turns clockwise
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [aspect, setAspect] = useState('Original');
  // pad = Fit (default): keep 100% of the frame, blurred-fill the rest.
  // pad = false + free = Crop: fill the frame by cutting edges.
  const [pad, setPad] = useState(true);
  const [free, setFree] = useState(false);
  const [box, setBox] = useState(null);
  const [fitNote, setFitNote] = useState('');
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyText, setBusyText] = useState('');
  const [normTick, setNormTick] = useState(0); // bumped whenever the baked base changes
  const normRef = useRef(null);
  const wrapRef = useRef(null);
  const dragRef = useRef(null);
  const prevToken = useRef(0);
  const pixelsRef = useRef(''); // last-rendered preview pixels (skips identical re-renders)
  const url = useMemo(() => URL.createObjectURL(entry.raw), [entry]);

  useEffect(() => () => { try { URL.revokeObjectURL(url); } catch {} }, [url]);
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  // Image source (with <img> fallback for exotic formats).
  useEffect(() => {
    if (isVideo) return;
    let live = true;
    (async () => {
      try {
        const b = await createImageBitmap(entry.raw);
        if (live) setBmp(b);
      } catch {
        try {
          const u = URL.createObjectURL(entry.raw);
          const img = new Image();
          img.onload = () => {
            try {
              const c = document.createElement('canvas');
              c.width = img.naturalWidth || 800;
              c.height = img.naturalHeight || 600;
              c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
              URL.revokeObjectURL(u);
              if (live && c.width && c.height) createImageBitmap(c).then((b) => { if (live) setBmp(b); }).catch(() => {});
            } catch { URL.revokeObjectURL(u); }
          };
          img.onerror = () => URL.revokeObjectURL(u);
          img.src = u;
        } catch {}
      }
    })();
    return () => { live = false; };
  }, [entry, isVideo]);

  // Video source: element parked at a representative frame.
  useEffect(() => {
    if (!isVideo) return;
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    const u = URL.createObjectURL(entry.raw);
    v.src = u;
    v.onloadedmetadata = () => {
      try { v.currentTime = Math.min(0.6, ((v.duration || 1.2) / 2) || 0); } catch {}
    };
    v.onseeked = () => setVidEl(v);
    v.onloadeddata = () => setVidEl((old) => old || v);
    return () => { URL.revokeObjectURL(u); setVidEl(null); };
  }, [entry, isVideo]);

  // Normalized bitmap: rotation + flip baked in (preview + export base).
  // The visible preview renders separately below so every control
  // (aspect, fit/crop, box) shows up live.
  useEffect(() => {
    const bake = (src, sw, sh) => {
      if (!sw || !sh) return;
      const swap = rot % 2 === 1;
      const c = document.createElement('canvas');
      c.width = swap ? sh : sw;
      c.height = swap ? sw : sh;
      const ctx = c.getContext('2d');
      ctx.translate(c.width / 2, c.height / 2);
      ctx.rotate((rot * Math.PI) / 2);
      ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
      ctx.drawImage(src, -sw / 2, -sh / 2, sw, sh);
      normRef.current = c;
      setNormTick((t) => t + 1);
    };
    if (!isVideo && bmp) bake(bmp, bmp.width, bmp.height);
    else if (isVideo && vidEl && vidEl.videoWidth) bake(vidEl, vidEl.videoWidth, vidEl.videoHeight);
  }, [bmp, vidEl, rot, flipH, flipV, isVideo]);

  // WYSIWYG preview: exactly what Done will export, re-rendered on every
  // control change. Fit/Original render the final padded frame at the exact
  // target ratio; Crop mode renders the full frame under the ratio-locked
  // box overlay (the box IS the output). rAF-throttled + token-guarded so
  // fast drags never flash a stale frame. In crop mode the pixels never
  // change with the box — only the overlay moves — so re-renders are
  // skipped while dragging (no flicker under your fingers).
  useEffect(() => {
    const c = normRef.current;
    if (!c || !c.width || !c.height) return;
    const r = RATIOS[aspect];
    const pixelsKey = free && r ? `crop|${normTick}|${aspect}` : `final|${normTick}|${aspect}|${pad}`;
    if (pixelsKey === pixelsRef.current) return;
    const tk = ++prevToken.current;
    let raf = 0;
    const render = () => {
      raf = 0;
      if (tk !== prevToken.current) return;
      const out = document.createElement('canvas');
      const ctx = out.getContext('2d');
      const fitScale = (w, h, max = 880) => Math.min(1, max / Math.max(w, h));
      if (free && r) {
        const s = fitScale(c.width, c.height);
        out.width = Math.max(1, Math.round(c.width * s));
        out.height = Math.max(1, Math.round(c.height * s));
        ctx.drawImage(c, 0, 0, out.width, out.height);
      } else if (!r) {
        const s = fitScale(c.width, c.height);
        out.width = Math.max(1, Math.round(c.width * s));
        out.height = Math.max(1, Math.round(c.height * s));
        ctx.drawImage(c, 0, 0, out.width, out.height);
      } else {
        const t = targetDims();
        if (!t) return;
        const s = fitScale(t.w, t.h);
        out.width = Math.max(1, Math.round(t.w * s));
        out.height = Math.max(1, Math.round(t.h * s));
        drawFit(ctx, c, c.width, c.height, out.width, out.height);
      }
      out.toBlob((blob) => {
        if (!blob || tk !== prevToken.current) return;
        pixelsRef.current = pixelsKey;
        setPreview((old) => { try { if (old) URL.revokeObjectURL(old); } catch {} return URL.createObjectURL(blob); });
      }, 'image/jpeg', 0.85);
    };
    raf = requestAnimationFrame(render);
    return () => { if (raf) cancelAnimationFrame(raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normTick, aspect, pad, free, box]);

  const ready = isVideo ? !!vidEl : !!bmp;

  // If the user picked a ratio before the media finished loading, the box
  // couldn't be computed then — apply it now that dimensions are known.
  useEffect(() => {
    if (ready && !box) applyRatio(normDims(), aspect);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Natural dims of the source (before rotation).
  const natDims = () => {
    if (isVideo) return vidEl && vidEl.videoWidth ? { w: vidEl.videoWidth, h: vidEl.videoHeight } : null;
    return bmp ? { w: bmp.width, h: bmp.height } : null;
  };
  // Normalized dims after the current rotation.
  const normDims = (r = rot) => {
    const n = natDims();
    if (!n) return null;
    return r % 2 === 1 ? { w: n.h, h: n.w } : n;
  };
  // Exact output pixels for the chosen ratio: long edge clamped between
  // 1080 and 2160, so nothing is upscaled past the source needlessly and
  // every export lands on an exact platform ratio.
  const targetDims = () => {
    const d = normDims();
    if (!d) return null;
    const r = RATIOS[aspect];
    if (!r) return { w: d.w, h: d.h };
    const long = Math.max(1080, Math.min(2160, Math.max(d.w, d.h)));
    if (r >= 1) return { w: Math.round(long), h: Math.round(long / r) };
    return { w: Math.round(long * r), h: Math.round(long) };
  };

  // Smart default per ratio: already-correct -> no change, otherwise CROP
  // (literal cut to the exact ratio — no blur, no padding). Fit stays one
  // click away for anyone who wants the whole frame kept.
  const applyRatio = (d, id) => {
    const r = RATIOS[id];
    if (!d || !r) {
      setBox({ ...FULL });
      setFree(false);
      setFitNote(id === 'Original' ? '' : '');
      return;
    }
    if (fitsRatio(d.w, d.h, r)) {
      setBox({ ...FULL });
      setFree(false);
      setFitNote(`Already ${id} — nothing is cropped.`);
      return;
    }
    setBox(fitBox(d.w, d.h, r));
    setFree(true);
    setPad(false);
    setFitNote(`Cropped to ${id} — drag the box or draw on the photo to choose what stays.`);
  };
  const pickAspect = (id) => {
    setAspect(id);
    applyRatio(normDims(), id);
  };
  const setMode = (crop) => {
    const d = normDims();
    if (!d) return;
    if (!crop) {
      setPad(true);
      setFree(false);
      setFitNote(RATIOS[aspect] && !fitsRatio(d.w, d.h, RATIOS[aspect]) ? `Fit — whole frame kept, padded to ${aspect}.` : 'Fit — the whole frame is kept.');
      return;
    }
    setPad(false);
    if (aspect === 'Original') {
      setBox(fitBox(d.w, d.h, null));
      setFree(true);
      setFitNote('Crop mode — drag the box to choose what stays.');
      return;
    }
    setBox(fitBox(d.w, d.h, RATIOS[aspect]));
    setFree(true);
    setFitNote(`Crop mode — edges are cut to fill ${aspect}.`);
  };
  const rotateTo = (nr) => {
    setRot(nr);
    // Rotation changes dimensions: re-evaluate the smart default.
    const n = natDims();
    if (!n) return;
    applyRatio(nr % 2 === 1 ? { w: n.h, h: n.w } : n, aspect);
  };

  const onPointerDown = (e, mode) => {
    if (!free || !box || !wrapRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    try { e.target.setPointerCapture?.(e.pointerId); } catch {}
    dragRef.current = { mode, x0: e.clientX, y0: e.clientY, box: { ...box } };
  };
  // Drag anywhere on the photo (outside the box) to draw a fresh crop window
  // — the fastest way to keep the whole image then cut exactly what you want.
  // Box/handle drags stopPropagation above, so this only fires for new boxes.
  const startDraw = (e) => {
    if (!free || !wrapRef.current || !normRef.current) return;
    if (e.target?.closest?.('.crop-hint')) return;
    const r = wrapRef.current.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const ax = (e.clientX - r.left) / r.width;
    const ay = (e.clientY - r.top) / r.height;
    if (ax < 0 || ax > 1 || ay < 0 || ay > 1) return;
    e.preventDefault();
    dragRef.current = { mode: 'draw', x0: e.clientX, y0: e.clientY, ax, ay };
  };
  const onPointerMove = useCallback((e) => {
    const d = dragRef.current;
    const wrap = wrapRef.current;
    if (!d || !wrap) return;
    const r = wrap.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const dx = (e.clientX - d.x0) / r.width;
    const dy = (e.clientY - d.y0) / r.height;
    const c = normRef.current;
    const ratio = RATIOS[aspect];
    const MIN = 0.05;
    let { fx, fy } = d.box;
    const clampBox = (b) => {
      b.fw = Math.min(1, Math.max(MIN, b.fw));
      b.fh = Math.min(1, Math.max(MIN, b.fh));
      b.fx = Math.min(1 - b.fw, Math.max(0, b.fx));
      b.fy = Math.min(1 - b.fh, Math.max(0, b.fy));
      return b;
    };
    if (d.mode === 'move') {
      setBox(clampBox({ fx: d.box.fx + dx, fy: d.box.fy + dy, fw: d.box.fw, fh: d.box.fh }));
      return;
    }
    if (d.mode === 'draw') {
      // Anchor stays fixed, opposite corner follows the pointer; the window
      // stays ratio-locked to the target aspect when one is chosen.
      const c2 = normRef.current;
      const dratio = RATIOS[aspect];
      const dImg = c2 ? c2.width / c2.height : 1;
      let fw = Math.abs(dx);
      let fh = Math.abs(dy);
      if (dratio) {
        const target = dratio / dImg;
        if (fw / target >= fh) fh = fw / target;
        else fw = fh * target;
      }
      const fx = dx >= 0 ? d.ax : d.ax - fw;
      const fy = dy >= 0 ? d.ay : d.ay - fh;
      setBox(clampBox({ fx, fy, fw: Math.max(fw, MIN), fh: Math.max(fh, MIN) }));
      return;
    }
    const imgRatio = c ? c.width / c.height : 1;
    let nw = d.box.fw;
    let nh = d.box.fh;
    if (d.mode.includes('e')) nw = d.box.fw + dx;
    if (d.mode.includes('w')) nw = d.box.fw - dx;
    if (d.mode.includes('s')) nh = d.box.fh + dy;
    if (d.mode.includes('n')) nh = d.box.fh - dy;
    if (ratio) {
      const target = ratio / imgRatio; // fw/fh in fraction space
      if (Math.abs(dx) >= Math.abs(dy)) nh = nw / target;
      else nw = nh * target;
    }
    nw = Math.max(MIN, nw); nh = Math.max(MIN, nh);
    if (d.mode.includes('w')) fx = d.box.fx + d.box.fw - nw;
    if (d.mode.includes('n')) fy = d.box.fy + d.box.fh - nh;
    setBox(clampBox({ fx, fy, fw: nw, fh: nh }));
  }, [aspect]);
  const endDrag = useCallback(() => { dragRef.current = null; }, []);
  useEffect(() => {
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
    };
  }, [onPointerMove, endDrag]);

  const exportImage = () => {
    const c = normRef.current;
    const r = RATIOS[aspect];
    const out = document.createElement('canvas');
    const ctx = out.getContext('2d');
    if (pad || !r) {
      // Fit: exact target ratio, whole frame kept, blurred fill behind.
      const t = targetDims();
      out.width = t.w;
      out.height = t.h;
      if (!r) {
        const scale = Math.max(1, 1080 / Math.max(c.width, c.height));
        out.width = Math.round(c.width * scale);
        out.height = Math.round(c.height * scale);
        ctx.drawImage(c, 0, 0, out.width, out.height);
      } else {
        drawFit(ctx, c, c.width, c.height, out.width, out.height);
      }
    } else {
      // Crop: the user's window, snapped to the exact ratio.
      const t = targetDims();
      out.width = t.w;
      out.height = t.h;
      const win = cropWindow(box, c.width, c.height, r);
      ctx.drawImage(c, win.x, win.y, win.w, win.h, 0, 0, out.width, out.height);
    }
    out.toBlob((blob) => {
      setBusy(false); setBusyText('');
      if (!blob) return;
      const name = String(entry.name || 'photo').replace(/\.[a-z0-9]+$/i, '') + '-edited.jpg';
      onApply(new File([blob], name, { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.92);
  };

  const exportVideo = async () => {
    setBusyText('Rendering video…');
    const srcUrl = URL.createObjectURL(entry.raw);
    const src = document.createElement('video');
    src.muted = true; src.playsInline = true; src.preload = 'auto';
    const fail = (msg) => {
      try { URL.revokeObjectURL(srcUrl); } catch {}
      setBusy(false); setBusyText('');
      alert(msg || 'Could not crop this video in this browser — try Chrome or Edge.');
    };
    src.onerror = () => fail();
    src.src = srcUrl;
    try {
      await new Promise((res, rej) => {
        src.onloadedmetadata = res;
        src.onerror = rej;
      });
      const swap = rot % 2 === 1;
      const Nw = swap ? src.videoHeight : src.videoWidth;
      const Nh = swap ? src.videoWidth : src.videoHeight;
      if (!Nw || !Nh) throw new Error('unreadable');
      const r = RATIOS[aspect];
      // Same smart rules as photos: Fit keeps everything, Crop cuts to ratio.
      let W;
      let H;
      let win = null;
      if (pad || !r) {
        const long = Math.max(2, Math.min(1280, Math.max(Nw, Nh)));
        if (!r) { W = Nw; H = Nh; }
        else if (r >= 1) { W = long; H = Math.max(2, Math.round(long / r)); }
        else { H = long; W = Math.max(2, Math.round(long * r)); }
      } else {
        const long = Math.max(2, Math.min(1280, Math.max(Nw, Nh)));
        W = r >= 1 ? long : Math.max(2, Math.round(long * r));
        H = r >= 1 ? Math.max(2, Math.round(long / r)) : long;
        win = cropWindow(box, Nw, Nh, r);
      }
      const norm = document.createElement('canvas');
      norm.width = Nw; norm.height = Nh;
      const nctx = norm.getContext('2d');
      const out = document.createElement('canvas');
      out.width = W; out.height = H;
      const octx = out.getContext('2d');
      const stream = out.captureStream(30);
      try {
        const withAudio = src.captureStream ? src.captureStream() : null;
        (withAudio ? withAudio.getAudioTracks() : []).forEach((t) => stream.addTrack(t));
      } catch {}
      const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      const stopped = new Promise((res) => { rec.onstop = res; });
      let finished = false;
      const finish = async () => {
        if (finished) return;
        finished = true;
        try { rec.stop(); } catch {}
        await stopped;
        try { src.pause(); } catch {}
        try { URL.revokeObjectURL(srcUrl); } catch {}
        setBusy(false); setBusyText('');
        const blob = new Blob(chunks, { type: 'video/webm' });
        if (!blob.size) { alert('Crop produced an empty file — try Chrome or Edge.'); return; }
        const name = String(entry.name || 'video').replace(/\.[a-z0-9]+$/i, '') + '-cropped.webm';
        onApply(new File([blob], name, { type: 'video/webm' }));
      };
      const dur = isFinite(src.duration) && src.duration > 0 ? src.duration : 10;
      const kill = setTimeout(finish, Math.min(dur * 1000 + 2000, 125000));
      src.onended = () => { clearTimeout(kill); finish(); };
      src.currentTime = 0;
      await src.play().catch(() => {});
      rec.start(250);
      const draw = () => {
        if (finished || rec.state !== 'recording') return;
        nctx.save();
        nctx.clearRect(0, 0, Nw, Nh);
        nctx.translate(Nw / 2, Nh / 2);
        nctx.rotate((rot * Math.PI) / 2);
        nctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
        nctx.drawImage(src, -src.videoWidth / 2, -src.videoHeight / 2, src.videoWidth, src.videoHeight);
        nctx.restore();
        if (win) octx.drawImage(norm, win.x, win.y, win.w, win.h, 0, 0, W, H);
        else drawFit(octx, norm, Nw, Nh, W, H);
        // True progress: frames actually rendered vs total duration.
        if (isFinite(dur) && dur > 0) {
          setBusyText(`Rendering video… ${Math.min(100, Math.round((src.currentTime / dur) * 100))}%`);
        }
        requestAnimationFrame(draw);
      };
      draw();
    } catch { fail(); }
  };

  const done = () => {
    if (busy) return;
    if (isVideo) {
      if (!vidEl) return;
      setBusy(true);
      exportVideo();
    } else {
      if (!normRef.current) return;
      setBusy(true); setBusyText('');
      try { exportImage(); }
      catch { setBusy(false); setBusyText(''); }
    }
  };

  return (
    <div className="s2-overlay" onClick={onClose}>
      <div className="s2-editor" role="dialog" aria-modal="true" aria-label={`Edit ${entry.name}`} onClick={(e) => e.stopPropagation()}>
        <h2>Edit {isVideo ? 'video' : 'media'}</h2>
        <p className="sub">{entry.name} · {isVideo ? 'fit or crop, re-encoded with audio kept' : 'fit or crop, exact-size HD output'}</p>
        <div className="s2-ed-cols">
          <div className="crop-stage">
            <div className="crop-wrap" ref={wrapRef} onPointerDown={free ? startDraw : undefined}>
              {preview
                ? <img src={preview} alt="Edit preview" draggable={false} />
                : <span style={{ color: '#888', fontSize: 13 }}>Loading…</span>}
              {free && box && (
                <div
                  className="crop-box"
                  style={{ left: `${box.fx * 100}%`, top: `${box.fy * 100}%`, width: `${box.fw * 100}%`, height: `${box.fh * 100}%` }}
                  onPointerDown={(e) => onPointerDown(e, 'move')}
                >
                  {['nw', 'ne', 'sw', 'se'].map((h) => (
                    <span key={h} className={`crop-handle ${h}`} onPointerDown={(e) => onPointerDown(e, h)} />
                  ))}
                </div>
              )}
              {free && (
                <p className="crop-hint">Drag on the photo to draw a new crop · drag the box to move · corners to resize</p>
              )}
            </div>
          </div>
          <div>
            <div className="s2-pills" role="group" aria-label="Aspect ratio">
              {Object.keys(RATIOS).map((id) => (
                <button key={id} type="button" className={aspect === id ? 's2-pill on' : 's2-pill'} onClick={() => pickAspect(id)}>{id}</button>
              ))}
            </div>
            {fitNote && <p className="s2-note">{fitNote}</p>}
            {RATIOS[aspect] && (
              <div className="s2-mode" role="group" aria-label="Fit or crop">
                <button type="button" className={pad ? 'on' : ''} onClick={() => setMode(false)}>Fit · keep everything</button>
                <button type="button" className={!pad ? 'on' : ''} onClick={() => setMode(true)}>Crop · fill the frame</button>
              </div>
            )}
            <div className="s2-ed-btns">
              <button type="button" onClick={() => rotateTo((rot + 3) % 4)}>Rotate left</button>
              <button type="button" onClick={() => rotateTo((rot + 1) % 4)}>Rotate right</button>
              <button type="button" className={flipV ? 'on' : ''} onClick={() => setFlipV((v) => !v)}>Flip vertical</button>
              <button type="button" className={flipH ? 'on' : ''} onClick={() => setFlipH((v) => !v)}>Flip horizontal</button>
            </div>
            {targetDims() && (
              <p className="s3-xcount" style={{ marginTop: 0, marginBottom: 10 }}>
                Output: <b style={{ color: 'var(--ink)' }}>{targetDims().w} × {targetDims().h}px</b>
                {RATIOS[aspect] ? ` · ${aspect}` : ' · original size'}
              </p>
            )}
            <button type="button" className="s2-done" disabled={busy || !ready} onClick={done}>
              {busy ? (busyText || 'Saving…') : isVideo ? 'Done editing (render video)' : 'Done editing'}
            </button>
            <button type="button" className="s2-cancel" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
