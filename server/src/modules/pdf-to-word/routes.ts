import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { nanoid } from 'nanoid';
import { PDF_CONFIG, MAX_FILE_SIZE_BYTES } from './config.js';
import { PdfJobManager } from './jobManager.js';
import { validatePdfSignature } from './validator.js';
import { rateLimit } from '../../utils/rateLimiter.js';
import type { PdfJob, ConversionMode, OcrMode } from './types.js';

const uploadStorage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    const uploadDir = path.join(PDF_CONFIG.tempDir, 'uploads');
    await fs.mkdir(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.pdf';
    const safeName = `${Date.now()}_${nanoid(8)}${ext}`;
    cb(null, safeName);
  },
});

const upload = multer({
  storage: uploadStorage,
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
    files: PDF_CONFIG.maxFilesPerBatch,
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.pdf' || file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${ext}. Only PDF documents are accepted.`));
    }
  },
});

function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || req.ip || 'unknown';
}

function isJobAuthorized(req: Request, job: PdfJob): boolean {
  const token = (req.query.token as string) || (req.headers['x-download-token'] as string);
  if (token && token === job.downloadToken) return true;
  return getClientIp(req) === job.clientIp;
}

export const pdfToWordRouter = Router();

// Create conversion job with uploaded PDF files
pdfToWordRouter.post(
  '/jobs',
  rateLimit({ windowMs: 60 * 1000, max: 20, label: 'pdf-to-word-create' }),
  upload.array('files', PDF_CONFIG.maxFilesPerBatch),
  async (req: Request, res: Response) => {
    const uploadedFiles = req.files as Express.Multer.File[];
    if (!uploadedFiles || uploadedFiles.length === 0) {
      res.status(400).json({ error: 'No PDF files were uploaded.' });
      return;
    }

    // Validate magic bytes for all uploaded files
    for (const f of uploadedFiles) {
      const isValid = await validatePdfSignature(f.path);
      if (!isValid) {
        // Clean up uploaded files
        for (const fileToDelete of uploadedFiles) {
          await fs.unlink(fileToDelete.path).catch(() => {});
        }
        res.status(400).json({
          error: `File "${f.originalname}" is not a valid PDF document (invalid magic bytes header).`,
        });
        return;
      }
    }

    const mode: ConversionMode =
      req.body.mode === 'plain-text' ? 'plain-text' : 'layout';

    const ocrMode: OcrMode =
      req.body.ocrMode === 'enabled'
        ? 'enabled'
        : req.body.ocrMode === 'disabled'
        ? 'disabled'
        : 'auto';

    let ocrLanguages: string[] = PDF_CONFIG.defaultOcrLanguages;
    if (req.body.ocrLanguages) {
      if (Array.isArray(req.body.ocrLanguages)) {
        ocrLanguages = req.body.ocrLanguages.map((s: any) => String(s).trim().toLowerCase());
      } else if (typeof req.body.ocrLanguages === 'string') {
        ocrLanguages = req.body.ocrLanguages
          .split(',')
          .map((s: string) => s.trim().toLowerCase())
          .filter(Boolean);
      }
    }

    const pageRange = typeof req.body.pageRange === 'string' ? req.body.pageRange.trim() : undefined;
    const password = typeof req.body.password === 'string' ? req.body.password : undefined;

    try {
      const job = PdfJobManager.createJob(
        getClientIp(req),
        uploadedFiles.map((f) => ({
          originalname: f.originalname,
          filename: f.filename,
          path: f.path,
          size: f.size,
        })),
        {
          mode,
          ocrMode,
          ocrLanguages,
          pageRange,
          password,
        }
      );

      res.status(201).json({
        jobId: job.jobId,
        downloadToken: job.downloadToken,
        state: job.state,
        createdAt: job.createdAt,
        files: job.files.map((f) => ({
          fileId: f.fileId,
          originalName: f.originalName,
          state: f.state,
          progress: f.progress,
          stage: f.stage,
          pageCount: f.pageCount,
          fileSizeBytes: f.fileSizeBytes,
          needsPassword: f.needsPassword,
        })),
      });
    } catch (err: any) {
      // Clean up files on error
      for (const f of uploadedFiles) {
        await fs.unlink(f.path).catch(() => {});
      }
      res.status(500).json({ error: err.message || 'Failed to initialize conversion job' });
    }
  }
);

