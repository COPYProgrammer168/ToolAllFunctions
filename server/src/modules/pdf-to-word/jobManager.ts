import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { ZipArchive } from 'archiver';
import type {
  PdfJob,
  PdfFileJob,
  PdfToWordOptions,
  JobState,
  ConversionResult,
} from './types.js';
import { PDF_CONFIG } from './config.js';
import { convertPdfToDocx, ConversionError } from './conversionEngine.js';
import { inspectPdfDocument } from './inspector.js';

interface ActiveWorker {
  abortController: AbortController;
  timeoutHandle: NodeJS.Timeout;
}

export class PdfJobManager {
  private static jobs = new Map<string, PdfJob>();
  private static activeWorkers = new Map<string, ActiveWorker>();
  private static processingQueue: string[] = [];
  private static activeJobsCount = 0;
  private static cleanupInterval: NodeJS.Timeout | null = null;

  public static async init(): Promise<void> {
    try {
      await fs.mkdir(PDF_CONFIG.tempDir, { recursive: true });
    } catch {}

    // Startup sweep of orphaned folders in tempDir
    this.sweepOldDirectories().catch(console.error);

    // Periodic sweep every 5 minutes
    if (!this.cleanupInterval) {
      this.cleanupInterval = setInterval(() => {
        this.sweepExpiredJobs().catch(console.error);
      }, 5 * 60 * 1000);
      this.cleanupInterval.unref();
    }
  }

  public static createJob(
    clientIp: string,
    uploadedFiles: { originalname: string; filename: string; path: string; size: number }[],
    options: PdfToWordOptions
  ): PdfJob {
    if (this.jobs.size >= PDF_CONFIG.maxQueueSize) {
      throw new Error('Conversion queue is currently full. Please try again shortly.');
    }

    const jobId = nanoid(16);
    const downloadToken = nanoid(32);
    const now = Date.now();

    const fileJobs: PdfFileJob[] = uploadedFiles.map((f) => ({
      fileId: nanoid(12),
      originalName: f.originalname,
      safeName: f.filename,
      filePath: f.path,
      fileSizeBytes: f.size,
      state: 'queued',
      progress: 0,
      stage: 'Waiting in queue...',
      warnings: [],
    }));

    const job: PdfJob = {
      jobId,
      clientIp,
      createdAt: now,
      updatedAt: now,
      state: 'queued',
      files: fileJobs,
      options,
      downloadToken,
      cancelled: false,
    };

    this.jobs.set(jobId, job);
    this.processingQueue.push(jobId);

    // Initial inspection in background for all files to populate page counts
    this.runInitialInspections(jobId).catch(() => {});

    // Kick off queue processing
    this.processNextInQueue().catch(console.error);

    return job;
  }

  private static async runInitialInspections(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;

    for (const f of job.files) {
      try {
        const insp = await inspectPdfDocument(f.filePath, job.options.password);
        if (insp.success && insp.inspection) {
          f.pageCount = insp.inspection.pageCount;
          f.inspection = insp.inspection;
        } else if (insp.needsPassword) {
          f.needsPassword = true;
          f.state = 'needs_password';
          f.stage = insp.wrongPassword ? 'Wrong password provided' : 'Waiting for password';
        }
      } catch {}
    }
  }

  public static getJob(jobId: string): PdfJob | undefined {
    return this.jobs.get(jobId);
  }

  public static async cancelJob(jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    job.cancelled = true;
    job.state = 'cancelled';
    job.updatedAt = Date.now();

    // Abort active worker if running
    const worker = this.activeWorkers.get(jobId);
    if (worker) {
      clearTimeout(worker.timeoutHandle);
      worker.abortController.abort();
      this.activeWorkers.delete(jobId);
      this.activeJobsCount = Math.max(0, this.activeJobsCount - 1);
    }

    // Cancel remaining files
    for (const file of job.files) {
      if (file.state === 'queued' || file.state === 'running' || file.state === 'inspecting') {
        file.state = 'cancelled';
        file.stage = 'Cancelled by user';
      }
    }

    // Process next in queue
    this.processNextInQueue().catch(console.error);
    return true;
  }

