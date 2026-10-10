import { validateRemoteUrl } from '../utils/security.js';
import { YouTubeProvider } from './providers/YouTubeProvider.js';
import { SoundCloudProvider } from './providers/SoundCloudProvider.js';
import { PinterestProvider } from './providers/PinterestProvider.js';
import { TikTokProvider } from './providers/TikTokProvider.js';
import { DirectMediaProvider } from './providers/DirectMediaProvider.js';
import { mediaAnalysisCache, analysisCacheKey } from './MediaAnalysisCache.js';
export class MediaSourceResolver {
    static providers = [
        new YouTubeProvider(),
        new SoundCloudProvider(),
        new PinterestProvider(),
        new TikTokProvider(),
        new DirectMediaProvider(),
    ];
    /**
     * Resolves the provider for a URL and analyzes it.
     *
     * Results are memoized for `ANALYSIS_CACHE_TTL_MS` and concurrent calls for
     * the same URL share a single in-flight request, so Analyze / Preview / Play
     * / Download all reuse one upstream extraction instead of each triggering a
     * new watch-page fetch (which is what caused the 429 rate limiting).
     *
     * `skipCache` is available for callers that must hit the platform again
     * (e.g. re-analyzing after a token expired).
     */
    static async resolveAndAnalyze(url, options = {}) {
        const { skipCache = false } = options;
        // 1. SSRF & URL validation — the cache key is derived afterwards so that a
        //    rejected URL never occupies a cache slot.
        const validation = await validateRemoteUrl(url);
        if (!validation.valid || !validation.normalizedUrl) {
            throw new Error(validation.error || 'Invalid or insecure URL provided.');
        }
        const cleanUrl = validation.normalizedUrl;
        const cacheKey = analysisCacheKey(cleanUrl);
        // 2. Select provider adapter. Provider selection is cheap and deterministic,
        //    so it happens outside the cached block; only the analysis is memoized.
        const provider = this.providers.find((p) => p.matches(cleanUrl)) || new DirectMediaProvider();
        if (skipCache) {
            return provider.analyze(cleanUrl);
        }
        // 3. Cached analysis with in-flight de-duplication.
        return mediaAnalysisCache.run(cacheKey, () => provider.analyze(cleanUrl));
    }
}
