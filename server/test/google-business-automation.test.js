import test from 'node:test';
import assert from 'node:assert/strict';
import { businessProfileErrorMessage, businessReviewRating, DEFAULT_REVIEW_REPLIES, HAIR_MATCH_SALON_REPLY, pickBusinessReviewReply, sanitizeStarReplies, shouldAutoReplyToBusinessReview } from '../src/google.js';

test('Google Business Profile location discovery errors explain quota, API and access failures', () => {
  assert.match(businessProfileErrorMessage(new Error('Quota exceeded for Requests per minute')), /temporarily rate-limited/i);
  assert.match(businessProfileErrorMessage(new Error('API has not been used in project or it is disabled')), /API is disabled/i);
  assert.match(businessProfileErrorMessage(new Error('Permission denied for account')), /sufficient Business Profile access/i);
  assert.match(businessProfileErrorMessage(new Error('unexpected error')), /Google account connected, but locations could not be loaded/i);
  assert.match(businessProfileErrorMessage(new Error('unexpected error'), 'reviews'), /Could not load or reply to Google reviews/i);
});

test('Google review star enum values normalize safely', () => {
  assert.equal(businessReviewRating('FIVE'), 5);
  assert.equal(businessReviewRating('ONE'), 1);
  assert.equal(businessReviewRating(4), 4);
  assert.equal(businessReviewRating('unknown'), 0);
});

test('review auto-reply respects rating threshold, existing owner replies and blank templates', () => {
  const rules = { minimum_rating: 4, reply_text: 'Thank you for your feedback.' };
  assert.equal(shouldAutoReplyToBusinessReview({ name: 'reviews/r1', starRating: 'FIVE' }, rules), true);
  assert.equal(shouldAutoReplyToBusinessReview({ name: 'reviews/r2', starRating: 'THREE' }, rules), false);
  assert.equal(shouldAutoReplyToBusinessReview({ name: 'reviews/r3', starRating: 'FIVE', reviewReply: { comment: 'Already replied' } }, rules), false);
  assert.equal(shouldAutoReplyToBusinessReview({ name: 'reviews/r4', starRating: 'FIVE' }, { ...rules, reply_text: '  ' }), false);
  assert.equal(shouldAutoReplyToBusinessReview({ starRating: 'FIVE' }, rules), false);
});

test('default star-based replies cover 1-5 stars automatically without custom text', () => {
  for (const [star, enumName] of [[1, 'ONE'], [2, 'TWO'], [3, 'THREE'], [4, 'FOUR'], [5, 'FIVE']]) {
    assert.equal(DEFAULT_REVIEW_REPLIES[star].length, 8);
    const reply = pickBusinessReviewReply({ name: `accounts/a/locations/l/reviews/rev-${star}`, starRating: enumName }, { mode: 'default', minimum_rating: 1 });
    assert.equal(DEFAULT_REVIEW_REPLIES[star].includes(reply), true);
    assert.equal(shouldAutoReplyToBusinessReview({ name: `accounts/a/locations/l/reviews/rev-${star}`, starRating: enumName }, { mode: 'default' }), true);
  }
  assert.equal(pickBusinessReviewReply({ name: 'reviews/r-low', starRating: 'TWO' }, { mode: 'default', minimum_rating: 4 }), '');
  assert.equal(pickBusinessReviewReply({ name: 'reviews/r-done', starRating: 'FIVE', reviewReply: { comment: 'Thanks' } }, { mode: 'default' }), '');
  assert.equal(pickBusinessReviewReply({ name: 'reviews/hm-1', starRating: 'ONE' }, { mode: 'default' }, 'Hair Match Salon'), HAIR_MATCH_SALON_REPLY);
  const custom = sanitizeStarReplies({ 1: ['Custom 1-star apology'] });
  assert.equal(pickBusinessReviewReply({ name: 'reviews/c-1', starRating: 'ONE' }, { mode: 'default', star_replies: custom }), 'Custom 1-star apology');
});
