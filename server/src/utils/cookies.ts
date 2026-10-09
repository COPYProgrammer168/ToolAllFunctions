import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Cookie file resolution for platform downloads.
 *
 * Deployments mount a logged-in `cookies.txt` as a secret file, e.g. a Render
 * secret file at `/etc/secrets/cookies.txt`. The path comes from
 * `YT_COOKIES_FILE` and defaults to `/etc/secrets/cookies.txt`.
 *
 * yt-dlp rewrites the jar it is given, so the secret is **copied** to
 * `/tmp/yt-cookies.txt` once at startup and the copy is what gets handed to
 * yt-dlp / the providers — the mounted secret is never modified.
 *
 * Nothing here ever logs cookie contents; only the resolved path and its size
 * are printed.
 */

/** Env var holding the path of the Netscape cookies file. */
export const COOKIES_ENV_VAR = 'YT_COOKIES_FILE';
/** Default location (Render secret files are mounted here). */
export const DEFAULT_COOKIES_PATH = '/etc/secrets/cookies.txt';
/** Read/write working copy derived from the configured file. */
export const COOKIES_WORKING_PATH = path.join(os.tmpdir(), 'yt-cookies.txt');

let resolvedPath: string | undefined;

function isReadableFile(p?: string | null): p is string {
  if (!p) return false;
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Paths to look at, in priority order. */
export function cookieFileCandidates(): string[] {
  const fromEnv = [process.env[COOKIES_ENV_VAR], process.env.YT_COOKIES, process.env.TT_COOKIES].filter(Boolean) as string[];
  return [...fromEnv, DEFAULT_COOKIES_PATH].map((p) => path.resolve(p));
}

/**
 * Resolve the cookie file and refresh the `/tmp` working copy. Idempotent, safe
 * to call at startup and again lazily before a download.
 */
export function prepareCookiesFile(): string | undefined {
  for (const source of cookieFileCandidates()) {
    if (!isReadableFile(source)) continue;

    if (path.resolve(source) === path.resolve(COOKIES_WORKING_PATH)) {
      resolvedPath = source;
      return source;
    }

    // Already copied this process — keep using the working copy and leave the
    // mounted secret untouched.
    if (resolvedPath === COOKIES_WORKING_PATH && isReadableFile(COOKIES_WORKING_PATH)) {
      return resolvedPath;
    }

    try {
      fs.copyFileSync(source, COOKIES_WORKING_PATH);
      try {
        fs.chmodSync(COOKIES_WORKING_PATH, 0o600);
      } catch {}
      resolvedPath = COOKIES_WORKING_PATH;
      const bytes = fs.statSync(COOKIES_WORKING_PATH).size;
      // Path + size only — never the file contents.
      console.log(`[cookies] session file loaded (${bytes} bytes) -> ${COOKIES_WORKING_PATH}`);
      return resolvedPath;
    } catch {
      // Unreadable source: fall through to the next candidate.
    }
  }

  // No configured file available right now; only reuse a working copy this
  // process created itself (never a stale one from an earlier run).
  if (resolvedPath === COOKIES_WORKING_PATH && isReadableFile(COOKIES_WORKING_PATH)) {
    return resolvedPath;
  }
  return undefined;
}

/** Path of the cookie file to hand to yt-dlp, or `undefined` when none exists. */
export function findCookiesFile(): string | undefined {
  return prepareCookiesFile();
}

// Resolve as soon as the module is imported (see server.ts) so the working copy
// exists before the first download.
prepareCookiesFile();
