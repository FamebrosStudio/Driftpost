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

export function commentReplyModes(rules = {}) {
  const privateReplyEnabled = rules.comment_enabled === true;
  // Existing rows predate the explicit public-reply toggle. Preserve their
  // previous behavior until the user saves the new independent setting.
  const publicReplyEnabled = rules.public_reply_enabled === undefined
    ? privateReplyEnabled && !!String(rules.public_reply || '').trim()
    : rules.public_reply_enabled === true;
  return { privateReplyEnabled, publicReplyEnabled };
}

export function commentAutomationDecision(rules = {}, text = '') {
  const { privateReplyEnabled, publicReplyEnabled } = commentReplyModes(rules);
  const keyword = String(rules.comment_keyword || '').trim();
  const keywordMatched = !keyword || matchesAutomationKeyword(text, keyword);
  return {
    privateReplyEnabled,
    publicReplyEnabled,
    keywordMatched,
    shouldRun: (privateReplyEnabled || publicReplyEnabled) && keywordMatched,
  };
}

export function automationWebhookSubscriptions(rules = {}) {
  const { privateReplyEnabled, publicReplyEnabled } = commentReplyModes(rules);
  return {
    comments: privateReplyEnabled || publicReplyEnabled,
    messages: !!(String(rules.dm_keyword || '').trim() || String(rules.default_reply || '').trim()),
  };
}

export function validateAutomationRules(enabled, rules = {}) {
  if (enabled && !rules.comment_enabled && !rules.public_reply_enabled && !rules.dm_keyword && !rules.default_reply) {
    return 'Enable comment-to-DM, public comment replies, or an incoming-message rule before enabling automation.';
  }
  if (rules.comment_enabled && !rules.private_reply) return 'Add a private reply message or disable comment-to-DM.';
  if (rules.public_reply_enabled && !rules.public_reply) return 'Add a public comment reply or disable public comment replies.';
  if (rules.dm_keyword && !rules.dm_reply) return 'Add a reply for the incoming-message keyword.';
  return null;
}

const normalizeKeywordText = (value) => String(value || '').normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function matchesAutomationKeyword(text, configured) {
  const normalizedText = normalizeKeywordText(text);
  const keywords = String(configured || '').split(/[,;|\n]+/)
    .map(normalizeKeywordText).filter(Boolean);
  const searchableText = ` ${normalizedText} `;
  return !!normalizedText && keywords.some((keyword) => searchableText.includes(` ${keyword} `));
}

export function incomingMessageReplyText(rules = {}, text = '') {
  const keyword = String(rules.dm_keyword || '').trim();
  return keyword && matchesAutomationKeyword(text, keyword) ? rules.dm_reply : rules.default_reply;
}

export function incomingMessageReply(platform, senderId, text) {
  return { recipient: { id: senderId }, message: { text: String(text).slice(0, 1000) }, ...(platform === 'facebook' ? { messaging_type: 'RESPONSE' } : {}) };
}
