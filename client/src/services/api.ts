import type {
  OptimizationReport,
  JobConfig,
  JobProgress,
  HardwareInfo,
  SeoReport,
  SeoAnalyzeScope,
  SitemapReport,
} from '../types';
import { analyzeVideoFileInBrowser } from './videoAnalysis';

export interface AnalysisResponse {
  report: OptimizationReport;
  tempPath: string;
  originalName: string;
  sizeBytes: number;
}

export async function fetchHardwareInfo(): Promise<HardwareInfo> {
  const res = await fetch('/api/system/hardware');
  if (!res.ok) throw new Error('Failed to fetch hardware status');
  return res.json();
}

/**
 * Analyze a selected file locally with MediaInfo.js. No bytes are uploaded:
 * MediaInfo reads the File through chunked slices in the browser.
 *
 * `tempPath` is intentionally empty — the source is uploaded only if/when the
 * user starts an optimization job (see `createOptimizationJob`).
 */
export async function analyzeVideoFile(
  file: File,
  onProgress?: (percent: number) => void
): Promise<AnalysisResponse> {
  const report = await analyzeVideoFileInBrowser(file, onProgress);
  return {
    report,
    tempPath: '',
    originalName: file.name,
    sizeBytes: file.size,
  };
}

export async function generateDemoVideo(): Promise<AnalysisResponse> {
  const res = await fetch('/api/video/demo', { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to generate demo clip');
  }
  return res.json();
}

/** Vercel rejects request bodies over 4.5 MB, so larger files go up in chunks. */
const DIRECT_UPLOAD_LIMIT_BYTES = 4 * 1024 * 1024;
const UPLOAD_CHUNK_SIZE = 3 * 1024 * 1024;
const MAX_CHUNK_ATTEMPTS = 3;

interface ChunkedUploadResult {
  tempPath: string;
  originalName: string;
  sizeBytes: number;
}

/** Error from starting a job, keeping the server's error code / technical detail. */
export class JobStartError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly technicalError?: string;

  constructor(
    message: string,
    options: { status: number; code?: string; technicalError?: string }
  ) {
    super(message);
    this.name = 'JobStartError';
    this.status = options.status;
    this.code = options.code;
    this.technicalError = options.technicalError;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * POST one upload chunk, retrying transient failures (network drop, 429,
 * 5xx). A Vercel container can cold-start or restart between chunks, so a
 * single failed request must not abandon a multi-minute upload.
 */
async function postUploadChunk(
  formData: FormData,
  chunkIndex: number,
  totalChunks: number
): Promise<ChunkedUploadResult & { completed: boolean }> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_CHUNK_ATTEMPTS; attempt++) {
    try {
      const res = await fetch('/api/media/upload-chunk', { method: 'POST', body: formData });
      if (res.ok) return res.json();

      const body = await readErrorBody(res);
      const message =
        (typeof body.error === 'string' && body.error) ||
        `Upload failed on chunk ${chunkIndex + 1}/${totalChunks} (HTTP ${res.status})`;

      // Fail immediately if the backend is unreachable or chunks are missing
      if (body.code === 'BACKEND_UNREACHABLE' || body.code === 'CHUNK_MISSING') {
        throw new JobStartError(message, { status: res.status, code: body.code });
      }

      // Retry only errors that may be temporary. A 400/413/415 will fail the
      // same way again and should be shown to the user immediately.
      if (res.status < 500 && res.status !== 429) {
        throw new JobStartError(message, { status: res.status, code: body.code });
      }
      lastError = new Error(message);
    } catch (err: any) {
      if (err instanceof JobStartError) throw err;

      // fetch() rejects with TypeError on network failures / CORS / aborted
      // connections. Those are worth retrying.
      lastError = new Error(
        `Could not reach the processing server while uploading chunk ${
          chunkIndex + 1
        }/${totalChunks}. ${err?.message || ''}`.trim()
      );
    }

    if (attempt < MAX_CHUNK_ATTEMPTS) {
      await sleep(1000 * attempt);
    }
  }

  throw lastError ?? new Error('Chunk upload failed.');
}

/**
 * Upload a local file to the server in small chunks and return its assembled
 * temp path. Used only when the user starts processing — never for analysis.
 */
