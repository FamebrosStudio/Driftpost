const SURFACES = [
  '.ws-panel', '.ws-stat', '.ws-metric-card', '.ws-welcome', '.hist-panel',
  '.hist-row', '.hist-activity', '.cn-card', '.cn-brands', '.setup-card',
  '.s2-sec', '.s2-out', '.s2-editor', '.s3-work', '.s3-sched', '.team-video-panel',
  '.team-review-list', '.team-review-detail', '.approval-card', '.cg-card',
  '.automation-account', '.automation-setup', '.ws-campaign-account',
].join(',');

const ACTIONS = [
  '.ws-primary', '.ws-secondary', '.s1-primary', '.s1-ghost', '.continue-btn',
  '.s2-continue-btn', '.s3-postall', '.s3-schedall', '.s3-acts button',
  '.s2-out-acts button', '.s2-drop', '.s2-pill', '.s2-ed-btns button',
  '.hist-tab', '.cn-connect', '.cn-disconnect', '.ws-heading-action button',
  '.ws-calendar-heading-actions button', '.ws-analytics-actions button',
  '.ws-campaign-actions button', '.app-error-actions button',
].join(',');

const TARGETS = `${SURFACES},${ACTIONS},#root .ws button:not(.ws-nav button):not(.ws-text-button):not(.ws-collapse-toggle):not(.ws-theme-toggle):not(.ws-wordmark),#root .hist-shell button:not(.hist-tab),#root .stage1 button:not(.progress-step-button),#root .stage2 button:not(.progress-step-button),#root .stage3 button:not(.progress-step-button),#root .connect button:not(.ws-nav button),#root .team-video-page button,#root .approval-page button`;
const EDGE_RANGE = 30;
let active = new Set();

function writeGlow(element, event) {
  const rect = element.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
    element.style.removeProperty('--edge-glow-color');
    return false;
  }
  const distance = Math.min(x, y, rect.width - x, rect.height - y);
  const intensity = Math.max(0, Math.min(1, 1 - distance / EDGE_RANGE));
  const accent = getComputedStyle(element).getPropertyValue('--go').trim() || '#7dd3fc';
  element.style.setProperty('--edge-glow-color', `color-mix(in srgb, ${accent} ${Math.round(intensity * 54)}%, transparent)`);
  return true;
}

function onPointerMove(event) {
  if (event.pointerType === 'touch') return;
  const next = new Set();
  for (const node of event.composedPath()) {
    if (!(node instanceof Element)) continue;
    if (node.matches(TARGETS) && writeGlow(node, event)) next.add(node);
    if (node.id === 'root') break;
  }
  for (const element of active) {
    if (!next.has(element)) element.style.removeProperty('--edge-glow-color');
  }
  active = next;
}

function clearGlow() {
  for (const element of active) element.style.removeProperty('--edge-glow-color');
  active.clear();
}

document.addEventListener('pointermove', onPointerMove, { passive: true });
document.addEventListener('pointerleave', clearGlow);
window.addEventListener('blur', clearGlow);
