import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import EpidemicCatalog from '../music/EpidemicCatalog.jsx';
import VideoTimelineEditor from './VideoTimelineEditor.jsx';
import DriftIcon from '../components/DriftIcons.jsx';

const RATIOS = [
  ['Free', 0, 'Custom crop'],
  ['Original', -1, 'Source ratio'],
  ['9:16', 9 / 16, 'Reels · Shorts'],
  ['4:5', 4 / 5, 'IG Portrait'],
  ['1:1', 1, 'Square'],
  ['16:9', 16 / 9, 'YouTube · Wide'],
  ['3:4', 3 / 4, 'Portrait'],
  ['4:3', 4 / 3, 'Standard'],
  ['3:2', 3 / 2, 'Photo'],
  ['2:3', 2 / 3, 'Tall Photo'],
];

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

const FONTS = [
  ['Plus Jakarta Sans', 'Jakarta Sans'],
  ['Space Grotesk', 'Space Grotesk'],
  ['Georgia', 'Georgia Serif'],
  ['Impact', 'Impact Display'],
  ['Arial Black', 'Heavy Sans'],
  ['Courier New', 'Monospace'],
];

const SWATCHES = [
  '#ffffff', '#000000', '#7dd3fc', '#38bdf8', '#f43f5e',
  '#f59e0b', '#10b981', '#a855f7', '#fde047', '#1e293b',
];

const FILTER_PRESETS = [
  { id: 'none', name: 'Original', brightness: 0, contrast: 0, saturation: 0, warmth: 0, fade: 0, vignette: 0 },
  { id: 'vivid', name: 'Vivid', brightness: 4, contrast: 18, saturation: 28, warmth: 4, fade: 0, vignette: 0 },
  { id: 'warm', name: 'Warm Glow', brightness: 5, contrast: 8, saturation: 14, warmth: 28, fade: 4, vignette: 10 },
  { id: 'cool', name: 'Cool Cinema', brightness: -2, contrast: 16, saturation: -10, warmth: -26, fade: 6, vignette: 18 },
  { id: 'vintage', name: 'Vintage', brightness: 2, contrast: -8, saturation: -22, warmth: 22, fade: 24, vignette: 26 },
  { id: 'mono', name: 'Noir B&W', brightness: 2, contrast: 26, saturation: -100, warmth: 0, fade: 4, vignette: 22 },
  { id: 'fade', name: 'Soft Matte', brightness: 6, contrast: -12, saturation: -8, warmth: 6, fade: 32, vignette: 8 },
  { id: 'punch', name: 'High Punch', brightness: 0, contrast: 32, saturation: 20, warmth: 0, fade: 0, vignette: 15 },
  { id: 'golden', name: 'Golden Hour', brightness: 6, contrast: 12, saturation: 22, warmth: 38, fade: 6, vignette: 14 },
];

const DEFAULT_ADJUSTMENTS = {
  filterId: 'none',
  brightness: 0,
  contrast: 0,
  saturation: 0,
  warmth: 0,
  fade: 0,
  vignette: 0,
  blur: 0,
};

const FULL_BOX = { x: 0, y: 0, w: 100, h: 100 };
const MIN_CROP_SIZE = 8;
const MIN_OVERLAY_SIZE = 5;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function fmtTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const tenths = Math.floor((safe % 1) * 10);
  return `${mins}:${String(secs).padStart(2, '0')}.${tenths}`;
}

function recordingMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=avc1,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  return candidates.find((type) => !MediaRecorder.isTypeSupported || MediaRecorder.isTypeSupported(type)) || '';
}

