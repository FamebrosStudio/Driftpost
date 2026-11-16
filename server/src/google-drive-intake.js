import fs from 'node:fs';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { decryptJson, encryptJson } from './crypto.js';
import { processIntakeJob } from './intake-processor.js';
import { inferLikelyVideoBrands } from './ai.js';
import { getAssignedInstagramTags, mapBrandDestinations, matchDriveAccounts, resolveDriveBrand } from './brand-routing.js';

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
const lastScanErrorByUser = new Map();

export function getDriveScanError(userId) {
  return lastScanErrorByUser.get(String(userId || '')) || '';
}
// Keep video/carousel analysis bounded to protect memory; the persistent
// database queue accepts more jobs and drains as slots free up.
// Process the shared editor inbox FIFO, one video/brand at a time. This keeps
// concurrent uploads from mixing destination state or overloading analysis,
// and still drains larger batches automatically as each job finishes.
const MAX_ACTIVE_INTAKE_JOBS = 1;

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

export function parseDestination(fileName, { stripExtension = true } = {}) {
  const rawName = String(fileName || '').split(/[\\/]/).at(-1).trim();
  const base = stripExtension ? rawName.replace(/\.[a-z0-9]{2,8}$/i, '').trim() : rawName;
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

export function shouldHoldForBrandInference({ kind, size, targetErrors = [], destinations = [] }) {
  return kind === 'video' && Number(size) <= MAX_VIDEO_BYTES && (targetErrors.length > 0 || destinations.length === 0);
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

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi', '.3gp', '.mpeg', '.mpg']);

function fileExtension(name) {
  const match = String(name || '').trim().toLowerCase().match(/(\.[a-z0-9]{2,8})$/);
  return match ? match[1] : '';
}

export function isIntakeVideoFile(file) {
  const mime = String(file?.mimeType || '').trim().toLowerCase();
  if (mime.startsWith('video/')) return true;
  if ((!mime || mime === 'application/octet-stream' || mime === 'application/mp4') && VIDEO_EXTENSIONS.has(fileExtension(file?.name))) {
    return true;
  }
  return false;
}

export function isIntakeImageFile(file) {
  const mime = String(file?.mimeType || '').trim().toLowerCase();
  if (mime.startsWith('image/')) return true;
  if ((!mime || mime === 'application/octet-stream') && Boolean(mimeFromFileName(file?.name))) {
    return true;
  }
  return false;
}

export function normalizeIntakeImageMime(file) {
  const mime = String(file?.mimeType || '').trim().toLowerCase();
  if (mime.startsWith('image/')) return mime;
  return mimeFromFileName(file?.name) || mime;
}

async function listSubfolderImages(accessToken, subfolderId) {
  const images = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({
      q: `'${String(subfolderId).replace(/'/g, "\\'")}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`,
      fields: 'nextPageToken,files(id,name,mimeType,size,createdTime,modifiedTime)',
      pageSize: '100',
      orderBy: 'name',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      ...(pageToken ? { pageToken } : {}),
    });
    const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) return images;
    const data = await response.json().catch(() => ({}));
    for (const item of data.files || []) {
      if (isIntakeImageFile(item)) {
        images.push({ ...item, mimeType: normalizeIntakeImageMime(item) });
      }
    }
    pageToken = data.nextPageToken || '';
  } while (pageToken && images.length < 100);
  return images;
}

async function listDriveFiles(accessToken, folderId, connectedAt) {
  const files = [];
  let pageToken = '';
  const since = new Date(connectedAt || 0).toISOString();
  do {
    const params = new URLSearchParams({
      q: `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false and (createdTime > '${since}' or modifiedTime > '${since}')`,
      fields: 'nextPageToken,files(id,name,mimeType,size,createdTime,modifiedTime)',
      pageSize: '100',
      orderBy: 'modifiedTime desc',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      ...(pageToken ? { pageToken } : {}),
    });
    const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(30_000) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error?.message || 'Could not scan the Driftpost Drive folder.');
    files.push(...(data.files || []));
    pageToken = data.nextPageToken || '';
  } while (pageToken && files.length < 1000);
  for (const item of files) {
    if (item?.mimeType === 'application/vnd.google-apps.folder') {
      item.children = await listSubfolderImages(accessToken, item.id).catch(() => []);
    }
  }
  return files;
}

