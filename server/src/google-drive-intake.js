import fs from 'node:fs';
import { Readable } from 'node:stream';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { decryptJson, encryptJson } from './crypto.js';
import { processIntakeJob } from './telegram-intake.js';
import { assessVideoBrandMatch } from './ai.js';
import { mapBrandDestinations, matchDriveAccounts, resolveDriveBrand } from './brand-routing.js';

const execFileAsync = promisify(execFile);
const TABLE = 'google_drive_video_jobs';
const CONNECTIONS = 'google_drive_intake_connections';
const MAX_VIDEO_BYTES = 400 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const INSTAGRAM_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_CAROUSEL_IMAGES = 10;
const PLATFORMS = new Set(['youtube', 'instagram', 'facebook', 'x']);

// Photo carousels accept the photo formats editors actually upload. JPEG and
// PNG are published as they are; every other accepted format is converted to
// JPEG with ffmpeg before publishing.
export const CAROUSEL_IMAGE_MIME_TYPES = Object.freeze([
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/avif', 'image/heic', 'image/heif',
]);
const NATIVE_CAROUSEL_MIME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png']);
const ACCEPTED_FORMAT_LABEL = 'JPEG, PNG, WebP, AVIF, HEIC, and HEIF';
const IMAGE_EXTENSIONS = {
  'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
  'image/avif': '.avif', 'image/heic': '.heic', 'image/heif': '.heif',
};
const IMAGE_FORMAT_LABELS = {
  'image/jpeg': 'JPEG', 'image/jpg': 'JPEG', 'image/png': 'PNG', 'image/webp': 'WebP',
  'image/avif': 'AVIF', 'image/heic': 'HEIC', 'image/heif': 'HEIF',
};

// Google Drive marks repeated uploads with a duplicate marker (" (2)",
// " copy", " - Copy") and editors add ordering numbers (" 01", " slide 1").
// None of that belongs to the account name, so it is removed before routing.
const UPLOAD_MARKER_PATTERNS = [
  /\s*\(\s*\d{1,3}\s*\)\s*$/,              // (2), (3), (12)
  /\s*\(\s*copy\s*\)\s*$/i,                 // (copy)
  /\s*[-_ ]+copy\s*$/i,                     // copy, - Copy, _copy
  /\s*[-_ ]+(?:slide[-_ ]*)?\d{1,2}\s*$/i,  // 01, -01, _01, slide 1, - slide 2
];
let intakeBusy = false;
let outcomeBusy = false;
let intakeActive = 0;
// Keep video/carousel analysis bounded to protect memory; the persistent
// database queue accepts more jobs and drains as slots free up.
const MAX_ACTIVE_INTAKE_JOBS = 2;

// Removes Drive duplicate markers and editor ordering numbers from a filename
// fragment. Pure: the same input always produces the same output.
export function stripUploadMarkers(value) {
  let title = String(value || '').trim();
  for (let pass = 0; pass < UPLOAD_MARKER_PATTERNS.length * 2; pass += 1) {
    const next = UPLOAD_MARKER_PATTERNS.reduce((current, pattern) => current.replace(pattern, ''), title).trim();
    if (next === title) break;
    title = next;
  }
  return title;
}

export function parseDestination(fileName) {
  const base = String(fileName || '').split(/[\\/]/).at(-1).trim().replace(/\.[a-z0-9]{2,8}$/i, '').trim();
  const title = stripUploadMarkers(base);
  const parts = title.split(' -- ');
  if (parts.length >= 2) {
    const requested = parts[1].split(',').map((value) => value.trim().toLowerCase());
    if (requested.length && requested.every((value) => PLATFORMS.has(value))) {
      const accountNames = stripUploadMarkers(parts[0]).split(',').map((value) => value.trim().replace(/^@/, '')).filter(Boolean);
      return { accountName: accountNames.join(', '), accountNames, platforms: [...new Set(requested)] };
    }
  }
  // The editor-friendly default is just the saved brand name in the filename.
  const accountNames = title.split(',').map((value) => value.trim().replace(/^@/, '')).filter(Boolean);
  return { accountName: accountNames.join(', '), accountNames, platforms: [] };
}

// The single source of truth for the photo formats a Drive carousel accepts.
export function isAcceptedCarouselImageType(mimeType) {
  return CAROUSEL_IMAGE_MIME_TYPES.includes(String(mimeType || '').trim().toLowerCase());
}

