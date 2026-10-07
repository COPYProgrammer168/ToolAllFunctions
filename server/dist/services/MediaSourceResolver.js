import { validateRemoteUrl } from '../utils/security.js';
import { YouTubeProvider } from './providers/YouTubeProvider.js';
import { SoundCloudProvider } from './providers/SoundCloudProvider.js';
import { PinterestProvider } from './providers/PinterestProvider.js';
import { TikTokProvider } from './providers/TikTokProvider.js';
import { DirectMediaProvider } from './providers/DirectMediaProvider.js';
export class MediaSourceResolver {
    static providers = [
        new YouTubeProvider(),
        new SoundCloudProvider(),
        new PinterestProvider(),
        new TikTokProvider(),
        new DirectMediaProvider(),
    ];
    static async resolveAndAnalyze(url) {
        // 1. SSRF & URL validation
        const validation = await validateRemoteUrl(url);
        if (!validation.valid || !validation.normalizedUrl) {
            throw new Error(validation.error || 'Invalid or insecure URL provided.');
        }
        const cleanUrl = validation.normalizedUrl;
        // 2. Select provider adapter
        for (const provider of this.providers) {
            if (provider.matches(cleanUrl)) {
                return await provider.analyze(cleanUrl);
            }
        }
        // Default to direct media provider
        const fallbackProvider = new DirectMediaProvider();
        return await fallbackProvider.analyze(cleanUrl);
    }
}
