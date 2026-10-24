import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Optional `yt-dlp` support.
 *
 * yt-dlp is *not* a dependency of this app — when it is installed (locally, or
 * in a container image that adds it) it is used as the last-resort extractor
 * for platforms whose public player metadata stops resolving (age gates,
 * consent walls, embedded-player-only playback).
 * Everything returns `null` / degrades gracefully when it is absent.
 */

/** How to invoke yt-dlp on this host. */
export interface YtDlpInvocation {
  /** Executable to spawn. */
  command: string;
  /** Arguments that must precede the yt-dlp arguments (e.g. `-m yt_dlp`). */
  prefixArgs: string[];
}

/** Locate an optional yt-dlp binary. Returns `null` when it is not installed,
 *  which is the normal case on a stock native Node host. */
export function findYtDlp(): string | null {
  const candidates = [
    process.env.YT_DLP_PATH,
    'yt-dlp',
    'yt-dlp.exe',
    path.join(os.homedir(), '.local', 'bin', 'yt-dlp'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'Python', 'Python314', 'Scripts', 'yt-dlp.exe'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'Python', 'Python313', 'Scripts', 'yt-dlp.exe'),
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python313', 'Scripts', 'yt-dlp.exe'),
    path.join(os.homedir(), '.pyenv', 'shims', 'yt-dlp'),
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    try {
      if (c === 'yt-dlp' || c === 'yt-dlp.exe') {
        // Bare command names must actually be resolvable on PATH.
        const pathVar = process.env.PATH || '';
        const found = pathVar
          .split(path.delimiter)
          .filter(Boolean)
          .some((dir) => fs.existsSync(path.join(dir, c)));
        if (found) return c;
        continue;
      }
      if (fs.existsSync(c)) return c;
    } catch {}
  }
  return null;
}

/**
 * True when a Python interpreter can run `python -m yt_dlp` on this host.
 *
 * `pip3 install yt-dlp` does not always put a binary on PATH (notably on
 * Windows user installs and stripped container images) — the module itself is
 * importable and runnable, which used to be invisible to this app and silently
 * disabled the last-resort extractor.
 */
const pythonModuleCache = new Map<string, boolean>();

async function hasYtDlpPythonModule(pythonCommand: string): Promise<boolean> {
  const cached = pythonModuleCache.get(pythonCommand);
  if (cached !== undefined) return cached;
  try {
    await execFileAsync(pythonCommand, ['-c', 'import yt_dlp'], { timeout: 15_000 });
    pythonModuleCache.set(pythonCommand, true);
    return true;
  } catch {
    pythonModuleCache.set(pythonCommand, false);
    return false;
  }
}

/**
 * Resolve how to invoke yt-dlp: a dedicated binary when one exists, otherwise
 * `python -m yt_dlp`. The result is memoized after the first success so the
 * module probe (a subprocess spawn) happens at most a couple of times per host.
 */
let invocationCache: YtDlpInvocation | null | undefined;

export async function findYtDlpInvocation(): Promise<YtDlpInvocation | null> {
  if (invocationCache !== undefined) return invocationCache;

  const binary = findYtDlp();
  if (binary) {
    invocationCache = { command: binary, prefixArgs: [] };
    return invocationCache;
  }

  for (const pythonCommand of ['python', 'python3', 'py']) {
    if (await hasYtDlpPythonModule(pythonCommand)) {
      invocationCache = { command: pythonCommand, prefixArgs: ['-m', 'yt_dlp'] };
      return invocationCache;
    }
  }

  invocationCache = null;
  return null;
}

/** True when yt-dlp is usable on this host (optional dependency). */
export async function hasYtDlp(): Promise<boolean> {
  return (await findYtDlpInvocation()) !== null;
}

/** Flatten a Netscape cookie jar into a single `Cookie` request header. */
export function readCookieJarHeader(jarPath: string): string {
  try {
    if (!fs.existsSync(jarPath)) return '';
    return fs
      .readFileSync(jarPath, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const parts = line.split('\t');
        return parts.length >= 7 && parts[5] ? `${parts[5]}=${parts[6]}` : '';
      })
      .filter(Boolean)
      .join('; ');
  } catch {
    return '';
  }
}

/** A throwaway cookie jar yt-dlp can write its session cookies into. */
export function tempCookieJar(): string {
  return path.join(os.tmpdir(), `yt-dlp-cookies-${process.pid}-${Date.now()}.txt`);
}