// Formats that must be transcoded to JPEG before they can be published.
export function needsJpegConversion(mimeType) {
  const mime = String(mimeType || '').trim().toLowerCase();
  return isAcceptedCarouselImageType(mime) && !NATIVE_CAROUSEL_MIME_TYPES.has(mime);
}

// Instagram caps carousel images at 8 MB; the other destinations allow 10 MB.
export function carouselImageLimitBytes(platforms = []) {
  const names = (Array.isArray(platforms) ? platforms : [platforms])
    .map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);
  return names.includes('instagram') ? INSTAGRAM_IMAGE_BYTES : MAX_IMAGE_BYTES;
}

export function formatMegabytes(bytes) {
  const value = Number(bytes || 0) / 1024 / 1024;
  if (!Number.isFinite(value) || value <= 0) return '0';
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function normalizeImageMime(mimeType) {
  const mime = String(mimeType || '').trim().toLowerCase();
  return mime === 'image/jpg' ? 'image/jpeg' : mime;
}

// Older intake rows can miss the stored MIME type; the file extension is a
// safe fallback for the formats the carousel accepts.
function mimeFromFileName(name) {
  const extension = String(name || '').split('.').pop()?.toLowerCase() || '';
  return {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
    avif: 'image/avif', heic: 'image/heic', heif: 'image/heif',
  }[extension] || '';
}

function imageExtensionFor(mimeType) {
  return IMAGE_EXTENSIONS[normalizeImageMime(mimeType)] || '.img';
}

function imageFormatLabel(mimeType) {
  return IMAGE_FORMAT_LABELS[normalizeImageMime(mimeType)] || String(mimeType || 'unknown').replace(/^image\//, '').toUpperCase() || 'unknown';
}

async function tokenFor(supabase, connection) {
  const tokens = decryptJson(connection.encrypted_tokens);
  const expiry = connection.token_expires_at ? Date.parse(connection.token_expires_at) : 0;
  if (tokens.access_token && expiry > Date.now() + 60_000) return tokens.access_token;
  if (!tokens.refresh_token) throw new Error('Google Drive needs to be reconnected.');
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, refresh_token: tokens.refresh_token, grant_type: 'refresh_token' }),
    signal: AbortSignal.timeout(30000),
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
  const files = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({
      q: `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false and (mimeType contains 'video/' or mimeType contains 'image/') and createdTime > '${new Date(connectedAt).toISOString()}'`,
      fields: 'nextPageToken,files(id,name,mimeType,size,createdTime,modifiedTime)',
      pageSize: '100', orderBy: 'createdTime desc',
      ...(pageToken ? { pageToken } : {}),
    });
    const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(30_000) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error?.message || 'Could not scan the Driftpost Drive folder.');
    files.push(...(data.files || []));
    pageToken = data.nextPageToken || '';
  } while (pageToken && files.length < 1000);
  return files;
}

