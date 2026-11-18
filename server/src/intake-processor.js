import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { transcribeVideo } from './video-analysis.js';
import { chooseVideoCoverFrame, generateCaptions, videoEvidenceSampleTimes } from './ai.js';
import { uploadMediaFile } from './media-io.js';
import { getBrandById, resolveBrand } from './brand-memory/index.js';
import { canUsePrivateBrandData } from './brand-access.js';
import { getAssignedInstagramTags } from './brand-routing.js';

const execFileAsync = promisify(execFile);
const MAX_VIDEO_BYTES = 400 * 1024 * 1024;
const PLATFORMS = new Set(['youtube', 'instagram', 'facebook', 'x']);
const clean = (value) => String(value || '').trim();
const normalize = (value) => clean(value).toLowerCase().replace(/^@/, '').replace(/[^\p{L}\p{N}]+/gu, '');

async function sampleFrames(videoPath, directory) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', videoPath,
  ], { timeout: 60_000, maxBuffer: 1024 * 1024 });
  const duration = Number(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('The video duration could not be read. Send an MP4, MOV, or WebM video.');
  const frames = [];
  const sampleTimes = videoEvidenceSampleTimes(duration, 5);
  for (const [index, seconds] of sampleTimes.entries()) {
    const output = path.join(directory, `frame-${index}.jpg`);
    await execFileAsync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y', '-ss', String(seconds), '-i', videoPath,
      '-frames:v', '1', '-vf', 'scale=1024:1024:force_original_aspect_ratio=decrease', '-q:v', '4', output,
    ], { timeout: 90_000, maxBuffer: 2 * 1024 * 1024 });
    const stat = await fs.stat(output).catch(() => null);
    if (stat?.size) frames.push({ path: output, name: `frame-${index}.jpg`, mimetype: 'image/jpeg', base64: (await fs.readFile(output)).toString('base64'), detail: 'low' });
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

export async function saveBrandReview(supabase, table, job, reason, result) {
  const reviewUpdate = await supabase.from(table).update({
    status: 'review', error: reason, result, updated_at: new Date().toISOString(),
  }).eq('id', job.id).eq('status', 'processing').select('id').maybeSingle();
  if (!reviewUpdate.error && reviewUpdate.data) return 'review';

  // Older deployments may not yet have migration 015's `review` status.
  // Preserve the full review payload under the already-supported `failed`
  // status so the inbox remains usable while the migration is pending.
  if (reviewUpdate.error) {
    console.warn('[intake] review status update failed; saving review payload as failed:', String(reviewUpdate.error.message || reviewUpdate.error).slice(0, 220));
  }
  const fallbackUpdate = await supabase.from(table).update({
    status: 'failed',
    error: `${reason} Review details were saved; apply migration 015 to enable the dedicated review status.`,
    result,
    updated_at: new Date().toISOString(),
  }).eq('id', job.id).eq('status', 'processing').select('id').maybeSingle();
  if (fallbackUpdate.error || !fallbackUpdate.data) {
    throw new Error(`Brand verification stopped this post, but Driftpost could not save the review details${fallbackUpdate.error?.message ? `: ${String(fallbackUpdate.error.message).slice(0, 180)}` : '.'}`);
  }
  return 'failed';
}

