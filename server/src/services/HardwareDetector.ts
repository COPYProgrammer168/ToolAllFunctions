import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import type { HardwareInfo } from '../types/index.js';

const execAsync = promisify(exec);

const MIB = 1024 * 1024;
/**
 * cgroup v1 reports values near 2^63-1 when the limit is unset. Anything this
 * large is a sentinel, not a real memory budget. NOTE: `1 << 42` is NOT 2^42
 * in JavaScript — bitwise operators are 32-bit and it evaluates to 1024, which
 * previously discarded every real cgroup limit and let the planner believe a
 * 512MB Render instance had the host's 11GB.
 */
const CGROUP_UNLIMITED_BYTES = 2 ** 42;

export class HardwareDetector {
  private static cachedInfo: HardwareInfo | null = null;
  private static cachedMemoryBudgetMB: number | null = null;
  private static cachedMemoryBudgetSource = 'unknown';

  /**
   * Real memory budget for THIS instance.
   *
   * `os.totalmem()` reports the *host's* RAM inside a container, so a Render
   * free tier (512MB cgroup limit) lies about having gigabytes. Read the
   * cgroup limit first (v2 then v1), honour the MEMORY_LIMIT_MB override, and
   * only fall back to `os.totalmem()` on bare-metal. Caches the result.
   */
  public static memoryBudgetMB(): number {
    if (this.cachedMemoryBudgetMB !== null) {
      return this.cachedMemoryBudgetMB;
    }

    const envMB = Number.parseInt(process.env.MEMORY_LIMIT_MB ?? '', 10);
    if (Number.isFinite(envMB) && envMB > 0) {
      this.cachedMemoryBudgetSource = 'MEMORY_LIMIT_MB';
      this.cachedMemoryBudgetMB = Math.max(64, envMB);
      return this.cachedMemoryBudgetMB;
    }

    // Node 20+ asks libuv for the cgroup/OS limit directly. This works even
    // when the cgroup files are not visible at the usual mount paths.
    const constrainedBytes =
      typeof process.constrainedMemory === 'function' ? process.constrainedMemory() : 0;
    if (constrainedBytes > 0 && constrainedBytes < CGROUP_UNLIMITED_BYTES) {
      this.cachedMemoryBudgetSource = 'process.constrainedMemory';
      this.cachedMemoryBudgetMB = Math.max(64, Math.round(constrainedBytes / MIB));
      return this.cachedMemoryBudgetMB;
    }

    const cgroupBytes = this.readCgroupMemoryLimitBytes();
    if (cgroupBytes > 0) {
      this.cachedMemoryBudgetSource = 'cgroup';
      this.cachedMemoryBudgetMB = Math.max(64, Math.round(cgroupBytes / MIB));
      return this.cachedMemoryBudgetMB;
    }

    // Container/hosted environments often do not expose the cgroup files (or
    // hide them behind a different path). Never trust the host's total RAM
    // there: that is how a 512MB Render instance planned a ~1.1GB MCI
    // pipeline and got OOM-killed, surfacing as SSE drops + 502s.
    if (this.isContainerizedHost()) {
      this.cachedMemoryBudgetSource = 'hosted-default';
      this.cachedMemoryBudgetMB = 512;
      return this.cachedMemoryBudgetMB;
    }

    this.cachedMemoryBudgetSource = 'os.totalmem';
    this.cachedMemoryBudgetMB = Math.max(64, Math.round(os.totalmem() / MIB));
    return this.cachedMemoryBudgetMB;
  }

  /** Where `memoryBudgetMB()` got its number (useful in `/health`). */
  public static memoryBudgetSource(): string {
    if (this.cachedMemoryBudgetMB === null) {
      this.memoryBudgetMB();
    }
    return this.cachedMemoryBudgetSource;
  }

  /**
   * Reads the cgroup limit for this process, walking the nested v2/v1 path
   * from `/proc/self/cgroup` before falling back to the mount roots.
   */
  private static readCgroupMemoryLimitBytes(): number {
    const candidates: string[] = [];

    try {
      const self = fs.readFileSync('/proc/self/cgroup', 'utf8');

      // cgroup v2: "0::/user.slice/.../app.scope"
      const v2Match = self.match(/^0::(.+)$/m);
      if (v2Match) {
        let dir = path.posix.join('/sys/fs/cgroup', v2Match[1].trim());
        while (dir.startsWith('/sys/fs/cgroup')) {
          candidates.push(path.posix.join(dir, 'memory.max'));
          if (dir === '/sys/fs/cgroup') break;
          dir = path.posix.dirname(dir);
        }
      }

      // cgroup v1: "5:memory:/docker/<id>"
      const v1Match = self.match(/^\d+:memory:(.+)$/m);
      if (v1Match) {
        let dir = path.posix.join('/sys/fs/cgroup/memory', v1Match[1].trim());
        while (dir.startsWith('/sys/fs/cgroup/memory')) {
          candidates.push(path.posix.join(dir, 'memory.limit_in_bytes'));
          if (dir === '/sys/fs/cgroup/memory') break;
          dir = path.posix.dirname(dir);
        }
      }
    } catch {}

    candidates.push(
      '/sys/fs/cgroup/memory.max',
      '/sys/fs/cgroup/memory/memory.limit_in_bytes'
    );

    for (const file of new Set(candidates)) {
      const bytes = this.readMemoryLimitFile(file);
      if (bytes > 0) return bytes;
    }
    return 0;
  }

