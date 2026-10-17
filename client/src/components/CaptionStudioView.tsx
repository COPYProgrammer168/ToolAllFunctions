import React, { useEffect, useState } from 'react';
import {
  Captions,
  Download,
  Film,
  Link2,
  Loader2,
  Sparkles,
  Upload,
  Wand2,
} from 'lucide-react';
import type { CaptionEnginesStatus, CaptionGenerationResponse } from '../types';
import { fetchCaptionEngines, generateCaptions } from '../services/api';

interface CaptionStudioViewProps {
  /** Pre-filled video path (e.g. handed over from the optimizer result page). */
  initialVideoPath?: string;
  initialVideoName?: string;
}

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'km', label: 'Khmer' },
  { code: 'th', label: 'Thai' },
  { code: 'vi', label: 'Vietnamese' },
  { code: 'zh', label: 'Chinese' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'hi', label: 'Hindi' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'pt', label: 'Portuguese' },
];

const formatCueTime = (seconds: number): string => {
  const total = Math.max(0, seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const ms = Math.round((total - Math.floor(total)) * 1000);
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  const mmm = String(Math.min(ms, 999)).padStart(3, '0');
  return h > 0 ? `${h}:${mm}:${ss}.${mmm}` : `${m}:${ss}.${mmm}`;
};

export const CaptionStudioView: React.FC<CaptionStudioViewProps> = ({
  initialVideoPath,
  initialVideoName,
}) => {
  const [sourceMode, setSourceMode] = useState<'url' | 'file'>(initialVideoPath ? 'file' : 'url');
  const [urlInput, setUrlInput] = useState('');
  const [videoPath, setVideoPath] = useState<string | null>(initialVideoPath || null);
  const [videoName, setVideoName] = useState(initialVideoName || '');
  const [language, setLanguage] = useState('en');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CaptionGenerationResponse | null>(null);
  const [engines, setEngines] = useState<CaptionEnginesStatus | null>(null);

  useEffect(() => {
    fetchCaptionEngines().then(setEngines).catch(() => {});
  }, []);

  useEffect(() => {
    if (initialVideoPath) {
      setVideoPath(initialVideoPath);
      if (initialVideoName) setVideoName(initialVideoName);
      setSourceMode('file');
    }
  }, [initialVideoPath, initialVideoName]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setVideoName(file.name);
    setIsUploading(true);
    setResult(null);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('video', file);
      const res = await fetch('/api/video/analyze', { method: 'POST', body: formData });
      if (!res.ok) throw new Error('Video upload failed.');
      const data = await res.json();
      setVideoPath(data.tempPath);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleGenerate = async () => {
    setError(null);
    setResult(null);

    if (sourceMode === 'url' && !urlInput.trim()) {
      setError('Paste a video link first (YouTube links work without any extra install).');
      return;
    }
    if (sourceMode === 'file' && !videoPath) {
      setError('Select or upload a video first.');
      return;
    }

    setIsGenerating(true);
    try {
      const data = await generateCaptions({
        url: sourceMode === 'url' ? urlInput.trim() : undefined,
        filePath: sourceMode === 'file' ? videoPath || undefined : undefined,
        language,
      });
      setResult(data);
    } catch (err: any) {
      setError(err.message || 'Caption generation failed.');
    } finally {
      setIsGenerating(false);
    }
  };

  const canGenerate =
    !isGenerating &&
    !isUploading &&
    (sourceMode === 'url' ? urlInput.trim().length > 0 : Boolean(videoPath));

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="text-center space-y-2">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border text-teal-300 bg-teal-500/10 border-teal-500/30 text-xs font-semibold uppercase tracking-wider">
          <Captions className="w-3.5 h-3.5" />
          Auto Subtitles
        </div>
        <h2 className="text-2xl sm:text-3xl font-extrabold text-teal-300">Video Captions Studio</h2>
        <p className="text-xs sm:text-sm text-neutral-400 max-w-2xl mx-auto">
          Generate subtitles from a video link or a video file. Export ready-to-upload subtitle files in
          SRT, VTT, or plain text — perfect for TikTok, Reels, Shorts, and YouTube uploads.
        </p>
      </div>

      {/* Engine availability */}
      <div className="flex flex-wrap items-center justify-center gap-2 text-[11px]">
        {[
          { label: 'Platform caption tracks', ready: engines?.platformCaptions ?? true },
          { label: 'yt-dlp fallback', ready: engines?.ytDlp ?? false },
          { label: 'Whisper local transcription', ready: engines?.whisper ?? false },
        ].map((e) => (
          <span
            key={e.label}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border font-mono ${
              e.ready
                ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
                : 'border-white/10 bg-white/[0.03] text-neutral-500'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${e.ready ? 'bg-emerald-400' : 'bg-neutral-600'}`} />
            {e.label}
            {!e.ready && ' (not installed)'}
          </span>
        ))}
      </div>

      {/* Source Selector */}
      <div className="glass-panel p-6 rounded-2xl border border-white/[0.08] space-y-5">
        <div className="flex gap-1 bg-white/5 p-1 rounded-xl border border-white/5 mx-auto w-fit max-w-full overflow-x-auto no-scrollbar">
          {(
            [
              { id: 'url', label: 'From Video Link', icon: Link2 },
              { id: 'file', label: 'From Video File', icon: Film },
            ] as const
          ).map((m) => (
            <button
              key={m.id}
              onClick={() => {
                setSourceMode(m.id);
                setError(null);
              }}
              className={`px-4 py-2 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all flex items-center gap-2 shrink-0 whitespace-nowrap ${
                sourceMode === m.id
                  ? 'bg-white/20 text-white shadow-glow-white/10'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <m.icon className="w-3.5 h-3.5" />
              {m.label}
            </button>
          ))}
        </div>

        {sourceMode === 'url' ? (
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
              Video URL
            </label>
            <input
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=…"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3.5 py-3 text-sm text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-white/50"
            />
            <p className="text-[11px] text-neutral-500">
              YouTube links use the platform's caption tracks (auto-generated captions included) — no local
              engine required. Other platforms use the optional yt-dlp subtitle extractor.
            </p>
          </div>
        ) : !videoPath ? (
          <div className="relative p-8 rounded-2xl border border-dashed border-white/15 text-center hover:border-white/30 transition-all group">
            <input
              type="file"
              accept="video/*"
              onChange={handleFileUpload}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
            <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center text-white group-hover:scale-105 transition-transform">
              {isUploading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Upload className="w-6 h-6" />}
            </div>
            <h3 className="text-sm font-bold text-white mb-1">
              {isUploading ? 'Uploading video…' : 'Select Your Video'}
            </h3>
            <p className="text-xs text-neutral-400">
              Local files are transcribed with the server's Whisper engine (when installed).
            </p>
          </div>
        ) : (
          <div className="flex items-center justify-between p-4 rounded-xl bg-white/[0.03] border border-white/10">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center text-white shrink-0">
                <Film className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h4 className="text-sm font-bold text-white truncate">{videoName || 'Selected video'}</h4>
                <p className="text-[11px] font-mono text-neutral-500 truncate">{videoPath}</p>
              </div>
            </div>
            <button
              onClick={() => {
                setVideoPath(null);
                setVideoName('');
                setResult(null);
              }}
              className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-neutral-300 shrink-0"
            >
              Change Video
            </button>
          </div>
        )}

        {/* Language + actions */}
        <div className="grid grid-cols-1 sm:grid-cols-[220px_1fr] gap-3 items-end">
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
              Caption Language
            </label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-neutral-200 focus:outline-none focus:border-white/50"
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={handleGenerate}
            disabled={!canGenerate}
            className="w-full py-3.5 rounded-xl bg-white hover:bg-neutral-200 disabled:opacity-40 text-black font-bold text-sm transition-all shadow-lg shadow-white/20 flex items-center justify-center gap-2"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Generating Captions…
              </>
            ) : (
              <>
                <Wand2 className="w-4 h-4" />
                Generate Captions
              </>
            )}
          </button>
        </div>

        {isGenerating && sourceMode === 'file' && (
          <p className="text-[11px] text-neutral-500 text-center">
            Local transcription can take a while — Whisper processes the audio track on the server.
          </p>
        )}

        {error && (
          <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-200 leading-relaxed">
            {error}
          </div>
        )}
      </div>

      {/* Result */}
      {result && (
        <div className="glass-panel p-6 rounded-2xl border border-white/[0.08] space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-teal-400/15 border border-teal-400/30 text-teal-300 flex items-center justify-center shrink-0">
                <Sparkles className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h4 className="text-sm font-bold text-white truncate">
                  {result.title || 'Captions generated'}
                </h4>
                <p className="text-[11px] text-neutral-400">
                  {result.engineDetail} • {result.cueCount} cue{result.cueCount === 1 ? '' : 's'} •{' '}
                  {result.language}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 shrink-0">
              {(
                [
                  { id: 'srt', label: 'SRT' },
                  { id: 'vtt', label: 'VTT' },
                  { id: 'txt', label: 'TXT' },
                ] as const
              ).map((f) => (
                <a
                  key={f.id}
                  href={result.downloads[f.id]}
                  download
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                    f.id === 'srt'
                      ? 'bg-white hover:bg-neutral-200 text-black shadow-md shadow-white/20'
                      : 'bg-white/5 hover:bg-white/10 border border-white/10 text-neutral-200'
                  }`}
                >
                  <Download className="w-3.5 h-3.5" />
                  {f.label}
                </a>
              ))}
            </div>
          </div>

          {result.notices.length > 0 && (
            <div className="space-y-1.5">
              {result.notices.map((n, i) => (
                <p key={i} className="text-[11px] text-neutral-400 bg-white/[0.03] border border-white/5 rounded-lg px-3 py-2">
                  {n}
                </p>
              ))}
            </div>
          )}

          {/* Cue list */}
          <div className="max-h-80 overflow-y-auto rounded-xl border border-white/5 bg-black/30 divide-y divide-white/5">
            {result.cues.map((cue, i) => (
              <div key={i} className="flex gap-3 px-3.5 py-2 hover:bg-white/[0.03]">
                <span className="text-[10px] font-mono text-teal-300/80 w-24 shrink-0 pt-0.5">
                  {formatCueTime(cue.start)}
                </span>
                <span className="text-xs text-neutral-200 leading-relaxed">{cue.text}</span>
              </div>
            ))}
          </div>

          <p className="text-[11px] text-neutral-500">
            Tip: SRT/VTT files can be uploaded straight to YouTube (Subtitles), TikTok (auto captions), and
            most editors (Premiere, CapCut, DaVinci).
          </p>
        </div>
      )}
    </div>
  );
};
