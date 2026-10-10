import fs from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { decryptJson, encryptJson } from './crypto.js';
import { processIntakeJob } from './telegram-intake.js';
import { assessVideoBrandMatch } from './ai.js';
import { mapBrandDestinations, matchDriveAccounts, resolveDriveBrand } from './brand-routing.js';

const TABLE = 'google_drive_video_jobs';
const CONNECTIONS = 'google_drive_intake_connections';
const MAX_VIDEO_BYTES = 400 * 1024 * 1024;
const PLATFORMS = new Set(['youtube', 'instagram', 'facebook', 'x']);
let intakeBusy = false;
let outcomeBusy = false;

function parseDestination(fileName) {
  const title = String(fileName || '').split(/[\\/]/).at(-1).trim().replace(/\.[a-z0-9]{2,8}$/i, '');
  const parts = title.split(' -- ');
  if (parts.length >= 3) {
    const requested = parts[1].split(',').map((value) => value.trim().toLowerCase());
    if (requested.length && requested.every((value) => PLATFORMS.has(value))) {
      return { accountName: parts[0].trim(), platforms: [...new Set(requested)] };
    }
  }
  // The editor-friendly default is just the saved brand name in the filename.
  return { accountName: title, platforms: [] };
}

async function tokenFor(supabase, connection) {
  const tokens = decryptJson(connection.encrypted_tokens);
  const expiry = connection.token_expires_at ? Date.parse(connection.token_expires_at) : 0;
  if (tokens.access_token && expiry > Date.now() + 60_000) return tokens.access_token;
  if (!tokens.refresh_token) throw new Error('Google Drive needs to be reconnected.');
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, refresh_token: tokens.refresh_token, grant_type: 'refresh_token' }),
  });
  const renewed = await response.json().catch(() => ({}));
  if (!response.ok || !renewed.access_token) throw new Error('Google Drive access expired. Reconnect Drive in Driftpost.');
  const nextTokens = { ...tokens, access_token: renewed.access_token };
  const expiresAt = new Date(Date.now() + Number(renewed.expires_in || 3600) * 1000).toISOString();
  const { error } = await supabase.from(CONNECTIONS).update({ encrypted_tokens: encryptJson(nextTokens), token_expires_at: expiresAt, updated_at: new Date().toISOString() }).eq('user_id', connection.user_id);
  if (error) throw new Error('Could not save renewed Drive access.');
  connection.encrypted_tokens = encryptJson(nextTokens);
  connection.token_expires_at = expiresAt;
  return renewed.access_token;
}

async function listDriveFiles(accessToken, folderId, connectedAt) {
  const params = new URLSearchParams({
    q: `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false and mimeType contains 'video/' and createdTime > '${new Date(connectedAt).toISOString()}'`,
    fields: 'nextPageToken,files(id,name,mimeType,size,modifiedTime)',
    pageSize: '100', orderBy: 'createdTime desc',
  });
  const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(30_000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || 'Could not scan the Driftpost Drive folder.');
  return data.files || [];
}

