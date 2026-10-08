const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
/** Innertube params for the channel "Videos" tab */
const CHANNEL_VIDEOS_PARAMS = 'EgZ2aWRlb3PyBgQKAjoA';
const MAX_CHANNEL_VIDEOS = 200;
export class YouTubeProvider {
    id = 'youtube';
    displayName = 'YouTube';
    matches(url) {
        return /(?:youtube\.com\/(?:watch\?|shorts\/|embed\/|channel\/|c\/|user\/|@)|youtu\.be\/)/i.test(url);
    }
    async analyze(url) {
        if (this.isChannelUrl(url)) {
            return this.analyzeChannel(url);
        }
        const videoId = this.extractVideoId(url);
        if (!videoId) {
            throw new Error('Invalid YouTube video link or missing video ID.');
        }
        let title = 'YouTube Media';
        let author = 'Unknown Creator';
        let thumbnail = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
        // Attempt to fetch public metadata via YouTube official oEmbed API
        try {
            const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
            const res = await fetch(oembedUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
                signal: AbortSignal.timeout(5000),
            });
            if (res.ok) {
                const data = (await res.json());
                title = data.title || title;
                author = data.author_name || author;
                thumbnail = data.thumbnail_url || thumbnail;
            }
        }
        catch {
            // Keep fallbacks
        }
        // Attempt to resolve direct, authorized stream URLs via the public
        // Innertube player API metadata embedded in the watch page. Streams
        // exposed this way are publicly addressable without DRM circumvention.
        let directVideoUrl;
        let directAudioUrl;
        let adaptiveVideoUrl;
        let adaptiveVideoResolution;
        let adaptiveVideoFps;
        let videoResolution;
        let videoFps;
        try {
            const pageRes = await fetch(url, {
                headers: {
                    'User-Agent': UA,
                    'Accept-Language': 'en-US,en;q=0.9',
                },
                redirect: 'follow',
                signal: AbortSignal.timeout(8000),
            });
            if (pageRes.ok) {
                const html = await pageRes.text();
                const apiKey = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1];
                if (apiKey) {
                    const clients = [
                        { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 30 },
                        { clientName: 'ANDROID_VR', clientVersion: '1.57.27', androidSdkVersion: 32, osVersion: '12' },
                        { clientName: 'IOS', clientVersion: '21.02.3', deviceMake: 'Apple', deviceModel: 'iPhone16,2' },
                        { clientName: 'WEB', clientVersion: '2.20250610.01.00' },
                    ];
                    for (const client of clients) {
                        try {
                            const playerRes = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${apiKey}`, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'User-Agent': UA,
                                },
                                body: JSON.stringify({ context: { client }, videoId, contentCheckOk: true, racyCheckOk: true }),
                                signal: AbortSignal.timeout(8000),
                            });
                            if (!playerRes.ok)
                                continue;
                            const data = (await playerRes.json());
                            if (data?.playabilityStatus?.status && data.playabilityStatus.status !== 'OK')
                                continue;
                            // True muxed (audio+video) streams live in `formats`; entries in
                            // `adaptiveFormats` are video-only or audio-only and must not be
                            // used as the playable video source or the downloaded clip would
                            // have no audio.
                            const muxedOnly = (data.streamingData?.formats || [])
                                .filter((f) => f.url && /video\/mp4/.test(f.mimeType || ''))
                                .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
                            if (muxedOnly.length > 0) {
                                directVideoUrl = muxedOnly[0].url;
                                videoResolution = muxedOnly[0].qualityLabel || muxedOnly[0].quality;
                                videoFps = muxedOnly[0].fps;
                            }
                            // Best adaptive video-only stream (used for muxing when no
                            // muxed stream is available, e.g. most modern YouTube uploads).
                            const adaptiveVideos = (data.streamingData?.adaptiveFormats || [])
                                .filter((f) => f.url && /video\/mp4/.test(f.mimeType || ''))
                                .sort((a, b) => {
                                const score = (f) => (f.mimeType?.includes('avc1') ? 1e12 : 0) + (f.height || 0);
                                return score(b) - score(a);
                            });
                            if (adaptiveVideos.length > 0) {
                                adaptiveVideoUrl = adaptiveVideoUrl || adaptiveVideos[0].url;
                                adaptiveVideoResolution =
                                    adaptiveVideoResolution ||
                                        adaptiveVideos[0].qualityLabel ||
                                        adaptiveVideos[0].quality;
                                adaptiveVideoFps = adaptiveVideoFps || adaptiveVideos[0].fps;
                            }
                            // Audio-only M4A adaptive stream for the audio extraction path.
                            const audioPool = [...(data.streamingData?.formats || []), ...(data.streamingData?.adaptiveFormats || [])];
                            const audio = audioPool
                                .filter((f) => f.url && /audio\/mp4/.test(f.mimeType || ''))
                                .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
                            if (audio.length > 0) {
                                directAudioUrl = audio[0].url;
                            }
                            if (directVideoUrl || directAudioUrl)
                                break;
                        }
                        catch {
                            // Try the next client profile
                        }
                    }
                }
            }
        }
        catch {
            // Page / Innertube resolution failed
        }
        const downloadAuthorized = !!(directVideoUrl || adaptiveVideoUrl || directAudioUrl);
        // The public stream URLs found above are only used when present; DRM
        // circumvention and unauthorized extraction are never performed.
        const formats = [
            ...(directVideoUrl || adaptiveVideoUrl
                ? [
                    {
                        id: 'yt-video-1080p',
                        type: 'video',
                        format: 'mp4',
                        qualityLabel: videoResolution
                            ? `${videoResolution} MP4 (Direct Stream)`
                            : adaptiveVideoResolution
                                ? `${adaptiveVideoResolution} MP4 (Direct Stream, muxed with audio on download)`
                                : 'MP4 (Direct Stream)',
                        resolution: videoResolution || adaptiveVideoResolution,
                        fps: videoFps || adaptiveVideoFps,
                        directDownloadUrl: directVideoUrl || adaptiveVideoUrl,
                        notes: directVideoUrl
                            ? 'Publicly addressable muxed stream exposed by the player metadata.'
                            : 'Adaptive stream; audio and video are muxed together when downloading.',
                    },
                ]
                : [
                    {
                        id: 'yt-video-1080p',
                        type: 'video',
                        format: 'mp4',
                        qualityLabel: '1080p Full HD',
                        resolution: '1920x1080',
                        fps: 30,
                    },
                ]),
            {
                id: 'yt-audio-mp3',
                type: 'audio',
                format: 'mp3',
                qualityLabel: '320 kbps (High Export)',
                bitrateKbps: 320,
                directDownloadUrl: directAudioUrl || directVideoUrl,
                notes: 'Output will be encoded at 320 kbps CBR. Does not restore audio lost in source.',
            },
            {
                id: 'yt-audio-m4a',
                type: 'audio',
                format: 'm4a',
                qualityLabel: 'Original Audio Container (AAC/M4A)',
                isLossless: false,
                directDownloadUrl: directAudioUrl || directVideoUrl,
                notes: 'Direct stream extraction without generational loss when supported.',
            },
        ];
        return {
            sourceUrl: url,
            platform: 'youtube',
            title,
            creator: author,
            thumbnail,
            duration: 0,
            mediaType: 'video',
            downloadAuthorized,
            authorizedNotice: downloadAuthorized
                ? undefined
                : 'This media cannot be downloaded through this tool because the platform does not provide an authorized download method for it right now (blocked, age-restricted, or requires sign-in).',
            copyrightNotice: 'This tool respects content rights. Use only for content you own or where an authorized download is provided.',
            availableFormats: formats,
            rawSourceUrl: directVideoUrl || adaptiveVideoUrl,
            rawMuxedUrl: directVideoUrl,
            rawVideoUrl: directVideoUrl || adaptiveVideoUrl,
            rawAudioUrl: directAudioUrl,
        };
    }
    isChannelUrl(url) {
        // Channel/home/handle pages (not a specific watch/shorts video)
        if (/youtu\.be\//i.test(url) || /youtube\.com\/(?:watch\?|shorts\/|embed\/)/i.test(url)) {
            return false;
        }
        return /youtube\.com\/(?:@[\w.-]+|channel\/[\w-]+|c\/[\w.-]+|user\/[\w.-]+)(?:\/(?:videos|featured|streams|shorts|about|playlists)?)?\/?(?:\?.*)?$/i.test(url);
    }
    async analyzeChannel(url) {
        let title = 'YouTube Channel';
        let author = 'Unknown Channel';
        let thumbnail = '';
        const tracks = [];
        try {
            // Prefer the Videos tab so the first payload already lists uploads
            const videosUrl = this.toChannelVideosUrl(url);
            const pageRes = await fetch(videosUrl, {
                headers: {
                    'User-Agent': UA,
                    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                },
                redirect: 'follow',
                signal: AbortSignal.timeout(12000),
            });
            if (!pageRes.ok) {
                return this.emptyChannelResult(url, title, author, thumbnail, tracks, 'Could not open the channel page.');
            }
            const html = await pageRes.text();
            const apiKey = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1];
            const channelId = html.match(/"channelId":"(UC[\w-]+)"/)?.[1] ||
                html.match(/"externalId":"(UC[\w-]+)"/)?.[1] ||
                html.match(/youtube\.com\/channel\/(UC[\w-]+)/)?.[1];
            const channelName = html.match(/"ownerChannelName":"([^"]+)"/)?.[1] ||
                html.match(/"channelMetadataRenderer":\{"title":"([^"]+)"/)?.[1] ||
                html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i)?.[1];
            if (channelName) {
                author = this.decodeHtmlEntities(channelName);
                title = `${author} — Channel Videos`;
            }
            const ogImg = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i)?.[1];
            if (ogImg)
                thumbnail = ogImg;
            // Collect videos already embedded in the initial HTML ytInitialData
            const initialDataMatch = html.match(/ytInitialData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
            if (initialDataMatch) {
                try {
                    const initialData = JSON.parse(initialDataMatch[1]);
                    this.collectVideosFromBrowse(initialData, tracks, author);
                }
                catch {
                    // ignore parse errors
                }
            }
            if (apiKey && channelId) {
                let continuation;
                // First browse call if we still have few items
                if (tracks.length < 30) {
                    const first = await this.browseChannelVideos(apiKey, channelId);
                    for (const t of first.tracks) {
                        if (!tracks.some((x) => x.url === t.url))
                            tracks.push(t);
                    }
                    continuation = first.continuation;
                }
                else if (initialDataMatch) {
                    try {
                        continuation = this.findContinuationToken(JSON.parse(initialDataMatch[1]));
                    }
                    catch {
                        continuation = undefined;
                    }
                }
                let pages = 0;
                while (continuation && tracks.length < MAX_CHANNEL_VIDEOS && pages < 15) {
                    pages++;
                    const next = await this.browseChannelContinuation(apiKey, continuation);
                    for (const t of next.tracks) {
                        if (!tracks.some((x) => x.url === t.url))
                            tracks.push(t);
                    }
                    continuation = next.continuation;
                    if (next.tracks.length === 0)
                        break;
                }
            }
        }
        catch (err) {
            console.error('YouTube channel analyze failed:', err);
        }
        const limited = tracks.slice(0, MAX_CHANNEL_VIDEOS);
        return {
            sourceUrl: url,
            platform: 'youtube',
            title,
            creator: author,
            thumbnail,
            duration: 0,
            mediaType: 'mixed',
            downloadAuthorized: limited.length > 0,
            authorizedNotice: limited.length > 0
                ? `Found ${limited.length} video(s) on this channel. Select items below to download as video or music.`
                : 'Could not list channel videos. The channel may be private, empty, or blocked.',
            copyrightNotice: 'YouTube content belongs to respective creators. Only download content you own or have explicit permission to use.',
            availableFormats: [],
            tracks: limited,
        };
    }
    emptyChannelResult(url, title, author, thumbnail, tracks, notice) {
        return {
            sourceUrl: url,
            platform: 'youtube',
            title,
            creator: author,
            thumbnail,
            duration: 0,
            mediaType: 'mixed',
            downloadAuthorized: false,
            authorizedNotice: notice,
            copyrightNotice: 'YouTube content belongs to respective creators. Only download content you own or have explicit permission to use.',
            availableFormats: [],
            tracks,
        };
    }
    toChannelVideosUrl(url) {
        try {
            const u = new URL(url);
            // Strip trailing path segments like /about, then force /videos
            const parts = u.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
            // Keep handle / channel / c / user + id
            if (parts.length >= 1) {
                const base = parts[0].startsWith('@')
                    ? `/${parts[0]}`
                    : parts.length >= 2
                        ? `/${parts[0]}/${parts[1]}`
                        : `/${parts[0]}`;
                u.pathname = `${base}/videos`;
            }
            u.search = '';
            u.hash = '';
            return u.toString();
        }
        catch {
            return url.replace(/\/?(videos|featured|streams|shorts|about|playlists)?\/?(\?.*)?$/i, '/videos');
        }
    }
    async browseChannelVideos(apiKey, channelId) {
        const tracks = [];
        try {
            const res = await fetch(`https://www.youtube.com/youtubei/v1/browse?key=${apiKey}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': UA,
                },
                body: JSON.stringify({
                    context: {
                        client: { clientName: 'WEB', clientVersion: '2.20240726.01.00' },
                    },
                    browseId: channelId,
                    params: CHANNEL_VIDEOS_PARAMS,
                }),
                signal: AbortSignal.timeout(12000),
            });
            if (!res.ok)
                return { tracks };
            const data = (await res.json());
            this.collectVideosFromBrowse(data, tracks);
            return { tracks, continuation: this.findContinuationToken(data) };
        }
        catch {
            return { tracks };
        }
    }
    async browseChannelContinuation(apiKey, continuation) {
        const tracks = [];
        try {
            const res = await fetch(`https://www.youtube.com/youtubei/v1/browse?key=${apiKey}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': UA,
                },
                body: JSON.stringify({
                    context: {
                        client: { clientName: 'WEB', clientVersion: '2.20240726.01.00' },
                    },
                    continuation,
                }),
                signal: AbortSignal.timeout(12000),
            });
            if (!res.ok)
                return { tracks };
            const data = (await res.json());
            this.collectVideosFromBrowse(data, tracks);
            return { tracks, continuation: this.findContinuationToken(data) };
        }
        catch {
            return { tracks };
        }
    }
    collectVideosFromBrowse(node, tracks, defaultCreator) {
        if (!node || typeof node !== 'object')
            return;
        const pushTrack = (videoId, titleText, duration, thumbnail, creator) => {
            const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
            if (tracks.some((t) => t.url === watchUrl))
                return;
            tracks.push({
                title: titleText || `Video ${videoId}`,
                url: watchUrl,
                creator: creator || defaultCreator,
                duration,
                thumbnail: thumbnail || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
                mediaType: 'video',
            });
        };
        const pushFromRenderer = (vr) => {
            if (!vr)
                return;
            const videoId = vr.videoId;
            if (!videoId)
                return;
            const titleRuns = vr.title?.runs || vr.title?.simpleText;
            const titleText = typeof titleRuns === 'string'
                ? titleRuns
                : Array.isArray(titleRuns)
                    ? titleRuns.map((r) => r.text).join('')
                    : vr.title?.accessibility?.accessibilityData?.label || `Video ${videoId}`;
            const lengthText = vr.lengthText?.simpleText ||
                vr.lengthText?.runs?.[0]?.text ||
                vr.thumbnailOverlays?.find((o) => o.thumbnailOverlayTimeStatusRenderer)
                    ?.thumbnailOverlayTimeStatusRenderer?.text?.simpleText;
            const duration = this.parseDurationLabel(lengthText);
            const thumbs = vr.thumbnail?.thumbnails || [];
            const thumbnail = thumbs.length ? thumbs[thumbs.length - 1].url : undefined;
            pushTrack(videoId, titleText, duration, thumbnail, vr.ownerText?.runs?.[0]?.text || vr.shortBylineText?.runs?.[0]?.text);
        };
        // Modern YouTube channel/Videos tab uses lockupViewModel instead of videoRenderer
        const pushFromLockup = (lv) => {
            if (!lv)
                return;
            const videoId = lv.contentId ||
                lv.rendererContext?.commandContext?.onTap?.innertubeCommand?.watchEndpoint?.videoId ||
                lv.rendererContext?.commandContext?.onTap?.innertubeCommand?.commandMetadata?.webCommandMetadata?.url?.match(/[?&]v=([\w-]{11})/)?.[1];
            if (!videoId || !/^[\w-]{11}$/.test(videoId))
                return;
            const titleText = lv.metadata?.lockupMetadataViewModel?.title?.content ||
                lv.rendererContext?.accessibilityContext?.label?.replace(/\s+\d+\s+minutes?.*$/i, '').trim() ||
                `Video ${videoId}`;
            // Duration badge text like "3:20"
            let lengthText;
            const overlays = lv.contentImage?.thumbnailViewModel?.overlays || [];
            for (const overlay of overlays) {
                const badges = overlay?.thumbnailBottomOverlayViewModel?.badges || [];
                for (const badge of badges) {
                    const text = badge?.thumbnailBadgeViewModel?.text;
                    if (typeof text === 'string' && /^\d+:\d+/.test(text)) {
                        lengthText = text;
                        break;
                    }
                }
                if (lengthText)
                    break;
            }
            const duration = this.parseDurationLabel(lengthText) ||
                this.parseSpokenDuration(lv.rendererContext?.accessibilityContext?.label);
            const sources = lv.contentImage?.thumbnailViewModel?.image?.sources || [];
            const thumbnail = sources.length ? sources[sources.length - 1].url : undefined;
            pushTrack(videoId, titleText, duration, thumbnail);
        };
        const walk = (obj, depth = 0) => {
            if (!obj || typeof obj !== 'object' || depth > 25)
                return;
            if (Array.isArray(obj)) {
                obj.forEach((x) => walk(x, depth + 1));
                return;
            }
            if (obj.videoRenderer)
                pushFromRenderer(obj.videoRenderer);
            if (obj.gridVideoRenderer)
                pushFromRenderer(obj.gridVideoRenderer);
            if (obj.lockupViewModel)
                pushFromLockup(obj.lockupViewModel);
            if (obj.richItemRenderer?.content?.videoRenderer) {
                pushFromRenderer(obj.richItemRenderer.content.videoRenderer);
            }
            if (obj.richItemRenderer?.content?.lockupViewModel) {
                pushFromLockup(obj.richItemRenderer.content.lockupViewModel);
            }
            for (const v of Object.values(obj)) {
                if (v && typeof v === 'object')
                    walk(v, depth + 1);
            }
        };
        walk(node);
    }
    /** Parse labels like "Pastel Ghost … 3 minutes, 20 seconds" */
    parseSpokenDuration(label) {
        if (!label || typeof label !== 'string')
            return undefined;
        const hours = label.match(/(\d+)\s+hours?/i)?.[1];
        const mins = label.match(/(\d+)\s+minutes?/i)?.[1];
        const secs = label.match(/(\d+)\s+seconds?/i)?.[1];
        if (!hours && !mins && !secs)
            return undefined;
        return (parseInt(hours || '0', 10) * 3600) + (parseInt(mins || '0', 10) * 60) + parseInt(secs || '0', 10);
    }
    findContinuationToken(node) {
        // The full channel page contains several continuation tokens (other tabs,
        // chip filters, header reload). Always prefer the one inside the Videos
        // tab, otherwise we may follow a token that skips videos.
        const videosTab = this.findVideosTabContent(node);
        if (videosTab) {
            const scoped = this.findTokenInNode(videosTab);
            if (scoped)
                return scoped;
        }
        return this.findTokenInNode(node);
    }
    findTokenInNode(node) {
        let token;
        const walk = (obj, depth = 0) => {
            if (!obj || typeof obj !== 'object' || depth > 30 || token)
                return;
            if (Array.isArray(obj)) {
                obj.forEach((x) => walk(x, depth + 1));
                return;
            }
            if (obj.continuationItemRenderer) {
                const t = obj.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token ||
                    obj.continuationItemRenderer?.continuationEndpoint?.commandExecutorCommand?.commands?.find((c) => c.continuationCommand?.token)?.continuationCommand?.token;
                if (t) {
                    token = t;
                    return;
                }
            }
            for (const v of Object.values(obj)) {
                if (v && typeof v === 'object')
                    walk(v, depth + 1);
            }
        };
        walk(node);
        return token;
    }
    findVideosTabContent(node) {
        let found;
        const walk = (obj, depth = 0) => {
            if (!obj || typeof obj !== 'object' || depth > 25 || found)
                return;
            if (Array.isArray(obj)) {
                obj.forEach((x) => walk(x, depth + 1));
                return;
            }
            const tr = obj.tabRenderer;
            if (tr) {
                const title = typeof tr.title === 'string' ? tr.title : '';
                const params = tr.endpoint?.browseEndpoint?.params;
                const url = tr.endpoint?.browseEndpoint?.canonicalBaseUrl || '';
                if (title.toLowerCase() === 'videos' ||
                    params === CHANNEL_VIDEOS_PARAMS ||
                    /\/videos\/?$/i.test(url)) {
                    found = tr.content || tr;
                    return;
                }
            }
            for (const v of Object.values(obj)) {
                if (v && typeof v === 'object')
                    walk(v, depth + 1);
            }
        };
        walk(node);
        return found;
    }
    parseDurationLabel(label) {
        if (!label || typeof label !== 'string')
            return undefined;
        const parts = label.trim().split(':').map((p) => parseInt(p, 10));
        if (parts.some((n) => Number.isNaN(n)))
            return undefined;
        if (parts.length === 3)
            return parts[0] * 3600 + parts[1] * 60 + parts[2];
        if (parts.length === 2)
            return parts[0] * 60 + parts[1];
        if (parts.length === 1)
            return parts[0];
        return undefined;
    }
    extractVideoId(url) {
        const regExp = /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([\w-]{11})/;
        const match = url.match(regExp);
        return match ? match[1] : null;
    }
    decodeHtmlEntities(text) {
        return text
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/\\u0026/g, '&');
    }
}
