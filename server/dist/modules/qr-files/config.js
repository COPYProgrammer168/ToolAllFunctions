import path from 'node:path';
import { STORAGE_ROOT } from '../../utils/paths.js';
/**
 * Configuration for the QR "hosted file" module.
 *
 * Uploads land in a dedicated directory (never a user-controlled path) so the
 * serve handler can treat everything in it as trusted-by-construction: files
 * are only ever written there by multer under a `nanoid` name we generate.
 */
function parsePositiveInt(val, fallback) {
    if (!val)
        return fallback;
    const parsed = parseInt(val, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
/**
 * Like `parsePositiveInt`, but 0 is a meaningful value here: a TTL of 0 means
 * "never expire", so it must not collapse back to the default.
 */
function parseNonNegativeInt(val, fallback) {
    if (!val)
        return fallback;
    const parsed = parseInt(val, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
export const QR_FILES_CONFIG = {
    storageDir: process.env.QR_FILES_DIR || path.join(STORAGE_ROOT, 'qr-files'),
    maxFileSizeMB: parsePositiveInt(process.env.QR_FILES_MAX_FILE_SIZE_MB, 25),
    /** Hours before an uploaded file is eligible for cleanup; 0 = never expire. */
    ttlHours: parseNonNegativeInt(process.env.QR_FILES_TTL_HOURS, 0),
};
export const MAX_FILE_SIZE_BYTES = QR_FILES_CONFIG.maxFileSizeMB * 1024 * 1024;
/**
 * The single source of truth for what may be hosted and how it is served.
 * Every entry here is a *passive* format: a browser that opens one of these
 * URLs renders it inline (image/video/audio/PDF) and cannot execute it, so no
 * entry may ever be an active-content type.
 */
export const ALLOWED_EXTENSIONS = {
    // Images
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.avif': 'image/avif',
    // Video
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    // Audio
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    // Documents
    '.pdf': 'application/pdf',
};
/**
 * Types rejected with a specific message rather than the generic "unsupported"
 * one. These are active-content / XSS or executable vectors: HTML and JS
 * execute in the scanner's browser, XML can pivot to XSS, and PHP/EXE/SH are
 * server- or host-installed code. SVG is deliberately on this list even though
 * it is an image format — an SVG document can embed <script> and event
 * handlers, so allowing it would undo the passive-format guarantee above.
 */
export const BLOCKED_EXTENSIONS = [
    '.svg',
    '.html',
    '.htm',
    '.xhtml',
    '.xml',
    '.js',
    '.mjs',
    '.php',
    '.exe',
    '.sh',
];
