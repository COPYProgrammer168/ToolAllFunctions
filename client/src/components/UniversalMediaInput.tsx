import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Link2,
  Search,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  Music,
  Download,
  Film,
  Sparkles,
  Loader2,
  Layers,
  Copy,
  Play,
  Pause,
  Timer,
  X,
} from 'lucide-react';
import type { MediaAnalysisResult, MediaFormatOption } from '../types';
import { analyzeMediaUrl, startMediaDownload, probeStreamBitrate, MediaApiError } from '../services/api';
import { playerStore, usePlayer } from '../services/player';

/** How long to wait after typing stops before auto-analyzing a pasted URL. */
const URL_DEBOUNCE_MS = 600;
/** Fallback wait time when the server gives no `retry_after`. */
const DEFAULT_RETRY_AFTER_SEC = 60;
/** Long track lists scroll inside the card instead of stretching the page. */
const TRACK_LIST_SCROLL_CLASS = 'max-h-[30rem] overflow-y-auto overscroll-contain';
/** Green download-button styling, shared by the bulk action and per-track buttons. */
const DOWNLOAD_BTN_BASE =
  'px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all duration-200 shrink-0';
const DOWNLOAD_BTN_ACTIVE =
  'bg-emerald-500/15 hover:bg-emerald-500 border-emerald-500/40 hover:border-emerald-500 text-emerald-300 hover:text-emerald-950';
const DOWNLOAD_BTN_IDLE =
  'bg-emerald-500/5 border-emerald-500/20 text-emerald-300/50 cursor-not-allowed';

interface UniversalMediaInputProps {
  onMediaSelect?: (result: MediaAnalysisResult) => void;
  onSendToOptimizer?: (urlOrPath: string, title: string) => void;
  onSendToAudio?: (urlOrPath: string, title: string, artist?: string) => void;
  onJobStarted?: (jobId: string, filename: string) => void;
  platformFilter?: 'youtube' | 'soundcloud' | 'pinterest' | 'tiktok' | 'direct' | 'all';
  audioActionLabel?: string;
  onDirectDownload?: (format: MediaFormatOption) => void;
}

type BulkDownloadType = 'video' | 'audio';

