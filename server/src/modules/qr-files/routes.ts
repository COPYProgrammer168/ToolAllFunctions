import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { nanoid } from 'nanoid';
import {
  QR_FILES_CONFIG,
  MAX_FILE_SIZE_BYTES,
  ALLOWED_EXTENSIONS,
  BLOCKED_EXTENSIONS,
} from './config.js';
import { rateLimit } from '../../utils/rateLimiter.js';
import { sanitizeFilename, assertPathInside } from '../../utils/security.js';

/**
 * Hosted-file backend for the QR Code Generator's "hosted file" mode.
 *
 * Files are streamed back through an API route (not `express.static`) so every
 * response can carry the same hardened headers — notably
 * `X-Content-Type-Options: nosniff`, which stops a browser from sniffing a
 * stored file into something executable. Storage names are always
 * `<nanoid>.<ext>` generated here, and served names must match a strict id
 * pattern, so a request can never reach outside the storage directory.
 */

/** Filter/limit failures carry a code so the route can map them to a status. */
const UNSUPPORTED_FILE_TYPE = 'UNSUPPORTED_FILE_TYPE';

const uploadStorage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    await fs.mkdir(QR_FILES_CONFIG.storageDir, { recursive: true });
    cb(null, QR_FILES_CONFIG.storageDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    // The id is the whole filename minus the extension; the serve handler
    // recovers it by stripping the extension again.
    cb(null, `${nanoid(10)}${ext}`);
  },
});

const upload = multer({
  storage: uploadStorage,
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (Object.prototype.hasOwnProperty.call(ALLOWED_EXTENSIONS, ext)) {
      cb(null, true);
      return;
    }
    const reason = BLOCKED_EXTENSIONS.includes(ext)
      ? `Files of type "${ext}" are not permitted.`
      : `Unsupported file type "${ext || '(none)'}".`;
    const err: any = new Error(reason);
    err.code = UNSUPPORTED_FILE_TYPE;
    cb(err);
  },
});

/** Runs multer and translates its filter/limit failures into JSON responses. */
function handleUpload(req: Request, res: Response, next: (err?: any) => void): void {
  upload.single('file')(req, res, (err: any) => {
    if (!err) {
      next();
      return;
    }

    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({
        error: 'file_too_large',
        message: `File exceeds the ${QR_FILES_CONFIG.maxFileSizeMB} MB limit.`,
      });
      return;
    }

    if (err.code === UNSUPPORTED_FILE_TYPE) {
      res.status(400).json({ error: 'unsupported_file_type', message: err.message });
      return;
    }

    console.error('[qr-files] upload failed:', err);
    res.status(500).json({ error: 'upload_failed', message: 'Failed to store the uploaded file.' });
  });
}

export const qrFilesRouter = Router();

// POST /upload — store one file and return a scannable site-relative URL.
qrFilesRouter.post(
  '/upload',
  rateLimit({ windowMs: 60_000, max: 10, label: 'qr-file-upload' }),
  handleUpload,
  (req: Request, res: Response) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'no_file', message: 'No file was uploaded.' });
      return;
    }

    const id = path.parse(file.filename).name;
    const ext = path.extname(file.filename).toLowerCase();
    const mime = ALLOWED_EXTENSIONS[ext] || 'application/octet-stream';

    res.status(200).json({
      id,
      url: `/api/tools/qr-files/f/${id}`,
      name: sanitizeFilename(file.originalname),
      size: file.size,
      mime,
    });
  }
);

// GET /f/:id — stream a stored file inline with hardened headers.
qrFilesRouter.get('/f/:id', async (req: Request, res: Response) => {
  const id = req.params.id;
  if (!/^[A-Za-z0-9_-]{6,32}$/.test(id)) {
    res.status(400).json({ error: 'invalid_id', message: 'Invalid file id.' });
    return;
  }

  let entries;
  try {
    entries = await fs.readdir(QR_FILES_CONFIG.storageDir, { withFileTypes: true });
  } catch {
    res.status(404).json({ error: 'not_found', message: 'File not found.' });
    return;
  }

  const entry = entries.find((e) => e.isFile() && e.name.startsWith(`${id}.`));
  if (!entry) {
    res.status(404).json({ error: 'not_found', message: 'File not found.' });
    return;
  }

  const absPath = path.join(QR_FILES_CONFIG.storageDir, entry.name);

  // Defence in depth: the id regex and the readdir match already make traversal
  // impossible, but confirm the resolved path is still inside storage.
  try {
    assertPathInside(absPath, QR_FILES_CONFIG.storageDir);
  } catch {
    res.status(403).json({ error: 'forbidden', message: 'Access denied.' });
    return;
  }

  // Type comes from the stored extension, never a guess: a file whose extension
  // is not in the allowlist (only possible if the directory was tampered with)
  // is refused rather than served as an opaque download.
  const ext = path.extname(entry.name).toLowerCase();
  const mime = ALLOWED_EXTENSIONS[ext];
  if (!mime) {
    res.status(403).json({ error: 'forbidden', message: 'File type is not permitted.' });
    return;
  }

  const stat = await fs.stat(absPath).catch(() => null);
  if (!stat) {
    res.status(404).json({ error: 'not_found', message: 'File not found.' });
    return;
  }

  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Length', stat.size.toString());
  res.setHeader('Content-Disposition', `inline; filename="${sanitizeFilename(entry.name)}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

  const stream = createReadStream(absPath);
  stream.on('error', (err) => {
    console.error('[qr-files] stream error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'stream_failed', message: 'Failed to read the stored file.' });
    } else {
      res.end();
    }
  });
  stream.pipe(res);
});

/**
 * Deletes stored files whose mtime is older than the configured TTL.
 * With the default TTL of 0 ("never expire") this is a no-op, so callers can
 * invoke it unconditionally. No timer is wired up here by design.
 */
export async function cleanupExpired(): Promise<number> {
  if (QR_FILES_CONFIG.ttlHours <= 0) return 0;

  const cutoff = Date.now() - QR_FILES_CONFIG.ttlHours * 60 * 60 * 1000;
  let removed = 0;

  let entries;
  try {
    entries = await fs.readdir(QR_FILES_CONFIG.storageDir, { withFileTypes: true });
  } catch {
    return 0;
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const absPath = path.join(QR_FILES_CONFIG.storageDir, entry.name);
    try {
      const stat = await fs.stat(absPath);
      if (stat.mtimeMs < cutoff) {
        await fs.unlink(absPath);
        removed++;
      }
    } catch {
      // Raced with a delete or an unreadable entry; skip it.
    }
  }

  return removed;
}

export default qrFilesRouter;
