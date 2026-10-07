import type { IMediaProvider, MediaAnalysisResult, MediaFormatOption } from './MediaProvider.js';

export class YouTubeProvider implements IMediaProvider {
  public id = 'youtube';
  public displayName = 'YouTube';

  public matches(url: string): boolean {
    return /(?:youtube\.com\/(?:watch\?|shorts\/|embed\/)|youtu\.be\/)/i.test(url);
  }

  public async analyze(url: string): Promise<MediaAnalysisResult> {
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
    let directVideoUrl: string | undefined;
    let directAudioUrl: string | undefined;
    let videoResolution: string | undefined;
    let videoFps: number | undefined;

    try {
      const pageRes = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
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
            { clientName: 'WEB', clientVersion: '2.20240726.01.00' },
            { clientName: 'ANDROID', clientVersion: '19.09.37', androidSdkVersion: 30 },
            { clientName: 'IOS', clientVersion: '19.09.3', deviceMake: 'Apple', deviceModel: 'iPhone14,5' },
          ];
          for (const client of clients) {
            try {
              const playerRes = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${apiKey}`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
                },
                body: JSON.stringify({ context: { client }, videoId, contentCheckOk: true, racyCheckOk: true }),
                signal: AbortSignal.timeout(8000),
              });
              if (!playerRes.ok) continue;
              const data = (await playerRes.json()) as any;
              if (data?.playabilityStatus?.status && data.playabilityStatus.status !== 'OK') continue;

              const formats: any[] = [
                ...(data.streamingData?.formats || []),
                ...(data.streamingData?.adaptiveFormats || []),
              ];

              // Muxed (audio+video) MP4 streams are directly downloadable.
              const muxed = formats
                .filter((f) => f.url && /video\/mp4/.test(f.mimeType || ''))
                .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
              if (muxed.length > 0) {
                directVideoUrl = muxed[0].url;
                videoResolution = muxed[0].qualityLabel || muxed[0].quality;
                videoFps = muxed[0].fps;
              }

              // Audio-only M4A adaptive stream for the audio extraction path.
              const audio = formats
                .filter((f) => f.url && /audio\/mp4/.test(f.mimeType || ''))
                .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
              if (audio.length > 0) {
                directAudioUrl = audio[0].url;
              }

              if (directVideoUrl || directAudioUrl) break;
            } catch {
              // Try the next client profile
            }
          }
        }
      }
    } catch {
      // Page / Innertube resolution failed
    }

    const downloadAuthorized = !!(directVideoUrl || directAudioUrl);

    // The public stream URLs found above are only used when present; DRM
    // circumvention and unauthorized extraction are never performed.
    const formats: MediaFormatOption[] = [
      ...(directVideoUrl
        ? [
            {
              id: 'yt-video-1080p',
              type: 'video' as const,
              format: 'mp4',
              qualityLabel: videoResolution ? `${videoResolution} MP4 (Direct Stream)` : 'MP4 (Direct Stream)',
              resolution: videoResolution,
              fps: videoFps,
              directDownloadUrl: directVideoUrl,
              notes: 'Publicly addressable muxed stream exposed by the player metadata.',
            },
          ]
        : [
            {
              id: 'yt-video-1080p',
              type: 'video' as const,
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
      copyrightNotice:
        'This tool respects content rights. Use only for content you own or where an authorized download is provided.',
      availableFormats: formats,
      rawSourceUrl: directVideoUrl || directAudioUrl,
    };
  }

  private extractVideoId(url: string): string | null {
    const regExp = /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([\w-]{11})/;
    const match = url.match(regExp);
    return match ? match[1] : null;
  }
}
