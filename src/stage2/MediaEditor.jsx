import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// Crop + resize only (per wireframe): aspect pills, rotate, flip,
// free-crop box, done. Images export HD JPEG; videos re-encode
// (full duration, capped 1280px, original audio kept) as WebM.
const RATIOS = { Original: null, '4:5': 4 / 5, '1:1': 1, '16:9': 16 / 9, '9:16': 9 / 16 };

function fitBox(nw, nh, ratio) {
  if (!ratio) return { fx: 0.04, fy: 0.04, fw: 0.92, fh: 0.92 };
  let fh = 0.92;
  let fw = fh * (nh / nw) * ratio;
  if (fw > 0.92) { fw = 0.92; fh = fw * (nw / nh) / ratio; }
  return { fx: (1 - fw) / 2, fy: (1 - fh) / 2, fw, fh };
}

export default function MediaEditor({ entry, onClose, onApply }) {
  const isVideo = entry.type.startsWith('video/');
  const [bmp, setBmp] = useState(null);
  const [vidEl, setVidEl] = useState(null);
  const [rot, setRot] = useState(0); // quarter turns clockwise
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [aspect, setAspect] = useState('Original');
  const [free, setFree] = useState(false);
  const [box, setBox] = useState(null);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyText, setBusyText] = useState('');
  const normRef = useRef(null);
  const wrapRef = useRef(null);
  const dragRef = useRef(null);
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
      c.toBlob((blob) => {
        if (!blob) return;
        setPreview((old) => { try { if (old) URL.revokeObjectURL(old); } catch {} return URL.createObjectURL(blob); });
      }, 'image/jpeg', 0.85);
    };
    if (!isVideo && bmp) bake(bmp, bmp.width, bmp.height);
    else if (isVideo && vidEl && vidEl.videoWidth) bake(vidEl, vidEl.videoWidth, vidEl.videoHeight);
  }, [bmp, vidEl, rot, flipH, flipV, isVideo]);

  const ready = isVideo ? !!vidEl : !!bmp;

  const enableFree = () => {
    const c = normRef.current;
    if (!c) return;
    setBox(fitBox(c.width, c.height, RATIOS[aspect]));
    setFree(true);
  };
  const pickAspect = (id) => {
    setAspect(id);
    const c = normRef.current;
    if (!c) return;
    setBox(fitBox(c.width, c.height, RATIOS[id]));
    setFree(true);
  };

  const onPointerDown = (e, mode) => {
    if (!free || !box || !wrapRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    try { e.target.setPointerCapture?.(e.pointerId); } catch {}
    dragRef.current = { mode, x0: e.clientX, y0: e.clientY, box: { ...box } };
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
    const b = free && box ? box : { fx: 0, fy: 0, fw: 1, fh: 1 };
    const sx = Math.round(b.fx * c.width);
    const sy = Math.round(b.fy * c.height);
    const sw = Math.max(1, Math.round(b.fw * c.width));
    const sh = Math.max(1, Math.round(b.fh * c.height));
    const scale = Math.max(1, 1080 / Math.max(sw, sh));
    const out = document.createElement('canvas');
    out.width = Math.round(sw * scale);
    out.height = Math.round(sh * scale);
    out.getContext('2d').drawImage(c, sx, sy, sw, sh, 0, 0, out.width, out.height);
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
      const b = free && box ? box : { fx: 0, fy: 0, fw: 1, fh: 1 };
      const sx = b.fx * Nw;
      const sy = b.fy * Nh;
      const sw = Math.max(2, b.fw * Nw);
      const sh = Math.max(2, b.fh * Nh);
      const scale = Math.min(1, 1280 / Math.max(sw, sh));
      const W = Math.max(2, Math.round(sw * scale));
      const H = Math.max(2, Math.round(sh * scale));
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
        octx.drawImage(norm, sx, sy, sw, sh, 0, 0, W, H);
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
        <p className="sub">{entry.name} · {isVideo ? 'crop + resize, re-encoded with audio kept' : 'crop + resize only, HD output'}</p>
        <div className="s2-ed-cols">
          <div className="crop-stage">
            <div className="crop-wrap" ref={wrapRef}>
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
            </div>
          </div>
          <div>
            <div className="s2-pills" role="group" aria-label="Aspect ratio">
              {Object.keys(RATIOS).map((id) => (
                <button key={id} type="button" className={aspect === id ? 's2-pill on' : 's2-pill'} onClick={() => pickAspect(id)}>{id}</button>
              ))}
            </div>
            <div className="s2-ed-btns">
              <button type="button" onClick={() => setRot((r) => (r + 3) % 4)}>Rotate left</button>
              <button type="button" onClick={() => setRot((r) => (r + 1) % 4)}>Rotate right</button>
              <button type="button" className={flipV ? 'on' : ''} onClick={() => setFlipV((v) => !v)}>Flip vertical</button>
              <button type="button" className={flipH ? 'on' : ''} onClick={() => setFlipH((v) => !v)}>Flip horizontal</button>
            </div>
            <div className="s2-ed-btns" style={{ gridTemplateColumns: '1fr' }}>
              <button type="button" className={free ? 'on' : ''} onClick={() => (free ? setFree(false) : enableFree())}>
                {free ? 'Crop freely · on (drag the box)' : 'Crop freely'}
              </button>
            </div>
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
