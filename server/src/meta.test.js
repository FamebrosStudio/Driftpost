import test from 'node:test';
import assert from 'node:assert/strict';
import { publishFacebook, publishFacebookCarousel, resolveInstagramCollaboratorUsernames } from './meta.js';

async function withFetch(responses, run) {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    const body = responses.shift() || {};
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try { await run(requests); }
  finally { globalThis.fetch = original; }
}

test('Facebook video publishing passes a hosted video URL without streaming it through the API', async () => {
  await withFetch([{ id: 'video-1' }], async (requests) => {
    await publishFacebook({
      pageId: 'page-1', pageToken: 'secret-token', text: 'caption',
      media: { url: 'https://storage.example/user/video.mp4', mimetype: 'video/mp4', originalname: 'video.mp4' },
    });
    assert.equal(requests.length, 1);
    const body = requests[0].init.body;
    assert.equal(body.get('file_url'), 'https://storage.example/user/video.mp4');
    assert.equal(body.get('description'), 'caption');
    assert.equal(body.has('source'), false);
  });
});

test('Facebook photo publishing passes a hosted photo URL', async () => {
  await withFetch([{ id: 'photo-1' }], async (requests) => {
    await publishFacebook({
      pageId: 'page-1', pageToken: 'secret-token', text: 'caption',
      media: { url: 'https://storage.example/user/photo.jpg', mimetype: 'image/jpeg', originalname: 'photo.jpg' },
    });
    const body = requests[0].init.body;
    assert.equal(body.get('url'), 'https://storage.example/user/photo.jpg');
    assert.equal(body.has('source'), false);
  });
});

test('Facebook carousel attaches hosted image URLs without file uploads', async () => {
  await withFetch([{ id: 'photo-1' }, { id: 'photo-2' }, { id: 'post-1' }], async (requests) => {
    await publishFacebookCarousel({
      pageId: 'page-1', pageToken: 'secret-token', text: 'caption',
      mediaList: [
        { url: 'https://storage.example/user/one.jpg', mimetype: 'image/jpeg' },
        { url: 'https://storage.example/user/two.jpg', mimetype: 'image/jpeg' },
      ],
    });
    assert.equal(requests.length, 3);
    assert.equal(requests[0].init.body.get('url'), 'https://storage.example/user/one.jpg');
    assert.equal(requests[1].init.body.get('url'), 'https://storage.example/user/two.jpg');
    assert.equal(requests[0].init.body.get('published'), 'false');
  });
});

test('Facebook carousel publishes all 20 photos without truncating the carousel', async () => {
  const responses = Array.from({ length: 20 }, (_, i) => ({ id: `photo-${i + 1}` }));
  responses.push({ id: 'post-20' });
  await withFetch(responses, async (requests) => {
    const mediaList = Array.from({ length: 20 }, (_, i) => ({
      url: `https://storage.example/user/photo-${i + 1}.jpg`, mimetype: 'image/jpeg',
    }));
    await publishFacebookCarousel({ pageId: 'page-1', pageToken: 'secret-token', text: 'caption', mediaList });
    assert.equal(requests.length, 21);
    const finalBody = JSON.parse(requests[20].init.body);
    assert.equal(finalBody.attached_media.length, 20);
    assert.equal(finalBody.attached_media[19].media_fbid, 'photo-20');
  });
});

test('Facebook carousel rejects more than 20 photos without uploading any', async () => {
  await withFetch([], async (requests) => {
    const mediaList = Array.from({ length: 21 }, (_, i) => ({
      url: `https://storage.example/user/photo-${i + 1}.jpg`, mimetype: 'image/jpeg',
    }));
    await assert.rejects(
      publishFacebookCarousel({ pageId: 'page-1', pageToken: 'secret-token', text: 'caption', mediaList }),
      /up to 20 photos/,
    );
    assert.equal(requests.length, 0);
  });
});

test('Instagram collaborator publishing resolves handles to usernames, never numeric account IDs', async () => {
  await withFetch([{
    business_discovery: { id: '17841400000000000', username: 'mahalaxmi.jewellers.kurla' },
  }], async () => {
    const result = await resolveInstagramCollaboratorUsernames({
      igUserId: '17841411111111111',
      pageToken: 'page-token',
      handles: ['@mahalaxmi.jewellers.kurla'],
    });
    assert.deepEqual(result.usernames, ['mahalaxmi.jewellers.kurla']);
    assert.equal(result.usernames.includes('17841400000000000'), false);
  });
});

test('Instagram collaborator username is preserved when account discovery is unavailable', async () => {
  await withFetch([{ error: { message: 'not found' } }], async () => {
    const result = await resolveInstagramCollaboratorUsernames({
      igUserId: '17841411111111111',
      pageToken: 'page-token',
      handles: ['@mahalaxmi.jewellers.kurla'],
    });
    assert.deepEqual(result.usernames, ['mahalaxmi.jewellers.kurla']);
  });
});