/**
 * A current browser User-Agent. Stream URLs handed out by a platform are
 * sometimes bound to the UA that requested them, so replay them with this one.
 */
export const YTDLP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export interface YtDlpDownloadOptions {
  url: string;
  outputPath: string;
  type: 'video' | 'audio' | 'image';
  format?: string;
  customBitrate?: number;
  onProgress?: (progress: { percent?: number; downloadedBytes?: number; totalBytes?: number; stageName?: string }) => void;
}

/**
 * Downloads and converts media directly using yt-dlp.
 * Excellent fallback when platform API scraping or direct token extraction fails.
 */
export async function downloadWithYtDlp(opts: YtDlpDownloadOptions): Promise<string> {
  const invocation = await findYtDlpInvocation();
  if (!invocation) {
    throw new Error('yt-dlp is not available on this server');
  }

  const { spawn } = await import('node:child_process');
  const { findCookiesFile } = await import('./cookies.js');
  const { ytdlpProxyArgs } = await import('./proxy.js');
  const { ffmpegBin } = await import('./binaries.js');

  const outDir = path.dirname(opts.outputPath);
  await fs.promises.mkdir(outDir, { recursive: true });
  const baseName = path.basename(opts.outputPath, path.extname(opts.outputPath));
  const tempTemplate = path.join(outDir, `${baseName}.%(ext)s`);

  const cookies = findCookiesFile();
  const args: string[] = [
    ...invocation.prefixArgs,
    ...ytdlpProxyArgs(),
    '--no-warnings',
    '--newline',
    '--no-playlist',
    '--user-agent',
    YTDLP_UA,
  ];

  if (cookies) {
    args.push('--cookies', cookies);
  }

  const ffmpegPath = ffmpegBin();
  if (ffmpegPath && ffmpegPath !== 'ffmpeg') {
    args.push('--ffmpeg-location', path.dirname(ffmpegPath));
  }

  if (opts.type === 'audio') {
    args.push('-x');
    const targetFormat = opts.format && opts.format !== 'original' ? opts.format : 'mp3';
    args.push('--audio-format', targetFormat);
    const bitrate = opts.customBitrate && opts.customBitrate > 0 ? opts.customBitrate : 320;
    args.push('--audio-quality', `${bitrate}k`);
  } else if (opts.type === 'video') {
    const targetFormat = opts.format && opts.format !== 'original' ? opts.format : 'mp4';
    args.push('-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best');
    args.push('--merge-output-format', targetFormat);
  }

  args.push('-o', tempTemplate, opts.url);

  return new Promise<string>((resolve, reject) => {
    const child = spawn(invocation.command, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    let lastPercent = 0;

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      const lines = text.split(/\r?\n/);
      for (const line of lines) {
        const percentMatch = line.match(/\[download\]\s+([\d.]+)%/);
        if (percentMatch) {
          const percent = parseFloat(percentMatch[1]);
          if (!isNaN(percent) && percent !== lastPercent) {
            lastPercent = percent;
            opts.onProgress?.({
              percent,
              stageName: `Downloading ${opts.type} (${Math.round(percent)}%)…`,
            });
          }
        } else if (line.includes('[ExtractAudio]')) {
          opts.onProgress?.({
            percent: 95,
            stageName: 'Extracting high-quality audio (320 kbps)…',
          });
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      reject(err);
    });

    child.on('close', async (code) => {
      if (code !== 0) {
        return reject(new Error(`yt-dlp process failed with exit code ${code}: ${stderr.slice(-500)}`));
      }

      try {
        // Check if output path exists as-is
        if (fs.existsSync(opts.outputPath)) {
          return resolve(opts.outputPath);
        }

        // Look for any file in outDir starting with baseName
        const files = await fs.promises.readdir(outDir);
        const match = files.find((f) => f.startsWith(`${baseName}.`) && !f.endsWith('.part') && !f.endsWith('.ytdl'));
        if (match) {
          const resolvedFile = path.join(outDir, match);
          // If file extension differs from requested outputPath, rename or return
          if (resolvedFile !== opts.outputPath) {
            try {
              await fs.promises.rename(resolvedFile, opts.outputPath);
              return resolve(opts.outputPath);
            } catch {
              return resolve(resolvedFile);
            }
          }
          return resolve(resolvedFile);
        }

        reject(new Error(`yt-dlp completed successfully but output file was not found in ${outDir}`));
      } catch (err) {
        reject(err);
      }
    });
  });
}

