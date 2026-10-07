import React from 'react';
import { Loader2, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import type { JobProgress } from '../types';

interface ProcessingProgressProps {
  progress: JobProgress;
  onCancel: () => void;
}

const stateConfig: Record<string, { label: string; color: string }> = {
  UPLOADING: { label: 'Uploading', color: 'text-neutral-400' },
  ANALYZING: { label: 'Analyzing', color: 'text-neutral-300' },
  PLANNING: { label: 'Planning', color: 'text-neutral-300' },
  PROCESSING: { label: 'Processing', color: 'text-white' },
  ENHANCING: { label: 'Enhancing', color: 'text-white' },
  UPSCALING: { label: 'Upscaling', color: 'text-neutral-300' },
  INTERPOLATING: { label: 'Interpolating', color: 'text-neutral-300' },
  ENCODING: { label: 'Encoding', color: 'text-white' },
  VALIDATING: { label: 'Validating', color: 'text-white' },
  COMPLETED: { label: 'Completed', color: 'text-white' },
  FAILED: { label: 'Failed', color: 'text-white' },
  CANCELLED: { label: 'Cancelled', color: 'text-neutral-400' },
};

export const ProcessingProgress: React.FC<ProcessingProgressProps> = ({ progress, onCancel }) => {
  const isTerminal = ['COMPLETED', 'FAILED', 'CANCELLED'].includes(progress.state);
  const cfg = stateConfig[progress.state] || { label: progress.state, color: 'text-neutral-400' };

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="glass-panel p-8 rounded-3xl border-white/20 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              {progress.state === 'COMPLETED' && <CheckCircle2 className="w-5 h-5 text-white" />}
              {progress.state === 'FAILED' && <XCircle className="w-5 h-5 text-white" />}
              {progress.state === 'CANCELLED' && <AlertTriangle className="w-5 h-5 text-white" />}
              {!isTerminal && <Loader2 className="w-5 h-5 text-white animate-spin" />}
              <h3 className={`text-lg font-bold ${cfg.color}`}>{cfg.label}</h3>
            </div>
            <p className="text-sm text-neutral-400">{progress.stageName}</p>
          </div>
          <span className="text-3xl font-mono font-bold text-white">{progress.percent}%</span>
        </div>

        {/* Progress Bar */}
        <div className="h-4 w-full bg-studio-900 rounded-full overflow-hidden border border-white/5">
          <div
            className={`h-full transition-all duration-500 ease-out ${
              progress.state === 'FAILED' || progress.state === 'CANCELLED'
                ? 'bg-white'
                : progress.state === 'COMPLETED'
                ? 'bg-white'
                : 'bg-gradient-to-r from-white to-neutral-600'
            }`}
            style={{ width: `${progress.percent}%` }}
          />
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Speed" value={progress.speed} mono />
          <Stat label="FPS" value={String(progress.fps)} mono />
          <Stat label="Frame" value={`${progress.currentFrame} / ${progress.totalFrames}`} mono />
          <Stat label="Remaining" value={`${Math.max(0, progress.timeRemainingSec)}s`} mono />
        </div>

        {/* Error */}
        {(progress.state === 'FAILED' || progress.state === 'CANCELLED') && progress.error && (
          <div className={`rounded-xl border p-4 ${progress.state === 'FAILED' ? 'border-white/30 bg-white/5' : 'border-white/30 bg-white/5'}`}>
            <p className="text-sm text-neutral-300">{progress.error}</p>
            {progress.technicalError && (
              <details className="mt-2">
                <summary className="text-xs text-neutral-500 cursor-pointer hover:text-neutral-300">Technical Details</summary>
                <pre className="mt-2 text-xs text-neutral-500 bg-black/20 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all">
                  {progress.technicalError}
                </pre>
              </details>
            )}
          </div>
        )}

        {/* Cancel */}
        {!isTerminal && (
          <button
            onClick={onCancel}
            className="w-full py-3 text-sm font-medium text-neutral-400 hover:text-white transition-colors border border-white/5 hover:border-white/10 rounded-xl"
          >
            Cancel Processing
          </button>
        )}
      </div>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string; mono?: boolean }> = ({ label, value, mono }) => (
  <div className="bg-white/5 p-3 rounded-xl border border-white/5 text-center">
    <p className="text-[10px] text-neutral-500 uppercase tracking-wider font-semibold">{label}</p>
    <p className={`text-sm font-semibold text-white mt-1 ${mono ? 'font-mono' : ''}`}>{value}</p>
  </div>
);

