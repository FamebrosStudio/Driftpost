// Per-user caption memory — the learning loop.
//
// Brand research answers "what is this brand". This answers "how does THIS
// user want this brand written", learned from captions they actually approved
// or published. Kept in Supabase rather than a JSON file because a file on the
// API host is wiped on redeploy and shared across nothing.
//
// Every function here is best-effort: learning must never break a publish.

const MAX_BODY = 4000;
const APPROVED_EXAMPLES = 3;
const EXAMPLE_CHARS = 420;

const clean = (s, n) => String(s || '').trim().slice(0, n);

// Stable key for a brand, so "AK Factor", "ak factor" and "AK FACTOR" share a
// history. Unknown brands still get a key — that is the point of this table.
export function brandKey(label) {
  return clean(label, 80).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    || 'unbranded';
}

// Record one generated caption. Called for every platform in every generation.
// Resolves to the stored id (for later approval) or null; never throws.
export async function recordGenerated(supabase, {
  userId, brandLabel, platform, brief, settings, body, hashtags,
}) {
  try {
    if (!userId || !platform || !body) return null;
    const { data, error } = await supabase.from('caption_memory').insert({
      user_id: userId,
      brand_key: brandKey(brandLabel),
      brand_label: clean(brandLabel, 80) || null,
      platform,
      brief: clean(brief, 300) || null,
      settings: settings && typeof settings === 'object' ? settings : {},
      body: clean(body, MAX_BODY),
      used: false,
    }).select('id').maybeSingle();
    if (error) return null;
    return data?.id || null;
  } catch {
    return null;
  }
}

// Record several platforms from one generation in a single round trip.
export async function recordGeneration(supabase, meta, entries) {
  try {
    const rows = (entries || [])
      .filter((e) => e && e.platform && e.body)
      .map((e) => ({
        user_id: meta.userId,
        brand_key: brandKey(meta.brandLabel),
        brand_label: clean(meta.brandLabel, 80) || null,
        platform: e.platform,
        brief: clean(meta.brief, 300) || null,
        settings: meta.settings && typeof meta.settings === 'object' ? meta.settings : {},
        body: clean(e.body, MAX_BODY),
        used: false,
      }));
    if (!rows.length) return [];
    const { data, error } = await supabase.from('caption_memory').insert(rows).select('id, platform');
    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

// The user said yes to this one (reviewed or published). This is the signal
// that turns a stored caption into a future example.
export async function markUsed(supabase, { userId, id }) {
  try {
    if (!userId || !id) return false;
    const { error } = await supabase.from('caption_memory')
      .update({ used: true })
      .eq('id', id).eq('user_id', userId);
    return !error;
  } catch {
    return false;
  }
}

// Approve by brand+platform instead of by id, for clients that only know which
// card the user tapped (the common case: one generation, four cards).
export async function markLatestUsed(supabase, { userId, brandLabel, platform }) {
  try {
    if (!userId || !platform) return false;
    const { error } = await supabase.from('caption_memory')
      .update({ used: true })
      .eq('user_id', userId)
      .eq('brand_key', brandKey(brandLabel))
      .eq('platform', platform)
      .order('created_at', { ascending: false })
      .limit(1);
    return !error;
  } catch {
    return false;
  }
}

const tally = (rows, field) => {
  const counts = new Map();
  for (const r of rows) {
    const v = r.settings?.[field];
    if (v) counts.set(v, (counts.get(v) || 0) + 1);
  }
  let best = null; let n = 0;
  for (const [k, c] of counts) if (c > n) { n = c; best = k; }
  return n >= 2 ? best : null; // one-off is noise, not a preference
};

// Build the block that teaches the model this user's established voice.
// Small on purpose: a handful of real approved captions beats a long summary,
// and the brand record still carries the factual side.
export async function learnedVoice(supabase, { userId, brandLabel, platform }) {
  try {
    if (!userId) return null;
    let q = supabase.from('caption_memory')
      .select('platform, brief, settings, body, used, created_at')
      .eq('user_id', userId)
      .eq('brand_key', brandKey(brandLabel))
      .order('created_at', { ascending: false })
      .limit(40);
    if (platform) q = q.eq('platform', platform);
    const { data, error } = await q;
    if (error || !data?.length) return null;

    const approved = data.filter((r) => r.used);
    const lines = [];
    const total = data.length;

    if (approved.length) {
      lines.push(`LEARNED FROM THIS USER (${approved.length} approved of ${total} for this brand). Match their established voice, rhythm and formatting — same energy, new words, never reuse a caption:`);
      for (const r of approved.slice(0, APPROVED_EXAMPLES)) {
        lines.push(`- ${clean(r.body, EXAMPLE_CHARS).replace(/\s+/g, ' ')}`);
      }
    } else {
      lines.push(`LEARNED FROM THIS USER: ${total} caption(s) generated for this brand, none approved yet. No established voice to copy — follow the brand record and the brief.`);
    }

    // Repeated settings are a real preference signal (tone/emoji/length).
    const prefs = [
      ['tone', 'tone'], ['emoji', 'emoji level'], ['length', 'length'],
    ].map(([f, label]) => [label, tally(data, f)]).filter(([, v]) => v);
    if (prefs.length) {
      lines.push(`This user's usual settings: ${prefs.map(([l, v]) => `${l} = ${v}`).join(', ')}.`);
    }

    // Recurring briefs show what this account actually posts about.
    const briefs = [...new Set(data.map((r) => clean(r.brief, 90)).filter(Boolean))].slice(0, 3);
    if (briefs.length > 1) lines.push(`Recurring subjects for this brand: ${briefs.join(' | ')}.`);

    return lines.join('\n');
  } catch {
    return null;
  }
}
