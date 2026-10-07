import React from 'react';
import type { QualityScore } from '../types';
import { Activity } from 'lucide-react';

interface QualityScoreGaugeProps {
  score: QualityScore;
}

export const QualityScoreGauge: React.FC<QualityScoreGaugeProps> = ({ score }) => {
  // Gauge color based on overall score
  const getScoreColor = (val: number) => {
    if (val >= 85) return 'text-white stroke-white';
    if (val >= 70) return 'text-white stroke-white';
    if (val >= 50) return 'text-white stroke-white';
    return 'text-white stroke-white';
  };

  const getBarColor = (val: number) => {
    if (val >= 85) return 'bg-white';
    if (val >= 70) return 'bg-white';
    if (val >= 50) return 'bg-white';
    return 'bg-white';
  };

  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (score.overall / 100) * circumference;

  const items = [
    { label: 'Resolution', val: score.resolution },
    { label: 'Sharpness', val: score.sharpness },
    { label: 'Compression', val: score.compression },
    { label: 'Motion', val: score.motion },
    { label: 'Color', val: score.color },
    { label: 'Audio', val: score.audio },
  ];

  return (
    <div className="glass-panel p-5 rounded-2xl border border-white/[0.08] space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-white" />
          <h3 className="text-sm font-semibold text-white tracking-wide uppercase">Source Quality</h3>
        </div>
        <span className="text-[11px] text-neutral-400 font-mono">0 - 100 Index</span>
      </div>

      <div className="flex items-center gap-5">
        {/* Radial Circle */}
        <div className="relative w-24 h-24 flex items-center justify-center shrink-0">
          <svg className="w-full h-full -rotate-90 transform" viewBox="0 0 100 100">
            <circle
              cx="50"
              cy="50"
              r={radius}
              className="text-white/10"
              strokeWidth="7"
              stroke="currentColor"
              fill="transparent"
            />
            <circle
              cx="50"
              cy="50"
              r={radius}
              className={`${getScoreColor(score.overall)} transition-all duration-1000 ease-out`}
              strokeWidth="7"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              fill="transparent"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-2xl font-extrabold text-white font-mono leading-none">
              {score.overall}
            </span>
            <span className="text-[9px] uppercase tracking-wider text-neutral-400 mt-0.5">Score</span>
          </div>
        </div>

        {/* Informational description */}
        <div className="space-y-1.5 text-xs text-neutral-300">
          <div className="font-medium text-white flex items-center gap-1.5">
            {score.overall >= 80 ? (
              <span className="text-white">&bull; High Fidelity Source</span>
            ) : score.overall >= 65 ? (
              <span className="text-white">&bull; Good Candidate for Enhancement</span>
            ) : (
              <span className="text-white">&bull; Significant Restoration Recommended</span>
            )}
          </div>
          <p className="text-[11px] text-neutral-400 leading-tight">
            Computed from stream bitrate-per-pixel, framerate stability, and container profile.
          </p>
        </div>
      </div>

      {/* Breakdown mini bars */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 pt-2 border-t border-white/[0.05]">
        {items.map((it) => (
          <div key={it.label} className="bg-white/[0.02] p-2 rounded-lg border border-white/[0.04] space-y-1">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-neutral-400">{it.label}</span>
              <span className="font-mono font-semibold text-neutral-200">{it.val}</span>
            </div>
            <div className="w-full bg-studio-800 h-1 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${getBarColor(it.val)}`}
                style={{ width: `${Math.min(100, Math.max(5, it.val))}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

