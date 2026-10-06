import test from 'node:test';
import assert from 'node:assert/strict';
import { forgetUser } from '../src/consent.js';

function fakeSupabase(failOn = '') {
  const deleted = [];
  return {
    deleted,
    from(table) {
      return { delete: () => ({ eq: async (_column, userId) => {
        deleted.push({ table, userId });
        return { error: table === failOn ? new Error(`${table} delete failed`) : null };
      } }) };
    },
  };
}

test('forgetUser deletes caption memory and consent history for the requested user', async () => {
  const supabase = fakeSupabase();
  await forgetUser(supabase, 'user-a');
  assert.deepEqual(supabase.deleted, [
    { table: 'caption_memory', userId: 'user-a' },
    { table: 'consent_log', userId: 'user-a' },
  ]);
});

test('forgetUser propagates database failures so account deletion cannot report false success', async () => {
  const supabase = fakeSupabase('caption_memory');
  await assert.rejects(forgetUser(supabase, 'user-a'), /caption_memory delete failed/);
});
