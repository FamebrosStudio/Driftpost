import test from 'node:test';
import assert from 'node:assert/strict';
import { platformsNeedingGeneratedCovers } from '../src/telegram-intake.js';
import {
  CAROUSEL_IMAGE_MIME_TYPES,
  carouselImageLimitBytes,
  isAcceptedCarouselImageType,
  needsJpegConversion,
  parseDestination,
} from '../src/google-drive-intake.js';

test('photo carousels do not require generated video cover frames', () => {
  assert.deepEqual(platformsNeedingGeneratedCovers(true, ['facebook', 'instagram']), []);
});

test('video cover generation is limited to platforms that support selected covers', () => {
  assert.deepEqual(
    platformsNeedingGeneratedCovers(false, ['facebook', 'x', 'instagram', 'facebook']),
    ['facebook', 'instagram'],
  );
});

test('drive filenames with a duplicate upload marker resolve the account', () => {
  assert.equal(parseDestination('famebros social (2).mp4').accountName, 'famebros social');
  assert.deepEqual(parseDestination('famebros social (2).mp4').accountNames, ['famebros social']);
});

test('drive filenames with a copy marker resolve the account', () => {
  assert.equal(parseDestination('Famebros Social copy.jpg').accountName, 'Famebros Social');
  assert.equal(parseDestination('Famebros Social - Copy.jpg').accountName, 'Famebros Social');
  assert.equal(parseDestination('Famebros Social (copy).jpg').accountName, 'Famebros Social');
});

test('drive filenames with an ordering number resolve the account', () => {
  assert.equal(parseDestination('famebros social 01.jpg').accountName, 'famebros social');
  assert.equal(parseDestination('famebros social slide 1.jpg').accountName, 'famebros social');
  assert.equal(parseDestination('famebros social - slide 2.jpg').accountName, 'famebros social');
});

test('drive filenames keep the requested platform suffix', () => {
  const parsed = parseDestination('famebros social -- facebook,instagram.mp4');
  assert.deepEqual(parsed.platforms, ['facebook', 'instagram']);
  assert.equal(parsed.accountName, 'famebros social');
});

test('drive filenames keep comma separated account names', () => {
  const parsed = parseDestination('famebros social, famebros studio (2).mp4');
  assert.deepEqual(parsed.accountNames, ['famebros social', 'famebros studio']);
});

test('drive carousels accept the common photo formats and reject other files', () => {
  assert.ok(CAROUSEL_IMAGE_MIME_TYPES.includes('image/webp'));
  assert.ok(CAROUSEL_IMAGE_MIME_TYPES.includes('image/heic'));
  assert.ok(CAROUSEL_IMAGE_MIME_TYPES.includes('image/jpg'));
  assert.ok(isAcceptedCarouselImageType('image/webp'));
  assert.ok(isAcceptedCarouselImageType('image/heic'));
  assert.ok(isAcceptedCarouselImageType('image/jpg'));
  assert.ok(isAcceptedCarouselImageType('image/avif'));
  assert.ok(isAcceptedCarouselImageType('image/heif'));
  assert.ok(isAcceptedCarouselImageType('image/jpeg'));
  assert.ok(isAcceptedCarouselImageType('image/png'));
  assert.equal(isAcceptedCarouselImageType('application/pdf'), false);
  assert.equal(isAcceptedCarouselImageType('video/mp4'), false);
  assert.equal(isAcceptedCarouselImageType('image/gif'), false);
  assert.equal(isAcceptedCarouselImageType(''), false);
});

test('only the extra photo formats are converted to jpeg', () => {
  assert.equal(needsJpegConversion('image/webp'), true);
  assert.equal(needsJpegConversion('image/heic'), true);
  assert.equal(needsJpegConversion('image/jpeg'), false);
  assert.equal(needsJpegConversion('image/png'), false);
});

test('carousel image limits follow the destination platforms', () => {
  assert.equal(carouselImageLimitBytes(['instagram']), 8 * 1024 * 1024);
  assert.equal(carouselImageLimitBytes(['instagram', 'facebook']), 8 * 1024 * 1024);
  assert.equal(carouselImageLimitBytes(['facebook', 'x']), 10 * 1024 * 1024);
  assert.equal(carouselImageLimitBytes([]), 10 * 1024 * 1024);
});