async function enqueueFiles(supabase, connection, files) {
  const { data: ownedConnections, error: connectionsError } = await supabase.from('platform_connections')
    .select('id, user_id, platform, platform_account_id, account_name, encrypted_tokens')
    .eq('user_id', connection.user_id);
  if (connectionsError) throw new Error('Could not read the connected publishing accounts.');
  const imageFiles = files.filter((file) => String(file.mimeType || '').startsWith('image/'));
  const videoFiles = files.filter((file) => String(file.mimeType || '').startsWith('video/'));
  // Editors can drop up to 10 photos for one carousel. Images sharing the
  // account name and arriving in the same short upload batch are one post.
  // Wait until the batch has been quiet for 90 seconds so sequential uploads
  // are not split into separate posts.
  const groups = new Map();
  for (const file of imageFiles) {
    const parsed = parseDestination(file.name);
    const targetKey = parsed.accountNames.map((name) => {
      const hit = resolveDriveBrand(name);
      return hit.brand?.id || name.toLowerCase().trim();
    }).sort().join('|');
    const key = `${targetKey}|${parsed.platforms.join(',')}`;
    const group = groups.get(key) || { parsed, files: [] };
    group.files.push(file);
    groups.set(key, group);
  }
  const readyGroups = [...groups.values()].filter((group) => group.files.every((file) => Date.now() - Date.parse(file.createdTime || file.modifiedTime || 0) >= 90_000));
  const batches = [...videoFiles.map((file) => ({ files: [file], parsed: parseDestination(file.name), kind: 'video' })),
    ...readyGroups.map((group) => ({ files: group.files.sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true })), parsed: group.parsed, kind: 'image' }))];
  const { data: priorJobs } = await supabase.from(TABLE).select('drive_file_id, result').eq('owner_user_id', connection.user_id).order('created_at', { ascending: false }).limit(2000);
  const seenIds = new Set((priorJobs || []).flatMap((job) => [job.drive_file_id, ...(Array.isArray(job.result?.source_drive_files) ? job.result.source_drive_files.map((file) => file.id) : [])]));
  for (const batch of batches) {
    // A partially seen image group must never be re-enqueued as a smaller
    // second carousel on the next folder scan.
    const batchFiles = batch.files.filter((item) => !seenIds.has(item.id));
    if (!batchFiles.length) continue;
    const file = batchFiles[0];
    const size = batchFiles.reduce((sum, item) => sum + (Number(item.size) || 0), 0);
    const parsed = batch.parsed;
    const accountNames = parsed.accountNames.length ? parsed.accountNames : [parsed.accountName];
    const targetErrors = [];
    const targetsByKey = new Map();
    const requestedNames = accountNames.slice(0, 10);
    if (!accountNames.length) targetErrors.push('Add at least one brand or account name before the file extension.');
    if (accountNames.length > 10) targetErrors.push('Use up to 10 comma-separated account names per upload.');
    for (const requestedName of requestedNames) {
      const brandHit = resolveDriveBrand(requestedName);
      const directMatch = matchDriveAccounts(requestedName, ownedConnections || []);
      if (brandHit.ambiguous) {
        targetErrors.push(`"${requestedName}" matches multiple brands (${brandHit.candidates.join(', ')}). Add a branch, location, or full name.`);
        continue;
      }
      let routing = brandHit.brand
        ? mapBrandDestinations(brandHit.brand, ownedConnections || [], parsed.platforms)
        : { destinations: directMatch.destinations.filter((item) => !parsed.platforms.length || parsed.platforms.includes(item.platform)), unresolved: [] };
      // If a saved profile exists but has no platform mapping, an exact
      // connected account label can still identify the destination while the
      // profile remains the exclusive source for caption facts.
      if (brandHit.brand && !routing.destinations.length && !routing.unresolved?.length && directMatch.destinations.length) {
        routing = { destinations: directMatch.destinations.filter((item) => !parsed.platforms.length || parsed.platforms.includes(item.platform)), unresolved: [] };
      }
      if (directMatch.ambiguous && !routing.destinations.length) {
        targetErrors.push(`"${requestedName}" matches multiple connected accounts. Add the full account name or handle.`);
        continue;
      }
      if (routing.unresolved?.length) {
        targetErrors.push(`Account mapping needs review for "${requestedName}": ${routing.unresolved.join('; ')}.`);
        continue;
      }
      let destinations = [...(routing.destinations || [])];
      if (batch.kind === 'image') destinations = destinations.filter((item) => ['instagram', 'facebook', 'x'].includes(item.platform));
      if (!destinations.length) {
        targetErrors.push(`No connected publishing account matched "${requestedName}"${batch.kind === 'image' ? ' on Instagram, Facebook, or X' : ''}.`);
        continue;
      }
      const key = brandHit.brand ? `brand:${brandHit.brand.id}` : `accounts:${destinations.map((item) => item.id).sort().join('|')}`;
      const target = targetsByKey.get(key) || { brand: brandHit.brand || null, destinations: [] };
      target.destinations.push(...destinations);
      targetsByKey.set(key, target);
    }
    const targetBrands = [...targetsByKey.values()].map((target) => ({
      brand_id: target.brand?.id || null,
      brand_name: target.brand?.name || accountNames.find((name) => matchDriveAccounts(name, target.destinations).destinations.length) || parsed.accountName,
      destination_connection_ids: [...new Set(target.destinations.map((item) => item.id))],
    }));
    let resolvedDestinations = [...new Map([...targetsByKey.values()].flatMap((target) => target.destinations).map((item) => [item.id, item])).values()];
    if (batch.kind === 'image') resolvedDestinations = resolvedDestinations.filter((item) => ['instagram', 'facebook', 'x'].includes(item.platform));
    const autoPlatforms = [...new Set(resolvedDestinations.map((item) => item.platform))];
    const missingRequested = parsed.platforms.filter((platform) => !autoPlatforms.includes(platform));
    const routeError = targetErrors[0]
      || (missingRequested.length ? `No selected account is connected on ${missingRequested.join(', ')}.` : '')
      || (!resolvedDestinations.length ? `No connected platform account clearly matches ${parsed.accountName}. Check the saved account names and brand mapping.` : '');
    const unsupportedImage = batch.kind === 'image' ? batchFiles.find((item) => !isAcceptedCarouselImageType(item.mimeType)) : null;
    const imageLimit = carouselImageLimitBytes(autoPlatforms);
    const oversizedImage = batch.kind === 'image' ? batchFiles.find((item) => Number(item.size) > imageLimit) : null;
    const errorMessage = batch.kind === 'image' && batchFiles.length > MAX_CAROUSEL_IMAGES
      ? 'A carousel can contain up to 10 images. Split this upload into smaller batches.'
      : oversizedImage
        ? `"${oversizedImage.name}" is ${formatMegabytes(Number(oversizedImage.size))} MB. Each carousel image must be ${formatMegabytes(imageLimit)} MB or smaller for its connected platforms.`
        : unsupportedImage
          ? `Drive carousels accept ${ACCEPTED_FORMAT_LABEL} images. "${unsupportedImage.name}" is not a supported image format.`
      : batch.kind === 'video' && size > MAX_VIDEO_BYTES
      ? 'Video is larger than Driftpost’s 400 MB limit.'
      : batch.kind === 'image' && !resolvedDestinations.length && [...targetsByKey.values()].some((target) => target.destinations.some((item) => item.platform === 'youtube'))
      ? 'YouTube cannot publish photo carousels. Connect Instagram, Facebook, or X for this brand.'
        : routeError;
    const { error } = await supabase.from(TABLE).insert({
      drive_file_id: file.id,
      owner_user_id: connection.user_id,
      drive_folder_id: connection.drive_folder_id,
      file_name: batch.kind === 'image' ? `${parsed.accountName} · ${batchFiles.length} image carousel` : file.name || 'incoming-video.mp4',
      mime_type: batch.kind === 'image' ? 'image/carousel' : file.mimeType || 'video/mp4',
      file_size: size,
      account_name: parsed.accountName,
      platforms: autoPlatforms,
      result: {
        target_brands: targetBrands,
        ...(targetBrands.length === 1 && targetBrands[0].brand_id ? { brand_id: targetBrands[0].brand_id } : {}),
        ...(targetBrands.length === 1 && !targetBrands[0].brand_id ? { generic_account_target: true } : {}),
        destination_connection_ids: resolvedDestinations.map((item) => item.id),
        ...(batch.kind === 'image' ? { media_kind: 'carousel', source_drive_files: batchFiles.map((item) => ({ id: item.id, name: item.name, mime_type: item.mimeType, size: Number(item.size) || 0 })) } : {}),
      },
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
  let received = 0;
  await pipeline(response.body, new Transform({ transform(chunk, _encoding, callback) {
    received += chunk.length;
    callback(received > MAX_VIDEO_BYTES ? new Error('Google Drive video exceeds the 400 MB limit.') : null, received <= MAX_VIDEO_BYTES ? chunk : undefined);
  } }), fs.createWriteStream(destination, { flags: 'wx' }));
  const stat = await fs.promises.stat(destination);
  if (!stat.size) throw new Error('The received video is empty.');
  return stat.size;
}

// The platforms this job will publish to. The job row keeps the resolved
// platform list, and the destination connection ids confirm it.
async function jobDestinationPlatforms(supabase, job) {
  const platforms = new Set((Array.isArray(job.platforms) ? job.platforms : [])
    .map((value) => String(value || '').trim().toLowerCase()).filter(Boolean));
  const connectionIds = Array.isArray(job.result?.destination_connection_ids)
    ? job.result.destination_connection_ids.filter(Boolean) : [];
  if (connectionIds.length) {
    try {
      const { data, error } = await supabase.from('platform_connections').select('id, platform').in('id', connectionIds);
      if (error) throw error;
      for (const row of data || []) {
        const platform = String(row?.platform || '').trim().toLowerCase();
        if (platform) platforms.add(platform);
      }
    } catch (error) {
      console.warn('[drive-intake] could not read the destination platforms:', String(error?.message || error).slice(0, 160));
    }
  }
  return [...platforms];
}

// ffmpeg turns the extra photo formats into a JPEG the publishing pipeline
// can upload everywhere.
async function convertImageToJpeg(sourcePath, destinationPath) {
  await execFileAsync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', sourcePath,
    '-frames:v', '1', '-q:v', '2', destinationPath,
  ], { timeout: 60_000, maxBuffer: 1024 * 1024 });
}

