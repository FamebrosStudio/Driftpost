import test from 'node:test';
import assert from 'node:assert/strict';
import { platformsNeedingGeneratedCovers, saveBrandReview } from '../src/intake-processor.js';
import {
  CAROUSEL_IMAGE_MIME_TYPES,
  carouselImageLimitBytes,
  enqueueFiles,
  isAcceptedCarouselImageType,
  isIntakeImageFile,
  isIntakeVideoFile,
  needsJpegConversion,
  normalizeIntakeImageMime,
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

test('brand review details survive deployments that have not applied the review-status migration', async () => {
  const updates = [];
  const supabase = {
    from: () => ({
      update(payload) {
        updates.push(payload);
        const query = {
          eq() { return query; },
          select() { return query; },
          async maybeSingle() {
            return payload.status === 'review'
              ? { data: null, error: { message: 'status check constraint violation' } }
              : { data: { id: 'held-job' }, error: null };
          },
        };
        return query;
      },
    }),
  };
  const result = { brand_reviews: [{ brand_id: 'brand-1', reason: 'uncertain' }] };
  assert.equal(await saveBrandReview(supabase, 'google_drive_video_jobs', { id: 'held-job' }, 'AI held this video.', result), 'failed');
  assert.deepEqual(updates.map((update) => update.status), ['review', 'failed']);
  assert.deepEqual(updates[1].result, result);
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

test('drive intake detects videos and images even when Drive reports application/octet-stream', () => {
  assert.equal(isIntakeVideoFile({ name: 'Hair Match.mp4', mimeType: 'video/mp4' }), true);
  assert.equal(isIntakeVideoFile({ name: 'Hair Match.mov', mimeType: 'application/octet-stream' }), true);
  assert.equal(isIntakeVideoFile({ name: 'Hair Match.mp4', mimeType: 'application/mp4' }), true);
  assert.equal(isIntakeVideoFile({ name: 'notes.txt', mimeType: 'text/plain' }), false);

  assert.equal(isIntakeImageFile({ name: 'Hair Match 01.heic', mimeType: 'application/octet-stream' }), true);
  assert.equal(normalizeIntakeImageMime({ name: 'Hair Match 01.heic', mimeType: 'application/octet-stream' }), 'image/heic');
  assert.equal(isIntakeImageFile({ name: 'Hair Match.mp4', mimeType: 'video/mp4' }), false);
});

test('enqueueFiles queues new videos and skips already-seen drive_file_ids', async () => {
  const inserted = [];
  const supabase = {
    from(table) {
      if (table === 'platform_connections') {
        return {
          select() { return this; },
          async eq() {
            return {
              data: [
                { id: 'conn-ig-1', user_id: 'user-1', platform: 'instagram', platform_account_id: 'ig-1', account_name: 'Hair Match Salon' },
              ],
              error: null,
            };
          },
        };
      }
      if (table === 'google_drive_video_jobs') {
        return {
          select() { return this; },
          eq() { return this; },
          order() { return this; },
          async limit() {
            return { data: [{ drive_file_id: 'file-seen', result: {} }], error: null };
          },
          async insert(row) {
            inserted.push(row);
            return { error: null };
          },
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  };
  await enqueueFiles(
    supabase,
    { user_id: 'user-1', drive_folder_id: 'folder-1' },
    [
      { id: 'file-seen', name: 'Hair Match.mp4', mimeType: 'video/mp4', size: 1024 },
      { id: 'file-new', name: 'Hair Match.mov', mimeType: 'application/octet-stream', size: 2048 },
    ],
  );
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].drive_file_id, 'file-new');
  assert.equal(inserted[0].mime_type, 'video/mp4');
  assert.equal(inserted[0].status, 'queued');
});

test('folder-based carousels queue all settled images under the brand folder name and preserve dotted handles', async () => {
  assert.equal(parseDestination('salon.zivara', { stripExtension: false }).accountName, 'salon.zivara');
  const inserted = [];
  let prior = [];
  const supabase = {
    from(table) {
      if (table === 'platform_connections') {
        return {
          select() { return this; },
          async eq() {
            return {
              data: [
                { id: 'conn-ig-1', user_id: 'user-1', platform: 'instagram', platform_account_id: 'ig-1', account_name: 'Hair Match Salon' },
              ],
              error: null,
            };
          },
        };
      }
      if (table === 'google_drive_video_jobs') {
        return {
          select() { return this; },
          eq() { return this; },
          order() { return this; },
          async limit() {
            return { data: prior, error: null };
          },
          async insert(row) {
            inserted.push(row);
            prior = [{ drive_file_id: row.drive_file_id, result: row.result }];
            return { error: null };
          },
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  };
  const settledTime = new Date(Date.now() - 120_000).toISOString();
  const folderItem = {
    id: 'folder-hair-match',
    name: 'Hair Match Salon',
    mimeType: 'application/vnd.google-apps.folder',
    children: [
      { id: 'img-2', name: 'photo 2.png', mimeType: 'image/png', size: 2048, createdTime: settledTime },
      { id: 'img-1', name: 'photo 1.jpg', mimeType: 'image/jpeg', size: 1024, createdTime: settledTime },
      { id: 'img-10', name: 'photo 10.webp', mimeType: 'image/webp', size: 3072, createdTime: settledTime },
    ],
  };
  await enqueueFiles(supabase, { user_id: 'user-1', drive_folder_id: 'root-folder' }, [folderItem]);
  await enqueueFiles(supabase, { user_id: 'user-1', drive_folder_id: 'root-folder' }, [folderItem]);
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].drive_file_id, 'folder-hair-match');
  assert.equal(inserted[0].mime_type, 'image/carousel');
  assert.deepEqual(
    inserted[0].result.source_drive_files.map((f) => f.id),
    ['img-1', 'img-2', 'img-10'],
  );
});
