import { Router } from 'express';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import { MEDAL_CONFIG } from './config.js';
import { MedalError } from './errors.js';
import { medalJobManager, medalProvider } from './service.js';
import { toPublicInspection } from './provider.js';
import { rateLimit } from '../../utils/rateLimiter.js';
function clientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
        return forwarded.split(',')[0].trim();
    }
    return req.socket.remoteAddress || req.ip || 'unknown';
}
function requestToken(req) {
    const queryToken = req.query.token;
    if (typeof queryToken === 'string')
        return queryToken;
    const headerToken = req.headers['x-download-token'];
    return typeof headerToken === 'string' ? headerToken : undefined;
}
function respondError(res, err) {
    if (err instanceof MedalError) {
        if (err.status === 429) {
            const retryAfter = err.retryAfterSec || 60;
            res.setHeader('Retry-After', String(retryAfter));
            res.status(429).json({
                error: 'rate_limited',
                code: err.code,
                message: err.message,
                retry_after: retryAfter,
            });
            return;
        }
        res.status(err.status).json({ error: err.code, message: err.message });
        return;
    }
    console.error('[medal-downloader] unexpected error:', err instanceof Error ? err.name : 'unknown');
    res.status(500).json({
        error: 'internal_error',
        message: 'The Medal download request could not be completed.',
    });
}
export const medalDownloaderRouter = Router();
// POST /inspect — validate a public Medal clip URL and retrieve only metadata
// that Medal itself exposes. The signed media URL stays server-side.
medalDownloaderRouter.post('/inspect', rateLimit({
    windowMs: 60_000,
    max: MEDAL_CONFIG.inspectRateLimitPerMinute,
    label: 'medal/inspect',
}), async (req, res) => {
    if (!MEDAL_CONFIG.enabled) {
        res.status(503).json({
            error: 'disabled',
            message: 'The Medal.tv downloader is disabled on this server.',
        });
        return;
    }
    try {
        const inspection = await medalProvider.inspect(req.body?.url);
        res.json(toPublicInspection(inspection));
    }
    catch (err) {
        respondError(res, err);
    }
});
// POST /jobs — create a queued download job. The clip is re-inspected when the
// job starts so an expired/invalid signed URL is never reused.
medalDownloaderRouter.post('/jobs', rateLimit({
    windowMs: 60_000,
    max: MEDAL_CONFIG.jobRateLimitPerMinute,
    label: 'medal/jobs',
}), (req, res) => {
    if (!MEDAL_CONFIG.enabled) {
        res.status(503).json({
            error: 'disabled',
            message: 'The Medal.tv downloader is disabled on this server.',
        });
        return;
    }
    try {
        const job = medalJobManager.createJob(clientIp(req), req.body?.url, req.body?.authorized === true);
        res.status(202).json({
            jobId: job.jobId,
            downloadToken: job.downloadToken,
            state: job.state,
            createdAt: new Date(job.createdAt).toISOString(),
            expiresAt: new Date(job.expiresAt).toISOString(),
        });
    }
    catch (err) {
        respondError(res, err);
    }
});
// GET /jobs/:jobId — token-authorized status/progress.
medalDownloaderRouter.get('/jobs/:jobId', rateLimit({ windowMs: 60_000, max: 240, label: 'medal/status' }), (req, res) => {
    const job = medalJobManager.getAuthorizedJob(req.params.jobId, requestToken(req));
    if (!job) {
        const exists = Boolean(medalJobManager.getJob(req.params.jobId));
        res.status(exists ? 403 : 404).json({
            error: exists ? 'unauthorized' : 'job_not_found',
            message: exists
                ? 'This download job belongs to a different session.'
                : 'Download job not found or expired.',
        });
        return;
    }
    res.json(medalJobManager.toPublicJob(job));
});
// POST /jobs/:jobId/cancel — abort inspection/download and delete partial data.
medalDownloaderRouter.post('/jobs/:jobId/cancel', rateLimit({ windowMs: 60_000, max: 30, label: 'medal/cancel' }), async (req, res) => {
    const job = medalJobManager.getAuthorizedJob(req.params.jobId, requestToken(req));
    if (!job) {
        const exists = Boolean(medalJobManager.getJob(req.params.jobId));
        res.status(exists ? 403 : 404).json({
            error: exists ? 'unauthorized' : 'job_not_found',
            message: exists
                ? 'This download job belongs to a different session.'
                : 'Download job not found or expired.',
        });
        return;
    }
    const cancelled = await medalJobManager.cancelJob(job.jobId);
    res.json({ success: cancelled, state: cancelled ? 'cancelled' : job.state });
});
// GET /jobs/:jobId/download — streams the validated original MP4. Access is
// token-only; the file never becomes a public static asset.
medalDownloaderRouter.get('/jobs/:jobId/download', rateLimit({ windowMs: 60_000, max: 20, label: 'medal/download' }), async (req, res) => {
    const job = medalJobManager.getAuthorizedJob(req.params.jobId, requestToken(req));
    if (!job) {
        const exists = Boolean(medalJobManager.getJob(req.params.jobId));
        res.status(exists ? 403 : 404).json({
            error: exists ? 'unauthorized' : 'job_not_found',
            message: exists
                ? 'This download job belongs to a different session.'
                : 'Download job not found or expired.',
        });
        return;
    }
    if (job.state === 'download_not_available') {
        res.status(409).json({
            error: 'download_not_available',
            message: job.message,
        });
        return;
    }
    if (job.state !== 'done' || !job.filePath) {
        res.status(409).json({
            error: 'not_ready',
            message: 'This Medal download is not ready yet.',
        });
        return;
    }
    const stat = await fs.stat(job.filePath).catch(() => null);
    if (!stat) {
        res.status(410).json({
            error: 'file_expired',
            message: 'The downloaded file expired or was removed. Inspect the clip and download it again.',
        });
        return;
    }
    const filename = job.filename || `medal-${job.clipId}.mp4`;
    const asciiName = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Length', String(stat.size));
    res.setHeader('Content-Disposition', `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Accept-Ranges', 'none');
    const stream = createReadStream(job.filePath);
    stream.on('error', (err) => {
        console.error('[medal-downloader] file stream failed:', err.message);
        if (!res.headersSent) {
            res.status(500).json({ error: 'stream_failed', message: 'Failed to read the downloaded file.' });
        }
        else {
            res.end();
        }
    });
    stream.pipe(res);
});
