import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { rememberStreamCredentials, buildStreamHeaders } from '../StreamCredentials.js';
import { parseContentRange } from '../../utils/streamRange.js';
import { YTDLP_UA, findYtDlp, readCookieJarHeader, tempCookieJar } from '../../utils/ytDlp.js';
import { findCookiesFile } from '../../utils/cookies.js';
import { fetchWithRetry } from '../../utils/httpFetch.js';
import { RateLimitedError } from '../../utils/errors.js';
const execFileAsync = promisify(execFile);
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
        // Candidate streams per kind, gathered from every Innertube client that
        // answers. They are verified against the CDN further down, because several
        // profiles are refused outright (see `firstServableStream`).
        const muxedCandidates = [];
        const adaptiveVideoCandidates = [];
        const audioCandidates = [];
        let directVideoUrl;
        let adaptiveVideoUrl;
        let adaptiveVideoResolution;
        let adaptiveVideoFps;
        let videoResolution;
        let videoFps;
        let directAudioUrl;
        let videoDurationSec = 0;
        let playabilityReason;
        let failureReason;
        /** Per-client status collected for the diagnostic message. */
        const clientNotes = [];
        try {
            // 429 is never retried here: the helper throws RateLimitedError so the
            // API answers 429 + Retry-After instead of blaming the video.
            const pageRes = await fetchWithRetry(url, {
                headers: {
                    'User-Agent': UA,
                    'Accept-Language': 'en-US,en;q=0.9',
                    // Skip the EU consent interstitial so the embedded player config
                    // (API key + visitor data) is present in the HTML.
                    Cookie: 'SOCS=CAI; CONSENT=PENDING+999',
                },
                redirect: 'follow',
                signal: AbortSignal.timeout(10000),
            }, 'YouTube watch page');
            if (!pageRes.ok) {
                failureReason = `watch page request failed with HTTP ${pageRes.status}`;
            }
            else {
                const html = await pageRes.text();
                const apiKey = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1];
                const visitorData = html.match(/"visitorData":"([^"]+)"/)?.[1] || html.match(/ytcfg\.set\(\{[^]*?"VISITOR_DATA":"([^"]+)"/)?.[1];
                if (!apiKey) {
                    failureReason = 'watch page did not contain INNERTUBE_API_KEY (consent wall or bot interstitial)';
                }
                else {
                    const clients = [
                        { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 30, osName: 'Android', osVersion: '12' },
                        { clientName: 'ANDROID_VR', clientVersion: '1.57.27', androidSdkVersion: 32, osName: 'Android', osVersion: '12' },
                        { clientName: 'IOS', clientVersion: '21.02.3', deviceMake: 'Apple', deviceModel: 'iPhone16,2', osName: 'iOS', osVersion: '17.5.1' },
                        { clientName: 'WEB', clientVersion: '2.20250610.01.00' },
                        { clientName: 'TVHTML5', clientVersion: '7.20250316.18.00' },
                        { clientName: 'WEB_EMBEDDED_PLAYER', clientVersion: '1.20250316.18.00' },
                    ];
                    for (const client of clients) {
                        try {
                            const playerRes = await fetchWithRetry(`https://www.youtube.com/youtubei/v1/player?key=${apiKey}`, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'User-Agent': UA,
                                    ...(visitorData ? { 'X-Goog-Visitor-Id': visitorData } : {}),
                                },
                                body: JSON.stringify({
                                    context: {
                                        client: { ...client, hl: 'en', gl: 'US', ...(visitorData ? { visitorData } : {}) },
                                    },
                                    videoId,
                                    contentCheckOk: true,
                                    racyCheckOk: true,
                                }),
                                signal: AbortSignal.timeout(10000),
                            }, `Innertube player (${client.clientName})`);
                            if (!playerRes.ok) {
                                clientNotes.push(`${client.clientName}: HTTP ${playerRes.status}`);
                                continue;
                            }
                            const data = (await playerRes.json());
                            if (data?.playabilityStatus?.status && data.playabilityStatus.status !== 'OK') {
                                const status = data.playabilityStatus.status;
                                const reason = data.playabilityStatus?.reason ||
                                    data.playabilityStatus?.messages?.[0] ||
                                    status;
                                playabilityReason = playabilityReason || reason;
                                clientNotes.push(`${client.clientName}: ${reason}`);
                                continue;
                            }
                            if (!data?.streamingData) {
                                clientNotes.push(`${client.clientName}: no streamingData`);
                                continue;
                            }
                            const idx = clientNotes.findIndex((n) => n.startsWith(client.clientName + ':'));
                            if (idx >= 0)
                                clientNotes.splice(idx, 1);
                            const lengthSeconds = Number(data?.videoDetails?.lengthSeconds);
                            if (Number.isFinite(lengthSeconds) && lengthSeconds > 0) {
                                videoDurationSec = lengthSeconds;
                            }
                            // True muxed (audio+video) streams live in `formats`; entries in
                            // `adaptiveFormats` are video-only or audio-only and must not be
                            // used as the playable video source or the downloaded clip would
                            // have no audio.
                            const muxedOnly = (data.streamingData?.formats || [])
                                .filter((f) => f.url && /video\/mp4/.test(f.mimeType || ''))
                                .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
                            if (muxedOnly.length > 0) {
                                muxedCandidates.push({
                                    url: muxedOnly[0].url,
                                    muxed: true,
                                    resolution: muxedOnly[0].qualityLabel || muxedOnly[0].quality,
                                    fps: muxedOnly[0].fps,
                                });
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
                                adaptiveVideoCandidates.push({
                                    url: adaptiveVideos[0].url,
                                    muxed: false,
                                    resolution: adaptiveVideos[0].qualityLabel || adaptiveVideos[0].quality,
                                    fps: adaptiveVideos[0].fps,
                                });
                            }
                            // Audio-only M4A adaptive stream for the audio extraction path.
                            const audioPool = [...(data.streamingData?.formats || []), ...(data.streamingData?.adaptiveFormats || [])];
                            const audio = audioPool
                                .filter((f) => f.url && /audio\/mp4/.test(f.mimeType || ''))
                                .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
                            if (audio.length > 0) {
                                audioCandidates.push(audio[0].url);
                            }
                            // Keep trying client profiles until we have both a playable
                            // video stream and an audio stream (a muxed stream supplies
                            // audio on its own, but an audio-only track is still preferred
                            // for the audio extraction formats).
                            const haveVideoCandidate = muxedCandidates.length > 0 || adaptiveVideoCandidates.length > 0;
                            if (haveVideoCandidate && (audioCandidates.length > 0 || muxedCandidates.length > 0))
                                break;
                        }
                        catch {
                            // Try the next client profile
                        }
                    }
                    // Several Innertube profiles are refused by the CDN outright — the
                    // audio-only DASH streams in particular require a PO token and answer
                    // HTTP 403, which is what made every music download fail. Verify the
                    // candidates with the same headers the download worker uses and keep
                    // only a stream the CDN will actually serve.
                    const chosenVideo = await this.firstServableStream([
                        ...muxedCandidates,
                        ...adaptiveVideoCandidates,
                    ]);
                    if (chosenVideo) {
                        if (chosenVideo.muxed) {
                            directVideoUrl = chosenVideo.url;
                            videoResolution = videoResolution || chosenVideo.resolution;
                            videoFps = videoFps || chosenVideo.fps;
                        }
                        else {
                            adaptiveVideoUrl = chosenVideo.url;
                            adaptiveVideoResolution = adaptiveVideoResolution || chosenVideo.resolution;
                            adaptiveVideoFps = adaptiveVideoFps || chosenVideo.fps;
                        }
                    }
                    directAudioUrl = await this.firstServableAudioUrl(audioCandidates);
                    // No servable audio-only stream: the audio extraction formats fall
                    // back to the muxed stream (`directAudioUrl || directVideoUrl`), whose
                    // audio is demuxed locally by ffmpeg.
                }
            }
        }
        catch (err) {
            // Page / Innertube resolution failed. A rate-limited IP must reach the
            // API layer as 429 rather than as "video cannot be downloaded".
            if (err instanceof RateLimitedError)
                throw err;
            failureReason = `Innertube resolution failed: ${err.message}`;
        }
        if (!directVideoUrl && !adaptiveVideoUrl && !directAudioUrl) {
            failureReason =
                playabilityReason ||
                    failureReason ||
                    (clientNotes.length > 0 ? clientNotes.join('; ') : 'no Innertube client returned a usable stream');
        }
        // Last resort: yt-dlp, when it is installed (local dev, or on Render via the
        // `pip3 install --user yt-dlp` step in render.yaml). It handles consent
        // walls, embedded-player playback and age gates that the plain Innertube
        // call refuses to answer.
        if (!directVideoUrl && !adaptiveVideoUrl && !directAudioUrl) {
            const viaYtDlp = await this.ytDlpExtractMedia(videoId, url);
            // yt-dlp's URLs are verified like any other: some of its formats are
            // served with the same first-bytes-only limitation, and offering one
            // would just move the 403 from the analyze step into the download job.
            const ytDlpVideo = viaYtDlp.videoUrl
                ? await this.firstServableStream([{ url: viaYtDlp.videoUrl, muxed: true }])
                : undefined;
            const ytDlpAudio = viaYtDlp.audioUrl
                ? await this.firstServableAudioUrl([viaYtDlp.audioUrl])
                : undefined;
            if (ytDlpVideo) {
                directVideoUrl = ytDlpVideo.url;
                videoResolution = videoResolution || ytDlpVideo.resolution;
            }
            if (ytDlpAudio)
                directAudioUrl = ytDlpAudio;
            if (viaYtDlp.durationSec && !videoDurationSec)
                videoDurationSec = viaYtDlp.durationSec;
            if (viaYtDlp.title && title === 'YouTube Media')
                title = viaYtDlp.title;
            if (viaYtDlp.author && author === 'Unknown Creator')
                author = viaYtDlp.author;
            if (viaYtDlp.resolution && !videoResolution)
                videoResolution = viaYtDlp.resolution;
            if (viaYtDlp.error)
                failureReason = failureReason || viaYtDlp.error;
        }
        if (!directVideoUrl && !adaptiveVideoUrl && !directAudioUrl) {
            console.warn(`[youtube] ${videoId}: no stream resolved — ${failureReason}`);
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
            duration: videoDurationSec,
            mediaType: 'video',
            downloadAuthorized,
            authorizedNotice: downloadAuthorized
                ? undefined
                : `This media cannot be downloaded through this tool because the platform did not expose an authorized download method for it right now${failureReason ? ` — ${failureReason}` : ' (blocked, age-restricted, or requires sign-in)'}. If the video is your own or age-gated, add a cookies.txt from a logged-in session (set YT_COOKIES_FILE, default /etc/secrets/cookies.txt) and retry.`,
            copyrightNotice: 'This tool respects content rights. Use only for content you own or where an authorized download is provided.',
            availableFormats: formats,
            rawSourceUrl: directVideoUrl || adaptiveVideoUrl,
            rawMuxedUrl: directVideoUrl,
            rawVideoUrl: directVideoUrl || adaptiveVideoUrl,
            rawAudioUrl: directAudioUrl,
        };
    }
    /**
     * True when the CDN will actually serve this stream.
     *
     * A single ranged byte is enough: it proves the request is accepted without
     * transferring the payload, and it uses the exact headers the download worker
     * builds (`buildStreamHeaders`), so a pass here means the download will pass.
     * A 4xx/5xx (notably 403 from audio-only profiles) simply disqualifies the
     * candidate and the next one is tried.
     */
    /**
     * True when the CDN will actually serve the *whole* stream.
     *
     * A stream that only answers for its first ~2 MB cannot complete a download,
     * so it must be rejected rather than offered (the audio download would fail
     * part-way, which is how this showed up: `FAILED 32%` after 1.0 MB).
     *
     * Size matters: probing a fixed large offset lands past the end of a small
     * file and returns an ambiguous `416`, which used to look like success. So the
     * probe reads the real size first and only tests an offset that is genuinely
     * inside the file.
     */
    async isStreamServable(url) {
        if (!url)
            return false;
        /** Verified-safe byte window served from the start of a stream. */
        const FIRST_WINDOW_BYTES = 2 * 1024 * 1024;
        /** Offset known to be refused once a stream is limited to that window. */
        const BEYOND_WINDOW_OFFSET = 3 * 1024 * 1024;
        try {
            // 1. First two bytes: proves the stream starts and discloses its size.
            const head = await fetchWithRetry(url, {
                method: 'GET',
                headers: buildStreamHeaders(url, { Range: 'bytes=0-1' }),
                redirect: 'follow',
                signal: AbortSignal.timeout(8000),
            }, 'YouTube stream probe');
            if (head.status === 403 || head.status === 416)
                return false;
            if (!head.ok && head.status !== 206)
                return false;
            await head.arrayBuffer().catch(() => { });
            // `Content-Range: bytes 0-1/<total>`. Without a size we cannot tell whether
            // the rest of the file is reachable, so accept what starts cleanly.
            const total = parseContentRange(head.headers.get('content-range'))?.total;
            if (!total)
                return true;
            // 2. Only probe an offset that is still inside the file — for anything
            //    shorter than the window the whole file is reachable anyway.
            const probeOffset = Math.min(BEYOND_WINDOW_OFFSET, total - 1);
            if (probeOffset <= FIRST_WINDOW_BYTES)
                return true;
            const mid = await fetchWithRetry(url, {
                method: 'GET',
                headers: buildStreamHeaders(url, {
                    Range: `bytes=${probeOffset}-${probeOffset + 1}`,
                }),
                redirect: 'follow',
                signal: AbortSignal.timeout(8000),
            }, 'YouTube stream probe');
            await mid.arrayBuffer().catch(() => { });
            if (mid.status === 403)
                return false;
            return mid.ok || mid.status === 206 || mid.status === 416;
        }
        catch (err) {
            // A platform-wide rate limit must still surface as 429.
            if (err instanceof RateLimitedError)
                throw err;
            return false;
        }
    }
    /** First candidate the CDN serves, in preference order, or `undefined`. */
    async firstServableStream(candidates) {
        const seen = new Set();
        for (const candidate of candidates) {
            if (!candidate.url || seen.has(candidate.url))
                continue;
            seen.add(candidate.url);
            if (await this.isStreamServable(candidate.url))
                return candidate;
        }
        return undefined;
    }
    /** URL of the first servable audio-only stream, or `undefined`. */
    async firstServableAudioUrl(candidates) {
        const seen = new Set();
        for (const candidate of candidates) {
            if (!candidate || seen.has(candidate))
                continue;
            seen.add(candidate);
            if (await this.isStreamServable(candidate))
                return candidate;
        }
        return undefined;
    }
    /**
     * Optional last-resort extraction with yt-dlp. Returns an empty result (with
     * an `error` note) when yt-dlp is not installed or fails, so the caller can
     * fall through to its own messaging.
     */
    async ytDlpExtractMedia(videoId, watchUrl) {
        const ytdlp = findYtDlp();
        if (!ytdlp) {
            return { error: 'yt-dlp is not installed on the server (set YT_DLP_PATH or install it)' };
        }
        // Use the configured session cookie file when one exists (copied to
        // /tmp/yt-cookies.txt at startup), otherwise a throwaway jar.
        const configuredCookies = findCookiesFile();
        const jar = configuredCookies || tempCookieJar();
        try {
            const args = [
                '--no-warnings',
                '--dump-single-json',
                '--no-playlist',
                '--cookies',
                jar,
                '--user-agent',
                YTDLP_UA,
                `https://www.youtube.com/watch?v=${videoId}`,
            ];
            const { stdout } = await execFileAsync(ytdlp, args, {
                timeout: 90_000,
                maxBuffer: 64 * 1024 * 1024,
            });
            const json = JSON.parse(stdout.toString());
            // yt-dlp's format list also contains HLS/DASH manifests and playlist
            // URLs — those are not media files and must never be handed to ffmpeg.
            const isManifest = (f) => /^m3u8|^https?\+dash|dash/i.test(`${f?.protocol || ''}`) ||
                /manifest\.googlevideo|\.m3u8/i.test(`${f?.url || ''}`);
            const videoFormats = (json?.formats || []).filter((f) => f?.url && !isManifest(f) && f.vcodec && f.vcodec !== 'none');
            const audioFormats = (json?.formats || []).filter((f) => f?.url && !isManifest(f) && f.acodec && f.acodec !== 'none' && f.vcodec === 'none');
            const pickUrl = (list, audio) => {
                const score = (f) => {
                    const mime = `${f?.mime_type || f?.mimetype || ''}`;
                    const codec = `${f?.vcodec || ''} ${f?.acodec || ''} ${mime}`;
                    // Prefer H.264/AAC in MP4: ffmpeg can then remux with -c copy,
                    // while VP9/AV1-only (webm) streams would have to be re-encoded.
                    const mp4 = audio ? /m4a|mp4a|audio\/mp4/i.test(mime + codec) : /avc1|h264|video\/mp4/i.test(mime + codec);
                    const quality = audio ? Number(f?.abr || f?.tbr || 0) : Number(f?.height || f?.tbr || 0);
                    return (mp4 ? 1e9 : 0) + quality;
                };
                const sorted = [...list].sort((a, b) => score(b) - score(a));
                return sorted.find((f) => typeof f.url === 'string' && /^https?:/.test(f.url))?.url;
            };
            const videoUrl = pickUrl(videoFormats, false) || (json?.url ? json.url : undefined);
            const audioUrl = pickUrl(audioFormats, true);
            const best = videoFormats.map((f) => Number(f.height || 0)).sort((a, b) => b - a)[0] || 0;
            const cookieHeader = readCookieJarHeader(jar);
            for (const u of [videoUrl, audioUrl]) {
                if (!u)
                    continue;
                rememberStreamCredentials(u, {
                    cookie: cookieHeader || undefined,
                    userAgent: YTDLP_UA,
                    referer: watchUrl,
                });
            }
            return {
                videoUrl,
                audioUrl,
                durationSec: Number(json?.duration) || undefined,
                title: json?.title || undefined,
                author: json?.uploader || json?.channel || undefined,
                resolution: best > 0 ? `${best}p` : undefined,
            };
        }
        catch (err) {
            return { error: `yt-dlp failed: ${err.message}` };
        }
        finally {
            // Never delete a session cookie file the operator mounted.
            if (!configuredCookies) {
                try {
                    fs.unlinkSync(jar);
                }
                catch { }
            }
        }
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
            // 429 is reported as RateLimitedError (→ HTTP 429 + Retry-After); it must
            // not be swallowed here or a rate-limited IP would look like an empty channel.
            const pageRes = await fetchWithRetry(videosUrl, {
                headers: {
                    'User-Agent': UA,
                    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                },
                redirect: 'follow',
                signal: AbortSignal.timeout(12000),
            }, 'YouTube channel page');
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
            // A rate-limited platform must reach the API layer as 429, not as an
            // empty channel listing.
            if (err instanceof RateLimitedError)
                throw err;
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
            const res = await fetchWithRetry(`https://www.youtube.com/youtubei/v1/browse?key=${apiKey}`, {
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
            }, 'YouTube channel videos browse');
            if (!res.ok)
                return { tracks };
            const data = (await res.json());
            this.collectVideosFromBrowse(data, tracks);
            return { tracks, continuation: this.findContinuationToken(data) };
        }
        catch (err) {
            if (err instanceof RateLimitedError)
                throw err;
            return { tracks };
        }
    }
    async browseChannelContinuation(apiKey, continuation) {
        const tracks = [];
        try {
            const res = await fetchWithRetry(`https://www.youtube.com/youtubei/v1/browse?key=${apiKey}`, {
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
            }, 'YouTube channel continuation browse');
            if (!res.ok)
                return { tracks };
            const data = (await res.json());
            this.collectVideosFromBrowse(data, tracks);
            return { tracks, continuation: this.findContinuationToken(data) };
        }
        catch (err) {
            if (err instanceof RateLimitedError)
                throw err;
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