async function uploadFileInChunks(
  file: File,
  onProgress?: (percent: number) => void
): Promise<ChunkedUploadResult> {
  if (file.size <= 0) throw new Error('Cannot upload an empty video file.');

  const totalChunks = Math.ceil(file.size / UPLOAD_CHUNK_SIZE);
  const fileId = `${Date.now()}_${Math.random().toString(36).slice(2)}_${file.name.replace(/[^a-zA-Z0-9]/g, '')}`;

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
    const start = chunkIndex * UPLOAD_CHUNK_SIZE;
    const end = Math.min(file.size, start + UPLOAD_CHUNK_SIZE);
    const chunk = file.slice(start, end);

    const formData = new FormData();
    formData.append('chunk', chunk);
    formData.append('fileId', fileId);
    formData.append('chunkIndex', chunkIndex.toString());
    formData.append('totalChunks', totalChunks.toString());
    formData.append('fileName', file.name);

    const data = await postUploadChunk(formData, chunkIndex, totalChunks);
    onProgress?.(Math.round(((chunkIndex + 1) / totalChunks) * 100));

    if (data.completed) {
      return data;
    }
  }

  throw new Error('Chunked upload did not complete cleanly.');
}

async function requestOptimizationJob(formData: FormData): Promise<{ jobId: string }> {
  const res = await fetch('/api/jobs', {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const body = await readErrorBody(res);
    throw new JobStartError(
      (typeof body.error === 'string' && body.error) ||
        `Failed to start optimization job (HTTP ${res.status})`,
      {
        status: res.status,
        code: typeof body.code === 'string' ? body.code : undefined,
        technicalError:
          typeof body.technicalError === 'string' ? body.technicalError : undefined,
      }
    );
  }

  return res.json();
}

export async function createOptimizationJob(params: {
  file?: File | null;
  tempPath?: string | null;
  originalName: string;
  config: Partial<JobConfig>;
  /** 0–100 while a large source file is uploaded to the server. */
  onUploadProgress?: (percent: number) => void;
}): Promise<{ jobId: string }> {
  const originalFile = params.file ?? null;
  let fileToUpload = originalFile;
  let tempPath = params.tempPath ?? null;

  const buildFormData = () => {
    const formData = new FormData();
    if (fileToUpload) {
      formData.append('video', fileToUpload);
    }
    if (tempPath) {
      formData.append('tempPath', tempPath);
    }
    formData.append('originalName', params.originalName);
    formData.append('config', JSON.stringify(params.config));
    return formData;
  };

  const uploadAndStart = async (isRetry = false): Promise<{ jobId: string }> => {
    // The source is no longer uploaded during analysis. If the user picked a
    // file and it is too large for one request, assemble it server-side first.
    if (fileToUpload && fileToUpload.size > DIRECT_UPLOAD_LIMIT_BYTES) {
      try {
        const uploaded = await uploadFileInChunks(fileToUpload, params.onUploadProgress);
        tempPath = uploaded.tempPath;
        fileToUpload = null;
      } catch (uploadErr) {
        if (
          !isRetry &&
          uploadErr instanceof JobStartError &&
          uploadErr.code === 'CHUNK_MISSING' &&
          !!originalFile
        ) {
          fileToUpload = originalFile;
          tempPath = null;
          return uploadAndStart(true);
        }
        throw uploadErr;
      }
    }

    try {
      return await requestOptimizationJob(buildFormData());
    } catch (err) {
      // Vercel/Render containers are ephemeral and may serve chunk upload and
      // job creation from different instances. Re-upload once if missing or expired.
      const canRetry =
        !isRetry &&
        err instanceof JobStartError &&
        (err.code === 'UPLOAD_EXPIRED' || err.code === 'CHUNK_MISSING') &&
        !!originalFile &&
        originalFile.size > DIRECT_UPLOAD_LIMIT_BYTES;

      if (!canRetry) throw err;

      fileToUpload = originalFile;
      tempPath = null;
      return uploadAndStart(true);
    }
  };

  return uploadAndStart(false);
}

export async function cancelJob(jobId: string): Promise<boolean> {
  const res = await fetch(`/api/jobs/${jobId}/cancel`, { method: 'POST' });
  if (!res.ok) return false;
  const data = await res.json();
  return Boolean(data.success);
}

/** Error from a job status request, keeping the HTTP status so the UI can tell
 *  "server restarting" (502/503) from "job no longer exists" (404). */
export class JobApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'JobApiError';
    this.status = status;
  }
}

