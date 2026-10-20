import test from 'node:test';
import assert from 'node:assert/strict';
import { captionQualityIssue, dedupeRepeatedSentences, requestedCaptionPlatforms } from '../src/ai.js';
import { captionFillerIssues, youtubeFallbackDescription } from '../src/caption-guards.js';

const memory = { loadBrands: () => [] };
const valid = {
  youtube: { title: 'A considered look at this new collection', description: 'A new collection brings together thoughtful details and versatile pieces. Explore the style and find the one that feels right for you.' },
  instagram: { caption: 'A closer look at the details that make this collection feel special. Find a piece that fits your everyday style.' },
  facebook: { message: 'Thoughtful details, made for everyday moments. Take a closer look at the new collection and tell us which piece you would choose.' },
  x: { text: 'Thoughtful details for everyday style. Take a closer look at the new collection.' },
};

test('caption platform selection preserves explicit choices and rejects an empty selection', () => {
  assert.deepEqual(requestedCaptionPlatforms('["instagram","facebook","instagram"]'), ['instagram', 'facebook']);
  assert.deepEqual(requestedCaptionPlatforms('', ['x']), ['x']);
  assert.deepEqual(requestedCaptionPlatforms(''), ['youtube', 'instagram', 'facebook', 'x']);
  assert.throws(() => requestedCaptionPlatforms('[]'), /Choose at least one valid platform/);
  assert.throws(() => requestedCaptionPlatforms('["tiktok"]'), /Choose at least one valid platform/);
  assert.throws(() => requestedCaptionPlatforms('not-a-platform'), /Choose at least one valid platform/);
});

test('caption quality validation requires a usable YouTube title', () => {
  const draft = structuredClone(valid);
  draft.youtube.title = '';
  assert.equal(captionQualityIssue(draft, { platforms: ['youtube'], mem: memory }), 'youtube title is missing or too long');
  draft.youtube.title = 'A'.repeat(101);
  assert.equal(captionQualityIssue(draft, { platforms: ['youtube'], mem: memory }), 'youtube title is missing or too long');
  draft.youtube.title = valid.youtube.title;
  assert.equal(captionQualityIssue(draft, { platforms: ['youtube'], mem: memory }), '');
});

test('caption quality validation prevents X copy from exceeding its character limit', () => {
  const draft = structuredClone(valid);
  draft.x.text = 'A'.repeat(281);
  assert.equal(captionQualityIssue(draft, { platforms: ['x'], mem: memory }), 'x exceeds 280 characters');
  draft.x.text = 'A'.repeat(280);
  assert.equal(captionQualityIssue(draft, { platforms: ['x'], mem: memory }), '');
});

test('filler phrases in a platform body fail the caption quality check', () => {
  const draft = structuredClone(valid);
  draft.instagram.caption = 'This new collection is a game-changer for your everyday style. Save it for later.';
  const issue = captionQualityIssue(draft, { platforms: ['instagram'], mem: memory });
  assert.equal(issue, 'instagram caption uses filler phrase "game-changer"');
  assert.match(issue, /instagram/);
  assert.match(issue, /game-changer/);
});

test('a clean platform body passes the caption quality check', () => {
  const draft = structuredClone(valid);
  assert.equal(captionQualityIssue(draft, { platforms: ['instagram'], mem: memory }), '');
  assert.equal(captionQualityIssue(draft, { platforms: ['instagram', 'facebook', 'youtube', 'x'], mem: memory }), '');
});

test('near-identical platform bodies fail the caption quality check', () => {
  const draft = structuredClone(valid);
  draft.facebook.message = draft.instagram.caption;
  assert.equal(
    captionQualityIssue(draft, { platforms: ['instagram', 'facebook'], mem: memory }),
    'instagram and facebook captions are nearly identical',
  );
});

test('a platform body that only extends another one is still a duplicate', () => {
  const draft = structuredClone(valid);
  draft.facebook.message = `${draft.instagram.caption} Ask us in store.`;
  assert.equal(
    captionQualityIssue(draft, { platforms: ['instagram', 'facebook'], mem: memory }),
    'instagram and facebook captions are nearly identical',
  );
});

test('clearly different platform bodies pass the distinctness check', () => {
  const draft = structuredClone(valid);
  assert.equal(captionQualityIssue(draft, { platforms: ['instagram', 'facebook'], mem: memory }), '');
  assert.equal(captionQualityIssue(draft, { platforms: ['instagram', 'facebook', 'x'], mem: memory }), '');
});

test('the YouTube fallback description passes the caption quality check it is built for', () => {
  const description = youtubeFallbackDescription({
    title: 'Bridal gold sets at Chembur',
    brandName: 'Kanchan Mala Jewellers',
    category: 'Jewellery store',
    city: 'Mumbai',
    products: ['Pure gold jewellery', 'Silver jewellery', 'Custom-made jewellery'],
    facts: ['Trading in Chembur since 1992'],
    brief: 'A close look at a bridal gold set with a floral engraving',
    goal: 'enquiries',
  });
  const draft = { youtube: { title: 'Bridal gold sets at Chembur', description } };
  assert.equal(captionQualityIssue(draft, { platforms: ['youtube'], mem: memory }), '');
  assert.deepEqual(captionFillerIssues(description), []);
});

test('repeated sentences and a repeated CTA line are removed from one caption body', () => {
  const body = [
    'A gold ring with a floral engraving.',
    'DM us to book.',
    'DM us to book.',
    'A gold ring with a floral engraving.',
  ].join('\n');
  assert.equal(dedupeRepeatedSentences(body), 'A gold ring with a floral engraving.\nDM us to book.');
  assert.equal(
    dedupeRepeatedSentences('A gold ring with a floral engraving. DM us to book. DM us to book.'),
    'A gold ring with a floral engraving. DM us to book.',
  );
});
