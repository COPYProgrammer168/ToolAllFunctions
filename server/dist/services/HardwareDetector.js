import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import fs from 'node:fs';
const execAsync = promisify(exec);
export class HardwareDetector {
    static cachedInfo = null;
    static cachedMemoryBudgetMB = null;
    /**
     * Real memory budget for THIS instance.
     *
     * `os.totalmem()` reports the *host's* RAM inside a container, so a Render
     * free tier (512MB cgroup limit) lies about having gigabytes. Read the
     * cgroup limit first (v2 then v1), honour the MEMORY_LIMIT_MB override, and
     * only fall back to `os.totalmem()` on bare-metal. Caches the result.
     */
    static memoryBudgetMB() {
        if (this.cachedMemoryBudgetMB !== null) {
            return this.cachedMemoryBudgetMB;
        }
        let bytes = 0;
        const envMB = Number.parseInt(process.env.MEMORY_LIMIT_MB ?? '', 10);
        if (Number.isFinite(envMB) && envMB > 0) {
            // The override is expressed in MB already...
            bytes = envMB * 1024 * 1024;
        }
        else {
            // cgroup v2 (most modern Linux incl. Render/Docker): "max" means unset.
            bytes = this.readCgroupMemoryBytes(['/sys/fs/cgroup/memory.max']);
            if (!bytes) {
                // cgroup v1 layout.
                bytes = this.readCgroupMemoryBytes([
                    '/sys/fs/cgroup/memory/memory.limit_in_bytes',
                ]);
            }
            // Sanity check: values near (1<<52)+ are "no limit" sentinels on v1.
            if (bytes && bytes > (1 << 42)) {
                bytes = 0;
            }
        }
        if (!bytes) {
            bytes = os.totalmem();
        }
        this.cachedMemoryBudgetMB = Math.max(64, Math.round(bytes / (1024 * 1024)));
        return this.cachedMemoryBudgetMB;
    }
    static readCgroupMemoryBytes(files) {
        for (const file of files) {
            try {
                const raw = fs.readFileSync(file, 'utf8').trim();
                const bytes = Number.parseInt(raw, 10);
                if (Number.isFinite(bytes) && bytes > 0)
                    return bytes;
            }
            catch { }
        }
        return 0;
    }
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
    /**
     * Resident memory of a process in MB. Reads `/proc` on Linux (where hosted
     * containers run) and returns 0 when the information is unavailable.
     */
    static processRssMB(pid) {
        if (process.platform !== 'linux')
            return 0;
        try {
            const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
            const match = status.match(/^VmRSS:\s+(\d+)\s+kB$/m);
            return match ? Math.round(Number(match[1]) / 1024) : 0;
        }
        catch {
            return 0;
        }
    }
    /**
     * Per-ffmpeg memory ceiling for the watchdog. Leaves headroom for the Node
     * process, SQLite, and the OS sharing the same cgroup. Returns 0 on large
     * instances where no watchdog is needed.
     */
    static ffmpegMemoryLimitMB() {
        const budget = this.memoryBudgetMB();
        if (budget >= 4096)
            return 0;
        return Math.max(128, Math.min(Math.round(budget * 0.7), budget - 192));
    }
    /**
     * Conservative ffmpeg encoder thread budget for the current host. x264
     * frame buffers scale with thread count, so the default `-threads 0`
     * (every host core) OOM-kills small instances — Render free tier exposes
     * the host's 16+ cores but only ~512MB RAM. Scale by the *cgroup* memory
     * budget (`memoryBudgetMB()`), capped by the visible core count.
     */
    static threadBudget() {
        const totalMB = this.memoryBudgetMB();
        const cores = os.cpus().length;
        const byMemory = totalMB <= 1024 ? 1 : totalMB <= 2048 ? 2 : totalMB <= 4096 ? 4 : 8;
        return Math.max(1, Math.min(byMemory, cores));
    }
}
