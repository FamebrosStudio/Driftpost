import test from 'node:test';
import assert from 'node:assert/strict';
import { enabledInstagramCollaborators, instagramCaptionRequiredError, nonEmptyCaption, safeBrandHashtags, safeTopicHashtags, topicRelevantPhrases } from '../src/caption-guards.js';
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