async function downloadDriveCarousel(supabase, job, directory) {
  const { data: connection, error } = await supabase.from(CONNECTIONS).select('*').eq('user_id', job.owner_user_id).eq('status', 'connected').maybeSingle();
  if (error || !connection) throw new Error('The Drive connection is unavailable. Reconnect Drive in Driftpost.');
  const accessToken = await tokenFor(supabase, connection);
  const files = job.result?.source_drive_files || [];
  const limitBytes = carouselImageLimitBytes(await jobDestinationPlatforms(supabase, job));
  const media = [];
  for (let index = 0; index < files.length; index++) {
    const item = files[index];
    const mime = normalizeImageMime(item.mime_type) || mimeFromFileName(item.name);
    if (!isAcceptedCarouselImageType(mime)) {
      throw new Error(`Carousel image ${index + 1} ("${item.name}") is not a supported image format. Drive carousels accept ${ACCEPTED_FORMAT_LABEL} images.`);
    }
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(item.id)}?alt=media`, {
      headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok || !response.body) throw new Error(`Google Drive could not download carousel image ${index + 1}.`);
    const stem = `${directory}/source-${String(index + 1).padStart(2, '0')}`;
    const sourcePath = `${stem}${imageExtensionFor(mime)}`;
    let received = 0;
    await pipeline(response.body, new Transform({ transform(chunk, _encoding, callback) {
      received += chunk.length;
      callback(received > limitBytes ? new Error(`Carousel image ${index + 1} exceeds the ${Math.floor(limitBytes / (1024 * 1024))} MB limit.`) : null, received <= limitBytes ? chunk : undefined);
    } }), fs.createWriteStream(sourcePath, { flags: 'wx' }));
    let mediaPath = sourcePath;
    let mediaMime = mime;
    let stat = await fs.promises.stat(sourcePath);
    if (!stat.size) throw new Error(`Carousel image ${index + 1} ("${item.name}") is empty.`);
    if (needsJpegConversion(mime)) {
      const convertedPath = `${stem}-converted.jpg`;
      try {
        await convertImageToJpeg(sourcePath, convertedPath);
      } catch {
        throw new Error(`Could not convert "${item.name}" (${imageFormatLabel(mime)}) to JPEG. Install ffmpeg on the Driftpost server or upload a JPEG or PNG copy of this image.`);
      }
      const convertedStat = await fs.promises.stat(convertedPath);
      if (!convertedStat.size) throw new Error(`Could not convert "${item.name}" (${imageFormatLabel(mime)}) to JPEG. Install ffmpeg on the Driftpost server or upload a JPEG or PNG copy of this image.`);
      mediaPath = convertedPath;
      mediaMime = 'image/jpeg';
      stat = convertedStat;
      await fs.promises.rm(sourcePath, { force: true }).catch(() => {});
    }
    if (stat.size > limitBytes) {
      throw new Error(`Carousel image ${index + 1} ("${item.name}") is ${formatMegabytes(stat.size)} MB. The limit is ${formatMegabytes(limitBytes)} MB for the connected platforms.`);
    }
    media.push({ path: mediaPath, name: item.name, mimetype: mediaMime, size: stat.size });
  }
  return media;
}

async function runClaimedIntakeJob(supabase, job) {
  const heartbeat = setInterval(() => { void supabase.from(TABLE).update({ updated_at: new Date().toISOString() }).eq('id', job.id).eq('status', 'processing'); }, 60_000);
  heartbeat.unref();
  try {
    await processIntakeJob(supabase, job, {
      table: TABLE,
      intakeKey: 'google_drive_intake_job_id',
      sourcePrefix: 'drive',
      resolveDestinations: (brand, connections, platforms) => mapBrandDestinations(brand, connections, platforms),
      assessBrand: (brand, frames, transcript) => assessVideoBrandMatch(brand, frames, transcript),
      download: (current, destination) => downloadDriveVideo(supabase, current, destination),
      downloadMedia: (current, directory) => downloadDriveCarousel(supabase, current, directory),
      progress: async (stage, detail) => {
        await supabase.from(TABLE).update({ result: { ...(job.result || {}), progress: { stage, detail, updated_at: new Date().toISOString() } }, updated_at: new Date().toISOString() }).eq('id', job.id).eq('status', 'processing');
      },
      notify: async () => {},
    });
  } catch (error) {
    const message = String(error?.message || 'Could not prepare the automatic post.').slice(0, 800);
    await supabase.from(TABLE).update({ status: 'failed', error: message, updated_at: new Date().toISOString() }).eq('id', job.id);
    console.error('[drive-intake] job failed:', job.id, message);
  } finally {
    clearInterval(heartbeat);
    intakeActive = Math.max(0, intakeActive - 1);
    void processQueued(supabase);
  }
}

async function processQueued(supabase) {
  if (intakeBusy || intakeActive >= MAX_ACTIVE_INTAKE_JOBS) return;
  intakeBusy = true;
  try {
    const staleBefore = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    await supabase.from(TABLE).update({ status: 'queued', updated_at: new Date().toISOString() }).eq('status', 'processing').lt('updated_at', staleBefore);
    const slots = MAX_ACTIVE_INTAKE_JOBS - intakeActive;
    const { data: pending, error } = await supabase.from(TABLE).select('*').eq('status', 'queued').order('created_at', { ascending: true }).limit(slots);
    if (error) throw error;
    for (const job of pending || []) {
      const { data: claimed, error: claimError } = await supabase.from(TABLE).update({ status: 'processing', updated_at: new Date().toISOString() }).eq('id', job.id).eq('status', 'queued').select().maybeSingle();
      if (claimError) { console.error('[drive-intake] could not claim job:', job.id, claimError.message); continue; }
      if (!claimed) continue;
      intakeActive += 1;
      void runClaimedIntakeJob(supabase, claimed);
    }
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
      const { data: rows, error: rowError } = await supabase.from('scheduled_posts').select('id, platform, connection_id, status, result_url, error').in('id', destinations.map((item) => item.id));
      if (rowError || !rows || rows.length !== destinations.length) continue;
      const connectionIds = rows.map((row) => row.connection_id).filter(Boolean);
      const { data: accounts } = connectionIds.length
        ? await supabase.from('platform_connections').select('id, account_name').in('id', connectionIds)
        : { data: [] };
      const accountNames = new Map((accounts || []).map((account) => [account.id, account.account_name]));
      const destinationProgress = rows.map((row) => ({ platform: row.platform, account: accountNames.get(row.connection_id) || 'Connected account', status: row.status, ...(row.error ? { error: row.error } : {}), ...(row.result_url ? { url: row.result_url } : {}) }));
      if (rows.some((row) => ['scheduled', 'publishing'].includes(row.status))) {
        const active = destinationProgress.filter((item) => ['scheduled', 'publishing'].includes(item.status));
        await supabase.from(TABLE).update({
          result: { ...(job.result || {}), progress: { stage: 'publishing', detail: active.map((item) => `${item.platform} · ${item.account}: ${item.status}`).join(' | '), destinations: destinationProgress, updated_at: new Date().toISOString() } },
          updated_at: new Date().toISOString(),
        }).eq('id', job.id).eq('status', 'publishing');
        continue;
      }
      const published = rows.filter((row) => row.status === 'published');
      const failed = rows.filter((row) => row.status !== 'published');
      const status = failed.length ? (published.length ? 'partial' : 'failed') : 'completed';
      await supabase.from(TABLE).update({ status, result: { ...(job.result || {}), progress: { stage: status, detail: status === 'completed' ? `Published to ${published.length} destination${published.length === 1 ? '' : 's'}` : `${published.length} published, ${failed.length} need attention`, destinations: destinationProgress, updated_at: new Date().toISOString() } }, updated_at: new Date().toISOString() }).eq('id', job.id).eq('status', 'publishing');
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
  setInterval(scan, 10_000).unref();
  setInterval(() => { void processQueued(supabase); }, 5_000).unref();
  setInterval(() => { void checkPublishOutcomes(supabase); }, 15_000).unref();
  setTimeout(scan, 2_000).unref();
  setTimeout(() => { void processQueued(supabase); }, 4_000).unref();
}
