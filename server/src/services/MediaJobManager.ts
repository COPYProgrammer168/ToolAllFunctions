import path from 'node:path';
import fs from 'node:fs/promises';
import { createWriteStream, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Response } from 'express';
import { nanoid } from 'nanoid';
import { HardwareDetector } from './HardwareDetector.js';
import { sanitizeFilename } from '../utils/security.js';
import { STORAGE_ROOT } from '../utils/paths.js';
import { loadJobs, saveJob, deleteJobRow } from './JobDatabase.js';

const BASE_MEDIA_DIR = path.join(STORAGE_ROOT, 'media-tools');

export type MediaJobType = 'video' | 'audio' | 'image' | 'converter' | 'watermark' | 'outro';
export type MediaJobStatus =
  | 'QUEUED'
  | 'DOWNLOADING'
  | 'CONVERTING'
  | 'COMPLETED'
  | 'PAUSED'
  | 'FAILED'
  | 'CANCELLED';

export interface MediaJobProgress {
  status: MediaJobStatus;
  percent: number;
  downloadedBytes: number;
  totalBytes: number;
  speedBytesPerSec: number;
  speedFormatted: string; // e.g. "4.8 MB/s"
  timeRemainingSec: number;
  stageName: string;
  error?: string;
  technicalError?: string;
}

export interface MediaJobRecord {
  id: string;
  title: string;
  filename: string;
  type: MediaJobType;
  sourceUrl?: string;
  jobDir: string;
  sourcePath: string;
  outputPath: string;
  format: string;
  progress: MediaJobProgress;
  createdAt: number;
  completedAt?: number;
  // Resumable download tracking
  downloadMeta?: {
    remoteUrl: string;
    etag?: string;
    lastModified?: string;
    supportsRange: boolean;
    downloadedBytes: number;
    totalBytes: number;
  };
  abortController?: AbortController;
}

export class MediaJobManager {
  private static jobs = new Map<string, MediaJobRecord>();
  private static listeners = new Map<string, Set<Response>>();
  private static activeJobsCount = 0;
  private static maxConcurrentTranscodes = 2;

  public static async init() {
    await fs.mkdir(BASE_MEDIA_DIR, { recursive: true });

    // Compute dynamic concurrency limit based on detected hardware
    try {
      const hw = await HardwareDetector.detect();
      this.maxConcurrentTranscodes = Math.max(1, Math.min(6, Math.floor(hw.cpuCores / 2)));
      console.log(`[MediaJobManager] Initialized with max concurrency: ${this.maxConcurrentTranscodes}`);
    } catch {
      this.maxConcurrentTranscodes = 2;
    }

    // Restore persisted jobs from SQLite; jobs that were mid-flight when the
    // server stopped are marked failed so the UI reflects reality.
    try {
      const persisted = loadJobs();
      for (const job of persisted) {
        if (['DOWNLOADING', 'CONVERTING', 'QUEUED'].includes(job.progress.status)) {
          job.progress = {
            ...job.progress,
            status: 'FAILED',
            stageName: 'Interrupted by server restart',
            error: 'Interrupted by server restart',
          };
          saveJob(job);
        }
        this.jobs.set(job.id, job);
      }
      if (persisted.length > 0) {
        console.log(`[MediaJobManager] Restored ${persisted.length} jobs from SQLite.`);
      }
    } catch (err) {
      console.error('[MediaJobManager] Failed to restore jobs from SQLite:', err);
    }

    // Schedule cleanup every 30 minutes for expired jobs (older than 4 hours)
    setInterval(() => {
      this.cleanupExpiredJobs();
    }, 30 * 60 * 1000);
  }

  public static getJob(id: string): MediaJobRecord | undefined {
    return this.jobs.get(id);
  }

