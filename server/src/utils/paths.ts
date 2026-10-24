import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isVercel = process.env.VERCEL === '1' || process.env.VERCEL === 'true';

// Vercel Functions have an ephemeral, mostly read-only filesystem. Only /tmp
// is writable, so use a stable /tmp subdirectory there. Everywhere else keep
// the local ./storage folder next to the built server.
function defaultStorageRoot(): string {
  if (isVercel) {
    return path.join(os.tmpdir(), 'ai-video-optimizer');
  }
  return path.resolve(__dirname, '../../storage');
}

// Storage root: override with STORAGE_DIR to use external/attached storage.
export const STORAGE_ROOT = process.env.STORAGE_DIR
  ? path.resolve(process.env.STORAGE_DIR)
  : defaultStorageRoot();

// SQLite database location (override with JOBS_DB_PATH for external persistence)
export const JOBS_DB_PATH = process.env.JOBS_DB_PATH
  ? path.resolve(process.env.JOBS_DB_PATH)
  : path.join(STORAGE_ROOT, 'jobs.db');