// Get job status
pdfToWordRouter.get('/jobs/:jobId', (req: Request, res: Response) => {
  const jobId = req.params.jobId;
  const job = PdfJobManager.getJob(jobId);

  if (!job) {
    res.status(404).json({ error: 'Job not found or has expired.' });
    return;
  }

  if (!isJobAuthorized(req, job)) {
    res.status(403).json({ error: 'Unauthorized access to this conversion job.' });
    return;
  }

  const completedCount = job.files.filter((f) => f.state === 'done').length;

  res.json({
    jobId: job.jobId,
    state: job.state,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    options: {
      mode: job.options.mode,
      ocrMode: job.options.ocrMode,
      ocrLanguages: job.options.ocrLanguages,
      pageRange: job.options.pageRange,
    },
    files: job.files.map((f) => ({
      fileId: f.fileId,
      originalName: f.originalName,
      state: f.state,
      progress: f.progress,
      stage: f.stage,
      pageCount: f.pageCount,
      pagesConverted: f.pagesConverted,
      ocrPages: f.ocrPages,
      fileSizeBytes: f.fileSizeBytes,
      needsPassword: f.needsPassword,
      warnings: f.warnings,
      error: f.error,
      outputName: f.outputName,
      hasOutput: Boolean(f.outputPath && f.state === 'done'),
    })),
    downloadActions: {
      canDownloadAll: completedCount > 0,
      completedFilesCount: completedCount,
      totalFilesCount: job.files.length,
    },
  });
});

// Retry a password-protected file with password
pdfToWordRouter.post(
  '/jobs/:jobId/files/:fileId/password',
  rateLimit({ windowMs: 60 * 1000, max: 30, label: 'pdf-to-word-password' }),
  async (req: Request, res: Response) => {
    const { jobId, fileId } = req.params;
    const password = req.body.password;

    if (typeof password !== 'string') {
      res.status(400).json({ error: 'Password string is required.' });
      return;
    }

    const job = PdfJobManager.getJob(jobId);
    if (!job) {
      res.status(404).json({ error: 'Job not found or has expired.' });
      return;
    }

    if (!isJobAuthorized(req, job)) {
      res.status(403).json({ error: 'Unauthorized access to this conversion job.' });
      return;
    }

    const accepted = await PdfJobManager.submitPassword(jobId, fileId, password);
    if (!accepted) {
      res.status(400).json({
        error: 'Provided password could not decrypt the document.',
        wrongPassword: true,
      });
      return;
    }

    res.json({ success: true, message: 'Password accepted. Job queued for conversion.' });
  }
);

// Download single converted DOCX
pdfToWordRouter.get(
  '/jobs/:jobId/files/:fileId/download',
  async (req: Request, res: Response) => {
    const { jobId, fileId } = req.params;
    const job = PdfJobManager.getJob(jobId);

    if (!job) {
      res.status(404).json({ error: 'Job not found or has expired.' });
      return;
    }

    if (!isJobAuthorized(req, job)) {
      res.status(403).json({ error: 'Unauthorized access to this file.' });
      return;
    }

    const file = job.files.find((f) => f.fileId === fileId);
    if (!file || !file.outputPath || file.state !== 'done') {
      res.status(404).json({ error: 'File is not yet ready or conversion failed.' });
      return;
    }

    const stat = await fs.stat(file.outputPath).catch(() => null);
    if (!stat) {
      res.status(410).json({ error: 'The requested output file has expired or was removed.' });
      return;
    }

    const filename = file.outputName || path.basename(file.outputPath);

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`
    );
    res.setHeader('Content-Length', stat.size);

    const stream = createReadStream(file.outputPath);
    stream.pipe(res);
  }
);

// Download all completed results as ZIP
pdfToWordRouter.get('/jobs/:jobId/download-all', (req: Request, res: Response) => {
  const jobId = req.params.jobId;
  const job = PdfJobManager.getJob(jobId);

  if (!job) {
    res.status(404).json({ error: 'Job not found or has expired.' });
    return;
  }

  if (!isJobAuthorized(req, job)) {
    res.status(403).json({ error: 'Unauthorized access to this job.' });
    return;
  }

  try {
    const { stream, count } = PdfJobManager.createBatchZipStream(jobId);
    if (count === 0) {
      res.status(400).json({ error: 'No converted documents are available for download yet.' });
      return;
    }

    const zipName = `pdf-to-word-batch-${jobId.slice(0, 8)}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

    stream.on('error', (err: any) => {
      console.error('[ZIP Error]', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to create zip archive.' });
      }
    });

    stream.pipe(res);
    stream.finalize();
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to archive documents' });
  }
});

// Cancel conversion job
pdfToWordRouter.post('/jobs/:jobId/cancel', async (req: Request, res: Response) => {
  const jobId = req.params.jobId;
  const job = PdfJobManager.getJob(jobId);

  if (!job) {
    res.status(404).json({ error: 'Job not found or has expired.' });
    return;
  }

  if (!isJobAuthorized(req, job)) {
    res.status(403).json({ error: 'Unauthorized access to this job.' });
    return;
  }

  const cancelled = await PdfJobManager.cancelJob(jobId);
  res.json({ success: cancelled, state: 'cancelled' });
});
