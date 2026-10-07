import { spawn } from 'node:child_process';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { HardwareDetector } from './HardwareDetector.js';
const execAsync = promisify(exec);
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
        const isTiktok = plan.config.preset === 'tiktok' || plan.config.targetResolution === 'tiktok_1080x1920';
        const isPreview = plan.config.isPreview;
        const previewDuration = plan.config.previewDuration || 5;
        const effectiveDuration = isPreview ? Math.min(meta.duration, previewDuration) : meta.duration;
        // Build video filter chains
        const filterParts = [];
        // 1. Deblock & Deband
        if (plan.filters.deblock) {
            filterParts.push('deblock=filter=weak:block=4');
        }
        if (plan.filters.deband) {
            filterParts.push('deband=1range=16:blur=true');
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
        if (plan.filters.interpolateMode === 'mci') {
            // Real bidirectional motion estimation
            filterParts.push('minterpolate=fps=60:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1');
        }
        else if (plan.filters.interpolateMode === 'blend') {
            filterParts.push('minterpolate=fps=60:mi_mode=blend');
        }
        else if (plan.filters.targetFps && plan.filters.targetFps !== meta.fps) {
            filterParts.push(`fps=${plan.filters.targetFps}`);
        }
        // Construct complex filter graph or simple filter chain
        let filterComplexArg;
        let simpleVfArg;
        // Check TikTok aspect ratio strategy if landscape
        if (isTiktok && isLandscape) {
            const baseFilters = filterParts.length > 0 ? filterParts.join(',') + ',' : '';
            if (plan.filters.aspectRatioStrategy === 'blur_background') {
                // Splits into blurred background (filling 1080x1920) and crisp centered foreground
                filterComplexArg = `[0:v]${baseFilters}split=2[fg_raw][bg_raw];` +
                    `[bg_raw]scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920,boxblur=25:5[bg];` +
                    `[fg_raw]scale=1080:1920:force_original_aspect_ratio=decrease:flags=lanczos[fg];` +
                    `[bg][fg]overlay=(W-w)/2:(H-h)/2[v_out]`;
            }
            else if (plan.filters.aspectRatioStrategy === 'fit') {
                // Fits video in 1080x1920 with black bars
                filterParts.push('scale=1080:1920:force_original_aspect_ratio=decrease:flags=lanczos');
                filterParts.push('pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black');
                simpleVfArg = filterParts.join(',');
            }
            else if (plan.filters.aspectRatioStrategy === 'crop' || plan.filters.aspectRatioStrategy === 'smart_crop') {
                // Crops center to 1080x1920
                filterParts.push('scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos');
                filterParts.push('crop=1080:1920');
                simpleVfArg = filterParts.join(',');
            }
            else {
                // Preserve landscape aspect ratio inside 1080x1920 canvas
                filterParts.push('scale=1080:1920:force_original_aspect_ratio=decrease:flags=lanczos');
                filterParts.push('pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black');
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
        // If preview, limit duration
        if (isPreview) {
            args.push('-ss', '0', '-t', String(previewDuration));
        }
        args.push('-i', inputPath);
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
            args.push('-c:v', 'h264_nvenc', '-preset', plan.config.mode === 'fast' ? 'p3' : 'p6', '-tune', 'hq', '-rc', 'vbr', '-cq', String(plan.encoding.crf), '-b:v', `${plan.encoding.videoBitrateKbps}k`, '-maxrate', `${Math.round(plan.encoding.videoBitrateKbps * 1.4)}k`, '-bufsize', `${Math.round(plan.encoding.videoBitrateKbps * 2)}k`, '-profile:v', 'high', '-pix_fmt', 'yuv420p');
        }
        else {
            args.push('-c:v', 'libx264', '-preset', plan.encoding.preset, '-crf', String(plan.encoding.crf), '-maxrate', `${Math.round(plan.encoding.videoBitrateKbps * 1.3)}k`, '-bufsize', `${Math.round(plan.encoding.videoBitrateKbps * 2)}k`, '-profile:v', 'high', '-level', '4.2', '-pix_fmt', 'yuv420p');
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
            proc.stderr.on('data', (chunk) => {
                const text = chunk.toString();
                stderrBuffer += text;
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
                this.activeProcesses.delete(jobId);
                reject(err);
            });
            proc.on('close', (code, signal) => {
                this.activeProcesses.delete(jobId);
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
                    reject(new Error(`FFmpeg exited with code ${code}. Error: ${tailError}`));
                }
            });
        });
    }
}
