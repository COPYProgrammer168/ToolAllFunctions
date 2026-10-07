export class TikTokProvider {
    id = 'tiktok';
    displayName = 'TikTok';
    matches(url) {
        return /(?:tiktok\.com\/@[\w.-]+\/video\/\d+|vm\.tiktok\.com\/[\w-]+|vt\.tiktok\.com\/[\w-]+|tiktok\.com\/t\/[\w-]+)/i.test(url);
    }
    async analyze(url) {
        let title = 'TikTok Media';
        let author = 'TikTok Creator';
        let thumbnail = '';
        let isAuthorized = false;
        let directVideoUrl;
        let duration;
        let width;
        let height;
        // Step 1: Resolve short URLs to canonical form
        let resolvedUrl = url;
        if (/vm\.tiktok\.com|vt\.tiktok\.com|tiktok\.com\/t\//i.test(url)) {
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
                // Continue with original
            }
        }
        // Step 2: oEmbed metadata
        try {
            const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(resolvedUrl)}`;
            const res = await fetch(oembedUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
                signal: AbortSignal.timeout(5000),
            });
            if (res.ok) {
                const data = (await res.json());
                title = data.title || title;
                author = data.author_name || author;
                thumbnail = data.thumbnail_url || thumbnail;
                if (data.thumbnail_width)
                    width = data.thumbnail_width;
                if (data.thumbnail_height)
                    height = data.thumbnail_height;
            }
        }
        catch {
            // Fallback
        }
        // Step 3: Fetch the TikTok page to extract video URL from embedded data
        try {
            const pageRes = await fetch(resolvedUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'sec-fetch-mode': 'navigate',
                    'sec-fetch-dest': 'document',
                },
                redirect: 'follow',
                signal: AbortSignal.timeout(10000),
            });
            if (pageRes.ok) {
                const html = await pageRes.text();
                // Parse __UNIVERSAL_DATA_FOR_REHYDRATION__ or SIGI_STATE
                const hydrationMatch = html.match(/<script[^>]*id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/i) ||
                    html.match(/<script[^>]*id="SIGI_STATE"[^>]*>([\s\S]*?)<\/script>/i) ||
                    html.match(/<script[^>]*id="__NUXT__"[^>]*>([\s\S]*?)<\/script>/i) ||
                    html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
                if (hydrationMatch) {
                    try {
                        const stateData = JSON.parse(hydrationMatch[1]);
                        this.extractVideoFromState(stateData, (data) => {
                            if (data.videoUrl && !directVideoUrl)
                                directVideoUrl = data.videoUrl;
                            if (data.title && title === 'TikTok Media')
                                title = data.title;
                            if (data.author && author === 'TikTok Creator')
                                author = data.author;
                            if (data.thumbnail && !thumbnail)
                                thumbnail = data.thumbnail;
                            if (data.duration)
                                duration = data.duration;
                            if (data.width)
                                width = data.width;
                            if (data.height)
                                height = data.height;
                        });
                    }
                    catch {
                        // JSON parse failed
                    }
                }
                // Fallback: Try OG video tag
                if (!directVideoUrl) {
                    const ogVideo = html.match(/<meta\s+property="og:video"\s+content="([^"]+)"/i) ||
                        html.match(/<meta\s+property="og:video:secure_url"\s+content="([^"]+)"/i);
                    if (ogVideo) {
                        const candidate = ogVideo[1].replace(/&amp;/g, '&');
                        if (candidate.includes('.mp4') || candidate.includes('tiktokcdn') || candidate.includes('tiktokv.')) {
                            directVideoUrl = candidate;
                        }
                    }
                }
                // Fallback: search for direct video URLs in HTML
                if (!directVideoUrl) {
                    const videoPatterns = [
                        /https?:\/\/[a-zA-Z0-9.-]*tiktokcdn\.com\/[^\s"'<>]+\.mp4[^\s"'<>]*/i,
                        /https?:\/\/v[0-9]*\.tiktokcdn\.com\/[^\s"'<>]+/i,
                        /https?:\/\/[a-zA-Z0-9.-]*tiktokv\.com\/[^\s"'<>]+\.mp4[^\s"'<>]*/i,
                        /https?:\/\/[a-zA-Z0-9.-]*tikcdn\.net\/[^\s"'<>]+\.mp4[^\s"'<>]*/i,
                        /https?:\/\/[a-zA-Z0-9.-]*tiktok\.com\/[^\s"'<>]+\.mp4[^\s"'<>]*/i,
                    ];
                    for (const pattern of videoPatterns) {
                        const m = html.match(pattern);
                        if (m) {
                            directVideoUrl = m[0].replace(/\\u002F/g, '/').replace(/\\u0026/g, '&').replace(/\\\//g, '/');
                            break;
                        }
                    }
                }
                // Headless-browser fallback: TikTok serves a WAF challenge to plain fetch,
                // so render the page with Playwright and capture the real CDN video URL.
                if (!directVideoUrl) {
                    try {
                        const { chromium } = await import('playwright');
                        const browser = await chromium.launch({ headless: true });
                        try {
                            const page = await browser.newPage({
                                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                                viewport: { width: 1280, height: 800 },
                            });
                            let found;
                            page.on('response', (res) => {
                                const u = res.url();
                                if (!found && /tiktokcdn|tiktokv|tikcdn|aweme|mime_type=video/i.test(u) && !/ttwstatic|playback1/i.test(u)) {
                                    found = u;
                                }
                            });
                            await page.goto(resolvedUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
                            await page.waitForTimeout(5000);
                            if (!found) {
                                // TikTok may use blob: for the <video> src; pull the real URL from the
                                // page's rehydration state or <source> tags.
                                const src = await page.evaluate(() => {
                                    try {
                                        const w = globalThis;
                                        const el = w.document?.querySelector?.('#__UNIVERSAL_DATA_FOR_REHYDRATION__');
                                        if (el) {
                                            const data = JSON.parse(el.textContent || '{}');
                                            const str = JSON.stringify(data);
                                            const m = str.match(/"playAddr"\s*:\s*"([^"]+)"/) || str.match(/"downloadAddr"\s*:\s*"([^"]+)"/);
                                            if (m)
                                                return m[1].replace(/\\u002F/g, '/').replace(/\\u0026/g, '&');
                                        }
                                        const v = w.document?.querySelector?.('video');
                                        if (v) {
                                            const s = v.currentSrc || v.src || '';
                                            if (s && !s.startsWith('blob:'))
                                                return s;
                                            const srcTag = v.querySelector?.('source');
                                            if (srcTag?.src)
                                                return srcTag.src;
                                        }
                                    }
                                    catch { }
                                    return '';
                                });
                                if (src)
                                    found = src;
                            }
                            if (found) {
                                directVideoUrl = found;
                                isAuthorized = true;
                            }
                            // Also pull real title/author/thumbnail/duration from the page state
                            try {
                                const meta = await page.evaluate(() => {
                                    try {
                                        const w = globalThis;
                                        const el = w.document?.querySelector?.('#__UNIVERSAL_DATA_FOR_REHYDRATION__');
                                        if (!el)
                                            return null;
                                        const data = JSON.parse(el.textContent || '{}');
                                        const str = JSON.stringify(data);
                                        const title = str.match(/"desc"\s*:\s*"([^"]{0,200})"/);
                                        const author = str.match(/"nickname"\s*:\s*"([^"]{0,100})"/);
                                        const thumb = str.match(/"cover"\s*:\s*"([^"]+)"/) || str.match(/"dynamicCover"\s*:\s*"([^"]+)"/);
                                        const dur = str.match(/"duration"\s*:\s*(\d+)/);
                                        const w2 = str.match(/"width"\s*:\s*(\d+)/);
                                        const h2 = str.match(/"height"\s*:\s*(\d+)/);
                                        const unescape = (s) => s.replace(/\\u002F/g, '/').replace(/\\u0026/g, '&').replace(/\\"/g, '"');
                                        return {
                                            title: title ? unescape(title[1]) : '',
                                            author: author ? unescape(author[1]) : '',
                                            thumbnail: thumb ? unescape(thumb[1]) : '',
                                            duration: dur ? parseInt(dur[1], 10) : undefined,
                                            width: w2 ? parseInt(w2[1], 10) : undefined,
                                            height: h2 ? parseInt(h2[1], 10) : undefined,
                                        };
                                    }
                                    catch {
                                        return null;
                                    }
                                });
                                if (meta) {
                                    if (meta.title && title === 'TikTok Media')
                                        title = meta.title;
                                    if (meta.author && author === 'TikTok Creator')
                                        author = meta.author;
                                    if (meta.thumbnail && !thumbnail)
                                        thumbnail = meta.thumbnail;
                                    if (meta.duration && !duration)
                                        duration = meta.duration;
                                    if (meta.width && !width)
                                        width = meta.width;
                                    if (meta.height && !height)
                                        height = meta.height;
                                }
                                // Fallback title from the rendered document title
                                try {
                                    if (title === 'TikTok Media') {
                                        const docTitle = await page.title();
                                        const cleaned = docTitle.replace(/^TikTok\s*video\s*-\s*/i, '').replace(/\s*\|\s*TikTok$/i, '');
                                        if (cleaned && !/^TikTok$/i.test(cleaned))
                                            title = cleaned;
                                    }
                                }
                                catch { }
                            }
                            catch {
                                // ignore metadata extraction errors
                            }
                        }
                        finally {
                            await browser.close();
                        }
                    }
                    catch (err) {
                        console.error('Playwright TikTok resolve failed:', err);
                    }
                }
                // Fallback: get metadata from OG tags if not already extracted
                if (title === 'TikTok Media') {
                    const ogTitle = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i) ||
                        html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i);
                    if (ogTitle)
                        title = this.decodeHtmlEntities(ogTitle[1]).slice(0, 200);
                }
                if (!thumbnail) {
                    const ogImg = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
                    if (ogImg)
                        thumbnail = ogImg[1];
                }
                if (directVideoUrl) {
                    isAuthorized = true;
                }
            }
        }
        catch {
            // Page fetch failed, continue with oEmbed data
        }
        const formats = [
            {
                id: 'tt-video-orig',
                type: 'video',
                format: 'mp4',
                qualityLabel: 'Original Video (Direct)',
                directDownloadUrl: directVideoUrl,
                notes: 'Native resolution and frame rate as provided by the platform.',
            },
            {
                id: 'tt-video-opt',
                type: 'video',
                format: 'mp4',
                qualityLabel: 'Send to Video Optimizer (Enhance & Crisp 60 FPS)',
                directDownloadUrl: directVideoUrl,
                notes: 'Runs through AI Video Optimizer pipeline.',
            },
            {
                id: 'tt-audio-mp3',
                type: 'audio',
                format: 'mp3',
                qualityLabel: 'Extract Sound (MP3 320 kbps CBR)',
                bitrateKbps: 320,
                directDownloadUrl: directVideoUrl,
                notes: 'Notice: Source mobile sound is typically 128 kbps AAC; 320 kbps export does not recreate lost frequencies.',
            },
            {
                id: 'tt-audio-m4a',
                type: 'audio',
                format: 'm4a',
                qualityLabel: 'Extract Sound (Original M4A/AAC Stream)',
                directDownloadUrl: directVideoUrl,
                notes: 'Lossless stream copy without re-encoding.',
            },
        ];
        return {
            sourceUrl: url,
            platform: 'tiktok',
            title,
            creator: author,
            thumbnail,
            duration,
            width,
            height,
            mediaType: 'video',
            downloadAuthorized: isAuthorized,
            authorizedNotice: isAuthorized
                ? undefined
                : 'Could not extract a direct video URL from TikTok. The video may be private, region-restricted, or the platform structure has changed.',
            copyrightNotice: 'TikTok content belongs to respective creators. Only download content you own or have explicit permission to use.',
            availableFormats: formats,
            rawSourceUrl: directVideoUrl,
        };
    }
    /**
     * Recursively search TikTok's rehydration state for video data
     */
    extractVideoFromState(obj, callback, depth = 0) {
        if (!obj || typeof obj !== 'object' || depth > 10)
            return;
        // Look for video download URL patterns
        if (obj.downloadAddr) {
            callback({ videoUrl: this.cleanUrl(obj.downloadAddr) });
            return;
        }
        if (obj.playAddr) {
            callback({ videoUrl: this.cleanUrl(obj.playAddr) });
            return;
        }
        if (obj.downloadApi) {
            callback({ videoUrl: this.cleanUrl(obj.downloadApi) });
            return;
        }
        if (obj.playApi) {
            callback({ videoUrl: this.cleanUrl(obj.playApi) });
            return;
        }
        if (obj.play_addr && obj.play_addr.url_list && obj.play_addr.url_list.length > 0) {
            callback({
                videoUrl: this.cleanUrl(obj.play_addr.url_list[0]),
                width: obj.play_addr.width,
                height: obj.play_addr.height,
            });
            return;
        }
        if (obj.download_addr && obj.download_addr.url_list && obj.download_addr.url_list.length > 0) {
            callback({ videoUrl: this.cleanUrl(obj.download_addr.url_list[0]) });
        }
        // Extract metadata
        if (obj.desc && typeof obj.desc === 'string' && obj.desc.length > 0) {
            callback({ title: obj.desc.slice(0, 200) });
        }
        if (obj.author && obj.author.nickname) {
            callback({ author: obj.author.nickname });
        }
        if (obj.cover && typeof obj.cover === 'string') {
            callback({ thumbnail: obj.cover });
        }
        if (obj.dynamic_cover) {
            callback({ thumbnail: obj.dynamic_cover });
        }
        if (obj.duration && typeof obj.duration === 'number') {
            callback({ duration: Math.round(obj.duration) });
        }
        // Recurse
        for (const key of Object.keys(obj)) {
            if (typeof obj[key] === 'object' && obj[key] !== null) {
                this.extractVideoFromState(obj[key], callback, depth + 1);
            }
        }
    }
    cleanUrl(url) {
        return url
            .replace(/\\u002F/g, '/')
            .replace(/\\u0026/g, '&')
            .replace(/\\\//g, '/')
            .replace(/&amp;/g, '&');
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
