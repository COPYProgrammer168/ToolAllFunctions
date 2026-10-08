import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const execFileAsync = promisify(execFile);
const MAX_PROFILE_VIDEOS = 100;
function findCookiesFile() {
    const candidates = [
        process.env.TT_COOKIES,
        path.resolve(process.cwd(), 'cookies.txt'),
        path.resolve(process.cwd(), 'server', 'cookies.txt'),
        path.resolve(process.cwd(), '..', 'cookies.txt'),
    ].filter(Boolean);
    for (const c of candidates) {
        try {
            if (c && fs.existsSync(c))
                return c;
        }
        catch { }
    }
    return undefined;
}
function findYtDlp() {
    const candidates = [
        'yt-dlp',
        'yt-dlp.exe',
        'C:\\Users\\MSI\\AppData\\Roaming\\Python\\Python314\\Scripts\\yt-dlp.exe',
    ];
    for (const c of candidates) {
        try {
            if (fs.existsSync(c))
                return c;
        }
        catch { }
    }
    return 'yt-dlp';
}
/** Parse a Netscape cookies.txt into Playwright cookie objects. */
function parseNetscapeCookies(text) {
    const out = [];
    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('# Netscape') && !line.startsWith('#HttpOnly_'))
            continue;
        const parts = line.replace(/^#HttpOnly_/, '').split('\t');
        if (parts.length < 7)
            continue;
        const [domain, flag, cookiePath, secure, , name, ...rest] = parts;
        const value = rest.join('\t');
        out.push({
            name,
            value,
            domain: domain.startsWith('.') ? domain : `.${domain.replace(/^\./, '')}`,
            path: cookiePath || '/',
            secure: secure?.toUpperCase() === 'TRUE',
            httpOnly: line.startsWith('#HttpOnly_') || /httponly/i.test(parts[1] || ''),
        });
    }
    return out;
}
export class TikTokProvider {
    id = 'tiktok';
    displayName = 'TikTok';
    matches(url) {
        return /(?:tiktok\.com\/@[\w.-]+(?:\/video\/\d+)?|vm\.tiktok\.com\/[\w-]+|vt\.tiktok\.com\/[\w-]+|tiktok\.com\/t\/[\w-]+)/i.test(url);
    }
    async analyze(url) {
        if (this.isProfileUrl(url)) {
            return this.analyzeProfile(url);
        }
        return this.analyzeVideo(url);
    }
    isProfileUrl(url) {
        // Profile: tiktok.com/@user  (no /video/id)
        return /tiktok\.com\/@[\w.-]+\/?(?:\?.*)?$/i.test(url) && !/\/video\/\d+/i.test(url);
    }
    async analyzeProfile(url) {
        let title = 'TikTok Profile';
        let author = 'TikTok Creator';
        let thumbnail = '';
        const tracks = [];
        const handleMatch = url.match(/tiktok\.com\/(@[\w.-]+)/i);
        const handle = handleMatch ? handleMatch[1] : '@creator';
        const profileUrl = `https://www.tiktok.com/${handle}`;
        try {
            const { chromium } = await import('playwright');
            const cookiesPath = findCookiesFile();
            const browser = await chromium.launch({ headless: true });
            try {
                const page = await browser.newPage({
                    userAgent: UA,
                    viewport: { width: 1280, height: 900 },
                });
                if (cookiesPath) {
                    try {
                        const ck = parseNetscapeCookies(fs.readFileSync(cookiesPath, 'utf8'));
                        if (ck.length)
                            await page.context().addCookies(ck);
                    }
                    catch { }
                }
                const seen = new Set();
                const ingestItems = (items) => {
                    for (const item of items) {
                        if (!item?.id)
                            continue;
                        const uniqueId = item.author?.uniqueId || handle.replace(/^@/, '');
                        const videoUrl = `https://www.tiktok.com/@${uniqueId}/video/${item.id}`;
                        if (seen.has(videoUrl))
                            continue;
                        seen.add(videoUrl);
                        tracks.push({
                            title: (item.desc || `TikTok ${item.id}`).slice(0, 200),
                            url: videoUrl,
                            creator: item.author?.nickname || item.author?.uniqueId || author,
                            duration: typeof item.video?.duration === 'number' ? Math.round(item.video.duration) : undefined,
                            thumbnail: item.video?.cover || item.video?.originCover || item.video?.dynamicCover || undefined,
                            mediaType: 'video',
                        });
                    }
                };
                page.on('response', async (res) => {
                    try {
                        const u = res.url();
                        if (!/\/api\/post\/item_list\//i.test(u))
                            return;
                        const json = await res.json().catch(() => null);
                        if (json?.itemList && Array.isArray(json.itemList)) {
                            ingestItems(json.itemList);
                        }
                    }
                    catch {
                        // ignore interception errors
                    }
                });
                await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
                await page.waitForTimeout(3500);
                // Pull author + avatar from rehydration state
                try {
                    const meta = await page.evaluate(() => {
                        try {
                            const el = globalThis.document?.querySelector?.('#__UNIVERSAL_DATA_FOR_REHYDRATION__');
                            if (!el)
                                return null;
                            const data = JSON.parse(el.textContent || '{}');
                            const userInfo = data?.__DEFAULT_SCOPE__?.['webapp.user-detail']?.userInfo;
                            const user = userInfo?.user;
                            if (!user)
                                return null;
                            return {
                                nickname: user.nickname || user.uniqueId || '',
                                avatar: user.avatarLarger || user.avatarMedium || user.avatarThumb || '',
                            };
                        }
                        catch {
                            return null;
                        }
                    });
                    if (meta?.nickname) {
                        author = meta.nickname;
                        title = `${author} — TikTok Videos`;
                    }
                    if (meta?.avatar)
                        thumbnail = meta.avatar;
                }
                catch {
                    // ignore
                }
                // Also scrape video links already in the DOM
                try {
                    const domLinks = await page.evaluate((h) => {
                        const out = [];
                        const anchors = Array.from(globalThis.document?.querySelectorAll?.('a[href*="/video/"]') || []);
                        for (const a of anchors) {
                            const href = a.getAttribute('href') || '';
                            const m = href.match(/(@[\w.-]+\/video\/\d+)/i);
                            if (!m)
                                continue;
                            const full = href.startsWith('http') ? href.split('?')[0] : `https://www.tiktok.com/${m[1]}`;
                            const img = a.querySelector?.('img');
                            out.push({
                                title: (img?.alt || a.getAttribute('aria-label') || m[1]).slice(0, 200),
                                url: full,
                                thumbnail: img?.src || undefined,
                            });
                        }
                        const handleSlug = h.replace(/^@/, '').toLowerCase();
                        return out.filter((x) => x.url.toLowerCase().includes(`/@${handleSlug}/`));
                    }, handle);
                    for (const link of domLinks) {
                        if (seen.has(link.url))
                            continue;
                        seen.add(link.url);
                        tracks.push({
                            title: link.title,
                            url: link.url,
                            creator: author,
                            thumbnail: link.thumbnail,
                            mediaType: 'video',
                        });
                    }
                }
                catch {
                    // ignore
                }
                // Scroll to load more via item_list XHR
                let stagnant = 0;
                let lastCount = tracks.length;
                for (let i = 0; i < 20 && tracks.length < MAX_PROFILE_VIDEOS && stagnant < 4; i++) {
                    await page.evaluate(() => globalThis.window?.scrollBy?.(0, 1400));
                    await page.waitForTimeout(1600);
                    if (tracks.length === lastCount)
                        stagnant++;
                    else {
                        stagnant = 0;
                        lastCount = tracks.length;
                    }
                }
            }
            finally {
                await browser.close();
            }
        }
        catch (err) {
            console.error('Playwright TikTok profile resolve failed:', err);
        }
        if (!author || author === 'TikTok Creator') {
            author = handle.replace(/^@/, '');
            title = `${author} — TikTok Videos`;
        }
        if (tracks.length === 0) {
            // Fallback to yt-dlp profile listing (bypasses Playwright DOM checks
            // when cookies/proxy are configured for it).
            const fromYt = await this.ytDlpProfileVideos(profileUrl, author);
            const seen2 = new Set(tracks.map((t) => t.url));
            for (const t of fromYt) {
                if (!seen2.has(t.url)) {
                    seen2.add(t.url);
                    tracks.push(t);
                }
            }
            if (tracks.length > 0 && (!author || author === 'TikTok Creator')) {
                author = tracks[0].creator || handle.replace(/^@/, '');
                title = `${author} — TikTok Videos`;
            }
        }
        const limited = tracks.slice(0, MAX_PROFILE_VIDEOS);
        return {
            sourceUrl: url,
            platform: 'tiktok',
            title,
            creator: author,
            thumbnail,
            duration: 0,
            mediaType: 'mixed',
            downloadAuthorized: limited.length > 0,
            authorizedNotice: limited.length > 0
                ? `Found ${limited.length} video(s) on this profile. Select items to download as video or music, and preview each card.`
                : 'Could not list profile videos. The account may be private, empty, or blocked by TikTok anti-bot checks. Add a cookies.txt with a logged-in TikTok session (set TT_COOKIES or place it as server/cookies.txt), or check the IP is not rate-limited.',
            copyrightNotice: 'TikTok content belongs to respective creators. Only download content you own or have explicit permission to use.',
            availableFormats: [],
            tracks: limited,
        };
    }
    async analyzeVideo(url) {
        let title = 'TikTok Media';
        let author = 'TikTok Creator';
        let thumbnail = '';
        let isAuthorized = false;
        let directVideoUrl;
        let audioOnlyUrl;
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
                        'User-Agent': UA,
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
                    'User-Agent': UA,
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
                            if (data.videoUrl && !directVideoUrl && this.isDirectVideoStreamUrl(data.videoUrl))
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
                            if (this.isDirectVideoStreamUrl(candidate))
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
                            const candidate = m[0].replace(/\\u002F/g, '/').replace(/\\u0026/g, '&').replace(/\\\//g, '/');
                            if (this.isDirectVideoStreamUrl(candidate)) {
                                directVideoUrl = candidate;
                                break;
                            }
                        }
                    }
                }
                // Headless-browser fallback: TikTok serves a WAF challenge to plain fetch,
                // so render the page with Playwright and capture the real CDN video URL.
                if (!directVideoUrl) {
                    try {
                        const { chromium } = await import('playwright');
                        const cookiesPath = findCookiesFile();
                        const browser = await chromium.launch({ headless: true });
                        try {
                            const page = await browser.newPage({
                                userAgent: UA,
                                viewport: { width: 1280, height: 800 },
                            });
                            if (cookiesPath) {
                                try {
                                    const ck = parseNetscapeCookies(fs.readFileSync(cookiesPath, 'utf8'));
                                    if (ck.length)
                                        await page.context().addCookies(ck);
                                }
                                catch { }
                            }
                            let found;
                            page.on('response', (res) => {
                                const u = res.url();
                                if (!found &&
                                    /tiktokcdn|tiktokv|tikcdn|aweme|mime_type=video/i.test(u) &&
                                    !/ttwstatic|playback1|\/api\/|\/v1\/user\/webid/i.test(u)) {
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
                                if (src && this.isDirectVideoStreamUrl(src))
                                    found = src;
                            }
                            if (found && this.isDirectVideoStreamUrl(found)) {
                                directVideoUrl = found;
                                isAuthorized = true;
                            }
                            else {
                                found = undefined;
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
                                        const titleM = str.match(/"desc"\s*:\s*"([^"]{0,200})"/);
                                        const authorM = str.match(/"nickname"\s*:\s*"([^"]{0,100})"/);
                                        const thumb = str.match(/"cover"\s*:\s*"([^"]+)"/) || str.match(/"dynamicCover"\s*:\s*"([^"]+)"/);
                                        const dur = str.match(/"duration"\s*:\s*(\d+)/);
                                        const w2 = str.match(/"width"\s*:\s*(\d+)/);
                                        const h2 = str.match(/"height"\s*:\s*(\d+)/);
                                        const unescape = (s) => s.replace(/\\u002F/g, '/').replace(/\\u0026/g, '&').replace(/\\"/g, '"');
                                        return {
                                            title: titleM ? unescape(titleM[1]) : '',
                                            author: authorM ? unescape(authorM[1]) : '',
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
        if (!directVideoUrl) {
            // yt-dlp with an authenticated cookies.txt will work where Playwright is
            // blocked by TikTok's IP/login checks.
            const ytdlp = await this.ytDlpExtractMedia(resolvedUrl);
            if (ytdlp?.videoUrl) {
                directVideoUrl = ytdlp.videoUrl;
                isAuthorized = true;
            }
            else if (ytdlp?.audioUrl) {
                audioOnlyUrl = ytdlp.audioUrl;
                isAuthorized = true;
            }
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
                directDownloadUrl: directVideoUrl || audioOnlyUrl,
                notes: 'Notice: Source mobile sound is typically 128 kbps AAC; 320 kbps export does not recreate lost frequencies.',
            },
            {
                id: 'tt-audio-m4a',
                type: 'audio',
                format: 'm4a',
                qualityLabel: 'Extract Sound (Original M4A/AAC Stream)',
                directDownloadUrl: directVideoUrl || audioOnlyUrl,
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
            rawSourceUrl: directVideoUrl || audioOnlyUrl,
            rawMuxedUrl: directVideoUrl,
            rawVideoUrl: directVideoUrl,
            rawAudioUrl: audioOnlyUrl,
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
            const u = this.cleanUrl(obj.downloadAddr);
            if (this.isDirectVideoStreamUrl(u)) {
                callback({ videoUrl: u });
            }
            return;
        }
        if (obj.playAddr) {
            const u = this.cleanUrl(obj.playAddr);
            if (this.isDirectVideoStreamUrl(u)) {
                callback({ videoUrl: u });
            }
            return;
        }
        if (obj.downloadApi) {
            const u = this.cleanUrl(obj.downloadApi);
            if (this.isDirectVideoStreamUrl(u)) {
                callback({ videoUrl: u });
            }
            return;
        }
        if (obj.playApi) {
            const u = this.cleanUrl(obj.playApi);
            if (this.isDirectVideoStreamUrl(u)) {
                callback({ videoUrl: u });
            }
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
    isDirectVideoStreamUrl(url) {
        if (!url || typeof url !== 'string')
            return false;
        if (/\/api\/|ttwstatic|playback1|oembed|\/v\d+\/user\/|\/v\d+\/list\b|\/v\d+\/item_list/i.test(url))
            return false;
        // Must look like an actual video resource: the TikTok "play" endpoint,
        // a query mime_type=video, or a .mp4 path.
        return /mime_type=video|\.mp4(\?|$)|\/aweme\/v\d+\/play|\/social\/play|videoplayback/i.test(url);
    }
    async ytDlpExtractMedia(url) {
        try {
            const cookies = findCookiesFile();
            const args = ['--no-warnings', '--dump-single-json', '--no-playlist'];
            if (cookies)
                args.push('--cookies', cookies);
            args.push(url);
            const { stdout } = await execFileAsync(findYtDlp(), args, {
                timeout: 90000,
                maxBuffer: 64 * 1024 * 1024,
            });
            const json = JSON.parse(stdout.toString());
            const videoCandidates = [];
            const audioCandidates = [];
            for (const f of json?.formats || []) {
                if (!f?.url)
                    continue;
                const hint = `${f?.vcodec || ''} ${f?.ext || ''} ${f?.protocol || ''} ${f?.mime_type || f?.mimetype || ''} ${f.url}`;
                if (f?.ext === 'mp3' || /audio|acodec=mp3|ext .*mp3|vcodec=none|vcodec: ?none/i.test(hint) && f?.ext !== 'mp4' && f?.ext !== 'webm') {
                    audioCandidates.push(f.url);
                }
                else if (/video.*mp4|\.mp4|mime_type=video|aweme|video\/mp4/i.test(hint)) {
                    videoCandidates.push(f.url);
                }
                else if (f?.ext === 'mp4' || (f?.vcodec && f.vcodec !== 'none')) {
                    videoCandidates.push(f.url);
                }
            }
            if (json?.url && !audioCandidates.length && this.isDirectVideoStreamUrl(json.url)) {
                videoCandidates.unshift(json.url);
            }
            const v = videoCandidates.find((u) => this.isDirectVideoStreamUrl(u));
            const a = audioCandidates.find((u) => typeof u === 'string' && /^https?:/i.test(u));
            if (v)
                return { videoUrl: v };
            if (a)
                return { audioUrl: a };
        }
        catch (err) {
            console.error('yt-dlp TikTok extract failed:', err.message);
        }
        return undefined;
    }
    async ytDlpProfileVideos(url, author) {
        try {
            const cookies = findCookiesFile();
            const args = ['--flat-playlist', '--dump-json', '--no-warnings', '--playlist-end', '50'];
            if (cookies)
                args.push('--cookies', cookies);
            args.push(url);
            const { stdout } = await execFileAsync(findYtDlp(), args, {
                timeout: 120000,
                maxBuffer: 64 * 1024 * 1024,
            });
            const out = [];
            for (const line of stdout.toString().split(/\r?\n/)) {
                const t = line.trim();
                if (!t)
                    continue;
                try {
                    const e = JSON.parse(t);
                    const id = e.id;
                    const name = e.uploader || e.channel || author.replace(/^@/, '');
                    if (!id || Number.isNaN(Number(id)) && !/^\d+$/.test(String(id)))
                        continue;
                    const thumb = typeof e.thumbnail === 'string' && e.thumbnail
                        ? e.thumbnail
                        : Array.isArray(e.thumbnails) && e.thumbnails.length
                            ? e.thumbnails[e.thumbnails.length - 1]?.url
                            : undefined;
                    out.push({
                        title: (e.title || `TikTok ${id}`).slice(0, 200),
                        url: e.webpage_url || `https://www.tiktok.com/@${name}/video/${id}`,
                        creator: name,
                        duration: typeof e.duration === 'number' ? Math.round(e.duration) : undefined,
                        thumbnail: thumb,
                        mediaType: 'video',
                    });
                }
                catch { }
            }
            return out;
        }
        catch (err) {
            console.error('yt-dlp TikTok profile listing failed:', err.message);
            return [];
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
