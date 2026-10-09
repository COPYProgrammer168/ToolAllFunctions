/**
 * Server-side cache for the per-session headers/cookies a platform stream URL
 * was resolved with.
 *
 * TikTok's `playAddr` is signed against the `tt_chain_token` cookie that is
 * issued alongside the HTML page that exposed it, so replaying the URL without
 * those cookies returns HTTP 403. The analysis endpoint records the
 * credentials here and the stream proxy + download worker look them up again
 * when the bytes are actually fetched.
 *
 * Entries expire after `DEFAULT_TTL_MS` because the signatures themselves are
 * short-lived.
 */

export interface StreamCredentials {
  cookie?: string;
  userAgent?: string;
  referer?: string;
  origin?: string;
  /** Extra platform specific headers, e.g. TikTok's required Accept. */
  headers?: Record<string, string>;
}

interface CacheEntry {
  credentials: StreamCredentials;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 45 * 60 * 1000;

const cache = new Map<string, CacheEntry>();

/** Drop expired entries so the map cannot grow without bound. */
function prune(now = Date.now()): void {
  if (cache.size < 500) {
    for (const [key, entry] of cache) {
      if (entry.expiresAt <= now) cache.delete(key);
    }
    return;
  }
  for (const [key, entry] of [...cache]) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
}

function keyFor(url: string): string[] {
  try {
    const parsed = new URL(url);
    // Exact URL first, then origin+path so ranged/re-encoded variants match.
    return [url, `${parsed.origin}${parsed.pathname}`];
  } catch {
    return [url];
  }
}

export function rememberStreamCredentials(
  url: string,
  credentials: StreamCredentials,
  ttlMs: number = DEFAULT_TTL_MS
): void {
  if (!url || !credentials) return;
  prune();
  const expiresAt = Date.now() + ttlMs;
  for (const key of keyFor(url)) {
    cache.set(key, { credentials, expiresAt });
  }
}

export function getStreamCredentials(url: string): StreamCredentials | undefined {
  if (!url) return undefined;
  const now = Date.now();
  for (const key of keyFor(url)) {
    const entry = cache.get(key);
    if (!entry) continue;
    if (entry.expiresAt <= now) {
      cache.delete(key);
      continue;
    }
    return entry.credentials;
  }
  return undefined;
}

/**
 * Build request headers for a remote media stream: platform credentials when
 * we have them, a browser-like User-Agent otherwise, plus TikTok's mandatory
 * Referer/Origin when the CDN requires them.
 */
export function buildStreamHeaders(
  url: string,
  extra: Record<string, string> = {}
): Record<string, string> {
  const creds = getStreamCredentials(url);
  const headers: Record<string, string> = {
    'User-Agent':
      creds?.userAgent ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    ...extra,
  };

  if (creds?.cookie) headers.Cookie = creds.cookie;
  if (creds?.referer) headers.Referer = creds.referer;
  if (creds?.origin) headers.Origin = creds.origin;
  if (creds?.headers) Object.assign(headers, creds.headers);

  // TikTok / TikTok CDN rejects anonymous requests without a TikTok referer.
  if (!creds && /tiktok|tikcdn/i.test(url)) {
    headers.Referer = 'https://www.tiktok.com/';
    headers.Origin = 'https://www.tiktok.com';
  }

  return headers;
}