export async function enqueueFiles(supabase, connection, files) {
  const { data: ownedConnections, error: connectionsError } = await supabase.from('platform_connections')
    .select('id, user_id, platform, platform_account_id, account_name, encrypted_tokens')
    .eq('user_id', connection.user_id);
  if (connectionsError) throw new Error('Could not read the connected publishing accounts.');
  const { data: priorJobs } = await supabase.from(TABLE).select('drive_file_id, result').eq('owner_user_id', connection.user_id).order('created_at', { ascending: false }).limit(2000);
  const seenIds = new Set((priorJobs || []).flatMap((job) => [job.drive_file_id, ...(Array.isArray(job.result?.source_drive_files) ? job.result.source_drive_files.map((file) => file.id) : [])]));
  const imageFiles = files.filter(isIntakeImageFile).map((file) => ({ ...file, mimeType: normalizeIntakeImageMime(file) }));
  const videoFiles = files.filter(isIntakeVideoFile).map((file) => ({
    ...file,
    mimeType: String(file.mimeType || '').toLowerCase().startsWith('video/') ? file.mimeType : 'video/mp4',
  }));
  const folderEntries = files.filter((file) => file?.mimeType === 'application/vnd.google-apps.folder' && Array.isArray(file.children) && file.children.length > 0);
  const readyFolders = folderEntries.filter((folder) => !seenIds.has(folder.id) && folder.children.every((img) => Date.now() - Date.parse(img.createdTime || img.modifiedTime || 0) >= 90_000));
  // Editors can drop up to 10 photos for one carousel (either in a brand-named
  // folder or as flat files sharing the account name). Wait until the batch has
  // been quiet for 90 seconds so sequential uploads are not split.
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
  const batches = [
    ...videoFiles.map((file) => ({ files: [file], parsed: parseDestination(file.name), kind: 'video', brief: file.brief || '', directStoragePaths: file.directStoragePaths || [] })),
    ...readyFolders.map((folder) => ({
      files: [...folder.children].sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true })),
      parsed: parseDestination(folder.name, { stripExtension: false }),
      kind: 'image',
      folderId: folder.id,
      brief: folder.brief || '',
      directStoragePaths: folder.directStoragePaths || [],
    })),
    ...readyGroups.map((group) => ({ files: group.files.sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true })), parsed: group.parsed, kind: 'image' })),
  ];
  for (const batch of batches) {
    // A partially seen image group must never be re-enqueued as a smaller
    // second carousel on the next folder scan.
    if (batch.folderId && seenIds.has(batch.folderId)) continue;
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
        targetErrors.push(`Account mapping is ambiguous for "${requestedName}": ${routing.unresolved.join('; ')}. Correct the brand name or connected-account mapping and upload again.`);
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
    const targetBrands = [...targetsByKey.values()].map((target) => {
      const brandName = target.brand?.name || accountNames.find((name) => matchDriveAccounts(name, target.destinations).destinations.length) || parsed.accountName;
      const instagramTags = getAssignedInstagramTags({
        brandId: target.brand?.id,
        brandName,
        accountName: parsed.accountName,
        accounts: target.destinations,
      });
      return {
        brand_id: target.brand?.id || null,
        brand_name: brandName,
        destination_connection_ids: [...new Set(target.destinations.map((item) => item.id))],
        ...(instagramTags.length ? { instagram_tags: instagramTags } : {}),
      };
    });
    const allInstagramTags = [...new Set(targetBrands.flatMap((item) => item.instagram_tags || []))].slice(0, 3);
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
    // A video whose filename cannot be confidently mapped is still useful
    // evidence: queue it for AI brand inference and explicit review instead
    // of dropping it into an ordinary failed-job bucket.
    const needsBrandInference = shouldHoldForBrandInference({
      kind: batch.kind, size, targetErrors, destinations: resolvedDestinations,
    }) && !(batch.kind === 'video' && size > MAX_VIDEO_BYTES);
    const { error } = await supabase.from(TABLE).insert({
      drive_file_id: batch.folderId || file.id,
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
        ...(allInstagramTags.length ? { instagram_tags: allInstagramTags } : {}),
        destination_connection_ids: resolvedDestinations.map((item) => item.id),
        ...(needsBrandInference ? { brand_resolution_required: true, requested_brand_names: requestedNames } : {}),
        ...(batch.brief ? { brief: batch.brief } : {}),
        ...(batch.directStoragePaths?.length ? { direct_storage_paths: batch.directStoragePaths } : {}),
        ...(batch.kind === 'image' ? { media_kind: 'carousel', source_drive_files: batchFiles.map((item) => ({ id: item.id, name: item.name, mime_type: item.mimeType, size: Number(item.size) || 0, ...(item.storage_path ? { storage_path: item.storage_path } : {}) })) } : {}),
      },
      status: errorMessage && !needsBrandInference ? 'failed' : 'queued',
      error: errorMessage && !needsBrandInference ? errorMessage : null,
    });
    if (error && !/duplicate|unique/i.test(error.message || '')) console.error('[drive-intake] could not queue file:', file.id, error.message);
  }
}

