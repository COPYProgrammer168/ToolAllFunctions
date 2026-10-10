import { fetchWithRetry } from '../../utils/httpFetch.js';
import { RateLimitedError } from '../../utils/errors.js';
/** SoundCloud's `tracks?ids=` endpoint accepts up to 200 ids; 50 keeps the
 *  response comfortably small and under the URL length limits. */
const TRACK_ID_BATCH_SIZE = 50;
/** SoundCloud API clients bundle these params with every v2 call. */
function apiParams(clientId, extra = '') {
    return `client_id=${clientId}&app_version=1751368616&app_locale=en${extra ? `&${extra}` : ''}`;
}
/**
 * Short reason a listed track cannot be fetched, or `undefined` when it is
 * publicly accessible. No attempt is made to bypass a restriction.
 */
function trackUnavailability(t) {
    if (!t)
        return 'Unavailable';
    const policy = String(t.policy || '').toUpperCase();
    if (policy === 'BLOCK' || t.streamable === false)
        return 'Restricted';
    if (t.policy === 'SNIP')
        return 'Preview only';
    return undefined;
}
function toTrackInfo(t) {
    const durationSec = typeof t.duration === 'number' ? Math.round(t.duration / 1000) : undefined;
    return {
        title: t.title,
        url: t.permalink_url,
        creator: t.user?.username,
        duration: durationSec,
        thumbnail: t.artwork_url || undefined,
        mediaType: 'audio',
        id: typeof t.id === 'number' ? t.id : undefined,
        unavailable: trackUnavailability(t),
    };
}
export class SoundCloudProvider {
    id = 'soundcloud';
    displayName = 'SoundCloud';
    matches(url) {
        return /soundcloud\.com\/[\w-]+/i.test(url);
    }
    async analyze(url) {
        // Playlist pages (e.g. /artist/sets/playlist-name)
        if (/^https?:\/\/(www\.|m\.)?soundcloud\.com\/[\w-]+\/sets\/[\w-]+\/?(\?.*)?$/i.test(url)) {
            return this.analyzePlaylist(url);
        }
        // Profile / user listing pages (e.g. /artist or /artist/tracks)
        if (/^https?:\/\/(www\.|m\.)?soundcloud\.com\/[\w-]+\/?(tracks|likes|reposts)?\/?(\?.*)?$/i.test(url)) {
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
    async analyzePlaylist(url) {
        let title = 'SoundCloud Playlist';
        let author = 'Unknown Artist';
        let thumbnail = '';
        const tracks = [];
        /** Playlist position → resolved metadata, merged back in order further down. */
        const slots = [];
        let totalTracks = 0;
        try {
            // 1. Playlist page HTML → public API client_id (same auth flow used elsewhere)
            const pageRes = await fetchWithRetry(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                },
                redirect: 'follow',
                signal: AbortSignal.timeout(10000),
            }, 'SoundCloud playlist page');
            let clientId;
            if (pageRes.ok) {
                const html = await pageRes.text();
                const hydrationMatch = html.match(/window\.__sc_hydration\s*=\s*(\[[\s\S]*?\]);<\/script>/);
                if (hydrationMatch) {
                    try {
                        const entries = JSON.parse(hydrationMatch[1]);
                        const apiClient = entries.find((d) => d.hydratable === 'apiClient')?.data;
                        clientId = apiClient?.id;
                    }
                    catch { }
                }
            }
            if (!clientId) {
                return {
                    sourceUrl: url,
                    platform: 'soundcloud',
                    title,
                    creator: author,
                    thumbnail,
                    duration: 0,
                    mediaType: 'audio',
                    downloadAuthorized: false,
                    authorizedNotice: 'Could not resolve playlist. The playlist may be private or the URL is invalid.',
                    copyrightNotice: 'SoundCloud streams are protected by artist copyright. Only download tracks you own or that the artist has made publicly accessible.',
                    availableFormats: [],
                    tracks,
                    totalTracks: 0,
                };
            }
            // 2. Resolve the playlist. SoundCloud only hydrates full metadata for the
            //    first handful of entries; the rest arrive as id-only stubs.
            const resolveUrl = `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(url)}&${apiParams(clientId)}`;
            const apiRes = await fetchWithRetry(resolveUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
                signal: AbortSignal.timeout(10000),
            }, 'SoundCloud playlist resolve');
            if (apiRes.ok) {
                const playlist = (await apiRes.json());
                if (playlist.title)
                    title = playlist.title;
                if (playlist.user?.username)
                    author = playlist.user.username;
                if (playlist.artwork_url)
                    thumbnail = playlist.artwork_url;
                const entries = Array.isArray(playlist.tracks) ? playlist.tracks : [];
                totalTracks = entries.length;
                // Record every entry at its playlist position, hydrating in place.
                const stubIds = [];
                for (const entry of entries) {
                    const id = typeof entry?.id === 'number' ? entry.id : undefined;
                    const slot = { id };
                    if (entry?.permalink_url && entry?.title) {
                        slot.info = toTrackInfo(entry);
                    }
                    else if (id !== undefined) {
                        stubIds.push(id);
                    }
                    else if (entry?.permalink_url) {
                        // Usable URL but no title — keep it, marked as metadata-limited.
                        slot.info = {
                            title: 'Unknown track',
                            url: entry.permalink_url,
                            mediaType: 'audio',
                            unavailable: 'Metadata unavailable',
                        };
                    }
                    slots.push(slot);
                }
                // 3. Fetch full metadata for the stubs in batches via tracks?ids=.
                if (stubIds.length > 0 && clientId) {
                    const resolvedById = new Map();
                    for (let i = 0; i < stubIds.length; i += TRACK_ID_BATCH_SIZE) {
                        const batch = stubIds.slice(i, i + TRACK_ID_BATCH_SIZE);
                        const batchRes = await fetchWithRetry(`https://api-v2.soundcloud.com/tracks?ids=${batch.join(',')}&${apiParams(clientId)}`, {
                            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
                            signal: AbortSignal.timeout(10000),
                        }, 'SoundCloud batch track metadata');
                        if (!batchRes.ok)
                            break;
                        const batchTracks = (await batchRes.json());
                        if (Array.isArray(batchTracks)) {
                            for (const t of batchTracks) {
                                if (t?.id !== undefined && t?.permalink_url && t?.title) {
                                    resolvedById.set(t.id, toTrackInfo(t));
                                }
                            }
                        }
                    }
                    // Merge back into the original playlist order.
                    for (const slot of slots) {
                        if (slot.info || slot.id === undefined)
                            continue;
                        const resolved = resolvedById.get(slot.id);
                        if (resolved) {
                            slot.info = resolved;
                        }
                        else {
                            // Still a stub: private, removed or geo-restricted. It stays listed
                            // (the user asked for all tracks) but its actions are disabled.
                            slot.info = {
                                title: 'Unavailable track',
                                url: `soundcloud:track:${slot.id}`,
                                id: slot.id,
                                mediaType: 'audio',
                                unavailable: 'Private or region-blocked',
                            };
                        }
                    }
                }
                for (const slot of slots) {
                    if (slot.info)
                        tracks.push(slot.info);
                }
            }
        }
        catch (err) {
            // A platform 429 must reach the API layer as 429 + Retry-After, not be
            // flattened into "playlist is empty".
            if (err instanceof RateLimitedError)
                throw err;
        }
        if (tracks.length === 0) {
            try {
                const pageRes2 = await fetchWithRetry(url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.9',
                    },
                    redirect: 'follow',
                    signal: AbortSignal.timeout(10000),
                }, 'SoundCloud playlist page (fallback)');
                if (pageRes2.ok) {
                    const html = await pageRes2.text();
                    const seen = new Set(tracks.map((t) => t.url));
                    const extractFromNode = (node) => {
                        if (!node || typeof node !== 'object')
                            return;
                        if (Array.isArray(node)) {
                            node.forEach(extractFromNode);
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
                                mediaType: 'audio',
                                id: typeof node.id === 'number' ? node.id : undefined,
                                unavailable: trackUnavailability(node),
                            });
                        }
                        Object.values(node).forEach(extractFromNode);
                    };
                    const hydrationMatch = html.match(/window\.__sc_hydration\s*=\s*(\[[\s\S]*?\]);<\/script>/);
                    if (hydrationMatch) {
                        try {
                            const entries = JSON.parse(hydrationMatch[1]);
                            extractFromNode(entries);
                        }
                        catch {
                            // parse failed
                        }
                    }
                    if (tracks.length === 0) {
                        const jsonMatches = html.matchAll(/\{(?:[^{}]|\{[^{}]*\})*"kind"\s*:\s*"track"(?:[^{}]|\{[^{}]*\})*\}/g);
                        for (const m of jsonMatches) {
                            try {
                                const node = JSON.parse(m[0]);
                                if (node.permalink_url && node.title && !seen.has(node.permalink_url)) {
                                    seen.add(node.permalink_url);
                                    tracks.push({
                                        title: node.title,
                                        url: node.permalink_url,
                                        creator: node.user?.username,
                                        duration: typeof node.duration === 'number' ? Math.round(node.duration / 1000) : undefined,
                                        thumbnail: node.artwork_url || undefined,
                                        mediaType: 'audio',
                                        id: typeof node.id === 'number' ? node.id : undefined,
                                        unavailable: trackUnavailability(node),
                                    });
                                }
                            }
                            catch {
                                // parse failed
                            }
                        }
                    }
                    if (tracks.length === 0) {
                        const trackUrlMatches = html.matchAll(/https?:\/\/soundcloud\.com\/([\w-]+)\/([\w-]+)/g);
                        for (const m of trackUrlMatches) {
                            const trackUrl = m[0];
                            if (!seen.has(trackUrl)) {
                                seen.add(trackUrl);
                                tracks.push({ title: m[2].replace(/-/g, ' '), url: trackUrl });
                            }
                        }
                    }
                }
            }
            catch {
                // page extraction fallback failed
            }
        }
        return {
            sourceUrl: url,
            platform: 'soundcloud',
            title: `${author} — ${title}`,
            creator: author,
            thumbnail,
            duration: 0,
            mediaType: 'audio',
            downloadAuthorized: false,
            authorizedNotice: tracks.length > 0
                ? 'This is a SoundCloud playlist. Pick a track below to inspect and download it.'
                : 'Could not load playlist tracks. The playlist may be empty or private.',
            copyrightNotice: 'SoundCloud streams are protected by artist copyright. Only download tracks you own or that the artist has made publicly accessible.',
            availableFormats: [],
            tracks,
            // Fall back to what was actually listed when no API count was obtained.
            totalTracks: totalTracks || tracks.length,
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
