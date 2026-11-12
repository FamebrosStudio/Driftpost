import test from 'node:test';
import assert from 'node:assert/strict';
import { DAILY_CAPTION_GENERATION_LIMIT, dailyCaptionLimitMessage, reserveDailyCaptionGenerations } from '../src/daily-caption-cap.js';

test('daily caption quota requests one atomic reservation by default', async () => {
  let args;
  const result = await reserveDailyCaptionGenerations({
    rpc: async (name, input) => {
      args = [name, input];
      return { data: [{ allowed: true, remaining: 49 }], error: null };
    },
  });
  assert.deepEqual(args, ['reserve_daily_caption_generations', { p_count: 1, p_limit: 50 }]);
  assert.deepEqual(result, { allowed: true, remaining: 49 });
});

test('daily caption quota supports multi-brand reservations', async () => {
  let args;
  await reserveDailyCaptionGenerations({
    rpc: async (_name, input) => { args = input; return { data: { allowed: true, remaining: 47 }, error: null }; },
  }, 3);
  assert.deepEqual(args, { p_count: 3, p_limit: DAILY_CAPTION_GENERATION_LIMIT });
});

test('daily caption quota propagates denial and fails closed on database errors', async () => {
  const denied = await reserveDailyCaptionGenerations({ rpc: async () => ({ data: [{ allowed: false, remaining: 0 }], error: null }) });
  assert.equal(denied.allowed, false);
  assert.match(dailyCaptionLimitMessage, /50 per UTC day/);
  await assert.rejects(
    reserveDailyCaptionGenerations({ rpc: async () => ({ data: null, error: { message: 'missing migration' } }) }),
    /missing migration/,
  );
});
