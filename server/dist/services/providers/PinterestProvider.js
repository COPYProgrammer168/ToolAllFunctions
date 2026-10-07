export class PinterestProvider {
    id = 'pinterest';
    displayName = 'Pinterest';
    matches(url) {
        return /(?:pinterest\.com\/pin\/|pin\.it\/)/i.test(url);
    }
    async analyze(url) {
        let title = 'Pinterest Pin Media';
        let author = 'Pinterest Creator';
        let thumbnail = '';
        let mediaType = 'image';
        let directMediaUrl;
        let videoUrl;
        let isAuthorized = false;
        let width;
        let height;
        let duration;
        // Resolve short URLs (pin.it) to canonical form
        let resolvedUrl = url;
        if (/pin\.it\//i.test(url)) {
            try {
                const headRes = await fetch(url, {
                    method: 'HEAD',
                    redirect: 'follow',
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    },
                    signal: AbortSignal.timeout(6000),
                });
                if (headRes.url)
                    resolvedUrl = headRes.url;
            }
            catch {
                // Continue with original URL
            }
        }
        try {
            // Fetch full page HTML to parse embedded JSON + OpenGraph tags
            const res = await fetch(resolvedUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                },
                redirect: 'follow',
                signal: AbortSignal.timeout(10000),
            });
            if (res.ok) {
                const html = await res.text();
                // --- Strategy 1: Parse embedded __PWS_DATA__ or initial Redux state ---
                // Pinterest embeds pin data as JSON in script tags
                const pwsMatch = html.match(/<script[^>]*id="__PWS_DATA__"[^>]*>([\s\S]*?)<\/script>/i) ||
                    html.match(/<script[^>]*data-relay-response="true"[^>]*>([\s\S]*?)<\/script>/i);
                if (pwsMatch) {
                    try {
                        const pwsData = JSON.parse(pwsMatch[1]);
                        this.extractFromPWSData(pwsData, (data) => {
                            if (data.title)
                                title = data.title;
                            if (data.author)
                                author = data.author;
                            if (data.thumbnail)
                                thumbnail = data.thumbnail;
                            if (data.videoUrl) {
                                videoUrl = data.videoUrl;
                                mediaType = 'video';
                            }
                            if (data.imageUrl)
                                directMediaUrl = data.imageUrl;
                            if (data.width)
                                width = data.width;
                            if (data.height)
                                height = data.height;
                            if (data.duration)
                                duration = data.duration;
                        });
                    }
                    catch {
                        // JSON parse failed, fall through to OG tags
                    }
                }
                // --- Strategy 2: Look for video in JSON-LD or inline script JSON ---
                if (!videoUrl) {
                    // Try multiple patterns for video URLs in the page
                    const videoPatterns = [
                        /"contentUrl"\s*:\s*"([^"]+\.mp4[^"]*)"/i,
                        /"video_list"\s*:\s*\{[^}]*"V_1080P"\s*:\s*\{[^}]*"url"\s*:\s*"([^"]+)"/i,
                        /"video_list"\s*:\s*\{[^}]*"V_EXP7"\s*:\s*\{[^}]*"url"\s*:\s*"([^"]+)"/i,
                        /"video_list"\s*:\s*\{[^}]*"V_720P"\s*:\s*\{[^}]*"url"\s*:\s*"([^"]+)"/i,
                        /"video_list"\s*:\s*\{[^}]*"V_480P"\s*:\s*\{[^}]*"url"\s*:\s*"([^"]+)"/i,
                        /"video_list"\s*:\s*\{[^}]*"V_HLSV4"\s*:\s*\{[^}]*"url"\s*:\s*"([^"]+)"/i,
                        /v\.pinimg\.com\/videos\/[a-zA-Z0-9_/.-]+\.mp4/i,
                    ];
                    for (const pattern of videoPatterns) {
                        const m = html.match(pattern);
                        if (m) {
                            videoUrl = (m[1] || m[0]).replace(/\\u002F/g, '/').replace(/\\u0026/g, '&').replace(/\\\//g, '/');
                            mediaType = 'video';
                            break;
                        }
                    }
                }
                // --- Strategy 3: Parse OpenGraph tags ---
                // Title
                const titleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i) ||
                    html.match(/<meta\s+name="title"\s+content="([^"]+)"/i);
                if (titleMatch && title === 'Pinterest Pin Media')
                    title = this.decodeHtmlEntities(titleMatch[1]);
                // Author / Description
                const authorMatch = html.match(/<meta\s+property="pinterestapp:pinner"\s+content="([^"]+)"/i) ||
                    html.match(/<meta\s+name="author"\s+content="([^"]+)"/i);
                if (authorMatch)
                    author = this.decodeHtmlEntities(authorMatch[1]);
                const descMatch = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i);
                if (descMatch && author === 'Pinterest Creator') {
                    const cleaned = this.decodeHtmlEntities(descMatch[1]).slice(0, 80);
                    if (cleaned.length > 0)
                        author = cleaned;
                }
                // Video OG tags
                if (!videoUrl) {
                    const ogVideoMatch = html.match(/<meta\s+property="og:video"\s+content="([^"]+)"/i) ||
                        html.match(/<meta\s+property="og:video:secure_url"\s+content="([^"]+)"/i) ||
                        html.match(/<meta\s+property="og:video:url"\s+content="([^"]+)"/i);
                    if (ogVideoMatch) {
                        const candidate = ogVideoMatch[1].replace(/\\u0026/g, '&');
                        // Only accept direct mp4 URLs, not embedded players
                        if (candidate.includes('.mp4') || candidate.includes('pinimg.com/videos')) {
                            videoUrl = candidate;
                            mediaType = 'video';
                        }
                    }
                }
                // Image OG tag — get the highest-resolution available
                const imgMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
                if (imgMatch) {
                    thumbnail = imgMatch[1];
                    if (!directMediaUrl) {
                        // Upgrade to original resolution: replace /236x/, /564x/, /736x/ etc. with /originals/
                        directMediaUrl = thumbnail.replace(/\/\d+x\//, '/originals/');
                    }
                }
                // Also try to find originals URL pattern directly
                if (!directMediaUrl) {
                    const originalsMatch = html.match(/https:\/\/i\.pinimg\.com\/originals\/[a-zA-Z0-9_\-\/]+\.(?:jpg|png|webp|gif)/i);
                    if (originalsMatch)
                        directMediaUrl = originalsMatch[0];
                }
                // If we found any media, mark as authorized (public Pinterest pins are publicly accessible)
                if (videoUrl || directMediaUrl) {
                    isAuthorized = true;
                }
            }
        }
        catch {
            // Fallback: keep defaults
        }
        // Build format options
        const availableFormats = [];
        if (videoUrl || mediaType === 'video') {
            const vidUrl = videoUrl || directMediaUrl;
            availableFormats.push({
                id: 'pin-video-1080p',
                type: 'video',
                format: 'mp4',
                qualityLabel: '1080p Auto (MP4)',
                directDownloadUrl: vidUrl,
                notes: 'Best available quality up to 1080p.',
            }, {
                id: 'pin-video-opt',
                type: 'video',
                format: 'mp4',
                qualityLabel: 'Send to Video Optimizer (4K / 60 FPS AI Pipeline)',
                directDownloadUrl: vidUrl,
                notes: 'Loads directly into VideoOptimize workspace for AI enhancement.',
            });
        }
        else {
            const imgUrl = directMediaUrl || thumbnail;
            availableFormats.push({
                id: 'pin-img-4k',
                type: 'image',
                format: 'original',
                qualityLabel: '4K Original (Lossless Preservation)',
                directDownloadUrl: imgUrl,
                notes: 'Full-resolution original image without recompression.',
            });
        }
        return {
            sourceUrl: url,
            platform: 'pinterest',
            title,
            creator: author,
            thumbnail: thumbnail || directMediaUrl,
            mediaType,
            width,
            height,
            duration,
            downloadAuthorized: isAuthorized,
            authorizedNotice: isAuthorized
                ? undefined
                : 'Could not locate a publicly accessible media resource for this pin. The pin may be private or the content has been removed.',
            copyrightNotice: 'Use this tool only for pins and images you own or have explicit rights to download and modify.',
            availableFormats,
            rawSourceUrl: videoUrl || directMediaUrl,
        };
    }
    /**
     * Recursively search Pinterest's __PWS_DATA__ JSON structure for pin data
     */
    extractFromPWSData(obj, callback) {
        if (!obj || typeof obj !== 'object')
            return;
        // Look for pin data nodes
        if (obj.videos && obj.videos.video_list) {
            const videoList = obj.videos.video_list;
            const preferredKeys = ['V_1080P', 'V_EXP7', 'V_720P', 'V_480P', 'V_HLSV4', 'V_264'];
            for (const key of preferredKeys) {
                if (videoList[key] && videoList[key].url) {
                    callback({
                        videoUrl: videoList[key].url,
                        width: videoList[key].width,
                        height: videoList[key].height,
                        duration: videoList[key].duration ? Math.round(videoList[key].duration / 1000) : undefined,
                    });
                    return;
                }
            }
        }
        // Extract image URL
        if (obj.images && obj.images.orig && obj.images.orig.url) {
            callback({
                imageUrl: obj.images.orig.url,
                width: obj.images.orig.width,
                height: obj.images.orig.height,
            });
        }
        // Extract title and pinner
        if (obj.grid_title || obj.title) {
            callback({ title: obj.grid_title || obj.title });
        }
        if (obj.pinner && obj.pinner.full_name) {
            callback({ author: obj.pinner.full_name });
        }
        // Recurse into object values
        for (const key of Object.keys(obj)) {
            if (typeof obj[key] === 'object' && obj[key] !== null) {
                this.extractFromPWSData(obj[key], callback);
            }
        }
    }
    decodeHtmlEntities(text) {
        return text
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&#x27;/g, "'");
    }
}
