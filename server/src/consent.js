// Consent state and enforcement for the optional "personalisation" purpose.
//
// The product works fully without it. Consent is read from an append-only log
// (see migration 007); the newest row for a purpose is the current decision.
// Nothing in this module can turn consent ON by itself - only an explicit
// record from the user does that.

// Bump when the notice wording changes materially. Stored with every decision
// so a consent record can never be pinned to a version the user did not read.
export const POLICY_VERSION = '2026-09-26.v1';

export const PURPOSES = {
  service: 'Required to use Driftpost: your inputs are sent to the AI provider to generate your posts.',
  personalisation: 'Optional: store your prompts and captions so future posts for the same brand match your own voice.',
};

const asBool = (v) => v === true || v === true || v === 1 || v === '1' || v === 'true';

// Current decision per purpose, newest first. Any failure means "no consent",
// which is the safe direction: we would rather under-store than over-store.
export async function consentState(supabase, userId) {
  const none = { service: true, personalisation: false, recorded: false, version: null, at: null };
  if (!userId) return { ...none, recorded: false };
  try {
    const { data, error } = await supabase.from('consent_log')
      .select('purpose, granted, policy_version, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20);
    if (error || !data?.length) return none;
    const state = { ...none, recorded: true };
    // Rows arrive newest first, so the first row seen for a purpose IS the
    // current decision - including a later revoke, which must override an
    // earlier grant. Tracked in a separate set because the state object is
    // pre-seeded with safe defaults that must not mask a real decision.
    const seen = new Set();
    for (const row of data) {
      if (seen.has(row.purpose)) continue;
      seen.add(row.purpose);
      state[row.purpose] = asBool(row.granted);
      if (row.purpose === 'personalisation') {
        state.version = row.policy_version;
        state.at = row.created_at;
      }
    }
    return state;
  } catch {
    return none;
  }
}

// True only when the user actively opted in. Callers must treat anything else
// (error, missing row, malformed value) as "not consented".
export async function hasPersonalisationConsent(supabase, userId) {
  const s = await consentState(supabase, userId);
  return s.personalisation === true && s.recorded === true;
}

// Append a decision. Never updates an earlier row.
export async function recordConsent(supabase, { userId, purpose, granted, version = POLICY_VERSION }) {
  const p = String(purpose || '');
  if (!userId || !PURPOSES[p]) return false;
  try {
    const { error } = await supabase.from('consent_log').insert({
      user_id: userId,
      purpose: p,
      granted: !!granted,
      policy_version: String(version).slice(0, 32),
    });
    return !error;
  } catch {
    return false;
  }
}

// Account erasure. Consent history is personal data too, so it goes with the
// account; the audit value of the row is lost, which is the correct trade when
// a person asks to be forgotten.
export async function forgetUser(supabase, userId) {
  if (!userId) return;
  try { await supabase.from('caption_memory').delete().eq('user_id', userId); } catch {}
  try { await supabase.from('consent_log').delete().eq('user_id', userId); } catch {}
}