export async function enqueueDirectUpload(supabase, userId, uploadedFiles, description = '') {
  const incoming = Array.isArray(uploadedFiles) ? uploadedFiles.filter(Boolean) : [];
  if (!incoming.length) throw new Error('Choose a video or up to 10 carousel images first.');
  const videos = incoming.filter((f) => String(f.mimetype || '').startsWith('video/') || isIntakeVideoFile({ name: f.originalname, mimeType: f.mimetype }));
  const images = incoming.filter((f) => String(f.mimetype || '').startsWith('image/') || isIntakeImageFile({ name: f.originalname, mimeType: f.mimetype }));
  if (videos.length && images.length) throw new Error('Upload either one video or up to 10 carousel images — not both together.');
  if (videos.length > 1) throw new Error('Upload one video per post.');
  if (!videos.length && !images.length) throw new Error('Only video and image files are supported.');
  if (images.length > MAX_CAROUSEL_IMAGES) throw new Error('Carousels support up to 10 images per post.');

  const bucket = process.env.MEDIA_BUCKET || 'driftpost-media';
  const batchId = crypto.randomUUID();
  const storagePaths = [];
  const files = [];
  const settledTime = new Date(Date.now() - 120_000).toISOString();

  try {
    for (let i = 0; i < incoming.length; i++) {
      const item = incoming[i];
      const safeName = String(item.originalname || `upload-${i + 1}`).replace(/[^\w.\- @()]/g, '_');
      const storagePath = `direct-intake/${userId}/${batchId}/${String(i + 1).padStart(2, '0')}-${safeName}`;
      const stream = fs.createReadStream(item.path);
      const { error: uploadError } = await supabase.storage.from(bucket).upload(storagePath, stream, {
        contentType: item.mimetype || (videos.length ? 'video/mp4' : 'image/jpeg'),
        duplex: 'half',
        upsert: true,
      });
      if (uploadError) throw new Error(`Could not store "${item.originalname}": ${uploadError.message}`);
      storagePaths.push(storagePath);
      files.push({
        id: `direct:${batchId}:${i + 1}`,
        name: item.originalname || safeName,
        mimeType: item.mimetype || (videos.length ? 'video/mp4' : 'image/jpeg'),
        size: Number(item.size) || 0,
        createdTime: settledTime,
        storage_path: storagePath,
      });
    }

    const isCarousel = images.length > 0;
    const brief = String(description || '').trim().slice(0, 2000);
    const connection = {
      user_id: userId,
      drive_folder_id: process.env.DRIFTPOST_DRIVE_FOLDER_ID || 'direct-upload',
    };
    if (isCarousel) {
      await enqueueFiles(supabase, connection, [{
        id: `direct:${batchId}`,
        name: parseDestination(files[0].name).accountName || files[0].name,
        mimeType: 'application/vnd.google-apps.folder',
        children: files,
        brief,
        directStoragePaths: storagePaths,
      }]);
    } else {
      await enqueueFiles(supabase, connection, [{
        ...files[0],
        id: `direct:${batchId}`,
        brief,
        directStoragePaths: storagePaths,
      }]);
    }
    void processQueued(supabase);
    return { ok: true, count: files.length, kind: isCarousel ? 'carousel' : 'video' };
  } catch (err) {
    if (storagePaths.length) await supabase.storage.from(bucket).remove(storagePaths).catch(() => {});
    throw err;
  } finally {
    for (const item of incoming) {
      if (item?.path) await fs.promises.rm(item.path, { force: true }).catch(() => {});
    }
  }
}

