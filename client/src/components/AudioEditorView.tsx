import React, { useState, useEffect, useRef } from 'react';
import {
  Sliders,
  Play,
  Pause,
  Download,
  Loader2,
  Scissors,
  CheckCircle2,
  FileAudio,
} from 'lucide-react';
import { convertAudio, fetchAudioWaveform } from '../services/api';

interface AudioEditorViewProps {
  initialAudioPath?: string;
  initialAudioName?: string;
}

export const AudioEditorView: React.FC<AudioEditorViewProps> = ({
  initialAudioPath,
  initialAudioName,
}) => {
  const [audioPath, setAudioPath] = useState<string | null>(initialAudioPath || null);
  const [audioTitle, setAudioTitle] = useState(initialAudioName || 'Audio Track');
  const [waveform, setWaveform] = useState<number[]>([]);
  const [duration, setDuration] = useState(30);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // Edit states
  const [startTrim, setStartTrim] = useState(0);
  const [endTrim, setEndTrim] = useState(30);
  const [fadeIn, setFadeIn] = useState(0);
  const [fadeOut, setFadeOut] = useState(0);
  const [volume, setVolume] = useState(1.0);
  const [normalize, setNormalize] = useState(true);
  const [exportFormat, setExportFormat] = useState<'mp3' | 'm4a' | 'wav' | 'flac'>('mp3');
  const [bitrate, setBitrate] = useState(320);

  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<{
    downloadUrl: string;
    outputPath: string;
    fileSizeBytes: number;
    duration: number;
  } | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (audioPath) {
      fetchAudioWaveform(audioPath).then(setWaveform).catch(console.error);
    }
  }, [audioPath]);

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
      if (audioRef.current.currentTime >= endTrim) {
        audioRef.current.pause();
        audioRef.current.currentTime = startTrim;
        setIsPlaying(false);
      }
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      const dur = audioRef.current.duration || 30;
      setDuration(dur);
      setEndTrim(Math.round(dur * 10) / 10);
    }
  };

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      if (audioRef.current.currentTime < startTrim || audioRef.current.currentTime >= endTrim) {
        audioRef.current.currentTime = startTrim;
      }
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setAudioTitle(file.name.replace(/\.[^/.]+$/, ''));
    setIsProcessing(true);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('video', file);
      const res = await fetch('/api/video/analyze', { method: 'POST', body: formData });
      if (!res.ok) throw new Error('Failed to load audio file.');
      const data = await res.json();
      setAudioPath(data.tempPath);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExport = async () => {
    if (!audioPath) return;

    setIsProcessing(true);
    try {
      const res = await convertAudio({
        tempPath: audioPath,
        format: exportFormat,
        startSec: startTrim,
        endSec: endTrim,
        fadeInSec: fadeIn,
        fadeOutSec: fadeOut,
        volumeMultiplier: volume,
        normalizeLoudness: normalize,
        bitrateKbps: bitrate,
      });

      setResult(res);
    } catch (err: any) {
      alert(`Export failed: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const formatSec = (s: number) => {
    const mins = Math.floor(s / 60);
    const remainder = (s % 60).toFixed(1);
    return `${mins}:${Number(remainder) < 10 ? '0' : ''}${remainder}`;
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="text-center space-y-2">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border text-amber-300 bg-amber-500/10 border-amber-500/30 text-xs font-semibold uppercase tracking-wider">
          <Sliders className="w-3.5 h-3.5" />
          Pro Audio Editor
        </div>
        <h2 className="text-2xl sm:text-3xl font-extrabold text-amber-300">Waveform Trimming & Fades</h2>
        <p className="text-xs sm:text-sm text-neutral-400 max-w-xl mx-auto">
          Precision audio trimming, smooth fade-in/fade-out transitions, EBU R128 loudness normalization, and clean export.
        </p>
      </div>

      {!audioPath ? (
        <div className="glass-panel p-8 rounded-2xl border border-white/10 text-center relative hover:border-white/30 transition-all group">
          <input
            type="file"
            accept="audio/*,video/*"
            onChange={handleFileUpload}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
          <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center text-neutral-300 group-hover:scale-105 transition-transform">
            <FileAudio className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-bold text-white mb-1">Load Audio Track</h3>
          <p className="text-xs text-neutral-400 mb-3">MP3, WAV, M4A, FLAC, or extract from video</p>
          <span className="inline-flex px-3.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-neutral-300">
            Browse Audio Files
          </span>
        </div>
      ) : (
        <div className="glass-panel p-6 rounded-2xl border border-white/[0.08] space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center text-neutral-300">
                <FileAudio className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-white truncate max-w-md">{audioTitle}</h4>
                <p className="text-xs font-mono text-neutral-400">
                  {formatSec(currentTime)} / {formatSec(duration)}
                </p>
              </div>
            </div>

            <button
              onClick={togglePlay}
              className="px-4 py-2 bg-gradient-to-r from-neutral-600 to-neutral-500 hover:from-neutral-300 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-white/20 flex items-center gap-2"
            >
              {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              {isPlaying ? 'Pause' : 'Play Selection'}
            </button>
          </div>

          {/* Interactive Waveform View */}
          <div className="p-4 bg-neutral-950/80 rounded-xl border border-white/10 relative overflow-hidden">
            <div className="h-24 flex items-end gap-1 px-1">
              {(waveform.length > 0 ? waveform : Array(80).fill(0.3)).map((val, idx) => {
                const totalBars = waveform.length || 80;
                const barTime = (idx / totalBars) * duration;
                const isInsideTrim = barTime >= startTrim && barTime <= endTrim;
                const isPassed = barTime <= currentTime;

                return (
                  <div
                    key={idx}
                    className="flex-1 rounded-full transition-all duration-75"
                    style={{
                      height: `${Math.max(12, val * 100)}%`,
                      backgroundColor: isPassed
                        ? '#00f2fe'
                        : isInsideTrim
                        ? '#7f5af0'
                        : 'rgba(255,255,255,0.1)',
                    }}
                  />
                );
              })}
            </div>

            {/* Playhead indicator */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-white shadow-glow-white pointer-events-none transition-all duration-75"
              style={{ left: `${(currentTime / (duration || 1)) * 100}%` }}
            />
          </div>

          <audio
            ref={audioRef}
            src={`/api/media/file?path=${encodeURIComponent(audioPath)}`}
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onEnded={() => setIsPlaying(false)}
            className="hidden"
          />

          {/* Trim Sliders */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5 bg-white/[0.02] p-4 rounded-xl border border-white/5">
              <div className="flex justify-between text-xs">
                <span className="text-neutral-400 font-medium">Start Trim:</span>
                <span className="font-mono text-white font-bold">{formatSec(startTrim)}</span>
              </div>
              <input
                type="range"
                min="0"
                max={Math.max(0, endTrim - 0.5)}
                step="0.1"
                value={startTrim}
                onChange={(e) => setStartTrim(parseFloat(e.target.value))}
                className="w-full accent-white cursor-pointer"
              />
            </div>

            <div className="space-y-1.5 bg-white/[0.02] p-4 rounded-xl border border-white/5">
              <div className="flex justify-between text-xs">
                <span className="text-neutral-400 font-medium">End Trim:</span>
                <span className="font-mono text-white font-bold">{formatSec(endTrim)}</span>
              </div>
              <input
                type="range"
                min={startTrim + 0.5}
                max={duration || 30}
                step="0.1"
                value={endTrim}
                onChange={(e) => setEndTrim(parseFloat(e.target.value))}
                className="w-full accent-white cursor-pointer"
              />
            </div>
          </div>

          {/* Fades, Volume, Normalization Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 bg-white/[0.02] rounded-xl border border-white/5 space-y-1">
              <span className="text-[11px] text-neutral-400">Fade In (sec)</span>
              <input
                type="number"
                min="0"
                max="5"
                step="0.5"
                value={fadeIn}
                onChange={(e) => setFadeIn(parseFloat(e.target.value) || 0)}
                className="w-full px-2.5 py-1.5 bg-neutral-900 border border-white/10 rounded-lg text-xs font-mono text-neutral-200"
              />
            </div>

            <div className="p-3 bg-white/[0.02] rounded-xl border border-white/5 space-y-1">
              <span className="text-[11px] text-neutral-400">Fade Out (sec)</span>
              <input
                type="number"
                min="0"
                max="5"
                step="0.5"
                value={fadeOut}
                onChange={(e) => setFadeOut(parseFloat(e.target.value) || 0)}
                className="w-full px-2.5 py-1.5 bg-neutral-900 border border-white/10 rounded-lg text-xs font-mono text-neutral-200"
              />
            </div>

            <div className="p-3 bg-white/[0.02] rounded-xl border border-white/5 space-y-1">
              <span className="text-[11px] text-neutral-400">Volume ({Math.round(volume * 100)}%)</span>
              <input
                type="range"
                min="0.2"
                max="2.0"
                step="0.1"
                value={volume}
                onChange={(e) => setVolume(parseFloat(e.target.value))}
                className="w-full accent-neutral-300 cursor-pointer mt-1"
              />
            </div>

            <div className="p-3 bg-white/[0.02] rounded-xl border border-white/5 flex flex-col justify-between">
              <span className="text-[11px] text-neutral-400">Loudness Normalization</span>
              <label className="flex items-center gap-2 cursor-pointer mt-1">
                <input
                  type="checkbox"
                  checked={normalize}
                  onChange={(e) => setNormalize(e.target.checked)}
                  className="w-4 h-4 accent-neutral-600 rounded cursor-pointer"
                />
                <span className="text-xs text-neutral-200">EBU R128</span>
              </label>
            </div>
          </div>

          {/* Export Settings */}
          <div className="p-4 bg-white/[0.02] rounded-xl border border-white/5 flex flex-wrap gap-4 items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs text-neutral-400 font-medium">Format:</span>
              {(['mp3', 'm4a', 'wav', 'flac'] as const).map((fmt) => (
                <button
                  key={fmt}
                  onClick={() => setExportFormat(fmt)}
                  className={`px-3 py-1 rounded-lg text-xs font-bold uppercase transition-all ${
                    exportFormat === fmt
                      ? 'bg-white/20 text-neutral-200 border border-white/40'
                      : 'bg-white/5 text-neutral-400 hover:text-white border border-white/5'
                  }`}
                >
                  {fmt}
                </button>
              ))}
            </div>

            {['mp3', 'm4a'].includes(exportFormat) && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-neutral-400 font-medium">Bitrate:</span>
                {[128, 256, 320].map((b) => (
                  <button
                    key={b}
                    onClick={() => setBitrate(b)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-mono transition-all ${
                      bitrate === b
                        ? 'bg-white/20 text-neutral-200 border border-white/40'
                        : 'bg-white/5 text-neutral-400 hover:text-white'
                    }`}
                  >
                    {b}k
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Export Action */}
          <button
            onClick={handleExport}
            disabled={isProcessing}
            className="w-full py-4 bg-gradient-to-r from-neutral-600 to-neutral-500 hover:from-neutral-300 text-white font-bold text-sm rounded-xl transition-all shadow-lg shadow-white/20 flex items-center justify-center gap-2"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Processing Edits...
              </>
            ) : (
              <>
                <Scissors className="w-4 h-4" />
                Apply Edits & Export {exportFormat.toUpperCase()}
              </>
            )}
          </button>

          {/* Exported Result */}
          {result && (
            <div className="p-5 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-white/20 text-white flex items-center justify-center">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white">Edited Audio Ready</h4>
                  <p className="text-xs text-neutral-400">
                    Duration: {formatSec(result.duration)} • {(result.fileSizeBytes / (1024 * 1024)).toFixed(2)} MB
                  </p>
                </div>
              </div>
              <a
                href={result.downloadUrl}
                download
                className="px-4 py-2 bg-white hover:bg-neutral-200 text-black text-xs font-bold rounded-xl transition-all shadow-md shadow-white/20 flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                Download
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
};


