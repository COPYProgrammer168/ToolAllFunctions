import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { nanoid } from 'nanoid';
import { VideoAnalyzer } from '../services/VideoAnalyzer.js';
import { OptimizationPlanner } from '../services/OptimizationPlanner.js';
import { JobManager } from '../services/JobManager.js';
import { HardwareDetector } from '../services/HardwareDetector.js';
import { MediaSourceResolver } from '../services/MediaSourceResolver.js';
import { MediaJobManager } from '../services/MediaJobManager.js';
import { AudioExtractor } from '../services/AudioExtractor.js';
import { AudioConverter } from '../services/AudioConverter.js';
import { OutroDetector } from '../services/OutroDetector.js';
import { WatermarkEditor } from '../services/WatermarkEditor.js';
import { ImageProcessor } from '../services/ImageProcessor.js';
import { sanitizeFilename } from '../utils/security.js';
import { downloadToFile } from '../utils/httpDownload.js';
import { buildStreamHeaders, getStreamCredentials } from '../services/StreamCredentials.js';
import { ffprobeBin, ffmpegBin } from '../utils/binaries.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOAD_DIR = path.resolve(__dirname, '../../storage/uploads');
const storage = multer.diskStorage({
    destination: async (_req, _file, cb) => {
        await fs.mkdir(UPLOAD_DIR, { recursive: true });
        cb(null, UPLOAD_DIR);
    },
    filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase() || '.mp4';
        const safeName = `${Date.now()}_${nanoid(6)}${ext}`;
        cb(null, safeName);
    },
});
const upload = multer({
    storage,
    limits: {
        fileSize: 2 * 1024 * 1024 * 1024, // 2 GB max
    },
    fileFilter: (_req, file, cb) => {
        const allowed = ['.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowed.includes(ext) || file.mimetype.startsWith('video/')) {
            cb(null, true);
        }
        else {
            cb(new Error(`Unsupported file type: ${ext}. Supported formats: MP4, MOV, MKV, WebM, AVI.`));
        }
    },
});
export const apiRouter = Router();
/**
 * Translate an error into an API response. Errors that carry an HTTP status
 * (e.g. `RateLimitedError` → 503) keep it; everything else is a 400.
 * `technicalDetails` (a stack trace) is only included outside production.
 */
