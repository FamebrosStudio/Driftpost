import test from 'node:test';
import assert from 'node:assert/strict';
import {
  captionBodiesNearlyIdentical,
  captionFillerIssues,
  enabledInstagramCollaborators,
  instagramCaptionRequiredError,
  nonEmptyCaption,
  safeBrandHashtags,
  safeTopicHashtags,
  topicRelevantPhrases,
  youtubeFallbackDescription,
} from '../src/caption-guards.js';
import { loadCaptionDraft, saveCaptionDraft } from '../../src/stage2/captionDraftScope.js';

const selected = {
  id: 'kanchan_mala',
  name: 'Kanchan Mala Jewellers',
  aliases: ['Kanchanmala Jewellers'],
  ig: 'kanchanmala.jewellers',
};
const other = [
  { id: 'other_jeweller', name: 'Maha Laxmi Jewellers', aliases: ['Mahalaxmi Jewellers'], ig: 'mahalaxmi.jewellers' },
  { id: 'salon', name: 'Luxxe Salon', aliases: [], ig: 'luxxesalon' },
];

test('caption fallback ignores empty and whitespace-only platform fields', () => {
  assert.equal(nonEmptyCaption('', 'A real brief caption'), 'A real brief caption');
  assert.equal(nonEmptyCaption('   ', 'A real brief caption'), 'A real brief caption');
  assert.equal(nonEmptyCaption('  Edited caption  ', 'A real brief caption'), 'Edited caption');
  assert.equal(nonEmptyCaption('', ''), '');
});

test('brand hashtags retain the selected brand and only topic-supported, non-competing tags', () => {
  const tags = safeBrandHashtags({
    brand: selected,
    brief: 'Show a gold ring with a delicate floral engraving',
    otherBrands: other,
    candidates: [
      '#KanchanMalaJewellers', '#goldring', '#floralengraving', '#bridalwear',
      '#MahaLaxmiJewellers', '#luxxesalon', '#fashion',
    ],
  });
  assert.deepEqual(tags, ['KanchanMalaJewellers', 'goldring', 'floralengraving']);
});

test('no unrelated hashtags or SEO phrases are invented to fill a quota', () => {
  assert.deepEqual(safeBrandHashtags({
    brand: selected,
    brief: 'A behind-the-scenes video from today',
    otherBrands: other,
    candidates: ['bridalwear', 'goldjewellery', 'luxxesalon'],
  }), ['KanchanMalaJewellers']);
  assert.deepEqual(topicRelevantPhrases(['bridal lehenga', 'gold ring', 'hair spa'], 'gold ring close-up'), ['gold ring']);
});

test('unbranded creator captions keep only hashtags grounded in the user brief', () => {
  assert.deepEqual(safeTopicHashtags({
    brief: 'A gold ring with floral engraving, make an Instagram reel',
    candidates: ['#goldring', '#floralEngraving', '#viral', '#instagramgrowth', '#fashion'],
  }), ['goldring', 'floralEngraving']);
  assert.deepEqual(safeTopicHashtags({
    brief: 'A quiet day in my life',
    candidates: ['#viral', '#foryou', '#trending'],
  }), []);
});

test('collaborator handles are ignored unless the post explicitly opts in', () => {
  const parse = (raw) => ({ usernames: String(raw || '').split(',').filter(Boolean), error: '' });
  assert.deepEqual(enabledInstagramCollaborators({ ig_collabs: 'someone' }, parse), { usernames: [], error: '' });
  assert.deepEqual(enabledInstagramCollaborators({ ig_collabs_enabled: '1', ig_collabs: 'someone' }, parse), { usernames: ['someone'], error: '' });
});

test('Instagram publishing and mirrors fail closed if both caption fields are empty', () => {
  assert.match(instagramCaptionRequiredError('instagram', { ig_caption: ' ', text: '' }), /Add a caption/);
  assert.equal(instagramCaptionRequiredError('instagram', { ig_caption: '', text: 'Use the reviewed draft' }), '');
  assert.match(instagramCaptionRequiredError('facebook', { fb_synd_ig: '1', fb_message: '', text: '' }), /Add a caption/);
  assert.equal(instagramCaptionRequiredError('facebook', { fb_synd_ig: '', fb_message: '', text: '' }), '');
});

