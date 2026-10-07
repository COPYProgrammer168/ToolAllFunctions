export class SoundCloudProvider {
    id = 'soundcloud';
    displayName = 'SoundCloud';
    matches(url) {
        return /soundcloud\.com\/[\w-]+/i.test(url);
    }
    async analyze(url) {
        // Profile / user listing pages (e.g. /artist or /artist/tracks)
        if (/^https?:\/\/(www\.|m\.)?soundcloud\.com\/[\w-]+\/?(tracks|sets|likes|reposts)?\/?(\?.*)?$/i.test(url)) {
            return this.analyzeProfileTracks(url);
        }
        let title = 'SoundCloud Track';
        let author = 'Unknown Artist';
        let thumbnail = '';
        let duration = 0;
        let directAudioUrl;
        let progressiveFormat;
        // Preferred strategy: parse the track page's embedded __sc_hydration payload,
        // which contains full sound metadata AND the transcoding table with the
        // progressive (direct-file) stream URLs that SoundCloud signs.
        try {
            const pageRes = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                },
                redirect: 'follow',
                signal: AbortSignal.timeout(10000),
            });
            if (pageRes.ok) {
                const html = await pageRes.text();
                const hydrationMatch = html.match(/window\.__sc_hydration\s*=\s*(\[[\s\S]*?\]);<\/script>/);
                if (hydrationMatch) {
                    try {
                        const entries = JSON.parse(hydrationMatch[1]);
                        const sound = entries.find((d) => d.hydratable === 'sound')?.data;
                        const apiClient = entries.find((d) => d.hydratable === 'apiClient')?.data;
                        const clientId = apiClient?.id;
                        if (sound) {
                            if (sound.title)
                                title = sound.title;
                            if (sound.user?.username)
                                author = sound.user.username;
                            if (sound.artwork_url)
                                thumbnail = sound.artwork_url;
                            if (typeof sound.duration === 'number')
                                duration = Math.round(sound.duration / 1000);
                            // Only progressive (single-file) streams are directly downloadable.
                            // HLS playlists would be downloaded as raw .m3u8 text and fail later.
                            const transcodings = sound.media?.transcodings || [];
                            const progressive = transcodings.find((t) => t.format?.protocol === 'progressive' && t.format?.mime_type?.includes('mpeg')) ||
                                transcodings.find((t) => t.format?.protocol === 'progressive' &&
                                    (t.format?.mime_type?.includes('mp4') || t.format?.mime_type?.includes('ogg')));
                            if (progressive?.url && clientId) {
                                try {
                                    const streamMetaUrl = new URL(progressive.url);
                                    streamMetaUrl.searchParams.set('client_id', clientId);
                                    const streamRes = await fetch(streamMetaUrl.toString(), {
                                        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
                                        signal: AbortSignal.timeout(8000),
                                    });
                                    if (streamRes.ok) {
                                        const streamJson = (await streamRes.json());
                                        if (streamJson?.url) {
                                            directAudioUrl = streamJson.url;
                                            const mime = progressive.format?.mime_type || '';
                                            progressiveFormat = mime.includes('mpeg') ? 'mp3' : mime.includes('mp4') ? 'm4a' : 'ogg';
                                        }
                                    }
                                }
                                catch {
                                    // Stream URL resolution failed; fall back to oEmbed metadata
                                }
                            }
                        }
                    }
                    catch {
                        // Hydration JSON parse failed
                    }
                }
                // OG tags fallback for metadata
                if (title === 'SoundCloud Track') {
                    const ogTitle = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i) ||
                        html.match(/<meta\s+name="title"\s+content="([^"]+)"/i);
                    if (ogTitle)
                        title = this.decodeHtmlEntities(ogTitle[1]).slice(0, 200);
                }
                if (!thumbnail) {
                    const ogImg = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
                    if (ogImg)
                        thumbnail = ogImg[1];
                }
            }
        }
        catch {
            // Page fetch failed — try oEmbed below
        }
        // Fetch track metadata via SoundCloud public oEmbed API (fallback)
        if (title === 'SoundCloud Track' || /Unknown/.test(author) || !directAudioUrl) {
            try {
                const oembedUrl = `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(url)}`;
                const res = await fetch(oembedUrl, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
                    signal: AbortSignal.timeout(5000),
                });
                if (res.ok) {
                    const data = (await res.json());
                    if (data.title)
                        title = data.title;
                    if (data.author_name)
                        author = data.author_name;
                    if (data.thumbnail_url && !thumbnail)
                        thumbnail = data.thumbnail_url;
                    if (typeof data.duration === 'number' && !duration)
                        duration = Math.round(data.duration / 1000);
                }
            }
            catch {
                // oEmbed failed
            }
        }
        // If a direct progressive stream is available, the track exposes an
        // authorized, publicly addressable file and downloading can proceed.
        const downloadAuthorized = !!directAudioUrl;
        // The media download route re-encodes through ffmpeg, so the advertised
        // output container only needs to be one the extractor supports.
        const nativeExt = progressiveFormat === 'mp3' ? 'mp3' : progressiveFormat === 'm4a' ? 'm4a' : 'mp3';
        const formats = [
            {
                id: 'sc-original',
                type: 'audio',
                format: nativeExt,
                qualityLabel: `Original Stream (${(progressiveFormat || 'mp3').toUpperCase()})`,
                directDownloadUrl: directAudioUrl,
                notes: 'Progressive audio stream as served by SoundCloud (typically 128 kbps).',
            },
            {
                id: 'sc-mp3-320',
                type: 'audio',
                format: 'mp3',
                qualityLabel: 'MP3 320 kbps (High Transcode)',
                bitrateKbps: 320,
                directDownloadUrl: directAudioUrl,
                notes: 'Notice: If the source audio stream is 128 kbps, 320 kbps transcode will not restore lost fidelity.',
            },
            {
                id: 'sc-flac',
                type: 'audio',
                format: 'flac',
                qualityLabel: 'FLAC Lossless',
                isLossless: true,
                directDownloadUrl: directAudioUrl,
                notes: 'FLAC encoding is generated from the available source stream; it cannot exceed source fidelity.',
            },
        ];
        return {
            sourceUrl: url,
            platform: 'soundcloud',
            title,
            creator: author,
            thumbnail,
            duration,
            mediaType: 'audio',
            downloadAuthorized,
            authorizedNotice: downloadAuthorized
                ? undefined
                : 'This track does not provide an authorized direct stream in its public metadata (private, region-locked, or removed).',
            copyrightNotice: 'SoundCloud streams are protected by artist copyright. Only download tracks you own or that the artist has made publicly accessible.',
            availableFormats: formats,
            rawSourceUrl: directAudioUrl,
        };
    }
    async analyzeProfileTracks(url) {
        let author = 'Unknown Artist';
        let thumbnail = '';
        const tracks = [];
        try {
            const pageRes = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                },
                redirect: 'follow',
                signal: AbortSignal.timeout(10000),
            });
            if (pageRes.ok) {
                const html = await pageRes.text();
                const hydrationMatch = html.match(/window\.__sc_hydration\s*=\s*(\[[\s\S]*?\]);<\/script>/);
                if (hydrationMatch) {
                    try {
                        const entries = JSON.parse(hydrationMatch[1]);
                        const user = entries.find((d) => d.hydratable === 'user')?.data;
                        const apiClient = entries.find((d) => d.hydratable === 'apiClient')?.data;
                        if (user?.username)
                            author = user.username;
                        if (user?.avatar_url)
                            thumbnail = user.avatar_url;
                        // Tracks on a profile page load client-side; fetch via api-v2
                        const userId = user?.id;
                        const clientId = apiClient?.id;
                        if (userId && clientId) {
                            try {
                                const apiUrl = `https://api-v2.soundcloud.com/users/${userId}/tracks?client_id=${clientId}&limit=50&linked_partitioning=1&app_version=1751368616&app_locale=en`;
                                const apiRes = await fetch(apiUrl, {
                                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
                                    signal: AbortSignal.timeout(10000),
                                });
                                if (apiRes.ok) {
                                    const apiJson = (await apiRes.json());
                                    const coll = Array.isArray(apiJson) ? apiJson : apiJson.collection || [];
                                    for (const t of coll) {
                                        if (t?.permalink_url && t?.title) {
                                            tracks.push({
                                                title: t.title,
                                                url: t.permalink_url,
                                                creator: t.user?.username,
                                                duration: typeof t.duration === 'number' ? Math.round(t.duration / 1000) : undefined,
                                                thumbnail: t.artwork_url || undefined,
                                            });
                                        }
                                    }
                                }
                            }
                            catch {
                                // api fetch failed
                            }
                        }
                        // Fallback: scan hydration payload for inline tracks
                        if (tracks.length === 0) {
                            const seen = new Set();
                            const walk = (node) => {
                                if (!node || typeof node !== 'object')
                                    return;
                                if (Array.isArray(node)) {
                                    node.forEach(walk);
                                    return;
                                }
                                if (node.kind === 'track' && node.permalink_url && node.title && !seen.has(node.permalink_url)) {
                                    seen.add(node.permalink_url);
                                    tracks.push({
                                        title: node.title,
                                        url: node.permalink_url,
                                        creator: node.user?.username,
                                        duration: typeof node.duration === 'number' ? Math.round(node.duration / 1000) : undefined,
                                        thumbnail: node.artwork_url || undefined,
                                    });
                                }
                                Object.values(node).forEach(walk);
                            };
                            walk(entries);
                        }
                    }
                    catch {
                        // parse failed
                    }
                }
            }
        }
        catch {
            // fetch failed
        }
        return {
            sourceUrl: url,
            platform: 'soundcloud',
            title: `${author} — Tracks`,
            creator: author,
            thumbnail,
            duration: 0,
            mediaType: 'audio',
            downloadAuthorized: false,
            authorizedNotice: 'This is a SoundCloud profile/tracks page. Pick a track below to inspect and download it.',
            copyrightNotice: 'SoundCloud streams are protected by artist copyright. Only download tracks you own or that the artist has made publicly accessible.',
            availableFormats: [],
            tracks,
        };
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
