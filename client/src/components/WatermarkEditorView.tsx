import React, { useState } from 'react';
import {
  ShieldAlert,
  Sparkles,
  Download,
  Loader2,
  CheckCircle2,
  Film,
  Upload,
} from 'lucide-react';
import type { WatermarkMethod, WatermarkRegion } from '../types';
import { removeWatermark } from '../services/api';

interface WatermarkEditorViewProps {
  initialVideoPath?: string;
  initialVideoName?: string;
  onSendToOptimizer?: (filePath: string, name: string) => void;
}

export const WatermarkEditorView: React.FC<WatermarkEditorViewProps> = ({
  initialVideoPath,
  initialVideoName,
  onSendToOptimizer,
}) => {
  const [videoPath, setVideoPath] = useState<string | null>(initialVideoPath || null);
  const [videoName, setVideoName] = useState(initialVideoName || 'Video Media');
  const [method, setMethod] = useState<WatermarkMethod>('inpaint');
  const [blurStrength, setBlurStrength] = useState(12);

  // Watermark coordinates (preset or custom)
  const [preset, setPreset] = useState<'bottom-right' | 'top-right' | 'bottom-left' | 'top-left' | 'custom'>('bottom-right');
  const [region, setRegion] = useState<WatermarkRegion>({
    x: 1600,
    y: 920,
    width: 280,
    height: 120,
  });

  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<{
    downloadUrl: string;
    outputPath: string;
    legalNotice: string;
    qualityDisclaimer: string;
  } | null>(null);

  const applyPreset = (p: typeof preset) => {
    setPreset(p);
    if (p === 'bottom-right') {
      setRegion({ x: 1600, y: 920, width: 280, height: 120 });
    } else if (p === 'top-right') {
      setRegion({ x: 1600, y: 40, width: 280, height: 120 });
    } else if (p === 'bottom-left') {
      setRegion({ x: 40, y: 920, width: 280, height: 120 });
    } else if (p === 'top-left') {
      setRegion({ x: 40, y: 40, width: 280, height: 120 });
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setVideoName(file.name);
    setIsProcessing(true);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('video', file);
      const res = await fetch('/api/video/analyze', { method: 'POST', body: formData });
      if (!res.ok) throw new Error('Video upload failed.');
      const data = await res.json();
      setVideoPath(data.tempPath);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleProcess = async () => {
    if (!videoPath) return;

    setIsProcessing(true);
    try {
      const res = await removeWatermark({
        filePath: videoPath,
        method,
        region,
        blurStrength,
      });

      setResult(res);
    } catch (err: any) {
      alert(`Watermark processing error: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="text-center space-y-2">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border text-yellow-300 bg-yellow-500/10 border-yellow-500/30 text-xs font-semibold uppercase tracking-wider">
          <Sparkles className="w-3.5 h-3.5" />
          User-Owned Media
        </div>
        <h2 className="text-2xl sm:text-3xl font-extrabold text-yellow-300">Remove My Watermark</h2>
        <p className="text-xs sm:text-sm text-neutral-400 max-w-xl mx-auto">
          Cleanly remove your own branding, logo, or username overlay from your video before re-exporting.
        </p>
      </div>

      {/* Mandatory Copyright & Ownership Warning */}
      <div className="p-4 rounded-2xl text-yellow-300 bg-yellow-500/10 border-yellow-500/30 text-xs space-y-1.5">
        <div className="flex items-center gap-2 font-bold text-neutral-200">
          <ShieldAlert className="w-4 h-4 text-white shrink-0" />
          <span>Strict Copyright & Fair Use Notice</span>
        </div>
        <p className="leading-relaxed">
          This function is intended exclusively for videos owned by you. Removing a watermark or attribution from third-party content may violate copyright and platform rules. Use this tool only for content you own or have explicit permission to edit.
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
          <h3 className="text-sm font-bold text-white mb-1">Select Your Video</h3>
          <p className="text-xs text-neutral-400 mb-3">Upload your original video to adjust logo watermark</p>
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
                <p className="text-xs font-mono text-neutral-400">User-owned video source</p>
              </div>
            </div>
            <button
              onClick={() => {
                setVideoPath(null);
                setResult(null);
              }}
              className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-neutral-300"
            >
              Change Video
            </button>
          </div>

          {/* Removal Method Selector */}
          <div className="space-y-3">
            <label className="text-xs font-bold uppercase tracking-wider text-neutral-300">
              Removal Technique
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { id: 'inpaint', label: 'AI Inpainting', desc: 'Gradient pixel reconstruction' },
                { id: 'blur', label: 'Box Blur', desc: 'Gaussian blur over logo' },
                { id: 'mask', label: 'Neighbor Mask', desc: 'Surrounding pixel blend' },
                { id: 'crop', label: 'Crop Edge', desc: 'Trim out logo margin' },
              ].map((m) => (
                <button
                  key={m.id}
                  onClick={() => setMethod(m.id as WatermarkMethod)}
                  className={`p-3.5 rounded-xl border text-left transition-all ${
                    method === m.id
                      ? 'bg-white/15 border-white/40 text-white shadow-glow-white/5'
                      : 'bg-white/[0.02] border-white/5 text-neutral-400 hover:text-white'
                  }`}
                >
                  <p className="text-xs font-bold">{m.label}</p>
                  <p className="text-[10px] text-neutral-500 mt-0.5">{m.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Realistic Disclaimer */}
          <div className="p-3.5 rounded-xl bg-neutral-900 border border-white/5 text-xs text-neutral-400 leading-relaxed italic">
            "AI reconstruction attempts to restore the surrounding area. Results depend on the background and movement behind the watermark."
          </div>

          {/* Watermark Region Presets */}
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <label className="text-xs font-bold uppercase tracking-wider text-neutral-300">
                Watermark Region Location
              </label>
              <span className="text-[11px] font-mono text-white">
                X: {region.x}, Y: {region.y}, W: {region.width}, H: {region.height}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { id: 'bottom-right', label: 'Bottom Right (Standard)' },
                { id: 'top-right', label: 'Top Right' },
                { id: 'bottom-left', label: 'Bottom Left' },
                { id: 'top-left', label: 'Top Left' },
              ].map((p) => (
                <button
                  key={p.id}
                  onClick={() => applyPreset(p.id as any)}
                  className={`py-2 rounded-xl text-xs font-medium transition-all ${
                    preset === p.id
                      ? 'bg-white/20 text-white border border-white/30'
                      : 'bg-white/5 text-neutral-400 hover:text-white'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {method === 'blur' && (
            <div className="space-y-1.5 p-4 rounded-xl bg-white/[0.02] border border-white/5">
              <div className="flex justify-between text-xs text-neutral-300">
                <span>Blur Strength</span>
                <span className="font-mono text-white">{blurStrength}px</span>
              </div>
              <input
                type="range"
                min="4"
                max="30"
                value={blurStrength}
                onChange={(e) => setBlurStrength(parseInt(e.target.value, 10))}
                className="w-full accent-white cursor-pointer"
              />
            </div>
          )}

          {/* Action Button */}
          <button
            onClick={handleProcess}
            disabled={isProcessing}
            className="w-full py-4 bg-white hover:bg-neutral-200 text-black font-bold text-sm rounded-xl transition-all shadow-lg shadow-white/20 flex items-center justify-center gap-2"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Processing Watermark Region...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Process Video
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
                    <h4 className="text-sm font-bold text-white">Watermark Removed</h4>
                    <p className="text-xs text-neutral-400">Processed with {method.toUpperCase()} filter</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <a
                    href={result.downloadUrl}
                    download
                    className="px-4 py-2 bg-white hover:bg-neutral-200 text-black text-xs font-bold rounded-xl transition-all shadow-md shadow-white/20 flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download Video
                  </a>
                  {onSendToOptimizer && (
                    <button
                      onClick={() => onSendToOptimizer(result.outputPath, `delogo_${videoName}`)}
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


