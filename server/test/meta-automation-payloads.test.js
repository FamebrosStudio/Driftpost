import test from 'node:test';
import assert from 'node:assert/strict';
import { automationComment, commentReplyEdge, incomingMessageReply } from '../src/meta-automation-payloads.js';

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
  assert.equal(automationComment('instagram', comment, 'ig'), null);
  assert.equal(automationComment('instagram', { field: 'comments', value: { id: 'echo', from: { id: 'ig' } } }, 'ig'), null);
});
test('Messenger replies explicitly use RESPONSE while Instagram retains its existing message payload', () => {
  assert.deepEqual(incomingMessageReply('facebook', 'customer', 'Hello'), { recipient: { id: 'customer' }, message: { text: 'Hello' }, messaging_type: 'RESPONSE' });
  assert.equal('messaging_type' in incomingMessageReply('instagram', 'customer', 'Hello'), false);
});
