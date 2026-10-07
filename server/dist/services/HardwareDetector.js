import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
const execAsync = promisify(exec);
export class HardwareDetector {
    static cachedInfo = null;
    static async detect() {
        if (this.cachedInfo) {
            return this.cachedInfo;
        }
        const cpuCores = os.cpus().length;
        const freeMemoryMB = Math.round(os.freemem() / (1024 * 1024));
        let hasNvidiaGpu = false;
        let gpuName;
        // Check nvidia-smi
        try {
            const { stdout } = await execAsync('nvidia-smi --query-gpu=name --format=csv,noheader', { timeout: 3000 });
            if (stdout && stdout.trim().length > 0) {
                hasNvidiaGpu = true;
                gpuName = stdout.trim().split('\n')[0]?.trim();
            }
        }
        catch {
            hasNvidiaGpu = false;
        }
        // Check ffmpeg -encoders
        const encoders = {
            nvenc_h264: false,
            nvenc_hevc: false,
            qsv_h264: false,
            amf_h264: false,
            cpu_x264: true,
        };
        try {
            const { stdout } = await execAsync('ffmpeg -encoders', { timeout: 5000 });
            encoders.nvenc_h264 = stdout.includes('h264_nvenc');
            encoders.nvenc_hevc = stdout.includes('hevc_nvenc');
            encoders.qsv_h264 = stdout.includes('h264_qsv');
            encoders.amf_h264 = stdout.includes('h264_amf');
            encoders.cpu_x264 = stdout.includes('libx264');
        }
        catch (err) {
            console.warn('Could not query ffmpeg -encoders:', err);
        }
        let recommendedEncoder = 'libx264';
        if (hasNvidiaGpu && encoders.nvenc_h264) {
            recommendedEncoder = 'h264_nvenc';
        }
        else if (encoders.qsv_h264) {
            recommendedEncoder = 'h264_qsv';
        }
        else if (encoders.amf_h264) {
            recommendedEncoder = 'h264_amf';
        }
        this.cachedInfo = {
            hasNvidiaGpu,
            gpuName,
            encoders,
            recommendedEncoder,
            cpuCores,
            freeMemoryMB,
        };
        return this.cachedInfo;
    }
}
