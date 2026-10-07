import React from 'react';
import { SlidersHorizontal, Gauge } from 'lucide-react';
import type { JobConfig } from '../types';
import { PresetSelector } from './PresetSelector';

interface OptimizationPanelProps {
  config: JobConfig;
  onChange: (config: Partial<JobConfig>) => void;
  onStartOptimization: () => void;
  onPreview: () => void;
  isProcessing: boolean;
  warnings: string[];
}

export const OptimizationPanel: React.FC<OptimizationPanelProps> = ({
  config,
  onChange,
  onStartOptimization,
  onPreview,
  isProcessing,
  warnings,
}) => {
  const set = (key: keyof JobConfig, value: any) => onChange({ [key]: value });

  return (
    <div className="glass-panel rounded-2xl border border-white/[0.08] overflow-hidden">
      <div className="p-5 border-b border-white/5">
        <h3 className="text-sm font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-2">
          <SlidersHorizontal className="w-4 h-4 text-neutral-300" />
          Optimization Settings
        </h3>
      </div>

      <div className="p-5 space-y-6 max-h-[calc(100vh-220px)] overflow-y-auto">
        {/* Preset */}
        <PresetSelector selected={config.preset} onChange={(v) => set('preset', v)} />

        {/* Mode */}
        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Processing Mode</label>
          <div className="grid grid-cols-2 gap-2">
            {[
              { id: 'smart', label: 'Smart Optimize', desc: 'Best balance' },
              { id: 'max_quality', label: 'Max Quality', desc: 'Slowest, best' },
              { id: 'fast', label: 'Fast', desc: 'Speed priority' },
              { id: 'preserve_original', label: 'Preserve', desc: 'No changes' },
            ].map((m) => (
              <button
                key={m.id}
                onClick={() => set('mode', m.id)}
                disabled={isProcessing}
                className={`p-3 rounded-xl border text-left transition-all ${
                  config.mode === m.id
                    ? 'border-white/40 bg-white/10'
                    : 'border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05]'
                } ${isProcessing ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <div className="text-xs font-semibold text-neutral-200">{m.label}</div>
                <div className="text-[10px] text-neutral-500 mt-0.5">{m.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Motion */}
        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-neutral-400 flex items-center gap-2">
            <Gauge className="w-3.5 h-3.5 text-white" />
            Motion Smoothness
          </label>
          <select
            value={config.motion}
            onChange={(e) => set('motion', e.target.value)}
            disabled={isProcessing}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-neutral-200 focus:outline-none focus:border-white/50 disabled:opacity-50"
          >
            <option value="off">Original (no interpolation)</option>
            <option value="smooth">Smooth</option>
            <option value="very_smooth">Very Smooth</option>
            <option value="60fps">60 FPS (Motion Estimation)</option>
          </select>
        </div>

        {/* Detail */}
        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Detail Enhancement</label>
          <select
            value={config.detail}
            onChange={(e) => set('detail', e.target.value)}
            disabled={isProcessing}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-neutral-200 focus:outline-none focus:border-white/50 disabled:opacity-50"
          >
            <option value="off">Off</option>
            <option value="soft">Soft</option>
            <option value="natural">Natural</option>
            <option value="sharp">Sharp</option>
            <option value="ultra_sharp">Ultra Sharp</option>
          </select>
        </div>

        {/* Denoise */}
        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Denoise</label>
          <select
            value={config.denoise}
            onChange={(e) => set('denoise', e.target.value)}
            disabled={isProcessing}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-neutral-200 focus:outline-none focus:border-white/50 disabled:opacity-50"
          >
            <option value="off">Off</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>

        {/* Color */}
        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Color Profile</label>
          <select
            value={config.color}
            onChange={(e) => set('color', e.target.value)}
            disabled={isProcessing}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-neutral-200 focus:outline-none focus:border-white/50 disabled:opacity-50"
          >
            <option value="original">Original</option>
            <option value="natural">Natural</option>
            <option value="vibrant">Vibrant</option>
            <option value="cinematic">Cinematic</option>
          </select>
        </div>

        {/* Aspect Ratio */}
        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Aspect Ratio Strategy</label>
          <select
            value={config.aspectRatioStrategy}
            onChange={(e) => set('aspectRatioStrategy', e.target.value)}
            disabled={isProcessing}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-neutral-200 focus:outline-none focus:border-white/50 disabled:opacity-50"
          >
            <option value="preserve">Preserve Original</option>
            <option value="fit">Fit (with black bars)</option>
            <option value="crop">Crop to Fill</option>
            <option value="smart_crop">Smart Crop</option>
            <option value="blur_background">Blur Background</option>
          </select>
        </div>

        {/* Audio */}
        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Audio</label>
          <select
            value={config.audio}
            onChange={(e) => set('audio', e.target.value)}
            disabled={isProcessing}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-neutral-200 focus:outline-none focus:border-white/50 disabled:opacity-50"
          >
            <option value="original">Original</option>
            <option value="optimized">Optimized (AAC 48kHz)</option>
          </select>
        </div>

        {/* Warnings */}
        {warnings.length > 0 && (
          <div className="space-y-2 pt-2">
            {warnings.slice(0, 3).map((w, i) => (
              <div key={i} className="text-xs text-neutral-200 bg-white/5 border border-white/20 rounded-lg px-3 py-2 flex items-start gap-2">
                <span className="text-white mt-0.5">⚠</span>
                <span>{w}</span>
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="space-y-2 pt-3 border-t border-white/5">
          <button
            onClick={onStartOptimization}
            disabled={isProcessing}
            className="w-full py-3.5 rounded-xl bg-white hover:bg-neutral-200 disabled:opacity-50 text-black font-bold text-sm transition-all shadow-lg shadow-white/20"
          >
            {isProcessing ? 'Processing...' : 'Start Optimization'}
          </button>
          <button
            onClick={onPreview}
            disabled={isProcessing}
            className="w-full py-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-neutral-200 font-medium text-sm transition-all disabled:opacity-50"
          >
            Preview 5 Seconds
          </button>
        </div>
      </div>
    </div>
  );
};

