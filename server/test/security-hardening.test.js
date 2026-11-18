import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { updateSavedCaptionData } from '../src/brand-memory/index.js';
import { downloadMediaFile } from '../src/media-io.js';
import { isValidPreuploadedMedia } from '../src/media-links.js';
import { isAllowedOrigin } from '../src/cors-policy.js';

test('brand caption editor rejects path traversal, null bytes, and slashes', () => {
  for (const badId of ['../package', '../../etc/passwd', 'zivara_salon\0.json', 'a/b', 'a\\b', '']) {
    assert.throws(() => updateSavedCaptionData(badId, { name: 'Hacked' }), /Invalid brand ID/);
  }
});

test('brand caption editor ignores prototype-pollution keys and does not pollute Object.prototype', () => {
  const malicious = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted2":true}}}');
  assert.throws(() => updateSavedCaptionData('../evil', malicious), /Invalid brand ID/);
  assert.equal({}.polluted, undefined);
  assert.equal({}.polluted2, undefined);
});

test('downloadMediaFile blocks SSRF, metadata IPs, loopback, private LAN, and non-HTTPS schemes', async () => {
  const dest = path.join(os.tmpdir(), `dp-ssrf-test-${Date.now()}.bin`);
  const blockedUrls = [
    'http://169.254.169.254/latest/meta-data/',
    'https://169.254.169.254/latest/meta-data/',
    'https://127.0.0.1/secret',
    'https://localhost:3000/admin',
    'https://10.0.0.5/internal',
    'https://192.168.1.1/router',
    'https://172.16.0.1/private',
    'file:///etc/passwd',
    'http://example.com/video.mp4',
  ];
  for (const url of blockedUrls) {
    await assert.rejects(() => downloadMediaFile(url, dest), /Only HTTPS|Blocked internal|Invalid media/);
  }
});

test('isValidPreuploadedMedia blocks cross-user path traversal and non-media types', () => {
  const cap = 400 * 1024 * 1024;
  assert.equal(isValidPreuploadedMedia('user-a', { path: 'user-b/secret.mp4', mimetype: 'video/mp4', size: 1024 }, cap), false);
  assert.equal(isValidPreuploadedMedia('user-a', { path: 'user-a/../user-b/secret.mp4', mimetype: 'video/mp4', size: 1024 }, cap), false);
  assert.equal(isValidPreuploadedMedia('user-a', { path: 'user-a/payload.html', mimetype: 'text/html', size: 1024 }, cap), false);
  assert.equal(isValidPreuploadedMedia('user-a', { path: 'user-a/huge.mp4', mimetype: 'video/mp4', size: cap + 1 }, cap), false);
});

test('CORS policy rejects spoofed and malicious origins', () => {
  const allowed = ['https://driftpostpage.vercel.app'];
  const known = ['https://driftpostpage.vercel.app', 'https://driftpost.vercel.app'];
  assert.equal(isAllowedOrigin('https://driftpost.evil.com', allowed, known), false);
  assert.equal(isAllowedOrigin('https://driftpostpage.vercel.app.attacker.com', allowed, known), false);
  assert.equal(isAllowedOrigin('javascript:alert(1)', allowed, known), false);
  assert.equal(isAllowedOrigin('https://driftpostpage.vercel.app', allowed, known), true);
});