async function downloadStorageToFile(supabase, storagePath, destination, maxBytes) {
  const bucket = process.env.MEDIA_BUCKET || 'driftpost-media';
  const { data, error } = await supabase.storage.from(bucket).download(storagePath);
  if (error || !data) throw new Error('Could not read the uploaded media from storage.');
  const buf = Buffer.from(await data.arrayBuffer());
  if (!buf.length) throw new Error('The uploaded file is empty.');
  if (buf.length > maxBytes) throw new Error(`File exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MB limit.`);
  await fs.promises.writeFile(destination, buf, { flag: 'wx' });
  return buf.length;
}

async function downloadDriveVideo(supabase, job, destination) {
  if (job.result?.direct_storage_paths?.[0]) {
    return downloadStorageToFile(supabase, job.result.direct_storage_paths[0], destination, MAX_VIDEO_BYTES);
  }
  const { data: connection, error } = await supabase.from(CONNECTIONS).select('*').eq('user_id', job.owner_user_id).eq('status', 'connected').maybeSingle();
  if (error || !connection) throw new Error('The Drive connection is unavailable. Reconnect Drive in Driftpost.');
  const accessToken = await tokenFor(supabase, connection);
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(job.drive_file_id)}?alt=media&supportsAllDrives=true`, {
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
  const files = job.result?.source_drive_files || [];
  const hasDirectStorage = files.some((item) => item?.storage_path);
  let accessToken = '';
  if (!hasDirectStorage) {
    const { data: connection, error } = await supabase.from(CONNECTIONS).select('*').eq('user_id', job.owner_user_id).eq('status', 'connected').maybeSingle();
    if (error || !connection) throw new Error('The Drive connection is unavailable. Reconnect Drive in Driftpost.');
    accessToken = await tokenFor(supabase, connection);
  }
  const limitBytes = carouselImageLimitBytes(await jobDestinationPlatforms(supabase, job));
  const media = [];
  for (let index = 0; index < files.length; index++) {
    const item = files[index];
    const mime = normalizeImageMime(item.mime_type) || mimeFromFileName(item.name);
    if (!isAcceptedCarouselImageType(mime)) {
      throw new Error(`Carousel image ${index + 1} ("${item.name}") is not a supported image format. Drive carousels accept ${ACCEPTED_FORMAT_LABEL} images.`);
    }
    const stem = `${directory}/source-${String(index + 1).padStart(2, '0')}`;
    const sourcePath = `${stem}${imageExtensionFor(mime)}`;
    if (item.storage_path) {
      await downloadStorageToFile(supabase, item.storage_path, sourcePath, limitBytes);
    } else {
      const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(item.id)}?alt=media&supportsAllDrives=true`, {
        headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok || !response.body) throw new Error(`Google Drive could not download carousel image ${index + 1}.`);
      let received = 0;
      await pipeline(response.body, new Transform({ transform(chunk, _encoding, callback) {
        received += chunk.length;
        callback(received > limitBytes ? new Error(`Carousel image ${index + 1} exceeds the ${Math.floor(limitBytes / (1024 * 1024))} MB limit.`) : null, received <= limitBytes ? chunk : undefined);
      } }), fs.createWriteStream(sourcePath, { flags: 'wx' }));
    }
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

