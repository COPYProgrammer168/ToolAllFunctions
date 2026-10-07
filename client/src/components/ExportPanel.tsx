import React from 'react';
import { Download, RefreshCw } from 'lucide-react';
import type { JobProgress } from '../types';

interface ExportPanelProps {
  progress: JobProgress;
  onOptimizeAgain: () => void;
  onNewVideo: () => void;
}

export const ExportPanel: React.FC<ExportPanelProps> = ({
  progress,
  onOptimizeAgain,
  onNewVideo,
}) => {
  const formatSize = (bytes?: number) => {
    if (!bytes) return 'N/A';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  return (
    <div className="w-full max-w-3xl mx-auto space-y-6">
      <div className="text-center space-y-2">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border text-emerald-300 bg-emerald-500/10 border-emerald-500/30">
          <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
          <span className="text-sm font-bold uppercase tracking-widest">Optimization Complete</span>
        </div>
        <h2 className="text-3xl sm:text-4xl font-extrabold text-emerald-300">Your video is ready.</h2>
      </div>

      <div className="glass-panel p-6 rounded-2xl border border-white/[0.08]">
        <h3 className="text-sm font-bold uppercase tracking-wider text-neutral-300 mb-4">Results Summary</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Result label="Original Size" value={formatSize(progress.inputSize)} />
          <Result label="Optimized Size" value={formatSize(progress.outputSize)} />
          {progress.validationReport && (
            <>
              <Result label="Output Resolution" value={progress.validationReport.outputResolution} />
              <Result label="Output FPS" value={String(progress.validationReport.outputFps)} />
              <Result label="Duration" value={`${progress.validationReport.outputDuration}s`} />
              <Result label="Audio Sync" value={progress.validationReport.audioSynced ? 'Synced ✓' : 'Drift ⚠'} />
            </>
          )}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <a
          href={progress.outputUrl}
          download
          className="flex-1 py-4 rounded-2xl bg-white hover:bg-neutral-200 text-black font-bold text-center transition-all shadow-xl shadow-white/20 flex items-center justify-center gap-2"
        >
          <Download className="w-5 h-5" />
          Download Optimized Video
        </a>
        <button
          onClick={onOptimizeAgain}
          className="px-6 py-4 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 text-neutral-200 font-medium transition-all flex items-center justify-center gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          Change Settings
        </button>
        <button
          onClick={onNewVideo}
          className="px-6 py-4 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 text-neutral-200 font-medium transition-all"
        >
          New Video
        </button>
      </div>
    </div>
  );
};

const Result: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="bg-white/[0.03] rounded-xl p-3 border border-white/[0.06] text-center">
    <div className="text-[10px] text-neutral-500 uppercase tracking-wider">{label}</div>
    <div className="text-sm font-semibold text-white mt-1 font-mono">{value}</div>
  </div>
);