/** Fetches an optimization job's current progress. Throws on 404 (job lost). */
export async function getOptimizationJob(jobId: string): Promise<{ id: string; progress: JobProgress }> {
  const res = await fetch(`/api/jobs/${jobId}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new JobApiError(err.error || `Job lookup failed: ${res.status}`, res.status);
  }
  return res.json();
}

export function subscribeJobProgress(
  jobId: string,
  onProgress: (progress: JobProgress) => void,
  onError: (err: any) => void
): () => void {
  const eventSource = new EventSource(`/api/jobs/${jobId}/events`);

  eventSource.onmessage = (e) => {
    try {
      const data: JobProgress = JSON.parse(e.data);
      onProgress(data);
    } catch (err) {
      console.error('Error parsing SSE data:', err);
    }
  };

  eventSource.onerror = (e) => {
    onError(e);
  };

  return () => {
    eventSource.close();
  };
}

// ============================================================================
// MEDIA TOOLKIT API CLIENT
// ============================================================================

/**
 * Error thrown by the media endpoints that keeps the server's status and
 * machine-readable code so callers can react to specific conditions (notably
 * `rate_limited`) instead of showing a raw message.
 */
export class MediaApiError extends Error {
  readonly status: number;
  readonly code?: string;
  /** Seconds to wait before retrying (server `Retry-After` / `retry_after`). */
  readonly retryAfter?: number;

  constructor(message: string, options: { status: number; code?: string; retryAfter?: number }) {
    super(message);
    this.name = 'MediaApiError';
    this.status = options.status;
    this.code = options.code;
    this.retryAfter = options.retryAfter;
  }

  /** True when the platform rate-limited this server's IP. */
  get isRateLimited(): boolean {
    return this.status === 429 || this.code === 'rate_limited';
  }
}

/** Reads a JSON error body, tolerating non-JSON responses and preserving proxy/backend errors. */
async function readErrorBody(res: Response): Promise<Record<string, any>> {
  try {
    const text = await res.text();
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // Non-JSON response (e.g. Vite proxy ECONNREFUSED or gateway 502/504)
      if (text.includes('ECONNREFUSED') || text.includes('http proxy error')) {
        return {
          error:
            'Backend server is not running on port 3001. Please ensure the backend is started (e.g. npm run dev).',
          code: 'BACKEND_UNREACHABLE',
        };
      }
      if (text.trim()) {
        return { error: text.slice(0, 300) };
      }
    }
  } catch {
    // Network or streaming read error
  }
  return {};
}

/** Number of seconds to wait, taken from the body (`retry_after`/`retryAfterSec`) or the header. */
function retryAfterFrom(res: Response, body: Record<string, any>): number | undefined {
  const fromBody = Number(body.retry_after ?? body.retryAfterSec);
  if (Number.isFinite(fromBody) && fromBody > 0) return fromBody;
  const header = Number(res.headers.get('Retry-After'));
  return Number.isFinite(header) && header > 0 ? header : undefined;
}

/**
 * Builds the error for a failed media request. `rate_limited` keeps that code
 * (and its countdown) so the UI can render the wait state rather than failing.
 */
function mediaRequestError(res: Response, body: Record<string, any>, fallback: string): MediaApiError {
  if (body.error === 'rate_limited') {
    return new MediaApiError('Too many requests', {
      status: 429,
      code: 'rate_limited',
      retryAfter: retryAfterFrom(res, body),
    });
  }
  return new MediaApiError(typeof body.error === 'string' ? body.error : fallback, {
    status: res.status,
  });
}

import type {
  MediaAnalysisResult,
  MediaJobRecord,
  MediaJobProgress,
  AudioMetadataTags,
  DetectedOutro,
  WatermarkMethod,
  WatermarkRegion,
  CaptionGenerationResponse,
  CaptionEnginesStatus,
  MedalInspection,
  MedalJobStatus,
} from '../types';

export async function probeStreamBitrate(sourceUrl: string): Promise<number | null> {
  try {
    const res = await fetch('/api/media/probe-bitrate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceUrl }),
    });
    if (!res.ok) {
      const body = await readErrorBody(res);
      // Rate limiting must reach the caller so it can stop probing further tracks.
      if (body.error === 'rate_limited') throw mediaRequestError(res, body, 'Too many requests');
      return null;
    }
    const data = await res.json();
    return typeof data.bitrateKbps === 'number' ? data.bitrateKbps : null;
  } catch (err) {
    if (err instanceof MediaApiError) throw err;
    return null;
  }
}

/**
 * Client-side mirror of the server's 10-minute analysis cache.
 *
 * Analyze, Preview, Play and Download can all be triggered for the same link,
 * and the server rate-limits `/api/media/analyze` per IP. Serving a URL we
 * already know from memory keeps normal browsing far below that limit instead
 * of exhausting it in seconds.
 */
const ANALYSIS_CACHE_TTL_MS = 10 * 60 * 1000;
const analysisResultCache = new Map<string, { result: MediaAnalysisResult; expiresAt: number }>();

/** Same key the server uses, so `?si=…&utm_source=…` links collapse to one entry. */
function normalizeAnalysisKey(url: string): string {
  try {
    const parsed = new URL(url.trim());
    for (const key of [...parsed.searchParams.keys()]) {
      if (key.startsWith('utm_') || ['si', 'feature', 'igsh', 'igshid', 'fbclid', 'ref'].includes(key)) {
        parsed.searchParams.delete(key);
      }
    }
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}${parsed.search}`;
  } catch {
    return url.trim();
  }
}