function hexToRgba(hex, alpha = 1) {
  const clean = String(hex || '#000000').replace('#', '').trim();
  const full = clean.length === 3
    ? clean.split('').map((c) => c + c).join('')
    : clean.padEnd(6, '0').slice(0, 6);
  const num = parseInt(full, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`;
}

function rotatedBounds(w, h, deg = 0) {
  const rad = ((Number(deg) || 0) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  return {
    w: Math.max(1, Math.round(w * cos + h * sin)),
    h: Math.max(1, Math.round(w * sin + h * cos)),
  };
}

function centeredRatioBox(sw, sh, targetRatio) {
  if (!targetRatio || targetRatio <= 0 || !sw || !sh) return FULL_BOX;
  const srcRatio = sw / sh;
  if (Math.abs(srcRatio - targetRatio) < 0.005) return FULL_BOX;
  if (srcRatio > targetRatio) {
    const w = clamp(((sh * targetRatio) / sw) * 100, MIN_CROP_SIZE, 100);
    return { x: (100 - w) / 2, y: 0, w, h: 100 };
  }
  const h = clamp(((sw / targetRatio) / sh) * 100, MIN_CROP_SIZE, 100);
  return { x: 0, y: (100 - h) / 2, w: 100, h };
}

function resizeBox(start, dx, dy, mode, minSize = MIN_CROP_SIZE, lockedAspect = 0) {
  let { x, y, w, h } = start;
  if (mode === 'move') {
    return {
      x: clamp(x + dx, 0, 100 - w),
      y: clamp(y + dy, 0, 100 - h),
      w,
      h,
    };
  }
  const right = x + w;
  const bottom = y + h;
  if (mode.includes('w')) {
    x = clamp(x + dx, 0, right - minSize);
    w = right - x;
  }
  if (mode.includes('e')) {
    w = clamp(w + dx, minSize, 100 - x);
  }
  if (mode.includes('n')) {
    y = clamp(y + dy, 0, bottom - minSize);
    h = bottom - y;
  }
  if (mode.includes('s')) {
    h = clamp(h + dy, minSize, 100 - y);
  }

  // Enforce locked aspect ratio in percentage space when requested
  if (lockedAspect > 0) {
    if (mode === 'n' || mode === 's') {
      w = h * lockedAspect;
      x = clamp(start.x + (start.w - w) / 2, 0, 100 - w);
      if (x + w > 100) {
        w = 100 - x;
        h = w / lockedAspect;
      }
    } else {
      h = w / lockedAspect;
      if (mode.includes('n')) {
        y = bottom - h;
        if (y < 0) {
          y = 0;
          h = bottom;
          w = h * lockedAspect;
        }
      } else if (y + h > 100) {
        h = 100 - y;
        w = h * lockedAspect;
        if (mode.includes('w')) x = right - w;
      }
    }
  }
  return {
    x: clamp(x, 0, 100 - minSize),
    y: clamp(y, 0, 100 - minSize),
    w: clamp(w, minSize, 100),
    h: clamp(h, minSize, 100),
  };
}

function wrapCanvasText(ctx, text, maxWidth) {
  const paragraphs = String(text || '').split('\n');
  const lines = [];
  for (const rawLine of paragraphs) {
    const words = rawLine.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push('');
      continue;
    }
    let current = words[0];
    for (let i = 1; i < words.length; i++) {
      const candidate = `${current} ${words[i]}`;
      if (ctx.measureText(candidate).width <= maxWidth) {
        current = candidate;
      } else {
        lines.push(current);
        current = words[i];
      }
    }
    lines.push(current);
  }
  return lines.length ? lines : [''];
}

function drawRoundedRectPath(ctx, x, y, w, h, radius) {
  const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}

function drawStarPath(ctx, cx, cy, outerR, innerR, points = 5) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = (i * Math.PI) / points - Math.PI / 2;
    const px = cx + Math.cos(angle) * r;
    const py = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

export function paintOverlays(ctx, width, height, overlays) {
  if (!Array.isArray(overlays) || !overlays.length) return;
  const scaleFactor = Math.max(0.45, Math.min(width, height) / 720);

  for (const item of overlays) {
    if (!item || item.hidden) continue;
    const x = (item.x / 100) * width;
    const y = (item.y / 100) * height;
    const w = Math.max(16, (item.w / 100) * width);
    const h = Math.max(16, (item.h / 100) * height);
    const cx = x + w / 2;
    const cy = y + h / 2;

    ctx.save();
    ctx.globalAlpha = clamp(Number(item.opacity ?? 1), 0.05, 1);
    if (item.rotation) {
      ctx.translate(cx, cy);
      ctx.rotate((Number(item.rotation) * Math.PI) / 180);
      ctx.translate(-cx, -cy);
    }

    if (item.kind === 'shape') {
      const strokePx = Math.max(0, Number(item.strokeWidth ?? 4) * scaleFactor);
      const hasFill = item.fillEnabled !== false;
      const fillAlpha = clamp(Number(item.fillOpacity ?? 0.35), 0, 1);
      ctx.fillStyle = hexToRgba(item.fill || '#7dd3fc', fillAlpha);
      ctx.strokeStyle = item.color || '#ffffff';
      ctx.lineWidth = strokePx;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (item.shadow) {
        ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
        ctx.shadowBlur = 14 * scaleFactor;
        ctx.shadowOffsetY = 4 * scaleFactor;
      }

      if (item.shape === 'circle') {
        ctx.beginPath();
        ctx.ellipse(cx, cy, Math.max(4, (w - strokePx) / 2), Math.max(4, (h - strokePx) / 2), 0, 0, Math.PI * 2);
        if (hasFill) ctx.fill();
        if (strokePx > 0) ctx.stroke();
      } else if (item.shape === 'star') {
        const outer = Math.max(8, Math.min(w, h) / 2 - strokePx);
        drawStarPath(ctx, cx, cy, outer, outer * 0.46, 5);
        if (hasFill) ctx.fill();
        if (strokePx > 0) ctx.stroke();
      } else if (item.shape === 'line') {
        ctx.beginPath();
        ctx.moveTo(x + strokePx, cy);
        ctx.lineTo(x + w - strokePx, cy);
        ctx.lineWidth = Math.max(3 * scaleFactor, strokePx);
        ctx.stroke();
      } else if (item.shape === 'arrow') {
        const lw = Math.max(3 * scaleFactor, strokePx);
        const head = Math.max(12 * scaleFactor, lw * 3.2);
        const endX = x + w - strokePx;
        ctx.beginPath();
        ctx.moveTo(x + strokePx, cy);
        ctx.lineTo(endX - head * 0.3, cy);
        ctx.lineWidth = lw;
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(endX, cy);
        ctx.lineTo(endX - head, cy - head * 0.65);
        ctx.lineTo(endX - head, cy + head * 0.65);
        ctx.closePath();
        ctx.fillStyle = item.color || '#ffffff';
        ctx.fill();
      } else {
        const radius = item.shape === 'roundRect'
          ? Math.max(16 * scaleFactor, Math.min(w, h) * 0.22)
          : Math.max(0, Number(item.radius ?? 0) * scaleFactor);
        drawRoundedRectPath(
          ctx,
          x + strokePx / 2,
          y + strokePx / 2,
          Math.max(4, w - strokePx),
          Math.max(4, h - strokePx),
          radius
        );
        if (hasFill) ctx.fill();
        if (strokePx > 0) ctx.stroke();
      }
      ctx.restore();
      continue;
    }

    // Text overlay rendering
    const rawText = item.uppercase ? String(item.text || '').toUpperCase() : String(item.text || '');
    const fontPx = Math.max(12, Math.round((Number(item.size) || 34) * scaleFactor));
    const weight = item.bold !== false ? 800 : 500;
    const italic = item.italic ? 'italic ' : '';
    const family = item.font || 'Plus Jakarta Sans';
    ctx.font = `${italic}${weight} ${fontPx}px "${family}", sans-serif`;
    ctx.textBaseline = 'top';
    const align = item.align || 'center';
    ctx.textAlign = align;

    const padX = Math.round(14 * scaleFactor);
    const padY = Math.round(10 * scaleFactor);
    const lines = wrapCanvasText(ctx, rawText, Math.max(24, w - padX * 2));
    const lineHeight = Math.round(fontPx * 1.2);
    const totalTextH = lines.length * lineHeight;
    const startY = y + Math.max(padY / 2, (h - totalTextH) / 2);

    // Optional background pill/box behind text
    if (item.bgEnabled) {
      let maxLineW = 0;
      for (const l of lines) {
        maxLineW = Math.max(maxLineW, ctx.measureText(l).width);
      }
      const boxW = Math.min(w, Math.max(fontPx * 1.5, maxLineW + padX * 2.2));
      const boxH = Math.max(fontPx + padY, totalTextH + padY * 1.6);
      const boxX = align === 'left' ? x : align === 'right' ? x + w - boxW : cx - boxW / 2;
      const boxY = startY - padY * 0.8;
      const radius = Math.round(Number(item.bgRadius ?? 12) * scaleFactor);
      ctx.save();
      if (item.shadow !== false) {
        ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
        ctx.shadowBlur = 14 * scaleFactor;
        ctx.shadowOffsetY = 4 * scaleFactor;
      }
      ctx.fillStyle = hexToRgba(item.bgColor || '#000000', Number(item.bgOpacity ?? 0.72));
      drawRoundedRectPath(ctx, boxX, boxY, boxW, boxH, radius);
      ctx.fill();
      ctx.restore();
    }

    if (item.shadow !== false) {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
      ctx.shadowBlur = Math.max(4, Math.round(fontPx * 0.18));
      ctx.shadowOffsetY = Math.max(2, Math.round(fontPx * 0.06));
    }

    const strokeW = Number(item.strokeWidth ?? 0) * scaleFactor;
    if (strokeW > 0) {
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.lineWidth = strokeW;
      ctx.strokeStyle = item.strokeColor || '#000000';
    }
    ctx.fillStyle = item.color || '#ffffff';

    const textAnchorX = align === 'left' ? x + padX : align === 'right' ? x + w - padX : cx;
    lines.forEach((line, idx) => {
      const ly = startY + idx * lineHeight;
      if (strokeW > 0) ctx.strokeText(line, textAnchorX, ly);
      ctx.fillText(line, textAnchorX, ly);
    });

    ctx.restore();
  }
}

function buildCssFilter(adj) {
  if (!adj) return 'none';
  const b = Math.max(0, 100 + Number(adj.brightness || 0) + Number(adj.fade || 0) * 0.18);
  const c = Math.max(0, 100 + Number(adj.contrast || 0) - Number(adj.fade || 0) * 0.35);
  const s = Math.max(0, 100 + Number(adj.saturation || 0));
  const blur = Math.max(0, Number(adj.blur || 0));
  const parts = [];
  if (Math.abs(b - 100) > 0.2) parts.push(`brightness(${b.toFixed(1)}%)`);
  if (Math.abs(c - 100) > 0.2) parts.push(`contrast(${c.toFixed(1)}%)`);
  if (Math.abs(s - 100) > 0.2) parts.push(`saturate(${s.toFixed(1)}%)`);
  if (blur > 0.1) parts.push(`blur(${blur.toFixed(1)}px)`);
  return parts.length ? parts.join(' ') : 'none';
}

function paintColorGradingOverlays(ctx, w, h, adj) {
  if (!adj) return;
  const warmth = Number(adj.warmth || 0);
  const fade = Number(adj.fade || 0);
  const vignette = Number(adj.vignette || 0);

  if (Math.abs(warmth) > 0.5) {
    ctx.save();
    ctx.globalCompositeOperation = 'soft-light';
    const alpha = Math.min(0.42, Math.abs(warmth) / 220);
    ctx.fillStyle = warmth > 0 ? `rgba(255, 148, 42, ${alpha})` : `rgba(56, 152, 255, ${alpha})`;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  if (fade > 0.5) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const alpha = Math.min(0.28, fade / 340);
    ctx.fillStyle = `rgba(34, 38, 48, ${alpha})`;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  if (vignette > 0.5) {
    ctx.save();
    const radius = Math.hypot(w, h) * 0.55;
    const grad = ctx.createRadialGradient(w / 2, h / 2, radius * 0.32, w / 2, h / 2, radius);
    const alpha = Math.min(0.82, vignette / 115);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
    grad.addColorStop(1, `rgba(0, 0, 0, ${alpha})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
}

export default function MediaEditor({
  entry,
  files,
  startIndex = 0,
  token,
  session,
  onApply,
  onReplace,
  onApplyMusic,
  onRemoveMusic,
  onClose,
}) {
  const mediaList = useMemo(() => {
    if (Array.isArray(files) && files.length) return files;
    return entry ? [entry] : [];
  }, [entry, files]);
  const [idx, setIdx] = useState(startIndex);
  const file = mediaList[idx] || mediaList[0] || entry;
  const authToken = token || session?.access_token || '';
  const isVideo = Boolean(file?.type?.startsWith('video/') || file?.raw?.type?.startsWith('video/'));

  // Studio tabs: 'crop' | 'adjust' | 'design' | 'audio'
  const [activeTab, setActiveTab] = useState('crop');
  const [timelineEditorOpen, setTimelineEditorOpen] = useState(false);

  // Framing & Transform state
  const [ratio, setRatio] = useState('Original');
  const [pad, setPad] = useState(false); // false = Crop, true = Fit with backdrop
  const [backdropMode, setBackdropMode] = useState('blur'); // 'blur' | 'dark' | 'black' | 'white' | 'custom'
  const [backdropColor, setBackdropColor] = useState('#0b1320');
  const [rot, setRot] = useState(0);
  const [straighten, setStraighten] = useState(0);
  const [flipX, setFlipX] = useState(false);
  const [flipY, setFlipY] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [box, setBox] = useState(FULL_BOX);

  // Color & Filter Adjustments
  const [adjustments, setAdjustments] = useState(DEFAULT_ADJUSTMENTS);

  // Overlays (Text & Shapes)
  const [overlays, setOverlays] = useState([]);
  const [activeOverlayId, setActiveOverlayId] = useState('');

  // Video Playback & Inline Trim state
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoTime, setVideoTime] = useState(0);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [videoVolume, setVideoVolume] = useState(100);
  const [videoMuted, setVideoMuted] = useState(false);
  const [videoSpeed, setVideoSpeed] = useState(1);

  // View controls & History
  const [canvasZoom, setCanvasZoom] = useState(100);
  const [comparing, setComparing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savePct, setSavePct] = useState(0);
  const [saveError, setSaveError] = useState('');

  // Undo / Redo History
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const suppressHistoryRef = useRef(false);

  // Loaded media source refs
  const [naturalSize, setNaturalSize] = useState({ w: 1080, h: 1080 });
  const [mediaLoaded, setMediaLoaded] = useState(false);
  const imageSourceRef = useRef(null);
  const videoSourceRef = useRef(null);
  const transformedCanvasRef = useRef(null);
  const previewCanvasRef = useRef(null);
  const stageContainerRef = useRef(null);
  const textInputRef = useRef(null);

  // Drag state refs
  const cropDragRef = useRef(null);
  const overlayDragRef = useRef(null);

  const mediaUrl = useMemo(() => (file?.raw ? URL.createObjectURL(file.raw) : ''), [file]);
  useEffect(() => () => { if (mediaUrl) URL.revokeObjectURL(mediaUrl); }, [mediaUrl]);

  // Snapshot current state for Undo/Redo
  const createSnapshot = useCallback(() => ({
    ratio,
    pad,
    backdropMode,
    backdropColor,
    rot,
    straighten,
    flipX,
    flipY,
    zoom,
    box: { ...box },
    adjustments: { ...adjustments },
    overlays: overlays.map((o) => ({ ...o })),
    trimStart,
    trimEnd,
    videoVolume,
    videoMuted,
    videoSpeed,
  }), [
    ratio, pad, backdropMode, backdropColor, rot, straighten, flipX, flipY, zoom,
    box, adjustments, overlays, trimStart, trimEnd, videoVolume, videoMuted, videoSpeed,
  ]);

  const applySnapshot = useCallback((snap) => {
    if (!snap) return;
    suppressHistoryRef.current = true;
    setRatio(snap.ratio);
    setPad(snap.pad);
    setBackdropMode(snap.backdropMode);
    setBackdropColor(snap.backdropColor);
    setRot(snap.rot);
    setStraighten(snap.straighten);
    setFlipX(snap.flipX);
    setFlipY(snap.flipY);
    setZoom(snap.zoom);
    setBox({ ...snap.box });
    setAdjustments({ ...snap.adjustments });
    setOverlays(snap.overlays.map((o) => ({ ...o })));
    setTrimStart(snap.trimStart);
    setTrimEnd(snap.trimEnd);
    setVideoVolume(snap.videoVolume);
    setVideoMuted(snap.videoMuted);
    setVideoSpeed(snap.videoSpeed);
  }, []);

  // Push debounced history checkpoints whenever edits change
  useEffect(() => {
    if (!mediaLoaded) return undefined;
    if (suppressHistoryRef.current) {
      suppressHistoryRef.current = false;
      return undefined;
    }
    const timer = window.setTimeout(() => {
      const snap = createSnapshot();
      setHistory((prev) => {
        const sliced = prev.slice(0, historyIndex + 1);
        const last = sliced[sliced.length - 1];
        if (last && JSON.stringify(last) === JSON.stringify(snap)) return prev;
        const next = [...sliced.slice(-29), snap];
        setHistoryIndex(next.length - 1);
        return next;
      });
    }, 220);
    return () => window.clearTimeout(timer);
  }, [createSnapshot, mediaLoaded, historyIndex]);

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex >= 0 && historyIndex < history.length - 1;

  const undo = useCallback(() => {
    if (!canUndo) return;
    const nextIdx = historyIndex - 1;
    setHistoryIndex(nextIdx);
    applySnapshot(history[nextIdx]);
  }, [canUndo, history, historyIndex, applySnapshot]);

  const redo = useCallback(() => {
    if (!canRedo) return;
    const nextIdx = historyIndex + 1;
    setHistoryIndex(nextIdx);
    applySnapshot(history[nextIdx]);
  }, [canRedo, history, historyIndex, applySnapshot]);

  // Reset editor state when switching media files
  useEffect(() => {
    setMediaLoaded(false);
    setRatio('Original');
    setPad(false);
    setBackdropMode('blur');
    setBackdropColor('#0b1320');
    setRot(0);
    setStraighten(0);
    setFlipX(false);
    setFlipY(false);
    setZoom(1);
    setBox(FULL_BOX);
    setAdjustments(DEFAULT_ADJUSTMENTS);
    setOverlays([]);
    setActiveOverlayId('');
    setTimelineEditorOpen(false);
    setSaveError('');
    setHistory([]);
    setHistoryIndex(-1);
    setVideoPlaying(false);
    setVideoTime(0);
    setVideoDuration(0);
    setTrimStart(0);
    setTrimEnd(0);
    setVideoVolume(100);
    setVideoMuted(false);
    setVideoSpeed(1);

    if (!file?.raw || !mediaUrl) return undefined;

    let cancelled = false;
    if (!isVideo) {
      const img = new Image();
      img.onload = () => {
        if (cancelled) return;
        imageSourceRef.current = img;
        setNaturalSize({ w: img.naturalWidth || 1080, h: img.naturalHeight || 1080 });
        setMediaLoaded(true);
      };
      img.onerror = () => {
        if (!cancelled) setSaveError('Could not load this image for editing.');
      };
      img.src = mediaUrl;
      return () => { cancelled = true; };
    }
    return undefined;
  }, [file, isVideo, mediaUrl]);

  // Sync video volume, mute, and playback rate
  useEffect(() => {
    const v = videoSourceRef.current;
    if (!v) return;
    v.muted = videoMuted;
    v.volume = clamp(videoVolume / 100, 0, 1);
    v.playbackRate = videoSpeed;
  }, [videoMuted, videoVolume, videoSpeed]);

  // Compute rotated source dimensions
  const totalAngle = rot + straighten;
  const transformedSize = useMemo(
    () => rotatedBounds(naturalSize.w, naturalSize.h, totalAngle),
    [naturalSize.w, naturalSize.h, totalAngle]
  );

  // Target aspect ratio value (0 = Free, -1 = Original)
  const ratioEntry = RATIOS.find(([label]) => label === ratio) || RATIOS[1];
  const targetRatioValue = useMemo(() => {
    const raw = ratioEntry[1];
    if (raw === -1) return transformedSize.w / Math.max(1, transformedSize.h);
    return raw;
  }, [ratioEntry, transformedSize.w, transformedSize.h]);

  // Apply an aspect ratio preset
  const selectRatio = (nextLabel) => {
    setRatio(nextLabel);
    const found = RATIOS.find(([label]) => label === nextLabel);
    const val = found ? found[1] : 0;
    const effective = val === -1 ? transformedSize.w / Math.max(1, transformedSize.h) : val;
    if (pad) {
      setBox(FULL_BOX);
    } else if (effective > 0) {
      setBox(centeredRatioBox(transformedSize.w, transformedSize.h, effective));
    } else {
      setBox({ x: 8, y: 8, w: 84, h: 84 });
    }
  };

  // Switch between Crop and Fit modes
  const selectFramingMode = (nextPad) => {
    setPad(nextPad);
    if (nextPad) {
      if (ratio === 'Free') setRatio('4:5');
      setBox(FULL_BOX);
    } else if (targetRatioValue > 0) {
      setBox(centeredRatioBox(transformedSize.w, transformedSize.h, targetRatioValue));
    }
  };

  // Recompute ratio-locked crop box if user rotates by 90 deg
  const rotateBy = (delta) => {
    const nextRot = (rot + delta + 360) % 360;
    setRot(nextRot);
    const nextBounds = rotatedBounds(naturalSize.w, naturalSize.h, nextRot + straighten);
    const raw = ratioEntry[1];
    const eff = raw === -1 ? nextBounds.w / Math.max(1, nextBounds.h) : raw;
    if (!pad && eff > 0) {
      setBox(centeredRatioBox(nextBounds.w, nextBounds.h, eff));
    }
  };

  // Output pixel dimensions (full resolution for export, scaled for preview)
  const outputDimensions = useMemo(() => {
    const sw = transformedSize.w;
    const sh = transformedSize.h;
    if (pad && targetRatioValue > 0) {
      const sr = sw / Math.max(1, sh);
      const outW = sr > targetRatioValue ? sw : Math.round(sh * targetRatioValue);
      const outH = sr > targetRatioValue ? Math.round(sw / targetRatioValue) : sh;
      return { w: Math.max(2, outW), h: Math.max(2, outH) };
    }
    const cropW = Math.max(2, Math.round((box.w / 100) * sw));
    const cropH = Math.max(2, Math.round((box.h / 100) * sh));
    return { w: cropW, h: cropH };
  }, [transformedSize.w, transformedSize.h, pad, targetRatioValue, box.w, box.h]);

  // Whether the canvas is currently showing the uncropped source with the interactive crop box overlay
  const isInteractiveCropView = activeTab === 'crop' && !pad && !comparing;

  // Render transformed source frame into an offscreen helper canvas
  const renderTransformedSource = useCallback((sourceEl, maxEdge = 1280) => {
    const sw = naturalSize.w || 1080;
    const sh = naturalSize.h || 1080;
    const bounds = rotatedBounds(sw, sh, comparing ? 0 : totalAngle);
    const scale = Math.min(1, maxEdge / Math.max(bounds.w, bounds.h, 1));
    const cw = Math.max(2, Math.round(bounds.w * scale));
    const ch = Math.max(2, Math.round(bounds.h * scale));

    if (!transformedCanvasRef.current) {
      transformedCanvasRef.current = document.createElement('canvas');
    }
    const canvas = transformedCanvasRef.current;
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;

    ctx.save();
    ctx.clearRect(0, 0, cw, ch);
    ctx.filter = comparing ? 'none' : buildCssFilter(adjustments);
    ctx.translate(cw / 2, ch / 2);
    if (!comparing) {
      if (totalAngle) ctx.rotate((totalAngle * Math.PI) / 180);
      const z = Math.max(1, Number(zoom) || 1);
      ctx.scale((flipX ? -1 : 1) * z, (flipY ? -1 : 1) * z);
    }
    const drawW = sw * scale;
    const drawH = sh * scale;
    ctx.drawImage(sourceEl, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();

    if (!comparing) {
      paintColorGradingOverlays(ctx, cw, ch, adjustments);
    }
    return canvas;
  }, [naturalSize.w, naturalSize.h, comparing, totalAngle, adjustments, zoom, flipX, flipY]);

  // Paint the live preview canvas
  const paintPreviewCanvas = useCallback(() => {
    const canvas = previewCanvasRef.current;
    const sourceEl = isVideo ? videoSourceRef.current : imageSourceRef.current;
    if (!canvas || !sourceEl || !mediaLoaded) return;
    if (isVideo && sourceEl.readyState < 2) return;

    const transformed = renderTransformedSource(sourceEl, 1280);
    const tw = transformed.width;
    const th = transformed.height;

    const previewMaxEdge = 960;
    if (isInteractiveCropView) {
      // Show full transformed source so user can see and drag the crop box across the entire frame
      const scale = Math.min(1, previewMaxEdge / Math.max(tw, th, 1));
      const pw = Math.max(2, Math.round(tw * scale));
      const ph = Math.max(2, Math.round(th * scale));
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, pw, ph);
      ctx.drawImage(transformed, 0, 0, pw, ph);
      return;
    }

    // Otherwise render the true cropped or fitted output frame + overlays
    if (pad && targetRatioValue > 0 && !comparing) {
      const sr = tw / Math.max(1, th);
      const fullW = sr > targetRatioValue ? tw : Math.round(th * targetRatioValue);
      const fullH = sr > targetRatioValue ? Math.round(tw / targetRatioValue) : th;
      const scale = Math.min(1, previewMaxEdge / Math.max(fullW, fullH, 1));
      const pw = Math.max(2, Math.round(fullW * scale));
      const ph = Math.max(2, Math.round(fullH * scale));
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, pw, ph);

      // Draw Fit backdrop
      if (backdropMode === 'blur') {
        ctx.save();
        ctx.filter = 'blur(26px) brightness(0.62)';
        const coverScale = Math.max(pw / tw, ph / th) * 1.12;
        const bw = tw * coverScale;
        const bh = th * coverScale;
        ctx.drawImage(transformed, (pw - bw) / 2, (ph - bh) / 2, bw, bh);
        ctx.restore();
      } else {
        ctx.fillStyle = backdropMode === 'black'
          ? '#000000'
          : backdropMode === 'white'
            ? '#ffffff'
            : backdropMode === 'custom'
              ? backdropColor
              : '#080c12';
        ctx.fillRect(0, 0, pw, ph);
      }

      const fitScale = Math.min(pw / tw, ph / th);
      const fw = tw * fitScale;
      const fh = th * fitScale;
      ctx.drawImage(transformed, (pw - fw) / 2, (ph - fh) / 2, fw, fh);
      paintOverlays(ctx, pw, ph, overlays);
      return;
    }

    // Cropped output view (or Compare Original view)
    const activeBox = comparing ? FULL_BOX : box;
    const sx = (activeBox.x / 100) * tw;
    const sy = (activeBox.y / 100) * th;
    const sw = Math.max(2, (activeBox.w / 100) * tw);
    const sh = Math.max(2, (activeBox.h / 100) * th);
    const scale = Math.min(1, previewMaxEdge / Math.max(sw, sh, 1));
    const pw = Math.max(2, Math.round(sw * scale));
    const ph = Math.max(2, Math.round(sh * scale));
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, pw, ph);
    ctx.drawImage(transformed, sx, sy, sw, sh, 0, 0, pw, ph);
    if (!comparing) {
      paintOverlays(ctx, pw, ph, overlays);
    }
  }, [
    isVideo, mediaLoaded, renderTransformedSource, isInteractiveCropView,
    pad, targetRatioValue, comparing, backdropMode, backdropColor, box, overlays,
  ]);

  // Repaint whenever any edit state changes
  useEffect(() => {
    paintPreviewCanvas();
  }, [paintPreviewCanvas]);

  // Continuous 60fps repaint loop while video is playing
  useEffect(() => {
    if (!isVideo || !videoPlaying) return undefined;
    let raf = 0;
    const tick = () => {
      paintPreviewCanvas();
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [isVideo, videoPlaying, paintPreviewCanvas]);

  const activeOverlay = useMemo(
    () => overlays.find((item) => item.id === activeOverlayId) || null,
    [overlays, activeOverlayId]
  );

  const patchOverlay = useCallback((id, patch) => {
    setOverlays((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  // Keyboard shortcuts: Undo/Redo, Delete overlay, Arrow nudge, Space video play/pause
  useEffect(() => {
    const onKeyDown = (e) => {
      const tag = document.activeElement?.tagName;
      const isEditingInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (isEditingInput) return;
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        if (isEditingInput) return;
        e.preventDefault();
        redo();
        return;
      }

      if (isEditingInput) return;

      if ((e.key === 'Delete' || e.key === 'Backspace') && activeOverlayId) {
        e.preventDefault();
        setOverlays((curr) => curr.filter((o) => o.id !== activeOverlayId));
        setActiveOverlayId('');
        return;
      }

      if (e.code === 'Space' && isVideo && !timelineEditorOpen) {
        e.preventDefault();
        toggleVideoPlay();
        return;
      }

      const step = e.shiftKey ? 2 : 0.5;
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        if (activeOverlay) {
          e.preventDefault();
          patchOverlay(activeOverlay.id, {
            x: clamp(activeOverlay.x + dx, 0, 100 - activeOverlay.w),
            y: clamp(activeOverlay.y + dy, 0, 100 - activeOverlay.h),
          });
        } else if (isInteractiveCropView) {
          e.preventDefault();
          setBox((b) => ({
            ...b,
            x: clamp(b.x + dx, 0, 100 - b.w),
            y: clamp(b.y + dy, 0, 100 - b.h),
          }));
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  // Crop box pointer drag handlers
  const startCropDrag = (e, mode) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = stageContainerRef.current?.getBoundingClientRect();
    if (!rect) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const lockedPctAspect = targetRatioValue > 0
      ? targetRatioValue * (transformedSize.h / Math.max(1, transformedSize.w))
      : 0;
    cropDragRef.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      rect,
      startBox: { ...box },
      lockedPctAspect,
    };
  };

  // Overlay item pointer drag / resize / rotate handlers
  const startOverlayDrag = (e, item, mode = 'move') => {
    e.preventDefault();
    e.stopPropagation();
    const rect = stageContainerRef.current?.getBoundingClientRect();
    if (!rect) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setActiveOverlayId(item.id);
    if (activeTab !== 'design') setActiveTab('design');

    const centerPxX = rect.left + ((item.x + item.w / 2) / 100) * rect.width;
    const centerPxY = rect.top + ((item.y + item.h / 2) / 100) * rect.height;
    const startAngle = Math.atan2(e.clientY - centerPxY, e.clientX - centerPxX) * (180 / Math.PI);

    overlayDragRef.current = {
      id: item.id,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      rect,
      startBox: { x: item.x, y: item.y, w: item.w, h: item.h },
      centerPxX,
      centerPxY,
      startAngle,
      initialRotation: Number(item.rotation || 0),
    };
  };

  useEffect(() => {
    const onPointerMove = (e) => {
      if (cropDragRef.current) {
        const { mode, startX, startY, rect, startBox, lockedPctAspect } = cropDragRef.current;
        const dx = ((e.clientX - startX) / Math.max(1, rect.width)) * 100;
        const dy = ((e.clientY - startY) / Math.max(1, rect.height)) * 100;
        setBox(resizeBox(startBox, dx, dy, mode, MIN_CROP_SIZE, mode === 'move' ? 0 : lockedPctAspect));
        return;
      }
      if (overlayDragRef.current) {
        const { id, mode, startX, startY, rect, startBox, centerPxX, centerPxY, startAngle, initialRotation } = overlayDragRef.current;
        if (mode === 'rotate') {
          const currentAngle = Math.atan2(e.clientY - centerPxY, e.clientX - centerPxX) * (180 / Math.PI);
          let nextRot = Math.round(initialRotation + (currentAngle - startAngle));
          if (nextRot > 180) nextRot -= 360;
          if (nextRot < -180) nextRot += 360;
          if (Math.abs(nextRot) <= 3) nextRot = 0;
          patchOverlay(id, { rotation: nextRot });
          return;
        }
        const dx = ((e.clientX - startX) / Math.max(1, rect.width)) * 100;
        const dy = ((e.clientY - startY) / Math.max(1, rect.height)) * 100;
        const next = resizeBox(startBox, dx, dy, mode, MIN_OVERLAY_SIZE, 0);
        patchOverlay(id, next);
      }
    };
    const onPointerUp = () => {
      cropDragRef.current = null;
      overlayDragRef.current = null;
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, [patchOverlay]);

  // Add Text or Shape overlay presets
  const addTextOverlay = (preset = 'heading') => {
    const id = `txt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const offset = (overlays.length % 5) * 3;
    const presets = {
      heading: {
        text: 'Add Heading',
        size: 46,
        w: 68,
        h: 18,
        bold: true,
        bgEnabled: false,
        strokeWidth: 3,
      },
      subheading: {
        text: 'Add a subheading',
        size: 32,
        w: 62,
        h: 14,
        bold: true,
        bgEnabled: false,
        strokeWidth: 2,
      },
      body: {
        text: 'Write your caption or callout text here',
        size: 24,
        w: 66,
        h: 16,
        bold: false,
        bgEnabled: false,
        strokeWidth: 0,
      },
      pill: {
        text: 'NEW COLLECTION',
        size: 26,
        w: 54,
        h: 13,
        bold: true,
        uppercase: true,
        bgEnabled: true,
        bgColor: '#000000',
        bgOpacity: 0.78,
        bgRadius: 99,
        strokeWidth: 0,
      },
    };
    const cfg = presets[preset] || presets.heading;
    const item = {
      id,
      kind: 'text',
      x: clamp((100 - cfg.w) / 2 + offset, 4, 96 - cfg.w),
      y: clamp(22 + offset, 4, 92 - cfg.h),
      w: cfg.w,
      h: cfg.h,
      text: cfg.text,
      font: 'Plus Jakarta Sans',
      size: cfg.size,
      bold: cfg.bold,
      italic: false,
      uppercase: Boolean(cfg.uppercase),
      align: 'center',
      color: '#ffffff',
      strokeColor: '#000000',
      strokeWidth: cfg.strokeWidth ?? 2,
      bgEnabled: Boolean(cfg.bgEnabled),
      bgColor: cfg.bgColor || '#000000',
      bgOpacity: cfg.bgOpacity ?? 0.72,
      bgRadius: cfg.bgRadius ?? 12,
      shadow: true,
      opacity: 1,
      rotation: 0,
    };
    setOverlays((curr) => [...curr, item]);
    setActiveOverlayId(id);
    setActiveTab('design');
  };

  const addShapeOverlay = (shape = 'rect') => {
    const id = `shp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const offset = (overlays.length % 5) * 3;
    const isLine = shape === 'line' || shape === 'arrow';
    const w = isLine ? 48 : 32;
    const h = isLine ? 10 : 32;
    const item = {
      id,
      kind: 'shape',
      shape,
      x: clamp((100 - w) / 2 + offset, 4, 96 - w),
      y: clamp((100 - h) / 2 + offset, 4, 96 - h),
      w,
      h,
      color: '#ffffff',
      fill: '#7dd3fc',
      fillEnabled: !isLine,
      fillOpacity: shape === 'star' ? 0.85 : 0.28,
      strokeWidth: 4,
      radius: shape === 'roundRect' ? 20 : 0,
      shadow: true,
      opacity: 1,
      rotation: 0,
    };
    setOverlays((curr) => [...curr, item]);
    setActiveOverlayId(id);
    setActiveTab('design');
  };

  const duplicateOverlay = (id) => {
    const target = overlays.find((o) => o.id === id);
    if (!target) return;
    const copyId = `${target.kind}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const copy = {
      ...target,
      id: copyId,
      x: clamp(target.x + 4, 0, 100 - target.w),
      y: clamp(target.y + 4, 0, 100 - target.h),
    };
    setOverlays((curr) => [...curr, copy]);
    setActiveOverlayId(copyId);
  };

  const moveOverlayOrder = (id, delta) => {
    setOverlays((curr) => {
      const i = curr.findIndex((o) => o.id === id);
      const next = i + delta;
      if (i < 0 || next < 0 || next >= curr.length) return curr;
      const copy = [...curr];
      const [item] = copy.splice(i, 1);
      copy.splice(next, 0, item);
      return copy;
    });
  };

  const removeOverlay = (id) => {
    setOverlays((curr) => curr.filter((o) => o.id !== id));
    if (activeOverlayId === id) setActiveOverlayId('');
  };

  // Video playback controls
  const toggleVideoPlay = async () => {
    const v = videoSourceRef.current;
    if (!v) return;
    if (!v.paused) {
      v.pause();
      return;
    }
    const endCap = trimEnd > 0 ? trimEnd : videoDuration;
    if (v.currentTime < trimStart || (endCap > 0 && v.currentTime >= endCap - 0.05)) {
      v.currentTime = trimStart;
    }
    try {
      await v.play();
    } catch {
      setSaveError('Click the video preview once if your browser paused playback.');
    }
  };

  const seekVideoTo = (time) => {
    const v = videoSourceRef.current;
    const endCap = trimEnd > 0 ? trimEnd : videoDuration;
    const clamped = clamp(Number(time) || 0, trimStart, endCap || videoDuration || 0);
    setVideoTime(clamped);
    if (v && Number.isFinite(clamped)) {
      v.currentTime = clamped;
      window.requestAnimationFrame(paintPreviewCanvas);
    }
  };

  const resetAllEdits = () => {
    setRatio('Original');
    setPad(false);
    setBackdropMode('blur');
    setBackdropColor('#0b1320');
    setRot(0);
    setStraighten(0);
    setFlipX(false);
    setFlipY(false);
    setZoom(1);
    setBox(FULL_BOX);
    setAdjustments(DEFAULT_ADJUSTMENTS);
    setOverlays([]);
    setActiveOverlayId('');
    setTrimStart(0);
    setTrimEnd(videoDuration);
    setVideoVolume(100);
    setVideoMuted(false);
    setVideoSpeed(1);
    if (isVideo) seekVideoTo(0);
  };

  const applyFilterPreset = (preset) => {
    setAdjustments((curr) => ({
      ...curr,
      filterId: preset.id,
      brightness: preset.brightness,
      contrast: preset.contrast,
      saturation: preset.saturation,
      warmth: preset.warmth,
      fade: preset.fade,
      vignette: preset.vignette,
    }));
  };

  // Render final composition into an export canvas of size (targetW, targetH)
  const paintExportFrame = (ctx, targetW, targetH, sourceEl) => {
    const transformed = renderTransformedSource(sourceEl, 2160);
    const tw = transformed.width;
    const th = transformed.height;
    ctx.clearRect(0, 0, targetW, targetH);

    if (pad && targetRatioValue > 0) {
      if (backdropMode === 'blur') {
        ctx.save();
        ctx.filter = 'blur(32px) brightness(0.62)';
        const coverScale = Math.max(targetW / tw, targetH / th) * 1.12;
        const bw = tw * coverScale;
        const bh = th * coverScale;
        ctx.drawImage(transformed, (targetW - bw) / 2, (targetH - bh) / 2, bw, bh);
        ctx.restore();
      } else {
        ctx.fillStyle = backdropMode === 'black'
          ? '#000000'
          : backdropMode === 'white'
            ? '#ffffff'
            : backdropMode === 'custom'
              ? backdropColor
              : '#080c12';
        ctx.fillRect(0, 0, targetW, targetH);
      }
      const fitScale = Math.min(targetW / tw, targetH / th);
      const fw = tw * fitScale;
      const fh = th * fitScale;
      ctx.drawImage(transformed, (targetW - fw) / 2, (targetH - fh) / 2, fw, fh);
    } else {
      const sx = (box.x / 100) * tw;
      const sy = (box.y / 100) * th;
      const sw = Math.max(2, (box.w / 100) * tw);
      const sh = Math.max(2, (box.h / 100) * th);
      ctx.drawImage(transformed, sx, sy, sw, sh, 0, 0, targetW, targetH);
    }
    paintOverlays(ctx, targetW, targetH, overlays);
  };

  // Save & Export (both Photo and Video)
  const handleSave = async () => {
    if (!file?.raw || saving) return;
    setSaving(true);
    setSavePct(5);
    setSaveError('');

    try {
      const maxExportEdge = isVideo ? 1920 : 2160;
      const scale = Math.min(1, maxExportEdge / Math.max(outputDimensions.w, outputDimensions.h, 1));
      let outW = Math.max(2, Math.round(outputDimensions.w * scale));
      let outH = Math.max(2, Math.round(outputDimensions.h * scale));
      if (outW % 2 !== 0) outW -= 1;
      if (outH % 2 !== 0) outH -= 1;

      if (!isVideo) {
        const img = imageSourceRef.current;
        if (!img) throw new Error('Image is still loading.');
        const canvas = document.createElement('canvas');
        canvas.width = outW;
        canvas.height = outH;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas context unavailable.');
        paintExportFrame(ctx, outW, outH, img);
        setSavePct(85);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.94));
        if (!blob) throw new Error('Could not encode edited photo.');
        const base = (file.name || 'photo').replace(/\.[^.]+$/, '');
        const editedFile = new File([blob], `${base}-edited.jpg`, { type: 'image/jpeg' });
        if (onApply) await onApply(editedFile);
        else if (onReplace) await onReplace(idx, editedFile);
        onClose();
        return;
      }

      // Video export with silent audio routing via Web Audio API
      if (videoSourceRef.current && !videoSourceRef.current.paused) {
        videoSourceRef.current.pause();
      }
      const src = document.createElement('video');
      src.src = mediaUrl;
      src.playsInline = true;
      src.preload = 'auto';
      src.crossOrigin = 'anonymous';
      let audioCtx = null;

      try {
        await new Promise((resolve, reject) => {
          const t = window.setTimeout(() => reject(new Error('Video load timed out.')), 8000);
          src.onloadedmetadata = () => { window.clearTimeout(t); resolve(); };
          src.onerror = () => { window.clearTimeout(t); reject(new Error('Could not read video file.')); };
        });

        const canvas = document.createElement('canvas');
        canvas.width = outW;
        canvas.height = outH;
        const ctx = canvas.getContext('2d');
        if (!ctx || typeof canvas.captureStream !== 'function' || typeof MediaRecorder === 'undefined') {
          throw new Error('This browser does not support video rendering.');
        }

        const stream = canvas.captureStream(30);
        if (!videoMuted && videoVolume > 0) {
          try {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (AudioContextClass) {
              audioCtx = new AudioContextClass();
              await audioCtx.resume().catch(() => {});
              const sourceNode = audioCtx.createMediaElementSource(src);
              const gainNode = audioCtx.createGain();
              gainNode.gain.value = clamp(videoVolume / 100, 0, 1.5);
              const destNode = audioCtx.createMediaStreamDestination();
              sourceNode.connect(gainNode);
              gainNode.connect(destNode);
              destNode.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
            }
          } catch {
            const fallback = src.captureStream?.() || src.mozCaptureStream?.();
            fallback?.getAudioTracks?.().forEach((track) => stream.addTrack(track));
          }
        } else {
          src.muted = true;
        }

        const mimeType = recordingMimeType();
        const recorder = new MediaRecorder(stream, {
          ...(mimeType ? { mimeType } : {}),
          videoBitsPerSecond: 8_000_000,
        });
        const chunks = [];
        recorder.ondataavailable = (ev) => {
          if (ev.data && ev.data.size > 0) chunks.push(ev.data);
        };
        const stopped = new Promise((resolve, reject) => {
          recorder.onstop = resolve;
          recorder.onerror = (ev) => reject(ev.error || new Error('Video recording failed.'));
        });

        const startSec = clamp(trimStart, 0, Math.max(0, (src.duration || videoDuration) - 0.2));
        const endSec = trimEnd > startSec + 0.2 ? trimEnd : (src.duration || videoDuration);

        src.currentTime = startSec;
        await new Promise((resolve) => {
          const t = window.setTimeout(resolve, 3000);
          src.onseeked = () => { window.clearTimeout(t); resolve(); };
        });
        src.playbackRate = videoSpeed;
        paintExportFrame(ctx, outW, outH, src);

        recorder.start(150);
        await src.play();

        await new Promise((resolve) => {
          let raf = 0;
          const finish = () => {
            window.cancelAnimationFrame(raf);
            src.pause();
            if (recorder.state !== 'inactive') recorder.stop();
            resolve();
          };
          const loop = () => {
            if (src.readyState >= 2) paintExportFrame(ctx, outW, outH, src);
            const pct = Math.round(((src.currentTime - startSec) / Math.max(0.2, endSec - startSec)) * 95);
            setSavePct(clamp(pct, 5, 98));
            if (src.ended || (endSec > 0 && src.currentTime >= endSec - 0.02)) {
              finish();
              return;
            }
            raf = window.requestAnimationFrame(loop);
          };
          raf = window.requestAnimationFrame(loop);
        });

        await stopped;
        stream.getTracks().forEach((track) => track.stop());
        const outType = recorder.mimeType || mimeType || 'video/mp4';
        const ext = outType.includes('mp4') ? 'mp4' : 'webm';
        const blob = new Blob(chunks, { type: outType });
        if (!blob.size) throw new Error('Rendered video was empty.');
        const base = (file.name || 'video').replace(/\.[^.]+$/, '');
        const editedVideo = new File([blob], `${base}-edited.${ext}`, { type: outType });
        if (onApply) await onApply(editedVideo);
        else if (onReplace) await onReplace(idx, editedVideo);
        onClose();
      } finally {
        try { src.pause(); src.removeAttribute('src'); src.load(); } catch {}
        try { await audioCtx?.close?.(); } catch {}
      }
    } catch (err) {
      setSaveError(err.message || 'Could not export edited media.');
    } finally {
      setSaving(false);
      setSavePct(0);
    }
  };

  if (timelineEditorOpen && isVideo) {
    return (
      <VideoTimelineEditor
        file={file}
        onClose={() => setTimelineEditorOpen(false)}
        onApply={async (trimmedFile) => {
          if (onApply) await onApply(trimmedFile);
          else if (onReplace) await onReplace(idx, trimmedFile);
          setTimelineEditorOpen(false);
        }}
      />
    );
  }

  return (
    <section className="s2-media-editor-page" role="dialog" aria-modal="true" aria-label="Studio Media Editor">
    <div className="s2-editor s2-media-editor">
      {/*Hidden live video element that feeds the WYSIWYG canvas*/}
      {isVideo && (
        <video
          ref={videoSourceRef}
          src={mediaUrl}
          playsInline
          preload="auto"
          style={{ display: 'none' }}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            const dur = Number(v.duration) || 0;
            setNaturalSize({ w: v.videoWidth || 1080, h: v.videoHeight || 1920 });
            setVideoDuration(dur);
            setTrimStart(0);
            setTrimEnd(dur);
            setVideoTime(0);
            setMediaLoaded(true);
            window.requestAnimationFrame(paintPreviewCanvas);
          }}
          onLoadedData={() => {
            window.requestAnimationFrame(paintPreviewCanvas);
          }}
          onTimeUpdate={(e) => {
            const v = e.currentTarget;
            const now = v.currentTime;
            const endCap = trimEnd > 0 ? trimEnd : videoDuration;
            if (endCap > 0 && now >= endCap) {
              v.currentTime = trimStart;
              setVideoTime(trimStart);
              v.play().catch(() => {});
              return;
            }
            setVideoTime(now);
          }}
          onPlay={() => setVideoPlaying(true)}
          onPause={() => {
            setVideoPlaying(false);
            window.requestAnimationFrame(paintPreviewCanvas);
          }}
        />
      )}

      {/* TOP STUDIO HEADER */}
      <header className="s2-studio-topbar">
        <div className="s2-studio-topbar-left">
          <button type="button" className="s2-studio-btn ghost" onClick={onClose} disabled={saving}>
            ← Back to Post
          </button>
          <div className="s2-studio-meta">
            <strong>{file?.name || 'Media Studio'}</strong>
            <span>
              {outputDimensions.w} × {outputDimensions.h}px · {ratio} · {pad ? 'Fit' : 'Crop'}
              {isVideo && videoDuration > 0 ? ` · ${fmtTime(Math.max(0, (trimEnd || videoDuration) - trimStart))}` : ''}
            </span>
          </div>
        </div>

        <div className="s2-studio-topbar-center">
          <button
            type="button"
            className="s2-studio-btn icon"
            onClick={undo}
            disabled={!canUndo || saving}
            title="Undo (Ctrl+Z)"
          >
            ↶ Undo
          </button>
          <button
            type="button"
            className="s2-studio-btn icon"
            onClick={redo}
            disabled={!canRedo || saving}
            title="Redo (Ctrl+Y)"
          >
            ↷ Redo
          </button>
          <button
            type="button"
            className={comparing ? 's2-studio-btn active' : 's2-studio-btn ghost'}
            onPointerDown={() => setComparing(true)}
            onPointerUp={() => setComparing(false)}
            onPointerLeave={() => setComparing(false)}
            disabled={saving}
            title="Press and hold to view unedited original"
          >
            <DriftIcon name="eye" size={14} /> Compare
          </button>
          <button
            type="button"
            className="s2-studio-btn ghost"
            onClick={resetAllEdits}
            disabled={saving}
            title="Reset all adjustments, crop, and layers"
          >
            Reset All
          </button>
          <div className="s2-zoom-group" aria-label="Canvas preview zoom">
            {[75, 100, 125].map((z) => (
              <button
                key={z}
                type="button"
                className={canvasZoom === z ? 's2-studio-pill on' : 's2-studio-pill'}
                onClick={() => setCanvasZoom(z)}
              >
                {z}%
              </button>
            ))}
          </div>
        </div>

        <div className="s2-studio-topbar-right">
          <button
            type="button"
            className="s2-studio-btn primary"
            onClick={handleSave}
            disabled={saving || !mediaLoaded}
          >
            {saving
              ? `Rendering ${savePct}%…`
              : isVideo
                ? '✓ Save Edited Video'
                : '✓ Save Edited Photo'}
          </button>
        </div>
      </header>

      {/* MULTI-FILE SWITCHER STRIP */}
      {mediaList.length > 1 && (
        <div className="s2-ed-strip" role="tablist" aria-label="Switch media item">
          {mediaList.map((f, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === idx}
              className={i === idx ? 's2-ed-chip on' : 's2-ed-chip'}
              disabled={saving}
              onClick={() => setIdx(i)}
            >
              <DriftIcon name={(f.type || f.raw?.type || '').startsWith('video/') ? 'film' : 'photo'} size={13} /> #{i + 1} · {(f.name || '').slice(0, 18)}
            </button>
          ))}
        </div>
      )}

      {/* MAIN STUDIO WORKSPACE */}
      <div className="s2-studio-workspace">
        {/* LEFT / SIDE TOOL DRAWER */}
        <aside className="s2-studio-sidebar" aria-label="Editor tools">
          <nav className="s2-studio-tabs" role="tablist" aria-label="Editor tool categories">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'crop'}
              className={activeTab === 'crop' ? 's2-studio-tab on' : 's2-studio-tab'}
              onClick={() => setActiveTab('crop')}
            >
              <span>Crop</span>
              <b>Crop &amp; Frame</b>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'adjust'}
              className={activeTab === 'adjust' ? 's2-studio-tab on' : 's2-studio-tab'}
              onClick={() => setActiveTab('adjust')}
            >
              <span>☀</span>
              <b>Adjust &amp; Filters</b>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'design'}
              className={activeTab === 'design' ? 's2-studio-tab on' : 's2-studio-tab'}
              onClick={() => setActiveTab('design')}
            >
              <span>✦</span>
              <b>Text &amp; Shapes {overlays.length > 0 ? `(${overlays.length})` : ''}</b>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'audio'}
              className={activeTab === 'audio' ? 's2-studio-tab on' : 's2-studio-tab'}
              onClick={() => setActiveTab('audio')}
            >
              <span>♪</span>
              <b>{isVideo ? 'Trim & Audio' : 'Soundtrack'}</b>
            </button>
          </nav>

          <div className="s2-studio-panel-body">
            {/* TAB 1: CROP & FRAME */}
            {activeTab === 'crop' && (
              <div className="s2-tool-section-list">
                <section className="s2-tool-card">
                  <div className="s2-tool-card-head">
                    <b>Framing Mode</b>
                    <small>{pad ? 'Fits entire frame with backdrop' : 'Crops directly to target frame'}</small>
                  </div>
                  <div className="s2-segmented">
                    <button
                      type="button"
                      className={!pad ? 'on' : ''}
                      onClick={() => selectFramingMode(false)}
                    >
                      <DriftIcon name="crop" size={14} /> Crop to Fill
                    </button>
                    <button
                      type="button"
                      className={pad ? 'on' : ''}
                      onClick={() => selectFramingMode(true)}
                    >
                      ⊞ Fit Whole Frame
                    </button>
                  </div>

                  {pad && (
                    <div className="s2-sub-group">
                      <span className="s2-sub-label">Backdrop Fill</span>
                      <div className="s2-pill-grid">
                        {[
                          ['blur', 'Blurred Frame'],
                          ['dark', 'Dark Studio'],
                          ['black', 'Pure Black'],
                          ['white', 'Clean White'],
                          ['custom', 'Custom Color'],
                        ].map(([id, label]) => (
                          <button
                            key={id}
                            type="button"
                            className={backdropMode === id ? 's2-studio-pill on' : 's2-studio-pill'}
                            onClick={() => setBackdropMode(id)}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      {backdropMode === 'custom' && (
                        <label className="s2-inline-color">
                          <span>Backdrop Color</span>
                          <input
                            type="color"
                            value={backdropColor}
                            onChange={(e) => setBackdropColor(e.target.value)}
                          />
                        </label>
                      )}
                    </div>
                  )}
                </section>

                <section className="s2-tool-card">
                  <div className="s2-tool-card-head">
                    <b>Aspect Ratio Presets</b>
                    <small>{outputDimensions.w} × {outputDimensions.h}px</small>
                  </div>
                  <div className="s2-ratio-grid">
                    {RATIOS.map(([label, val, hint]) => {
                      const disabled = pad && label === 'Free';
                      return (
                        <button
                          key={label}
                          type="button"
                          disabled={disabled}
                          className={ratio === label ? 's2-ratio-card on' : 's2-ratio-card'}
                          onClick={() => selectRatio(label)}
                        >
                          <strong>{label}</strong>
                          <small>{hint}</small>
                        </button>
                      );
                    })}
                  </div>
                </section>

                <section className="s2-tool-card">
                  <div className="s2-tool-card-head">
                    <b>Rotate, Flip &amp; Zoom</b>
                    <small>{totalAngle}° · {Math.round(zoom * 100)}%</small>
                  </div>
                  <div className="s2-transform-row">
                    <button type="button" className="s2-studio-btn ghost" onClick={() => rotateBy(-90)}>
                      ↺ −90°
                    </button>
                    <button type="button" className="s2-studio-btn ghost" onClick={() => rotateBy(90)}>
                      ↻ +90°
                    </button>
                    <button
                      type="button"
                      className={flipX ? 's2-studio-btn active' : 's2-studio-btn ghost'}
                      onClick={() => setFlipX((v) => !v)}
                    >
                      ⇆ Flip H
                    </button>
                    <button
                      type="button"
                      className={flipY ? 's2-studio-btn active' : 's2-studio-btn ghost'}
                      onClick={() => setFlipY((v) => !v)}
                    >
                      ⇅ Flip V
                    </button>
                  </div>

                  <div className="s2-slider-field">
                    <div className="s2-slider-head">
                      <span>Straighten Angle</span>
                      <button type="button" onClick={() => setStraighten(0)} title="Click to reset to 0°">
                        {straighten > 0 ? `+${straighten}°` : `${straighten}°`}
                      </button>
                    </div>
                    <input
                      type="range"
                      min={-45}
                      max={45}
                      step={0.5}
                      value={straighten}
                      onChange={(e) => setStraighten(Number(e.target.value))}
                    />
                  </div>

                  <div className="s2-slider-field">
                    <div className="s2-slider-head">
                      <span>Scale / Zoom</span>
                      <button type="button" onClick={() => setZoom(1)} title="Click to reset to 100%">
                        {Math.round(zoom * 100)}%
                      </button>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={3}
                      step={0.02}
                      value={zoom}
                      onChange={(e) => setZoom(Number(e.target.value))}
                    />
                  </div>

                  {!pad && (
                    <div className="s2-crop-coords">
                      <div className="s2-crop-coords-grid">
                        <label>
                          <span>X %</span>
                          <input
                            type="number"
                            min={0}
                            max={100 - MIN_CROP_SIZE}
                            value={Math.round(box.x)}
                            onChange={(e) => setBox((b) => ({ ...b, x: clamp(Number(e.target.value) || 0, 0, 100 - b.w) }))}
                          />
                        </label>
                        <label>
                          <span>Y %</span>
                          <input
                            type="number"
                            min={0}
                            max={100 - MIN_CROP_SIZE}
                            value={Math.round(box.y)}
                            onChange={(e) => setBox((b) => ({ ...b, y: clamp(Number(e.target.value) || 0, 0, 100 - b.h) }))}
                          />
                        </label>
                        <label>
                          <span>W %</span>
                          <input
                            type="number"
                            min={MIN_CROP_SIZE}
                            max={100}
                            value={Math.round(box.w)}
                            onChange={(e) => {
                              const w = clamp(Number(e.target.value) || MIN_CROP_SIZE, MIN_CROP_SIZE, 100 - box.x);
                              setBox((b) => ({ ...b, w }));
                            }}
                          />
                        </label>
                        <label>
                          <span>H %</span>
                          <input
                            type="number"
                            min={MIN_CROP_SIZE}
                            max={100}
                            value={Math.round(box.h)}
                            onChange={(e) => {
                              const h = clamp(Number(e.target.value) || MIN_CROP_SIZE, MIN_CROP_SIZE, 100 - box.y);
                              setBox((b) => ({ ...b, h }));
                            }}
                          />
                        </label>
                      </div>
                      <div className="s2-crop-quick-actions">
                        <button
                          type="button"
                          className="s2-studio-btn ghost"
                          onClick={() => setBox((b) => ({ ...b, x: (100 - b.w) / 2, y: (100 - b.h) / 2 }))}
                        >
                          Center Crop
                        </button>
                        <button
                          type="button"
                          className="s2-studio-btn ghost"
                          onClick={() => selectRatio(ratio)}
                        >
                          Reset Crop Box
                        </button>
                      </div>
                    </div>
                  )}
                </section>
              </div>
            )}

            {/* TAB 2: ADJUST & FILTERS */}
            {activeTab === 'adjust' && (
              <div className="s2-tool-section-list">
                <section className="s2-tool-card">
                  <div className="s2-tool-card-head">
                    <b>Filter Presets</b>
                    <button
                      type="button"
                      className="s2-mini-reset"
                      onClick={() => setAdjustments(DEFAULT_ADJUSTMENTS)}
                    >
                      Reset All
                    </button>
                  </div>
                  <div className="s2-filter-grid">
                    {FILTER_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        className={adjustments.filterId === preset.id ? 's2-filter-card on' : 's2-filter-card'}
                        onClick={() => applyFilterPreset(preset)}
                      >
                        <strong>{preset.name}</strong>
                      </button>
                    ))}
                  </div>
                </section>

                <section className="s2-tool-card">
                  <div className="s2-tool-card-head">
                    <b>Light &amp; Color Grading</b>
                    <small>Click any value to reset</small>
                  </div>

                  {[
                    ['brightness', 'Brightness', -100, 100],
                    ['contrast', 'Contrast', -100, 100],
                    ['saturation', 'Saturation', -100, 100],
                    ['warmth', 'Warmth (Temp)', -100, 100],
                    ['fade', 'Matte Fade', 0, 100],
                    ['vignette', 'Vignette', 0, 100],
                    ['blur', 'Soft Blur', 0, 20],
                  ].map(([key, label, min, max]) => {
                    const val = Number(adjustments[key] || 0);
                    return (
                      <div key={key} className="s2-slider-field">
                        <div className="s2-slider-head">
                          <span>{label}</span>
                          <button
                            type="button"
                            onClick={() => setAdjustments((curr) => ({ ...curr, [key]: 0 }))}
                            title={`Reset ${label}`}
                          >
                            {val > 0 && min < 0 ? `+${val}` : val}
                          </button>
                        </div>
                        <input
                          type="range"
                          min={min}
                          max={max}
                          step={key === 'blur' ? 0.5 : 1}
                          value={val}
                          onChange={(e) => setAdjustments((curr) => ({
                            ...curr,
                            filterId: 'custom',
                            [key]: Number(e.target.value),
                          }))}
                        />
                      </div>
                    );
                  })}
                </section>
              </div>
            )}

            {/* TAB 3: TEXT & SHAPES */}
            {activeTab === 'design' && (
              <div className="s2-tool-section-list">
                <section className="s2-tool-card">
                  <div className="s2-tool-card-head">
                    <b>Add Text</b>
                    <small>Drag &amp; resize directly on canvas</small>
                  </div>
                  <div className="s2-add-grid">
                    <button type="button" className="s2-studio-btn ghost" onClick={() => addTextOverlay('heading')}>
                      + Heading
                    </button>
                    <button type="button" className="s2-studio-btn ghost" onClick={() => addTextOverlay('subheading')}>
                      + Subheading
                    </button>
                    <button type="button" className="s2-studio-btn ghost" onClick={() => addTextOverlay('body')}>
                      + Body Text
                    </button>
                    <button type="button" className="s2-studio-btn ghost" onClick={() => addTextOverlay('pill')}>
                      + Callout Pill
                    </button>
                  </div>

                  <div className="s2-tool-card-head" style={{ marginTop: 12 }}>
                    <b>Add Shapes &amp; Stickers</b>
                  </div>
                  <div className="s2-add-grid">
                    <button type="button" className="s2-studio-btn ghost" onClick={() => addShapeOverlay('rect')}>
                      ▭ Rectangle
                    </button>
                    <button type="button" className="s2-studio-btn ghost" onClick={() => addShapeOverlay('roundRect')}>
                      ▢ Rounded Box
                    </button>
                    <button type="button" className="s2-studio-btn ghost" onClick={() => addShapeOverlay('circle')}>
                      ◯ Circle
                    </button>
                    <button type="button" className="s2-studio-btn ghost" onClick={() => addShapeOverlay('star')}>
                      ★ Star Badge
                    </button>
                    <button type="button" className="s2-studio-btn ghost" onClick={() => addShapeOverlay('line')}>
                      ― Divider Line
                    </button>
                    <button type="button" className="s2-studio-btn ghost" onClick={() => addShapeOverlay('arrow')}>
                      ➔ Arrow
                    </button>
                  </div>
                </section>

                {/* LAYER STACK */}
                {overlays.length > 0 && (
                  <section className="s2-tool-card">
                    <div className="s2-tool-card-head">
                      <b>Layers ({overlays.length})</b>
                      <button
                        type="button"
                        className="s2-mini-reset"
                        onClick={() => { setOverlays([]); setActiveOverlayId(''); }}
                      >
                        Clear All
                      </button>
                    </div>
                    <div className="s2-layer-list">
                      {overlays.map((item, i) => (
                        <div
                          key={item.id}
                          className={item.id === activeOverlayId ? 's2-layer-row on' : 's2-layer-row'}
                          onClick={() => setActiveOverlayId(item.id)}
                        >
                          <span className="s2-layer-name">
                            {item.kind === 'text' ? `T · ${item.text || 'Text'}` : `◈ · ${item.shape}`}
                          </span>
                          <div className="s2-layer-actions" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              title="Send backward"
                              disabled={i === 0}
                              onClick={() => moveOverlayOrder(item.id, -1)}
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              title="Bring forward"
                              disabled={i === overlays.length - 1}
                              onClick={() => moveOverlayOrder(item.id, 1)}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              title="Duplicate layer"
                              onClick={() => duplicateOverlay(item.id)}
                            >
                              ⧉
                            </button>
                            <button
                              type="button"
                              className="danger"
                              title="Delete layer"
                              onClick={() => removeOverlay(item.id)}
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* ACTIVE OVERLAY INSPECTOR */}
                {activeOverlay ? (
                  <section className="s2-tool-card">
                    <div className="s2-tool-card-head">
                      <b>{activeOverlay.kind === 'text' ? 'Text Properties' : 'Shape Properties'}</b>
                      <button
                        type="button"
                        className="s2-mini-reset danger"
                        onClick={() => removeOverlay(activeOverlay.id)}
                      >
                        Delete Layer
                      </button>
                    </div>

                    {activeOverlay.kind === 'text' ? (
                      <>
                        <label className="s2-field-block">
                          <span>Text Content</span>
                          <textarea
                            ref={textInputRef}
                            rows={3}
                            value={activeOverlay.text}
                            onChange={(e) => patchOverlay(activeOverlay.id, { text: e.target.value })}
                            placeholder="Type your headline or caption…"
                          />
                        </label>

                        <div className="s2-row-split">
                          <label className="s2-field-block">
                            <span>Font Family</span>
                            <select
                              value={activeOverlay.font}
                              onChange={(e) => patchOverlay(activeOverlay.id, { font: e.target.value })}
                            >
                              {FONTS.map(([val, label]) => (
                                <option key={val} value={val}>{label}</option>
                              ))}
                            </select>
                          </label>
                          <label className="s2-field-block">
                            <span>Size ({activeOverlay.size}px)</span>
                            <input
                              type="range"
                              min={14}
                              max={140}
                              value={activeOverlay.size}
                              onChange={(e) => patchOverlay(activeOverlay.id, { size: Number(e.target.value) })}
                            />
                          </label>
                        </div>

                        <div className="s2-style-bar">
                          <button
                            type="button"
                            className={activeOverlay.bold ? 'on' : ''}
                            onClick={() => patchOverlay(activeOverlay.id, { bold: !activeOverlay.bold })}
                            title="Bold"
                          >
                            <b>B</b>
                          </button>
                          <button
                            type="button"
                            className={activeOverlay.italic ? 'on' : ''}
                            onClick={() => patchOverlay(activeOverlay.id, { italic: !activeOverlay.italic })}
                            title="Italic"
                          >
                            <i>I</i>
                          </button>
                          <button
                            type="button"
                            className={activeOverlay.uppercase ? 'on' : ''}
                            onClick={() => patchOverlay(activeOverlay.id, { uppercase: !activeOverlay.uppercase })}
                            title="Uppercase"
                          >
                            AA
                          </button>
                          <button
                            type="button"
                            className={activeOverlay.align === 'left' ? 'on' : ''}
                            onClick={() => patchOverlay(activeOverlay.id, { align: 'left' })}
                            title="Align Left"
                          >
                            ⇤
                          </button>
                          <button
                            type="button"
                            className={activeOverlay.align === 'center' ? 'on' : ''}
                            onClick={() => patchOverlay(activeOverlay.id, { align: 'center' })}
                            title="Align Center"
                          >
                            ⇔
                          </button>
                          <button
                            type="button"
                            className={activeOverlay.align === 'right' ? 'on' : ''}
                            onClick={() => patchOverlay(activeOverlay.id, { align: 'right' })}
                            title="Align Right"
                          >
                            ⇥
                          </button>
                        </div>

                        <div className="s2-color-section">
                          <div className="s2-color-head">
                            <span>Text Color</span>
                            <input
                              type="color"
                              value={activeOverlay.color || '#ffffff'}
                              onChange={(e) => patchOverlay(activeOverlay.id, { color: e.target.value })}
                            />
                          </div>
                          <div className="s2-swatch-row">
                            {SWATCHES.map((hex) => (
                              <button
                                key={hex}
                                type="button"
                                className="s2-color-swatch"
                                style={{ background: hex }}
                                onClick={() => patchOverlay(activeOverlay.id, { color: hex })}
                                aria-label={`Text color ${hex}`}
                              />
                            ))}
                          </div>
                        </div>

                        {/* Text Background Pill / Box */}
                        <div className="s2-sub-group">
                          <label className="s2-toggle-line">
                            <input
                              type="checkbox"
                              checked={Boolean(activeOverlay.bgEnabled)}
                              onChange={(e) => patchOverlay(activeOverlay.id, { bgEnabled: e.target.checked })}
                            />
                            <span>Background Box / Pill</span>
                          </label>
                          {activeOverlay.bgEnabled && (
                            <>
                              <div className="s2-color-head">
                                <span>Box Color</span>
                                <input
                                  type="color"
                                  value={activeOverlay.bgColor || '#000000'}
                                  onChange={(e) => patchOverlay(activeOverlay.id, { bgColor: e.target.value })}
                                />
                              </div>
                              <div className="s2-swatch-row">
                                {SWATCHES.map((hex) => (
                                  <button
                                    key={hex}
                                    type="button"
                                    className="s2-color-swatch"
                                    style={{ background: hex }}
                                    onClick={() => patchOverlay(activeOverlay.id, { bgColor: hex })}
                                  />
                                ))}
                              </div>
                              <div className="s2-slider-field">
                                <div className="s2-slider-head">
                                  <span>Box Opacity</span>
                                  <b>{Math.round((activeOverlay.bgOpacity ?? 0.72) * 100)}%</b>
                                </div>
                                <input
                                  type="range"
                                  min={10}
                                  max={100}
                                  value={Math.round((activeOverlay.bgOpacity ?? 0.72) * 100)}
                                  onChange={(e) => patchOverlay(activeOverlay.id, { bgOpacity: Number(e.target.value) / 100 })}
                                />
                              </div>
                            </>
                          )}
                        </div>

                        {/* Text Outline & Shadow */}
                        <div className="s2-sub-group">
                          <div className="s2-slider-field">
                            <div className="s2-slider-head">
                              <span>Outline / Stroke Width</span>
                              <b>{activeOverlay.strokeWidth ?? 0}px</b>
                            </div>
                            <input
                              type="range"
                              min={0}
                              max={12}
                              value={activeOverlay.strokeWidth ?? 0}
                              onChange={(e) => patchOverlay(activeOverlay.id, { strokeWidth: Number(e.target.value) })}
                            />
                          </div>
                          {(activeOverlay.strokeWidth ?? 0) > 0 && (
                            <div className="s2-color-head">
                              <span>Outline Color</span>
                              <input
                                type="color"
                                value={activeOverlay.strokeColor || '#000000'}
                                onChange={(e) => patchOverlay(activeOverlay.id, { strokeColor: e.target.value })}
                              />
                            </div>
                          )}
                        </div>
                      </>
                    ) : (
                      <>
                        {/* Shape Inspector */}
                        <label className="s2-field-block">
                          <span>Shape Type</span>
                          <select
                            value={activeOverlay.shape}
                            onChange={(e) => patchOverlay(activeOverlay.id, { shape: e.target.value })}
                          >
                            <option value="rect">Rectangle</option>
                            <option value="roundRect">Rounded Rectangle</option>
                            <option value="circle">Circle / Oval</option>
                            <option value="star">Star Badge</option>
                            <option value="line">Divider Line</option>
                            <option value="arrow">Pointer Arrow</option>
                          </select>
                        </label>

                        <div className="s2-color-section">
                          <div className="s2-color-head">
                            <span>Stroke / Outline Color</span>
                            <input
                              type="color"
                              value={activeOverlay.color || '#ffffff'}
                              onChange={(e) => patchOverlay(activeOverlay.id, { color: e.target.value })}
                            />
                          </div>
                          <div className="s2-swatch-row">
                            {SWATCHES.map((hex) => (
                              <button
                                key={hex}
                                type="button"
                                className="s2-color-swatch"
                                style={{ background: hex }}
                                onClick={() => patchOverlay(activeOverlay.id, { color: hex })}
                              />
                            ))}
                          </div>
                        </div>

                        {activeOverlay.shape !== 'line' && activeOverlay.shape !== 'arrow' && (
                          <div className="s2-sub-group">
                            <label className="s2-toggle-line">
                              <input
                                type="checkbox"
                                checked={activeOverlay.fillEnabled !== false}
                                onChange={(e) => patchOverlay(activeOverlay.id, { fillEnabled: e.target.checked })}
                              />
                              <span>Fill Interior</span>
                            </label>
                            {activeOverlay.fillEnabled !== false && (
                              <>
                                <div className="s2-color-head">
                                  <span>Fill Color</span>
                                  <input
                                    type="color"
                                    value={activeOverlay.fill || '#7dd3fc'}
                                    onChange={(e) => patchOverlay(activeOverlay.id, { fill: e.target.value })}
                                  />
                                </div>
                                <div className="s2-swatch-row">
                                  {SWATCHES.map((hex) => (
                                    <button
                                      key={hex}
                                      type="button"
                                      className="s2-color-swatch"
                                      style={{ background: hex }}
                                      onClick={() => patchOverlay(activeOverlay.id, { fill: hex })}
                                    />
                                  ))}
                                </div>
                                <div className="s2-slider-field">
                                  <div className="s2-slider-head">
                                    <span>Fill Opacity</span>
                                    <b>{Math.round((activeOverlay.fillOpacity ?? 0.35) * 100)}%</b>
                                  </div>
                                  <input
                                    type="range"
                                    min={5}
                                    max={100}
                                    value={Math.round((activeOverlay.fillOpacity ?? 0.35) * 100)}
                                    onChange={(e) => patchOverlay(activeOverlay.id, { fillOpacity: Number(e.target.value) / 100 })}
                                  />
                                </div>
                              </>
                            )}
                          </div>
                        )}

                        <div className="s2-slider-field">
                          <div className="s2-slider-head">
                            <span>Border Width</span>
                            <b>{activeOverlay.strokeWidth ?? 4}px</b>
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={24}
                            value={activeOverlay.strokeWidth ?? 4}
                            onChange={(e) => patchOverlay(activeOverlay.id, { strokeWidth: Number(e.target.value) })}
                          />
                        </div>
                      </>
                    )}

                    {/* Shared Transform for any Overlay */}
                    <div className="s2-sub-group">
                      <div className="s2-slider-field">
                        <div className="s2-slider-head">
                          <span>Rotation</span>
                          <button type="button" onClick={() => patchOverlay(activeOverlay.id, { rotation: 0 })}>
                            {activeOverlay.rotation || 0}°
                          </button>
                        </div>
                        <input
                          type="range"
                          min={-180}
                          max={180}
                          value={activeOverlay.rotation || 0}
                          onChange={(e) => patchOverlay(activeOverlay.id, { rotation: Number(e.target.value) })}
                        />
                      </div>

                      <div className="s2-slider-field">
                        <div className="s2-slider-head">
                          <span>Layer Opacity</span>
                          <b>{Math.round((activeOverlay.opacity ?? 1) * 100)}%</b>
                        </div>
                        <input
                          type="range"
                          min={10}
                          max={100}
                          value={Math.round((activeOverlay.opacity ?? 1) * 100)}
                          onChange={(e) => patchOverlay(activeOverlay.id, { opacity: Number(e.target.value) / 100 })}
                        />
                      </div>

                      <div className="s2-crop-quick-actions">
                        <button
                          type="button"
                          className="s2-studio-btn ghost"
                          onClick={() => patchOverlay(activeOverlay.id, { x: (100 - activeOverlay.w) / 2 })}
                        >
                          Center H
                        </button>
                        <button
                          type="button"
                          className="s2-studio-btn ghost"
                          onClick={() => patchOverlay(activeOverlay.id, { y: (100 - activeOverlay.h) / 2 })}
                        >
                          Center V
                        </button>
                      </div>
                    </div>
                  </section>
                ) : (
                  <p className="s2-studio-empty-hint">
                    Add a text or shape layer above, or click any layer on the canvas to style, move, resize, or rotate it.
                  </p>
                )}
              </div>
            )}

            {/* TAB 4: TRIM & AUDIO / SOUNDTRACK */}
            {activeTab === 'audio' && (
              <div className="s2-tool-section-list">
                {isVideo && (
                  <section className="s2-tool-card">
                    <div className="s2-tool-card-head">
                      <b>Video Trim &amp; Original Audio</b>
                      <small>{fmtTime(Math.max(0, (trimEnd || videoDuration) - trimStart))} clip</small>
                    </div>

                    <div className="s2-slider-field">
                      <div className="s2-slider-head">
                        <span>In Point (Start)</span>
                        <b>{fmtTime(trimStart)}</b>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={Math.max(0, (trimEnd || videoDuration) - 0.5)}
                        step={0.1}
                        value={trimStart}
                        onChange={(e) => {
                          const v = clamp(Number(e.target.value), 0, Math.max(0, (trimEnd || videoDuration) - 0.5));
                          setTrimStart(v);
                          seekVideoTo(v);
                        }}
                      />
                    </div>

                    <div className="s2-slider-field">
                      <div className="s2-slider-head">
                        <span>Out Point (End)</span>
                        <b>{fmtTime(trimEnd || videoDuration)}</b>
                      </div>
                      <input
                        type="range"
                        min={Math.min(videoDuration, trimStart + 0.5)}
                        max={Math.max(0.5, videoDuration)}
                        step={0.1}
                        value={trimEnd || videoDuration}
                        onChange={(e) => {
                          const v = clamp(Number(e.target.value), trimStart + 0.5, videoDuration);
                          setTrimEnd(v);
                          seekVideoTo(v);
                        }}
                      />
                    </div>

                    <div className="s2-slider-field">
                      <div className="s2-slider-head">
                        <span>Original Audio Volume</span>
                        <button type="button" onClick={() => setVideoMuted((m) => !m)}>
                          <DriftIcon name={videoMuted ? 'volumeOff' : 'volumeOn'} size={14} /> {videoMuted ? 'Muted' : `${videoVolume}%`}
                        </button>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={150}
                        value={videoMuted ? 0 : videoVolume}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setVideoVolume(v);
                          if (v > 0 && videoMuted) setVideoMuted(false);
                        }}
                      />
                    </div>

                    <div className="s2-sub-group">
                      <span className="s2-sub-label">Playback Speed</span>
                      <div className="s2-pill-grid">
                        {[0.5, 0.75, 1, 1.25, 1.5, 2].map((s) => (
                          <button
                            key={s}
                            type="button"
                            className={videoSpeed === s ? 's2-studio-pill on' : 's2-studio-pill'}
                            onClick={() => setVideoSpeed(s)}
                          >
                            {s}x
                          </button>
                        ))}
                      </div>
                    </div>

                    <button
                      type="button"
                      className="s2-studio-btn primary full"
                      style={{ marginTop: 10 }}
                      onClick={() => {
                        if (videoSourceRef.current && !videoSourceRef.current.paused) {
                          videoSourceRef.current.pause();
                        }
                        setTimelineEditorOpen(true);
                      }}
                    >
                      <DriftIcon name="crop" size={14} /> Open Full-Screen Filmstrip Trimmer
                    </button>
                  </section>
                )}

                <section className="s2-tool-card">
                  <div className="s2-tool-card-head">
                    <b>Soundtrack Library</b>
                    <small>{isVideo ? 'Mix music into your video' : 'Turn photo into a music video'}</small>
                  </div>
                  {file?.musicTrack && (
                    <div className="s2-sub-group" style={{ paddingTop: 0, borderTop: 0 }}>
                      <div className="s2-color-head">
                        <span><DriftIcon name="music" size={13} /> {file.musicTrack.title || file.musicTrack.name || 'Mixed soundtrack'}</span>
                        {onRemoveMusic && (
                          <button
                            type="button"
                            className="s2-mini-reset danger"
                            onClick={onRemoveMusic}
                          >
                            Remove Music
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                  <EpidemicCatalog
                    token={authToken}
                    files={file ? [file] : []}
                    selectedIndex={0}
                    onSelectVideo={() => {}}
                    onApply={async (_index, mixedFile, track) => {
                      if (onApplyMusic) await onApplyMusic(mixedFile, track);
                      else if (onApply) await onApply(mixedFile);
                      else if (onReplace) await onReplace(idx, mixedFile);
                    }}
                    summaryLabel={isVideo ? 'Browse Epidemic Sound tracks' : 'Add music & convert photo to video'}
                  />
                </section>
              </div>
            )}
          </div>

          {saveError && <p className="s2-err" role="alert" style={{ margin: '8px 14px' }}>{saveError}</p>}
        </aside>

        {/* CENTER INTERACTIVE STAGE */}
        <div
          className="s2-studio-stage"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) setActiveOverlayId('');
          }}
        >
          <div className="s2-studio-canvas-viewport">
            <div
              ref={stageContainerRef}
              className="s2-studio-canvas-wrap"
              style={{ transform: canvasZoom !== 100 ? `scale(${canvasZoom / 100})` : undefined }}
              onPointerDown={(e) => {
                if (e.target === e.currentTarget || e.target === previewCanvasRef.current) {
                  setActiveOverlayId('');
                }
              }}
            >
              <canvas
                ref={previewCanvasRef}
                className="s2-studio-live-canvas"
              />

              {/* INTERACTIVE CROP BOX OVERLAY (Only active when on Crop tab & Crop mode) */}
              {isInteractiveCropView && (
                <div
                  className="crop-box"
                  style={{
                    left: `${box.x}%`,
                    top: `${box.y}%`,
                    width: `${box.w}%`,
                    height: `${box.h}%`,
                  }}
                  onPointerDown={(e) => startCropDrag(e, 'move')}
                >
                  <div className="crop-grid" aria-hidden="true">
                    <i className="v1" /><i className="v2" />
                    <i className="h1" /><i className="h2" />
                  </div>
                  <span className="crop-badge">
                    {outputDimensions.w} × {outputDimensions.h}
                  </span>
                  {HANDLES.map((h) => (
                    <button
                      key={h}
                      type="button"
                      aria-label={`Resize crop ${h}`}
                      className={`crop-handle ${h}`}
                      onPointerDown={(e) => startCropDrag(e, h)}
                    />
                  ))}
                </div>
              )}

              {/* INTERACTIVE OVERLAY SELECTION & HANDLES LAYER (When not in uncropped view) */}
              {!isInteractiveCropView && !comparing && (
                <div
                  className="s2-overlay-layer"
                  onPointerDown={(e) => {
                    if (e.target === e.currentTarget) setActiveOverlayId('');
                  }}
                >
                  {overlays.map((item) => {
                    const selected = item.id === activeOverlayId;
                    return (
                      <div
                        key={item.id}
                        role="button"
                        tabIndex={0}
                        aria-label={item.kind === 'text' ? `Text layer ${item.text}` : `Shape layer ${item.shape}`}
                        className={`s2-overlay-item interactive-box${selected ? ' selected' : ''}`}
                        style={{
                          left: `${item.x}%`,
                          top: `${item.y}%`,
                          width: `${item.w}%`,
                          height: `${item.h}%`,
                          transform: item.rotation ? `rotate(${item.rotation}deg)` : undefined,
                        }}
                        onPointerDown={(e) => startOverlayDrag(e, item, 'move')}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          setActiveOverlayId(item.id);
                          setActiveTab('design');
                          window.setTimeout(() => textInputRef.current?.focus(), 40);
                        }}
                      >
                        {selected && (
                          <>
                            <button
                              type="button"
                              className="s2-rotate-handle"
                              aria-label="Rotate layer"
                              title="Drag to rotate"
                              onPointerDown={(e) => startOverlayDrag(e, item, 'rotate')}
                            >
                              ↻
                            </button>
                            {HANDLES.map((h) => (
                              <button
                                key={h}
                                type="button"
                                className={`s2-resize-handle ${h}`}
                                aria-label={`Resize ${h}`}
                                onPointerDown={(e) => startOverlayDrag(e, item, h)}
                              />
                            ))}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {comparing && (
                <div className="s2-compare-pill">Original (Unedited)</div>
              )}
            </div>
          </div>

          {/* LIVE VIDEO PLAYBACK TRANSPORT BAR UNDER THE CANVAS */}
          {isVideo && (
            <div className="s2-studio-video-bar">
              <button
                type="button"
                className="s2-studio-btn primary"
                onClick={toggleVideoPlay}
                disabled={saving || !mediaLoaded}
              >
                {videoPlaying ? '⏸ Pause' : '▶ Play'}
              </button>
              <span className="s2-video-time">{fmtTime(videoTime)}</span>
              <div className="s2-video-scrubber-wrap">
                <input
                  type="range"
                  min={trimStart}
                  max={Math.max(trimStart + 0.1, trimEnd || videoDuration || 1)}
                  step={0.05}
                  value={clamp(videoTime, trimStart, trimEnd || videoDuration || 1)}
                  onChange={(e) => seekVideoTo(Number(e.target.value))}
                />
              </div>
              <span className="s2-video-time">{fmtTime(trimEnd || videoDuration)}</span>
              <button
                type="button"
                className={videoMuted ? 's2-studio-btn active' : 's2-studio-btn icon'}
                onClick={() => setVideoMuted((m) => !m)}
                title={videoMuted ? 'Unmute preview' : 'Mute preview'}
              >
                <DriftIcon name={videoMuted ? 'volumeOff' : 'volumeOn'} size={14} />
              </button>
              <button
                type="button"
                className="s2-studio-btn ghost"
                onClick={() => {
                  if (videoSourceRef.current && !videoSourceRef.current.paused) {
                    videoSourceRef.current.pause();
                  }
                  setTimelineEditorOpen(true);
                }}
              >
                <DriftIcon name="crop" size={14} /> Filmstrip Trim
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
    </section>
  );
}
