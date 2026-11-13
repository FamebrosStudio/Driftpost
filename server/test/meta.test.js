import test from 'node:test';
import assert from 'node:assert/strict';
import { subscribeFacebookWebhooks, facebookAuthorizationUrl, metaBusinessLoginUrl, sendInstagramPrivateReply, metaAuthorizationUrl, publishFacebook, publishFacebookCarousel, resolveInstagramCollaboratorUsernames, subscribeInstagramWebhooks } from '../src/meta.js';

test('Facebook login requests only the configured Facebook/Page consent scopes by default', () => {
  const url = new URL(metaAuthorizationUrl('signed-state'));
  const scopes = new Set(url.searchParams.get('scope').split(','));
  for (const scope of ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts']) assert.ok(scopes.has(scope));
  for (const scope of ['instagram_manage_comments', 'instagram_manage_messages', 'instagram_manage_insights']) assert.equal(scopes.has(scope), false);
});

test('Facebook connection does not accidentally reuse the Instagram Business Login configuration', () => {
  const previousFb = process.env.META_FB_CONFIG_ID;
  const previousIg = process.env.META_CONFIG_ID;
  try {
    delete process.env.META_FB_CONFIG_ID;
    process.env.META_CONFIG_ID = 'instagram-business-config';
    const url = new URL(facebookAuthorizationUrl('state'));
    assert.equal(url.pathname, '/v21.0/dialog/oauth');
    assert.equal(url.searchParams.has('config_id'), false);
    process.env.META_FB_CONFIG_ID = 'facebook-page-config';
    const configured = new URL(facebookAuthorizationUrl('state'));
    assert.equal(configured.searchParams.get('config_id'), 'facebook-page-config');
  } finally {
    if (previousFb === undefined) delete process.env.META_FB_CONFIG_ID;
    else process.env.META_FB_CONFIG_ID = previousFb;
    if (previousIg === undefined) delete process.env.META_CONFIG_ID;
    else process.env.META_CONFIG_ID = previousIg;
  }
});

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

test('Facebook Login automation subscribes the linked Page to comment and message webhooks', async () => {
  await withFetch([{ success: true }, { success: true }], async (requests) => {
    const result = await subscribeInstagramWebhooks({ igUserId: 'ig-account-1', pageId: 'linked-page-1', accessToken: 'page-token' });
    assert.deepEqual(result.fields, ['comments', 'messages']);
    assert.equal(requests[0].url, 'https://graph.facebook.com/v21.0/ig-account-1/subscribed_apps');
    assert.equal(requests[1].url, 'https://graph.facebook.com/v21.0/linked-page-1/subscribed_apps');
    assert.equal(requests[1].init.body.get('subscribed_fields'), 'feed');
    assert.equal(requests[0].init.method, 'POST');
    assert.equal(requests[0].init.body.get('subscribed_fields'), 'comments,messages');
    assert.equal(requests[0].init.body.get('access_token'), 'page-token');
  });
});

test('Instagram subscription can enable only the requested webhook field', async () => {
  await withFetch([{ success: true }, { success: true }], async (requests) => {
    const result = await subscribeInstagramWebhooks({ igUserId: 'ig-account-1', pageId: 'linked-page-1', accessToken: 'page-token', comments: true, messages: false });
    assert.deepEqual(result.fields, ['comments']);
    assert.equal(requests[0].init.body.get('subscribed_fields'), 'comments');
  });
});

test('Instagram webhook subscription surfaces Meta permission failures', async () => {
  await assert.rejects(subscribeInstagramWebhooks({
    igUserId: 'ig-account-1', pageId: 'linked-page-1', accessToken: 'page-token',
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'Permission denied' } }), { status: 403 }),
  }), /Permission denied/);
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

test('Facebook Login subscription rejects a missing linked Page without sending a request', async () => {
  await assert.rejects(subscribeInstagramWebhooks({ accessToken: 'page-token', fetchImpl: async () => { throw new Error('unexpected request'); } }), /Reconnect/);
});

test('Page subscription failure prevents reporting automation subscription success', async () => {
  let calls = 0;
  await assert.rejects(subscribeInstagramWebhooks({
    igUserId: 'ig-account-1', pageId: 'linked-page-1', accessToken: 'page-token',
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify(calls === 1 ? { success: true } : { error: { message: 'Page permission denied' } }), { status: calls === 1 ? 200 : 403 });
    },
  }), /Page permission denied/);
  assert.equal(calls, 2);
});

test('Instagram comment private replies use linked Page messages with a comment recipient', async () => {
  await withFetch([{ recipient_id: 'customer', message_id: 'reply' }], async (requests) => {
    await sendInstagramPrivateReply({ pageId: 'linked-page', commentId: 'ig-comment', message: 'Details', accessToken: 'page-token' });
    assert.equal(requests[0].url, 'https://graph.facebook.com/v21.0/linked-page/messages');
    const body = JSON.parse(requests[0].init.body);
    assert.deepEqual(body.recipient, { comment_id: 'ig-comment' });
    assert.deepEqual(body.message, { text: 'Details' });
  });
});

test('Facebook automation subscribes Page feed and Messenger fields', async () => {
  await withFetch([{ success: true }], async (requests) => {
    await subscribeFacebookWebhooks({ pageId: 'page', accessToken: 'token', comments: true, messages: true });
    assert.equal(requests[0].url, 'https://graph.facebook.com/v21.0/page/subscribed_apps');
    assert.equal(requests[0].init.body.get('subscribed_fields'), 'feed,messages,messaging_postbacks');
  });
});
test('Business Login for Facebook uses the dedicated configuration when present', () => {
  const previous = process.env.META_FB_CONFIG_ID;
  try {
    process.env.META_FB_CONFIG_ID = 'facebook-config';
    assert.equal(new URL(metaBusinessLoginUrl('state', 'facebook')).searchParams.get('config_id'), 'facebook-config');
  } finally {
    if (previous === undefined) delete process.env.META_FB_CONFIG_ID;
    else process.env.META_FB_CONFIG_ID = previous;
  }
});
