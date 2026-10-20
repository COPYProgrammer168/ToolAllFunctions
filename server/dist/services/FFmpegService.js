import { spawn } from 'node:child_process';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { HardwareDetector } from './HardwareDetector.js';
const execAsync = promisify(exec);
/** Vertical 9:16 canvas presets (TikTok/Reels/Shorts family). */
const VERTICAL_CANVAS_PRESETS = new Set(['tiktok', 'tiktok_4k', 'reels', 'shorts']);
export class FFmpegService {
    activeProcesses = new Map();
    cancel(jobId) {
        const proc = this.activeProcesses.get(jobId);
        if (!proc || !proc.pid)
            return false;
        try {
            if (process.platform === 'win32') {
                exec(`taskkill /pid ${proc.pid} /T /F`, () => { });
            }
            else {
                proc.kill('SIGKILL');
            }
        }
        catch (err) {
            console.error(`Error killing process for job ${jobId}:`, err);
        }
        this.activeProcesses.delete(jobId);
        return true;
    }
    async processVideo(jobId, inputPath, outputPath, meta, plan, onProgress) {
        const hwInfo = await HardwareDetector.detect();
        const canUseNvenc = hwInfo.hasNvidiaGpu && hwInfo.encoders.nvenc_h264 && plan.config.mode !== 'preserve_original';
        // If preserve original and already mp4/h264 without filter changes, remux
        if (plan.config.mode === 'preserve_original') {
            try {
                return await this.executeRemux(jobId, inputPath, outputPath, meta, onProgress);
            }
            catch (err) {
                console.warn('Remux failed, falling back to gentle preservation encode:', err);
            }
        }
        // Try primary encoder (NVENC if available, else libx264)
        try {
            return await this.executeFilterPipeline(jobId, inputPath, outputPath, meta, plan, canUseNvenc ? 'h264_nvenc' : 'libx264', onProgress);
        }
        catch (err) {
            // If NVENC failed, fallback to CPU libx264
            if (canUseNvenc && !err.isCancelled) {
                console.warn(`Hardware NVENC encoding failed for job ${jobId}. Falling back to high-compatibility CPU encoder (libx264)...`);
                onProgress({
                    stageName: 'Hardware fallback: Switching to CPU encoder',
                    state: 'PROCESSING'
                });
                return await this.executeFilterPipeline(jobId, inputPath, outputPath, meta, plan, 'libx264', onProgress);
            }
            throw err;
        }
    }
    async executeRemux(jobId, inputPath, outputPath, meta, onProgress) {
        onProgress({
            state: 'ENCODING',
            stageName: 'Preserving stream containers (Lossless Remux)',
            percent: 50,
            currentFrame: 0,
            totalFrames: Math.round(meta.duration * meta.fps),
            speed: 'Direct Remux',
            timeRemainingSec: 2,
        });
        const args = ['-y', '-i', inputPath, '-c', 'copy', '-movflags', '+faststart', outputPath];
        await this.runProcess(jobId, 'ffmpeg', args, meta.duration, onProgress);
        return outputPath;
    }
    async executeFilterPipeline(jobId, inputPath, outputPath, meta, plan, encoder, onProgress) {
        const isLandscape = meta.width > meta.height;
        const isTiktok = VERTICAL_CANVAS_PRESETS.has(plan.config.preset) ||
            plan.config.targetResolution === 'tiktok_1080x1920';
        // Canvas size comes from the plan so 1080×1920, 2160×3840 (TikTok 4K) and
        // any future vertical canvas all work without hard-coded dimensions.
        const canvasWidth = plan.filters.scaleWidth || 1080;
        const canvasHeight = plan.filters.scaleHeight || 1920;
        const isPreview = plan.config.isPreview;
        const previewDuration = plan.config.previewDuration || 5;
        const effectiveDuration = isPreview ? Math.min(meta.duration, previewDuration) : meta.duration;
        const memoryBudgetMB = HardwareDetector.memoryBudgetMB();
        // Build video filter chains
        const filterParts = [];
        // 1. Deblock & Deband
        if (plan.filters.deblock) {
            filterParts.push('deblock=filter=weak:block=4');
        }
        if (plan.filters.deband) {
            // The deband filter has a single `range` option (`1thr`–`4thr` are the
            // only per-plane variants), so `deband=1range=…` made ffmpeg abort every
            // debanding-enabled run — e.g. Max Quality mode — with "Option not found".
            filterParts.push('deband=range=16:blur=true');
        }
        // 2. Denoise
        if (plan.filters.denoise === 'low') {
            filterParts.push('hqdn3d=1.2:1.2:3:3');
        }
        else if (plan.filters.denoise === 'medium') {
            filterParts.push('hqdn3d=2.0:2.0:5:5');
        }
        else if (plan.filters.denoise === 'high') {
            filterParts.push('hqdn3d=3.5:3.5:8:8');
        }
        // 3. Detail & Sharpen (Edge-aware adaptive sharpening)
        if (plan.filters.sharpen === 'soft') {
            filterParts.push('unsharp=3:3:0.3:3:3:0.0');
        }
        else if (plan.filters.sharpen === 'natural') {
            filterParts.push('unsharp=5:5:0.5:5:5:0.0');
        }
        else if (plan.filters.sharpen === 'sharp') {
            filterParts.push('unsharp=5:5:0.8:5:5:0.0');
        }
        else if (plan.filters.sharpen === 'ultra_sharp') {
            filterParts.push('unsharp=7:7:1.2:5:5:0.2');
        }
        // 4. Color profile
        if (plan.filters.colorProfile === 'vibrant') {
            filterParts.push('eq=saturation=1.12:contrast=1.04');
        }
        else if (plan.filters.colorProfile === 'cinematic') {
            filterParts.push('eq=contrast=1.08:saturation=0.96');
        }
        else if (plan.filters.colorProfile === 'natural') {
            filterParts.push('eq=contrast=1.01:saturation=1.02');
        }
        // 5. Framerate / Motion Interpolation
        const motionFps = plan.filters.targetFps || 60;
        if (plan.filters.interpolateMode === 'mci') {
            // Real bidirectional motion estimation
            filterParts.push(`minterpolate=fps=${motionFps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1`);
        }
        else if (plan.filters.interpolateMode === 'blend') {
            filterParts.push(`minterpolate=fps=${motionFps}:mi_mode=blend`);
        }
        else if (plan.filters.targetFps && plan.filters.targetFps !== meta.fps) {
            filterParts.push(`fps=${plan.filters.targetFps}`);
        }
        // Reduce the working resolution BEFORE the temporal/denoise filters. On a
        // 4K source, minterpolate/denoise otherwise allocate several full 4K
        // frames each (exactly the buffers that OOM small instances) even though
        // the final canvas is 1080p. Scaling first keeps the same output size
        // while cutting the filter frame pools by up to 4×.
        const workingWidth = isTiktok && isLandscape ? canvasWidth : plan.filters.scaleWidth;
        const workingHeight = isTiktok && isLandscape ? canvasHeight : plan.filters.scaleHeight;
        if (workingWidth &&
            workingHeight &&
            meta.width * meta.height > workingWidth * workingHeight * 1.1) {
            filterParts.unshift(`scale=${workingWidth}:${workingHeight}:force_original_aspect_ratio=decrease:flags=lanczos`);
        }
        // Construct complex filter graph or simple filter chain
        let filterComplexArg;
        let simpleVfArg;
        // Check TikTok aspect ratio strategy if landscape
        if (isTiktok && isLandscape) {
            const baseFilters = filterParts.length > 0 ? filterParts.join(',') + ',' : '';
            if (plan.filters.aspectRatioStrategy === 'blur_background') {
                // Splits into blurred background (filling the vertical canvas) and crisp centered foreground
                filterComplexArg = `[0:v]${baseFilters}split=2[fg_raw][bg_raw];` +
                    `[bg_raw]scale=${canvasWidth}:${canvasHeight}:force_original_aspect_ratio=increase:flags=lanczos,crop=${canvasWidth}:${canvasHeight},boxblur=25:5[bg];` +
                    `[fg_raw]scale=${canvasWidth}:${canvasHeight}:force_original_aspect_ratio=decrease:flags=lanczos[fg];` +
                    `[bg][fg]overlay=(W-w)/2:(H-h)/2[v_out]`;
            }
            else if (plan.filters.aspectRatioStrategy === 'fit') {
                // Fits video in the vertical canvas with black bars
                filterParts.push(`scale=${canvasWidth}:${canvasHeight}:force_original_aspect_ratio=decrease:flags=lanczos`);
                filterParts.push(`pad=${canvasWidth}:${canvasHeight}:(ow-iw)/2:(oh-ih)/2:color=black`);
                simpleVfArg = filterParts.join(',');
            }
            else if (plan.filters.aspectRatioStrategy === 'crop' || plan.filters.aspectRatioStrategy === 'smart_crop') {
                // Crops center to the vertical canvas
                filterParts.push(`scale=${canvasWidth}:${canvasHeight}:force_original_aspect_ratio=increase:flags=lanczos`);
                filterParts.push(`crop=${canvasWidth}:${canvasHeight}`);
                simpleVfArg = filterParts.join(',');
            }
            else {
                // Preserve landscape aspect ratio inside the vertical canvas
                filterParts.push(`scale=${canvasWidth}:${canvasHeight}:force_original_aspect_ratio=decrease:flags=lanczos`);
                filterParts.push(`pad=${canvasWidth}:${canvasHeight}:(ow-iw)/2:(oh-ih)/2:color=black`);
                simpleVfArg = filterParts.join(',');
            }
        }
        else {
            // Non-landscape or vertical TikTok or standard resolution
            if (plan.filters.scaleWidth && plan.filters.scaleHeight) {
                filterParts.push(`scale=${plan.filters.scaleWidth}:${plan.filters.scaleHeight}:flags=lanczos+accurate_rnd`);
            }
            if (filterParts.length > 0) {
                simpleVfArg = filterParts.join(',');
            }
        }
        // Audio filters
        const audioFilters = [];
        if (meta.audioCodec && plan.filters.audioNormalization) {
            audioFilters.push('loudnorm=I=-14:LRA=11:TP=-1.5');
        }
        // Assemble FFmpeg CLI arguments
        const args = ['-y'];
        const threadBudget = String(HardwareDetector.threadBudget());
        // The filter graph creates worker threads per filter. On a small instance
        // (many host cores visible, little RAM) each worker keeps its own frame
        // pool, so cap the graph to a single thread before the input is opened.
        if (memoryBudgetMB <= 2048) {
            args.push('-filter_threads', '1', '-filter_complex_threads', '1');
            // `-threads` before `-i` applies to the DECODER. A 4K H.264 stream can
            // hold many full-resolution reference frames per thread; leaving this
            // at "all host cores" is what pushed 4K sources over 320MB even after
            // the filters were downscaled.
            args.push('-threads', threadBudget);
        }
        // If preview, limit duration
        if (isPreview) {
            args.push('-ss', '0', '-t', String(previewDuration));
        }
        args.push('-i', inputPath);
        // Cap encoder threads: the default `-threads 0` uses every host core,
        // and x264's per-thread frame buffers OOM small instances (Render free
        // tier exposes many host cores but only ~512MB RAM).
        args.push('-threads', threadBudget);
        // Apply video filters
        if (filterComplexArg) {
            args.push('-filter_complex', filterComplexArg, '-map', '[v_out]');
            if (meta.audioCodec) {
                if (audioFilters.length > 0) {
                    args.push('-filter:a', audioFilters.join(','), '-map', '0:a?');
                }
                else {
                    args.push('-map', '0:a?');
                }
            }
        }
        else {
            if (simpleVfArg) {
                args.push('-vf', simpleVfArg);
            }
            if (meta.audioCodec && audioFilters.length > 0) {
                args.push('-af', audioFilters.join(','));
            }
        }
        // Codec & Encoder options
        if (encoder === 'h264_nvenc') {
            args.push('-c:v', 'h264_nvenc', '-preset', plan.config.mode === 'fast' ? 'p3' : 'p6', '-tune', 'hq', '-rc', 'vbr', '-cq', String(plan.encoding.crf), '-b:v', `${plan.encoding.videoBitrateKbps}k`, '-maxrate', `${Math.round(plan.encoding.videoBitrateKbps * 1.4)}k`, '-bufsize', `${Math.round(plan.encoding.videoBitrateKbps * 2)}k`, '-profile:v', plan.encoding.profile, '-level', plan.encoding.level, '-pix_fmt', 'yuv420p');
        }
        else {
            // libx264: frame-referencing memory (lookahead, ref frames, thread
            // buffers) is large at high resolutions. Cap the encoder preset and
            // lookahead on small memory budgets so encoding survives in a 512MB
            // container instead of getting OOM-killed mid-job.
            const encoderPreset = memoryBudgetMB <= 1024
                ? 'veryfast'
                : memoryBudgetMB <= 2048 && plan.encoding.preset === 'slow'
                    ? 'medium'
                    : plan.encoding.preset;
            args.push('-c:v', 'libx264', '-preset', encoderPreset, '-crf', String(plan.encoding.crf), '-maxrate', `${Math.round(plan.encoding.videoBitrateKbps * 1.3)}k`, '-bufsize', `${Math.round(plan.encoding.videoBitrateKbps * 2)}k`, '-profile:v', plan.encoding.profile, '-level', plan.encoding.level, '-pix_fmt', 'yuv420p');
            if (memoryBudgetMB <= 2048) {
                // Default lookahead scales with the preset (~25-40 frames); each held
                // frame is a full YUV420 picture. 10 frames keeps quality usable while
                // dramatically shrinking the frame pool.
                args.push('-x264-params', 'rc-lookahead=10');
            }
        }
        // Audio options
        if (meta.audioCodec) {
            args.push('-c:a', 'aac', '-b:a', `${plan.encoding.audioBitrateKbps}k`, '-ar', '48000', '-ac', '2');
        }
        else {
            args.push('-an');
        }
        // Container flags
        args.push('-movflags', '+faststart', outputPath);
        onProgress({
            state: 'PROCESSING',
            stageName: plan.filters.interpolateMode === 'mci'
                ? 'Frame Interpolation & AI Enhancement'
                : (plan.filters.scaleWidth ? 'High-Precision Upscaling & Enhancement' : 'Multi-Stage Video Optimization'),
            percent: 5,
        });
        await this.runProcess(jobId, 'ffmpeg', args, effectiveDuration, onProgress);
        return outputPath;
    }
    runProcess(jobId, command, args, totalDurationSec, onProgress) {
        return new Promise((resolve, reject) => {
            const proc = spawn(command, args);
            this.activeProcesses.set(jobId, proc);
            let lastPercent = 5;
            let stderrBuffer = '';
            let killedForMemory = false;
            // Kernel OOM kills take down the whole container, which is what turned
            // a heavy transcode into 502s on every API call and a dead SSE stream.
            // Watch the encoder's RSS and stop it first, so the job can fail with a
            // readable message while the server (and the status endpoint) stays up.
            const budgetMB = HardwareDetector.memoryBudgetMB();
            const hardLimitMB = HardwareDetector.ffmpegMemoryLimitMB();
            const currentLimitMB = () => {
                if (hardLimitMB <= 0)
                    return 0;
                // Node's own footprint changes as the process serves requests. Keep a
                // small reserve for the kernel instead of assuming a fixed baseline.
                const nodeRssMB = Math.round(process.memoryUsage().rss / (1024 * 1024));
                return Math.max(128, Math.min(hardLimitMB, budgetMB - nodeRssMB - 64));
            };
            const memoryLimitMB = currentLimitMB();
            let watchdog;
            if (memoryLimitMB > 0 && proc.pid) {
                watchdog = setInterval(() => {
                    const rssMB = HardwareDetector.processRssMB(proc.pid);
                    const limitMB = currentLimitMB();
                    if (limitMB > 0 && rssMB > 0 && rssMB >= limitMB) {
                        killedForMemory = true;
                        console.error(`[ffmpeg] job ${jobId} reached ${rssMB}MB (limit ${limitMB}MB); ` +
                            'stopping it before the container runs out of memory.');
                        if (watchdog) {
                            clearInterval(watchdog);
                            watchdog = undefined;
                        }
                        try {
                            proc.kill('SIGKILL');
                        }
                        catch { }
                    }
                }, 1000);
                watchdog.unref?.();
            }
            const clearWatchdog = () => {
                if (watchdog) {
                    clearInterval(watchdog);
                    watchdog = undefined;
                }
            };
            proc.stderr.on('data', (chunk) => {
                const text = chunk.toString();
                stderrBuffer += text;
                // Only the tail is used for the failure message. Keeping every line
                // of a multi-hour encode in memory is an avoidable leak on the small
                // instances this app targets.
                if (stderrBuffer.length > 64_000) {
                    stderrBuffer = stderrBuffer.slice(-32_000);
                }
                // Parse FFmpeg progress lines:
                // frame=  120 fps= 45 q=21.0 size=    1024kB time=00:00:04.00 bitrate=2097.2kbits/s speed=1.5x
                const timeMatch = text.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d+)/);
                const fpsMatch = text.match(/fps=\s*([\d\.]+)/);
                const frameMatch = text.match(/frame=\s*(\d+)/);
                const speedMatch = text.match(/speed=\s*([\d\.]+)x/);
                if (timeMatch && totalDurationSec > 0) {
                    const hours = Number(timeMatch[1]);
                    const minutes = Number(timeMatch[2]);
                    const seconds = Number(timeMatch[3]);
                    const currentTime = hours * 3600 + minutes * 60 + seconds;
                    let percent = Math.min(96, Math.max(5, Math.round((currentTime / totalDurationSec) * 100)));
                    if (percent > lastPercent) {
                        lastPercent = percent;
                    }
                    const currentFps = fpsMatch ? Number(fpsMatch[1]) : 0;
                    const currentFrame = frameMatch ? Number(frameMatch[1]) : 0;
                    const speed = speedMatch ? `${speedMatch[1]}x` : '1.0x';
                    const speedNum = speedMatch ? Number(speedMatch[1]) : 1.0;
                    const remainingSec = speedNum > 0 ? Math.max(0, Math.round((totalDurationSec - currentTime) / speedNum)) : 0;
                    onProgress({
                        percent: lastPercent,
                        fps: currentFps,
                        currentFrame,
                        speed,
                        timeRemainingSec: remainingSec,
                        state: lastPercent > 80 ? 'ENCODING' : 'PROCESSING',
                    });
                }
            });
            proc.on('error', (err) => {
                clearWatchdog();
                this.activeProcesses.delete(jobId);
                reject(err);
            });
            proc.on('close', (code, signal) => {
                clearWatchdog();
                this.activeProcesses.delete(jobId);
                if (killedForMemory) {
                    const err = new Error(`The encoder exceeded this server's ${HardwareDetector.memoryBudgetMB()}MB memory budget. ` +
                        'Try Fast Optimize, a lower target resolution, or the 5-second preview.');
                    err.isMemory = true;
                    return reject(err);
                }
                if (signal === 'SIGKILL' || signal === 'SIGTERM') {
                    const err = new Error('Job was cancelled by user');
                    err.isCancelled = true;
                    return reject(err);
                }
                if (code === 0) {
                    resolve();
                }
                else {
                    const tailError = stderrBuffer.slice(-800);
                    if (code === 137 || tailError.includes("Can't allocate") || tailError.includes('out of memory')) {
                        const err = new Error('The encoder ran out of memory before finishing. This server has a small RAM budget — try Fast Optimize, a lower target resolution, or the 5-second preview.');
                        err.isMemory = true;
                        reject(err);
                        return;
                    }
                    reject(new Error(`FFmpeg exited with code ${code}. Error: ${tailError}`));
                }
            });
        });
    }
}
