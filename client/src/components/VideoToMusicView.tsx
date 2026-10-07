import React, { useState, useEffect } from 'react';
import {
  Music,
  Upload,
  AlertTriangle,
  CheckCircle2,
  Download,
  Sliders,
  Tag,
  Sparkles,
  Loader2,
  FileAudio,
  Play,
} from 'lucide-react';
import type { AudioMetadataTags } from '../types';
import { extractAudio } from '../services/api';
import { playerStore } from '../services/player';

interface VideoToMusicViewProps {
  initialVideoPath?: string;
  initialVideoName?: string;
  initialVideoArtist?: string;
  onSendToAudioEditor?: (audioPath: string, name: string) => void;
}

export const VideoToMusicView: React.FC<VideoToMusicViewProps> = ({
  initialVideoPath,
  initialVideoName,
  initialVideoArtist,
  onSendToAudioEditor,
}) => {
  const [tempPath, setTempPath] = useState<string | null>(initialVideoPath || null);
  const [videoTitle, setVideoTitle] = useState<string>(initialVideoName || '');
  const [format, setFormat] = useState<'mp3' | 'm4a' | 'aac' | 'wav' | 'flac'>('mp3');
  const [preferStreamCopy, setPreferStreamCopy] = useState(true);

  // Metadata tags
  const [tags, setTags] = useState<AudioMetadataTags>({
    title: '',
    artist: '',
    album: '',
    genre: '',
    year: new Date().getFullYear(),
    trackNumber: '1',
    comment: 'Extracted with VideoOptimize Media Toolkit',
  });

  useEffect(() => {
    if (initialVideoName && !tags.title) {
      setTags((t) => ({ ...t, title: initialVideoName }));
    }
  }, [initialVideoName, tags.title]);

  useEffect(() => {
    if (initialVideoArtist && !tags.artist) {
      setTags((t) => ({ ...t, artist: initialVideoArtist }));
    }
  }, [initialVideoArtist, tags.artist]);

  const [isProcessing, setIsProcessing] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [urlLoading, setUrlLoading] = useState(false);
  const [result, setResult] = useState<{
    downloadUrl: string;
    outputPath: string;
    fileSizeBytes: number;
    sourceBitrateKbps: number;
    outputBitrateKbps: number;
    isStreamCopy: boolean;
    qualityNotice?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setVideoTitle(file.name.replace(/\.[^/.]+$/, ''));
    setTags((t) => ({ ...t, title: file.name.replace(/\.[^/.]+$/, '') }));
    setResult(null);

    // Upload to server to get tempPath
    setIsProcessing(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('video', file);
      const res = await fetch('/api/video/analyze', { method: 'POST', body: formData });
      if (!res.ok) throw new Error('Upload failed.');
      const data = await res.json();
      setTempPath(data.tempPath);
    } catch (err: any) {
      setError(err.message || 'Failed to upload video for extraction.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUrlLoad = async () => {
    const url = urlInput.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      setError('Please enter a valid http(s) URL.');
      return;
    }
    setUrlLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/media/send-to-optimizer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: url }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to load media from URL.');
      const name = (data.originalName || url.split('/').pop() || 'media').replace(/\.[^/.]+$/, '');
      setTempPath(data.tempPath);
      setVideoTitle(name);
      setTags((t) => ({ ...t, title: name }));
    } catch (err: any) {
      setError(err.message || 'Failed to load media from URL.');
    } finally {
      setUrlLoading(false);
    }
  };

  const handleExtract = async () => {
    if (!tempPath) return;

    setIsProcessing(true);
    setError(null);

    try {
      const res = await extractAudio({
        tempPath,
        format,
        bitrate: 320,
        preferStreamCopy,
        metadata: tags,
      });

      setResult(res);
    } catch (err: any) {
      setError(err.message || 'Audio extraction failed.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="text-center space-y-2">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border text-fuchsia-300 bg-fuchsia-500/10 border-fuchsia-500/30 text-xs font-semibold uppercase tracking-wider">
          <Music className="w-3.5 h-3.5" />
          Video to Music
        </div>
        <h2 className="text-2xl sm:text-3xl font-extrabold text-fuchsia-300">Extract Pure Audio</h2>
        <p className="text-xs sm:text-sm text-neutral-400 max-w-xl mx-auto">
          Direct stream copy without generational loss, smart CBR 320 kbps encoding, and complete ID3 metadata customization.
        </p>
      </div>

      {/* Upload or Active Media Source */}
      {!tempPath ? (
        <div className="space-y-4">
          <div className="glass-panel p-8 rounded-2xl border border-white/10 text-center relative hover:border-white/30 transition-all group">
            <input
              type="file"
              accept="video/*,.mp4,.mov,.mkv,.webm,.avi"
              onChange={handleFileUpload}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
            <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center text-white group-hover:scale-105 transition-transform">
              <Upload className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-bold text-white mb-1">Upload Video File</h3>
            <p className="text-xs text-neutral-400 mb-3">MP4, MOV, MKV, WebM, AVI supported</p>
            <span className="inline-flex px-3.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-neutral-300">
              Browse Video Files
            </span>
          </div>

          {/* URL source */}
          <div className="glass-panel p-5 rounded-2xl border border-white/10 space-y-3">
            <h3 className="text-sm font-bold text-white">Or load from URL</h3>
            <div className="flex flex-col sm:flex-row gap-2.5">
              <input
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleUrlLoad()}
                placeholder="https://example.com/video.mp4"
                className="flex-1 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder:text-neutral-600 focus:outline-none focus:border-fuchsia-400/40"
              />
              <button
                onClick={handleUrlLoad}
                disabled={urlLoading || !urlInput.trim()}
                className="px-5 py-2.5 rounded-xl bg-fuchsia-500/20 hover:bg-fuchsia-500/30 border border-fuchsia-500/40 text-fuchsia-300 text-xs font-bold transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {urlLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                {urlLoading ? 'Loading…' : 'Convert From URL'}
              </button>
            </div>
            <p className="text-[11px] text-neutral-500">Direct public media URLs (mp4, mov, mkv, webm, avi…) are downloaded and converted.</p>
          </div>
        </div>
      ) : (
        <div className="glass-panel p-5 rounded-2xl border border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center text-white">
              <FileAudio className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-mono text-white uppercase tracking-wider">Ready for Extraction</p>
              <h4 className="text-sm font-bold text-white truncate max-w-md">{videoTitle || 'Loaded Video Media'}</h4>
            </div>
          </div>
          <button
            onClick={() => {
              setTempPath(null);
              setResult(null);
            }}
            className="text-xs text-neutral-400 hover:text-white px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 transition-all"
          >
            Change Video
          </button>
        </div>
      )}

      {/* Extraction Options & Smart Bitrate Controls */}
      {tempPath && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Format & Quality Settings */}
          <div className="glass-panel p-6 rounded-2xl border border-white/[0.08] space-y-5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-2">
              <Sliders className="w-4 h-4 text-white" />
              Audio Output Settings
            </h3>

            {/* Target Container */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-neutral-400">Export Container Format</label>
              <div className="grid grid-cols-5 gap-2">
                {(['mp3', 'm4a', 'aac', 'flac', 'wav'] as const).map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    onClick={() => setFormat(fmt)}
                    className={`py-2 rounded-xl text-xs font-bold uppercase transition-all ${
                      format === fmt
                        ? 'bg-white/20 text-white border border-white/40 shadow-glow-white/10'
                        : 'bg-white/5 text-neutral-400 hover:text-white border border-white/5'
                    }`}
                  >
                    {fmt}
                  </button>
                ))}
              </div>
            </div>

            {/* Direct Stream Copy Toggle */}
            <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-white">Direct Audio Stream Copy</p>
                <p className="text-[11px] text-neutral-400">
                  Extract without re-encoding when container matches (zero generational loss)
                </p>
              </div>
              <input
                type="checkbox"
                checked={preferStreamCopy}
                onChange={(e) => setPreferStreamCopy(e.target.checked)}
                className="w-4 h-4 accent-white rounded cursor-pointer"
              />
            </div>

            {format === 'flac' && (
              <div className="p-3 rounded-xl bg-white/10 border border-white/20 text-neutral-200 text-xs">
                FLAC produces compressed lossless preservation of uncompressed streams.
              </div>
            )}
          </div>

          {/* ID3 Metadata Tags Editor */}
          <div className="glass-panel p-6 rounded-2xl border border-white/[0.08] space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-2">
              <Tag className="w-4 h-4 text-neutral-300" />
              ID3 Audio Metadata Editor
            </h3>
            <p className="text-[11px] text-neutral-400">
              Customize track tags written into the audio container before saving.
            </p>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-neutral-400 block mb-1">Track Title</label>
                <input
                  type="text"
                  value={tags.title || ''}
                  onChange={(e) => setTags({ ...tags, title: e.target.value })}
                  placeholder="Song or Audio Title"
                  className="w-full px-3 py-2 bg-neutral-900 border border-white/10 rounded-lg text-neutral-200 focus:outline-none focus:border-white/40 font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-neutral-400 block mb-1">Artist</label>
                  <input
                    type="text"
                    value={tags.artist || ''}
                    onChange={(e) => setTags({ ...tags, artist: e.target.value })}
                    placeholder="Artist / Creator"
                    className="w-full px-3 py-2 bg-neutral-900 border border-white/10 rounded-lg text-neutral-200 focus:outline-none focus:border-white/40"
                  />
                </div>
                <div>
                  <label className="text-neutral-400 block mb-1">Album</label>
                  <input
                    type="text"
                    value={tags.album || ''}
                    onChange={(e) => setTags({ ...tags, album: e.target.value })}
                    placeholder="Album Name"
                    className="w-full px-3 py-2 bg-neutral-900 border border-white/10 rounded-lg text-neutral-200 focus:outline-none focus:border-white/40"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-neutral-400 block mb-1">Genre</label>
                  <input
                    type="text"
                    value={tags.genre || ''}
                    onChange={(e) => setTags({ ...tags, genre: e.target.value })}
                    placeholder="Genre"
                    className="w-full px-3 py-2 bg-neutral-900 border border-white/10 rounded-lg text-neutral-200 focus:outline-none focus:border-white/40"
                  />
                </div>
                <div>
                  <label className="text-neutral-400 block mb-1">Year</label>
                  <input
                    type="number"
                    value={tags.year || ''}
                    onChange={(e) => setTags({ ...tags, year: e.target.value })}
                    className="w-full px-3 py-2 bg-neutral-900 border border-white/10 rounded-lg text-neutral-200 focus:outline-none focus:border-white/40"
                  />
                </div>
                <div>
                  <label className="text-neutral-400 block mb-1">Track #</label>
                  <input
                    type="text"
                    value={tags.trackNumber || '1'}
                    onChange={(e) => setTags({ ...tags, trackNumber: e.target.value })}
                    className="w-full px-3 py-2 bg-neutral-900 border border-white/10 rounded-lg text-neutral-200 focus:outline-none focus:border-white/40"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Action Button */}
      {tempPath && !result && (
        <button
          onClick={handleExtract}
          disabled={isProcessing}
          className="w-full py-4 bg-white hover:bg-neutral-200 disabled:opacity-50 text-black font-bold text-sm rounded-xl transition-all shadow-lg shadow-white/20 flex items-center justify-center gap-2"
        >
          {isProcessing ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Extracting Audio Track...
            </>
          ) : (
            <>
              <Music className="w-5 h-5" />
              Extract Audio to {format.toUpperCase()}
            </>
          )}
        </button>
      )}

      {error && (
        <div className="p-4 rounded-xl text-fuchsia-300 bg-fuchsia-500/10 border-fuchsia-500/30 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Result Card */}
      {result && (
        <div className="glass-panel p-6 rounded-2xl border border-white/20 bg-white/[0.02] space-y-5 animate-fadeIn">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-white/20 border border-white/30 flex items-center justify-center text-white">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-white">Audio Extracted Successfully</h4>
                <p className="text-xs text-neutral-400">
                  {(result.fileSizeBytes / (1024 * 1024)).toFixed(2)} MB • {format.toUpperCase()} • {result.outputBitrateKbps} kbps
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() =>
                  playerStore.addAndPlay({
                    id: result.downloadUrl,
                    title: tags.title || 'Extracted Audio',
                    url: result.downloadUrl,
                    creator: tags.artist,
                  })
                }
                className="px-4 py-2 bg-fuchsia-500/20 hover:bg-fuchsia-500/30 border border-fuchsia-500/40 text-fuchsia-300 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5"
              >
                <Play className="w-3.5 h-3.5" />
                Play in Player
              </button>
              <a
                href={result.downloadUrl}
                download
                className="px-4 py-2 bg-white hover:bg-neutral-200 text-black text-xs font-bold rounded-xl transition-all shadow-md shadow-white/20 flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                Download Audio
              </a>
            </div>
          </div>

          {result.qualityNotice && (
            <div className="p-3.5 rounded-xl bg-white/10 border border-white/20 text-neutral-200 text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-white shrink-0 mt-0.5" />
              <p>{result.qualityNotice}</p>
            </div>
          )}

          {/* Audio Player Preview */}
          <div className="p-3 bg-neutral-900/80 rounded-xl border border-white/10">
            <audio src={result.downloadUrl} controls className="w-full h-10" />
          </div>

          {/* Send to Audio Converter Tool */}
          {onSendToAudioEditor && (
            <div className="pt-2 flex justify-end">
              <button
                onClick={() => onSendToAudioEditor(result.outputPath, tags.title || 'extracted_audio')}
                className="px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium text-neutral-200 transition-all flex items-center gap-2"
              >
                <Sparkles className="w-3.5 h-3.5 text-neutral-300" />
                Open in Audio Editor & Trimmer
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};


