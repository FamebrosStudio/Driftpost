import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import multer from 'multer';
import { buildScheduleForm } from '../../src/scheduleForm.js';
import { scheduleIdentity } from '../src/schedule-fields.js';

test('scheduling survives real multipart parsing for new and already-open clients', async (t) => {
  const app = express();
  app.post('/schedule', multer().fields([{ name: 'media', maxCount: 10 }]), (req, res) => {
    try {
      const identity = scheduleIdentity(req.body);
      res.json({ identity, parsed: req.body, mediaCount: req.files.media?.length || 0 });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const send = (body) => fetch(`http://127.0.0.1:${server.address().port}/schedule`, { method: 'POST', body });

  for (const platform of ['instagram', 'facebook', 'youtube', 'x']) {
    const form = buildScheduleForm({
      platform, connectionId: 'selected-group-member', when: '2027-01-01T10:00:00Z',
      body: { platform, connection_id: 'default-account', text: 'Festival caption', scheduled_at: 'stale-date' },
      files: [1, 2].map((n) => ({ name: `${n}.jpg`, raw: new Blob(['image'], { type: 'image/jpeg' }) })),
    });
    assert.equal(form.getAll('platform').length, 1);
    assert.equal(form.getAll('connection_id').length, 1);
    const response = await send(form);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.deepEqual(data.identity, { platform, connection_id: 'selected-group-member' });
    assert.equal(data.parsed.scheduled_at, '2027-01-01T10:00:00Z');
    assert.equal(data.parsed.text, 'Festival caption');
    assert.equal(data.mediaCount, 2);
  }

  const legacy = new FormData();
  for (let n = 0; n < 2; n++) {
    legacy.append('platform', 'instagram');
    legacy.append('connection_id', 'same-account');
  }
  const legacyResponse = await send(legacy);
  assert.equal(legacyResponse.status, 200);
  const legacyData = await legacyResponse.json();
  // Reproduces why the original route rejected valid requests.
  assert.equal(String(legacyData.parsed.platform), 'instagram,instagram');
  assert.equal(legacyData.identity.platform, 'instagram');
  assert.equal(legacyData.identity.connection_id, 'same-account');

  legacy.append('connection_id', 'different-account');
  assert.equal((await send(legacy)).status, 400);
});
