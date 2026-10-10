import type { OptimizationReport, JobConfig, JobProgress, HardwareInfo } from '../types';

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

export async function analyzeVideoFile(file: File, onUploadProgress?: (percent: number) => void): Promise<AnalysisResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('video', file);

    xhr.open('POST', '/api/video/analyze');

    if (xhr.upload && onUploadProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const percent = Math.round((e.loaded / e.total) * 100);
          onUploadProgress(percent);
        }
      };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          resolve(data);
        } catch {
          reject(new Error('Invalid response from server'));
        }
      } else {
        try {
          const err = JSON.parse(xhr.responseText);
          reject(new Error(err.error || 'Video analysis failed'));
        } catch {
          reject(new Error(`Server error: ${xhr.status}`));
        }
      }
    };

    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(formData);
  });
}

export async function generateDemoVideo(): Promise<AnalysisResponse> {
  const res = await fetch('/api/video/demo', { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to generate demo clip');
  }
  return res.json();
}

export async function createOptimizationJob(params: {
  file?: File | null;
  tempPath?: string | null;
  originalName: string;
  config: Partial<JobConfig>;
}): Promise<{ jobId: string }> {
  const formData = new FormData();
  if (params.file) {
    formData.append('video', params.file);
  }
  if (params.tempPath) {
    formData.append('tempPath', params.tempPath);
  }
  formData.append('originalName', params.originalName);
  formData.append('config', JSON.stringify(params.config));

  const res = await fetch('/api/jobs', {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to start optimization job');
  }

  return res.json();
}

export async function cancelJob(jobId: string): Promise<boolean> {
  const res = await fetch(`/api/jobs/${jobId}/cancel`, { method: 'POST' });
  if (!res.ok) return false;
  const data = await res.json();
  return Boolean(data.success);
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

/** Reads a JSON error body, tolerating non-JSON responses. */
async function readErrorBody(res: Response): Promise<Record<string, any>> {
  try {
    return (await res.json()) as Record<string, any>;
  } catch {
    return {};
  }
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

export async function uploadFileChunked(
  file: File,
  onProgress?: (percent: number) => void
): Promise<AnalysisResponse> {
  const CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB chunks
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  const fileId = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9]/g, '')}`;

  let finalResponse: AnalysisResponse | null = null;

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
    const start = chunkIndex * CHUNK_SIZE;
    const end = Math.min(file.size, start + CHUNK_SIZE);
    const chunk = file.slice(start, end);

    const formData = new FormData();
    formData.append('chunk', chunk);
    formData.append('fileId', fileId);
    formData.append('chunkIndex', chunkIndex.toString());
    formData.append('totalChunks', totalChunks.toString());
    formData.append('fileName', file.name);

    const res = await fetch('/api/media/upload-chunk', {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      throw new Error(`Upload failed on chunk ${chunkIndex + 1}/${totalChunks}`);
    }

    const data = await res.json();
    if (onProgress) {
      onProgress(Math.round(((chunkIndex + 1) / totalChunks) * 100));
    }

    if (data.completed) {
      // Analyze the assembled file with optimizer
      return await sendMediaToOptimizer(data.tempPath, data.originalName);
    }
  }

  if (!finalResponse) {
    throw new Error('Chunked upload did not complete cleanly.');
  }

  return finalResponse;
}

