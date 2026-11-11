// Normalize only new top-level comments. Ignore edits, removals and Page echoes.
export function automationComment(platform, change, accountId) {
  if (platform === 'instagram') {
    if (!['comments', 'live_comments'].includes(change.field)) return null;
    const value = change.value || {};
    const id = value.id || value.comment_id;
    if (!id || String(value.from?.id || '') === String(accountId)) return null;
    return { id: String(id), text: String(value.text || value.message || '') };
  }
  if (platform !== 'facebook' || change.field !== 'feed') return null;
  const value = change.value || {};
  if (value.item !== 'comment' || value.verb !== 'add' || !value.comment_id) return null;
  if (String(value.from?.id || '') === String(accountId)) return null;
  // A reply to a comment is not a new comment on the Page post.
  if (value.parent_id && value.post_id && String(value.parent_id) !== String(value.post_id)) return null;
  return { id: String(value.comment_id), text: String(value.message || value.text || '') };
}

export function commentReplyEdge(platform) {
  return platform === 'facebook' ? 'comments' : 'replies';
}

const normalizeKeywordText = (value) => String(value || '').normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function matchesAutomationKeyword(text, configured) {
  const normalizedText = normalizeKeywordText(text);
  const keywords = String(configured || '').split(/[,;|\n]+/)
    .map(normalizeKeywordText).filter(Boolean);
  return !!normalizedText && keywords.some((keyword) => normalizedText.includes(keyword));
}

export function incomingMessageReply(platform, senderId, text) {
  return { recipient: { id: senderId }, message: { text: String(text).slice(0, 1000) }, ...(platform === 'facebook' ? { messaging_type: 'RESPONSE' } : {}) };
}