  public static async submitPassword(
    jobId: string,
    fileId: string,
    password: string
  ): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job || job.cancelled) return false;

    const file = job.files.find((f) => f.fileId === fileId);
    if (!file) return false;

    // Fast-verify password with inspector
    const insp = await inspectPdfDocument(file.filePath, password);
    if (!insp.success) {
      file.state = 'needs_password';
      file.needsPassword = true;
      file.stage = insp.wrongPassword ? 'Incorrect password' : 'Password required';
      file.error = insp.error;
      return false;
    }

    file.inspection = insp.inspection;
    file.pageCount = insp.inspection?.pageCount;
    file.needsPassword = false;
    file.error = undefined;
    file.state = 'queued';
    file.stage = 'Password verified; queued for conversion';

    // Store per-file password securely on options map
    job.options.password = password;

    if (job.state === 'needs_password' || job.state === 'failed') {
      job.state = 'queued';
      this.processingQueue.push(jobId);
      this.processNextInQueue().catch(console.error);
    }

    return true;
  }

  private static async processNextInQueue(): Promise<void> {
    if (this.activeJobsCount >= PDF_CONFIG.maxConcurrentJobs) {
      return;
    }

    if (this.processingQueue.length === 0) {
      return;
    }

    const jobId = this.processingQueue.shift();
    if (!jobId) return;

    const job = this.jobs.get(jobId);
    if (!job || job.cancelled) {
      this.processNextInQueue().catch(console.error);
      return;
    }

    this.activeJobsCount++;
    this.runJob(job).finally(() => {
      this.activeJobsCount = Math.max(0, this.activeJobsCount - 1);
      this.processNextInQueue().catch(console.error);
    });
  }

  private static async runJob(job: PdfJob): Promise<void> {
    const jobId = job.jobId;
    const jobDir = path.join(PDF_CONFIG.tempDir, jobId);
    await fs.mkdir(jobDir, { recursive: true });

    job.state = 'running';
    job.updatedAt = Date.now();

    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => {
      abortController.abort();
    }, PDF_CONFIG.conversionTimeoutSeconds * 1000);

    this.activeWorkers.set(jobId, { abortController, timeoutHandle });

    try {
      let anySuccess = false;
      let anyNeedsPassword = false;

      for (const file of job.files) {
        if (job.cancelled) break;
        if (file.state === 'done') {
          anySuccess = true;
          continue;
        }

        file.state = 'running';
        file.stage = 'Starting conversion...';
        job.updatedAt = Date.now();

        try {
          const result: ConversionResult = await convertPdfToDocx(
            file.filePath,
            file.originalName,
            jobDir,
            job.options,
            (percent, stage) => {
              file.progress = percent;
              file.stage = stage;
              job.updatedAt = Date.now();
            },
            abortController.signal
          );

          file.state = 'done';
          file.progress = 100;
          file.stage = 'Completed';
          file.outputPath = result.outputPath;
          file.outputName = result.outputName;
          file.pagesConverted = result.pagesConverted;
          file.ocrPages = result.ocrPages;
          file.warnings = result.warnings;
          anySuccess = true;
        } catch (err: any) {
          if (err instanceof ConversionError && err.needsPassword) {
            file.state = 'needs_password';
            file.needsPassword = true;
            file.error = err.message;
            file.stage = err.wrongPassword ? 'Wrong password' : 'Password required';
            anyNeedsPassword = true;
          } else if (abortController.signal.aborted) {
            file.state = 'failed';
            file.error = `Conversion timed out after ${PDF_CONFIG.conversionTimeoutSeconds} seconds.`;
            file.stage = 'Timed out';
          } else {
            file.state = 'failed';
            file.error = err.message || 'Conversion failed';
            file.stage = 'Failed';
          }
        }
      }

      if (job.cancelled) {
        job.state = 'cancelled';
      } else if (anyNeedsPassword && !anySuccess) {
        job.state = 'needs_password';
      } else if (anySuccess) {
        job.state = 'done';
      } else {
        job.state = 'failed';
      }
    } finally {
      clearTimeout(timeoutHandle);
      this.activeWorkers.delete(jobId);
      job.updatedAt = Date.now();
    }
  }

  /**
   * Creates a ZIP archive containing all successfully converted DOCX documents.
   * Handles duplicate filenames cleanly (e.g., document.docx, document_1.docx).
   */
  public static createBatchZipStream(jobId: string): { stream: ZipArchive; count: number } {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error('Job not found');

    const archive = new ZipArchive({ zlib: { level: 6 } });
    const usedNames = new Set<string>();
    let count = 0;

    for (const file of job.files) {
      if (file.state === 'done' && file.outputPath) {
        let entryName = file.outputName || path.basename(file.outputPath);
        if (usedNames.has(entryName)) {
          const ext = path.extname(entryName);
          const base = path.basename(entryName, ext);
          let counter = 1;
          while (usedNames.has(`${base}_${counter}${ext}`)) {
            counter++;
          }
          entryName = `${base}_${counter}${ext}`;
        }
        usedNames.add(entryName);
        archive.file(file.outputPath, { name: entryName });
        count++;
      }
    }

    return { stream: archive, count };
  }

  private static async sweepExpiredJobs(): Promise<void> {
    const now = Date.now();
    const ttlMs = PDF_CONFIG.jobTtlMinutes * 60 * 1000;

    for (const [jobId, job] of this.jobs.entries()) {
      if (now - job.updatedAt > ttlMs) {
        // Do not sweep actively running jobs
        if (job.state === 'running' || this.activeWorkers.has(jobId)) {
          continue;
        }

        const jobDir = path.join(PDF_CONFIG.tempDir, jobId);
        await fs.rm(jobDir, { recursive: true, force: true }).catch(() => {});

        // Remove source upload files
        for (const file of job.files) {
          await fs.unlink(file.filePath).catch(() => {});
        }

        this.jobs.delete(jobId);
      }
    }
  }

  private static async sweepOldDirectories(): Promise<void> {
    try {
      const entries = await fs.readdir(PDF_CONFIG.tempDir, { withFileTypes: true });
      const now = Date.now();
      const maxAgeMs = 2 * 60 * 60 * 1000; // 2 hours

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const fullPath = path.join(PDF_CONFIG.tempDir, entry.name);
          const stat = await fs.stat(fullPath).catch(() => null);
          if (stat && now - stat.mtimeMs > maxAgeMs) {
            await fs.rm(fullPath, { recursive: true, force: true }).catch(() => {});
          }
        }
      }
    } catch {}
  }
}