async function enqueueFiles(supabase, connection, files) {
  const { data: ownedConnections, error: connectionsError } = await supabase.from('platform_connections')
    .select('id, user_id, platform, platform_account_id, account_name, encrypted_tokens')
    .eq('user_id', connection.user_id);
  if (connectionsError) throw new Error('Could not read the connected publishing accounts.');
  for (const file of files) {
    const size = Number(file.size) || 0;
    const parsed = parseDestination(file.name);
    const brandHit = resolveDriveBrand(parsed.accountName);
    const directMatch = brandHit.brand ? { destinations: [], ambiguous: false } : matchDriveAccounts(parsed.accountName, ownedConnections || []);
    const routing = brandHit.brand
      ? mapBrandDestinations(brandHit.brand, ownedConnections || [], parsed.platforms)
      : { destinations: directMatch.destinations.filter((item) => !parsed.platforms.length || parsed.platforms.includes(item.platform)), unresolved: [] };
    const autoPlatforms = [...new Set((routing.destinations || []).map((item) => item.platform))];
    const platforms = parsed.platforms.length ? parsed.platforms : autoPlatforms;
    const missingRequested = parsed.platforms.filter((platform) => !autoPlatforms.includes(platform));
    const routeError = !brandHit.brand && !routing.destinations.length
      ? (directMatch.ambiguous
        ? `The name "${parsed.accountName}" matches multiple connected accounts. Add the full account name or platform handle so Driftpost can route it safely.`
        : brandHit.ambiguous
          ? `The name "${parsed.accountName}" matches multiple brands (${brandHit.candidates.join(', ')}). Add a distinctive handle, location, or full brand name so Driftpost can route it safely.`
          : `Could not match "${parsed.accountName || 'this filename'}" to a saved brand or connected account. Try the full name, a saved alias, or a social handle.`)
      : routing.unresolved?.length
        ? `Account mapping needs review: ${routing.unresolved.join('; ')}.`
        : missingRequested.length
          ? `No connected ${missingRequested.join(', ')} account clearly matches ${brandHit.brand?.name || parsed.accountName}.`
        : !routing.destinations?.length
          ? `No connected platform account clearly matches ${brandHit.brand?.name || parsed.accountName}. Check the saved account names and brand mapping.`
          : '';
    const errorMessage = size > MAX_VIDEO_BYTES
      ? 'Video is larger than Driftpost’s 400 MB limit.'
      : routeError;
    const { error } = await supabase.from(TABLE).insert({
      drive_file_id: file.id,
      owner_user_id: connection.user_id,
      drive_folder_id: connection.drive_folder_id,
      file_name: file.name || 'incoming-video.mp4',
      mime_type: file.mimeType || 'video/mp4',
      file_size: size,
      account_name: brandHit?.brand?.name || parsed.accountName,
      platforms,
      result: routing.destinations.length ? {
        ...(brandHit.brand ? { brand_id: brandHit.brand.id } : { generic_account_target: true }),
        destination_connection_ids: routing.destinations.map((item) => item.id),
      } : {},
      status: errorMessage ? 'failed' : 'queued',
      error: errorMessage || null,
    });
    if (error && !/duplicate|unique/i.test(error.message || '')) console.error('[drive-intake] could not queue file:', file.id, error.message);
  }
}

async function downloadDriveVideo(supabase, job, destination) {
  const { data: connection, error } = await supabase.from(CONNECTIONS).select('*').eq('user_id', job.owner_user_id).eq('status', 'connected').maybeSingle();
  if (error || !connection) throw new Error('The Drive connection is unavailable. Reconnect Drive in Driftpost.');
  const accessToken = await tokenFor(supabase, connection);
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(job.drive_file_id)}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15 * 60 * 1000),
  });
  if (!response.ok || !response.body) throw new Error('Google Drive could not download this video. Check the file and retry.');
  await pipeline(response.body, fs.createWriteStream(destination, { flags: 'wx' }));
  const stat = await fs.promises.stat(destination);
  if (!stat.size || stat.size > MAX_VIDEO_BYTES) throw new Error('The received video is empty or larger than 400 MB.');
  return stat.size;
}

async function processQueued(supabase) {
  if (intakeBusy) return;
  intakeBusy = true;
  try {
    const staleBefore = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    await supabase.from(TABLE).update({ status: 'queued', updated_at: new Date().toISOString() }).eq('status', 'processing').lt('updated_at', staleBefore);
    const { data: pending, error } = await supabase.from(TABLE).select('*').eq('status', 'queued').order('created_at', { ascending: true }).limit(1);
    if (error || !pending?.length) return;
    const job = pending[0];
    const { data: claimed, error: claimError } = await supabase.from(TABLE).update({ status: 'processing', updated_at: new Date().toISOString() }).eq('id', job.id).eq('status', 'queued').select().maybeSingle();
    if (claimError || !claimed) return;
    const heartbeat = setInterval(() => { void supabase.from(TABLE).update({ updated_at: new Date().toISOString() }).eq('id', job.id).eq('status', 'processing'); }, 60_000);
    heartbeat.unref();
    try {
      await processIntakeJob(supabase, claimed, {
        table: TABLE,
        intakeKey: 'google_drive_intake_job_id',
        sourcePrefix: 'drive',
        resolveDestinations: (brand, connections, platforms) => mapBrandDestinations(brand, connections, platforms),
        assessBrand: (brand, frames, transcript) => assessVideoBrandMatch(brand, frames, transcript),
        download: (current, destination) => downloadDriveVideo(supabase, current, destination),
        notify: async () => {},
      });
    } catch (error) {
      const message = String(error?.message || 'Could not prepare the automatic post.').slice(0, 800);
      await supabase.from(TABLE).update({ status: 'failed', error: message, updated_at: new Date().toISOString() }).eq('id', job.id);
      console.error('[drive-intake] job failed:', job.id, message);
    } finally { clearInterval(heartbeat); }
  } catch (error) {
    console.error('[drive-intake] worker failed:', String(error?.message || error).slice(0, 250));
  } finally { intakeBusy = false; }
}

