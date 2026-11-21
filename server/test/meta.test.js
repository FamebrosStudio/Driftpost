import test from 'node:test';
import assert from 'node:assert/strict';
import { getMetaPages, metaConnectionErrorMessage, subscribeFacebookWebhooks, facebookAuthorizationUrl, metaBusinessLoginUrl, sendInstagramPrivateReply, metaAuthorizationUrl, publishFacebook, publishFacebookCarousel, publishInstagram, publishInstagramCarousel, resolveInstagramCollaboratorUsernames, subscribeInstagramWebhooks } from '../src/meta.js';

test('Facebook login requests only the configured Facebook/Page consent scopes by default', () => {
  const url = new URL(metaAuthorizationUrl('signed-state'));
  const scopes = new Set(url.searchParams.get('scope').split(','));
  for (const scope of ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts']) assert.ok(scopes.has(scope));
  for (const scope of ['instagram_basic', 'instagram_content_publish']) assert.ok(scopes.has(scope));
  for (const scope of ['instagram_manage_comments', 'instagram_manage_messages', 'instagram_manage_insights']) assert.equal(scopes.has(scope), false);
});

test('custom Meta scopes cannot accidentally remove required Page permissions', () => {
  const previous = process.env.META_FB_SCOPES;
  try {
    process.env.META_FB_SCOPES = 'email,business_management';
    const scopes = new Set(new URL(metaAuthorizationUrl('signed-state')).searchParams.get('scope').split(','));
    for (const scope of ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts']) assert.ok(scopes.has(scope));
    assert.ok(scopes.has('email'));
    assert.ok(scopes.has('business_management'));
  } finally {
    if (previous === undefined) delete process.env.META_FB_SCOPES;
    else process.env.META_FB_SCOPES = previous;
  }
});

test('Facebook Page reconnect explicitly requests scopes and re-prompts regardless of Business Login config', () => {
  const previousFb = process.env.META_FB_CONFIG_ID;
  const previousIg = process.env.META_CONFIG_ID;
  try {
    delete process.env.META_FB_CONFIG_ID;
    process.env.META_CONFIG_ID = 'instagram-business-config';
    const url = new URL(facebookAuthorizationUrl('state'));
    assert.equal(url.pathname, '/v26.0/dialog/oauth');
    assert.equal(url.searchParams.has('config_id'), false);
    process.env.META_FB_CONFIG_ID = 'facebook-page-config';
    const configured = new URL(facebookAuthorizationUrl('state'));
    const scopes = new Set(configured.searchParams.get('scope').split(','));
    assert.equal(configured.searchParams.has('config_id'), false);
    assert.equal(configured.searchParams.get('auth_type'), 'rerequest');
    assert.ok(scopes.has('pages_read_engagement'));
    assert.ok(scopes.has('pages_show_list'));
  } finally {
    if (previousFb === undefined) delete process.env.META_FB_CONFIG_ID;
    else process.env.META_FB_CONFIG_ID = previousFb;
    if (previousIg === undefined) delete process.env.META_CONFIG_ID;
    else process.env.META_CONFIG_ID = previousIg;
  }
});

test('Page discovery reports the Business Portfolio permission error instead of hiding it as no Pages', async () => {
  let call = 0;
  await assert.rejects(getMetaPages('user-token', {
    includeInstagram: false,
    fetchImpl: async () => {
      call += 1;
      if (call === 1) return new Response(JSON.stringify({ data: [] }), { status: 200 });
      return new Response(JSON.stringify({ error: { message: 'business_management permission required' } }), { status: 403 });
    },
  }), /Business Portfolio discovery failed: business_management permission required/);
});

test('Page discovery skips Business Portfolio fan-out when direct Pages are already available', async () => {
  const requests = [];
  const pages = await getMetaPages('user-token', {
    includeInstagram: false,
    fetchImpl: async (url) => {
      requests.push(String(url));
      return new Response(JSON.stringify({ data: [{ id: 'page-1', name: 'Wanted Page', access_token: 'page-token' }] }), { status: 200 });
    },
  });
  assert.equal(pages[0].id, 'page-1');
  assert.equal(requests.length, 1);
  assert.match(requests[0], /v26\.0\/me\/accounts/);
});

test('Meta application request-limit errors explain the cooldown and unsaved state', () => {
  const message = metaConnectionErrorMessage(new Error('(#4) Application request limit reached'));
  assert.match(message, /rate-limited/i);
  assert.match(message, /No account was saved/);
  assert.match(message, /10–15 minutes/);
});

test('Meta Page permission errors explain the required app access and reconnection', () => {
  const message = metaConnectionErrorMessage(new Error("Any of the pages_read_engagement or pages_show_list permission(s) must be granted before impersonating a user's page."));
  assert.match(message, /Meta refused this action/i);
  assert.match(message, /pages_show_list and pages_manage_posts/);
  assert.match(message, /rescheduled after reconnecting/);
});

test('Meta two-factor errors point to the profile setting and Page access', () => {
  const message = metaConnectionErrorMessage(new Error('You must be an administrator, editor, or moderator of the page in order to impersonate it. If the page business requires Two Factor Authentication, the user also needs to enable Two Factor Authentication.'));
  assert.match(message, /two-factor authentication/i);
  assert.match(message, /Create content task/);
  assert.match(message, /reconnect Facebook and Instagram/);
});

test('Meta Page role errors point to the Create content task', () => {
  const message = metaConnectionErrorMessage(new Error('You must be an administrator, editor, or moderator of the page in order to impersonate it.'));
  assert.match(message, /Create content task/);
  assert.match(message, /Reschedule failed posts/);
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
    assert.equal(requests[0].url, 'https://graph.facebook.com/v26.0/ig-account-1/subscribed_apps');
    assert.equal(requests[1].url, 'https://graph.facebook.com/v26.0/linked-page-1/subscribed_apps');
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
    assert.equal(requests[0].url, 'https://graph.facebook.com/v26.0/linked-page/messages');
    const body = JSON.parse(requests[0].init.body);
    assert.deepEqual(body.recipient, { comment_id: 'ig-comment' });
    assert.deepEqual(body.message, { text: 'Details' });
  });
});