/** Drop every cached analysis; next request goes to the server again. */
export function clearMediaAnalysisCache(): void {
  analysisResultCache.clear();
}

/**
 * A cache hit for this exact link, without waiting for a round trip.
 * Returns `null` on a miss or once the entry expires.
 */
export function peekCachedAnalysis(url: string): MediaAnalysisResult | null {
  const entry = analysisResultCache.get(normalizeAnalysisKey(url));
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    analysisResultCache.delete(normalizeAnalysisKey(url));
    return null;
  }
  return entry.result;
}

export async function analyzeMediaUrl(url: string): Promise<MediaAnalysisResult> {
  const cacheKey = normalizeAnalysisKey(url);

  // Serve from memory when we already have a fresh answer for this link.
  const cached = peekCachedAnalysis(url);
  if (cached) return cached;

  const res = await fetch('/api/media/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });

  if (!res.ok) {
    throw mediaRequestError(res, await readErrorBody(res), `Failed to analyze media URL (HTTP ${res.status})`);
  }

  const result = await res.json();
  analysisResultCache.set(cacheKey, { result, expiresAt: Date.now() + ANALYSIS_CACHE_TTL_MS });
  return result;
}

export async function startMediaDownload(params: {
  sourceUrl?: string;
  directUrl?: string;
  title?: string;
  type?: string;
  format?: string;
  customBitrate?: number;
  /** Adaptive video-only URL (muxed with audioUrl server-side when present). */
  videoUrl?: string;
  /** Matching audio-only URL, used together with videoUrl. */
  audioUrl?: string;
  /** Segmented HLS manifest URLs (streamed with ffmpeg server-side). */
  hlsVideoUrl?: string;
  hlsAudioUrl?: string;
}): Promise<{ jobId: string; status: string; filename: string }> {
  const res = await fetch('/api/media/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    throw mediaRequestError(res, await readErrorBody(res), `Failed to initiate media download (HTTP ${res.status})`);
  }

  return res.json();
}

export async function fetchMediaJobs(): Promise<MediaJobRecord[]> {
  const res = await fetch('/api/media/jobs');
  if (!res.ok) throw new Error('Failed to fetch media jobs');
  const data = await res.json();
  return data.jobs || [];
}

export function subscribeMediaJobProgress(
  jobId: string,
  onProgress: (progress: MediaJobProgress) => void,
  onError?: (err: any) => void
): () => void {
  const eventSource = new EventSource(`/api/media/jobs/${jobId}/events`);

  eventSource.onmessage = (e) => {
    try {
      const data: MediaJobProgress = JSON.parse(e.data);
      onProgress(data);
    } catch (err) {
      console.error('Error parsing SSE media job:', err);
    }
  };

  eventSource.onerror = (e) => {
    if (onError) onError(e);
  };

  return () => {
    eventSource.close();
  };
}

export async function pauseMediaJob(jobId: string): Promise<boolean> {
  const res = await fetch(`/api/media/jobs/${jobId}/pause`, { method: 'POST' });
  return res.ok;
}

export async function resumeMediaJob(jobId: string): Promise<boolean> {
  const res = await fetch(`/api/media/jobs/${jobId}/resume`, { method: 'POST' });
  return res.ok;
}

export async function cancelMediaJob(jobId: string): Promise<boolean> {
  const res = await fetch(`/api/media/jobs/${jobId}/cancel`, { method: 'POST' });
  return res.ok;
}

export async function deleteMediaJob(jobId: string): Promise<boolean> {
  const res = await fetch(`/api/media/jobs/${jobId}`, { method: 'DELETE' });
  return res.ok;
}

export async function extractAudio(params: {
  tempPath: string;
  format?: string;
  bitrate?: number;
  preferStreamCopy?: boolean;
  metadata?: AudioMetadataTags;
}): Promise<{
  success: boolean;
  outputPath: string;
  downloadUrl: string;
  fileSizeBytes: number;
  sourceBitrateKbps: number;
  outputBitrateKbps: number;
  isStreamCopy: boolean;
  qualityNotice?: string;
}> {
  const res = await fetch('/api/audio/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to extract audio');
  }

  return res.json();
}

