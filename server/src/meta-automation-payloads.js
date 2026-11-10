// Normalize only new top-level comments. Ignore edits, removals and Page echoes.
export function automationComment(platform, change, accountId) {
  if (platform === 'instagram') {
    if (change.field !== 'comments') return null;
    const value = change.value || {};
    if (!value.id || String(value.from?.id || '') === String(accountId)) return null;
    return { id: String(value.id), text: String(value.text || '') };
  }
  if (platform !== 'facebook' || change.field !== 'feed') return null;
  const value = change.value || {};
  if (value.item !== 'comment' || value.verb !== 'add' || !value.comment_id) return null;
  if (String(value.from?.id || '') === String(accountId)) return null;
  // A reply to a comment is not a new comment on the Page post.
  if (value.parent_id && value.post_id && String(value.parent_id) !== String(value.post_id)) return null;
  return { id: String(value.comment_id), text: String(value.message || '') };
}

export function commentReplyEdge(platform) {
  return platform === 'facebook' ? 'comments' : 'replies';
}

export function incomingMessageReply(platform, senderId, text) {
  return { recipient: { id: senderId }, message: { text: String(text).slice(0, 1000) }, ...(platform === 'facebook' ? { messaging_type: 'RESPONSE' } : {}) };
}
