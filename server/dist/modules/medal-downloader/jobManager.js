import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { timingSafeEqual } from 'node:crypto';
import { nanoid } from 'nanoid';
import { MEDAL_CONFIG, MEDAL_MAX_FILE_SIZE_BYTES, MEDAL_UNAVAILABLE_MESSAGE } from './config.js';
import { MedalAuthorizationRequiredError, MedalError, MedalFileTooLargeError, MedalQueueFullError, MedalRateLimitedError, MedalUpstreamError, } from './errors.js';
import { assertPathInside, sanitizeFilename } from '../../utils/security.js';
import { parseMedalClipUrl } from './url.js';
import { probeVideoFile } from './videoInfo.js';
const TERMINAL_STATES = new Set([
    'done',
    'failed',
    'cancelled',
    'download_not_available',
]);
function tokenMatches(expected, supplied) {
    if (!supplied || expected.length !== supplied.length)
        return false;
    try {
        return timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
    }
    catch {
        return false;
    }
}
function safeOutputName(title, clipId) {
    const base = sanitizeFilename(title || 'medal-clip')
        .replace(/\.+$/g, '')
        .slice(0, 80)
        .replace(/^_+|_+$/g, '') || 'medal-clip';
    return `${base}-${clipId}.mp4`;
}
function isTerminal(state) {
    return TERMINAL_STATES.has(state);
}
export class MedalJobManager {
    provider;
    config;
    probeFile;
    now;
    jobs = new Map();
    activeWorkers = new Map();
    queue = [];
    activeCount = 0;
    cleanupInterval = null;
    constructor(provider, options = {}) {
        this.provider = provider;
        this.config = { ...MEDAL_CONFIG, ...(options.config || {}) };
        this.probeFile = options.probeFile || probeVideoFile;
        this.now = options.now || Date.now;
    }
    async init() {
        await fs.mkdir(this.config.tempDir, { recursive: true }).catch(() => { });
        this.sweepOldDirectories().catch(() => { });
        if (!this.cleanupInterval) {
            this.cleanupInterval = setInterval(() => {
                this.sweepExpiredJobs().catch(() => { });
            }, 5 * 60 * 1000);
            this.cleanupInterval.unref();
        }
    }
    async stop() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        for (const worker of this.activeWorkers.values())
            worker.controller.abort();
        this.activeWorkers.clear();
        this.queue.length = 0;
    }
    createJob(clientIp, rawUrl, authorized) {
        if (!this.config.enabled) {
            throw new MedalError('The Medal.tv downloader is disabled on this server.', {
                status: 503,
                code: 'disabled',
            });
        }
        if (authorized !== true) {
            throw new MedalAuthorizationRequiredError();
        }
        const ref = parseMedalClipUrl(rawUrl);
        const pending = [...this.jobs.values()].filter((job) => job.state === 'queued' || job.state === 'inspecting' || job.state === 'downloading').length;
        if (pending >= this.config.maxQueueSize) {
            throw new MedalQueueFullError();
        }
        // A hard cap prevents an abusive client from growing the in-memory job map
        // indefinitely even when jobs complete quickly.
        if (this.jobs.size >= Math.max(50, this.config.maxQueueSize * 10)) {
            throw new MedalQueueFullError();
        }
        const now = this.now();
        const job = {
            jobId: nanoid(16),
            downloadToken: nanoid(32),
            clientIp,
            sourceUrl: ref.requestUrl,
            clipId: ref.clipId,
            state: 'queued',
            stage: 'Waiting in queue',
            createdAt: now,
            updatedAt: now,
            expiresAt: now + this.config.jobTtlMinutes * 60 * 1000,
            progressPercent: null,
            downloadedBytes: 0,
            totalBytes: 0,
            cancelled: false,
        };
        this.jobs.set(job.jobId, job);
        this.queue.push(job.jobId);
        this.processNextInQueue();
        return job;
    }
    getJob(jobId) {
        return this.jobs.get(jobId);
    }
    getAuthorizedJob(jobId, token) {
        const job = this.jobs.get(jobId);
        if (!job)
            return undefined;
        return tokenMatches(job.downloadToken, token) ? job : undefined;
    }
    async cancelJob(jobId) {
        const job = this.jobs.get(jobId);
        if (!job)
            return false;
        if (isTerminal(job.state))
            return false;
        job.cancelled = true;
        job.state = 'cancelled';
        job.stage = 'Cancelled';
        job.progressPercent = null;
        job.updatedAt = this.now();
        const queueIndex = this.queue.indexOf(jobId);
        if (queueIndex >= 0)
            this.queue.splice(queueIndex, 1);
        const worker = this.activeWorkers.get(jobId);
        if (worker) {
            worker.controller.abort();
        }
        else {
            await this.removeJobDirectory(job);
        }
        this.processNextInQueue();
        return true;
    }
    toPublicJob(job) {
        return {
            jobId: job.jobId,
            state: job.state,
            stage: job.stage,
            createdAt: new Date(job.createdAt).toISOString(),
            updatedAt: new Date(job.updatedAt).toISOString(),
            expiresAt: new Date(job.expiresAt).toISOString(),
            clip: job.clip,
            media: job.media,
            progress: {
                percent: job.progressPercent,
                downloadedBytes: job.downloadedBytes,
                totalBytes: job.totalBytes,
            },
            filename: job.filename,
            downloadUrl: job.state === 'done'
                ? `/api/tools/medal-downloader/jobs/${job.jobId}/download`
                : undefined,
            error: job.error,
            errorCode: job.errorCode,
            message: job.message,
        };
    }
    processNextInQueue() {
        while (this.activeCount < this.config.maxConcurrentJobs && this.queue.length > 0) {
            const jobId = this.queue.shift();
            if (!jobId)
                return;
            const job = this.jobs.get(jobId);
            if (!job || job.cancelled || job.state !== 'queued')
                continue;
            this.activeCount += 1;
            void this.runJob(job).finally(() => {
                this.activeCount = Math.max(0, this.activeCount - 1);
                this.processNextInQueue();
            });
        }
    }
    touch(job) {
        job.updatedAt = this.now();
    }
    setProgress(job) {
        job.progressPercent =
            job.totalBytes > 0
                ? Math.min(99, Math.max(0, Math.floor((job.downloadedBytes / job.totalBytes) * 100)))
                : null;
        this.touch(job);
    }
    async runJob(job) {
        const controller = new AbortController();
        this.activeWorkers.set(job.jobId, { controller });
        let idleTimer;
        let totalTimer;
        let abortReason = null;
        let jobDirectory = null;
        let tempFilePath = null;
        let completed = false;
        const idleMs = Math.max(5, this.config.downloadIdleTimeoutSeconds) * 1000;
        const totalMs = Math.max(30, this.config.downloadTimeoutSeconds) * 1000;
        const resetIdleTimer = () => {
            if (idleTimer)
                clearTimeout(idleTimer);
            idleTimer = setTimeout(() => {
                abortReason = 'idle';
                controller.abort();
            }, idleMs);
            idleTimer.unref?.();
        };
        try {
            job.state = 'inspecting';
            job.stage = 'Inspecting clip on Medal.tv';
            this.touch(job);
            const inspection = await this.provider.inspect(job.sourceUrl, controller.signal);
            job.clip = inspection.clip;
            this.touch(job);
            if (job.cancelled)
                return;
            if (!inspection.available || !inspection.media) {
                job.state = 'download_not_available';
                job.stage = 'Download not available';
                job.progressPercent = null;
                job.message = MEDAL_UNAVAILABLE_MESSAGE;
                job.errorCode = inspection.unavailableReason || 'no_public_original';
                this.touch(job);
                return;
            }
            job.state = 'downloading';
            job.stage = 'Downloading original MP4';
            job.totalBytes = inspection.media.sizeBytes || 0;
            job.downloadedBytes = 0;
            job.progressPercent = job.totalBytes > 0 ? 0 : null;
            this.touch(job);
            jobDirectory = path.join(this.config.tempDir, job.jobId);
            await fs.mkdir(jobDirectory, { recursive: true });
            assertPathInside(jobDirectory, this.config.tempDir);
            tempFilePath = path.join(jobDirectory, 'download.mp4');
            assertPathInside(tempFilePath, this.config.tempDir);
            totalTimer = setTimeout(() => {
                abortReason = 'timeout';
                controller.abort();
            }, totalMs);
            totalTimer.unref?.();
            resetIdleTimer();
            const { response, totalBytes } = await this.provider.openDownload(inspection.media, controller.signal);
            if (!response.body) {
                throw new MedalUpstreamError('Medal returned an empty video response.');
            }
            if (totalBytes && totalBytes > 0) {
                job.totalBytes = totalBytes;
                job.progressPercent = 0;
            }
            const reader = response.body.getReader();
            const writeStream = createWriteStream(tempFilePath, { flags: 'wx' });
            let writeError = null;
            writeStream.on('error', (err) => {
                writeError = err;
            });
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done)
                        break;
                    if (!value)
                        continue;
                    if (job.cancelled) {
                        throw new Error('cancelled');
                    }
                    job.downloadedBytes += value.byteLength;
                    if (job.downloadedBytes > MEDAL_MAX_FILE_SIZE_BYTES) {
                        throw new MedalFileTooLargeError();
                    }
                    const buffer = Buffer.from(value);
                    if (!writeStream.write(buffer)) {
                        await once(writeStream, 'drain');
                    }
                    if (writeError)
                        throw writeError;
                    resetIdleTimer();
                    this.setProgress(job);
                }
                await new Promise((resolve, reject) => {
                    writeStream.end((err) => (err ? reject(err) : resolve()));
                });
                if (writeError)
                    throw writeError;
            }
            catch (err) {
                writeStream.destroy();
                throw err;
            }
            finally {
                await reader.cancel().catch(() => { });
            }
            if (job.cancelled)
                return;
            if (job.downloadedBytes <= 0) {
                throw new MedalUpstreamError('Medal returned an empty video file.');
            }
            job.stage = 'Validating original video';
            this.touch(job);
            const stat = await fs.stat(tempFilePath);
            const media = await this.probeFile(tempFilePath, stat.size);
            job.filePath = tempFilePath;
            job.filename = safeOutputName(job.clip?.title || 'medal-clip', job.clipId);
            job.media = media;
            job.downloadedBytes = stat.size;
            job.totalBytes = stat.size;
            job.progressPercent = 100;
            job.state = 'done';
            job.stage = 'Ready for download';
            job.expiresAt = this.now() + this.config.jobTtlMinutes * 60 * 1000;
            this.touch(job);
            completed = true;
        }
        catch (err) {
            if (job.cancelled) {
                job.state = 'cancelled';
                job.stage = 'Cancelled';
                job.progressPercent = null;
                job.error = undefined;
                job.errorCode = undefined;
                job.message = undefined;
            }
            else if (abortReason === 'idle') {
                job.state = 'failed';
                job.stage = 'Download stalled';
                job.error = 'The Medal download stalled before it finished. Please try again.';
                job.errorCode = 'download_stalled';
            }
            else if (abortReason === 'timeout') {
                job.state = 'failed';
                job.stage = 'Download timed out';
                job.error = 'The Medal download took too long and was stopped. Please try again.';
                job.errorCode = 'download_timeout';
            }
            else if (err instanceof MedalRateLimitedError) {
                job.state = 'failed';
                job.stage = 'Medal rate limit';
                job.error = 'Medal is rate-limiting this server. Please wait a moment and try again.';
                job.errorCode = 'rate_limited';
            }
            else if (err instanceof MedalFileTooLargeError) {
                job.state = 'failed';
                job.stage = 'Clip too large';
                job.error = err.message;
                job.errorCode = 'file_too_large';
            }
            else if (err instanceof MedalError) {
                job.state = 'failed';
                job.stage = 'Download failed';
                job.error = err.message;
                job.errorCode = err.code;
            }
            else {
                job.state = 'failed';
                job.stage = 'Download failed';
                job.error = 'The download failed. Inspect the clip again and retry.';
                job.errorCode = 'download_failed';
            }
            if (job.state !== 'cancelled') {
                console.warn(`[medal-downloader] job ${job.jobId} ended ${job.errorCode || job.state}`);
            }
            this.touch(job);
        }
        finally {
            if (idleTimer)
                clearTimeout(idleTimer);
            if (totalTimer)
                clearTimeout(totalTimer);
            this.activeWorkers.delete(job.jobId);
            if (!completed && jobDirectory) {
                await this.removeJobDirectory(job);
            }
        }
    }
    async removeJobDirectory(job) {
        job.filePath = undefined;
        const jobDirectory = path.join(this.config.tempDir, job.jobId);
        try {
            assertPathInside(jobDirectory, this.config.tempDir);
            await fs.rm(jobDirectory, { recursive: true, force: true });
        }
        catch {
            // Best effort; the startup/TTL sweep retries.
        }
    }
    async sweepExpiredJobs() {
        const now = this.now();
        const ttlMs = this.config.jobTtlMinutes * 60 * 1000;
        for (const [jobId, job] of this.jobs) {
            if (now - job.updatedAt <= ttlMs)
                continue;
            if (job.state === 'inspecting' || job.state === 'downloading' || this.activeWorkers.has(jobId)) {
                continue;
            }
            await this.removeJobDirectory(job);
            this.jobs.delete(jobId);
        }
    }
    async sweepOldDirectories() {
        let entries;
        try {
            entries = await fs.readdir(this.config.tempDir, { withFileTypes: true });
        }
        catch {
            return;
        }
        const now = this.now();
        const maxAgeMs = Math.max(2 * 60 * 60 * 1000, this.config.jobTtlMinutes * 2 * 60 * 1000);
        for (const entry of entries) {
            if (!entry.isDirectory())
                continue;
            const fullPath = path.join(this.config.tempDir, entry.name);
            try {
                assertPathInside(fullPath, this.config.tempDir);
                const stat = await fs.stat(fullPath);
                if (now - stat.mtimeMs > maxAgeMs) {
                    await fs.rm(fullPath, { recursive: true, force: true });
                }
            }
            catch {
                // Skip entries that are being written or cannot be read.
            }
        }
    }
}