export async function convertAudio(params: {
  tempPath: string;
  format?: string;
  startSec?: number;
  endSec?: number;
  fadeInSec?: number;
  fadeOutSec?: number;
  volumeMultiplier?: number;
  normalizeLoudness?: boolean;
  bitrateKbps?: number;
}): Promise<{
  success: boolean;
  outputPath: string;
  downloadUrl: string;
  fileSizeBytes: number;
  duration: number;
}> {
  const res = await fetch('/api/audio/convert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to convert audio');
  }

  return res.json();
}

export async function fetchAudioWaveform(filePath: string): Promise<number[]> {
  const res = await fetch('/api/audio/waveform', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filePath }),
  });

  if (!res.ok) return Array(100).fill(0.3);
  const data = await res.json();
  return data.peaks || [];
}

export async function detectOutro(filePath: string): Promise<DetectedOutro> {
  const res = await fetch('/api/media/detect-outro', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filePath }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Outro detection failed');
  }

  return res.json();
}

export async function trimEnding(params: {
  filePath: string;
  cutTimeSec: number;
  applyFadeOut?: boolean;
}): Promise<{
  success: boolean;
  outputPath: string;
  downloadUrl: string;
  outputDuration: number;
}> {
  const res = await fetch('/api/media/trim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Trimming failed');
  }

  return res.json();
}

export async function removeWatermark(params: {
  filePath: string;
  method: WatermarkMethod;
  region: WatermarkRegion;
  blurStrength?: number;
}): Promise<{
  success: boolean;
  outputPath: string;
  downloadUrl: string;
  legalNotice: string;
  qualityDisclaimer: string;
}> {
  const res = await fetch('/api/user-content/watermark/remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Watermark removal failed');
  }

  return res.json();
}

export async function sendMediaToOptimizer(
  filePath: string,
  originalName?: string
): Promise<AnalysisResponse> {
  const res = await fetch('/api/media/send-to-optimizer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filePath, originalName }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to send media to optimizer');
  }

  return res.json();
}

/** Which optional caption engines are installed on the server. */
export async function fetchCaptionEngines(): Promise<CaptionEnginesStatus> {
  try {
    const res = await fetch('/api/media/captions/engines');
    if (!res.ok) throw new Error('unavailable');
    return await res.json();
  } catch {
    // Treat an unreachable probe as "platform captions only".
    return { platformCaptions: true, ytDlp: false, whisper: false };
  }
}

/**
 * Generate captions/subtitles for a video URL or a local file path.
 * URL videos use platform caption tracks (with a yt-dlp fallback); local files
 * are transcribed with the server's optional Whisper install.
 */
export async function generateCaptions(params: {
  url?: string;
  filePath?: string;
  language?: string;
}): Promise<CaptionGenerationResponse> {
  const res = await fetch('/api/media/captions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    throw mediaRequestError(res, await readErrorBody(res), `Caption generation failed (HTTP ${res.status})`);
  }

  return res.json();
}

/**
 * Analyze a public website URL and derive SEO/GEO keywords, H1 suggestions,
 * meta descriptions, tags and social captions. `scope: 'site'` also crawls
 * internal pages and audits the whole site.
 */
export async function analyzeSeoUrl(url: string, scope: SeoAnalyzeScope = 'site'): Promise<SeoReport> {
  const res = await fetch('/api/seo/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, scope }),
  });

  if (!res.ok) {
    throw mediaRequestError(res, await readErrorBody(res), `Website analysis failed (HTTP ${res.status})`);
  }

  return res.json();
}

/**
 * Crawl a site and generate a sitemap.xml plus a robots.txt snippet.
 * Heavy for the server — the UI shows its own loading state for this call.
 */