export const UniversalMediaInput: React.FC<UniversalMediaInputProps> = ({
  onMediaSelect,
  onSendToOptimizer,
  onSendToAudio,
  onJobStarted,
  platformFilter = 'all',
  audioActionLabel = 'Extract Music',
  onDirectDownload,
}) => {
  const [url, setUrl] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<MediaAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedFormat, setSelectedFormat] = useState<string>('');
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [loadingPlayUrl, setLoadingPlayUrl] = useState<string | null>(null);
  const [trackBitrates, setTrackBitrates] = useState<Record<string, number>>({});
  const [selectedTracks, setSelectedTracks] = useState<Set<string>>(new Set());
  const [bulkDownloadType, setBulkDownloadType] = useState<BulkDownloadType>('video');
  const [cardPreviewUrl, setCardPreviewUrl] = useState<string | null>(null);
  const [cardPreviewStream, setCardPreviewStream] = useState<string | null>(null);
  const [cardPreviewLoading, setCardPreviewLoading] = useState<string | null>(null);
  // Remaining seconds of a platform rate limit; buttons stay disabled while > 0.
  const [rateLimitSeconds, setRateLimitSeconds] = useState(0);
  const { playing: isPlaying, currentId } = usePlayer();

  // Debounced URL: analysis only fires once typing settles, never per keystroke.
  const [debouncedUrl, setDebouncedUrl] = useState('');
  const lastAnalyzedRef = useRef<string>('');

  /** True while any request of this card is in flight. */
  const isRequestInFlight =
    isAnalyzing ||
    downloadingId !== null ||
    loadingPlayUrl !== null ||
    previewLoading ||
    cardPreviewLoading !== null;

  /** Buttons stay disabled while a request runs, and during a rate-limit wait. */
  const actionsDisabled = isRequestInFlight || rateLimitSeconds > 0;

  // Tick the rate-limit countdown down once per second.
  useEffect(() => {
    if (rateLimitSeconds <= 0) return;
    const timer = setTimeout(() => setRateLimitSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(timer);
  }, [rateLimitSeconds]);

  // Debounce the URL input.
  useEffect(() => {
    const trimmed = url.trim();
    const timer = setTimeout(() => setDebouncedUrl(trimmed), URL_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [url]);

  /**
   * Central error mapping: rate limits become a countdown (no auto-retry),
   * everything else becomes a human-readable message.
   */
  const handleRequestError = useCallback((err: unknown, fallback: string) => {
    if (err instanceof MediaApiError && err.isRateLimited) {
      setRateLimitSeconds(Math.max(1, err.retryAfter ?? DEFAULT_RETRY_AFTER_SEC));
      setError(null);
      return;
    }
    if (err instanceof MediaApiError) {
      setError(err.message || fallback);
      return;
    }
    setError((err as Error)?.message || fallback);
  }, []);

  /** Runs the analysis for a URL (shared by the Analyze button and the debounce). */
  const runAnalysis = useCallback(
    async (targetUrl: string) => {
      const trimmed = targetUrl.trim();
      if (!trimmed) return;
      setIsAnalyzing(true);
      setError(null);
      setAnalysis(null);
      try {
        const result = await analyzeMediaUrl(trimmed);
        setAnalysis(result);
        if (result.availableFormats.length > 0) {
          const downloadable = result.availableFormats.find((f) => f.directDownloadUrl || result.rawSourceUrl);
          setSelectedFormat(downloadable ? downloadable.id : result.availableFormats[0].id);
        }
        if (onMediaSelect) onMediaSelect(result);
      } catch (err) {
        handleRequestError(err, 'Failed to inspect media resource.');
      } finally {
        setIsAnalyzing(false);
      }
    },
    [handleRequestError, onMediaSelect]
  );

  // Auto-analyze once a pasted/typed URL settles, one request per URL.
  useEffect(() => {
    if (!debouncedUrl || lastAnalyzedRef.current === debouncedUrl) return;
    if (rateLimitSeconds > 0) return; // never auto-retry during a rate limit
    lastAnalyzedRef.current = debouncedUrl;
    void runAnalysis(debouncedUrl);
  }, [debouncedUrl, rateLimitSeconds, runAnalysis]);

  const isVideoPlatformList =
    !!analysis?.tracks?.length &&
    (analysis.platform === 'youtube' || analysis.platform === 'tiktok' || analysis.mediaType === 'mixed');

  /**
   * Only tracks the platform actually lets us fetch can be selected or
   * downloaded; the rest stay listed so the user still sees them.
   */
  const availableTracks = (analysis?.tracks || []).filter((t) => !t.unavailable);
  /** Real listing size (e.g. "TRACKS (55)"), including unavailable entries. */
  const displayedTrackCount = analysis?.totalTracks ?? analysis?.tracks?.length ?? 0;

  // Reset selection when a new analysis arrives
  React.useEffect(() => {
    setSelectedTracks(new Set());
    setCardPreviewUrl(null);
    setCardPreviewStream(null);
    setBulkDownloadType(
      analysis?.platform === 'soundcloud' || analysis?.mediaType === 'audio' ? 'audio' : 'video'
    );
  }, [analysis]);

  // Lazily probe each listed track's real source bitrate (SoundCloud audio lists)
  React.useEffect(() => {
    if (!analysis?.tracks?.length) return;
    if (analysis.platform !== 'soundcloud' && analysis.mediaType !== 'audio') return;
    let cancelled = false;
    const tracks = analysis.tracks;
    const concurrency = 3;
    let idx = 0;
    const run = async () => {
      while (idx < tracks.length && !cancelled) {
        const t = tracks[idx++];
        try {
          const kbps = await probeStreamBitrate(t.url);
          if (cancelled) return;
          if (typeof kbps === 'number' && kbps > 0) {
            setTrackBitrates((prev) => ({ ...prev, [t.url]: kbps }));
          }
        } catch (err) {
          // Stop probing entirely on a rate limit — more requests would only
          // extend the block.
          if (err instanceof MediaApiError && err.isRateLimited) {
            handleRequestError(err, 'Too many requests');
            return;
          }
        }
      }
    };
    const workers = Array.from({ length: Math.min(concurrency, tracks.length) }, run);
    Promise.all(workers);
    return () => {
      cancelled = true;
    };
  }, [analysis, handleRequestError]);

  const handleTogglePlay = async (track: { title: string; url: string; creator?: string; unavailable?: string }) => {
    // Unavailable entries have no resolvable stream, so playing them is a no-op.
    if (actionsDisabled || track.unavailable) return;
    try {
      setError(null);
      setLoadingPlayUrl(track.url);
      const info = await analyzeMediaUrl(track.url);
      const stream =
        toPlayableUrl(info.rawSourceUrl) ||
        toPlayableUrl(info.availableFormats.find((f) => f.directDownloadUrl)?.directDownloadUrl);
      if (!stream) {
        setError('No playable stream available for this track.');
        return;
      }
      playerStore.addAndPlay({ id: track.url, title: track.title, url: stream, creator: track.creator });
    } catch (err) {
      handleRequestError(err, `Playback failed: ${(err as Error)?.message || err}`);
    } finally {
      setLoadingPlayUrl(null);
    }
  };

  const handleCardVideoPreview = async (track: { title: string; url: string }) => {
    if (actionsDisabled) return;
    if (cardPreviewUrl === track.url && cardPreviewStream) {
      setCardPreviewUrl(null);
      setCardPreviewStream(null);
      return;
    }
    try {
      setError(null);
      setCardPreviewLoading(track.url);
      const info = await analyzeMediaUrl(track.url);
      const stream = resolvePreviewStream(info);
      if (!stream) {
        setError(
          info.authorizedNotice ||
            'No playable video stream available for preview — the platform did not expose a public video URL. Re-run the analysis, or try a different link.'
        );
        return;
      }
      setCardPreviewUrl(track.url);
      setCardPreviewStream(stream);
    } catch (err) {
      handleRequestError(err, `Preview failed: ${(err as Error)?.message || err}`);
    } finally {
      setCardPreviewLoading(null);
    }
  };

  const downloadTrack = async (
    track: { title: string; url: string },
    type: BulkDownloadType
  ) => {
    const job = await startMediaDownload({
      sourceUrl: track.url,
      title: track.title,
      type,
      format: type === 'audio' ? 'mp3' : 'mp4',
      customBitrate: type === 'audio' ? 320 : undefined,
    });
    if (onJobStarted) onJobStarted(job.jobId, job.filename);
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setUrl(text);
    } catch {}
  };

  const handleAnalyze = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!url.trim() || isRequestInFlight) return;
    // A manual submission supersedes the debounced auto-analyze for this URL.
    lastAnalyzedRef.current = url.trim();
    setDebouncedUrl(url.trim());
    await runAnalysis(url.trim());
  };

  const handleDownload = async (format: MediaFormatOption) => {
    if (!analysis || actionsDisabled) return;
    setDownloadingId(format.id);

    try {
      const useAdaptiveMux =
        format.type === 'video' &&
        !analysis.rawMuxedUrl &&
        analysis.rawVideoUrl &&
        analysis.rawAudioUrl;

      const job = await startMediaDownload({
        sourceUrl: analysis.sourceUrl || format.directDownloadUrl || '',
        directUrl: useAdaptiveMux
          ? undefined
          : format.directDownloadUrl || analysis.rawSourceUrl,
        title: analysis.title,
        type: format.type,
        format: format.format,
        customBitrate: format.bitrateKbps,
        videoUrl: useAdaptiveMux ? analysis.rawVideoUrl : undefined,
        audioUrl: useAdaptiveMux ? analysis.rawAudioUrl : undefined,
      });

      if (onJobStarted) {
        onJobStarted(job.jobId, job.filename);
      }
    } catch (err) {
      handleRequestError(err, 'Download failed. The platform did not respond — try again in a moment.');
    } finally {
      setDownloadingId(null);
    }
  };

  // Platform CDN stream URLs are signed/issued for the *server's* IP, so a
  // browser loading them directly gets HTTP 403 (or CORS failure). Everything
  // remote therefore goes through the server's stream proxy, which forwards
  // the required headers/cookies and supports HTTP Range.
  const toPlayableUrl = (candidate?: string): string | undefined => {
    if (!candidate) return undefined;
    if (/^https?:\/\//i.test(candidate)) {
      return `/api/media/stream?url=${encodeURIComponent(candidate)}`;
    }
    return candidate;
  };

  const resolvePreviewStream = (info: any): string | undefined => {
    // Prefer a true muxed (A+V) stream; if the platform only exposes separate
    // adaptive streams, fall back to the server's live-mux merge endpoint.
    if (info.rawMuxedUrl) return toPlayableUrl(info.rawMuxedUrl);
    if (info.rawVideoUrl && info.rawAudioUrl) {
      return `/api/media/merge-preview?v=${encodeURIComponent(info.rawVideoUrl)}&a=${encodeURIComponent(info.rawAudioUrl)}`;
    }
    if (info.platform === 'tiktok' && info.rawSourceUrl) {
      return toPlayableUrl(info.rawSourceUrl);
    }
    const direct =
      info.rawSourceUrl ||
      info.availableFormats?.find((f: any) => f.type === 'video' && f.directDownloadUrl)?.directDownloadUrl ||
      info.availableFormats?.find((f: any) => f.directDownloadUrl)?.directDownloadUrl;
    return toPlayableUrl(direct);
  };

  const formatDuration = (sec?: number) => {
    if (!sec || sec <= 0) return '';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div className="space-y-6">
      {/* Universal URL Input Card */}
      <div className="glass-panel p-6 rounded-2xl border border-white/[0.08] relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full blur-3xl pointer-events-none" />

        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-white/20 to-neutral-400/20 border border-white/30 flex items-center justify-center text-white">
            <Link2 className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white tracking-tight">Paste Media URL</h3>
            <p className="text-xs text-neutral-400">
              {platformFilter === 'youtube'
                ? 'Video link or full channel URL (e.g. youtube.com/@handle)'
                : platformFilter === 'tiktok'
                  ? 'Video link or profile URL (e.g. tiktok.com/@username)'
                  : 'Inspect authorized public media, verify download permissions, or transcode directly'}
            </p>
          </div>
        </div>

        <form onSubmit={handleAnalyze} className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={
                platformFilter === 'youtube'
                  ? 'https://youtube.com/@channel or https://youtube.com/watch?v=...'
                  : platformFilter === 'tiktok'
                    ? 'https://tiktok.com/@user or https://tiktok.com/@user/video/...'
                    : platformFilter !== 'all'
                      ? `Paste authorized ${platformFilter} URL (https://...)`
                      : 'https://... (YouTube, SoundCloud, Pinterest, TikTok, or Direct HTTPS Media)'
              }
              className="w-full pl-4 pr-24 py-3 bg-neutral-900/90 border border-white/10 rounded-xl text-sm text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-white/50 focus:ring-1 focus:ring-white/30 transition-all font-mono"
            />
            <button
              type="button"
              onClick={handlePaste}
              className="absolute right-2 top-2 px-2.5 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-[11px] font-medium text-neutral-300 transition-all flex items-center gap-1"
            >
              <Copy className="w-3 h-3" />
              Paste
            </button>
          </div>

          <button
            type="submit"
            disabled={actionsDisabled || !url.trim()}
            className="px-6 py-3 bg-white hover:bg-neutral-200 disabled:opacity-50 disabled:cursor-not-allowed text-black text-xs font-bold uppercase tracking-wider rounded-xl transition-all shadow-lg shadow-white/20 flex items-center justify-center gap-2"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Search className="w-4 h-4" />
                Analyze
              </>
            )}
          </button>
        </form>

        {rateLimitSeconds > 0 && (
          <div className="mt-4 p-4 rounded-xl bg-amber-500/10 border border-amber-400/40 text-amber-100 text-xs flex items-start gap-2.5">
            <Timer className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-amber-200">
                Too many requests, try again in {rateLimitSeconds} second{rateLimitSeconds === 1 ? '' : 's'}
              </p>
              <p className="mt-0.5 text-amber-200/80 leading-relaxed">
                The media platform is rate-limiting this server&rsquo;s IP address. Actions unlock automatically
                when the countdown ends &mdash; no retry is sent in the meantime.
              </p>
            </div>
          </div>
        )}

        {error && (
          <div className="mt-4 p-4 rounded-xl bg-white/10 border border-white/20 text-white text-xs flex items-start gap-2.5">
            <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-white">Analysis Notice</p>
              <p className="mt-0.5 text-white/90 leading-relaxed">{error}</p>
            </div>
          </div>
        )}
      </div>

      {/* Analysis Result Display */}
      {analysis && (
        <div className="glass-panel p-6 rounded-2xl border border-white/[0.08] space-y-6 animate-fadeIn">
          {/* Top Info Banner */}
          <div className="flex flex-col sm:flex-row gap-5 items-start">
            {analysis.thumbnail ? (
              <div className="relative w-full sm:w-48 aspect-video sm:aspect-square rounded-xl overflow-hidden bg-neutral-900 border border-white/10 shrink-0">
                <img
                  src={analysis.thumbnail}
                  alt={analysis.title}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLElement).style.display = 'none';
                  }}
                />
                <span className="absolute bottom-2 left-2 px-2 py-0.5 rounded text-[10px] font-mono font-semibold uppercase bg-black/80 text-white border border-white/10">
                  {analysis.platform}
                </span>
              </div>
            ) : (
              <div className="w-full sm:w-36 h-28 rounded-xl bg-neutral-900 border border-white/10 flex items-center justify-center text-neutral-600 shrink-0">
                <Film className="w-8 h-8" />
              </div>
            )}

            <div className="flex-1 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-white/10 text-white border border-white/20">
                  {analysis.platform}
                </span>
                <span className="text-[10px] font-mono font-medium text-neutral-400">
                  {analysis.mediaType.toUpperCase()}
                </span>
                {(analysis.downloadAuthorized || analysis.availableFormats.some(f => f.directDownloadUrl)) ? (
                  <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-white/10 text-white border border-white/20 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    Download Available
                  </span>
                ) : (
                  <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-white/10 text-white border border-white/20 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    Restricted Platform Download
                  </span>
                )}
              </div>

              <h4 className="text-lg font-bold text-white tracking-tight leading-snug">
                {analysis.title}
              </h4>
              {analysis.creator && (
                <p className="text-xs text-neutral-400">By {analysis.creator}</p>
              )}

              {/* Legal & Platform Notice Banner */}
              {analysis.authorizedNotice && (
                <div className="mt-3 p-3.5 rounded-xl bg-white/10 border border-white/20 text-neutral-200/90 text-xs leading-relaxed space-y-1">
                  <p className="font-semibold text-neutral-200 flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-white" />
                    {analysis.downloadAuthorized ? 'Channel / Profile Notice:' : 'Platform Rule & Copyright Safeguard:'}
                  </p>
                  <p>{analysis.authorizedNotice}</p>
                  {!analysis.downloadAuthorized && (
                    <p className="text-[11px] text-white/70 pt-1">
                      This tool strictly respects digital rights and terms of service. DRM circumvention and private stream extraction are prohibited.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Track / Video List (channel, playlist, profile) */}
          {analysis.tracks && analysis.tracks.length > 0 && (
            <div className="space-y-3 pt-2">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <h5 className="text-xs font-bold uppercase tracking-wider text-neutral-400 flex items-center gap-2">
                  {isVideoPlatformList ? (
                    <Film className="w-3.5 h-3.5 text-white" />
                  ) : (
                    <Music className="w-3.5 h-3.5 text-white" />
                  )}
                  {isVideoPlatformList ? 'Videos' : 'Tracks'} ({displayedTrackCount})
                </h5>
                <div className="flex flex-wrap items-center gap-2">
                  {isVideoPlatformList && (
                    <div className="flex items-center rounded-lg border border-white/15 overflow-hidden text-[11px] font-semibold">
                      <button
                        type="button"
                        onClick={() => setBulkDownloadType('video')}
                        className={`px-3 py-1.5 flex items-center gap-1.5 transition-colors ${
                          bulkDownloadType === 'video'
                            ? 'bg-sky-500/30 text-sky-200'
                            : 'bg-neutral-900/60 text-neutral-400 hover:text-white'
                        }`}
                      >
                        <Film className="w-3 h-3" />
                        Video
                      </button>
                      <button
                        type="button"
                        onClick={() => setBulkDownloadType('audio')}
                        className={`px-3 py-1.5 flex items-center gap-1.5 transition-colors ${
                          bulkDownloadType === 'audio'
                            ? 'bg-fuchsia-500/30 text-fuchsia-200'
                            : 'bg-neutral-900/60 text-neutral-400 hover:text-white'
                        }`}
                      >
                        <Music className="w-3 h-3" />
                        Music
                      </button>
                    </div>
                  )}
                  <button
                    onClick={() =>
                      setSelectedTracks((prev) =>
                        prev.size === availableTracks.length
                          ? new Set()
                          : new Set(availableTracks.map((t) => t.url))
                      )
                    }
                    className="text-[11px] text-neutral-400 hover:text-white transition-colors"
                  >
                    {selectedTracks.size === availableTracks.length ? 'Deselect all' : 'Select all'}
                  </button>
                  <button
                    disabled={selectedTracks.size === 0 || downloadingId === 'bulk' || actionsDisabled}
                    onClick={async () => {
                      setDownloadingId('bulk');
                      try {
                        const type: BulkDownloadType = isVideoPlatformList ? bulkDownloadType : 'audio';
                        for (const t of analysis.tracks!.filter((tr) => selectedTracks.has(tr.url) && !tr.unavailable)) {
                          if (actionsDisabled) break;
                          await downloadTrack(t, type);
                        }
                      } catch (err) {
                        handleRequestError(err, 'Download failed. The platform did not respond — try again in a moment.');
                      } finally {
                        setDownloadingId(null);
                      }
                    }}
                    className={`${DOWNLOAD_BTN_BASE} ${selectedTracks.size > 0 ? DOWNLOAD_BTN_ACTIVE : DOWNLOAD_BTN_IDLE}`}
                  >
                    {downloadingId === 'bulk' ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Download className="w-3 h-3" />
                    )}
                    Download Selected ({selectedTracks.size})
                    {isVideoPlatformList ? ` · ${bulkDownloadType === 'audio' ? 'Music' : 'Video'}` : ''}
                  </button>
                </div>
              </div>

              {isVideoPlatformList ? (
                <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 ${TRACK_LIST_SCROLL_CLASS}`}>
                  {analysis.tracks.map((t) => {
                    const isPreviewOpen = cardPreviewUrl === t.url && !!cardPreviewStream;
                    // TikTok CDN thumbnails require a TikTok Referer; proxy them.
                    const thumbnailSrc =
                      analysis.platform === 'tiktok' && t.thumbnail
                        ? `/api/media/stream?url=${encodeURIComponent(t.thumbnail)}`
                        : t.thumbnail;
                    return (
                      <div
                        key={t.url}
                        className={`rounded-xl border overflow-hidden bg-neutral-900/50 transition-all ${
                          selectedTracks.has(t.url)
                            ? 'border-sky-400/50 shadow-[0_0_0_1px_rgba(56,189,248,0.25)]'
                            : 'border-white/[0.06]'
                        }`}
                      >
                        <div className="relative aspect-[9/14] sm:aspect-video bg-black">
                          {isPreviewOpen ? (
                            <video
                              key={cardPreviewStream}
                              controls
                              autoPlay
                              playsInline
                              src={cardPreviewStream!}
                              className="absolute inset-0 w-full h-full object-contain bg-black"
                              onError={() => {
                                setCardPreviewUrl(null);
                                setCardPreviewStream(null);
                                setError('Preview failed: the stream could not be played (expired or blocked by the platform). Try analyzing the link again.');
                              }}
                            />
                          ) : thumbnailSrc ? (
                            <img
                              src={thumbnailSrc}
                              alt=""
                              className="absolute inset-0 w-full h-full object-cover"
                              onError={(e) => {
                                (e.target as HTMLElement).style.display = 'none';
                              }}
                            />
                          ) : (
                            <div className="absolute inset-0 flex items-center justify-center text-neutral-600">
                              <Film className="w-8 h-8" />
                            </div>
                          )}

                          <div className="absolute top-2 left-2 flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={selectedTracks.has(t.url)}
                              onChange={(e) => {
                                setSelectedTracks((prev) => {
                                  const next = new Set(prev);
                                  if (e.target.checked) next.add(t.url);
                                  else next.delete(t.url);
                                  return next;
                                });
                              }}
                              className="w-4 h-4 accent-sky-400 cursor-pointer"
                              title="Select for download"
                            />
                          </div>

                          <button
                            type="button"
                            onClick={() => handleCardVideoPreview(t)}
                            disabled={actionsDisabled}
                            className="absolute bottom-2 right-2 px-2.5 py-1.5 rounded-lg bg-black/75 hover:bg-black/90 border border-white/20 text-white text-[11px] font-semibold flex items-center gap-1.5 disabled:opacity-50"
                          >
                            {cardPreviewLoading === t.url ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : isPreviewOpen ? (
                              <X className="w-3 h-3" />
                            ) : (
                              <Play className="w-3 h-3" />
                            )}
                            {isPreviewOpen ? 'Close' : 'Preview'}
                          </button>

                          {t.duration ? (
                            <span className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded bg-black/80 text-[10px] font-mono text-white">
                              {formatDuration(t.duration)}
                            </span>
                          ) : null}
                        </div>

                        <div className="p-3 space-y-2.5">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-white line-clamp-2 leading-snug">{t.title}</p>
                            <p className="text-[11px] text-neutral-500 truncate mt-0.5">
                              {t.creator || analysis.creator || ''}
                            </p>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              disabled={actionsDisabled}
                              onClick={async () => {
                                setDownloadingId(`${t.url}:video`);
                                try {
                                  await downloadTrack(t, 'video');
                                } catch (err: any) {
                                  handleRequestError(err, 'Download failed. The platform did not respond — try again in a moment.');
                                } finally {
                                  setDownloadingId(null);
                                }
                              }}
                              className="flex-1 px-2.5 py-1.5 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 border border-sky-500/40 text-sky-200 text-[11px] font-semibold flex items-center justify-center gap-1 disabled:opacity-50"
                            >
                              {downloadingId === `${t.url}:video` ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Film className="w-3 h-3" />
                              )}
                              Video
                            </button>
                            <button
                              type="button"
                              disabled={actionsDisabled}
                              onClick={async () => {
                                setDownloadingId(`${t.url}:audio`);
                                try {
                                  await downloadTrack(t, 'audio');
                                } catch (err: any) {
                                  handleRequestError(err, 'Download failed. The platform did not respond — try again in a moment.');
                                } finally {
                                  setDownloadingId(null);
                                }
                              }}
                              className="flex-1 px-2.5 py-1.5 rounded-lg bg-fuchsia-500/20 hover:bg-fuchsia-500/30 border border-fuchsia-500/40 text-fuchsia-200 text-[11px] font-semibold flex items-center justify-center gap-1 disabled:opacity-50"
                            >
                              {downloadingId === `${t.url}:audio` ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Music className="w-3 h-3" />
                              )}
                              Music
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className={`divide-y divide-white/5 rounded-xl border border-white/[0.06] overflow-hidden ${TRACK_LIST_SCROLL_CLASS}`}>
                  {analysis.tracks.map((t) => (
                    <div key={t.url} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-neutral-900/40">
                      <input
                        type="checkbox"
                        checked={selectedTracks.has(t.url)}
                        onChange={(e) => {
                          setSelectedTracks((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(t.url);
                            else next.delete(t.url);
                            return next;
                          });
                        }}
                        disabled={!!t.unavailable}
                        className="w-4 h-4 accent-fuchsia-400 cursor-pointer shrink-0 disabled:cursor-not-allowed disabled:opacity-40"
                        title={t.unavailable || 'Select for download'}
                      />
                      <button
                        onClick={() => (currentId === t.url ? playerStore.toggle() : handleTogglePlay(t))}
                        disabled={actionsDisabled || !!t.unavailable}
                        className="w-9 h-9 rounded-full bg-fuchsia-500/20 hover:bg-fuchsia-500/40 border border-fuchsia-500/40 text-fuchsia-300 flex items-center justify-center transition-all shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                        title={t.unavailable || (currentId === t.url && isPlaying ? 'Pause' : 'Play')}
                      >
                        {loadingPlayUrl === t.url ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : currentId === t.url && isPlaying ? (
                          <Pause className="w-4 h-4" />
                        ) : (
                          <Play className="w-4 h-4" />
                        )}
                      </button>
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        {t.thumbnail ? (
                          <img src={t.thumbnail} alt="" className="w-9 h-9 rounded-lg object-cover border border-white/10" />
                        ) : (
                          <div className="w-9 h-9 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center">
                            <Music className="w-4 h-4 text-neutral-500" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-white truncate">{t.title}</p>
                          <p className="text-[11px] text-neutral-500 truncate">
                            {t.creator || analysis.creator || ''}
                            {t.duration ? ` • ${formatDuration(t.duration)}` : ''}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="px-2 py-1 rounded-lg bg-fuchsia-500/10 border border-fuchsia-500/30 text-[11px] font-mono text-fuchsia-300 whitespace-nowrap">
                          {trackBitrates[t.url] ? `${trackBitrates[t.url]} > 320` : '… > 320'}
                        </span>
                        <button
                          onClick={async () => {
                            setDownloadingId(t.url);
                            try {
                              await downloadTrack(t, 'audio');
                            } catch (err) {
                              handleRequestError(err, 'Download failed. The platform did not respond — try again in a moment.');
                            } finally {
                              setDownloadingId(null);
                            }
                          }}
                          disabled={actionsDisabled || !!t.unavailable}
                          title={t.unavailable}
                          className={`${DOWNLOAD_BTN_BASE} ${t.unavailable ? DOWNLOAD_BTN_IDLE : DOWNLOAD_BTN_ACTIVE}`}
                        >
                          <Download className="w-3 h-3" />
                          {downloadingId === t.url
                            ? 'Starting...'
                            : t.unavailable || 'Download'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Formats Grid */}
          {analysis.availableFormats.length > 0 && (
            <div className="space-y-3 pt-2">
              <h5 className="text-xs font-bold uppercase tracking-wider text-neutral-400 flex items-center gap-2">
                <Layers className="w-3.5 h-3.5 text-white" />
                Available Formats & Export Actions
              </h5>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {analysis.availableFormats.map((fmt) => (
                  <div
                    key={fmt.id}
                    onClick={() => setSelectedFormat(fmt.id)}
                    className={`p-4 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
                      selectedFormat === fmt.id
                        ? 'bg-white/10 border-white/40 shadow-glow-white/5'
                        : 'bg-neutral-900/50 border-white/[0.06] hover:border-white/20'
                    }`}
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {fmt.type === 'audio' ? (
                            <Music className="w-4 h-4 text-fuchsia-400" />
                          ) : fmt.type === 'image' ? (
                            <Layers className="w-4 h-4 text-emerald-400" />
                          ) : (
                            <Film className="w-4 h-4 text-sky-400" />
                          )}
                          <span
                            className={`text-xs font-bold uppercase ${
                              fmt.type === 'audio'
                                ? 'text-fuchsia-300'
                                : fmt.type === 'image'
                                  ? 'text-emerald-300'
                                  : 'text-sky-300'
                            }`}
                          >
                            {fmt.format}
                          </span>
                        </div>
                        <span className="text-[11px] font-mono text-white bg-white/5 px-2 py-0.5 rounded">
                          {fmt.qualityLabel}
                        </span>
                      </div>

                      {fmt.resolution && (
                        <p className="text-[11px] text-neutral-400">Resolution: {fmt.resolution}</p>
                      )}

                      {fmt.notes && (
                        <p className="text-[11px] text-neutral-400 leading-relaxed italic bg-white/[0.02] p-2 rounded">
                          {fmt.notes}
                        </p>
                      )}
                    </div>

                    <div className="pt-3 mt-2 border-t border-white/5 flex items-center justify-between">
                      <span className="text-[10px] text-neutral-500 font-mono">
                        {fmt.type.toUpperCase()}
                      </span>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          handleDownload(fmt);
                        }}
                        disabled={actionsDisabled}
                        className="px-3 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 border border-white/30 text-white text-xs font-semibold flex items-center gap-1.5 transition-all"
                      >
                        <Download className="w-3 h-3" />
                        {downloadingId === fmt.id ? 'Starting...' : 'Download'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Video Preview (single video pages) */}
          {analysis && analysis.mediaType === 'video' && !analysis.tracks?.length && (
            <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-neutral-400">Video Preview:</span>
                <button
                  type="button"
                  disabled={actionsDisabled}
                  onClick={async () => {
                    try {
                      setError(null);
                      setPreviewLoading(true);
                      const info = await analyzeMediaUrl(analysis.sourceUrl);
                      const stream = resolvePreviewStream(info);
                      if (!stream) {
                        setError(
                          info.authorizedNotice ||
                            'No directly playable stream available for this video. Re-run the analysis or try another link.'
                        );
                        return;
                      }
                      setPreviewVideoUrl(stream);
                    } catch (err) {
                      handleRequestError(
                        err,
                        'Preview unavailable — the platform did not expose a playable stream. Try analyzing the link again.'
                      );
                    } finally {
                      setPreviewLoading(false);
                    }
                  }}
                  className="px-3.5 py-1.5 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 border border-sky-500/40 text-sky-300 text-xs font-semibold transition-all flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Film className="w-3.5 h-3.5" />
                  {previewLoading ? 'Loading…' : 'Preview Video'}
                </button>
              </div>
              {previewVideoUrl && (
                <video
                  controls
                  src={previewVideoUrl}
                  className="w-full rounded-xl border border-white/10 bg-black max-h-96"
                  onError={() => {
                    setPreviewVideoUrl(null);
                    setError(
                      'Preview failed: the resolved stream could not be played (signature expired or blocked by the platform). Re-run the analysis and try again.'
                    );
                  }}
                />
              )}
            </div>
          )}

          {/* Quick Ecosystem Jump Actions */}
          {analysis.availableFormats.length > 0 && (
            <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 flex flex-wrap gap-2.5 items-center justify-between">
              <span className="text-xs text-neutral-400">One-Click Ecosystem Actions:</span>
              <div className="flex flex-wrap gap-2">
                {analysis.mediaType === 'audio' ? (
                  <button
                    onClick={() => {
                      const audioFmt =
                        analysis.availableFormats.find((f) => f.type === 'audio' && f.format?.toLowerCase() === 'mp3') ||
                        analysis.availableFormats.find((f) => f.type === 'audio') ||
                        analysis.availableFormats[0];
                      if (audioFmt) handleDownload(audioFmt);
                    }}
                    disabled={actionsDisabled}
                    className="px-3.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium text-neutral-200 transition-all flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5 text-white" />
                    {downloadingId === (analysis.availableFormats.find((f) => f.type === 'audio' && f.format?.toLowerCase() === 'mp3')?.id || analysis.availableFormats.find((f) => f.type === 'audio')?.id || analysis.availableFormats[0]?.id)
                      ? 'Starting...'
                      : 'Download Track / Music'}
                  </button>
                ) : (
                  onSendToOptimizer && (
                    <button
                      onClick={() => onSendToOptimizer(analysis.sourceUrl, analysis.title)}
                      className="px-3.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium text-neutral-200 transition-all flex items-center gap-1.5"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-white" />
                      Send to Video Optimizer
                    </button>
                  )
                )}
                {onDirectDownload && selectedFormat && (() => {
                  const fmt = analysis.availableFormats.find(f => f.id === selectedFormat);
                  if (!fmt) return null;
                  const directUrl = fmt.directDownloadUrl || analysis.rawSourceUrl;
                  if (!directUrl) return null;
                  return (
                    <button
                      onClick={() =>
                        onDirectDownload({ ...fmt, directDownloadUrl: directUrl })
                      }
                      disabled={actionsDisabled}
                      className="px-3.5 py-1.5 rounded-xl bg-white/20 hover:bg-white/30 border border-white/30 text-white text-xs font-bold transition-all flex items-center gap-1.5"
                    >
                      <Download className="w-3.5 h-3.5" />
                      {downloadingId === selectedFormat ? 'Starting...' : 'Download'}
                    </button>
                  );
                })()}
                {onSendToAudio && !onDirectDownload && (
                  <button
                    onClick={() => onSendToAudio(analysis.sourceUrl, analysis.title, analysis.creator)}
                    className="px-3.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium text-neutral-200 transition-all flex items-center gap-1.5"
                  >
                    <Music className="w-3.5 h-3.5 text-neutral-300" />
                    {audioActionLabel}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
