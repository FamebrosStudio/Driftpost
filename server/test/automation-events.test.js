import test from 'node:test';
import assert from 'node:assert/strict';
import { runAutomationAction } from '../src/automation-events.js';

function eventStore() {
  const events = new Map();
  return {
    events,
    from(table) {
      assert.equal(table, 'instagram_automation_events');
      let row;
      let eventId;
      return {
        insert(value) { row = value; return this; },
        select() {
          if (events.has(row.event_id)) return Promise.resolve({ data: null, error: { code: '23505' } });
          events.set(row.event_id, row);
          return Promise.resolve({ data: [{ event_id: row.event_id }], error: null });
        },
        delete() { return this; },
        eq(_column, value) { eventId = value; return Promise.resolve({ error: events.delete(eventId) ? null : new Error('event missing') }); },
      };
    },
  };
}

test('a delivered action is deduplicated on repeated webhook delivery', async () => {
  const supabase = eventStore();
  let sends = 0;
  const event = { event_id: 'message:connection:provider-event', user_id: 'user', connection_id: 'connection', event_type: 'message' };
  assert.deepEqual(await runAutomationAction(supabase, event, async () => { sends++; }), { duplicate: false });
  assert.deepEqual(await runAutomationAction(supabase, event, async () => { sends++; }), { duplicate: true });
  assert.equal(sends, 1);
});

test('a failed provider action releases its claim so a webhook retry can deliver it', async () => {
  const supabase = eventStore();
  const event = { event_id: 'comment:connection:provider-event:public_reply', user_id: 'user', connection_id: 'connection', event_type: 'comment' };
  await assert.rejects(runAutomationAction(supabase, event, async () => { throw new Error('Meta temporarily unavailable'); }), /temporarily unavailable/);
  assert.equal(supabase.events.has(event.event_id), false);
  let sent = false;
  await runAutomationAction(supabase, event, async () => { sent = true; });
  assert.equal(sent, true);
});
