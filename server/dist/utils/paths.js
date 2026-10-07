import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Storage root: override with STORAGE_DIR to persist on external/attached
// storage (e.g. Render Disk mounted at /mnt/data). Falls back to the
// local ./storage folder next to the built server.
export const STORAGE_ROOT = process.env.STORAGE_DIR
    ? path.resolve(process.env.STORAGE_DIR)
    : path.resolve(__dirname, '../../storage');
// SQLite database location (override with JOBS_DB_PATH for external persistence)
export const JOBS_DB_PATH = process.env.JOBS_DB_PATH
    ? path.resolve(process.env.JOBS_DB_PATH)
    : path.join(STORAGE_ROOT, 'jobs.db');
