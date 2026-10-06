// Claim a Meta event before acting so concurrent webhook deliveries cannot
// send the same reply twice. A failed external action releases its claim so
// Meta's retry can safely try again.
export async function runAutomationAction(supabase, event, action) {
  const { data, error } = await supabase.from('instagram_automation_events')
    .insert(event).select('event_id');
  if (error?.code === '23505') return { duplicate: true };
  if (error) throw new Error(`Could not record Instagram automation event: ${error.message || error}`);
  if (!data?.length) throw new Error('Could not claim Instagram automation event.');

  try {
    await action();
    return { duplicate: false };
  } catch (error) {
    const { error: releaseError } = await supabase.from('instagram_automation_events')
      .delete().eq('event_id', event.event_id);
    if (releaseError) {
      console.error('[instagram automation] Could not release failed event claim:', releaseError.message || releaseError);
    }
    throw error;
  }
}
