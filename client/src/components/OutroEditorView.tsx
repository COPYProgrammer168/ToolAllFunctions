import React, { useState } from 'react';
import {
  Scissors,
  Sparkles,
  Download,
  Loader2,
  CheckCircle2,
  Film,
  Upload,
} from 'lucide-react';
import type { DetectedOutro } from '../types';
import { detectOutro, trimEnding } from '../services/api';

interface OutroEditorViewProps {
  initialVideoPath?: string;
  initialVideoName?: string;
  onSendToOptimizer?: (filePath: string, name: string) => void;
}

export const OutroEditorView: React.FC<OutroEditorViewProps> = ({
  initialVideoPath,
  initialVideoName,
  onSendToOptimizer,
}) => {
  const [videoPath, setVideoPath] = useState<string | null>(initialVideoPath || null);
  const [videoName, setVideoName] = useState(initialVideoName || 'Video Media');
  const [isScanning, setIsScanning] = useState(false);
  const [isTrimming, setIsTrimming] = useState(false);
  const [detectedOutro, setDetectedOutro] = useState<DetectedOutro | null>(null);

  // Manual cut time in seconds
  const [cutTime, setCutTime] = useState<number>(30);
  const [totalDuration, setTotalDuration] = useState<number>(30);
  const [applyFadeOut, setApplyFadeOut] = useState(true);

  const [result, setResult] = useState<{
    downloadUrl: string;
    outputPath: string;
    outputDuration: number;
  } | null>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setVideoName(file.name);
    setResult(null);
    setDetectedOutro(null);
    setIsScanning(true);

    try {
      const formData = new FormData();
      formData.append('video', file);
      const res = await fetch('/api/video/analyze', { method: 'POST', body: formData });
      if (!res.ok) throw new Error('Video upload failed.');
      const data = await res.json();
      setVideoPath(data.tempPath);

      const dur = data.report.metadata.duration || 30;
      setTotalDuration(dur);
      setCutTime(dur);

      // Automatically run smart outro detection
      const outro = await detectOutro(data.tempPath);
      setDetectedOutro(outro);
      setCutTime(outro.suggestedCutTime);
      setTotalDuration(outro.totalDuration);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setIsScanning(false);
    }
  };

  const handleScanOutro = async () => {
    if (!videoPath) return;
    setIsScanning(true);
    try {
      const outro = await detectOutro(videoPath);
      setDetectedOutro(outro);
      setCutTime(outro.suggestedCutTime);
      setTotalDuration(outro.totalDuration);
    } catch (err: any) {
      alert(`Outro detection error: ${err.message}`);
    } finally {
      setIsScanning(false);
    }
  };

  const handleApplyTrim = async () => {
    if (!videoPath) return;
    setIsTrimming(true);
    try {
      const res = await trimEnding({
        filePath: videoPath,
        cutTimeSec: cutTime,
        applyFadeOut,
      });

      setResult(res);
    } catch (err: any) {
      alert(`Trimming error: ${err.message}`);
    } finally {
      setIsTrimming(false);
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
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border text-pink-300 bg-pink-500/10 border-pink-500/30 text-xs font-semibold uppercase tracking-wider">
          <Scissors className="w-3.5 h-3.5" />
          Ending Removal
        </div>
        <h2 className="text-2xl sm:text-3xl font-extrabold text-pink-300">Smart Outro & End-Card Trimmer</h2>
        <p className="text-xs sm:text-sm text-neutral-400 max-w-xl mx-auto">
          Scan for trailing silence, black frames, or static outro cards and cleanly trim with smooth fade-out.
        </p>
      </div>

      {!videoPath ? (
        <div className="glass-panel p-8 rounded-2xl border border-white/10 text-center relative hover:border-white/30 transition-all group">
          <input
            type="file"
            accept="video/*"
            onChange={handleFileUpload}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
          <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center text-white group-hover:scale-105 transition-transform">
            <Upload className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-bold text-white mb-1">Select Video for Outro Removal</h3>
          <p className="text-xs text-neutral-400 mb-3">Upload your video to analyze ending frames</p>
          <span className="inline-flex px-3.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-neutral-300">
            Browse Videos
          </span>
        </div>
      ) : (
        <div className="glass-panel p-6 rounded-2xl border border-white/[0.08] space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center text-white">
                <Film className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-white truncate max-w-md">{videoName}</h4>
                <p className="text-xs font-mono text-neutral-400">Total Duration: {formatSec(totalDuration)}</p>
              </div>
            </div>

            <button
              onClick={handleScanOutro}
              disabled={isScanning}
              className="px-3.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium text-neutral-200 transition-all flex items-center gap-1.5"
            >
              {isScanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-white" />}
              Re-Scan Outro
            </button>
          </div>

          {/* Smart Outro Detection Card */}
          {detectedOutro && detectedOutro.detected && (
            <div className="p-5 rounded-2xl bg-white/10 border border-white/25 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-white" />
                  <h4 className="text-xs font-bold uppercase tracking-wider text-white">
                    Smart Outro Detected
                  </h4>
                </div>
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-white/20 text-neutral-200">
                  {detectedOutro.confidence}% Confidence
                </span>
              </div>

              <div className="p-3 bg-neutral-900/80 rounded-xl border border-white/5 space-y-1">
                <p className="text-sm font-bold text-white">
                  Possible outro detected from {detectedOutro.outroStartFormatted} to {detectedOutro.outroEndFormatted}
                </p>
                <p className="text-xs text-neutral-400 leading-relaxed">
                  Reason: {detectedOutro.reason}
                </p>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={() => setCutTime(detectedOutro.suggestedCutTime)}
                  className="px-4 py-2 rounded-xl bg-white hover:bg-white text-neutral-950 text-xs font-bold transition-all shadow-md shadow-white/20"
                >
                  Remove Detected Outro
                </button>
                <button
                  onClick={() => setCutTime(totalDuration)}
                  className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-neutral-300 transition-all"
                >
                  Keep Ending
                </button>
              </div>
            </div>
          )}

          {/* Manual Cut Time Slider */}
          <div className="space-y-2 p-5 bg-white/[0.02] rounded-xl border border-white/5">
            <div className="flex justify-between items-center text-xs">
              <span className="text-neutral-400 font-medium">Video End Cut Point:</span>
              <span className="font-mono text-white font-bold text-sm">{formatSec(cutTime)}</span>
            </div>
            <input
              type="range"
              min="1"
              max={totalDuration || 30}
              step="0.1"
              value={cutTime}
              onChange={(e) => setCutTime(parseFloat(e.target.value))}
              className="w-full accent-white cursor-pointer"
            />
            <div className="flex justify-between text-[10px] font-mono text-neutral-500">
              <span>0:00.0</span>
              <span>{formatSec(totalDuration)}</span>
            </div>
          </div>

          {/* Fade-out checkbox */}
          <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-white">Smooth Audio & Video Fade-Out</p>
              <p className="text-[11px] text-neutral-400">
                Gently fades out 0.8s before the cut point to prevent abrupt audio pop
              </p>
            </div>
            <input
              type="checkbox"
              checked={applyFadeOut}
              onChange={(e) => setApplyFadeOut(e.target.checked)}
              className="w-4 h-4 accent-white rounded cursor-pointer"
            />
          </div>

          {/* Action Button */}
          <button
            onClick={handleApplyTrim}
            disabled={isTrimming}
            className="w-full py-4 bg-white hover:bg-neutral-200 text-black font-bold text-sm rounded-xl transition-all shadow-lg shadow-white/20 flex items-center justify-center gap-2"
          >
            {isTrimming ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Trimming Video Ending...
              </>
            ) : (
              <>
                <Scissors className="w-4 h-4" />
                Trim Ending at {formatSec(cutTime)}
              </>
            )}
          </button>

          {/* Result Card */}
          {result && (
            <div className="p-5 rounded-2xl bg-white/10 border border-white/20 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-white/20 text-white flex items-center justify-center">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">Ending Removed Successfully</h4>
                    <p className="text-xs text-neutral-400">New Duration: {formatSec(result.outputDuration)}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <a
                    href={result.downloadUrl}
                    download
                    className="px-4 py-2 bg-white hover:bg-neutral-200 text-black text-xs font-bold rounded-xl transition-all shadow-md shadow-white/20 flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download Trimmed Video
                  </a>
                  {onSendToOptimizer && (
                    <button
                      onClick={() => onSendToOptimizer(result.outputPath, `trimmed_${videoName}`)}
                      className="px-4 py-2 bg-white/10 hover:bg-white/15 text-white text-xs font-semibold rounded-xl border border-white/10 transition-all flex items-center gap-1.5"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-white" />
                      Send to Optimizer
                    </button>
                  )}
                </div>
              </div>

              {/* Video Player */}
              <div className="aspect-video bg-black rounded-xl overflow-hidden border border-white/10">
                <video src={result.downloadUrl} controls className="w-full h-full object-contain" />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};


