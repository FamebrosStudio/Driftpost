import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { uploadMediaFile, downloadMediaFile } from '../src/media-io.js';
import { publishFacebook, publishFacebookCarousel } from '../src/meta.js';

async function fixture(t, size = 48 * 1024 * 1024) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'driftpost-media-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, 'video.mp4');
  const handle = await fs.open(filePath, 'w');
  await handle.truncate(size);
  await handle.close();
  return { path: filePath, mimetype: 'video/mp4', originalname: 'video.mp4', size };
}

test('Supabase receives a disk stream with the full video and content type', async (t) => {
  const media = await fixture(t);
  let received = 0;
  let contentType;
  const server = http.createServer(async (req, res) => {
    contentType = req.headers['content-type'];
    for await (const chunk of req) received += chunk.length;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ Key: 'media/video.mp4' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const client = createClient(`http://127.0.0.1:${server.address().port}`, 'test-key');
  const result = await uploadMediaFile(client.storage.from('media'), 'video.mp4', media);
  assert.equal(result.error, null);
  assert.equal(received, media.size);
  assert.equal(contentType, 'video/mp4');
  assert.equal(media.bytes, undefined);
});

test('Facebook video and carousel accept disk files without Buffer copies', async (t) => {
  const media = await fixture(t);
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let uploads = 0;
  globalThis.fetch = async (_url, options) => {
    if (options.body instanceof FormData) {
      const source = options.body.get('source');
      let bytes = 0;
      for await (const chunk of source.stream()) bytes += chunk.length;
      assert.equal(bytes, media.size);
      uploads++;
    }
    return new Response(JSON.stringify({ id: '123' }), { headers: { 'Content-Type': 'application/json' } });
  };
  const video = await publishFacebook({ pageId: 'page', pageToken: 'test', media });
  assert.equal(video.id, '123');
  const photo = { ...media, mimetype: 'image/jpeg', originalname: 'photo.jpg' };
  await publishFacebookCarousel({ pageId: 'page', pageToken: 'test', mediaList: [photo, photo] });
  assert.equal(uploads, 3);
});

test('pre-uploaded media downloads to disk incrementally', async (t) => {
  const media = await fixture(t, 16 * 1024 * 1024);
  const server = http.createServer((_req, res) => {
    res.writeHead(200);
    const chunk = Buffer.alloc(64 * 1024, 7);
    let sent = 0;
    const write = () => {
      while (sent < media.size) {
        sent += chunk.length;
        if (!res.write(chunk)) { res.once('drain', write); return; }
      }
      res.end();
    };
    write();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const destination = path.join(path.dirname(media.path), 'download.mp4');
  await downloadMediaFile(`http://127.0.0.1:${server.address().port}/video`, destination);
  assert.equal((await fs.stat(destination)).size, media.size);
  const handle = await fs.open(destination, 'r');
  const sample = Buffer.alloc(16);
  await handle.read(sample, 0, sample.length, media.size - sample.length);
  await handle.close();
  assert.deepEqual(sample, Buffer.alloc(16, 7));
});

test('Facebook preserves the provider error instead of reading its body twice', async (t) => {
  const media = await fixture(t, 16);
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'Page permission revoked' } }), {
    status: 403, headers: { 'Content-Type': 'application/json' },
  });
  await assert.rejects(publishFacebook({ pageId: 'page', pageToken: 'test', media }), /Page permission revoked/);
});
