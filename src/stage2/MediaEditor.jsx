import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import VideoTimelineEditor from './VideoTimelineEditor.jsx';
import EpidemicCatalog from '../music/EpidemicCatalog.jsx';

// Crop + resize only (per wireframe): aspect pills, rotate, flip,
// fit-or-crop, done. Images export exact-size JPEG; videos re-encode
// (full duration, capped 1280px, original audio kept) as WebM.
const RATIOS = {
  Original: null,
  '4:5': 4 / 5,
  '3:4': 3 / 4,
  '2:3': 2 / 3,
  '1:1': 1,
  '3:2': 3 / 2,
  '4:3': 4 / 3,
  '16:9': 16 / 9,
  '9:16': 9 / 16,
};

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

export default function MediaEditor({ entry, token, onClose, onApply, onApplyMusic, onRemoveMusic }) {
  const isVideo = entry.type.startsWith('video/');
  const [bmp, setBmp] = useState(null);
  const [vidEl, setVidEl] = useState(null);
  const [videoFrameTick, setVideoFrameTick] = useState(0);
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
  const [overlays, setOverlays] = useState([]);
  const [selectedOverlay, setSelectedOverlay] = useState('');
  const [overlayText, setOverlayText] = useState('Your text');
  const overlayDragRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [busyText, setBusyText] = useState('');
  const [showVideoTimeline, setShowVideoTimeline] = useState(false);
  const [normTick, setNormTick] = useState(0); // bumped whenever the baked base changes
  const normRef = useRef(null);
  const wrapRef = useRef(null);
  const dragRef = useRef(null);
  const prevToken = useRef(0);
  const pixelsRef = useRef(''); // last-rendered preview pixels (skips identical re-renders)
  const overlayLayerRef = useRef(null);
  const url = useMemo(() => URL.createObjectURL(entry.raw), [entry]);

  useEffect(() => () => { try { URL.revokeObjectURL(url); } catch {} }, [url]);
  useEffect(() => {
    if (!preview) return undefined;
    return () => { try { URL.revokeObjectURL(preview); } catch {} };
  }, [preview]);
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose, busy]);

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
    v.onloadedmetadata = () => {
      try { v.currentTime = Math.min(0.6, ((v.duration || 1.2) / 2) || 0); } catch {}
    };
    v.onseeked = () => { setVidEl(v); setVideoFrameTick((tick) => tick + 1); };
    v.onloadeddata = () => { setVidEl(v); setVideoFrameTick((tick) => tick + 1); };
    v.onerror = () => setVidEl(null);
    v.src = u;
    v.load();
    return () => { v.pause(); v.removeAttribute('src'); v.load(); URL.revokeObjectURL(u); setVidEl(null); };
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
  }, [bmp, vidEl, videoFrameTick, rot, flipH, flipV, isVideo]);

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
        setPreview(URL.createObjectURL(blob));
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
  const outputDims = () => {
    if (!normRef.current) return null;
    if (!pad && !RATIOS[aspect]) {
      const win = cropWindow(box, normRef.current.width, normRef.current.height, null);
      return { w: win.w, h: win.h };
    }
    return targetDims();
  };

  const selectedOverlayItem = overlays.find((item) => item.id === selectedOverlay);
  const addOverlay = (kind) => {
    const id = `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const item = {
      id, kind, x: 0.25, y: 0.38, w: kind === 'text' ? 0.5 : 0.3,
      h: kind === 'text' ? 0.18 : 0.24, text: kind === 'text' ? overlayText || 'Your text' : '',
      font: 'Arial', size: 7, color: '#ffffff', fill: kind === 'text' ? 'transparent' : '#61c7a7',
      stroke: '#ffffff', strokeWidth: 0.5, bold: true, align: 'center',
    };
    setOverlays((items) => [...items, item]);
    setSelectedOverlay(id);
  };
  const updateSelectedOverlay = (patch) => {
    if (!selectedOverlay) return;
    setOverlays((items) => items.map((item) => item.id === selectedOverlay ? { ...item, ...patch } : item));
  };
  const removeSelectedOverlay = () => {
    setOverlays((items) => items.filter((item) => item.id !== selectedOverlay));
    setSelectedOverlay('');
  };
  const duplicateOverlay = () => {
    if (!selectedOverlayItem || busy) return;
    const copy = { ...selectedOverlayItem, id: crypto.randomUUID() };
    copy.x = Math.min(1 - copy.w, copy.x + 0.025);
    copy.y = Math.min(1 - copy.h, copy.y + 0.025);
    setOverlays((items) => [...items, copy]);
    setSelectedOverlay(copy.id);
  };
  const reorderOverlay = (front) => {
    setOverlays((items) => {
      const selected = items.find((item) => item.id === selectedOverlay);
      if (!selected) return items;
      const rest = items.filter((item) => item.id !== selectedOverlay);
      return front ? [...rest, selected] : [selected, ...rest];
    });
  };
  const setOverlayDimension = (key, value) => {
    if (!Number.isFinite(value)) return;
    setOverlays((items) => items.map((item) => {
      if (item.id !== selectedOverlay) return item;
      const next = { ...item };
      const maximum = key === 'x' ? 1 - item.w : key === 'y' ? 1 - item.h : key === 'w' ? 1 - item.x : 1 - item.y;
      next[key] = Math.max(key === 'w' || key === 'h' ? 0.01 : 0, Math.min(maximum, value / 100));
      return next;
    }));
  };
  useEffect(() => {
    const handleKey = (event) => {
      if (busy || !selectedOverlay || event.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        setOverlays((items) => items.filter((item) => item.id !== selectedOverlay));
        setSelectedOverlay('');
        return;
      }
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      const bounds = overlayLayerRef.current?.getBoundingClientRect();
      if (!bounds?.width || !bounds.height) return;
      event.preventDefault();
      const pixels = event.shiftKey ? 10 : 1;
      setOverlays((items) => items.map((item) => item.id !== selectedOverlay ? item : {
        ...item,
        x: Math.max(0, Math.min(1 - item.w, item.x + (event.key === 'ArrowLeft' ? -pixels : event.key === 'ArrowRight' ? pixels : 0) / bounds.width)),
        y: Math.max(0, Math.min(1 - item.h, item.y + (event.key === 'ArrowUp' ? -pixels : event.key === 'ArrowDown' ? pixels : 0) / bounds.height)),
      }));
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [selectedOverlay, busy]);
  const paintOverlays = (ctx, width, height) => {
    overlays.forEach((item) => {
      const x = item.x * width;
      const y = item.y * height;
      const w = item.w * width;
      const h = item.h * height;
      ctx.save();
      ctx.lineWidth = Math.max(1, Number(item.strokeWidth || 0.5) * width / 100);
      ctx.strokeStyle = item.stroke || '#ffffff';
      ctx.fillStyle = item.fill || 'transparent';
      if (item.kind === 'text') {
        const fontSize = Math.max(12, Number(item.size || 7) * width / 100);
        ctx.font = `${item.bold ? '700' : '400'} ${fontSize}px ${JSON.stringify(item.font || 'Arial')}`;
        ctx.textAlign = item.align || 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(0,0,0,.72)';
        ctx.lineWidth = Math.max(2, fontSize * 0.12);
        const explicitLines = String(item.text || '').split('\n');
        const lines = explicitLines.flatMap((line) => {
          const words = line.split(/\s+/).filter(Boolean);
          if (!words.length) return [''];
          const wrapped = [];
          let current = '';
          words.forEach((word) => {
            const candidate = current ? `${current} ${word}` : word;
            if (current && ctx.measureText(candidate).width > w) {
              wrapped.push(current);
              current = word;
            } else current = candidate;
          });
          wrapped.push(current);
          return wrapped;
        });
        const lineHeight = fontSize * 1.15;
        const textX = item.align === 'left' ? x : item.align === 'right' ? x + w : x + w / 2;
        const startY = y + h / 2 - ((lines.length - 1) * lineHeight) / 2;
        lines.forEach((line, index) => {
          ctx.strokeText(line, textX, startY + index * lineHeight, w);
          ctx.fillStyle = item.color || '#ffffff';
          ctx.fillText(line, textX, startY + index * lineHeight, w);
        });
      } else if (item.kind === 'rect') {
        if (item.fill !== 'transparent') ctx.fillRect(x, y, w, h);
        if (item.strokeWidth > 0) ctx.strokeRect(x, y, w, h);
      } else if (item.kind === 'circle') {
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        if (item.fill !== 'transparent') ctx.fill();
        if (item.strokeWidth > 0) ctx.stroke();
      }
      ctx.restore();
    });
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
    const overlayDrag = overlayDragRef.current;
    if (overlayDrag && overlayLayerRef.current) {
      const bounds = overlayLayerRef.current.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const dx = (e.clientX - overlayDrag.x0) / bounds.width;
      const dy = (e.clientY - overlayDrag.y0) / bounds.height;
      if (overlayDrag.handle) {
        const { x, y, w, h } = overlayDrag.item;
        const handle = overlayDrag.handle;
        const minW = Math.min(w, 24 / bounds.width);
        const minH = Math.min(h, 24 / bounds.height);
        let left = x, top = y, right = x + w, bottom = y + h;
        if (handle.includes('w')) left = Math.max(0, Math.min(right - minW, x + dx));
        if (handle.includes('e')) right = Math.min(1, Math.max(left + minW, x + w + dx));
        if (handle.includes('n')) top = Math.max(0, Math.min(bottom - minH, y + dy));
        if (handle.includes('s')) bottom = Math.min(1, Math.max(top + minH, y + h + dy));
        setOverlays((items) => items.map((item) => item.id === overlayDrag.id
          ? { ...item, x: left, y: top, w: right - left, h: bottom - top }
          : item));
        return;
      }
      setOverlays((items) => items.map((item) => item.id === overlayDrag.id
        ? { ...item, x: Math.max(0, Math.min(1 - item.w, overlayDrag.item.x + dx)), y: Math.max(0, Math.min(1 - item.h, overlayDrag.item.y + dy)) }
        : item));
      return;
    }
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
    let { fx, fy } = d.box || FULL;
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
  const endDrag = useCallback(() => { dragRef.current = null; overlayDragRef.current = null; }, []);
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
    if (pad) {
      // Fit: exact target ratio, whole frame kept, blurred fill behind.
      const t = targetDims();
      out.width = t.w;
      out.height = t.h;
      if (!r) {
        ctx.drawImage(c, 0, 0, out.width, out.height);
      } else {
        drawFit(ctx, c, c.width, c.height, out.width, out.height);
      }
    } else {
      // Crop: the user's window, snapped to the exact ratio.
      const win = cropWindow(box, c.width, c.height, r);
      const t = r ? targetDims() : { w: win.w, h: win.h };
      out.width = t.w;
      out.height = t.h;
      ctx.drawImage(c, win.x, win.y, win.w, win.h, 0, 0, out.width, out.height);
    }
    paintOverlays(ctx, out.width, out.height);
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
      if (pad) {
        const long = Math.max(2, Math.min(1280, Math.max(Nw, Nh)));
        if (!r) { W = Nw; H = Nh; }
        else if (r >= 1) { W = long; H = Math.max(2, Math.round(long / r)); }
        else { H = long; W = Math.max(2, Math.round(long * r)); }
      } else {
        const long = Math.max(2, Math.min(1280, Math.max(Nw, Nh)));
        W = r >= 1 ? long : Math.max(2, Math.round(long * r));
        H = r >= 1 ? Math.max(2, Math.round(long / r)) : long;
        win = cropWindow(box, Nw, Nh, r);
        if (!r) { W = win.w; H = win.h; }
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
      const kill = setTimeout(finish, dur * 1000 + 2000);
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
        paintOverlays(octx, W, H);
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

  const renderOverlayLayer = () => (
    <div className="s2-overlay-layer" ref={overlayLayerRef} aria-label="Text and shape overlays">
      {overlays.map((item) => (
        <div
          key={item.id}
          className={`s2-overlay-item ${item.kind}${selectedOverlay === item.id ? ' selected' : ''}`}
          style={{
            left: `${item.x * 100}%`, top: `${item.y * 100}%`,
            width: `${item.w * 100}%`, height: `${item.h * 100}%`,
            color: item.color, fontFamily: item.font, fontSize: `${item.size}cqi`,
            fontWeight: item.bold ? 700 : 400, textAlign: item.align,
            background: item.kind === 'text' ? 'transparent' : item.fill,
            borderColor: item.stroke, borderWidth: `${item.strokeWidth}cqi`,
          }}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setSelectedOverlay(item.id);
            overlayDragRef.current = { id: item.id, x0: event.clientX, y0: event.clientY, item: { ...item } };
          }}
          onClick={(event) => { event.stopPropagation(); setSelectedOverlay(item.id); }}
        >
          {item.kind === 'text' ? <span>{item.text || 'Your text'}</span> : null}
        </div>
      ))}
      {selectedOverlayItem && <div className="s2-selection-bounds" style={{
        left: `${selectedOverlayItem.x * 100}%`, top: `${selectedOverlayItem.y * 100}%`,
        width: `${selectedOverlayItem.w * 100}%`, height: `${selectedOverlayItem.h * 100}%`,
      }}>
        {['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((handle) => (
          <button key={handle} type="button" className={`s2-resize-handle ${handle}`}
            aria-label={`Resize selected element ${handle}`}
            onPointerDown={(event) => {
              if (busy) return;
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.setPointerCapture(event.pointerId);
              overlayDragRef.current = {
                id: selectedOverlayItem.id, handle,
                x0: event.clientX, y0: event.clientY, item: { ...selectedOverlayItem },
              };
            }}
            onClick={(event) => event.stopPropagation()}
          />
        ))}
      </div>}
    </div>
  );

  if (showVideoTimeline && isVideo) {
    return (
      <div className="s2-overlay" onClick={() => setShowVideoTimeline(false)}>
        <div onClick={(e) => e.stopPropagation()}>
          <VideoTimelineEditor
            entry={entry}
            token={token}
            onBack={() => setShowVideoTimeline(false)}
            onApply={(file) => { setShowVideoTimeline(false); onApply(file); }}
            onApplyMusic={onApplyMusic}
            onRemoveMusic={onRemoveMusic}
          />
        </div>
      </div>
    );
  }

  return (
    <main className="s2-media-editor-page" aria-label={`Edit ${entry.name}`}>
      <header className="s2-editor-topbar">
        <button type="button" className="s2-editor-back" disabled={busy} onClick={onClose}>← <span>Media</span></button>
        <div className="s2-editor-heading"><h1>{isVideo ? 'Video editor' : 'Image editor'}</h1><p title={entry.name}>{entry.name} <span>·</span> {isVideo ? 'Transform and design your video' : 'Transform and design your image'}</p></div>
        <button type="button" className="s2-editor-export" disabled={busy || !ready} onClick={done}>{busy ? (busyText || 'Preparing…') : 'Save edited media'}</button>
      </header>
      <div className="s2-editor" role="region" aria-label="Media editing workspace">
        <div className="s2-ed-cols">
          <section className="s2-editor-canvas-column" aria-label="Editing preview">
            <div className="s2-editor-canvas-toolbar"><span><i /> LIVE PREVIEW</span><small>Drag text and shapes to position</small></div>
            <div className="crop-stage s2-editor-crop-stage">
            <div className="crop-wrap" ref={wrapRef} onPointerDown={free ? startDraw : undefined}>
              {preview
                ? <img src={preview} alt="Edit preview" draggable={false} onError={() => isVideo && setPreview('')} />
                : isVideo
                  ? <video className="s2-editor-video-fallback" src={url} autoPlay muted loop playsInline aria-label="Live video preview" />
                  : <span style={{ color: '#888', fontSize: 13 }}>Loading image…</span>}
              {!free && renderOverlayLayer()}
              {free && box && (
                <div
                  className="crop-box"
                  style={{ left: `${box.fx * 100}%`, top: `${box.fy * 100}%`, width: `${box.fw * 100}%`, height: `${box.fh * 100}%` }}
                  onPointerDown={(e) => onPointerDown(e, 'move')}
                >
                  {renderOverlayLayer()}
                  {['nw', 'ne', 'sw', 'se'].map((h) => (
                    <span key={h} className={`crop-handle ${h}`} onPointerDown={(e) => onPointerDown(e, h)} />
                  ))}
                </div>
              )}
              {free && (
                <p className="crop-hint">Drag to set crop · move the frame · drag overlays to position</p>
              )}
            </div>
            </div>
            <div className="s2-editor-canvas-footer"><span>OUTPUT <b>{outputDims() ? `${outputDims().w} × ${outputDims().h}` : '—'}</b></span><span>{overlays.length} design element{overlays.length === 1 ? '' : 's'}</span></div>
          </section>
          <div className="s2-editor-sidebar">
            <div className="s2-pills" role="group" aria-label="Aspect ratio">
              {Object.keys(RATIOS).map((id) => (
                <button key={id} type="button" className={aspect === id ? 's2-pill on' : 's2-pill'} onClick={() => pickAspect(id)}>{id}</button>
              ))}
            </div>
            {fitNote && <p className="s2-note">{fitNote}</p>}
            <div className="s2-mode" role="group" aria-label="Fit or crop">
              <button type="button" className={pad ? 'on' : ''} onClick={() => setMode(false)}>Fit · keep everything</button>
              <button type="button" className={!pad ? 'on' : ''} onClick={() => setMode(true)}>Crop · customize frame</button>
            </div>
            <div className="s2-ed-btns">
              <button type="button" onClick={() => rotateTo((rot + 3) % 4)}>Rotate left</button>
              <button type="button" onClick={() => rotateTo((rot + 1) % 4)}>Rotate right</button>
              <button type="button" className={flipV ? 'on' : ''} onClick={() => setFlipV((v) => !v)}>Flip vertical</button>
              <button type="button" className={flipH ? 'on' : ''} onClick={() => setFlipH((v) => !v)}>Flip horizontal</button>
            </div>
            <section className="s2-design-tools">
              <div className="s2-tool-heading"><span>02</span><div><h2>Design</h2><small>Titles and graphic accents</small></div></div>
              <label className="s2-design-label" htmlFor="s2-overlay-copy">Text</label>
              <textarea id="s2-overlay-copy" className="s2-design-text" value={overlayText} onChange={(event) => setOverlayText(event.target.value)} placeholder="Type your text…" rows={2} />
              <button type="button" className="s2-add-text" onClick={() => addOverlay('text')}>＋ Add text</button>
              <span className="s2-design-label">Shapes</span>
              <div className="s2-shape-tools">
                <button type="button" onClick={() => addOverlay('rect')}><i className="rect-icon" /> Rectangle</button>
                <button type="button" onClick={() => addOverlay('circle')}><i className="circle-icon" /> Circle</button>
              </div>
              {selectedOverlayItem && <div className="s2-overlay-properties">
                <div className="s2-overlay-properties-head"><b>{selectedOverlayItem.kind === 'text' ? 'Text style' : `${selectedOverlayItem.kind} style`}</b><button type="button" onClick={removeSelectedOverlay}>Delete</button></div>
                <div className="s2-style-row">
                  <button type="button" disabled={busy} onClick={duplicateOverlay}>Duplicate</button>
                  <button type="button" disabled={busy} onClick={() => reorderOverlay(true)}>To front</button>
                  <button type="button" disabled={busy} onClick={() => reorderOverlay(false)}>To back</button>
                </div>
                <div className="s2-element-geometry">
                  {[['x', 'X position'], ['y', 'Y position'], ['w', 'Width'], ['h', 'Height']].map(([key, label]) => (
                    <label key={key}>{label} %
                      <input type="number" min={key === 'w' || key === 'h' ? 1 : 0} max="100" step="0.1"
                        disabled={busy} value={Math.round(selectedOverlayItem[key] * 1000) / 10}
                        onChange={(event) => setOverlayDimension(key, event.target.valueAsNumber)} />
                    </label>
                  ))}
                </div>
                <small className="s2-element-hint">Drag handles to resize. Arrow keys move; Shift + arrows move faster.</small>
                {selectedOverlayItem.kind === 'text' && <>
                  <label className="s2-design-label" htmlFor="s2-selected-text">Content</label>
                  <textarea id="s2-selected-text" className="s2-design-text" value={selectedOverlayItem.text} onChange={(event) => updateSelectedOverlay({ text: event.target.value })} rows={2} />
                  <label className="s2-design-label">Font family</label>
                  <select value={selectedOverlayItem.font} onChange={(event) => updateSelectedOverlay({ font: event.target.value })}>{['Arial', 'Georgia', 'Impact', 'Trebuchet MS', 'Courier New', 'Palatino Linotype'].map((font) => <option key={font} value={font}>{font}</option>)}</select>
                  <label className="s2-design-label">Size · {selectedOverlayItem.size}%</label>
                  <input type="range" min="3" max="16" step="0.5" value={selectedOverlayItem.size} onChange={(event) => updateSelectedOverlay({ size: Number(event.target.value) })} />
                  <div className="s2-style-row"><button type="button" className={selectedOverlayItem.bold ? 'on' : ''} onClick={() => updateSelectedOverlay({ bold: !selectedOverlayItem.bold })}><b>B</b> Bold</button><select aria-label="Text alignment" value={selectedOverlayItem.align} onChange={(event) => updateSelectedOverlay({ align: event.target.value })}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></div>
                  <label className="s2-design-label">Text color</label><input type="color" value={selectedOverlayItem.color} onChange={(event) => updateSelectedOverlay({ color: event.target.value })} />
                </>}
                {selectedOverlayItem.kind !== 'text' && <>
                  <label className="s2-design-label">Fill color</label>
                  <div className="s2-style-row"><input type="color" value={selectedOverlayItem.fill === 'transparent' ? '#61c7a7' : selectedOverlayItem.fill} onChange={(event) => updateSelectedOverlay({ fill: event.target.value })} /><button type="button" onClick={() => updateSelectedOverlay({ fill: 'transparent' })}>No fill</button></div>
                  <label className="s2-design-label">Outline</label>
                  <div className="s2-style-row"><input type="color" value={selectedOverlayItem.stroke} onChange={(event) => updateSelectedOverlay({ stroke: event.target.value })} /><input type="range" min="0" max="2" step="0.25" value={selectedOverlayItem.strokeWidth} onChange={(event) => updateSelectedOverlay({ strokeWidth: Number(event.target.value) })} /></div>
                </>}
              </div>}
            </section>
            {outputDims() && (
              <p className="s3-xcount" style={{ marginTop: 0, marginBottom: 10 }}>
                Output: <b style={{ color: 'var(--ink)' }}>{outputDims().w} × {outputDims().h}px</b>
                {RATIOS[aspect] ? ` · ${aspect}` : pad ? ' · original size' : ' · custom crop'}
              </p>
            )}
            <button type="button" className="s2-done" disabled={busy || !ready} onClick={done}>
              {busy ? (busyText || 'Saving…') : isVideo ? 'Done editing (render video)' : 'Done editing'}
            </button>
            {isVideo && <button type="button" className="s2-editor-music" disabled={busy} onClick={() => setShowVideoTimeline(true)}>Edit video</button>}
            <button type="button" className="s2-cancel" onClick={onClose}>Cancel</button>
          </div>
        </div>
        {!isVideo && onApplyMusic && <div className="s2-editor-music-catalog s2-image-editor-music">
          <h3>Add music to this image</h3>
          <p>Choose a track and duration. Driftpost creates a short MP4 from your photo so it can play with music.</p>
          <EpidemicCatalog
            token={token}
            files={[entry]}
            selectedIndex={0}
            onSelectVideo={() => {}}
            summaryLabel="Browse music"
            onApply={async (_index, file, track) => {
              await onApplyMusic(file, track);
              onClose();
            }}
          />
        </div>}
      </div>
    </main>
  );
}