test('Facebook automation subscribes Page feed and Messenger fields', async () => {
  await withFetch([{ success: true }], async (requests) => {
    await subscribeFacebookWebhooks({ pageId: 'page', accessToken: 'token', comments: true, messages: true });
    assert.equal(requests[0].url, 'https://graph.facebook.com/v26.0/page/subscribed_apps');
    assert.equal(requests[0].init.body.get('subscribed_fields'), 'feed,messages,messaging_postbacks');
  });
});
test('Business Login for Facebook uses the dedicated configuration when present', () => {
  const previous = process.env.META_FB_CONFIG_ID;
  try {
    process.env.META_FB_CONFIG_ID = 'facebook-config';
    const url = new URL(metaBusinessLoginUrl('state', 'facebook'));
    assert.equal(url.searchParams.get('config_id'), 'facebook-config');
    assert.ok(new Set(url.searchParams.get('scope').split(',')).has('pages_read_engagement'));
  } finally {
    if (previous === undefined) delete process.env.META_FB_CONFIG_ID;
    else process.env.META_FB_CONFIG_ID = previous;
  }
});

test('Instagram Reel keeps valid collaborators when another handle is rejected and falls back to @mention for the rejected handle', async () => {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const body = init.body ? JSON.parse(init.body) : {};
    requests.push({ url: u, body });
    if (u.endsWith('/media')) {
      // Meta rejects batch if any collaborator is personal/private ('nikkpawar00057')
      if (Array.isArray(body.collaborators) && body.collaborators.includes('nikkpawar00057')) {
        return new Response(JSON.stringify({ error: { message: 'Invalid collaborator nikkpawar00057' } }), { status: 400 });
      }
      return new Response(JSON.stringify({ id: 'container-123' }), { status: 200 });
    }
    if (u.includes('fields=status_code')) {
      return new Response(JSON.stringify({ status_code: 'FINISHED' }), { status: 200 });
    }
    if (u.endsWith('/media_publish')) {
      return new Response(JSON.stringify({ id: 'media-123' }), { status: 200 });
    }
    if (u.includes('fields=permalink')) {
      return new Response(JSON.stringify({ permalink: 'https://www.instagram.com/reel/abc/' }), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };
  try {
    const result = await publishInstagram({
      igUserId: 'ig-1',
      pageToken: 'tok',
      caption: 'Fresh haircut transformation',
      collabs: ['kuldeepmaurya1209', 'akshadparvalkar', 'nikkpawar00057'],
      mediaUrl: 'https://cdn.example/reel.mp4',
      isVideo: true,
    });
    assert.deepEqual(result.appliedCollaborators, ['kuldeepmaurya1209', 'akshadparvalkar']);
    assert.deepEqual(result.mentionedFallback, ['nikkpawar00057']);
    const finalContainerReq = requests.filter((r) => r.url.endsWith('/media')).at(-1);
    assert.deepEqual(finalContainerReq.body.collaborators, ['kuldeepmaurya1209', 'akshadparvalkar']);
    assert.match(finalContainerReq.body.caption, /@nikkpawar00057/);
    assert.equal(finalContainerReq.body.user_tags, undefined);
  } finally {
    globalThis.fetch = original;
  }
});

test('Instagram single photo applies both collaborators and user_tags cleanly', async () => {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const body = init.body ? JSON.parse(init.body) : {};
    requests.push({ url: u, body });
    if (u.endsWith('/media')) return new Response(JSON.stringify({ id: 'container-img' }), { status: 200 });
    if (u.includes('fields=status_code')) return new Response(JSON.stringify({ status_code: 'FINISHED' }), { status: 200 });
    if (u.endsWith('/media_publish')) return new Response(JSON.stringify({ id: 'media-img' }), { status: 200 });
    if (u.includes('fields=permalink')) return new Response(JSON.stringify({ permalink: 'https://www.instagram.com/p/xyz/' }), { status: 200 });
    return new Response(JSON.stringify({}), { status: 200 });
  };
  try {
    const result = await publishInstagram({
      igUserId: 'ig-1',
      pageToken: 'tok',
      caption: 'Skin glow',
      collabs: ['browsbyavani'],
      mediaUrl: 'https://cdn.example/photo.jpg',
      isVideo: false,
    });
    assert.deepEqual(result.appliedCollaborators, ['browsbyavani']);
    assert.deepEqual(result.appliedUserTags, ['browsbyavani']);
    assert.deepEqual(result.mentionedFallback, []);
    const req = requests.find((r) => r.url.endsWith('/media'));
    assert.deepEqual(req.body.collaborators, ['browsbyavani']);
    assert.equal(req.body.user_tags[0].username, 'browsbyavani');
  } finally {
    globalThis.fetch = original;
  }
});

test('Instagram processing errors surface Meta detail when it is provided', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/media')) return new Response(JSON.stringify({ id: 'container-error' }), { status: 200 });
    return new Response(JSON.stringify({ status_code: 'ERROR', error_message: 'Unsupported video codec' }), { status: 200 });
  };
  try {
    await assert.rejects(
      publishInstagram({ igUserId: 'ig-1', pageToken: 'tok', mediaUrl: 'https://cdn.example/reel.mp4', isVideo: true }),
      /Unsupported video codec/,
    );
  } finally {
    globalThis.fetch = original;
  }
});
