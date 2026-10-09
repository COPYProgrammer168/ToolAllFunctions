import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

/**
 * Cross-platform ffmpeg/ffprobe resolution.
 *
 * Render (and most Linux PaaS) native Node environments do NOT ship ffmpeg,
 * and Windows boxes often do. Rather than shelling out to a hard-coded binary
 * name and hoping, we:
 *
 *   1. Honour explicit FFmpeg_PATH / FFprobe_PATH overrides.
 *   2. Use whatever is already on PATH (local dev, Docker image, CI).
 *   3. Fall back to the `ffmpeg-static` / `ffprobe-static` npm packages so the
 *      app works on a stock Render native instance with zero system packages.
 *
 * Once resolved, the directories are prepended to PATH so that every existing
 * `exec('ffmpeg ...')` / `exec('ffprobe ...')` call site keeps working without
 * being rewritten.
 */

const requireModule = createRequire(import.meta.url);

let bootstrapped = false;

function fileExists(p?: string | null): boolean {
  if (!p) return false;
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

/** Look for an executable on the current PATH (Windows-aware). */
export function findOnPath(bin: string): string | null {
  const pathVar = process.env.PATH || process.env.Path || '';
  const extensions =
    process.platform === 'win32'
      ? ['', '.exe', '.cmd', '.bat']
      : [''];
  for (const dir of pathVar.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of extensions) {
      const candidate = path.join(dir, `${bin}${ext}`);
      if (fileExists(candidate)) return candidate;
    }
  }
  return null;
}

function loadStaticBinary(pkg: 'ffmpeg-static' | 'ffprobe-static'): string | null {
  try {
    const mod = requireModule(pkg);
    const value = typeof mod === 'string' ? mod : (mod?.default ?? mod?.path ?? null);
    return typeof value === 'string' && fileExists(value) ? value : null;
  } catch {
    return null;
  }
}

function resolveTool(bin: 'ffmpeg' | 'ffprobe'): string | null {
  const envOverride = bin === 'ffmpeg' ? process.env.FFMPEG_PATH : process.env.FFPROBE_PATH;
  if (fileExists(envOverride)) return envOverride!;
  const onPath = findOnPath(bin);
  if (onPath) return onPath;
  return loadStaticBinary(bin === 'ffmpeg' ? 'ffmpeg-static' : 'ffprobe-static');
}

/**
 * Make `ffmpeg` / `ffprobe` resolvable for every shell invocation in the app.
 * Safe to call more than once.
 */
export function bootstrapBinaryPath(): void {
  if (bootstrapped) return;
  bootstrapped = true;

  const added: string[] = [];

  if (!findOnPath('ffmpeg')) {
    const staticFfmpeg = resolveTool('ffmpeg');
    if (staticFfmpeg) {
      process.env.FFMPEG_PATH ||= staticFfmpeg;
      added.push(path.dirname(staticFfmpeg));
      console.log(`[binaries] ffmpeg not on PATH — using ${staticFfmpeg}`);
    } else {
      console.warn('[binaries] ffmpeg could not be found (PATH or ffmpeg-static). Video processing will fail.');
    }
  }

  if (!findOnPath('ffprobe')) {
    const staticFfprobe = resolveTool('ffprobe');
    if (staticFfprobe) {
      process.env.FFPROBE_PATH ||= staticFfprobe;
      added.push(path.dirname(staticFfprobe));
      console.log(`[binaries] ffprobe not on PATH — using ${staticFfprobe}`);
    } else {
      console.warn('[binaries] ffprobe could not be found (PATH or ffprobe-static). Stream probing will fail.');
    }
  }

  if (added.length > 0) {
    const unique = [...new Set(added)];
    process.env.PATH = [...unique, process.env.PATH || ''].join(path.delimiter);
  }
}

/** Absolute path (or bare command name) to use for ffmpeg invocations. */
export function ffmpegBin(): string {
  bootstrapBinaryPath();
  return process.env.FFMPEG_PATH || 'ffmpeg';
}

/** Absolute path (or bare command name) to use for ffprobe invocations. */
export function ffprobeBin(): string {
  bootstrapBinaryPath();
  return process.env.FFPROBE_PATH || 'ffprobe';
}

// Resolve as soon as the module is imported so late imports still benefit.
bootstrapBinaryPath();