export async function getDriveReviewFile(supabase, job) {
  const { data: connection, error } = await supabase.from(CONNECTIONS).select('*')
    .eq('user_id', job.owner_user_id).eq('status', 'connected').maybeSingle();
  if (error || !connection) throw new Error('The private Drive connection is unavailable. Reconnect Drive in Driftpost.');
  const accessToken = await tokenFor(supabase, connection);
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(job.drive_file_id)}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15 * 60 * 1000),
  });
  if (!response.ok || !response.body) throw new Error('Google Drive could not load this video for review. Check the file and retry.');
  return response;
}

export function streamDriveReviewFile(upstream, res) {
  res.status(200);
  res.setHeader('Content-Type', upstream.headers.get('content-type') || 'video/mp4');
  const length = upstream.headers.get('content-length');
  if (length) res.setHeader('Content-Length', length);
  res.setHeader('Cache-Control', 'private, no-store');
  Readable.fromWeb(upstream.body).on('error', (error) => res.destroy(error)).pipe(res);
}

async function checkPublishOutcomes(supabase) {
  if (outcomeBusy) return;
  outcomeBusy = true;
  try {
    const { data: jobs, error } = await supabase.from(TABLE).select('id, result').eq('status', 'publishing').order('created_at', { ascending: true }).limit(20);
    if (error || !jobs?.length) return;
    for (const job of jobs) {
      const destinations = Array.isArray(job.result?.destinations) ? job.result.destinations : [];
      if (!destinations.length) continue;
      const { data: rows, error: rowError } = await supabase.from('scheduled_posts').select('id, status, result_url, error').in('id', destinations.map((item) => item.id));
      if (rowError || !rows || rows.length !== destinations.length || rows.some((row) => ['scheduled', 'publishing'].includes(row.status))) continue;
      const published = rows.filter((row) => row.status === 'published');
      const failed = rows.filter((row) => row.status !== 'published');
      const status = failed.length ? (published.length ? 'partial' : 'failed') : 'completed';
      await supabase.from(TABLE).update({ status, updated_at: new Date().toISOString() }).eq('id', job.id).eq('status', 'publishing');
    }
  } catch (error) { console.error('[drive-intake] outcome check failed:', String(error?.message || error).slice(0, 220)); }
  finally { outcomeBusy = false; }
}

async function scanFolders(supabase) {
  const { data: connections, error } = await supabase.from(CONNECTIONS).select('*').eq('status', 'connected').limit(20);
  if (error || !connections?.length) return;
  for (const connection of connections) {
    try {
      const accessToken = await tokenFor(supabase, connection);
      const files = await listDriveFiles(accessToken, connection.drive_folder_id, connection.created_at);
      await enqueueFiles(supabase, connection, files);
    } catch (error) { console.error('[drive-intake] folder scan failed:', connection.user_id, String(error?.message || error).slice(0, 220)); }
  }
}

export function startGoogleDriveIntake(supabase) {
  if (!process.env.DRIFTPOST_DRIVE_FOLDER_ID) {
    console.info('[drive-intake] disabled; DRIFTPOST_DRIVE_FOLDER_ID is not set.');
    return;
  }
  let scanBusy = false;
  const scan = async () => {
    if (scanBusy) return;
    scanBusy = true;
    try { await scanFolders(supabase); }
    catch (error) { console.error('[drive-intake] scan error:', String(error?.message || error).slice(0, 250)); }
    finally { scanBusy = false; }
  };
  setInterval(scan, 30_000).unref();
  setInterval(() => { void processQueued(supabase); }, 5_000).unref();
  setInterval(() => { void checkPublishOutcomes(supabase); }, 15_000).unref();
  setTimeout(scan, 2_000).unref();
  setTimeout(() => { void processQueued(supabase); }, 4_000).unref();
}
