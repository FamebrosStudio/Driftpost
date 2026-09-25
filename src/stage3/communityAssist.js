// YouTube Community Posts have no Data API endpoint — Google's resource list
// has no posts type, and even Buffer can't do it. Only a browser logged into
// Google can create one, so we refuse to hold your Google session and instead
// do the tedious half: stage the photo and caption, then deep-link Studio's
// Posts tab. The user goes from hunting for a file to paste + Post.

const STUDIO = 'https://studio.youtube.com/';

export function communityText(values = {}) {
  const body = String(values.description || '').trim();
  const tags = String(values.tags || '').trim();
  if (body && tags) return `${body}\n\n${tags}`;
  return body || tags || '';
}

export function postsUrl(channelId) {
  return channelId ? `${STUDIO}channel/${channelId}/editing/community` : STUDIO;
}

export async function assistCommunityPost({ file, values, channelId }) {
  const text = communityText(values);
  let copied = false;
  try {
    if (text && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      copied = true;
    }
  } catch { /* clipboard blocked — the text is still shown for manual copy */ }

  // Save the photo so the Studio picker already has it.
  let saved = false;
  try {
    if (file) {
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name || 'photo';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      saved = true;
    }
  } catch { /* download blocked — the original is still in Stage 2 */ }

  let opened = false;
  try { opened = !!window.open(postsUrl(channelId), '_blank', 'noopener'); } catch { /* popup blocked */ }

  return { copied, saved, opened };
}
