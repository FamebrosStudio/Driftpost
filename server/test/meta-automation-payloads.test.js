import test from 'node:test';
import assert from 'node:assert/strict';
import { automationComment, automationWebhookSubscriptions, commentAutomationDecision, commentReplyEdge, commentReplyModes, incomingMessageReply, matchesAutomationKeyword } from '../src/meta-automation-payloads.js';

const comment = { field: 'feed', value: { item: 'comment', verb: 'add', comment_id: 'post_comment', post_id: 'post', parent_id: 'post', from: { id: 'customer' }, message: 'PRICE' } };
test('Facebook feed comments are normalized for matching and use the comment replies edge', () => {
  assert.deepEqual(automationComment('facebook', comment, 'page'), { id: 'post_comment', text: 'PRICE' });
  assert.equal(commentReplyEdge('facebook'), 'comments');
  assert.equal(commentReplyEdge('instagram'), 'replies');
});
test('Facebook ignores own comments, nested replies, edits, removals and non-comment feed events', () => {
  for (const patch of [{ from: { id: 'page' } }, { parent_id: 'another_comment' }, { verb: 'edited' }, { verb: 'remove' }, { item: 'post' }]) {
    assert.equal(automationComment('facebook', { ...comment, value: { ...comment.value, ...patch } }, 'page'), null);
  }
});
test('Instagram parsing stays separate from Page feed parsing', () => {
  assert.deepEqual(automationComment('instagram', { field: 'comments', value: { id: 'ig-comment', text: 'Hi', from: { id: 'customer' } } }, 'ig'), { id: 'ig-comment', text: 'Hi' });
  assert.deepEqual(automationComment('instagram', { field: 'live_comments', value: { comment_id: 'live-comment', message: 'Hello', from: { id: 'customer' } } }, 'ig'), { id: 'live-comment', text: 'Hello' });
  assert.equal(automationComment('instagram', comment, 'ig'), null);
  assert.equal(automationComment('instagram', { field: 'comments', value: { id: 'echo', from: { id: 'ig' } } }, 'ig'), null);
});
test('Messenger replies explicitly use RESPONSE while Instagram retains its existing message payload', () => {
  assert.deepEqual(incomingMessageReply('facebook', 'customer', 'Hello'), { recipient: { id: 'customer' }, message: { text: 'Hello' }, messaging_type: 'RESPONSE' });
  assert.equal('messaging_type' in incomingMessageReply('instagram', 'customer', 'Hello'), false);
});

test('automation keywords match case, punctuation, accents, and any configured alternative', () => {
  assert.equal(matchesAutomationKeyword('PRICE, please!', 'price'), true);
  assert.equal(matchesAutomationKeyword('I want the CAFÉ details', 'hours; cafe | price'), true);
  assert.equal(matchesAutomationKeyword('Can you share the menu?', 'hours, price'), false);
  assert.equal(matchesAutomationKeyword('I love this apple pie', 'pp'), false);
  assert.equal(matchesAutomationKeyword('PP details please', 'pp'), true);
  assert.equal(matchesAutomationKeyword('Anything at all', ''), false);
});

test('private comment DMs and public comment replies can be enabled independently', () => {
  assert.deepEqual(commentReplyModes({ comment_enabled: true, public_reply_enabled: false, private_reply: 'DM text', public_reply: 'Public text' }), { privateReplyEnabled: true, publicReplyEnabled: false });
  assert.deepEqual(commentReplyModes({ comment_enabled: false, public_reply_enabled: true, public_reply: 'Public text' }), { privateReplyEnabled: false, publicReplyEnabled: true });
  assert.deepEqual(commentReplyModes({ comment_enabled: true, public_reply: 'Legacy public', private_reply: '' }), { privateReplyEnabled: true, publicReplyEnabled: true });
});

test('public-only comment rules run without enabling comment DMs', () => {
  assert.equal(commentAutomationDecision({ comment_enabled: false, public_reply_enabled: true, public_reply: 'Thanks!', comment_keyword: '' }, 'Any comment').shouldRun, true);
  assert.equal(commentAutomationDecision({ comment_enabled: false, public_reply_enabled: true, public_reply: 'Thanks!', comment_keyword: 'price' }, 'PRICE please').shouldRun, true);
  assert.equal(commentAutomationDecision({ comment_enabled: false, public_reply_enabled: true, public_reply: 'Thanks!', comment_keyword: 'price' }, 'Hours please').shouldRun, false);
  assert.deepEqual(commentAutomationDecision({ comment_enabled: false, public_reply_enabled: false, comment_keyword: '' }, 'Any comment'), { privateReplyEnabled: false, publicReplyEnabled: false, keywordMatched: true, shouldRun: false });
});

test('webhook subscriptions follow enabled triggers rather than leftover reply text', () => {
  assert.deepEqual(automationWebhookSubscriptions({ public_reply_enabled: true, public_reply: 'Thanks', private_reply: 'Old DM text' }), { comments: true, messages: false });
  assert.deepEqual(automationWebhookSubscriptions({ comment_enabled: true, private_reply: 'Private reply' }), { comments: true, messages: false });
  assert.deepEqual(automationWebhookSubscriptions({ default_reply: 'Inbox reply' }), { comments: false, messages: true });
  assert.deepEqual(automationWebhookSubscriptions({}), { comments: false, messages: false });
});
