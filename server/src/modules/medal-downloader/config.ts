import path from 'node:path';
import { STORAGE_ROOT } from '../../utils/paths.js';

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const lower = value.trim().toLowerCase();
  if (lower === 'true' || lower === '1') return true;
  if (lower === 'false' || lower === '0') return false;
  return fallback;
}

/**
 * Medal.tv downloader limits.
 *
 * The defaults are deliberately conservative for a single-instance deployment:
 * one clip download at a time and a small queue. All values can be overridden
 * from the environment without changing code.
 */
export const MEDAL_CONFIG = {
  enabled: parseBoolean(process.env.MEDAL_DOWNLOADER_ENABLED, true),
  maxFileSizeMB: parsePositiveInt(process.env.MEDAL_DOWNLOADER_MAX_FILE_SIZE_MB, 500),
  maxConcurrentJobs: parsePositiveInt(process.env.MEDAL_DOWNLOADER_MAX_CONCURRENT_JOBS, 1),
  maxQueueSize: parsePositiveInt(process.env.MEDAL_DOWNLOADER_MAX_QUEUE_SIZE, 10),
  jobTtlMinutes: parsePositiveInt(process.env.MEDAL_DOWNLOADER_JOB_TTL_MINUTES, 30),
  pageTimeoutSeconds: parsePositiveInt(process.env.MEDAL_DOWNLOADER_PAGE_TIMEOUT_SECONDS, 15),
  downloadTimeoutSeconds: parsePositiveInt(
    process.env.MEDAL_DOWNLOADER_DOWNLOAD_TIMEOUT_SECONDS,
    600
  ),
  downloadIdleTimeoutSeconds: parsePositiveInt(
    process.env.MEDAL_DOWNLOADER_DOWNLOAD_IDLE_TIMEOUT_SECONDS,
    30
  ),
  inspectRateLimitPerMinute: parsePositiveInt(
    process.env.MEDAL_DOWNLOADER_INSPECT_RATE_LIMIT,
    10
  ),
  jobRateLimitPerMinute: parsePositiveInt(process.env.MEDAL_DOWNLOADER_JOB_RATE_LIMIT, 6),
  /** Maximum decoded HTML accepted from the clip page. */
  pageMaxBytes: parsePositiveInt(process.env.MEDAL_DOWNLOADER_PAGE_MAX_BYTES, 4 * 1024 * 1024),
  /** Bytes requested for the MP4 signature/size probe. */
  mediaProbeBytes: 4096,
  maxRedirects: 3,
  tempDir:
    process.env.MEDAL_DOWNLOADER_TEMP_DIR ||
    path.join(STORAGE_ROOT, 'temp', 'medal-downloader'),
};

export const MEDAL_MAX_FILE_SIZE_BYTES = MEDAL_CONFIG.maxFileSizeMB * 1024 * 1024;

export const MEDAL_UNAVAILABLE_MESSAGE =
  "This clip cannot be downloaded through this tool. Open it on Medal.tv and use Medal's available download option.";

export const MEDAL_DOWNLOAD_GUIDE_URL =
  'https://support.medal.tv/support/solutions/articles/48000922113-how-to-download-medal-clips';