function progressPercentFor(stage, detail = '') {
  const s = String(stage || '').toLowerCase();
  const d = String(detail || '').toLowerCase();
  if (s === 'queued') return 10;
  if (s === 'downloading') return 25;
  if (s === 'analyzing') return d.includes('extract') ? 40 : 55;
  if (s === 'preparing') return 75;
  if (s === 'queueing') return 90;
  if (s === 'publishing') return 94;
  if (s === 'completed' || s === 'partial' || s === 'failed' || s === 'stopped') return 100;
  return 15;
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
      // Drive uploads follow the legacy direct-post flow without the optional
      // AI brand-mismatch hold. Destination/account validation remains active.
      verifyBrand: false,
      suggestBrands: (frames, transcript, excludedIds) => inferLikelyVideoBrands(frames, transcript, excludedIds),
      download: (current, destination) => downloadDriveVideo(supabase, current, destination),
      downloadMedia: (current, directory) => downloadDriveCarousel(supabase, current, directory),
      progress: async (stage, detail) => {
        const percent = progressPercentFor(stage, detail);
        await supabase.from(TABLE).update({ result: { ...(job.result || {}), progress: { stage, detail, percent, updated_at: new Date().toISOString() } }, updated_at: new Date().toISOString() }).eq('id', job.id).eq('status', 'processing');
      },
      notify: async () => {},
    });
  } catch (error) {
    const message = String(error?.message || 'Could not prepare the automatic post.').slice(0, 800);
    await supabase.from(TABLE).update({ status: 'failed', error: message, updated_at: new Date().toISOString() }).eq('id', job.id).neq('status', 'stopped');
    console.error('[drive-intake] job failed:', job.id, message);
  } finally {
    clearInterval(heartbeat);
    if (Array.isArray(job.result?.direct_storage_paths) && job.result.direct_storage_paths.length) {
      await supabase.storage.from(process.env.MEDIA_BUCKET || 'driftpost-media').remove(job.result.direct_storage_paths).catch(() => {});
    }
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
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(job.drive_file_id)}?alt=media&supportsAllDrives=true`, {
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

async function scanFolders(supabase, onlyUserId = '') {
  let query = supabase.from(CONNECTIONS).select('*').eq('status', 'connected').limit(20);
  if (onlyUserId) query = query.eq('user_id', onlyUserId);
  const { data: connections, error } = await query;
  if (error || !connections?.length) return;
  for (const connection of connections) {
    try {
      const folderId = String(connection.drive_folder_id || process.env.DRIFTPOST_DRIVE_FOLDER_ID || '').trim();
      if (!folderId) throw new Error('Drive intake folder ID is not configured.');
      const accessToken = await tokenFor(supabase, connection);
      const files = await listDriveFiles(accessToken, folderId, connection.created_at);
      await enqueueFiles(supabase, { ...connection, drive_folder_id: folderId }, files);
      lastScanErrorByUser.delete(String(connection.user_id));
    } catch (error) {
      const msg = String(error?.message || error).slice(0, 220);
      lastScanErrorByUser.set(String(connection.user_id), msg);
      console.error('[drive-intake] folder scan failed:', connection.user_id, msg);
    }
  }
}

export async function triggerDriveScan(supabase, userId = '') {
  if (!process.env.DRIFTPOST_DRIVE_FOLDER_ID && !userId) return;
  await scanFolders(supabase, userId);
  await processQueued(supabase);
}

export function startGoogleDriveIntake(supabase) {
  if (!process.env.DRIFTPOST_DRIVE_FOLDER_ID) {
    console.info('[drive-intake] disabled; DRIFTPOST_DRIVE_FOLDER_ID is not set.');
    return;
  }
  // Recover any jobs left in 'processing' or stale 'scheduled_posts' left in 'publishing' from a previous server restart.
  void supabase.from('scheduled_posts')
    .update({ status: 'failed', error: 'Publishing was interrupted by a server restart. Please retry or stop.', updated_at: new Date().toISOString() })
    .eq('status', 'publishing')
    .then(() => { void checkPublishOutcomes(supabase); })
    .catch(() => {});
  void supabase.from(TABLE)
    .update({ status: 'queued', updated_at: new Date().toISOString() })
    .eq('status', 'processing')
    .then(() => { void processQueued(supabase); })
    .catch(() => {});
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
