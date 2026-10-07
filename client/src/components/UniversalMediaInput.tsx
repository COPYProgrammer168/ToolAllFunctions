import React, { useState } from 'react';
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
} from 'lucide-react';
import type { MediaAnalysisResult, MediaFormatOption } from '../types';
import { analyzeMediaUrl, startMediaDownload, probeStreamBitrate } from '../services/api';
import { playerStore, usePlayer } from '../services/player';

interface UniversalMediaInputProps {
  onMediaSelect?: (result: MediaAnalysisResult) => void;
  onSendToOptimizer?: (urlOrPath: string, title: string) => void;
  onSendToAudio?: (urlOrPath: string, title: string, artist?: string) => void;
  onJobStarted?: (jobId: string, filename: string) => void;
  platformFilter?: 'youtube' | 'soundcloud' | 'pinterest' | 'tiktok' | 'direct' | 'all';
  audioActionLabel?: string;
  onDirectDownload?: (format: MediaFormatOption) => void;
}

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
  const { playing: isPlaying, currentId } = usePlayer();

  // Reset selection when a new analysis arrives
  React.useEffect(() => {
    setSelectedTracks(new Set());
  }, [analysis]);

  // Lazily probe each listed track's real source bitrate (real > 320)
  React.useEffect(() => {
    if (!analysis?.tracks?.length) return;
    let cancelled = false;
    const tracks = analysis.tracks;
    const concurrency = 3;
    let idx = 0;
    const run = async () => {
      while (idx < tracks.length && !cancelled) {
        const t = tracks[idx++];
        const kbps = await probeStreamBitrate(t.url);
        if (cancelled) return;
        if (typeof kbps === 'number' && kbps > 0) {
          setTrackBitrates((prev) => ({ ...prev, [t.url]: kbps }));
        }
      }
    };
    const workers = Array.from({ length: Math.min(concurrency, tracks.length) }, run);
    Promise.all(workers);
    return () => {
      cancelled = true;
    };
  }, [analysis]);

  const handleTogglePlay = async (track: { title: string; url: string; creator?: string }) => {
    try {
      setError(null);
      setLoadingPlayUrl(track.url);
      const info = await analyzeMediaUrl(track.url);
      const stream = info.rawSourceUrl || info.availableFormats.find((f) => f.directDownloadUrl)?.directDownloadUrl;
      if (!stream) {
        setError('No playable stream available for this track.');
        return;
      }
      playerStore.addAndPlay({ id: track.url, title: track.title, url: stream, creator: track.creator });
    } catch (err: any) {
      setError(`Playback failed: ${err.message || err}`);
    } finally {
      setLoadingPlayUrl(null);
    }
  };



  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setUrl(text);
    } catch {}
  };

  const handleAnalyze = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!url.trim()) return;

    setIsAnalyzing(true);
    setError(null);
    setAnalysis(null);

    try {
      const result = await analyzeMediaUrl(url.trim());
      setAnalysis(result);
      if (result.availableFormats.length > 0) {
        const downloadable = result.availableFormats.find(f => f.directDownloadUrl || result.rawSourceUrl);
        setSelectedFormat(downloadable ? downloadable.id : result.availableFormats[0].id);
      }
      if (onMediaSelect) onMediaSelect(result);
    } catch (err: any) {
      setError(err.message || 'Failed to inspect media resource.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleDownload = async (format: MediaFormatOption) => {
    if (!analysis) return;
    setDownloadingId(format.id);

    try {
      const job = await startMediaDownload({
        sourceUrl: analysis.sourceUrl || format.directDownloadUrl || '',
        directUrl: format.directDownloadUrl || analysis.rawSourceUrl,
        title: analysis.title,
        type: format.type,
        format: format.format,
        customBitrate: format.bitrateKbps,
      });

      if (onJobStarted) {
        onJobStarted(job.jobId, job.filename);
      }
    } catch (err: any) {
      setError(`Download failed: ${err.message}`);
    } finally {
      setDownloadingId(null);
    }
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
              Inspect authorized public media, verify download permissions, or transcode directly
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
                platformFilter !== 'all'
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
            disabled={isAnalyzing || !url.trim()}
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
              {!analysis.downloadAuthorized && analysis.authorizedNotice && (
                <div className="mt-3 p-3.5 rounded-xl bg-white/10 border border-white/20 text-neutral-200/90 text-xs leading-relaxed space-y-1">
                  <p className="font-semibold text-neutral-200 flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-white" />
                    Platform Rule & Copyright Safeguard:
                  </p>
                  <p>{analysis.authorizedNotice}</p>
                  <p className="text-[11px] text-white/70 pt-1">
                    This tool strictly respects digital rights and terms of service. DRM circumvention and private stream extraction are prohibited.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Profile Track List */}
          {analysis.tracks && analysis.tracks.length > 0 && (
            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between gap-2">
                <h5 className="text-xs font-bold uppercase tracking-wider text-neutral-400 flex items-center gap-2">
                  <Music className="w-3.5 h-3.5 text-white" />
                  Tracks ({analysis.tracks.length})
                </h5>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() =>
                      setSelectedTracks((prev) =>
                        prev.size === analysis.tracks!.length
                          ? new Set()
                          : new Set(analysis.tracks!.map((t) => t.url))
                      )
                    }
                    className="text-[11px] text-neutral-400 hover:text-white transition-colors"
                  >
                    {selectedTracks.size === analysis.tracks.length ? 'Deselect all' : 'Select all'}
                  </button>
                  <button
                    disabled={selectedTracks.size === 0 || downloadingId === 'bulk'}
                    onClick={async () => {
                      setDownloadingId('bulk');
                      try {
                        for (const t of analysis.tracks!.filter((tr) => selectedTracks.has(tr.url))) {
                          const job = await startMediaDownload({
                            sourceUrl: t.url,
                            title: t.title,
                            type: 'audio',
                            format: 'mp3',
                            customBitrate: 320,
                          });
                          if (onJobStarted) onJobStarted(job.jobId, job.filename);
                        }
                      } catch (err: any) {
                        setError(`Download failed: ${err.message}`);
                      } finally {
                        setDownloadingId(null);
                      }
                    }}
                    className="px-3 py-1.5 rounded-lg bg-fuchsia-500/20 hover:bg-fuchsia-500/30 border border-fuchsia-500/40 text-fuchsia-300 text-xs font-semibold transition-all disabled:opacity-50 flex items-center gap-1.5"
                  >
                    <Download className="w-3 h-3" />
                    Download Selected ({selectedTracks.size})
                  </button>
                </div>
              </div>
              <div className="divide-y divide-white/5 rounded-xl border border-white/[0.06] overflow-hidden">
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
                      className="w-4 h-4 accent-fuchsia-400 cursor-pointer shrink-0"
                      title="Select for download"
                    />
                    <button
                      onClick={() => (currentId === t.url ? playerStore.toggle() : handleTogglePlay(t))}
                      disabled={loadingPlayUrl === t.url}
                      className="w-9 h-9 rounded-full bg-fuchsia-500/20 hover:bg-fuchsia-500/40 border border-fuchsia-500/40 text-fuchsia-300 flex items-center justify-center transition-all shrink-0"
                      title={currentId === t.url && isPlaying ? 'Pause' : 'Play'}
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
                          {t.duration ? ` • ${Math.floor(t.duration / 60)}:${String(t.duration % 60).padStart(2, '0')}` : ''}
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
                            const job = await startMediaDownload({
                              sourceUrl: t.url,
                              title: t.title,
                              type: 'audio',
                              format: 'mp3',
                              customBitrate: 320,
                            });
                            if (onJobStarted) onJobStarted(job.jobId, job.filename);
                          } catch (err: any) {
                            setError(`Download failed: ${err.message}`);
                          } finally {
                            setDownloadingId(null);
                          }
                        }}
                        disabled={downloadingId !== null}
                        className="px-3 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 border border-white/30 text-white text-xs font-semibold flex items-center gap-1.5 transition-all shrink-0"
                      >
                        <Download className="w-3 h-3" />
                        {downloadingId === t.url ? 'Starting...' : 'Download'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Formats Grid */}
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
                      disabled={downloadingId !== null}
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

          {/* Video Preview */}
          {analysis && analysis.mediaType === 'video' && (
            <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-neutral-400">Video Preview:</span>
                <button
                  type="button"
                  disabled={previewLoading}
                  onClick={async () => {
                    try {
                      setError(null);
                      setPreviewLoading(true);
                      const info = await analyzeMediaUrl(analysis.sourceUrl);
                      const stream =
                        info.rawSourceUrl || info.availableFormats.find((f) => f.directDownloadUrl)?.directDownloadUrl;
                      if (!stream) {
                        setError('No directly playable stream available for this video.');
                        return;
                      }
                      setPreviewVideoUrl(stream);
                    } catch (err: any) {
                      setError(`Preview failed: ${err.message}`);
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
                />
              )}
            </div>
          )}

          {/* Quick Ecosystem Jump Actions */}
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
                  disabled={downloadingId !== null}
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
                    disabled={downloadingId !== null}
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
        </div>
      )}
    </div>
  );
};



