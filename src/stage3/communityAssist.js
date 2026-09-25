// YouTube Community Posts have no Data API endpoint — Google's resource list
// has no posts type, and even Buffer can't do it. Only a browser logged into
// Google can create one, so we refuse to hold your Google session and instead
// do the tedious half: stage the photo and caption, then hand off to Studio.
// (YouTube renamed "Community" to "Posts" in 2025.)

const YT = 'https://www.youtube.com/';

// A channel's Posts tab is a real, server-rendered path (an unknown path falls
// back to the default videos tab, so it is distinguishable), and
// `show_create_dialog=1` opens the composer itself. The composer needs the
// signed-in owner, which is exactly why we hand off instead of automating.
export function postsUrl(channelId) {
  return channelId ? `${YT}channel/${channelId}/posts?show_create_dialog=1` : `${YT}feed/posts`;
}

// Fallback if the dialog doesn't open — the same Posts tab, without the flag.
export function postsTabUrl(channelId) {
  return channelId ? `${YT}channel/${channelId}/posts` : `${YT}feed/posts`;
}

export function communityText(values = {}) {
  const body = String(values.description || '').trim();
  const tags = String(values.tags || '').trim();
  if (body && tags) return `${body}\n\n${tags}`;
  return body || tags || '';
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
