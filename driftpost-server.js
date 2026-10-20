#!/usr/bin/env node
"use strict";

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const API = String(process.env.DRIFTPOST_API_URL || "https://driftpost-production.up.railway.app").replace(/\/$/, "");
const SESSION_FILE = process.env.DRIFTPOST_SESSION_FILE
  || path.join(os.homedir(), ".config", "opencode", "secrets", "driftpost-session.json");
const MAX_VIDEO_BYTES = 400 * 1024 * 1024;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_WAIT_SECONDS = 300;
const APPROVAL_PHRASE = "PUBLISH THIS VIDEO";
const previews = new Map();
let sessionCache = null;
let aiGrant = "";

const server = new McpServer({ name: "driftpost", version: "1.0.0" });
const addTool = (name, description, inputSchema, handler) => {
  if (typeof server.registerTool === "function") {
    server.registerTool(name, { description, inputSchema }, handler);
  } else {
    server.tool(name, description, inputSchema, handler);
  }
};

function result(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function fail(message) {
  return { isError: true, content: [{ type: "text", text: String(message) }] };
}

function authSetupMessage() {
  return `Driftpost MCP is not authenticated. Create ${SESSION_FILE} containing {"refresh_token":"<your Supabase refresh token>"}; keep it outside Git and do not paste it into chat. Set DRIFTPOST_SUPABASE_URL and DRIFTPOST_SUPABASE_PUBLISHABLE_KEY in your OS environment, then restart OpenCode.`;
}

async function readSession() {
  if (sessionCache?.accessToken && sessionCache.expiresAt > Date.now() + 60_000) return sessionCache;

  const accessToken = String(process.env.DRIFTPOST_ACCESS_TOKEN || "").trim();
  const refreshFromEnv = String(process.env.DRIFTPOST_REFRESH_TOKEN || "").trim();
  let saved = {};
  if (!accessToken || refreshFromEnv) {
    try { saved = JSON.parse(await fs.readFile(SESSION_FILE, "utf8")); } catch {}
  }
  const refreshToken = refreshFromEnv || String(saved.refresh_token || "").trim();
  if (accessToken && !refreshToken) {
    sessionCache = { accessToken, refreshToken: "", expiresAt: Number.MAX_SAFE_INTEGER };
    return sessionCache;
  }
  if (!refreshToken) throw new Error(authSetupMessage());

  const supabaseUrl = String(process.env.DRIFTPOST_SUPABASE_URL || "").replace(/\/$/, "");
  const publishableKey = String(process.env.DRIFTPOST_SUPABASE_PUBLISHABLE_KEY || "").trim();
  if (!supabaseUrl || !publishableKey) {
    throw new Error("Set DRIFTPOST_SUPABASE_URL and DRIFTPOST_SUPABASE_PUBLISHABLE_KEY; the MCP uses them only to refresh your own Driftpost session.");
  }

  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: publishableKey },
    body: JSON.stringify({ refresh_token: refreshToken }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    sessionCache = null;
    throw new Error("Driftpost session refresh failed. Sign in to Driftpost again, replace the refresh_token in the local session file, then restart OpenCode.");
  }

  sessionCache = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt: Date.now() + Math.max(60, Number(data.expires_in || 3600)) * 1000,
  };
  // Supabase rotates refresh tokens. Persist the latest token with owner-only
  // permissions so repeated MCP use does not invalidate the original token.
  await persistSession(sessionCache.refreshToken);
  return sessionCache;
}

async function persistSession(refreshToken) {
  if (process.env.DRIFTPOST_REFRESH_TOKEN) return;
  const dir = path.dirname(SESSION_FILE);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = `${SESSION_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify({ refresh_token: refreshToken }, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(tmp, SESSION_FILE);
  await fs.chmod(SESSION_FILE, 0o600).catch(() => {});
}

async function request(route, { method = "GET", body, headers = {}, timeout = 30_000, retry401 = true } = {}) {
  const session = await readSession();
  const response = await fetch(`${API}${route}`, {
    method,
    headers: { Authorization: `Bearer ${session.accessToken}`, ...headers },
    ...(body ? { body } : {}),
    signal: AbortSignal.timeout(timeout),
  });
  if (response.status === 401 && retry401 && session.refreshToken) {
    sessionCache = null;
    await readSession();
    return request(route, { method, body, headers, timeout, retry401: false });
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Driftpost API returned HTTP ${response.status}`);
  return data;
}

async function requestAI(route, options = {}) {
  const extraHeaders = {};
  const passphrase = String(process.env.DRIFTPOST_AI_UNLOCK_PASSPHRASE || "");
  if (passphrase) {
    if (!aiGrant) {
      try {
        const unlocked = await request("/api/ai/unlock", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ password: passphrase }),
        });
        aiGrant = String(unlocked.grant || "");
      } catch (error) {
        if (!/AI access is unavailable for this account/i.test(String(error.message))) throw error;
      }
    }
    if (aiGrant) extraHeaders["X-Driftpost-AI-Grant"] = aiGrant;
  }
  return request(route, { ...options, headers: { ...extraHeaders, ...(options.headers || {}) } });
}

function mimeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ({
    ".mp4": "video/mp4", ".mov": "video/quicktime", ".m4v": "video/x-m4v",
    ".webm": "video/webm", ".mkv": "video/x-matroska", ".avi": "video/x-msvideo",
    ".mpeg": "video/mpeg", ".mpg": "video/mpeg", ".ogv": "video/ogg",
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
    ".webp": "image/webp", ".avif": "image/avif", ".heic": "image/heic", ".heif": "image/heif",
  })[ext] || "application/octet-stream";
}

async function attachLocalFile(form, field, filePath, capBytes) {
  const resolved = path.resolve(String(filePath || ""));
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat?.isFile()) throw new Error(`File does not exist: ${resolved}`);
  if (!stat.size || stat.size > capBytes) throw new Error(`File must be between 1 byte and ${Math.round(capBytes / 1024 / 1024)} MB.`);
  const mime = mimeFor(resolved);
  if (!mime.startsWith("image/") && !mime.startsWith("video/")) throw new Error("File extension must identify an image or video supported by Driftpost.");
  const blob = await require("node:fs").openAsBlob(resolved, { type: mime });
  form.append(field, blob, path.basename(resolved));
  return { path: resolved, name: path.basename(resolved), mime, size: stat.size };
}

const platformSchema = z.enum(["youtube", "instagram", "facebook", "x"]);

