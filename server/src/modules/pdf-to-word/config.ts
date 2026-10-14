import path from 'node:path';
import { STORAGE_ROOT } from '../../utils/paths.js';

function parsePositiveInt(val: string | undefined, fallback: number): number {
  if (!val) return fallback;
  const parsed = parseInt(val, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(val: string | undefined, fallback: boolean): boolean {
  if (!val) return fallback;
  const lower = val.trim().toLowerCase();
  if (lower === 'true' || lower === '1') return true;
  if (lower === 'false' || lower === '0') return false;
  return fallback;
}

export const PDF_CONFIG = {
  maxFilesPerBatch: parsePositiveInt(process.env.PDF_TO_WORD_MAX_FILES, 10),
  maxFileSizeMB: parsePositiveInt(process.env.PDF_TO_WORD_MAX_FILE_SIZE_MB, 25),
  maxPages: parsePositiveInt(process.env.PDF_TO_WORD_MAX_PAGES, 200),
  maxConcurrentJobs: parsePositiveInt(process.env.PDF_TO_WORD_MAX_CONCURRENT_JOBS, 1),
  jobTtlMinutes: parsePositiveInt(process.env.PDF_TO_WORD_JOB_TTL_MINUTES, 30),
  conversionTimeoutSeconds: parsePositiveInt(process.env.PDF_TO_WORD_CONVERSION_TIMEOUT_SECONDS, 300),
  maxQueueSize: parsePositiveInt(process.env.PDF_TO_WORD_MAX_QUEUE_SIZE, 50),
  ocrEnabled: parseBoolean(process.env.PDF_TO_WORD_OCR_ENABLED, true),
  defaultOcrLanguages: (process.env.PDF_TO_WORD_DEFAULT_OCR_LANGUAGES || 'eng')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  tempDir:
    process.env.PDF_TO_WORD_TEMP_DIR ||
    path.join(STORAGE_ROOT || path.resolve(process.cwd(), 'storage'), 'temp', 'pdf-to-word'),
};

export const MAX_FILE_SIZE_BYTES = PDF_CONFIG.maxFileSizeMB * 1024 * 1024;