  private static readMemoryLimitFile(file: string): number {
    try {
      const raw = fs.readFileSync(file, 'utf8').trim();
      if (!raw || raw === 'max') return 0;
      const bytes = Number.parseInt(raw, 10);
      if (!Number.isFinite(bytes) || bytes <= 0) return 0;
      if (bytes >= CGROUP_UNLIMITED_BYTES) return 0;
      return bytes;
    } catch {
      return 0;
    }
  }

  /** True when `os.totalmem()` is the host's RAM, not this process's budget. */
  private static isContainerizedHost(): boolean {
    const env = process.env;
    if (env.RENDER || env.RENDER_SERVICE_ID || env.RENDER_INSTANCE_ID) return true;
    if (env.DYNO || env.FLY_APP_NAME || env.RAILWAY_ENVIRONMENT || env.RAILWAY_PROJECT_ID) return true;
    if (env.K_SERVICE || env.CLOUD_RUN_JOB || env.VERCEL || env.AWS_LAMBDA_FUNCTION_NAME) return true;

    try {
      if (fs.existsSync('/.dockerenv')) return true;
    } catch {}

    try {
      const cgroup = fs.readFileSync('/proc/1/cgroup', 'utf8');
      if (/docker|kubepods|containerd|garden|ecs|fargate/i.test(cgroup)) return true;
    } catch {}

    return false;
  }

  public static async detect(): Promise<HardwareInfo> {
    if (this.cachedInfo) {
      return this.cachedInfo;
    }

    const cpuCores = os.cpus().length;
    const freeMemoryMB = Math.round(os.freemem() / (1024 * 1024));

    let hasNvidiaGpu = false;
    let gpuName: string | undefined;

    // Check nvidia-smi
    try {
      const { stdout } = await execAsync('nvidia-smi --query-gpu=name --format=csv,noheader', { timeout: 3000 });
      if (stdout && stdout.trim().length > 0) {
        hasNvidiaGpu = true;
        gpuName = stdout.trim().split('\n')[0]?.trim();
      }
    } catch {
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
    } catch (err) {
      console.warn('Could not query ffmpeg -encoders:', err);
    }

    let recommendedEncoder = 'libx264';
    if (hasNvidiaGpu && encoders.nvenc_h264) {
      recommendedEncoder = 'h264_nvenc';
    } else if (encoders.qsv_h264) {
      recommendedEncoder = 'h264_qsv';
    } else if (encoders.amf_h264) {
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
  public static processRssMB(pid: number): number {
    if (process.platform !== 'linux') return 0;
    try {
      const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
      const match = status.match(/^VmRSS:\s+(\d+)\s+kB$/m);
      return match ? Math.round(Number(match[1]) / 1024) : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Per-ffmpeg memory ceiling for the watchdog. Leaves headroom for the Node
   * process, SQLite, and the OS sharing the same cgroup. Returns 0 on large
   * instances where no watchdog is needed.
   */
  public static ffmpegMemoryLimitMB(): number {
    const budget = this.memoryBudgetMB();
    if (budget >= 4096) return 0;
    return Math.max(128, Math.min(Math.round(budget * 0.7), budget - 192));
  }

  /**
   * Conservative ffmpeg encoder thread budget for the current host. x264
   * frame buffers scale with thread count, so the default `-threads 0`
   * (every host core) OOM-kills small instances — Render free tier exposes
   * the host's 16+ cores but only ~512MB RAM. Scale by the *cgroup* memory
   * budget (`memoryBudgetMB()`), capped by the visible core count.
   */
  public static threadBudget(): number {
    const totalMB = this.memoryBudgetMB();
    const cores = os.cpus().length;
    const byMemory =
      totalMB <= 1024 ? 1 : totalMB <= 2048 ? 2 : totalMB <= 4096 ? 4 : 8;
    return Math.max(1, Math.min(byMemory, cores));
  }
}
