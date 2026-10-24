import crypto from 'node:crypto';

export const MCP_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const MCP_DEVICE_TTL_MS = 10 * 60 * 1000;
export const MCP_SCOPES = Object.freeze([
  'accounts:read', 'accounts:connect', 'accounts:manage',
  'media:upload', 'posts:publish', 'posts:read', 'posts:schedule', 'mcp:revoke',
]);

export function hashMcpSecret(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function makeUserCode() {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 8; i++) code += alphabet[crypto.randomInt(alphabet.length)];
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export async function createMcpDeviceAuthorization(supabase) {
  const deviceCode = `dpd_${crypto.randomBytes(32).toString('base64url')}`;
  const userCode = makeUserCode();
  const expiresAt = new Date(Date.now() + MCP_DEVICE_TTL_MS).toISOString();
  const { error } = await supabase.from('mcp_device_authorizations').insert({
    device_code_hash: hashMcpSecret(deviceCode),
    user_code: userCode,
    status: 'pending',
    expires_at: expiresAt,
  });
  if (error) throw error;
  const frontend = String(process.env.FRONTEND_URL || 'https://driftpost.vercel.app').split(',')[0].trim();
  const verificationUri = `${frontend.replace(/\/$/, '')}/#/mcp-connect?user_code=${encodeURIComponent(userCode)}`;
  return {
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: verificationUri,
    expires_in: Math.floor(MCP_DEVICE_TTL_MS / 1000),
    interval: 3,
  };
}

export async function authorizeMcpDevice(supabase, userCode, userId) {
  const code = String(userCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[2-9A-HJ-NP-Z]{8}$/.test(code)) return { ok: false, status: 400, error: 'That connection code is invalid.' };
  const formatted = `${code.slice(0, 4)}-${code.slice(4)}`;
  const { data: row, error: findError } = await supabase.from('mcp_device_authorizations')
    .select('id,status,expires_at').eq('user_code', formatted).maybeSingle();
  if (findError) throw findError;
  if (!row || row.status !== 'pending' || Date.parse(row.expires_at) <= Date.now()) {
    return { ok: false, status: 410, error: 'That connection code expired or was already used. Start again from Osien Stack.' };
  }
  const { data, error } = await supabase.from('mcp_device_authorizations')
    .update({ status: 'authorized', user_id: userId, authorized_at: new Date().toISOString() })
    .eq('id', row.id).eq('status', 'pending').gt('expires_at', new Date().toISOString()).select('id').maybeSingle();
  if (error) throw error;
  if (!data) return { ok: false, status: 409, error: 'That connection code was just used. Start again from Osien Stack.' };
  return { ok: true };
}

export async function pollMcpDeviceAuthorization(supabase, deviceCode) {
  const secret = String(deviceCode || '');
  if (!/^dpd_[A-Za-z0-9_-]{40,80}$/.test(secret)) return { ok: false, status: 400, error: 'Invalid device authorization.' };
  const { data: row, error } = await supabase.from('mcp_device_authorizations')
    .select('id,status,user_id,expires_at').eq('device_code_hash', hashMcpSecret(secret)).maybeSingle();
  if (error) throw error;
  if (!row || Date.parse(row.expires_at) <= Date.now()) return { ok: false, status: 410, error: 'Authorization expired. Run driftpost_connect again.' };
  if (row.status === 'pending') return { ok: false, status: 428, error: 'Authorization is still waiting for approval.' };
  if (row.status !== 'authorized' || !row.user_id) return { ok: false, status: 409, error: 'This authorization has already been used. Start again from Osien Stack.' };

  // Claim before issuing a token so two simultaneous polls cannot create two
  // valid sessions from the same one-time device code.
  const { data: claimed, error: claimError } = await supabase.from('mcp_device_authorizations')
    .update({ status: 'consuming' })
    .eq('id', row.id).eq('status', 'authorized').gt('expires_at', new Date().toISOString())
    .select('id,user_id').maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) return { ok: false, status: 409, error: 'This authorization has already been used. Start again from Osien Stack.' };

  const token = `dpm_${crypto.randomBytes(32).toString('base64url')}`;
  const expiresAt = new Date(Date.now() + MCP_TOKEN_TTL_MS).toISOString();
  const { error: insertError } = await supabase.from('mcp_access_tokens').insert({
    user_id: claimed.user_id,
    token_hash: hashMcpSecret(token),
    label: 'Osien Stack',
    scopes: MCP_SCOPES,
    expires_at: expiresAt,
  });
  if (insertError) {
    await supabase.from('mcp_device_authorizations').update({ status: 'authorized' }).eq('id', row.id).eq('status', 'consuming');
    throw insertError;
  }
  const { error: finishError } = await supabase.from('mcp_device_authorizations')
    .update({ status: 'consumed', consumed_at: new Date().toISOString() }).eq('id', row.id).eq('status', 'consuming');
  if (finishError) {
    await supabase.from('mcp_access_tokens').delete().eq('token_hash', hashMcpSecret(token));
    throw finishError;
  }
  return { ok: true, access_token: token, token_type: 'Bearer', expires_at: expiresAt, scopes: MCP_SCOPES };
}

export async function findMcpAccessToken(supabase, token) {
  const { data, error } = await supabase.from('mcp_access_tokens')
    .select('id,user_id,scopes,expires_at,revoked_at')
    .eq('token_hash', hashMcpSecret(token)).maybeSingle();
  if (error) throw error;
  if (!data || data.revoked_at || Date.parse(data.expires_at) <= Date.now()) return null;
  return data;
}