addTool("health", "Check the live Driftpost API health and revision. Does not require a user token.", {}, async () => {
  try {
    const response = await fetch(`${API}/health`, { signal: AbortSignal.timeout(10_000) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return fail(`Driftpost health returned HTTP ${response.status}`);
    return result(data);
  } catch (error) { return fail(error.message || "Could not reach Driftpost."); }
});

addTool("list_accounts", "List the current Driftpost user's connected social accounts. Use the returned exact connection id when preparing a post.", {}, async () => {
  try {
    const data = await request("/api/connections");
    return result((data.connections || []).map(({ id, platform, account_name, platform_account_id }) => ({ id, platform, account_name, platform_account_id })));
  } catch (error) { return fail(error.message); }
});

addTool("generate_captions", "Generate review-only platform captions through Driftpost AI. Never publishes. Requires the user's explicit brief; optionally attach one local video or up to 9 local photos.", {
  summary: z.string().min(3).max(1200),
  brand: z.string().max(160).optional(),
  brand_id: z.string().max(160).optional(),
  asset_description: z.string().max(200).optional(),
  goal: z.string().max(40).optional(),
  tone: z.enum(["auto", "excited", "warm", "professional", "funny", "luxury", "emotional", "creative", "minimal"]).optional(),
  emoji: z.enum(["low", "medium", "high", "max"]).optional(),
  length: z.enum(["short", "medium", "detailed"]).optional(),
  video_path: z.string().optional(),
  image_paths: z.array(z.string()).max(9).optional(),
}, async (input) => {
  try {
    const form = new FormData();
    for (const key of ["summary", "brand", "brand_id", "asset_description", "goal", "tone", "emoji", "length"]) {
      if (input[key]) form.append(key, input[key]);
    }
    if (input.video_path) await attachLocalFile(form, "video", input.video_path, MAX_VIDEO_BYTES);
    for (const imagePath of input.image_paths || []) await attachLocalFile(form, "images", imagePath, MAX_IMAGE_BYTES);
    const data = await requestAI("/api/ai/captions", { method: "POST", body: form, timeout: 180_000 });
    return result(data);
  } catch (error) { return fail(error.message); }
});

addTool("prepare_video_post", "Prepare a local video post preview without uploading or publishing. User must inspect the preview and approve before using publish_confirmed_video.", {
  platform: platformSchema,
  connection_id: z.string().min(1),
  video_path: z.string().min(1),
  caption: z.string().min(1).max(2200),
  youtube_title: z.string().max(100).optional(),
  scheduled_at: z.string().optional(),
}, async (input) => {
  try {
    const accounts = await request("/api/connections");
    const account = (accounts.connections || []).find((item) => item.id === input.connection_id && item.platform === input.platform);
    if (!account) throw new Error("Connection ID does not belong to the selected platform. Run list_accounts and choose an exact match.");
    if (input.platform === "youtube" && !String(input.youtube_title || "").trim()) throw new Error("YouTube posts need a title, up to 100 characters.");
    if (input.platform === "x" && Array.from(input.caption).length > 280) throw new Error("X captions must be 280 characters or fewer.");
    if (input.platform === "instagram" && input.caption.length > 2200) throw new Error("Instagram captions must be 2,200 characters or fewer.");
    if (input.scheduled_at && (!Number.isFinite(Date.parse(input.scheduled_at)) || Date.parse(input.scheduled_at) < Date.now() + 60_000)) throw new Error("Schedule time must be at least one minute in the future.");
    const resolved = path.resolve(input.video_path);
    const stat = await fs.stat(resolved).catch(() => null);
    if (!stat?.isFile() || !stat.size || stat.size > MAX_VIDEO_BYTES) throw new Error("Video must exist and be no larger than 400 MB.");
    const mime = mimeFor(resolved);
    if (!mime.startsWith("video/")) throw new Error("This MCP tool accepts video files only.");
    const previewId = crypto.randomBytes(24).toString("base64url");
    const preview = {
      id: previewId, userId: "", platform: input.platform, connectionId: input.connection_id,
      account: account.account_name, videoPath: resolved, videoName: path.basename(resolved),
      mime, bytes: stat.size, modified_at: stat.mtimeMs, caption: input.caption,
      title: String(input.youtube_title || "").slice(0, 100), scheduledAt: input.scheduled_at || "",
      expiresAt: Date.now() + 10 * 60_000,
    };
    previews.set(previewId, preview);
    for (const [id, item] of previews) if (item.expiresAt <= Date.now()) previews.delete(id);
    return result({ preview_id: previewId, expires_in_minutes: 10, action: preview.scheduledAt ? "schedule" : "publish_now", platform: preview.platform, account: preview.account, video: { name: preview.videoName, mime, size_mb: +(stat.size / 1024 / 1024).toFixed(2) }, caption: preview.caption, youtube_title: preview.title || undefined, scheduled_at: preview.scheduledAt || undefined, next_step: `Show this preview. After explicit user approval, call publish_confirmed_video with preview_id and approval_phrase exactly: ${APPROVAL_PHRASE}` });
  } catch (error) { return fail(error.message); }
});

addTool("publish_confirmed_video", `Uploads and publishes/schedules a prepared video. Requires explicit user approval; approval_phrase must exactly equal "${APPROVAL_PHRASE}".`, {
  preview_id: z.string().min(1),
  approval_phrase: z.string(),
}, async ({ preview_id, approval_phrase }) => {
  try {
    if (approval_phrase !== APPROVAL_PHRASE) throw new Error(`Not published. First show the preview and obtain user approval; then pass approval_phrase exactly: ${APPROVAL_PHRASE}`);
    const preview = previews.get(preview_id);
    if (!preview || preview.expiresAt <= Date.now()) throw new Error("Preview is missing or expired. Prepare the post again.");
    const currentStat = await fs.stat(preview.videoPath).catch(() => null);
    if (!currentStat?.isFile() || currentStat.size !== preview.bytes || currentStat.mtimeMs !== preview.modified_at) {
      throw new Error("The video changed after preview. Prepare a fresh preview so the user can review the exact file being uploaded.");
    }
    const form = new FormData();
    form.append("platform", preview.platform);
    form.append("connection_id", preview.connectionId);
    if (preview.platform === "youtube") {
      form.append("yt_title", preview.title);
      form.append("yt_description", preview.caption);
      form.append("yt_privacy", "public");
    } else if (preview.platform === "instagram") form.append("ig_caption", preview.caption);
    else if (preview.platform === "facebook") form.append("fb_message", preview.caption);
    else form.append("x_text", preview.caption);
    await attachLocalFile(form, "media", preview.videoPath, MAX_VIDEO_BYTES);
    const route = preview.scheduledAt ? "/api/schedule" : "/api/publish";
    if (preview.scheduledAt) form.append("scheduled_at", preview.scheduledAt);
    const data = await request(route, { method: "POST", body: form, timeout: 15 * 60_000 });
    previews.delete(preview_id);
    return result(preview.scheduledAt
      ? { scheduled: data.schedule, status: "scheduled", platform: preview.platform, account: preview.account }
      : { job: data.job, status: "queued", platform: preview.platform, account: preview.account, next_step: "Call wait_for_publish with this job_id to get the final platform result." });
  } catch (error) { return fail(error.message); }
});

addTool("wait_for_publish", "Wait for a queued Driftpost publish job to finish. Returns published URLs or the final failure reason.", {
  job_id: z.string().min(1),
  max_wait_seconds: z.number().int().min(1).max(MAX_WAIT_SECONDS).optional(),
}, async ({ job_id, max_wait_seconds = 180 }) => {
  try {
    const deadline = Date.now() + max_wait_seconds * 1000;
    let job;
    while (Date.now() < deadline) {
      const data = await request(`/api/jobs/${encodeURIComponent(job_id)}`);
      job = data.job;
      if (["completed", "failed"].includes(job?.state)) return result({ job });
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
    return result({ job, timed_out: true, message: "Still processing; call wait_for_publish again with the same job_id." });
  } catch (error) { return fail(error.message); }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  process.stderr.write(`driftpost MCP failed to start: ${error.stack || error}\n`);
  process.exitCode = 1;
});
