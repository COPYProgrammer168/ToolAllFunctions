import type { IMediaProvider, MediaAnalysisResult, MediaFormatOption, MediaTrackInfo } from './MediaProvider.js';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { rememberStreamCredentials, buildStreamHeaders } from '../StreamCredentials.js';
import { parseContentRange } from '../../utils/streamRange.js';
import { YTDLP_UA, findYtDlpInvocation, readCookieJarHeader, tempCookieJar } from '../../utils/ytDlp.js';
import { ytdlpProxyArgs, proxiedFetch } from '../../utils/proxy.js';
import { findCookiesFile } from '../../utils/cookies.js';
import { fetchWithRetry } from '../../utils/httpFetch.js';
import { RateLimitedError } from '../../utils/errors.js';

const execFileAsync = promisify(execFile);

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Innertube params for the channel "Videos" tab */
const CHANNEL_VIDEOS_PARAMS = 'EgZ2aWRlb3PyBgQKAjoA';
const MAX_CHANNEL_VIDEOS = 200;

/** A stream URL offered by an Innertube client, with its presentation hints. */
interface StreamCandidate {
  url: string;
  /** True when the stream carries both audio and video (itag 18 style). */
  muxed: boolean;
  resolution?: string;
  fps?: number;
  /** Video height in pixels (adaptive streams only). */
  height?: number;
  /** Primary codec id, e.g. `avc1.4d401f` (preferred: ffmpeg can copy it). */
  codec?: string;
  /** Container mime type, e.g. `video/mp4` or `video/webm`. */
  mime?: string;
  /** Selected bitrate, used to rank candidates. */
  bitrate?: number;
  /** Stream size in bytes when the platform discloses it. */
  contentLength?: number;
}

/**
 * Progressive (single-URL) googlevideo streams are throttled after roughly
 * ~23 MB from datacenter IPs (verified: 206 for bounded chunks until a
 * per-URL byte budget runs out, then 403 for the rest of the file). Anything
 * larger cannot finish a direct download and must use the segmented HLS path.
 */
const SAFE_PROGRESSIVE_BYTES = 15 * 1024 * 1024;

/**
 * Rank adaptive video candidates.
 *
 * Resolution comes first — that is the entire point of a quality picker, and
 * YouTube caps its H.264/MP4 variants at 1080p, so the previous
 * "H.264 first" ordering pinned every 4K source to its 1080p AVC stream.
 * Ties are broken by frame rate, then MP4 container / H.264 codec (lossless
 * `-c:v copy` mux friendliness: avc > vp9 > av1), then raw bitrate.
 */
function adaptiveScore(c: StreamCandidate): number {
  const codec = c.codec || '';
  const height = c.height || 0;
  const fps = Math.min(c.fps || 0, 120);
  const mp4 = /video\/mp4/i.test(c.mime || '') ? 1 : 0;
  const codecRank = /avc1|h264/i.test(codec) ? 3 : /vp0?9|vp9/i.test(codec) ? 2 : /av01|av1/i.test(codec) ? 1 : 0;
  const bitrateMbps = Math.min((c.bitrate || 0) / 1e6, 999);
  return height * 1e12 + fps * 1e9 + mp4 * 1e7 + codecRank * 1e6 + bitrateMbps;
}

/** Primary codec id from a `video/mp4; codecs="avc1.4d401f"` mime type. */
function codecFromMime(mime?: string): string {
  const m = /codecs="([^"]+)"/.exec(mime || '');
  return m ? m[1] : '';
}

/** De-duplicate candidates by URL, keeping the first (best-ranked) occurrence. */
function dedupeCandidates(candidates: StreamCandidate[]): StreamCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((c) => {
    if (!c.url || seen.has(c.url)) return false;
    seen.add(c.url);
    return true;
  });
}

/** De-duplicate plain URLs. */
function dedupeUrls(urls: string[]): string[] {
  return [...new Set(urls.filter(Boolean))];
}

export class YouTubeProvider implements IMediaProvider {
  public id = 'youtube';
  public displayName = 'YouTube';

  public matches(url: string): boolean {
    return /(?:youtube\.com\/(?:watch\?|shorts\/|embed\/|channel\/|c\/|user\/|@)|youtu\.be\/)/i.test(url);
  }

  public async analyze(url: string): Promise<MediaAnalysisResult> {
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
      const res = await proxiedFetch(oembedUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = (await res.json()) as any;
        title = data.title || title;
        author = data.author_name || author;
        thumbnail = data.thumbnail_url || thumbnail;
      }
    } catch {
      // Keep fallbacks
    }

    // Attempt to resolve direct, authorized stream URLs via the public
    // Innertube player API metadata embedded in the watch page. Streams
    // exposed this way are publicly addressable without DRM circumvention.
    // Candidate streams per kind, gathered from every Innertube client that
    // answers. They are verified against the CDN further down, because several
    // profiles are refused outright (see `firstServableStream`).
    const muxedCandidates: StreamCandidate[] = [];
    const adaptiveVideoCandidates: StreamCandidate[] = [];
    const audioCandidates: string[] = [];
    /** Best verified candidates (assigned inside the try block below). */
    let bestMuxed: StreamCandidate | undefined;
    let bestAdaptive: StreamCandidate | undefined;
    let directVideoUrl: string | undefined;
    let adaptiveVideoUrl: string | undefined;
    let adaptiveVideoResolution: string | undefined;
    let adaptiveVideoFps: number | undefined;
    let videoResolution: string | undefined;
    let videoFps: number | undefined;
    let directAudioUrl: string | undefined;
    let videoDurationSec = 0;
    let playabilityReason: string | undefined;
    let failureReason: string | undefined;
    /** Per-client status collected for the diagnostic message. */
    const clientNotes: string[] = [];

