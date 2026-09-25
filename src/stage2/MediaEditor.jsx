import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// Crop + resize only (per wireframe): aspect pills, rotate, flip,
// free-crop box, done. Exports an HD JPEG via canvas.
const RATIOS = { Original: null, '4:5': 4 / 5, '1:1': 1, '16:9': 16 / 9, '9:16': 9 / 16 };

function fitBox(nw, nh, ratio) {
  if (!ratio) return { fx: 0.04, fy: 0.04, fw: 0.92, fh: 0.92 };
  let fh = 0.92;
  let fw = fh * (nh / nw) * ratio;
  if (fw > 0.92) { fw = 0.92; fh = fw * (nw / nh) / ratio; }
  return { fx: (1 - fw) / 2, fy: (1 - fh) / 2, fw, fh };
}

export default function MediaEditor({ entry, onClose, onApply }) {
  const [bmp, setBmp] = useState(null);
  const [rot, setRot] = useState(0); // quarter turns clockwise
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [aspect, setAspect] = useState('Original');
  const [free, setFree] = useState(false);
  const [box, setBox] = useState(null);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const normRef = useRef(null);
  const wrapRef = useRef(null);
  const dragRef = useRef(null);
  const url = useMemo(() => URL.createObjectURL(entry.raw), [entry]);

  useEffect(() => () => { try { URL.revokeObjectURL(url); } catch {} }, [url]);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const b = await createImageBitmap(entry.raw);
        if (live) setBmp(b);
      } catch {
        // Fallback for exotic formats: rasterize via <img> first.
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
  }, [entry]);
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  // Normalized bitmap: rotation + flip baked in.
  useEffect(() => {
    if (!bmp) return;
    const swap = rot % 2 === 1;
    const c = document.createElement('canvas');
    c.width = swap ? bmp.height : bmp.width;
    c.height = swap ? bmp.width : bmp.height;
    const ctx = c.getContext('2d');
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate((rot * Math.PI) / 2);
    ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
    ctx.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
    normRef.current = c;
    c.toBlob((blob) => {
      if (!blob) return;
      setPreview((old) => { try { if (old) URL.revokeObjectURL(old); } catch {} return URL.createObjectURL(blob); });
    }, 'image/jpeg', 0.85);
  }, [bmp, rot, flipH, flipV]);

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
    const dx = (e.clientX - d.x0) / r.width;
    const dy = (e.clientY - d.y0) / r.height;
    const c = normRef.current;
    const ratio = RATIOS[aspect];
    const MIN = 0.05;
    let { fx, fy, fw, fh } = d.box;
    const clampBox = (b) => {
      b.fw = Math.min(1, Math.max(MIN, b.fw));
      b.fh = Math.min(1, Math.max(MIN, b.fh));
      b.fx = Math.min(1 - b.fw, Math.max(0, b.fx));
      b.fy = Math.min(1 - b.fh, Math.max(0, b.fy));
      return b;
    };
    if (d.mode === 'move') {
      setBox(clampBox({ fx: d.box.fx + dx, fy: d.box.fy + dy, fw, fh }));
      return;
    }
    // corner resize
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

  const done = () => {
    const c = normRef.current;
    if (!c || busy) return;
    setBusy(true);
    try {
      const b = free && box ? box : { fx: 0, fy: 0, fw: 1, fh: 1 };
      const sx = Math.round(b.fx * c.width);
      const sy = Math.round(b.fy * c.height);
      const sw = Math.max(1, Math.round(b.fw * c.width));
      const sh = Math.max(1, Math.round(b.fh * c.height));
      // HD floor: scale up so the long edge is at least 1080px.
      const scale = Math.max(1, 1080 / Math.max(sw, sh));
      const out = document.createElement('canvas');
      out.width = Math.round(sw * scale);
      out.height = Math.round(sh * scale);
      out.getContext('2d').drawImage(c, sx, sy, sw, sh, 0, 0, out.width, out.height);
      out.toBlob((blob) => {
        setBusy(false);
        if (!blob) return;
        const name = String(entry.name || 'photo').replace(/\.[a-z]+$/i, '') + '-edited.jpg';
        onApply(new File([blob], name, { type: 'image/jpeg' }));
      }, 'image/jpeg', 0.92);
    } catch { setBusy(false); }
  };

  return (
    <div className="s2-overlay" onClick={onClose}>
      <div className="s2-editor" role="dialog" aria-modal="true" aria-label={`Edit ${entry.name}`} onClick={(e) => e.stopPropagation()}>
        <h2>Edit media</h2>
        <p className="sub">{entry.name} · crop + resize only, HD output</p>
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
            <button type="button" className="s2-done" disabled={busy || !bmp} onClick={done}>
              {busy ? 'Saving…' : 'Done editing'}
            </button>
            <button type="button" className="s2-cancel" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
