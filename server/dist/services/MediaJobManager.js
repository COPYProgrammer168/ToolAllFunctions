import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { nanoid } from 'nanoid';
import { HardwareDetector } from './HardwareDetector.js';
import { sanitizeFilename } from '../utils/security.js';
import { STORAGE_ROOT } from '../utils/paths.js';
import { loadJobs, saveJob, deleteJobRow } from './JobDatabase.js';
import { buildStreamHeaders } from './StreamCredentials.js';
import { streamDownloadToFile } from '../utils/streamRange.js';
const BASE_MEDIA_DIR = path.join(STORAGE_ROOT, 'media-tools');
export class MediaJobManager {
    static jobs = new Map();
    static listeners = new Map();
    static activeJobsCount = 0;
    static maxConcurrentTranscodes = 2;
    static async init() {
        await fs.mkdir(BASE_MEDIA_DIR, { recursive: true });
        // Compute dynamic concurrency limit based on detected hardware
        try {
            const hw = await HardwareDetector.detect();
            this.maxConcurrentTranscodes = Math.max(1, Math.min(6, Math.floor(hw.cpuCores / 2)));
            console.log(`[MediaJobManager] Initialized with max concurrency: ${this.maxConcurrentTranscodes}`);
        }
        catch {
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
        }
        catch (err) {
            console.error('[MediaJobManager] Failed to restore jobs from SQLite:', err);
        }
        // Schedule cleanup every 30 minutes for expired jobs (older than 4 hours)
        setInterval(() => {
            this.cleanupExpiredJobs();
        }, 30 * 60 * 1000);
    }
    static getJob(id) {
        return this.jobs.get(id);
    }
    static listJobs() {
        return Array.from(this.jobs.values()).sort((a, b) => b.createdAt - a.createdAt);
    }
    static subscribe(jobId, res) {
        if (!this.listeners.has(jobId)) {
            this.listeners.set(jobId, new Set());
        }
        const jobListeners = this.listeners.get(jobId);
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
    static emitProgress(jobId, update) {
        const job = this.jobs.get(jobId);
        if (!job)
            return;
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
        }
        catch { }
        const listeners = this.listeners.get(jobId);
        if (listeners && listeners.size > 0) {
            const payload = `data: ${JSON.stringify(job.progress)}\n\n`;
            for (const res of listeners) {
                try {
                    res.write(payload);
                }
                catch {
                    listeners.delete(res);
                }
            }
        }
    }
    /**
     * Creates a dedicated directory structure for a new job
     */
    static async createJobRecord(title, filename, type, format, sourceUrl, sourceFormat) {
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
        const record = {
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
        }
        catch { }
        return record;
    }
    /**
     * Resumable streaming download worker supporting HTTP Range requests.
     *
     * YouTube's `googlevideo` CDN refuses an open-ended `Range: bytes=0-` (and any
     * window wider than ~2 MB on audio-only streams) with 403, so the worker pulls
     * the file in bounded chunks — see `streamDownloadToFile`. That is also what
     * makes resuming from a partial file work: each request resumes exactly at the
     * last byte already on disk.
     */
    static async startResumableDownload(jobId, remoteUrl) {
        const job = this.jobs.get(jobId);
        if (!job)
            throw new Error(`Job ${jobId} not found.`);
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
        }
        catch { }
        const reqHeaders = buildStreamHeaders(remoteUrl);
        let lastEmitAt = Date.now();
        let lastEmitBytes = existingBytes;
        try {
            const result = await streamDownloadToFile(remoteUrl, job.sourcePath, {
                headers: reqHeaders,
                startByte: existingBytes,
                signal: abortController.signal,
                onProgress: (receivedBytes, totalBytes) => {
                    const now = Date.now();
                    const elapsed = (now - lastEmitAt) / 1000;
                    if (elapsed < 0.5 && receivedBytes < totalBytes)
                        return;
                    const speed = elapsed > 0 ? (receivedBytes - lastEmitBytes) / elapsed : 0;
                    const percent = totalBytes > 0 ? Math.min(99, Math.round((receivedBytes / totalBytes) * 100)) : 50;
                    const remainingSec = totalBytes > 0 && speed > 0 ? Math.round((totalBytes - receivedBytes) / speed) : 0;
                    this.emitProgress(jobId, {
                        percent,
                        downloadedBytes: receivedBytes,
                        totalBytes,
                        speedBytesPerSec: speed,
                        timeRemainingSec: remainingSec,
                        stageName: `Downloading (${(receivedBytes / (1024 * 1024)).toFixed(1)} / ${(totalBytes / (1024 * 1024)).toFixed(1)} MB)`,
                    });
                    lastEmitAt = now;
                    lastEmitBytes = receivedBytes;
                },
            });
            job.downloadMeta = {
                remoteUrl,
                supportsRange: result.supportsRange,
                downloadedBytes: result.bytes,
                totalBytes: result.totalBytes || result.bytes,
            };
            this.emitProgress(jobId, {
                percent: 100,
                downloadedBytes: result.bytes,
                totalBytes: result.bytes,
                stageName: 'Download complete',
            });
            return job.sourcePath;
        }
        catch (err) {
            // The shared writer closes the file handle itself on every path.
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
    static pauseJob(jobId) {
        const job = this.jobs.get(jobId);
        if (!job || !job.abortController)
            return false;
        job.abortController.abort();
        this.emitProgress(jobId, { status: 'PAUSED', stageName: 'Paused' });
        return true;
    }
    /**
     * Cancels a job and removes temporary working directories
     */
    static async cancelJob(jobId) {
        const job = this.jobs.get(jobId);
        if (!job)
            return false;
        if (job.abortController) {
            try {
                job.abortController.abort();
            }
            catch { }
        }
        this.emitProgress(jobId, { status: 'CANCELLED', stageName: 'Cancelled by user.' });
        await this.cleanupWorkingFiles(job);
        return true;
    }
    /**
     * Deletes a job record and cleans its files
     */
    static async deleteJob(jobId) {
        const job = this.jobs.get(jobId);
        if (!job)
            return false;
        if (job.abortController) {
            try {
                job.abortController.abort();
            }
            catch { }
        }
        try {
            await fs.rm(job.jobDir, { recursive: true, force: true });
        }
        catch { }
        this.jobs.delete(jobId);
        this.listeners.delete(jobId);
        try {
            deleteJobRow(jobId);
        }
        catch { }
        return true;
    }
    /**
     * Cleans temporary working files while retaining final output for download
     */
    static async cleanupWorkingFiles(job) {
        try {
            const workingDir = path.join(job.jobDir, 'working');
            await fs.rm(workingDir, { recursive: true, force: true });
        }
        catch { }
    }
    /**
     * Cleans jobs older than 4 hours
     */
    static async cleanupExpiredJobs() {
        const threshold = Date.now() - 4 * 60 * 60 * 1000;
        for (const [id, job] of this.jobs.entries()) {
            if (job.createdAt < threshold) {
                await this.deleteJob(id);
            }
        }
    }
}