    try {
      // 429 is never retried here: the helper throws RateLimitedError so the
      // API answers 429 + Retry-After instead of blaming the video.
      const pageRes = await fetchWithRetry(
        url,
        {
          headers: {
            'User-Agent': UA,
            'Accept-Language': 'en-US,en;q=0.9',
            // Skip the EU consent interstitial so the embedded player config
            // (API key + visitor data) is present in the HTML.
            Cookie: 'SOCS=CAI; CONSENT=PENDING+999',
          },
          redirect: 'follow',
          signal: AbortSignal.timeout(10000),
        },
        'YouTube watch page'
      );
      if (!pageRes.ok) {
        failureReason = `watch page request failed with HTTP ${pageRes.status}`;
      } else {
        const html = await pageRes.text();
        const apiKey = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1];
        const visitorData =
          html.match(/"visitorData":"([^"]+)"/)?.[1] || html.match(/ytcfg\.set\(\{[^]*?"VISITOR_DATA":"([^"]+)"/)?.[1];
        if (!apiKey) {
          failureReason = 'watch page did not contain INNERTUBE_API_KEY (consent wall or bot interstitial)';
        } else {
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
              const playerRes = await fetchWithRetry(
                `https://www.youtube.com/youtubei/v1/player?key=${apiKey}`,
                {
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
                },
                `Innertube player (${client.clientName})`
              );
              if (!playerRes.ok) {
                clientNotes.push(`${client.clientName}: HTTP ${playerRes.status}`);
                continue;
              }
              const data = (await playerRes.json()) as any;
              if (data?.playabilityStatus?.status && data.playabilityStatus.status !== 'OK') {
                const status = data.playabilityStatus.status;
                const reason =
                  data.playabilityStatus?.reason ||
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
              if (idx >= 0) clientNotes.splice(idx, 1);

              const lengthSeconds = Number(data?.videoDetails?.lengthSeconds);
              if (Number.isFinite(lengthSeconds) && lengthSeconds > 0) {
                videoDurationSec = lengthSeconds;
              }

              // True muxed (audio+video) streams live in `formats`; entries in
              // `adaptiveFormats` are video-only or audio-only and must not be
              // used as the playable video source or the downloaded clip would
              // have no audio.
              const muxedOnly = (data.streamingData?.formats || [])
                .filter((f: any) => f.url && /video\/mp4/.test(f.mimeType || ''))
                .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0));
              for (const f of muxedOnly.slice(0, 2)) {
                muxedCandidates.push({
                  url: f.url,
                  muxed: true,
                  resolution: f.qualityLabel || f.quality,
                  fps: f.fps,
                  bitrate: f.bitrate,
                  contentLength: Number(f.contentLength) || 0,
                });
              }

              // Best adaptive video-only streams (used for muxing when no
              // muxed stream is available, e.g. most modern YouTube uploads).
              // WebM (VP9/AV1) variants are included: above 1080p YouTube only
              // serves WebM, and ffmpeg can copy either codec into the MP4 mux,
              // so excluding them (as the old mp4-only filter did) capped the
              // selectable quality at 1080p.
              const adaptiveVideos = (data.streamingData?.adaptiveFormats || [])
                .filter((f: any) => f.url && /video\/(mp4|webm)/.test(f.mimeType || ''))
                .map((f: any) => ({
                  f,
                  score: adaptiveScore({
                    url: '',
                    muxed: false,
                    height: f.height,
                    fps: f.fps,
                    codec: codecFromMime(f.mimeType),
                    mime: f.mimeType,
                    bitrate: f.bitrate,
                  }),
                }))
                .sort((a: any, b: any) => b.score - a.score)
                .map((x: any) => x.f);
              for (const f of adaptiveVideos.slice(0, 3)) {
                adaptiveVideoCandidates.push({
                  url: f.url,
                  muxed: false,
                  resolution: f.qualityLabel || f.quality,
                  fps: f.fps,
                  height: f.height,
                  codec: codecFromMime(f.mimeType),
                  mime: f.mimeType,
                  bitrate: f.bitrate,
                  contentLength: Number(f.contentLength) || 0,
                });
              }

              // Audio-only M4A adaptive stream for the audio extraction path.
              const audioPool = [...(data.streamingData?.formats || []), ...(data.streamingData?.adaptiveFormats || [])];
              const audio = audioPool
                .filter((f: any) => f.url && /audio\/mp4/.test(f.mimeType || ''))
                .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0));
              for (const f of audio.slice(0, 2)) {
                audioCandidates.push(f.url);
              }
            } catch {
              // Try the next client profile
            }
          }

          // All Innertube profiles have been tried. Rank and verify the pools
          // separately so the download can offer real quality: the highest
          // adaptive video stream (muxed with the audio track on download)
          // plus the low-resolution muxed stream as a guaranteed fallback.
          // Blindly taking the first servable candidate is what pinned every
          // YouTube download to the 360p muxed stream.
          //
          // Candidate counts are capped before the (sequential, network-bound)
          // servability probes so a pathological video cannot stretch analyze
          // into a minute-long request.
          bestMuxed = await this.firstServableStream(
            dedupeCandidates(muxedCandidates)
              .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))
              .slice(0, 3)
          );
          bestAdaptive = await this.firstServableStream(
            dedupeCandidates(adaptiveVideoCandidates)
              .sort((a, b) => adaptiveScore(b) - adaptiveScore(a))
              .slice(0, 6)
          );
          if (bestMuxed) {
            directVideoUrl = bestMuxed.url;
            videoResolution = videoResolution || bestMuxed.resolution;
            videoFps = videoFps || bestMuxed.fps;
          }
          if (bestAdaptive) {
            adaptiveVideoUrl = bestAdaptive.url;
            adaptiveVideoResolution = adaptiveVideoResolution || bestAdaptive.resolution;
            adaptiveVideoFps = adaptiveVideoFps || bestAdaptive.fps;
          }

          directAudioUrl = await this.firstServableAudioUrl(
            dedupeUrls(audioCandidates).slice(0, 6)
          );
        }
      }
    } catch (err) {
      // Page / Innertube resolution failed. A rate-limited IP must reach the
      // API layer as 429 rather than as "video cannot be downloaded".
      if (err instanceof RateLimitedError) throw err;
      failureReason = `Innertube resolution failed: ${(err as Error).message}`;
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
      const ytDlpAudio = viaYtDlp.audioUrl
        ? await this.firstServableAudioUrl([viaYtDlp.audioUrl])
        : undefined;
      const ytDlpVideo = viaYtDlp.videoUrl
        ? await this.firstServableStream([{ url: viaYtDlp.videoUrl, muxed: !ytDlpAudio }])
        : undefined;
      if (ytDlpVideo && ytDlpAudio) {
        // Video-only + audio pair: download as an adaptive mux pair so the
        // result is not a silent video.
        adaptiveVideoUrl = ytDlpVideo.url;
        adaptiveVideoResolution = adaptiveVideoResolution || ytDlpVideo.resolution;
        directAudioUrl = ytDlpAudio;
      } else if (ytDlpVideo) {
        directVideoUrl = ytDlpVideo.url;
        videoResolution = videoResolution || ytDlpVideo.resolution;
      } else if (ytDlpAudio) {
        directAudioUrl = ytDlpAudio;
      }
      if (viaYtDlp.durationSec && !videoDurationSec) videoDurationSec = viaYtDlp.durationSec;
      if (viaYtDlp.title && title === 'YouTube Media') title = viaYtDlp.title;
      if (viaYtDlp.author && author === 'Unknown Creator') author = viaYtDlp.author;
      if (viaYtDlp.resolution && !videoResolution && !adaptiveVideoResolution) {
        videoResolution = viaYtDlp.resolution;
        adaptiveVideoResolution = adaptiveVideoResolution || viaYtDlp.resolution;
      }
      if (viaYtDlp.error) failureReason = failureReason || viaYtDlp.error;
    }

    if (!directVideoUrl && !adaptiveVideoUrl && !directAudioUrl) {
      console.warn(`[youtube] ${videoId}: no stream resolved — ${failureReason}`);
    }

    // YouTube's CDN serves audio-only DASH streams for only their first ~2 MB
    // from datacenter IPs (PO-token gated), so a full audio-only download is
    // refused mid-stream. When no audio-only URL is usable, the combined
    // muxed stream is the only fully downloadable source of audio — it becomes
    // the muxing partner for the high-quality adaptive video, and the source
    // for the audio export formats (ffmpeg demuxes its audio locally).
    const adaptiveAudioSource = directAudioUrl || directVideoUrl;

    // Progressive streams are throttled after ~23 MB (SAFE_PROGRESSIVE_BYTES).
    // When the best progressive stream is larger than that — the common case
    // for anything beyond a short clip — the download would fail part-way, so
    // resolve the segmented HLS variants with yt-dlp instead: each segment is
    // an independent URL and is not subject to the per-URL budget.
    const bestAdaptiveSize = bestAdaptive?.contentLength || 0;
    const bestMuxedSize = bestMuxed?.contentLength || 0;
    const progressiveOversize =
      bestAdaptiveSize > SAFE_PROGRESSIVE_BYTES || bestMuxedSize > SAFE_PROGRESSIVE_BYTES;
    const hasProgressive = !!(directVideoUrl || adaptiveVideoUrl);

    let hlsVideoUrl: string | undefined;
    let hlsAudioUrl: string | undefined;
    let hlsResolution: string | undefined;
    let hlsFps: number | undefined;
    if (progressiveOversize || !hasProgressive) {
      const hls = await this.ytDlpExtractHls(videoId, url);
      if (hls.videoUrl) {
        hlsVideoUrl = hls.videoUrl;
        hlsAudioUrl = hls.audioUrl;
        hlsResolution = hls.resolution;
        hlsFps = hls.fps;
        if (hls.error) failureReason = failureReason || hls.error;
      }
    }

    const downloadAuthorized = !!(directVideoUrl || adaptiveVideoUrl || directAudioUrl || hlsVideoUrl);

    // The public stream URLs found above are only used when present; DRM
    // circumvention and unauthorized extraction are never performed.
    const formats: MediaFormatOption[] = [];

    // 0) Best quality first when the platform throttles progressive streams:
    //    the segmented HLS variant, downloaded by ffmpeg segment-by-segment.
    if (hlsVideoUrl) {
      formats.push({
        id: 'yt-video-hls',
        type: 'video',
        format: 'mp4',
        qualityLabel: `${hlsResolution || 'Best available'}${hlsFps ? `${hlsFps}` : ''} MP4 (HLS)`,
        resolution: hlsResolution,
        fps: hlsFps,
        hlsVideoUrl,
        hlsAudioUrl,
        notes:
          'Segmented stream — downloads in full quality even when the platform throttles single-URL streams.',
      });
    }

    // 1) Best quality first: the highest adaptive video stream, muxed with an
    //    audio track during download (the client sends videoUrl + audioUrl so
    //    the server muxes them with ffmpeg).
    if (adaptiveVideoUrl && adaptiveAudioSource && bestAdaptiveSize <= SAFE_PROGRESSIVE_BYTES) {
      formats.push({
        id: 'yt-video-adaptive',
        type: 'video',
        format: 'mp4',
        qualityLabel: `${adaptiveVideoResolution || 'Best available'} MP4 (audio muxed)`,
        resolution: adaptiveVideoResolution,
        fps: adaptiveVideoFps,
        directDownloadUrl: adaptiveVideoUrl,
        videoUrl: adaptiveVideoUrl,
        audioUrl: adaptiveAudioSource,
        notes: directAudioUrl
          ? 'Highest-quality stream the platform exposed. Audio is muxed in during download, so the file plays with sound.'
          : 'Highest-quality video stream. YouTube only serves the first ~2 MB of audio-only streams to servers, so the audio track is taken from the combined standard stream and muxed in during download.',
      });
    }

    // 1b) Adaptive video with no muxable audio at all — offer it, but say so
    //     loudly: a silent file surprises users otherwise.
    if (adaptiveVideoUrl && !adaptiveAudioSource) {
      formats.push({
        id: 'yt-video-adaptive',
        type: 'video',
        format: 'mp4',
        qualityLabel: `${adaptiveVideoResolution || 'Adaptive'} MP4 (video only)`,
        resolution: adaptiveVideoResolution,
        fps: adaptiveVideoFps,
        directDownloadUrl: adaptiveVideoUrl,
        videoUrl: adaptiveVideoUrl,
        notes:
          'The platform did not expose any usable audio track for this video — the download will have no sound.',
      });
    }

    // 2) Muxed fallback: a single stream that already carries audio.
    if (directVideoUrl && (bestMuxedSize === 0 || bestMuxedSize <= SAFE_PROGRESSIVE_BYTES)) {
      formats.push({
        id: 'yt-video-muxed',
        type: 'video',
        format: 'mp4',
        qualityLabel: `${videoResolution || 'MP4'} (Direct Stream)`,
        resolution: videoResolution,
        fps: videoFps,
        directDownloadUrl: directVideoUrl,
        notes: 'Single combined stream with audio — no muxing needed, lower resolution.',
      });
    }

    if (formats.length === 0) {
      formats.push({
        id: 'yt-video-1080p',
        type: 'video',
        format: 'mp4',
        qualityLabel: '1080p Full HD',
        resolution: '1920x1080',
        fps: 30,
      });
    }

    // Audio exports: the audio-only stream when the CDN serves it fully,
    // otherwise the muxed stream whose audio track ffmpeg extracts locally,
    // otherwise the segmented HLS audio variant.
    const audioSource = adaptiveAudioSource;
    const audioSourceOversize = !directAudioUrl && bestMuxedSize > SAFE_PROGRESSIVE_BYTES;
    if (hlsAudioUrl && (!audioSource || audioSourceOversize)) {
      formats.push({
        id: 'yt-audio-mp3',
        type: 'audio',
        format: 'mp3',
        qualityLabel: '320 kbps (High Export)',
        bitrateKbps: 320,
        hlsAudioUrl,
        notes: 'Extracted from the segmented audio stream; encoded at 320 kbps CBR.',
      });
      formats.push({
        id: 'yt-audio-m4a',
        type: 'audio',
        format: 'm4a',
        qualityLabel: 'Original Audio Container (AAC/M4A)',
        isLossless: false,
        hlsAudioUrl,
        notes: 'Segmented audio stream copied without generational loss.',
      });
    } else if (audioSource) {
      formats.push({
        id: 'yt-audio-mp3',
        type: 'audio',
        format: 'mp3',
        qualityLabel: '320 kbps (High Export)',
        bitrateKbps: 320,
        directDownloadUrl: audioSource,
        notes: directAudioUrl
          ? 'Extracted from the original audio-only stream; encoded at 320 kbps CBR.'
          : 'Audio-only stream unavailable — extracted from the muxed video stream; encoded at 320 kbps CBR.',
      });
      formats.push({
        id: 'yt-audio-m4a',
        type: 'audio',
        format: 'm4a',
        qualityLabel: 'Original Audio Container (AAC/M4A)',
        isLossless: false,
        directDownloadUrl: audioSource,
        notes: directAudioUrl
          ? 'Direct stream extraction without generational loss.'
          : 'Audio-only stream unavailable — extracted from the muxed video stream without generational loss.',
      });
    }

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
        : `This media cannot be downloaded through this tool because the platform did not expose an authorized download method for it right now${
            failureReason ? ` — ${failureReason}` : ' (blocked, age-restricted, or requires sign-in)'
          }. If the video is your own or age-gated, add a cookies.txt from a logged-in session (set YT_COOKIES_FILE, default /etc/secrets/cookies.txt) and retry.`,
      copyrightNotice:
        'This tool respects content rights. Use only for content you own or where an authorized download is provided.',
      availableFormats: formats,
      rawSourceUrl: adaptiveVideoUrl || directVideoUrl,
      rawMuxedUrl: directVideoUrl,
      rawVideoUrl: adaptiveVideoUrl,
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
  private async isStreamServable(url: string): Promise<boolean> {
    if (!url) return false;
    /** Verified-safe byte window served from the start of a stream. */
    const FIRST_WINDOW_BYTES = 2 * 1024 * 1024;
    /** Offset known to be refused once a stream is limited to that window. */
    const BEYOND_WINDOW_OFFSET = 3 * 1024 * 1024;

    try {
      // 1. First two bytes: proves the stream starts and discloses its size.
      const head = await fetchWithRetry(
        url,
        {
          method: 'GET',
          headers: buildStreamHeaders(url, { Range: 'bytes=0-1' }),
          redirect: 'follow',
          signal: AbortSignal.timeout(8000),
        },
        'YouTube stream probe'
      );
      if (head.status === 403 || head.status === 416) return false;
      if (!head.ok && head.status !== 206) return false;
      await head.arrayBuffer().catch(() => {});

      // `Content-Range: bytes 0-1/<total>`. Without a size we cannot tell whether
      // the rest of the file is reachable, so accept what starts cleanly.
      const total = parseContentRange(head.headers.get('content-range'))?.total;
      if (!total) return true;

      // 2. Only probe an offset that is still inside the file — for anything
      //    shorter than the window the whole file is reachable anyway.
      const probeOffset = Math.min(BEYOND_WINDOW_OFFSET, total - 1);
      if (probeOffset <= FIRST_WINDOW_BYTES) return true;

      const mid = await fetchWithRetry(
        url,
        {
          method: 'GET',
          headers: buildStreamHeaders(url, {
            Range: `bytes=${probeOffset}-${probeOffset + 1}`,
          }),
          redirect: 'follow',
          signal: AbortSignal.timeout(8000),
        },
        'YouTube stream probe'
      );
      await mid.arrayBuffer().catch(() => {});
      if (mid.status === 403) return false;
      return mid.ok || mid.status === 206 || mid.status === 416;
    } catch (err) {
      // A platform-wide rate limit must still surface as 429.
      if (err instanceof RateLimitedError) throw err;
      return false;
    }
  }

  /** First candidate the CDN serves, in preference order, or `undefined`. */
  private async firstServableStream(candidates: StreamCandidate[]): Promise<StreamCandidate | undefined> {
    const seen = new Set<string>();
    for (const candidate of candidates) {
      if (!candidate.url || seen.has(candidate.url)) continue;
      seen.add(candidate.url);
      if (await this.isStreamServable(candidate.url)) return candidate;
    }
    return undefined;
  }

  /** URL of the first servable audio-only stream, or `undefined`. */
  private async firstServableAudioUrl(candidates: string[]): Promise<string | undefined> {
    const seen = new Set<string>();
    for (const candidate of candidates) {
      if (!candidate || seen.has(candidate)) continue;
      seen.add(candidate);
      if (await this.isStreamServable(candidate)) return candidate;
    }
    return undefined;
  }

  /**
   * Optional last-resort extraction with yt-dlp. Returns an empty result (with
   * an `error` note) when yt-dlp is not installed or fails, so the caller can
   * fall through to its own messaging.
   */
  private async ytDlpExtractMedia(
    videoId: string,
    watchUrl: string
  ): Promise<{
    videoUrl?: string;
    audioUrl?: string;
    durationSec?: number;
    title?: string;
    author?: string;
    resolution?: string;
    error?: string;
  }> {
    const invocation = await findYtDlpInvocation();
    if (!invocation) {
      return { error: 'yt-dlp is not installed on the server (set YT_DLP_PATH or install it)' };
    }
    // Use the configured session cookie file when one exists (copied to
    // /tmp/yt-cookies.txt at startup), otherwise a throwaway jar.
    const configuredCookies = findCookiesFile();
    const jar = configuredCookies || tempCookieJar();
    try {
      const args = [
        ...invocation.prefixArgs,
        ...ytdlpProxyArgs(),
        '--no-warnings',
        '--dump-single-json',
        '--no-playlist',
        '--cookies',
        jar,
        '--user-agent',
        YTDLP_UA,
        `https://www.youtube.com/watch?v=${videoId}`,
      ];
      const { stdout } = await execFileAsync(invocation.command, args, {
        timeout: 90_000,
        maxBuffer: 64 * 1024 * 1024,
      });
      const json = JSON.parse(stdout.toString()) as any;
      // yt-dlp's format list also contains HLS/DASH manifests and playlist
      // URLs — those are not media files and must never be handed to ffmpeg.
      const isManifest = (f: any): boolean =>
        /^m3u8|^https?\+dash|dash/i.test(`${f?.protocol || ''}`) ||
        /manifest\.googlevideo|\.m3u8/i.test(`${f?.url || ''}`);
      const videoFormats = (json?.formats || []).filter(
        (f: any) => f?.url && !isManifest(f) && f.vcodec && f.vcodec !== 'none'
      );
      const audioFormats = (json?.formats || []).filter(
        (f: any) => f?.url && !isManifest(f) && f.acodec && f.acodec !== 'none' && f.vcodec === 'none'
      );
      const pickUrl = (list: any[], audio: boolean): string | undefined => {
        const score = (f: any): number => {
          const mime = `${f?.mime_type || f?.mimetype || ''}`;
          const codec = `${f?.vcodec || ''} ${f?.acodec || ''} ${mime}`;
          if (audio) {
            // Highest-bitrate stream in a copy-friendly (M4A/AAC) container wins.
            const mp4 = /m4a|mp4a|audio\/mp4/i.test(mime + codec);
            return (mp4 ? 1e9 : 0) + Number(f?.abr || f?.tbr || 0);
          }
          // Video: resolution first (a 4K VP9/AV1 WebM beats a 1080p AVC MP4 —
          // ffmpeg can copy either codec into the muxed MP4), then frame rate,
          // then MP4/H.264 as the tie-break.
          const height = Number(f?.height || 0);
          const fps = Math.min(Number(f?.fps || 0), 120);
          const mp4 = /avc1|h264|video\/mp4/i.test(mime + codec);
          const codecRank = /avc1|h264/i.test(codec) ? 3 : /vp0?9/i.test(codec) ? 2 : /av01/i.test(codec) ? 1 : 0;
          return height * 1e12 + fps * 1e9 + (mp4 ? 1e7 : 0) + codecRank * 1e6;
        };
        const sorted = [...list].sort((a: any, b: any) => score(b) - score(a));
        return sorted.find((f: any) => typeof f.url === 'string' && /^https?:/.test(f.url))?.url;
      };
      const videoUrl = pickUrl(videoFormats, false) || (json?.url ? json.url : undefined);
      const audioUrl = pickUrl(audioFormats, true);
      const best = videoFormats.map((f: any) => Number(f.height || 0)).sort((a: number, b: number) => b - a)[0] || 0;
      const cookieHeader = readCookieJarHeader(jar);

      for (const u of [videoUrl, audioUrl]) {
        if (!u) continue;
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
    } catch (err) {
      return { error: `yt-dlp failed: ${(err as Error).message}` };
    } finally {
      // Never delete a session cookie file the operator mounted.
      if (!configuredCookies) {
        try {
          fs.unlinkSync(jar);
        } catch {}
      }
    }
  }

  /**
   * Extract the segmented (HLS) variants with yt-dlp.
   *
   * Single-URL googlevideo streams are throttled after ~23 MB from datacenter
   * IPs, which makes any long or HD download fail part-way. HLS manifests are
   * fetched segment-by-segment — every segment is its own URL — so they are
   * immune to the per-URL budget and are the only way to deliver full-quality
   * files from a throttled server. Returns an empty result (with an `error`
   * note) when yt-dlp is unavailable or offers no HLS variants.
   */
  private async ytDlpExtractHls(
    videoId: string,
    watchUrl: string
  ): Promise<{
    videoUrl?: string;
    audioUrl?: string;
    resolution?: string;
    fps?: number;
    error?: string;
  }> {
    const invocation = await findYtDlpInvocation();
    if (!invocation) {
      return { error: 'yt-dlp is not installed on the server (set YT_DLP_PATH or install it)' };
    }
    const configuredCookies = findCookiesFile();
    const jar = configuredCookies || tempCookieJar();
    try {
      const args = [
        ...invocation.prefixArgs,
        ...ytdlpProxyArgs(),
        '--no-warnings',
        '--dump-single-json',
        '--no-playlist',
        '--cookies',
        jar,
        '--user-agent',
        YTDLP_UA,
        `https://www.youtube.com/watch?v=${videoId}`,
      ];
      const { stdout } = await execFileAsync(invocation.command, args, {
        timeout: 90_000,
        maxBuffer: 64 * 1024 * 1024,
      });
      const json = JSON.parse(stdout.toString()) as any;

      const isHls = (f: any): boolean =>
        f?.protocol === 'm3u8' ||
        f?.protocol === 'm3u8_native' ||
        /hls_playlist|manifest\.googlevideo/i.test(`${f?.url || ''}`);
      if (!isHls) return {};

      const hlsFormats = (json?.formats || []).filter((f: any) => f?.url && isHls(f));
      // HLS audio variants report `vcodec: 'none'` with `acodec` often absent
      // entirely (None), so the check must treat a missing codec as audio.
      const isVideoHls = (f: any): boolean => !!f.vcodec && f.vcodec !== 'none';
      const isAudioHls = (f: any): boolean => f.vcodec === 'none';
      const hlsVideos = hlsFormats
        // 2160p included: the old 1080p cap removed every 4K HLS variant
        // before the ranking below ever saw it.
        .filter((f: any) => isVideoHls(f) && (f.height || 0) <= 2160)
        // Highest resolution first, then frame rate, then H.264 over
        // VP9/AV1 for widest player compatibility.
        .sort(
          (a: any, b: any) =>
            ((b.height || 0) - (a.height || 0)) * 1e9 +
            ((b.fps || 0) - (a.fps || 0)) * 1e6 +
            (Number(/avc1|h264/i.test(`${b.vcodec}`)) - Number(/avc1|h264/i.test(`${a.vcodec}`))) * 1e3
        );
      const hlsAudios = hlsFormats
        .filter(isAudioHls)
        .sort(
          (a: any, b: any) =>
            (b.tbr || b.abr || 0) - (a.tbr || a.abr || 0) ||
            (Number(b.format_id) || 0) - (Number(a.format_id) || 0)
        );

      const bestVideo = hlsVideos[0];
      const bestAudio = hlsAudios[0];
      if (!bestVideo && !bestAudio) return {};

      const result: {
        videoUrl?: string;
        audioUrl?: string;
        resolution?: string;
        fps?: number;
      } = {};
      if (bestVideo) {
        result.videoUrl = bestVideo.url;
        if (bestVideo.height) result.resolution = `${bestVideo.height}p`;
        if (bestVideo.fps) result.fps = Number(bestVideo.fps) || undefined;
      }
      if (bestAudio) {
        result.audioUrl = bestAudio.url;
      }

      for (const u of [result.videoUrl, result.audioUrl]) {
        if (!u) continue;
        rememberStreamCredentials(u, {
          userAgent: YTDLP_UA,
          referer: watchUrl,
        });
      }

      return result;
    } catch (err) {
      return { error: `yt-dlp HLS extraction failed: ${(err as Error).message}` };
    } finally {
      if (!configuredCookies) {
        try {
          fs.unlinkSync(jar);
        } catch {}
      }
    }
  }

  private isChannelUrl(url: string): boolean {
    // Channel/home/handle pages (not a specific watch/shorts video)
    if (/youtu\.be\//i.test(url) || /youtube\.com\/(?:watch\?|shorts\/|embed\/)/i.test(url)) {
      return false;
    }
    return /youtube\.com\/(?:@[\w.-]+|channel\/[\w-]+|c\/[\w.-]+|user\/[\w.-]+)(?:\/(?:videos|featured|streams|shorts|about|playlists)?)?\/?(?:\?.*)?$/i.test(
      url
    );
  }

  private async analyzeChannel(url: string): Promise<MediaAnalysisResult> {
    let title = 'YouTube Channel';
    let author = 'Unknown Channel';
    let thumbnail = '';
    const tracks: MediaTrackInfo[] = [];

    try {
      // Prefer the Videos tab so the first payload already lists uploads
      const videosUrl = this.toChannelVideosUrl(url);
      // 429 is reported as RateLimitedError (→ HTTP 429 + Retry-After); it must
      // not be swallowed here or a rate-limited IP would look like an empty channel.
      const pageRes = await fetchWithRetry(
        videosUrl,
        {
          headers: {
            'User-Agent': UA,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
          },
          redirect: 'follow',
          signal: AbortSignal.timeout(12000),
        },
        'YouTube channel page'
      );

      if (!pageRes.ok) {
        return this.emptyChannelResult(url, title, author, thumbnail, tracks, 'Could not open the channel page.');
      }

      const html = await pageRes.text();
      const apiKey = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1];
      const channelId =
        html.match(/"channelId":"(UC[\w-]+)"/)?.[1] ||
        html.match(/"externalId":"(UC[\w-]+)"/)?.[1] ||
        html.match(/youtube\.com\/channel\/(UC[\w-]+)/)?.[1];

      const channelName =
        html.match(/"ownerChannelName":"([^"]+)"/)?.[1] ||
        html.match(/"channelMetadataRenderer":\{"title":"([^"]+)"/)?.[1] ||
        html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i)?.[1];
      if (channelName) {
        author = this.decodeHtmlEntities(channelName);
        title = `${author} — Channel Videos`;
      }

      const ogImg = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i)?.[1];
      if (ogImg) thumbnail = ogImg;

      // Collect videos already embedded in the initial HTML ytInitialData
      const initialDataMatch = html.match(/ytInitialData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
      if (initialDataMatch) {
        try {
          const initialData = JSON.parse(initialDataMatch[1]);
          this.collectVideosFromBrowse(initialData, tracks, author);
        } catch {
          // ignore parse errors
        }
      }

      if (apiKey && channelId) {
        let continuation: string | undefined;
        // First browse call if we still have few items
        if (tracks.length < 30) {
          const first = await this.browseChannelVideos(apiKey, channelId);
          for (const t of first.tracks) {
            if (!tracks.some((x) => x.url === t.url)) tracks.push(t);
          }
          continuation = first.continuation;
        } else if (initialDataMatch) {
          try {
            continuation = this.findContinuationToken(JSON.parse(initialDataMatch[1]));
          } catch {
            continuation = undefined;
          }
        }

        let pages = 0;
        while (continuation && tracks.length < MAX_CHANNEL_VIDEOS && pages < 15) {
          pages++;
          const next = await this.browseChannelContinuation(apiKey, continuation);
          for (const t of next.tracks) {
            if (!tracks.some((x) => x.url === t.url)) tracks.push(t);
          }
          continuation = next.continuation;
          if (next.tracks.length === 0) break;
        }
      }
    } catch (err) {
      // A rate-limited platform must reach the API layer as 429, not as an
      // empty channel listing.
      if (err instanceof RateLimitedError) throw err;
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
      authorizedNotice:
        limited.length > 0
          ? `Found ${limited.length} video(s) on this channel. Select items below to download as video or music.`
          : 'Could not list channel videos. The channel may be private, empty, or blocked.',
      copyrightNotice:
        'YouTube content belongs to respective creators. Only download content you own or have explicit permission to use.',
      availableFormats: [],
      tracks: limited,
    };
  }

  private emptyChannelResult(
    url: string,
    title: string,
    author: string,
    thumbnail: string,
    tracks: MediaTrackInfo[],
    notice: string
  ): MediaAnalysisResult {
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
      copyrightNotice:
        'YouTube content belongs to respective creators. Only download content you own or have explicit permission to use.',
      availableFormats: [],
      tracks,
    };
  }

  private toChannelVideosUrl(url: string): string {
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
    } catch {
      return url.replace(/\/?(videos|featured|streams|shorts|about|playlists)?\/?(\?.*)?$/i, '/videos');
    }
  }

  private async browseChannelVideos(
    apiKey: string,
    channelId: string
  ): Promise<{ tracks: MediaTrackInfo[]; continuation?: string }> {
    const tracks: MediaTrackInfo[] = [];
    try {
      const res = await fetchWithRetry(
        `https://www.youtube.com/youtubei/v1/browse?key=${apiKey}`,
        {
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
        },
        'YouTube channel videos browse'
      );
      if (!res.ok) return { tracks };
      const data = (await res.json()) as any;
      this.collectVideosFromBrowse(data, tracks);
      return { tracks, continuation: this.findContinuationToken(data) };
    } catch (err) {
      if (err instanceof RateLimitedError) throw err;
      return { tracks };
    }
  }

  private async browseChannelContinuation(
    apiKey: string,
    continuation: string
  ): Promise<{ tracks: MediaTrackInfo[]; continuation?: string }> {
    const tracks: MediaTrackInfo[] = [];
    try {
      const res = await fetchWithRetry(
        `https://www.youtube.com/youtubei/v1/browse?key=${apiKey}`,
        {
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
        },
        'YouTube channel continuation browse'
      );
      if (!res.ok) return { tracks };
      const data = (await res.json()) as any;
      this.collectVideosFromBrowse(data, tracks);
      return { tracks, continuation: this.findContinuationToken(data) };
    } catch (err) {
      if (err instanceof RateLimitedError) throw err;
      return { tracks };
    }
  }

  private collectVideosFromBrowse(node: any, tracks: MediaTrackInfo[], defaultCreator?: string): void {
    if (!node || typeof node !== 'object') return;

    const pushTrack = (
      videoId: string,
      titleText: string,
      duration?: number,
      thumbnail?: string,
      creator?: string
    ) => {
      const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
      if (tracks.some((t) => t.url === watchUrl)) return;
      tracks.push({
        title: titleText || `Video ${videoId}`,
        url: watchUrl,
        creator: creator || defaultCreator,
        duration,
        thumbnail: thumbnail || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
        mediaType: 'video',
      });
    };

    const pushFromRenderer = (vr: any) => {
      if (!vr) return;
      const videoId: string | undefined = vr.videoId;
      if (!videoId) return;

      const titleRuns = vr.title?.runs || vr.title?.simpleText;
      const titleText =
        typeof titleRuns === 'string'
          ? titleRuns
          : Array.isArray(titleRuns)
            ? titleRuns.map((r: any) => r.text).join('')
            : vr.title?.accessibility?.accessibilityData?.label || `Video ${videoId}`;

      const lengthText =
        vr.lengthText?.simpleText ||
        vr.lengthText?.runs?.[0]?.text ||
        vr.thumbnailOverlays?.find((o: any) => o.thumbnailOverlayTimeStatusRenderer)
          ?.thumbnailOverlayTimeStatusRenderer?.text?.simpleText;
      const duration = this.parseDurationLabel(lengthText);

      const thumbs: any[] = vr.thumbnail?.thumbnails || [];
      const thumbnail = thumbs.length ? thumbs[thumbs.length - 1].url : undefined;

      pushTrack(
        videoId,
        titleText,
        duration,
        thumbnail,
        vr.ownerText?.runs?.[0]?.text || vr.shortBylineText?.runs?.[0]?.text
      );
    };

    // Modern YouTube channel/Videos tab uses lockupViewModel instead of videoRenderer
    const pushFromLockup = (lv: any) => {
      if (!lv) return;
      const videoId: string | undefined =
        lv.contentId ||
        lv.rendererContext?.commandContext?.onTap?.innertubeCommand?.watchEndpoint?.videoId ||
        lv.rendererContext?.commandContext?.onTap?.innertubeCommand?.commandMetadata?.webCommandMetadata?.url?.match(
          /[?&]v=([\w-]{11})/
        )?.[1];
      if (!videoId || !/^[\w-]{11}$/.test(videoId)) return;

      const titleText =
        lv.metadata?.lockupMetadataViewModel?.title?.content ||
        lv.rendererContext?.accessibilityContext?.label?.replace(/\s+\d+\s+minutes?.*$/i, '').trim() ||
        `Video ${videoId}`;

      // Duration badge text like "3:20"
      let lengthText: string | undefined;
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
        if (lengthText) break;
      }
      const duration =
        this.parseDurationLabel(lengthText) ||
        this.parseSpokenDuration(lv.rendererContext?.accessibilityContext?.label);

      const sources: any[] = lv.contentImage?.thumbnailViewModel?.image?.sources || [];
      const thumbnail = sources.length ? sources[sources.length - 1].url : undefined;

      pushTrack(videoId, titleText, duration, thumbnail);
    };

    const walk = (obj: any, depth = 0) => {
      if (!obj || typeof obj !== 'object' || depth > 25) return;
      if (Array.isArray(obj)) {
        obj.forEach((x) => walk(x, depth + 1));
        return;
      }
      if (obj.videoRenderer) pushFromRenderer(obj.videoRenderer);
      if (obj.gridVideoRenderer) pushFromRenderer(obj.gridVideoRenderer);
      if (obj.lockupViewModel) pushFromLockup(obj.lockupViewModel);
      if (obj.richItemRenderer?.content?.videoRenderer) {
        pushFromRenderer(obj.richItemRenderer.content.videoRenderer);
      }
      if (obj.richItemRenderer?.content?.lockupViewModel) {
        pushFromLockup(obj.richItemRenderer.content.lockupViewModel);
      }
      for (const v of Object.values(obj)) {
        if (v && typeof v === 'object') walk(v, depth + 1);
      }
    };

    walk(node);
  }

  /** Parse labels like "Pastel Ghost … 3 minutes, 20 seconds" */
  private parseSpokenDuration(label?: string): number | undefined {
    if (!label || typeof label !== 'string') return undefined;
    const hours = label.match(/(\d+)\s+hours?/i)?.[1];
    const mins = label.match(/(\d+)\s+minutes?/i)?.[1];
    const secs = label.match(/(\d+)\s+seconds?/i)?.[1];
    if (!hours && !mins && !secs) return undefined;
    return (parseInt(hours || '0', 10) * 3600) + (parseInt(mins || '0', 10) * 60) + parseInt(secs || '0', 10);
  }

  private findContinuationToken(node: any): string | undefined {
    // The full channel page contains several continuation tokens (other tabs,
    // chip filters, header reload). Always prefer the one inside the Videos
    // tab, otherwise we may follow a token that skips videos.
    const videosTab = this.findVideosTabContent(node);
    if (videosTab) {
      const scoped = this.findTokenInNode(videosTab);
      if (scoped) return scoped;
    }
    return this.findTokenInNode(node);
  }

  private findTokenInNode(node: any): string | undefined {
    let token: string | undefined;
    const walk = (obj: any, depth = 0) => {
      if (!obj || typeof obj !== 'object' || depth > 30 || token) return;
      if (Array.isArray(obj)) {
        obj.forEach((x) => walk(x, depth + 1));
        return;
      }
      if (obj.continuationItemRenderer) {
        const t =
          obj.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token ||
          obj.continuationItemRenderer?.continuationEndpoint?.commandExecutorCommand?.commands?.find(
            (c: any) => c.continuationCommand?.token
          )?.continuationCommand?.token;
        if (t) {
          token = t;
          return;
        }
      }
      for (const v of Object.values(obj)) {
        if (v && typeof v === 'object') walk(v, depth + 1);
      }
    };
    walk(node);
    return token;
  }

  private findVideosTabContent(node: any): any | undefined {
    let found: any;
    const walk = (obj: any, depth = 0) => {
      if (!obj || typeof obj !== 'object' || depth > 25 || found) return;
      if (Array.isArray(obj)) {
        obj.forEach((x) => walk(x, depth + 1));
        return;
      }
      const tr = obj.tabRenderer;
      if (tr) {
        const title = typeof tr.title === 'string' ? tr.title : '';
        const params = tr.endpoint?.browseEndpoint?.params;
        const url = tr.endpoint?.browseEndpoint?.canonicalBaseUrl || '';
        if (
          title.toLowerCase() === 'videos' ||
          params === CHANNEL_VIDEOS_PARAMS ||
          /\/videos\/?$/i.test(url)
        ) {
          found = tr.content || tr;
          return;
        }
      }
      for (const v of Object.values(obj)) {
        if (v && typeof v === 'object') walk(v, depth + 1);
      }
    };
    walk(node);
    return found;
  }

  private parseDurationLabel(label?: string): number | undefined {
    if (!label || typeof label !== 'string') return undefined;
    const parts = label.trim().split(':').map((p) => parseInt(p, 10));
    if (parts.some((n) => Number.isNaN(n))) return undefined;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 1) return parts[0];
    return undefined;
  }

  private extractVideoId(url: string): string | null {
    const regExp = /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([\w-]{11})/;
    const match = url.match(regExp);
    return match ? match[1] : null;
  }

  private decodeHtmlEntities(text: string): string {
    return text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\\u0026/g, '&');
  }
}
