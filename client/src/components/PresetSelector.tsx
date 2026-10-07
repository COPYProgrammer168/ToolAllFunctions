import React from 'react';
import { MonitorPlay } from 'lucide-react';

interface PresetSelectorProps {
  selected: string;
  onChange: (preset: string) => void;
}

const presets = [
  { id: 'tiktok', label: 'TikTok', desc: '1080×1920 • 60 FPS', icon: '📱' },
  { id: 'tiktok_4k', label: 'TikTok 4K', desc: '2160×3840 • 60 FPS', icon: '📲' },
  { id: 'youtube_4k', label: 'YouTube 4K', desc: '3840×2160 • Original', icon: '🎬' },
  { id: 'reels', label: 'Instagram Reels', desc: '1080×1920 • 60 FPS', icon: '📸' },
  { id: 'shorts', label: 'YouTube Shorts', desc: '1080×1920 • 60 FPS', icon: '🎥' },
  { id: 'custom', label: 'Custom', desc: 'Full manual control', icon: '⚙️' },
];

export const PresetSelector: React.FC<PresetSelectorProps> = ({ selected, onChange }) => {
  return (
    <div className="space-y-3">
      <label className="text-xs font-semibold uppercase tracking-wider text-neutral-400 flex items-center gap-2">
        <MonitorPlay className="w-3.5 h-3.5 text-white" />
        Export Preset
      </label>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {presets.map((p) => (
          <button
            key={p.id}
            onClick={() => onChange(p.id)}
            className={`p-3 rounded-xl border text-left transition-all ${
              selected === p.id
                ? 'border-white/50 bg-white/10 shadow-glow-white/20'
                : 'border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/[0.15]'
            }`}
          >
            <div className="text-lg mb-1">{p.icon}</div>
            <div className="text-xs font-semibold text-neutral-200">{p.label}</div>
            <div className="text-[10px] text-neutral-500 font-mono mt-0.5">{p.desc}</div>
          </button>
        ))}
      </div>
    </div>
  );
};

