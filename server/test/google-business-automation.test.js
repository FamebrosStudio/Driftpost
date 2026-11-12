import test from 'node:test';
import assert from 'node:assert/strict';
import { businessProfileErrorMessage, businessReviewRating, shouldAutoReplyToBusinessReview } from '../src/google.js';

test('Google Business Profile location discovery errors explain quota, API and access failures', () => {
  assert.match(businessProfileErrorMessage(new Error('Quota exceeded for Requests per minute')), /temporarily rate-limited/i);
  assert.match(businessProfileErrorMessage(new Error('API has not been used in project or it is disabled')), /API is disabled/i);
  assert.match(businessProfileErrorMessage(new Error('Permission denied for account')), /sufficient Business Profile access/i);
  assert.match(businessProfileErrorMessage(new Error('unexpected error')), /Google account connected, but locations could not be loaded/i);
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
