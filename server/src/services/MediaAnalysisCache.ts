import type { MediaAnalysisResult } from './providers/MediaProvider.js';

/**
 * Short-lived cache + in-flight de-duplication for media analysis results.
 *
 * Every user action (Analyze, Preview, Play, Download) used to re-run the full
 * provider extraction, so a single click issued the watch-page fetch and the
 * Innertube player calls again — the duplicate traffic is what got the server
 * IP rate-limited by YouTube.
 *
 * Results are cached for `ANALYSIS_CACHE_TTL_MS` (10 minutes by default) and
 * concurrent requests for the same key share one in-flight fetch, so N clicks
 * on the same URL cost exactly one upstream round-trip.
 */

export const ANALYSIS_CACHE_TTL_MS = (() => {
  const raw = process.env.ANALYSIS_CACHE_TTL_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10 * 60 * 1000;
})();

/** Never cache more than this many entries; older ones are swept lazily. */
const MAX_ENTRIES = 500;

interface CacheEntry {
  result: MediaAnalysisResult;
  expiresAt: number;
}

/**
 * Normalizes a URL into a stable cache key so that the same resource requested
 * through different link forms (e.g. `youtu.be/ID`, `/watch?v=ID`,
 * `/shorts/ID`, or with `utm_*` tracking suffixes) hits one cache entry.
 */
export function analysisCacheKey(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return rawUrl.trim();
  }

  const host = parsed.hostname.replace(/^www\./i, '').replace(/^m\./i, '').toLowerCase();

  // YouTube: one key per video, regardless of the link form.
  if (host === 'youtube.com' || host === 'youtu.be') {
    const fromQuery = parsed.searchParams.get('v');
    const fromPath =
      parsed.pathname.match(/\/(?:shorts|embed|v|live)\/([\w-]{11})/)?.[1] ||
      (host === 'youtu.be' ? parsed.pathname.replace(/^\//, '').split('/')[0] : undefined);
    const videoId = fromQuery || fromPath;
    if (videoId && /^[\w-]{11}$/.test(videoId)) return `youtube:${videoId}`;
  }

  // Everything else: drop tracking-only query params so clipboard links with
  // `?si=...&utm_source=...` (SoundCloud, Pinterest, TikTok) collapse.
  for (const key of [...parsed.searchParams.keys()]) {
    if (key.startsWith('utm_') || ['si', 'feature', 'igsh', 'igshid', 'fbclid', 'ref'].includes(key)) {
      parsed.searchParams.delete(key);
    }
  }

  const path = parsed.pathname.replace(/\/+$/, '') || '/';
  return `${host}${path}${parsed.search}`;
}

/**
 * A result is only worth caching when it is usable. A failure response (nothing
 * authorized, no tracks) means "this attempt found nothing", and replaying that
 * for 10 minutes would make a transient upstream failure look permanent.
 */
function isCacheWorthy(result: MediaAnalysisResult): boolean {
  return result.downloadAuthorized === true || (result.tracks?.length ?? 0) > 0;
}

class AnalysisCache {
  private entries = new Map<string, CacheEntry>();
  private inflight = new Map<string, Promise<MediaAnalysisResult>>();

  /** Fresh cache hit, or `undefined` on miss / expiry. */
  get(key: string): MediaAnalysisResult | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.result;
  }

  /**
   * Runs `producer` unless an identical request is already in flight (that
   * promise is shared) or a fresh cached result exists.
   */
  async run(key: string, producer: () => Promise<MediaAnalysisResult>): Promise<MediaAnalysisResult> {
    const cached = this.get(key);
    if (cached) return cached;

    const pending = this.inflight.get(key);
    if (pending) return pending;

    const task = (async () => {
      try {
        const result = await producer();
        // Failures are not cached: only usable results are memoized.
        if (isCacheWorthy(result)) this.store(key, result);
        return result;
      } finally {
        this.inflight.delete(key);
      }
    })();

    this.inflight.set(key, task);
    return task;
  }

  private store(key: string, result: MediaAnalysisResult): void {
    if (this.entries.size >= MAX_ENTRIES) this.sweep();
    this.entries.set(key, { result, expiresAt: Date.now() + ANALYSIS_CACHE_TTL_MS });
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
    // Still full (everything fresh): drop the oldest insertions.
    if (this.entries.size >= MAX_ENTRIES) {
      const overflow = this.entries.size - MAX_ENTRIES + 1;
      let removed = 0;
      for (const key of this.entries.keys()) {
        this.entries.delete(key);
        if (++removed >= overflow) break;
      }
    }
  }
}

export const mediaAnalysisCache = new AnalysisCache();
