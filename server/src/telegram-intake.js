import crypto from 'node:crypto';
import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { transcribeVideo } from './video-analysis.js';
import { generateCaptions, selectVideoCoverFrames } from './ai.js';
import { uploadMediaFile } from './media-io.js';
import { getBrandById, resolveBrand } from './brand-memory/index.js';
import { canUsePrivateBrandData } from './brand-access.js';

const execFileAsync = promisify(execFile);
const MAX_VIDEO_BYTES = 400 * 1024 * 1024;
const TELEGRAM_HOSTED_DOWNLOAD_BYTES = 20 * 1024 * 1024;
const PLATFORMS = new Set(['youtube', 'instagram', 'facebook', 'x']);
const clean = (value) => String(value || '').trim();
const normalize = (value) => clean(value).toLowerCase().replace(/^@/, '').replace(/[^\p{L}\p{N}]+/gu, '');

function botBase() {
  return String(process.env.TELEGRAM_BOT_API_URL || 'https://api.telegram.org').replace(/\/$/, '');
}

async function telegram(method, payload, { timeout = 20_000 } = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('Telegram intake is not configured.');
  const response = await fetch(`${botBase()}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeout),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.description || `Telegram ${method} failed.`);
  return data.result;
}

async function reply(chatId, text, replyToMessageId) {
  try {
    await telegram('sendMessage', {
      chat_id: chatId,
      text: String(text).slice(0, 4000),
      ...(replyToMessageId ? { reply_to_message_id: replyToMessageId, allow_sending_without_reply: true } : {}),
    });
  } catch (error) {
    console.warn('[telegram-intake] reply failed:', String(error?.message || error).slice(0, 180));
  }
}

function parseVideoMessage(message) {
  const video = message.video || (message.document?.mime_type?.startsWith('video/') ? message.document : null);
  if (!video?.file_id) return null;
  const text = clean(message.caption || message.caption_entities?.map((entity) => entity.text).join(' '));
  const account = text.match(/^(?:account|brand|post\s+to)\s*:\s*(.+)$/im)?.[1]?.trim() || text.split(/\r?\n/).map(clean).find(Boolean) || '';
  return {
    fileId: video.file_id,
    fileSize: Number(video.file_size) || 0,
    fileName: clean(message.document?.file_name) || `telegram-${message.message_id}.mp4`,
    mimeType: clean(message.document?.mime_type) || 'video/mp4',
    accountName: account.slice(0, 180),
  };
}

async function getTelegramVideo(fileId, destination) {
  const info = await telegram('getFile', { file_id: fileId }, { timeout: 45_000 });
  if (!info?.file_path || (Number(info.file_size) || 0) > MAX_VIDEO_BYTES) throw new Error('This video is larger than Driftpost’s 400 MB limit.');
  const response = await fetch(`${botBase()}/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${info.file_path}`, {
    signal: AbortSignal.timeout(15 * 60 * 1000),
  });
  if (!response.ok || !response.body) throw new Error('Telegram could not provide the uploaded video. Please send it again.');
  const { pipeline } = await import('node:stream/promises');
  const { createWriteStream } = await import('node:fs');
  await pipeline(response.body, createWriteStream(destination, { flags: 'wx' }));
  const stat = await fs.stat(destination);
  if (!stat.size || stat.size > MAX_VIDEO_BYTES) throw new Error('The received video is empty or larger than 400 MB.');
  return stat.size;
}

async function sampleFrames(videoPath, directory) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', videoPath,
  ], { timeout: 60_000, maxBuffer: 1024 * 1024 });
  const duration = Number(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('The video duration could not be read. Send an MP4, MOV, or WebM video.');
  const count = Math.min(8, Math.max(4, Math.ceil(duration / 6)));
  const frames = [];
  for (let index = 0; index < count; index++) {
    const seconds = Math.min(Math.max(0, duration - 0.1), duration * ((index + 0.5) / count));
    const output = path.join(directory, `frame-${index}.jpg`);
    await execFileAsync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y', '-ss', String(seconds), '-i', videoPath,
      '-frames:v', '1', '-vf', 'scale=1024:1024:force_original_aspect_ratio=decrease', '-q:v', '4', output,
    ], { timeout: 90_000, maxBuffer: 2 * 1024 * 1024 });
    const stat = await fs.stat(output).catch(() => null);
    if (stat?.size) frames.push({ path: output, name: `frame-${index}.jpg`, mimetype: 'image/jpeg', base64: (await fs.readFile(output)).toString('base64') });
  }
  if (frames.length < 2) throw new Error('Could not extract enough readable frames from this video.');
  return { frames, duration };
}

async function makePlatformCover(framePath, platform, directory) {
  const dimensions = platform === 'instagram' ? '720:1280' : '1280:720';
  const destination = path.join(directory, `cover-${platform}.jpg`);
  await execFileAsync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', framePath,
    '-vf', `split=2[bg][fg];[bg]scale=${dimensions}:force_original_aspect_ratio=increase,crop=${dimensions},boxblur=20:10,eq=brightness=-0.2[bg];[fg]scale=${dimensions}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2`,
    '-frames:v', '1', '-q:v', '3', destination,
  ], { timeout: 90_000, maxBuffer: 2 * 1024 * 1024 });
  const stat = await fs.stat(destination);
  if (!stat.size || stat.size > 5 * 1024 * 1024) throw new Error(`Could not prepare a valid ${platform} cover.`);
  return { path: destination, mimetype: 'image/jpeg', originalname: `ai-cover-${platform}.jpg`, size: stat.size };
}

function matchConnections(connections, accountName) {
  const query = normalize(accountName);
  const matches = (connections || []).filter((item) => PLATFORMS.has(item.platform) && normalize(item.account_name) === query);
  return matches;
}

export async function processIntakeJob(supabase, job, options = {}) {
  const ownerId = job.owner_user_id;
  const table = options.table || 'telegram_video_jobs';
  const intakeKey = options.intakeKey || 'telegram_intake_job_id';
  const notify = options.notify || ((message) => reply(job.chat_id, message, job.message_id));
  const progress = async (stage, detail = '') => { if (options.progress) await options.progress(stage, detail); };
  const isCarousel = job.result?.media_kind === 'carousel';
  if (!ownerId) throw new Error('The Driftpost publishing account is not configured.');
  // A worker can restart after inserting publish rows but before updating the
  // inbox row. Detect that commit before retrying analysis so a Telegram retry
  // can never create a duplicate social post.
  const { data: alreadyQueued, error: queuedLookupError } = await supabase.from('scheduled_posts')
    .select('id, platform').eq('user_id', ownerId).contains('body', { [intakeKey]: job.id }).limit(25);
  if (queuedLookupError) throw new Error('Could not safely check whether this video is already queued.');
  if (alreadyQueued?.length) {
    const { error: updateError } = await supabase.from(table).update({
      status: 'publishing', result: { ...(job.result || {}), destinations: alreadyQueued }, updated_at: new Date().toISOString(),
    }).eq('id', job.id);
    if (updateError) console.error('[telegram-intake] could not reconcile queued publish rows:', updateError.message);
    await notify(`This media is already queued for ${alreadyQueued.length} destination${alreadyQueued.length === 1 ? '' : 's'}. I will send the result when publishing finishes.`);
    return;
  }
  const { data: authResult, error: authError } = await supabase.auth.admin.getUserById(ownerId);
  if (authError || !canUsePrivateBrandData(authResult?.user)) throw new Error('The configured publishing account is not approved for the private video workflow.');
  const accountName = clean(job.account_name);
  if (accountName.length < 2) throw new Error('Add the destination in the video caption, for example: Account: Famebros Studio.');
  const directConnectionIds = Array.isArray(job.result?.destination_connection_ids) ? job.result.destination_connection_ids : [];
  const { data: rawConnections, error: connectionError } = await supabase.from('platform_connections')
    .select('id, user_id, platform, platform_account_id, account_name, encrypted_tokens')
    .eq('user_id', ownerId);
  if (connectionError) throw new Error('Could not read the configured Driftpost publishing accounts.');
  const requestedPlatforms = Array.isArray(job.platforms) ? job.platforms : [];
  const configuredTargets = Array.isArray(job.result?.target_brands) && job.result.target_brands.length ? job.result.target_brands : null;
  let targetGroups = [];
  if (configuredTargets) {
    targetGroups = configuredTargets.map((target) => {
      const ids = Array.isArray(target.destination_connection_ids) ? target.destination_connection_ids : [];
      const matched = (rawConnections || []).filter((item) => ids.includes(item.id));
      if (!ids.length || matched.length !== ids.length) throw new Error(`One or more connected accounts for "${target.brand_name || accountName}" are no longer available. Reconnect them and resend.`);
      const brand = target.brand_id ? getBrandById(target.brand_id) : null;
      if (target.brand_id && !brand) throw new Error(`The saved brand profile for "${target.brand_name || accountName}" is missing. Refresh the brand data and resend.`);
      return { brand: brand || { id: null, name: target.brand_name || accountName }, name: target.brand_name || brand?.name || accountName, destinations: matched };
    });
  } else {
    const savedBrand = job.result?.brand_id ? getBrandById(job.result.brand_id) : null;
    let brandHit = job.result?.generic_account_target ? null : (savedBrand ? { brand: savedBrand, score: 1000 } : resolveBrand(accountName, 400));
    const directDestinations = directConnectionIds.length ? (rawConnections || []).filter((item) => directConnectionIds.includes(item.id)) : [];
    if (directConnectionIds.length && directDestinations.length !== directConnectionIds.length) throw new Error('One or more selected connected accounts are no longer available. Check the account and retry.');
    if (!brandHit && directDestinations.length) brandHit = { brand: { id: null, name: accountName }, score: 400 };
    if (!brandHit || brandHit.score < 400) throw new Error(`Could not safely match "${accountName}" to a saved brand profile or an exact connected account. Check the account name and retry.`);
    const routing = directDestinations.length
      ? { destinations: directDestinations, unresolved: [] }
      : options.resolveDestinations
      ? options.resolveDestinations(brandHit.brand, rawConnections, requestedPlatforms)
      : { destinations: matchConnections(rawConnections, accountName).filter((item) => !requestedPlatforms.length || requestedPlatforms.includes(item.platform)), unresolved: [] };
    if (routing.unresolved?.length) throw new Error(`Account mapping needs review: ${routing.unresolved.join('; ')}.`);
    targetGroups = [{ brand: brandHit.brand?.id ? brandHit.brand : { id: null, name: brandHit.brand?.name || accountName }, name: brandHit.brand?.name || accountName, destinations: routing.destinations || [] }];
  }
  const destinations = [...new Map(targetGroups.flatMap((target) => target.destinations).map((item) => [item.id, item])).values()];
  for (const destination of destinations) {
    const owners = new Set(targetGroups.filter((target) => target.destinations.some((item) => item.id === destination.id)).map((target) => target.brand?.id || `generic:${target.name}`));
    if (owners.size > 1) throw new Error(`The connected account "${destination.account_name}" maps to more than one requested brand. Send separate files for those brands so captions cannot mix their data.`);
  }
  if (!destinations.length) throw new Error(`“${accountName}” does not exactly match a connected account. Send the connected account name or handle.`);

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'driftpost-telegram-'));
  const videoPath = path.join(directory, path.basename(job.file_name || 'incoming-video.mp4').replace(/[^a-z0-9._-]/gi, '_').slice(-140));
  const storedPaths = [];
  try {
    await progress('downloading', isCarousel ? `Downloading ${job.result.source_drive_files?.length || 1} carousel images from Drive` : 'Downloading video from Drive');
    let mediaFiles;
    let frames;
    let duration = 0;
    let transcriptWork = Promise.resolve({ text: '', warning: '' });
    if (isCarousel && options.downloadMedia) {
      mediaFiles = await options.downloadMedia(job, directory);
      if (!mediaFiles.length || mediaFiles.length > 10) throw new Error('A carousel needs between 1 and 10 supported images.');
      frames = await Promise.all(mediaFiles.slice(0, 8).map(async (item) => ({ ...item, base64: (await fs.readFile(item.path)).toString('base64') })));
    } else {
      const byteSize = options.download ? await options.download(job, videoPath) : await getTelegramVideo(job.telegram_file_id, videoPath);
      mediaFiles = [{ path: videoPath, name: path.basename(videoPath), mimetype: job.mime_type || 'video/mp4', size: byteSize }];
      await progress('analyzing', 'Extracting video frames');
      // Start speech transcription while FFmpeg samples frames. These are
      // independent operations on the same downloaded video.
      transcriptWork = transcribeVideo(videoPath, path.basename(videoPath), job.mime_type || 'video/mp4')
        .then((result) => ({ text: result.text || '', warning: '' }))
        .catch((error) => {
          console.warn('[telegram-intake] transcription unavailable:', String(error?.message || error).slice(0, 220));
          return { text: '', warning: targetGroups.some((target) => target.brand?.id)
            ? 'Speech transcription was unavailable; captions use the video frames and saved brand profiles.'
            : 'Speech transcription was unavailable; captions use the video frames only.' };
        });
      const sampled = await sampleFrames(videoPath, directory);
      frames = sampled.frames;
      duration = sampled.duration;
    }
    await progress('analyzing', isCarousel ? `Analyzing ${mediaFiles.length} carousel images` : 'Analyzing frames and speech');
    const { text: transcript, warning: speechWarning } = await transcriptWork;
    const supportedDestinations = isCarousel ? destinations.filter((item) => ['instagram', 'facebook', 'x'].includes(item.platform)) : destinations;
    if (isCarousel && !supportedDestinations.length) throw new Error('Photo carousels can publish to Instagram, Facebook, or X. This brand has no connected photo destination.');
    if (isCarousel && destinations.some((item) => item.platform === 'x') && mediaFiles.length > 4) throw new Error('X supports up to 4 photos per post. Reduce this carousel to 4 images or remove X from the selected destinations.');
    const platforms = [...new Set(supportedDestinations.map((item) => item.platform))];
    await progress('preparing', 'Writing platform captions and preparing media');
    const frameImages = frames.map(({ name, mimetype, base64 }) => ({ name, mimetype, base64 }));
    const brandTargets = targetGroups.filter((target) => target.brand?.id);
    const [assessments, coverSelection] = await Promise.all([
      options.assessBrand
        ? Promise.all(brandTargets.map(async (target) => {
          try { return { target, assessment: await options.assessBrand(target.brand, frames, transcript) }; }
          catch (error) { return { target, assessment: { verdict: 'uncertain', confidence: 0, reason: `Automatic verification could not finish: ${String(error?.message || error).slice(0, 350)}` } }; }
        }))
        : Promise.resolve([]),
      isCarousel || !platforms.some((platform) => ['youtube', 'instagram', 'facebook'].includes(platform))
        ? Promise.resolve({})
        : selectVideoCoverFrames(frameImages),
    ]);
    const failedAssessments = assessments.filter(({ assessment }) => assessment?.verdict !== 'match');
    if (failedAssessments.length) {
      const reviews = failedAssessments.map(({ target, assessment }) => ({
        brand_id: target.brand.id,
        brand_name: target.brand.name,
        verdict: assessment?.verdict || 'uncertain',
        confidence: Number.isFinite(assessment?.confidence) ? assessment.confidence : 0,
        reason: String(assessment?.reason || 'The AI could not confirm this video belongs to the selected brand.').slice(0, 500),
      }));
      const review = { ...reviews[0], reason: reviews.map((item) => `${item.brand_name}: ${item.reason}`).join(' | ').slice(0, 500), transcript_excerpt: String(transcript || '').slice(0, 2500), checked_at: new Date().toISOString() };
      const { error: reviewError } = await supabase.from(table).update({
        status: 'failed', error: review.reason,
        result: { ...(job.result || {}), brand_id: reviews[0].brand_id, review, brand_reviews: reviews },
        updated_at: new Date().toISOString(),
      }).eq('id', job.id).eq('status', 'processing');
      if (reviewError) throw new Error('The brand review was triggered, but Driftpost could not save the review item.');
      await notify(`Human review needed for ${reviews.map((item) => item.brand_name).join(', ')}: ${review.reason}`);
      return { needsReview: true, assessments: reviews };
    }
    // Each brand gets captions from its own complete saved profile. Generate
    // those independent caption sets concurrently without mixing brand facts.
    const captionTargets = await Promise.all(targetGroups.map(async (target) => {
      const targetPlatforms = [...new Set(target.destinations.filter((item) => supportedDestinations.some((dest) => dest.id === item.id)).map((item) => item.platform))];
      const generated = await generateCaptions(
        `Create accurate, platform-specific captions for the ${isCarousel ? 'photo carousel' : 'video'} sent to the ${target.name} account. Describe only what is visible or spoken.`,
        {
          brand: target.brand?.id ? target.brand.name : '',
          brandId: target.brand?.id || '',
          allowPrivateBrandData: !!target.brand?.id,
          assetHint: isCarousel ? `A carousel of ${mediaFiles.length} images, ordered by filename.` : `Video duration ${Math.round(duration)} seconds.`,
          goal: 'enquiries', tone: 'auto', emoji: 'medium', length: 'medium',
          transcript, platforms: targetPlatforms, video_frame_analysis: true, images: frameImages,
        },
      );
      return { ...target, captions: generated.captions || generated };
    }));
    const covers = {};
    for (const platform of platforms) {
      if (!['youtube', 'instagram', 'facebook'].includes(platform)) continue;
      const selected = Number(coverSelection?.[platform]);
      if (!Number.isInteger(selected) || !frames[selected]) throw new Error(`AI could not select a safe ${platform} cover frame.`);
      covers[platform] = await makePlatformCover(frames[selected].path, platform, directory);
    }

    const sourcePrefix = options.sourcePrefix || 'telegram';
    const storedMedia = [];
    for (let index = 0; index < mediaFiles.length; index++) {
      let item = mediaFiles[index];
      if (isCarousel && item.mimetype === 'image/png' && platforms.includes('instagram')) {
        const jpegPath = path.join(directory, `carousel-${index + 1}.jpg`);
        await execFileAsync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', item.path, '-frames:v', '1', '-q:v', '2', jpegPath], { timeout: 60_000, maxBuffer: 1024 * 1024 });
        const stat = await fs.stat(jpegPath);
        const maxBytes = platforms.includes('instagram') ? 8 * 1024 * 1024 : 10 * 1024 * 1024;
        if (stat.size > maxBytes) throw new Error(`Prepared carousel image ${index + 1} exceeds ${maxBytes / 1024 / 1024} MB for the connected platforms.`);
        item = { ...item, path: jpegPath, mimetype: 'image/jpeg', size: stat.size };
      }
      const extension = item.mimetype === 'image/png' ? '.png' : '.jpg';
      const key = `scheduled/${ownerId}/${sourcePrefix}-${job.id}/${isCarousel ? `image-${String(index + 1).padStart(2, '0')}${extension}` : `video${path.extname(item.name || videoPath) || '.mp4'}`}`;
      const { error: mediaUploadError } = await uploadMediaFile(supabase.storage.from(process.env.MEDIA_BUCKET || 'driftpost-media'), key, item, { contentType: item.mimetype, upsert: true });
      if (mediaUploadError) throw new Error(`Could not save ${isCarousel ? `carousel image ${index + 1}` : 'the video'} for automatic publishing.`);
      storedPaths.push(key);
      storedMedia.push({ path: key, mimetype: item.mimetype, name: item.name });
    }
    const storedCovers = {};
    let thumbPath = null;
    for (const [platform, cover] of Object.entries(covers)) {
      const key = `scheduled/${ownerId}/${sourcePrefix}-${job.id}/${platform}-cover.jpg`;
      const { error } = await uploadMediaFile(supabase.storage.from(process.env.MEDIA_BUCKET || 'driftpost-media'), key, cover, { contentType: 'image/jpeg', upsert: true });
      if (error) throw new Error(`Could not save the ${platform} cover.`);
      storedPaths.push(key);
      if (platform === 'youtube') thumbPath = key;
      else storedCovers[platform] = { path: key, name: path.basename(key), mimetype: 'image/jpeg' };
    }

    await progress('queueing', `Adding ${storedMedia.length} ${isCarousel ? 'images' : 'video'} to the publishing queue`);
    const rows = supportedDestinations.map((connection) => {
      const captionTarget = captionTargets.find((target) => target.destinations.some((item) => item.id === connection.id));
      const byPlatform = captionTarget?.captions || {};
      const body = {
        text: '', skip_crosspost: '1', [intakeKey]: job.id,
        ai_generated: '1', yt_privacy: 'public',
        yt_thumbnail_mimetype: 'image/jpeg',
        driftpost_covers: storedCovers,
      };
      if (connection.platform === 'instagram') {
        body.ig_caption = String(byPlatform.instagram?.caption || '').trim();
        body.text = body.ig_caption;
      } else if (connection.platform === 'facebook') {
        body.fb_message = String(byPlatform.facebook?.message || '').trim();
        body.text = body.fb_message;
      } else if (connection.platform === 'youtube') {
        body.yt_title = String(byPlatform.youtube?.title || '').slice(0, 100).trim();
        body.yt_description = String(byPlatform.youtube?.description || '').trim();
        body.yt_tags = Array.isArray(byPlatform.youtube?.tags) ? byPlatform.youtube.tags.join(', ') : String(byPlatform.youtube?.tags || '');
        body.text = body.yt_description;
      } else {
        body.x_text = Array.from(String(byPlatform.x?.text || '')).slice(0, 280).join('').trim();
        body.text = body.x_text;
      }
      if (!body.text || (connection.platform === 'youtube' && !body.yt_title)) throw new Error(`AI did not return a complete ${connection.platform} caption.`);
      return {
        user_id: ownerId,
        platform: connection.platform,
        connection_id: connection.id,
        scheduled_at: new Date(Date.now() - 2000).toISOString(),
        status: 'scheduled',
        body,
        media: storedMedia,
        thumb_path: connection.platform === 'youtube' ? thumbPath : null,
      };
    });
    if (rows.length > 25) throw new Error('This account name matched too many destinations. Refine the connected account names before sending.');
    const { data: scheduled, error: scheduleError } = await supabase.from('scheduled_posts').insert(rows).select('id, platform');
    if (scheduleError || !scheduled || scheduled.length !== rows.length) throw new Error('The video was prepared, but Driftpost could not add every destination to its publishing queue.');
    const { error: intakeUpdateError } = await supabase.from(table).update({
      status: 'publishing',
      result: { ...(job.result || {}), brand: targetGroups.map((target) => target.name).join(', '), brands: targetGroups.map((target) => ({ id: target.brand?.id || null, name: target.name })), destinations: scheduled, transcript: !!transcript, speechWarning, media_kind: isCarousel ? 'carousel' : 'video', progress: { stage: 'publishing', detail: `Queued to ${scheduled.length} destination${scheduled.length === 1 ? '' : 's'}`, updated_at: new Date().toISOString() } },
      updated_at: new Date().toISOString(),
    }).eq('id', job.id);
    if (intakeUpdateError) console.error('[telegram-intake] queued posts but could not update intake status:', intakeUpdateError.message);
    await notify(`✅ ${isCarousel ? `${mediaFiles.length}-image carousel` : 'Video'} processed for ${targetGroups.map((target) => target.name).join(', ')}. Queued ${scheduled.length} destination${scheduled.length === 1 ? '' : 's'} for automatic publishing.${speechWarning ? `\n\nNote: ${speechWarning}` : ''}`);
  } catch (error) {
    await supabase.storage.from(process.env.MEDIA_BUCKET || 'driftpost-media').remove(storedPaths).catch(() => {});
    throw error;
  } finally {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

export function createTelegramIntakeRouter(supabase) {
  const router = express.Router();
  const configuredChatIds = new Set(String(process.env.TELEGRAM_ALLOWED_CHAT_IDS || '').split(',').map((id) => id.trim()).filter(Boolean));
  const configuredSenderIds = new Set(String(process.env.TELEGRAM_ALLOWED_USER_IDS || '').split(',').map((id) => id.trim()).filter(Boolean));
  const ownerId = String(process.env.TELEGRAM_DRIFTPOST_USER_ID || '');
  let workerRunning = false;
  let outcomeCheckRunning = false;

  router.post('/webhook', async (req, res) => {
    const expectedSecret = String(process.env.TELEGRAM_WEBHOOK_SECRET || '');
    const providedSecret = String(req.get('X-Telegram-Bot-Api-Secret-Token') || '');
    if (!expectedSecret || providedSecret.length !== expectedSecret.length
      || !crypto.timingSafeEqual(Buffer.from(providedSecret), Buffer.from(expectedSecret))) return res.sendStatus(403);
    const update = req.body || {};
    const message = update.message || update.channel_post;
    if (!message) return res.sendStatus(200);
    const chatId = String(message.chat?.id || '');
    const senderId = String(message.from?.id || '');
    if (!configuredChatIds.has(chatId) || !configuredSenderIds.has(senderId)) {
      await reply(chatId, 'This intake chat is not authorized to submit Driftpost videos.', message.message_id);
      return res.sendStatus(200);
    }
    const incoming = parseVideoMessage(message);
    if (!incoming) {
      await reply(chatId, 'Send one video with its destination account name in the caption, for example:\nAccount: Famebros Studio', message.message_id);
      return res.sendStatus(200);
    }
    if (incoming.fileSize > MAX_VIDEO_BYTES) {
      await reply(chatId, 'This video is over Driftpost’s 400 MB limit. Send a smaller export.', message.message_id);
      return res.sendStatus(200);
    }
    if (incoming.fileSize > TELEGRAM_HOSTED_DOWNLOAD_BYTES
      && (!process.env.TELEGRAM_BOT_API_URL || /api\.telegram\.org/i.test(process.env.TELEGRAM_BOT_API_URL))) {
      await reply(chatId, 'This video is larger than Telegram’s hosted bot download limit. The admin must finish connecting Driftpost’s private Telegram file server before large videos can be submitted.', message.message_id);
      return res.sendStatus(200);
    }
    if (!ownerId) {
      await reply(chatId, 'The Driftpost intake has not been configured yet. Ask the admin to finish setup.', message.message_id);
      return res.sendStatus(200);
    }
    const id = crypto.randomUUID();
    const { error } = await supabase.from('telegram_video_jobs').insert({
      id,
      update_id: String(update.update_id || ''),
      owner_user_id: ownerId,
      chat_id: chatId,
      sender_id: senderId,
      message_id: String(message.message_id || ''),
      telegram_file_id: incoming.fileId,
      file_name: incoming.fileName,
      mime_type: incoming.mimeType,
      file_size: incoming.fileSize,
      account_name: incoming.accountName,
      status: 'queued',
    });
    if (error) {
      if (/duplicate|unique/i.test(error.message || '')) return res.sendStatus(200);
      console.error('[telegram-intake] could not queue incoming video:', error.message);
      return res.sendStatus(503);
    }
    await reply(chatId, `📥 Received ${incoming.fileName}. ${incoming.accountName ? `Preparing automatic post for “${incoming.accountName}”.` : 'Tell me the destination with a caption such as “Account: Famebros Studio”.'}`, message.message_id);
    res.sendStatus(200);
  });

  const runWorker = async () => {
    if (workerRunning || !process.env.TELEGRAM_BOT_TOKEN || !ownerId) return;
    workerRunning = true;
    try {
      const staleBefore = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      await supabase.from('telegram_video_jobs').update({ status: 'queued', updated_at: new Date().toISOString() })
        .eq('status', 'processing').lt('updated_at', staleBefore);
      const { data: pending, error } = await supabase.from('telegram_video_jobs').select('*').eq('status', 'queued').order('created_at', { ascending: true }).limit(1);
      if (error || !pending?.length) return;
      const job = pending[0];
      const { data: claimed, error: claimError } = await supabase.from('telegram_video_jobs')
        .update({ status: 'processing', updated_at: new Date().toISOString() })
        .eq('id', job.id).eq('status', 'queued').select().maybeSingle();
      if (claimError || !claimed) return;
      await reply(job.chat_id, `🎬 Starting video analysis for ${job.account_name || 'the selected account'}…`, job.message_id);
      const heartbeat = setInterval(() => {
        void supabase.from('telegram_video_jobs').update({ updated_at: new Date().toISOString() })
          .eq('id', job.id).eq('status', 'processing').then(({ error: heartbeatError }) => {
            if (heartbeatError) console.warn('[telegram-intake] heartbeat failed:', heartbeatError.message);
          }).catch((error) => console.warn('[telegram-intake] heartbeat failed:', error?.message || error));
      }, 60_000);
      heartbeat.unref();
      try {
        await processIntakeJob(supabase, claimed);
      } catch (error) {
        const message = String(error?.message || 'Could not prepare the automatic post.').slice(0, 800);
        await supabase.from('telegram_video_jobs').update({ status: 'failed', error: message, updated_at: new Date().toISOString() }).eq('id', job.id);
        await reply(job.chat_id, `⚠️ Video not published: ${message}`, job.message_id);
        console.error('[telegram-intake] job failed:', job.id, message);
      } finally {
        clearInterval(heartbeat);
      }
    } catch (error) {
      console.error('[telegram-intake] worker error:', String(error?.message || error).slice(0, 250));
    } finally {
      workerRunning = false;
    }
  };
  const checkOutcomes = async () => {
    if (outcomeCheckRunning || !process.env.TELEGRAM_BOT_TOKEN || !ownerId) return;
    outcomeCheckRunning = true;
    try {
      const { data: active, error } = await supabase.from('telegram_video_jobs').select('id, chat_id, message_id, result')
        .eq('status', 'publishing').order('created_at', { ascending: true }).limit(10);
      if (error || !active?.length) return;
      for (const intake of active) {
        const schedules = Array.isArray(intake.result?.destinations) ? intake.result.destinations : [];
        if (!schedules.length) continue;
        const { data: rows, error: rowError } = await supabase.from('scheduled_posts').select('id, platform, status, result_url, error')
          .in('id', schedules.map((item) => item.id));
        if (rowError || !rows || rows.length !== schedules.length || rows.some((row) => ['scheduled', 'publishing'].includes(row.status))) continue;
        const published = rows.filter((row) => row.status === 'published');
        const failed = rows.filter((row) => row.status !== 'published');
        const links = published.filter((row) => row.result_url).map((row) => `${row.platform}: ${row.result_url}`);
        const speechWarning = intake.result?.speechWarning;
        const summary = `${published.length} destination${published.length === 1 ? '' : 's'} published; ${failed.length} failed.`;
        await reply(intake.chat_id, `${published.length && !failed.length ? '✅' : published.length ? '⚠️' : '❌'} ${summary}${links.length ? `\n${links.join('\n')}` : ''}${failed.length ? `\n${failed.map((row) => `${row.platform}: ${row.error || 'Publishing failed'}`).join('\n')}` : ''}${speechWarning ? `\n\n${speechWarning}` : ''}`, intake.message_id);
        await supabase.from('telegram_video_jobs').update({ status: failed.length ? 'partial' : 'completed', updated_at: new Date().toISOString() }).eq('id', intake.id).eq('status', 'publishing');
      }
    } catch (error) {
      console.error('[telegram-intake] outcome check failed:', String(error?.message || error).slice(0, 200));
    } finally {
      outcomeCheckRunning = false;
    }
  };
  setInterval(() => { void runWorker(); }, 3000).unref();
  setInterval(() => { void checkOutcomes(); }, 15_000).unref();
  setTimeout(() => { void runWorker(); }, 1000).unref();
  return router;
}

let telegramWebhookReady = false;
let telegramWebhookRegistering = false;
export async function registerTelegramWebhook() {
  if (telegramWebhookReady) return true;
  const url = clean(process.env.TELEGRAM_WEBHOOK_URL);
  const secret = clean(process.env.TELEGRAM_WEBHOOK_SECRET);
  if (!process.env.TELEGRAM_BOT_TOKEN || !url || !secret) return false;
  if (telegramWebhookRegistering) return false;
  telegramWebhookRegistering = true;
  try {
    await telegram('setWebhook', {
      url,
      secret_token: secret,
      allowed_updates: ['message', 'channel_post'],
      drop_pending_updates: false,
    });
    telegramWebhookReady = true;
    console.info('[telegram-intake] webhook registered');
    return true;
  } catch (error) {
    console.error('[telegram-intake] webhook registration failed:', String(error?.message || error).slice(0, 250));
    return false;
  } finally {
    telegramWebhookRegistering = false;
  }
}