test('saved caption drafts cannot silently carry over to a different selected brand/account set', () => {
  const previous = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
  try {
    const base = { type: 'common_brand', brandKey: 'brand-a', platforms: ['instagram', 'facebook'], pinnedAccounts: { instagram: 'a1' } };
    const captions = { instagram: { caption: 'A caption for brand A' } };
    saveCaptionDraft('user-1', base, captions);
    assert.deepEqual(loadCaptionDraft('user-1', base), captions);
    assert.deepEqual(loadCaptionDraft('user-1', { ...base, brandKey: 'brand-b' }), {});
    assert.deepEqual(loadCaptionDraft('user-1', { ...base, pinnedAccounts: { instagram: 'a2' } }), {});
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
});

test('the filler gate names the platform and the banned phrase', () => {
  assert.deepEqual(
    captionFillerIssues('This new collection is a game-changer for your everyday style.', { platform: 'instagram' }),
    ['instagram caption uses filler phrase "game-changer"'],
  );
  assert.deepEqual(
    captionFillerIssues('We delve into the details of every setting.', { platform: 'facebook' }),
    ['facebook caption uses filler phrase "delve"'],
  );
  assert.deepEqual(captionFillerIssues('Best shade ever!!!', { platform: 'x' }), ['x caption uses filler phrase "!!!"']);
  assert.deepEqual(captionFillerIssues('Ready to start???', { platform: 'x' }), ['x caption uses filler phrase "???"']);
});

test('the filler gate leaves ordinary business vocabulary and clean copy alone', () => {
  assert.deepEqual(captionFillerIssues('', { platform: 'instagram' }), []);
  assert.deepEqual(captionFillerIssues('A curated selection of bridal sets, available in store now.', { platform: 'instagram' }), []);
  assert.deepEqual(captionFillerIssues('Our offers and discounts are listed at the counter.', { platform: 'facebook' }), []);
  assert.deepEqual(captionFillerIssues('Please unlock the shop door on arrival.', { platform: 'facebook' }), []);
  assert.deepEqual(captionFillerIssues('A precise look at the gold chain clasp and its finishing.', { platform: 'youtube' }), []);
});

test('unlock is only filler when it sells a benefit', () => {
  assert.deepEqual(
    captionFillerIssues('Unlock your everyday look with this new set.', { platform: 'instagram' }),
    ['instagram caption uses filler phrase "unlock your"'],
  );
});

test('near-identical bodies are detected and clearly different bodies are not', () => {
  const ig = 'A closer look at the details that make this collection feel special. Find a piece that fits your everyday style.';
  const same = 'A closer look at the details that make this collection feel special. Find a piece that fits your everyday style.';
  const extended = `${ig} Ask us in store.`;
  const different = 'Thoughtful details, made for everyday moments. Take a closer look at the new collection and tell us which piece you would choose.';
  assert.equal(captionBodiesNearlyIdentical(ig, same), true);
  assert.equal(captionBodiesNearlyIdentical(ig, extended), true);
  assert.equal(captionBodiesNearlyIdentical(ig, different), false);
  assert.equal(captionBodiesNearlyIdentical('', different), false);
});

test('the YouTube fallback writes a specific description from the title, brief and verified brand facts', () => {
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
  const old = 'Discover Bridal gold sets at Chembur. Get in touch with Kanchan Mala Jewellers to learn more.';
  assert.ok(description.length > old.length, `fallback should be longer than the old one-liner: ${description}`);
  assert.match(description, /Bridal gold sets at Chembur/);
  assert.match(description, /Kanchan Mala Jewellers/);
  assert.match(description, /floral engraving/);
  assert.deepEqual(captionFillerIssues(description), []);
  assert.doesNotMatch(description, /\d{7,}/);
  assert.doesNotMatch(description, /(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}/);
});

test('the YouTube fallback never invents contact numbers and stays filler free when the title is dirty', () => {
  const description = youtubeFallbackDescription({
    title: 'A game-changer for your wardrobe, call 9876543210',
    brandName: 'Kanchan Mala Jewellers',
    category: 'Jewellery store',
    city: 'Mumbai',
    products: ['Pure gold jewellery'],
    facts: [],
    brief: 'A close look at a floral gold ring',
  });
  assert.deepEqual(captionFillerIssues(description), []);
  assert.doesNotMatch(description, /\d{7,}/);
  assert.doesNotMatch(description, /game-changer/i);
  assert.match(description, /floral gold ring/);
});