  public static listJobs(): MediaJobRecord[] {
    return Array.from(this.jobs.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  public static subscribe(jobId: string, res: Response): () => void {
    if (!this.listeners.has(jobId)) {
      this.listeners.set(jobId, new Set());
    }
    const jobListeners = this.listeners.get(jobId)!;
    jobListeners.add(res);

    // Send immediate state
    const job = this.jobs.get(jobId);
    if (job) {
      res.write(`data: ${JSON.stringify(job.progress)}\n\n`);
    }

    const cleanup = () => {
      jobListeners.delete(res);
      if (jobListeners.size === 0) {
        this.listeners.delete(jobId);
      }
    };

    res.on('close', cleanup);
    return cleanup;
  }

  public static emitProgress(jobId: string, update: Partial<MediaJobProgress>) {
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.progress = { ...job.progress, ...update };

    // Format speed string
    if (update.speedBytesPerSec !== undefined) {
      const mbps = (update.speedBytesPerSec / (1024 * 1024)).toFixed(1);
      job.progress.speedFormatted = `${mbps} MB/s`;
    }

    if (update.status === 'COMPLETED' || update.status === 'FAILED' || update.status === 'CANCELLED') {
      job.completedAt = Date.now();
    }

    try {
      saveJob(job);
    } catch {}

    const listeners = this.listeners.get(jobId);
    if (listeners && listeners.size > 0) {
      const payload = `data: ${JSON.stringify(job.progress)}\n\n`;
      for (const res of listeners) {
        try {
          res.write(payload);
        } catch {
          listeners.delete(res);
        }
      }
    }
  }

  /**
   * Creates a dedicated directory structure for a new job
   */
  public static async createJobRecord(
    title: string,
    filename: string,
    type: MediaJobType,
    format: string,
    sourceUrl?: string,
    sourceFormat?: string
  ): Promise<MediaJobRecord> {
    const id = nanoid(10);
    const safeTitle = sanitizeFilename(title);
    const safeExt = format.startsWith('.') ? format : `.${format}`;
    const safeFilename = `${safeTitle}_${id.slice(0, 4)}${safeExt}`;

    const jobDir = path.join(BASE_MEDIA_DIR, id);
    const sourceDir = path.join(jobDir, 'source');
    const workingDir = path.join(jobDir, 'working');
    const outputDir = path.join(jobDir, 'output');
    const metadataDir = path.join(jobDir, 'metadata');
    const logsDir = path.join(jobDir, 'logs');

    await fs.mkdir(sourceDir, { recursive: true });
    await fs.mkdir(workingDir, { recursive: true });
    await fs.mkdir(outputDir, { recursive: true });
    await fs.mkdir(metadataDir, { recursive: true });
    await fs.mkdir(logsDir, { recursive: true });

    // Source file extension should match the ACTUAL source media type, not the output format.
    // For example, when extracting audio from a video, source is .mp4 but output is .mp3
    const srcExt = sourceFormat
      ? (sourceFormat.startsWith('.') ? sourceFormat : `.${sourceFormat}`)
      : safeExt;
    const sourcePath = path.join(sourceDir, `source${srcExt}`);
    const outputPath = path.join(outputDir, safeFilename);

    const record: MediaJobRecord = {
      id,
      title,
      filename: safeFilename,
      type,
      sourceUrl,
      jobDir,
      sourcePath,
      outputPath,
      format,
      progress: {
        status: 'QUEUED',
        percent: 0,
        downloadedBytes: 0,
        totalBytes: 0,
        speedBytesPerSec: 0,
        speedFormatted: '0 MB/s',
        timeRemainingSec: 0,
        stageName: 'Job initialized',
      },
      createdAt: Date.now(),
    };

    this.jobs.set(id, record);
    try {
      saveJob(record);
    } catch {}
    return record;
  }

  /**
   * Resumable streaming download worker supporting HTTP Range requests
   */
  public static async startResumableDownload(jobId: string, remoteUrl: string): Promise<string> {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Job ${jobId} not found.`);

    const abortController = new AbortController();
    job.abortController = abortController;

    this.emitProgress(jobId, { status: 'DOWNLOADING', stageName: 'Initiating connection...' });

    // Check existing downloaded file length for resumption
    let existingBytes = 0;
    try {
      if (existsSync(job.sourcePath)) {
        const stats = await fs.stat(job.sourcePath);
        existingBytes = stats.size;
      }
    } catch {}

    const reqHeaders: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };

    // TikTok CDN rejects requests without a TikTok referer
    if (/tiktok|tikcdn/i.test(remoteUrl)) {
      reqHeaders['Referer'] = 'https://www.tiktok.com/';
      reqHeaders['Origin'] = 'https://www.tiktok.com';
    }

    if (existingBytes > 0) {
      reqHeaders['Range'] = `bytes=${existingBytes}-`;
    }

    const response = await fetch(remoteUrl, {
      headers: reqHeaders,
      signal: abortController.signal,
    });

    if (!response.ok && response.status !== 206) {
      throw new Error(`Remote server responded with HTTP ${response.status}: ${response.statusText}`);
    }

    const isPartial = response.status === 206;
    const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
    const totalBytes = isPartial ? existingBytes + contentLength : (contentLength || 0);

    job.downloadMeta = {
      remoteUrl,
      etag: response.headers.get('etag') || undefined,
      lastModified: response.headers.get('last-modified') || undefined,
      supportsRange: response.headers.get('accept-ranges') === 'bytes' || isPartial,
      downloadedBytes: isPartial ? existingBytes : 0,
      totalBytes,
    };

    const fileStream = createWriteStream(job.sourcePath, {
      flags: isPartial ? 'a' : 'w',
    });

    if (!response.body) {
      throw new Error('Response body is empty or null.');
    }

    const reader = response.body.getReader();
    let currentBytes = isPartial ? existingBytes : 0;
    let lastTime = Date.now();
    let lastBytes = currentBytes;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        fileStream.write(Buffer.from(value));
        currentBytes += value.length;

        const now = Date.now();
        const elapsed = (now - lastTime) / 1000;

        if (elapsed >= 0.5) {
          const speed = (currentBytes - lastBytes) / elapsed;
          const percent = totalBytes > 0 ? Math.min(99, Math.round((currentBytes / totalBytes) * 100)) : 50;
          const remainingSec = (totalBytes > 0 && speed > 0) ? Math.round((totalBytes - currentBytes) / speed) : 0;

          this.emitProgress(jobId, {
            percent,
            downloadedBytes: currentBytes,
            totalBytes,
            speedBytesPerSec: speed,
            timeRemainingSec: remainingSec,
            stageName: `Downloading (${(currentBytes / (1024 * 1024)).toFixed(1)} / ${(totalBytes / (1024 * 1024)).toFixed(1)} MB)`,
          });

          lastTime = now;
          lastBytes = currentBytes;
        }
      }

      await new Promise<void>((resolve, reject) => {
        fileStream.end((err?: Error | null) => {
          if (err) reject(err);
          else resolve();
        });
      });

      this.emitProgress(jobId, {
        percent: 100,
        downloadedBytes: currentBytes,
        totalBytes: currentBytes,
        stageName: 'Download complete',
      });

      return job.sourcePath;
    } catch (err: any) {
      fileStream.close();
      if (err.name === 'AbortError') {
        this.emitProgress(jobId, { status: 'PAUSED', stageName: 'Download paused by user.' });
        throw err;
      }
      this.emitProgress(jobId, { status: 'FAILED', error: err.message });
      throw err;
    }
  }

  /**
   * Pauses an active download
   */
  public static pauseJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job || !job.abortController) return false;
    job.abortController.abort();
    this.emitProgress(jobId, { status: 'PAUSED', stageName: 'Paused' });
    return true;
  }

  /**
   * Cancels a job and removes temporary working directories
   */
  public static async cancelJob(jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    if (job.abortController) {
      try {
        job.abortController.abort();
      } catch {}
    }

    this.emitProgress(jobId, { status: 'CANCELLED', stageName: 'Cancelled by user.' });
    await this.cleanupWorkingFiles(job);
    return true;
  }

  /**
   * Deletes a job record and cleans its files
   */
  public static async deleteJob(jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    if (job.abortController) {
      try {
        job.abortController.abort();
      } catch {}
    }

    try {
      await fs.rm(job.jobDir, { recursive: true, force: true });
    } catch {}

    this.jobs.delete(jobId);
    this.listeners.delete(jobId);
    try {
      deleteJobRow(jobId);
    } catch {}
    return true;
  }

  /**
   * Cleans temporary working files while retaining final output for download
   */
  public static async cleanupWorkingFiles(job: MediaJobRecord): Promise<void> {
    try {
      const workingDir = path.join(job.jobDir, 'working');
      await fs.rm(workingDir, { recursive: true, force: true });
    } catch {}
  }

  /**
   * Cleans jobs older than 4 hours
   */
  private static async cleanupExpiredJobs() {
    const threshold = Date.now() - 4 * 60 * 60 * 1000;
    for (const [id, job] of this.jobs.entries()) {
      if (job.createdAt < threshold) {
        await this.deleteJob(id);
      }
    }
  }
}
