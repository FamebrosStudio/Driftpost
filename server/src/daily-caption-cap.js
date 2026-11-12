export const DAILY_CAPTION_GENERATION_LIMIT = 50;

export async function reserveDailyCaptionGenerations(supabase, count = 1) {
  const requested = Math.max(1, Math.floor(Number(count) || 1));
  const { data, error } = await supabase.rpc('reserve_daily_caption_generations', {
    p_count: requested,
    p_limit: DAILY_CAPTION_GENERATION_LIMIT,
  });
  if (error) throw new Error(`Could not verify daily caption limit: ${error.message || 'database error'}`);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row.allowed !== 'boolean') throw new Error('Could not verify daily caption limit.');
  return { allowed: row.allowed, remaining: Number(row.remaining) || 0 };
}

export const dailyCaptionLimitMessage = `Daily caption generation limit reached (${DAILY_CAPTION_GENERATION_LIMIT} per UTC day). Try again after midnight UTC.`;
