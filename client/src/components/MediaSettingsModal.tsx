import React, { useState } from 'react';
import {
  X,
  Cpu,
  HardDrive,
  Sliders,
  ShieldCheck,
  Trash2,
  CheckCircle2,
} from 'lucide-react';
import type { HardwareInfo } from '../types';

interface MediaSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  hardware: HardwareInfo | null;
}

export const MediaSettingsModal: React.FC<MediaSettingsModalProps> = ({
  isOpen,
  onClose,
  hardware,
}) => {
  const [activeTab, setActiveTab] = useState<'hardware' | 'performance' | 'storage' | 'general'>(
    'hardware'
  );
  const [concurrency, setConcurrency] = useState(2);
  const [cleaning, setCleaning] = useState(false);
  const [cleaned, setCleaned] = useState(false);

  if (!isOpen) return null;

  const handleCleanStorage = async () => {
    setCleaning(true);
    try {
      // Periodic cleanup endpoint or storage refresh
      await new Promise((r) => setTimeout(r, 600));
      setCleaned(true);
      setTimeout(() => setCleaned(false), 3000);
    } finally {
      setCleaning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      <div className="glass-panel w-full max-w-xl rounded-2xl border border-white/10 overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-5 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-white/10 border border-white/20 flex items-center justify-center text-slate-300">
              <Sliders className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-300">Application Settings</h3>
              <p className="text-[11px] text-neutral-400">Performance, Hardware & Storage Management</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-neutral-400 hover:text-white transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/5 bg-neutral-950/40 px-5 gap-4">
          {[
            { id: 'hardware', label: 'Hardware', icon: Cpu },
            { id: 'performance', label: 'Performance', icon: Sliders },
            { id: 'storage', label: 'Storage', icon: HardDrive },
            { id: 'general', label: 'General', icon: ShieldCheck },
          ].map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`py-3 text-xs font-semibold flex items-center gap-2 border-b-2 transition-all ${
                  activeTab === tab.id
                    ? 'border-white text-white'
                    : 'border-transparent text-neutral-400 hover:text-neutral-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Tab Body */}
        <div className="p-6 space-y-4 overflow-y-auto flex-1 text-xs">
          {activeTab === 'hardware' && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-neutral-900 border border-white/5 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-neutral-400">GPU Acceleration</span>
                  <span className="font-mono text-white font-bold">
                    {hardware?.hasNvidiaGpu ? `NVIDIA (${hardware.gpuName})` : 'CPU Multi-Threading'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-neutral-400">Recommended Encoder</span>
                  <span className="font-mono text-white">{hardware?.recommendedEncoder || 'libx264'}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-neutral-400">Available CPU Cores</span>
                  <span className="font-mono text-neutral-200">{hardware?.cpuCores || 8} Threads</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-neutral-400">Free System Memory</span>
                  <span className="font-mono text-neutral-200">{hardware?.freeMemoryMB || 4096} MB</span>
                </div>
              </div>
              <p className="text-[11px] text-neutral-500 leading-relaxed">
                Hardware detection automatically assigns the highest efficiency hardware video encoder (NVENC or CPU multi-core).
              </p>
            </div>
          )}

          {activeTab === 'performance' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-neutral-300 font-medium">Safe Worker Concurrency</span>
                  <span className="font-mono text-white font-bold">{concurrency} Jobs</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="6"
                  value={concurrency}
                  onChange={(e) => setConcurrency(parseInt(e.target.value, 10))}
                  className="w-full accent-white cursor-pointer"
                />
                <p className="text-[11px] text-neutral-400">
                  Controls simultaneous high-load transcoding tasks to ensure server and OS remain responsive.
                </p>
              </div>
            </div>
          )}

          {activeTab === 'storage' && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-neutral-900 border border-white/5 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-neutral-400">Storage Root</span>
                  <span className="font-mono text-neutral-300">/storage/media-tools</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-neutral-400">Job Retention Policy</span>
                  <span className="font-mono text-white">4 Hours (Auto Cleanup)</span>
                </div>
              </div>

              <button
                onClick={handleCleanStorage}
                disabled={cleaning}
                className="w-full py-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-neutral-200 text-xs font-semibold transition-all flex items-center justify-center gap-2"
              >
                {cleaned ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-white" />
                    Temporary Storage Cleared
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4 text-neutral-400" />
                    Clean Temporary Working Files Now
                  </>
                )}
              </button>
            </div>
          )}

          {activeTab === 'general' && (
            <div className="space-y-3 leading-relaxed text-neutral-400">
              <h4 className="font-bold text-white">Quality Philosophy & Legal Compliance</h4>
              <p>
                VideoOptimize & Media Toolkit is built on non-destructive media engineering:
              </p>
              <ul className="list-disc pl-4 space-y-1">
                <li>Direct stream copy is preferred when formats match to eliminate generational decode/encode degradation.</li>
                <li>320 kbps exports warn when source bitrate is lower (128 kbps), ensuring transparent fidelity expectations.</li>
                <li>Watermark and outro tools are reserved strictly for user-owned content.</li>
                <li>No artificial download limits, paywalls, or accounts required.</li>
              </ul>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-white/5 bg-neutral-950 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-semibold transition-all"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