function respondApiError(res, err, fallbackStatus = 400) {
    const status = Number.isInteger(err?.status) ? err.status : fallbackStatus;
    const body = {
        error: err?.message || 'Request failed.',
    };
    if (err?.retryAfterSec)
        body.retryAfterSec = err.retryAfterSec;
    if (process.env.NODE_ENV !== 'production' && err?.stack)
        body.technicalDetails = err.stack;
    res.status(status).json(body);
}
// 1. Hardware status
apiRouter.get('/system/hardware', async (_req, res) => {
    try {
        const hw = await HardwareDetector.detect();
        res.json(hw);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// Demo video generator for instant testing
apiRouter.post('/video/demo', async (_req, res) => {
    try {
        await fs.mkdir(UPLOAD_DIR, { recursive: true });
        const demoPath = path.join(UPLOAD_DIR, `demo_${Date.now()}.mp4`);
        const genCmd = `ffmpeg -y -f lavfi -i testsrc=duration=4:size=1280x720:rate=30 -f lavfi -i sine=frequency=440:duration=4 -c:v libx264 -pix_fmt yuv420p -b:v 3000k -c:a aac -b:a 128k "${demoPath}"`;
        const { exec } = await import('node:child_process');
        const { promisify } = await import('node:util');
        const execAsync = promisify(exec);
        await execAsync(genCmd);
        const report = await VideoAnalyzer.analyze(demoPath, 'gameplay_action_720p30.mp4');
        const stats = await fs.stat(demoPath);
        res.json({
            report,
            tempPath: demoPath,
            originalName: 'gameplay_action_720p30.mp4',
            sizeBytes: stats.size,
        });
    }
    catch (err) {
        console.error('Demo generation error:', err);
        res.status(500).json({ error: 'Failed to generate demo clip', technicalError: err.message });
    }
});
// 2. Video Analysis
apiRouter.post('/video/analyze', upload.single('video'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No video file provided.' });
        }
        const report = await VideoAnalyzer.analyze(req.file.path, req.file.originalname);
        res.json({
            report,
            tempPath: req.file.path,
            originalName: req.file.originalname,
            sizeBytes: req.file.size,
        });
    }
    catch (err) {
        if (req.file) {
            try {
                await fs.unlink(req.file.path);
            }
            catch { }
        }
        console.error('Analyze error:', err);
        res.status(400).json({
            error: 'Failed to analyze video file. The file may be corrupt or encoded with an unsupported format.',
            technicalError: err.message,
        });
    }
});
// 3. Plan preview calculation (without uploading again)
apiRouter.post('/video/plan', async (req, res) => {
    try {
        const { metadata, userConfig } = req.body;
        if (!metadata) {
            return res.status(400).json({ error: 'Metadata is required' });
        }
        const hw = await HardwareDetector.detect();
        const plan = OptimizationPlanner.plan(metadata, userConfig || {}, hw.hasNvidiaGpu);
        res.json(plan);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// 4. Create and start optimization job
apiRouter.post('/jobs', upload.single('video'), async (req, res) => {
    try {
        let filePath;
        let originalName;
        if (req.file) {
            filePath = req.file.path;
            originalName = req.file.originalname;
        }
        else if (req.body.tempPath) {
            filePath = req.body.tempPath;
            originalName = req.body.originalName || 'video.mp4';
        }
        else {
            return res.status(400).json({ error: 'No video file or tempPath provided' });
        }
        let userConfig = {};
        if (req.body.config) {
            try {
                userConfig = typeof req.body.config === 'string' ? JSON.parse(req.body.config) : req.body.config;
            }
            catch { }
        }
        const job = await JobManager.createJob(filePath, originalName, userConfig);
        // Start processing asynchronously
        JobManager.startJob(job.id);
        res.json({
            jobId: job.id,
            state: job.progress.state,
            plan: job.plan,
        });
    }
    catch (err) {
        console.error('Create job error:', err);
        res.status(500).json({
            error: 'Failed to create optimization job',
            technicalError: err.message,
        });
    }
});
// 5. Job progress via Server-Sent Events (SSE)
apiRouter.get('/jobs/:id/events', (req, res) => {
    const { id } = req.params;
    const job = JobManager.getJob(id);
    if (!job) {
        return res.status(404).json({ error: 'Job not found' });
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    JobManager.subscribe(id, res);
});
// 6. Get job status
apiRouter.get('/jobs/:id', (req, res) => {
    const { id } = req.params;
    const job = JobManager.getJob(id);
    if (!job) {
        return res.status(404).json({ error: 'Job not found' });
    }
    res.json({
        id: job.id,
        progress: job.progress,
        meta: job.meta,
        plan: job.plan,
    });
});
// 7. Cancel job
apiRouter.post('/jobs/:id/cancel', async (req, res) => {
    const { id } = req.params;
    const success = await JobManager.cancelJob(id);
    res.json({ success });
});
// 8. Stream source video for comparison player
apiRouter.get('/jobs/:id/source', async (req, res) => {
    const { id } = req.params;
    const job = JobManager.getJob(id);
    if (!job) {
        return res.status(404).send('Job not found');
    }
    res.sendFile(job.inputPath);
});
// 9. Stream output video for comparison player
apiRouter.get('/jobs/:id/output', async (req, res) => {
    const { id } = req.params;
    const job = JobManager.getJob(id);
    if (!job) {
        return res.status(404).send('Job not found');
    }
    try {
        await fs.access(job.outputPath);
        res.sendFile(job.outputPath);
    }
    catch {
        res.status(404).send('Output video not ready yet');
    }
});
// 10. Download output video
apiRouter.get('/jobs/:id/download', async (req, res) => {
    const { id } = req.params;
    const job = JobManager.getJob(id);
    if (!job) {
        return res.status(404).send('Job not found');
    }
    try {
        await fs.access(job.outputPath);
        const downloadName = `optimized_${job.meta.originalName.replace(/\.[^/.]+$/, '')}.mp4`;
        res.download(job.outputPath, downloadName);
    }
    catch {
        res.status(404).send('Output video not found');
    }
});
// 11. Delete job
apiRouter.delete('/jobs/:id', async (req, res) => {
    const { id } = req.params;
    const deleted = await JobManager.deleteJob(id);
    res.json({ success: deleted });
});
// ============================================================================
// MEDIA TOOLKIT MODULE ENDPOINTS
// ============================================================================
// A. Universal URL Media Analyzer
apiRouter.post('/media/analyze', async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) {
            return res.status(400).json({ error: 'A media URL is required.' });
        }
        const result = await MediaSourceResolver.resolveAndAnalyze(url);
        res.json(result);
    }
    catch (err) {
        console.error('Media analyze error:', err?.message || err);
        // 503 for a rate-limited platform, 400 for anything else (bad URL, DRM…).
        respondApiError(res, err, 400);
    }
});
// B2. Streaming proxy for platform CDN URLs that require special headers
// (notably TikTok) during <video> preview playback. Supports HTTP Range.
apiRouter.get('/media/stream', async (req, res) => {
    try {
        const target = req.query.url;
        if (!target || !/^https?:\/\//i.test(target)) {
            return res.status(400).json({ error: 'A valid url is required.' });
        }
        const headers = buildStreamHeaders(target);
        if (typeof req.headers.range === 'string') {
            headers['Range'] = req.headers.range;
        }
        else if (/googlevideo\.com/i.test(target)) {
            // Google's audio/video endpoints answer a Range-less request with a 200
            // + Content-Length and then never stream the body; an open-ended Range
            // makes them deliver the full resource as a 206.
            headers['Range'] = 'bytes=0-';
        }
        const upstream = await fetch(target, { headers });
        if (!upstream.ok && upstream.status !== 206) {
            const hadCreds = !!getStreamCredentials(target);
            console.warn(`[media/stream] upstream ${upstream.status} for ${target.slice(0, 140)} (cached credentials: ${hadCreds ? 'yes' : 'no'}, cookie: ${!!headers.Cookie})`);
            return res.status(upstream.status).send(`Upstream returned ${upstream.status}`);
        }
        res.status(upstream.status);
        const contentType = upstream.headers.get('content-type');
        if (contentType)
            res.setHeader('Content-Type', contentType);
        const len = upstream.headers.get('content-length');
        if (len)
            res.setHeader('Content-Length', len);
        const cr = upstream.headers.get('content-range');
        if (cr)
            res.setHeader('Content-Range', cr);
        res.setHeader('Accept-Ranges', 'bytes');
        const body = upstream.body;
        if (!body)
            return res.status(502).send('No upstream body');
        const stream = Readable.fromWeb(body);
        res.on('close', () => stream.destroy());
        stream.pipe(res);
        return;
    }
    catch (err) {
        res.status(500).json({ error: err.message || 'Proxy failed' });
    }
});
// B1. Live-mux an adaptive video URL with its audio counterpart for in-browser
// preview playback when the provider only has separate video/audio streams.
apiRouter.get('/media/merge-preview', async (req, res) => {
    const v = req.query.v;
    const a = req.query.a;
    if (!v || !a) {
        return res.status(400).json({ error: 'Both v and a query params are required.' });
    }
    try {
        const { exec: execCb } = await import('node:child_process');
        const { promisify } = await import('node:util');
        const execAsync = promisify(execCb);
        const tmpDir = path.resolve(__dirname, '../../storage/tmp');
        await fs.mkdir(tmpDir, { recursive: true });
        const id = `${Date.now()}_${nanoid(6)}`;
        const videoTmp = path.join(tmpDir, `pv_${id}.bin`);
        const audioTmp = path.join(tmpDir, `pa_${id}.bin`);
        const merged = path.join(tmpDir, `pm_${id}.mp4`);
        await Promise.all([downloadToFile(v, videoTmp), downloadToFile(a, audioTmp)]);
        await execAsync(`ffmpeg -y -i "${videoTmp}" -i "${audioTmp}" -c:v copy -c:a aac -movflags +faststart "${merged}"`);
        await fs.unlink(videoTmp).catch(() => { });
        await fs.unlink(audioTmp).catch(() => { });
        res.setHeader('Content-Type', 'video/mp4');
        const stream = createReadStream(merged);
        stream.pipe(res);
        stream.on('close', () => fs.unlink(merged).catch(() => { }));
    }
    catch (err) {
        res.status(500).json({ error: err.message || 'Merge failed' });
    }
});
// B0. Probe a remote stream's real audio bitrate via ffprobe
apiRouter.post('/media/probe-bitrate', async (req, res) => {
    try {
        const { url, sourceUrl } = req.body;
        let streamUrl = url;
        if (!streamUrl && sourceUrl) {
            const resolved = await MediaSourceResolver.resolveAndAnalyze(sourceUrl);
            streamUrl =
                resolved.rawSourceUrl ||
                    resolved.availableFormats.find((f) => f.directDownloadUrl)?.directDownloadUrl;
        }
        if (!streamUrl) {
            return res.status(400).json({ error: 'No stream URL provided.' });
        }
        const { execFile } = await import('node:child_process');
        const { promisify } = await import('node:util');
        const execFileAsync = promisify(execFile);
        // googlevideo / TikTok CDNs reject bare ffprobe requests, so forward the
        // same headers the download path uses.
        const probeHeaders = buildStreamHeaders(streamUrl);
        const userAgent = probeHeaders['User-Agent'];
        delete probeHeaders['User-Agent'];
        const headerArgs = [];
        if (userAgent)
            headerArgs.push('-user_agent', userAgent);
        const headerBlock = Object.entries(probeHeaders)
            .map(([k, v]) => `${k}: ${v}`)
            .join('\r\n');
        if (headerBlock)
            headerArgs.push('-headers', `${headerBlock}\r\n`);
        const { stdout } = await execFileAsync(ffprobeBin(), ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', ...headerArgs, streamUrl], { maxBuffer: 10 * 1024 * 1024 });
        const probe = JSON.parse(stdout);
        const audioStream = (probe.streams || []).find((s) => s.codec_type === 'audio');
        const bitRate = (audioStream?.bit_rate ? parseInt(audioStream.bit_rate, 10) : 0) ||
            (probe.format?.bit_rate ? parseInt(probe.format.bit_rate, 10) : 0);
        if (!bitRate) {
            return res.status(422).json({ error: 'Could not determine stream bitrate.' });
        }
        res.json({ bitrateKbps: Math.round(bitRate / 1000) });
    }
    catch (err) {
        res.status(400).json({ error: err.message || 'Probe failed.' });
    }
});
// B. Start Media Download / Conversion Job
apiRouter.post('/media/download', async (req, res) => {
    try {
        const { sourceUrl, title, type = 'video', format = 'mp4', directUrl, customBitrate } = req.body;
        // When the client only has a platform page URL (no direct stream URL),
        // resolve the real downloadable stream server-side before starting the job.
        let downloadTargetUrl = directUrl || sourceUrl;
        let muxUrls = null;
        // Explicit adaptive video+audio pair -> mux with ffmpeg.
        if (type === 'video' && req.body.videoUrl && req.body.audioUrl) {
            muxUrls = { video: req.body.videoUrl, audio: req.body.audioUrl };
            downloadTargetUrl = req.body.videoUrl;
        }
        if (!muxUrls && !directUrl && sourceUrl && !/\.(mp4|webm|mov|mkv|avi|m4v|mp3|m4a|wav|flac|aac|ogg|jpg|jpeg|png|webp|avif|gif)(\?|$)/i.test(sourceUrl)) {
            try {
                const resolved = await MediaSourceResolver.resolveAndAnalyze(sourceUrl);
                if (type === 'video' && !resolved.rawMuxedUrl && resolved.rawVideoUrl && resolved.rawAudioUrl) {
                    muxUrls = { video: resolved.rawVideoUrl, audio: resolved.rawAudioUrl };
                    downloadTargetUrl = resolved.rawVideoUrl;
                }
                else {
                    const direct = type === 'audio'
                        ? resolved.rawAudioUrl ||
                            resolved.rawMuxedUrl ||
                            resolved.rawSourceUrl ||
                            resolved.availableFormats.find((f) => f.type === 'audio' && f.directDownloadUrl)?.directDownloadUrl
                        : resolved.rawMuxedUrl ||
                            resolved.rawVideoUrl ||
                            resolved.availableFormats.find((f) => f.type === 'video' && f.directDownloadUrl)?.directDownloadUrl;
                    if (!direct) {
                        return res.status(400).json({
                            error: resolved.authorizedNotice ||
                                'Could not resolve a direct downloadable stream for this URL (private, region-locked, age-restricted, or DRM protected). Try re-running the analysis or paste a direct media file link.',
                            technicalDetails: {
                                platform: resolved.platform,
                                downloadAuthorized: resolved.downloadAuthorized,
                            },
                        });
                    }
                    downloadTargetUrl = direct;
                }
            }
            catch (err) {
                console.error('Media resolve error:', err?.message || err);
                // 503 when the platform is rate-limiting us, 400 otherwise.
                return respondApiError(res, err, 400);
            }
        }
        if (!downloadTargetUrl) {
            return res.status(400).json({ error: 'A valid download URL is required.' });
        }
        // Detect the actual source file format from the URL to set proper file extensions
        const sourceExt = detectSourceFormat(downloadTargetUrl);
        // When extracting audio from a video source, the source file is a video (e.g., mp4)
        // but the output is audio (e.g., mp3). We must keep the correct source extension.
        const isAudioFromVideo = type === 'audio' && ['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v'].includes(sourceExt);
        const sourceFormat = isAudioFromVideo ? sourceExt : undefined;
        const job = await MediaJobManager.createJobRecord(title || 'download', title || 'media', type, format, sourceUrl, sourceFormat);
        // Asynchronously begin streaming download and conversion
        (async () => {
            try {
                let downloadedSource;
                if (muxUrls) {
                    // googlevideo CDN rejects plain ffmpeg HTTP probes, so download both
                    // tracks with ranged HTTP requests first, then mux locally.
                    const jobDir = job.outputPath.replace(/[\\/][^\\/]+$/, '');
                    const videoTmp = path.join(jobDir, `tmp_video_${job.id}.bin`);
                    const audioTmp = path.join(jobDir, `tmp_audio_${job.id}.bin`);
                    await Promise.all([
                        downloadToFile(muxUrls.video, videoTmp, { timeoutMs: 30 * 60 * 1000 }),
                        downloadToFile(muxUrls.audio, audioTmp, { timeoutMs: 30 * 60 * 1000 }),
                    ]);
                    const { execFile } = await import('node:child_process');
                    await new Promise((resolve, reject) => {
                        execFile(ffmpegBin(), ['-y', '-i', videoTmp, '-i', audioTmp, '-c:v', 'copy', '-c:a', 'aac', '-movflags', '+faststart', job.outputPath], (err) => (err ? reject(err) : resolve()));
                    });
                    await fs.unlink(videoTmp).catch(() => { });
                    await fs.unlink(audioTmp).catch(() => { });
                    downloadedSource = job.outputPath;
                }
                else {
                    downloadedSource = await MediaJobManager.startResumableDownload(job.id, downloadTargetUrl);
                }
                MediaJobManager.emitProgress(job.id, {
                    status: 'CONVERTING',
                    stageName: 'Processing media...',
                });
                if (type === 'image') {
                    // Image format conversion
                    if (format === 'original') {
                        await fs.copyFile(downloadedSource, job.outputPath);
                    }
                    else {
                        await ImageProcessor.convert(downloadedSource, job.outputPath, format);
                    }
                }
                else if (type === 'audio') {
                    // Audio extraction/conversion — source might be video or audio file
                    const audioFormat = (format === 'original' ? 'm4a' : format);
                    await AudioExtractor.extract({
                        inputPath: downloadedSource,
                        outputPath: job.outputPath,
                        format: audioFormat,
                        targetBitrateKbps: customBitrate || 320,
                        preferStreamCopy: true,
                    });
                }
                else {
                    // Video: copy directly (already in target format)
                    if (muxUrls) {
                        // Already muxed to job.outputPath by ffmpeg above.
                    }
                    else if (format === 'original' || downloadedSource.endsWith(`.${format}`) || format === 'mp4') {
                        await fs.copyFile(downloadedSource, job.outputPath);
                    }
                    else {
                        // If conversion needed, use ffmpeg to remux
                        const { exec: execCb } = await import('node:child_process');
                        const { promisify } = await import('node:util');
                        const execAsync = promisify(execCb);
                        await execAsync(`ffmpeg -y -i "${downloadedSource}" -c copy "${job.outputPath}"`);
                    }
                }
                const outStats = await fs.stat(job.outputPath);
                MediaJobManager.emitProgress(job.id, {
                    status: 'COMPLETED',
                    percent: 100,
                    downloadedBytes: outStats.size,
                    totalBytes: outStats.size,
                    stageName: 'Ready for download',
                });
                await MediaJobManager.cleanupWorkingFiles(job);
            }
            catch (err) {
                if (err.name !== 'AbortError') {
                    console.error(`Media download job ${job.id} failed:`, err);
                    MediaJobManager.emitProgress(job.id, {
                        status: 'FAILED',
                        error: err.message || 'Download/Processing failed.',
                    });
                }
            }
        })();
        res.json({ jobId: job.id, status: job.progress.status, filename: job.filename });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
/**
 * Detect source media format from a URL to use proper file extensions
 */
function detectSourceFormat(url) {
    try {
        const pathname = new URL(url).pathname.toLowerCase();
        const extMatch = pathname.match(/\.([a-z0-9]{2,5})(?:\?|$)/);
        if (extMatch) {
            const ext = extMatch[1];
            const mediaExts = ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'mp3', 'm4a', 'wav', 'flac', 'aac', 'ogg', 'jpg', 'jpeg', 'png', 'webp', 'avif', 'gif'];
            if (mediaExts.includes(ext))
                return ext;
        }
    }
    catch { }
    return 'mp4'; // Default assumption for most platform videos
}
// C. List all Download Manager Jobs
apiRouter.get('/media/jobs', (_req, res) => {
    const jobs = MediaJobManager.listJobs().map((j) => ({
        id: j.id,
        title: j.title,
        filename: j.filename,
        type: j.type,
        format: j.format,
        sourceUrl: j.sourceUrl,
        progress: j.progress,
        createdAt: j.createdAt,
        hasOutput: true,
    }));
    res.json({ jobs });
});
// D. Single Job Details
apiRouter.get('/media/jobs/:id', (req, res) => {
    const job = MediaJobManager.getJob(req.params.id);
    if (!job)
        return res.status(404).json({ error: 'Job not found.' });
    res.json({
        id: job.id,
        title: job.title,
        filename: job.filename,
        type: job.type,
        format: job.format,
        progress: job.progress,
        createdAt: job.createdAt,
    });
});
// E. Job Progress SSE Stream
apiRouter.get('/media/jobs/:id/events', (req, res) => {
    const { id } = req.params;
    const job = MediaJobManager.getJob(id);
    if (!job)
        return res.status(404).json({ error: 'Job not found.' });
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    MediaJobManager.subscribe(id, res);
});
// F. Pause Download
apiRouter.post('/media/jobs/:id/pause', (req, res) => {
    const success = MediaJobManager.pauseJob(req.params.id);
    res.json({ success });
});
// G. Resume Download
apiRouter.post('/media/jobs/:id/resume', async (req, res) => {
    const job = MediaJobManager.getJob(req.params.id);
    if (!job || !job.downloadMeta) {
        return res.status(400).json({ error: 'Cannot resume job.' });
    }
    // Resume download asynchronously
    (async () => {
        try {
            await MediaJobManager.startResumableDownload(job.id, job.downloadMeta.remoteUrl);
            await fs.copyFile(job.sourcePath, job.outputPath);
            const outStats = await fs.stat(job.outputPath);
            MediaJobManager.emitProgress(job.id, {
                status: 'COMPLETED',
                percent: 100,
                downloadedBytes: outStats.size,
                totalBytes: outStats.size,
                stageName: 'Ready for download',
            });
        }
        catch (err) {
            if (err.name !== 'AbortError') {
                MediaJobManager.emitProgress(job.id, { status: 'FAILED', error: err.message });
            }
        }
    })();
    res.json({ success: true });
});
// H. Cancel Download
apiRouter.post('/media/jobs/:id/cancel', async (req, res) => {
    const success = await MediaJobManager.cancelJob(req.params.id);
    res.json({ success });
});
// I. Download Processed File
apiRouter.get('/media/jobs/:id/download', async (req, res) => {
    const job = MediaJobManager.getJob(req.params.id);
    if (!job)
        return res.status(404).send('Job not found.');
    try {
        await fs.access(job.outputPath);
        res.download(job.outputPath, job.filename);
    }
    catch {
        res.status(404).send('Output file not found or not yet complete.');
    }
});
// I-bis. Inline Preview for completed media jobs
apiRouter.get('/media/jobs/:id/preview', async (req, res) => {
    const job = MediaJobManager.getJob(req.params.id);
    if (!job)
        return res.status(404).send('Job not found.');
    try {
        await fs.access(job.outputPath);
        const stat = await fs.stat(job.outputPath);
        const ext = path.extname(job.outputPath).toLowerCase();
        const mimeMap = {
            '.mp4': 'video/mp4',
            '.webm': 'video/webm',
            '.mov': 'video/quicktime',
            '.m4v': 'video/mp4',
            '.mp3': 'audio/mpeg',
            '.m4a': 'audio/mp4',
            '.wav': 'audio/wav',
            '.ogg': 'audio/ogg',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.webp': 'image/webp',
            '.gif': 'image/gif',
        };
        const contentType = mimeMap[ext] || 'application/octet-stream';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', stat.size.toString());
        res.setHeader('Content-Disposition', 'inline');
        res.setHeader('Accept-Ranges', 'bytes');
        const fileStream = createReadStream(job.outputPath);
        fileStream.pipe(res);
    }
    catch {
        res.status(404).send('Preview not available.');
    }
});
// J. Delete Media Job
apiRouter.delete('/media/jobs/:id', async (req, res) => {
    const success = await MediaJobManager.deleteJob(req.params.id);
    res.json({ success });
});
// K. Resumable Chunked Upload
const chunkMemoryStorage = multer.memoryStorage();
const uploadChunk = multer({ storage: chunkMemoryStorage, limits: { fileSize: 50 * 1024 * 1024 } });
apiRouter.post('/media/upload-chunk', uploadChunk.single('chunk'), async (req, res) => {
    try {
        const { fileId, chunkIndex, totalChunks, fileName } = req.body;
        if (!fileId || chunkIndex === undefined || !totalChunks || !req.file) {
            return res.status(400).json({ error: 'Missing chunk upload metadata.' });
        }
        const chunkIdx = parseInt(chunkIndex, 10);
        const totalCount = parseInt(totalChunks, 10);
        const chunkDir = path.join(UPLOAD_DIR, `chunks_${sanitizeFilename(fileId)}`);
        await fs.mkdir(chunkDir, { recursive: true });
        // Write chunk
        const chunkPath = path.join(chunkDir, `part_${chunkIdx}`);
        await fs.writeFile(chunkPath, req.file.buffer);
        // If final chunk, assemble parts
        if (chunkIdx === totalCount - 1) {
            const ext = path.extname(fileName) || '.mp4';
            const assembledName = `${Date.now()}_${nanoid(6)}${ext}`;
            const assembledPath = path.join(UPLOAD_DIR, assembledName);
            const writeStream = (await import('node:fs')).createWriteStream(assembledPath);
            for (let i = 0; i < totalCount; i++) {
                const partFile = path.join(chunkDir, `part_${i}`);
                const partBuf = await fs.readFile(partFile);
                writeStream.write(partBuf);
            }
            await new Promise((resolve, reject) => {
                writeStream.end((err) => (err ? reject(err) : resolve()));
            });
            // Cleanup chunks directory
            await fs.rm(chunkDir, { recursive: true, force: true });
            const stats = await fs.stat(assembledPath);
            return res.json({
                completed: true,
                tempPath: assembledPath,
                originalName: fileName,
                sizeBytes: stats.size,
            });
        }
        res.json({ completed: false, chunkIndex: chunkIdx });
    }
    catch (err) {
        console.error('Chunk upload error:', err);
        res.status(500).json({ error: err.message });
    }
});
// L. Video to Audio Extraction (Smart bitrate & metadata)
apiRouter.post('/audio/extract', async (req, res) => {
    try {
        const { tempPath, format = 'mp3', bitrate = 320, preferStreamCopy = true, metadata } = req.body;
        if (!tempPath) {
            return res.status(400).json({ error: 'Source tempPath is required.' });
        }
        await fs.access(tempPath);
        const ext = format === 'original' ? 'm4a' : format;
        const outputName = `audio_${Date.now()}_${nanoid(6)}.${ext}`;
        const outputPath = path.join(UPLOAD_DIR, outputName);
        const result = await AudioExtractor.extract({
            inputPath: tempPath,
            outputPath,
            format: (format === 'original' ? 'm4a' : format),
            targetBitrateKbps: Number(bitrate) || 320,
            preferStreamCopy: preferStreamCopy !== false,
            metadata,
        });
        res.json({
            success: true,
            outputPath: result.outputPath,
            downloadUrl: `/api/media/file?path=${encodeURIComponent(result.outputPath)}&name=${encodeURIComponent(outputName)}`,
            fileSizeBytes: result.fileSizeBytes,
            sourceBitrateKbps: result.sourceBitrateKbps,
            outputBitrateKbps: result.outputBitrateKbps,
            isStreamCopy: result.isStreamCopy,
            qualityNotice: result.qualityNotice,
        });
    }
    catch (err) {
        console.error('Audio extract error:', err);
        res.status(500).json({ error: err.message });
    }
});
// M. Audio Editor & Converter (Trim, fade, normalize, volume)
apiRouter.post('/audio/convert', async (req, res) => {
    try {
        const { tempPath, format = 'mp3', startSec, endSec, fadeInSec, fadeOutSec, volumeMultiplier, normalizeLoudness, bitrateKbps = 320, } = req.body;
        if (!tempPath) {
            return res.status(400).json({ error: 'Audio source tempPath is required.' });
        }
        await fs.access(tempPath);
        const outputName = `edited_${Date.now()}_${nanoid(6)}.${format}`;
        const outputPath = path.join(UPLOAD_DIR, outputName);
        const result = await AudioConverter.editAndConvert({
            inputPath: tempPath,
            outputPath,
            format: format,
            startSec: startSec !== undefined ? Number(startSec) : undefined,
            endSec: endSec !== undefined ? Number(endSec) : undefined,
            fadeInSec: fadeInSec !== undefined ? Number(fadeInSec) : undefined,
            fadeOutSec: fadeOutSec !== undefined ? Number(fadeOutSec) : undefined,
            volumeMultiplier: volumeMultiplier !== undefined ? Number(volumeMultiplier) : undefined,
            normalizeLoudness: !!normalizeLoudness,
            bitrateKbps: Number(bitrateKbps) || 320,
        });
        res.json({
            success: true,
            outputPath: result.outputPath,
            downloadUrl: `/api/media/file?path=${encodeURIComponent(result.outputPath)}&name=${encodeURIComponent(outputName)}`,
            fileSizeBytes: result.fileSizeBytes,
            duration: result.duration,
        });
    }
    catch (err) {
        console.error('Audio convert error:', err);
        res.status(500).json({ error: err.message });
    }
});
// N. Audio Waveform Peak Generator
apiRouter.post('/audio/waveform', async (req, res) => {
    try {
        const { filePath } = req.body;
        if (!filePath)
            return res.status(400).json({ error: 'filePath is required.' });
        await fs.access(filePath);
        const peaks = await AudioConverter.generateWaveform(filePath, 100);
        res.json({ peaks });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// O. Smart Outro Detection
apiRouter.post('/media/detect-outro', async (req, res) => {
    try {
        const { filePath } = req.body;
        if (!filePath)
            return res.status(400).json({ error: 'filePath is required.' });
        await fs.access(filePath);
        const outro = await OutroDetector.detect(filePath);
        res.json(outro);
    }
    catch (err) {
        console.error('Outro detection error:', err);
        res.status(500).json({ error: err.message });
    }
});
// P. Precision Ending Trim
apiRouter.post('/media/trim', async (req, res) => {
    try {
        const { filePath, cutTimeSec, applyFadeOut = true } = req.body;
        if (!filePath || cutTimeSec === undefined) {
            return res.status(400).json({ error: 'filePath and cutTimeSec are required.' });
        }
        await fs.access(filePath);
        const ext = path.extname(filePath) || '.mp4';
        const outputName = `trimmed_${Date.now()}_${nanoid(6)}${ext}`;
        const outputPath = path.join(UPLOAD_DIR, outputName);
        const result = await OutroDetector.trimEnding(filePath, outputPath, Number(cutTimeSec), applyFadeOut !== false);
        res.json({
            success: true,
            outputPath: result.outputPath,
            downloadUrl: `/api/media/file?path=${encodeURIComponent(result.outputPath)}&name=${encodeURIComponent(outputName)}`,
            outputDuration: result.outputDuration,
        });
    }
    catch (err) {
        console.error('Trim error:', err);
        res.status(500).json({ error: err.message });
    }
});
// Q. User-Owned Watermark Removal (Crop, Blur, Mask, AI Inpaint)
apiRouter.post('/user-content/watermark/remove', async (req, res) => {
    try {
        const { filePath, method = 'inpaint', region, blurStrength = 10 } = req.body;
        if (!filePath || !region) {
            return res.status(400).json({ error: 'filePath and watermark region coordinates are required.' });
        }
        await fs.access(filePath);
        const ext = path.extname(filePath) || '.mp4';
        const outputName = `delogo_${Date.now()}_${nanoid(6)}${ext}`;
        const outputPath = path.join(UPLOAD_DIR, outputName);
        const result = await WatermarkEditor.removeWatermark({
            inputPath: filePath,
            outputPath,
            method,
            region,
            blurStrength: Number(blurStrength) || 10,
        });
        res.json({
            success: true,
            outputPath: result.outputPath,
            downloadUrl: `/api/media/file?path=${encodeURIComponent(result.outputPath)}&name=${encodeURIComponent(outputName)}`,
            method: result.method,
            legalNotice: result.legalNotice,
            qualityDisclaimer: result.qualityDisclaimer,
        });
    }
    catch (err) {
        console.error('Watermark removal error:', err);
        res.status(500).json({ error: err.message });
    }
});
// R. Cross-Tool Pipeline: Send Media Directly to Video Optimizer
apiRouter.post('/media/send-to-optimizer', async (req, res) => {
    try {
        const { filePath, originalName } = req.body;
        if (!filePath) {
            return res.status(400).json({ error: 'filePath is required.' });
        }
        let localPath = filePath;
        let isTemp = false;
        // If a URL was passed (e.g., from TikTok/YouTube/Pinterest send-to-optimizer action),
        // download it to a temporary local file first so the optimizer pipeline can access it.
        if (/^https?:\/\//i.test(filePath)) {
            isTemp = true;
            const ext = detectSourceFormat(filePath) || 'mp4';
            const tempName = `optimizer_${Date.now()}_${nanoid(6)}.${ext}`;
            localPath = path.join(UPLOAD_DIR, tempName);
            const response = await fetch(filePath, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                },
                signal: AbortSignal.timeout(30000),
            });
            if (!response.ok) {
                throw new Error(`Failed to download media from URL: HTTP ${response.status}`);
            }
            if (!response.body) {
                throw new Error('Empty response body when downloading media.');
            }
            await fs.mkdir(UPLOAD_DIR, { recursive: true });
            const fileStream = createWriteStream(localPath);
            const reader = response.body.getReader();
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                fileStream.write(Buffer.from(value));
            }
            await new Promise((resolve, reject) => {
                fileStream.end((err) => {
                    if (err)
                        reject(err);
                    else
                        resolve();
                });
            });
        }
        await fs.access(localPath);
        const stats = await fs.stat(localPath);
        const baseName = originalName || path.basename(localPath);
        // Run VideoAnalyzer to get report and recommendations
        const report = await VideoAnalyzer.analyze(localPath, baseName);
        res.json({
            success: true,
            report,
            tempPath: localPath,
            originalName: baseName,
            sizeBytes: stats.size,
        });
    }
    catch (err) {
        console.error('Send to optimizer error:', err);
        res.status(500).json({ error: err.message });
    }
});
// S. Generic Safe File Download
apiRouter.get('/media/file', async (req, res) => {
    try {
        const filePath = req.query.path;
        const downloadName = req.query.name || 'download';
        if (!filePath)
            return res.status(400).send('Missing path parameter.');
        // Ensure path is inside allowed storage directory
        const resolved = path.resolve(filePath);
        const storageDir = path.resolve(__dirname, '../../storage');
        if (!resolved.startsWith(storageDir)) {
            return res.status(403).send('Access denied.');
        }
        await fs.access(resolved);
        res.download(resolved, sanitizeFilename(downloadName));
    }
    catch {
        res.status(404).send('File not found.');
    }
});