export async function processIntakeJob(supabase, job, options = {}) {
  const ownerId = job.owner_user_id;
  const table = options.table || 'google_drive_video_jobs';
  const intakeKey = options.intakeKey || 'google_drive_intake_job_id';
  const notify = options.notify || ((message) => reply(job.chat_id, message, job.message_id));
  const progress = async (stage, detail = '') => { if (options.progress) await options.progress(stage, detail); };
  const isCarousel = job.result?.media_kind === 'carousel';
  const needsBrandInference = job.result?.brand_resolution_required === true;
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
    if (updateError) console.error('[intake] could not reconcile queued publish rows:', updateError.message);
    await notify(`This media is already queued for ${alreadyQueued.length} destination${alreadyQueued.length === 1 ? '' : 's'}. I will send the result when publishing finishes.`);
    return;
  }
  const { data: authResult, error: authError } = await supabase.auth.admin.getUserById(ownerId);
  if (authError || !canUsePrivateBrandData(authResult?.user)) throw new Error('The configured publishing account is not approved for the private video workflow.');
  const accountName = clean(job.account_name);
  if (accountName.length < 2 && !needsBrandInference) throw new Error('Add the destination in the video caption, for example: Account: Famebros Studio.');
  const directConnectionIds = Array.isArray(job.result?.destination_connection_ids) ? job.result.destination_connection_ids : [];
  const { data: rawConnections, error: connectionError } = await supabase.from('platform_connections')
    .select('id, user_id, platform, platform_account_id, account_name, encrypted_tokens')
    .eq('user_id', ownerId);
  if (connectionError) throw new Error('Could not read the configured Driftpost publishing accounts.');
  const requestedPlatforms = Array.isArray(job.platforms) ? job.platforms : [];
  const configuredTargets = Array.isArray(job.result?.target_brands) && job.result.target_brands.length ? job.result.target_brands : null;
  let targetGroups = [];
  if (needsBrandInference) {
    // The filename/account route is unresolved; do not guess a publishing
    // destination. Continue only far enough to inspect the video and infer
    // catalogue candidates for the review inbox.
    targetGroups = [];
  } else if (configuredTargets) {
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
    if (routing.unresolved?.length) throw new Error(`Account mapping is ambiguous: ${routing.unresolved.join('; ')}. Correct the destination name and upload again.`);
    targetGroups = [{ brand: brandHit.brand?.id ? brandHit.brand : { id: null, name: brandHit.brand?.name || accountName }, name: brandHit.brand?.name || accountName, destinations: routing.destinations || [] }];
  }
  const destinations = [...new Map(targetGroups.flatMap((target) => target.destinations).map((item) => [item.id, item])).values()];
  for (const destination of destinations) {
    const owners = new Set(targetGroups.filter((target) => target.destinations.some((item) => item.id === destination.id)).map((target) => target.brand?.id || `generic:${target.name}`));
    if (owners.size > 1) throw new Error(`The connected account "${destination.account_name}" maps to more than one requested brand. Send separate files for those brands so captions cannot mix their data.`);
  }
  if (!destinations.length && !needsBrandInference) throw new Error(`“${accountName}” does not exactly match a connected account. Send the connected account name or handle.`);

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'driftpost-intake-'));
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
      const byteSize = options.download ? await options.download(job, videoPath) : (() => { throw new Error('Direct download handler is required.'); })();
      mediaFiles = [{ path: videoPath, name: path.basename(videoPath), mimetype: job.mime_type || 'video/mp4', size: byteSize }];
      await progress('analyzing', 'Extracting video frames');
      // Start speech transcription while FFmpeg samples frames. These are
      // independent operations on the same downloaded video.
      transcriptWork = transcribeVideo(videoPath, path.basename(videoPath), job.mime_type || 'video/mp4')
        .then((result) => ({ text: result.text || '', warning: '' }))
        .catch((error) => {
          console.warn('[intake] transcription unavailable:', String(error?.message || error).slice(0, 220));
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
    if (needsBrandInference) {
      let suggestedBrands = [];
      try { suggestedBrands = await options.suggestBrands?.(frames, transcript, []) || []; }
      catch (error) { console.warn('[intake] filename-mismatch brand inference failed:', String(error?.message || error).slice(0, 220)); }
      const requestedNames = Array.isArray(job.result?.requested_brand_names) ? job.result.requested_brand_names : [];
      const reason = requestedNames.length
        ? `The filename destination “${requestedNames.join(', ')}” did not safely map to a connected brand/account. AI compared video evidence against the saved brand catalogue; verify the suggested brand and destination before sending.`
        : 'The filename did not contain a usable brand/account name. AI compared video evidence against the saved brand catalogue; select the correct brand and destination before sending.';
      await saveBrandReview(supabase, table, job, reason, {
        ...(job.result || {}),
        brand_reviews: [{ brand_id: '', brand_name: requestedNames.join(', ') || 'Unmapped filename', verdict: 'uncertain', confidence: 0, reason }],
        suggested_brands: suggestedBrands,
        transcript: !!transcript,
        speechWarning,
      });
      await notify(`⛔ Not posted: the video filename did not safely match a connected brand. ${suggestedBrands.length ? `AI suggested: ${suggestedBrands.map((item) => item.name).join(', ')}. ` : ''}Open Video review to choose the correct brand and accounts.`);
      return { stopped: true, reason, suggestedBrands };
    }
    const supportedDestinations = isCarousel ? destinations.filter((item) => ['instagram', 'facebook', 'x'].includes(item.platform)) : destinations;
    if (isCarousel && !supportedDestinations.length) throw new Error('Photo carousels can publish to Instagram, Facebook, or X. This brand has no connected photo destination.');
    if (isCarousel && destinations.some((item) => item.platform === 'x') && mediaFiles.length > 4) throw new Error('X supports up to 4 photos per post. Reduce this carousel to 4 images or remove X from the selected destinations.');
    const platforms = [...new Set(supportedDestinations.map((item) => item.platform))];
    await progress('preparing', 'Writing platform captions and preparing media');
    const frameImages = frames.map(({ name, mimetype, base64, detail }) => ({ name, mimetype, base64, detail: detail || (isCarousel ? 'high' : 'low') }));
    const brandTargets = targetGroups.filter((target) => target.brand?.id);
    const reviewApproval = job.result?.review_approval?.approved === true ? job.result.review_approval : null;
    const assessments = options.assessBrand && options.verifyBrand !== false && !reviewApproval
      ? await Promise.all(brandTargets.map(async (target) => {
        try { return { target, assessment: await options.assessBrand(target.brand, frames, transcript) }; }
        catch (error) { return { target, assessment: { verdict: 'uncertain', confidence: 0, reason: `Automatic verification could not finish: ${String(error?.message || error).slice(0, 350)}` } }; }
      }))
      : [];
    const failedAssessments = assessments.filter(({ assessment }) => assessment?.verdict !== 'match');
    if (failedAssessments.length) {
      const mismatches = failedAssessments.map(({ target, assessment }) => ({
        brand_id: target.brand.id,
        brand_name: target.brand.name,
        verdict: assessment?.verdict || 'uncertain',
        confidence: Number.isFinite(assessment?.confidence) ? assessment.confidence : 0,
        reason: String(assessment?.reason || 'The AI could not confirm this video belongs to the selected brand.').slice(0, 500),
      }));
      const reason = mismatches.map((item) => `${item.brand_name}: ${item.reason}`).join(' | ').slice(0, 500);
      let suggestedBrands = [];
      try { suggestedBrands = await options.suggestBrands?.(frames, transcript, mismatches.map((item) => item.brand_id)) || []; }
      catch (error) { console.warn('[intake] alternative brand suggestions unavailable:', String(error?.message || error).slice(0, 220)); }
      await saveBrandReview(supabase, table, job, `Automatic brand check stopped this post to prevent publishing to the wrong account. ${reason}`, {
        ...(job.result || {}), brand_reviews: mismatches, suggested_brands: suggestedBrands,
      });
      await notify(`⛔ Not posted: the automatic brand check found a mismatch. ${reason} Correct the filename/account mapping and upload again.`);
      return { stopped: true, assessments: mismatches };
    }
    // Each brand gets captions from its own complete saved profile. Generate
    // those independent caption sets concurrently without mixing brand facts.
    const captionTargets = reviewApproval
      ? targetGroups.map((target) => ({ ...target, captions: reviewApproval.captions || {} }))
      : await Promise.all(targetGroups.map(async (target) => {
      const targetPlatforms = [...new Set(target.destinations.filter((item) => supportedDestinations.some((dest) => dest.id === item.id)).map((item) => item.platform))];
      const customBrief = String(job.result?.brief || '').trim();
      const captionPrompt = customBrief
        ? `Create accurate, platform-specific captions for the ${isCarousel ? 'photo carousel' : 'video'} sent to the ${target.name} account. Follow these specific editor instructions and details:\n${customBrief}`
        : `Create accurate, platform-specific captions for the ${isCarousel ? 'photo carousel' : 'video'} sent to the ${target.name} account. Describe only what is visible or spoken.`;
      const generated = await generateCaptions(
        captionPrompt,
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
    const neededCoverPlatforms = platformsNeedingGeneratedCovers(isCarousel, platforms);
    let preferredFrameIndex = Math.floor(frames.length / 2);
    if (neededCoverPlatforms.length && frameImages.length > 1) {
      try {
        const primaryBrand = targetBrands.find((t) => t.brand?.id)?.brand || null;
        const aiIndex = await chooseVideoCoverFrame(frameImages, {
          brand: primaryBrand,
          brandId: primaryBrand?.id || '',
          brief: transcript,
          transcript,
        });
        if (aiIndex !== null && aiIndex >= 0 && aiIndex < frames.length) preferredFrameIndex = aiIndex;
      } catch {}
    }
    const defaultCoverFrame = frames[preferredFrameIndex];
    for (const platform of neededCoverPlatforms) {
      if (!defaultCoverFrame) throw new Error(`Could not extract a cover frame for ${platform}.`);
      let coverError;
      for (const frame of [...frames].sort((a, b) => Math.abs(frames.indexOf(a) - preferredFrameIndex) - Math.abs(frames.indexOf(b) - preferredFrameIndex))) {
        try { covers[platform] = await makePlatformCover(frame.path, platform, directory); break; }
        catch (error) { coverError = error; }
      }
      if (!covers[platform]) throw new Error(`Could not prepare a ${platform} cover from any extracted frame. ${String(coverError?.message || '').slice(0, 160)} Re-export the video as MP4 and upload again.`);
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
        if (captionTarget?.brand?.id) body.brand_id = String(captionTarget.brand.id);
        if (captionTarget?.name || captionTarget?.brand?.name) body.brand_name = String(captionTarget?.name || captionTarget?.brand?.name);
        const assignedTags = getAssignedInstagramTags({
          brandId: captionTarget?.brand?.id || job.result?.brand_id,
          brandName: captionTarget?.name || captionTarget?.brand?.name || job.account_name,
          accountName: connection.account_name,
          accounts: [connection],
        });
        const overrideTags = Array.isArray(job.result?.review_approval?.instagram_tags)
          ? job.result.review_approval.instagram_tags
          : Array.isArray(captionTarget?.instagram_tags)
            ? captionTarget.instagram_tags
            : Array.isArray(job.result?.instagram_tags)
              ? job.result.instagram_tags
              : [];
        const igTags = [...new Set((overrideTags.length ? overrideTags : assignedTags).map((h) => String(h || '').trim().replace(/^@+/, '')).filter(Boolean))].slice(0, 3);
        if (igTags.length) {
          body.ig_collabs_enabled = '1';
          body.ig_collabs = igTags.join(',');
          body.ig_user_tags = igTags.join(',');
        }
        // Always cross-post automated workflow items to Instagram Story (for carousels, index.js publishes the first image).
        body.ig_post_story = '1';
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
    const { data: currentStatusRow } = await supabase.from(table).select('status').eq('id', job.id).maybeSingle();
    if (currentStatusRow?.status === 'stopped') {
      await supabase.storage.from(process.env.MEDIA_BUCKET || 'driftpost-media').remove(storedPaths).catch(() => {});
      return { stopped: true, reason: 'Stopped by user.' };
    }
    const { data: existingScheduled } = await supabase
      .from('scheduled_posts')
      .select('id, platform')
      .eq('user_id', ownerId)
      .filter(`body->>${intakeKey}`, 'eq', String(job.id));
    let scheduled = Array.isArray(existingScheduled) && existingScheduled.length ? existingScheduled : null;
    if (scheduled) {
      await supabase.storage.from(process.env.MEDIA_BUCKET || 'driftpost-media').remove(storedPaths).catch(() => {});
    } else {
      const { data: insertedScheduled, error: scheduleError } = await supabase.from('scheduled_posts').insert(rows).select('id, platform');
      if (scheduleError || !insertedScheduled || insertedScheduled.length !== rows.length) throw new Error('The video was prepared, but Driftpost could not add every destination to its publishing queue.');
      scheduled = insertedScheduled;
    }
    const { error: intakeUpdateError } = await supabase.from(table).update({
      status: 'publishing',
      result: { ...(job.result || {}), brand: targetGroups.map((target) => target.name).join(', '), brands: targetGroups.map((target) => ({ id: target.brand?.id || null, name: target.name })), destinations: scheduled, transcript: !!transcript, speechWarning, media_kind: isCarousel ? 'carousel' : 'video', progress: { stage: 'publishing', detail: `Queued to ${scheduled.length} destination${scheduled.length === 1 ? '' : 's'}`, updated_at: new Date().toISOString() } },
      updated_at: new Date().toISOString(),
    }).eq('id', job.id);
    if (intakeUpdateError) console.error('[intake] queued posts but could not update intake status:', intakeUpdateError.message);
    await notify(`✅ ${isCarousel ? `${mediaFiles.length}-image carousel` : 'Video'} processed for ${targetGroups.map((target) => target.name).join(', ')}. Queued ${scheduled.length} destination${scheduled.length === 1 ? '' : 's'} for automatic publishing.${speechWarning ? `\n\nNote: ${speechWarning}` : ''}`);
  } catch (error) {
    await supabase.storage.from(process.env.MEDIA_BUCKET || 'driftpost-media').remove(storedPaths).catch(() => {});
    throw error;
  } finally {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

export function platformsNeedingGeneratedCovers(isCarousel, platforms) {
  if (isCarousel) return [];
  return [...new Set(platforms)].filter((platform) => ['youtube', 'instagram', 'facebook'].includes(platform));
}