export async function generateSitemap(url: string): Promise<SitemapReport> {
  const res = await fetch('/api/seo/sitemap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });

  if (!res.ok) {
    throw mediaRequestError(res, await readErrorBody(res), `Sitemap generation failed (HTTP ${res.status})`);
  }

  return res.json();
}

export async function uploadFileChunked(
  file: File,
  onProgress?: (percent: number) => void
): Promise<AnalysisResponse> {
  const uploaded = await uploadFileInChunks(file, onProgress);
  // Analyze the assembled file with the optimizer.
  return sendMediaToOptimizer(uploaded.tempPath, uploaded.originalName);
}

// ============================================================================
// QR CODE GENERATOR — hosted file links
// ============================================================================

/** A file stored on the server, addressable by the URL encoded into a QR code. */
export interface QrHostedFile {
  id: string;
  /** Site-relative URL, e.g. `/api/tools/qr-files/f/<id>`. */
  url: string;
  name: string;
  size: number;
  mime: string;
}

/**
 * Uploads a file to be hosted for a QR code and returns its public URL.
 *
 * Uses XMLHttpRequest rather than fetch so the upload can report progress —
 * same reason `analyzeVideoFile` does.
 */
export function uploadQrFile(
  file: File,
  onUploadProgress?: (percent: number) => void
): Promise<QrHostedFile> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('file', file);

    xhr.open('POST', '/api/tools/qr-files/upload');

    if (xhr.upload && onUploadProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          onUploadProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
    }

    xhr.onload = () => {
      let body: Record<string, any> = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* non-JSON error page — fall through to the status check */
      }

      if (xhr.status >= 200 && xhr.status < 300 && body.url) {
        resolve(body as QrHostedFile);
        return;
      }

      if (xhr.status === 413) {
        reject(new MediaApiError(body.message || 'That file is too large to host.', { status: 413 }));
        return;
      }
      if (xhr.status === 429) {
        reject(
          new MediaApiError(body.message || 'Too many uploads. Try again shortly.', {
            status: 429,
            code: 'rate_limited',
            retryAfter: Number(body.retry_after) || undefined,
          })
        );
        return;
      }
      reject(
        new MediaApiError(body.message || body.error || `Upload failed (HTTP ${xhr.status})`, {
          status: xhr.status,
        })
      );
    };

    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(formData);
  });
}

/** Builds the absolute URL a phone should open after scanning. */
export function absoluteQrFileUrl(relativeUrl: string): string {
  if (!relativeUrl) return '';
  if (/^https?:\/\//i.test(relativeUrl)) return relativeUrl;
  if (typeof window === 'undefined') return relativeUrl;
  return new URL(relativeUrl, window.location.origin).toString();
}

// ============================================================================
// MEDAL.TV VIDEO DOWNLOADER
// ============================================================================

/** Inspects a public Medal clip and reports whether an original file exists. */
export async function inspectMedalClip(url: string): Promise<MedalInspection> {
  const res = await fetch('/api/tools/medal-downloader/inspect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });

  if (!res.ok) {
    throw mediaRequestError(res, await readErrorBody(res), `Clip inspection failed (HTTP ${res.status})`);
  }
  return res.json();
}

export interface MedalJobStart {
  jobId: string;
  downloadToken: string;
  state: string;
  createdAt: string;
  expiresAt: string;
}

/** Queues a download after the user explicitly attests they may download it. */
export async function startMedalDownload(url: string): Promise<MedalJobStart> {
  const res = await fetch('/api/tools/medal-downloader/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, authorized: true }),
  });

  if (!res.ok) {
    throw mediaRequestError(res, await readErrorBody(res), `Could not start the Medal download (HTTP ${res.status})`);
  }
  return res.json();
}

export async function getMedalJob(jobId: string, token: string): Promise<MedalJobStatus> {
  const res = await fetch(`/api/tools/medal-downloader/jobs/${encodeURIComponent(jobId)}`, {
    headers: { 'x-download-token': token },
  });

  if (!res.ok) {
    throw mediaRequestError(res, await readErrorBody(res), `Medal job lookup failed (HTTP ${res.status})`);
  }
  return res.json();
}

export async function cancelMedalDownload(jobId: string, token: string): Promise<boolean> {
  const res = await fetch(
    `/api/tools/medal-downloader/jobs/${encodeURIComponent(jobId)}/cancel`,
    { method: 'POST', headers: { 'x-download-token': token } }
  );
  if (!res.ok) return false;
  const data = await res.json().catch(() => ({}));
  return Boolean(data.success);
}

/** Download links carry the token because an <a download> cannot set headers. */
export function medalDownloadUrl(jobId: string, token: string): string {
  return `/api/tools/medal-downloader/jobs/${encodeURIComponent(jobId)}/download?token=${encodeURIComponent(token)}`;
}

