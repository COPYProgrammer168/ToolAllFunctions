import React from 'react';
import { ShieldCheck, RefreshCw, Menu, Sparkles, Grid } from 'lucide-react';
import type { HardwareInfo, AppNavSection } from '../types';

/* ─── Brand logo mark (inline SVG) ─── */
const LogoMark = () => (
  <svg
    viewBox="0 0 36 36"
    className="w-9 h-9"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <defs>
      <linearGradient id="logoGrad" x1="0" y1="0" x2="36" y2="36" gradientUnits="userSpaceOnUse">
        <stop stopColor="#00f2fe" />
        <stop offset="0.6" stopColor="#7f5af0" />
        <stop offset="1" stopColor="#00b4d8" />
      </linearGradient>
    </defs>
    {/* Outer rounded square */}
    <rect x="2" y="2" width="32" height="32" rx="10" stroke="url(#logoGrad)" strokeWidth="2" fill="none" />
    {/* Inner play-triangle / diamond shape */}
    <path
      d="M14 12 L26 18 L14 24 Z"
      fill="url(#logoGrad)"
      opacity="0.9"
    />
    {/* Spark accent */}
    <circle cx="28" cy="8" r="2.5" fill="#00f2fe" opacity="0.6" />
  </svg>
);

interface NavbarProps {
  hardware: HardwareInfo | null;
  activeSection: AppNavSection;
  onSelectSection: (section: AppNavSection) => void;
  onToggleSidebar: () => void;
  onOpenHardware: () => void;
  onOpenPhilosophy: () => void;
  onReset: () => void;
  hasActiveVideo: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  hardware,
  activeSection,
  onSelectSection,
  onToggleSidebar,
  onOpenHardware,
  onOpenPhilosophy,
  onReset,
  hasActiveVideo,
}) => {
  return (
    <header className="sticky top-0 z-30 w-full border-b border-white/[0.06] bg-neutral-950/85 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Left: Mobile Toggle & Brand */}
        <div className="flex items-center gap-3">
          <button
            onClick={onToggleSidebar}
            className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-neutral-300 lg:hidden border border-white/5"
            aria-label="Toggle Navigation Menu"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div
            className="flex items-center gap-3 cursor-pointer group"
            onClick={() => onSelectSection('studio-optimize')}
          >
            <div className="relative flex items-center justify-center group-hover:scale-105 transition-transform duration-300">
              <LogoMark />
              <div className="absolute inset-0 rounded-xl bg-white/10 blur-md -z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-lg tracking-tight bg-gradient-to-r from-white via-neutral-100 to-neutral-400 bg-clip-text text-transparent">
                  VideoOptimize
                </span>
                <span className="text-[10px] uppercase font-mono tracking-wider px-1.5 py-0.5 rounded bg-white/10 text-white border border-white/20">
                  TOOLKIT
                </span>
              </div>
              <p className="text-[11px] text-neutral-500 hidden sm:block">
                Optimizer + Creative Media Suite
              </p>
            </div>
          </div>
        </div>

        {/* Center / Navigation items */}
        <div className="hidden md:flex items-center gap-1 bg-neutral-900/60 p-1 rounded-xl border border-white/[0.05]">
          <button
            onClick={() => onSelectSection('studio-optimize')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
              activeSection === 'studio-optimize'
                ? 'bg-white/20 text-white shadow-glow-white/10'
                : 'text-neutral-300 hover:text-white hover:bg-white/[0.05]'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-violet-400" />
            <span className="text-violet-300">Optimizer</span>
          </button>

          <button
            onClick={() => onSelectSection('media-hub')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
              activeSection.startsWith('media-')
                ? 'bg-white/20 text-white shadow-glow-white/10'
                : 'text-neutral-300 hover:text-white hover:bg-white/[0.05]'
            }`}
          >
            <Grid className="w-3.5 h-3.5 text-sky-400" />
            <span className="text-sky-300">Media Tools</span>
          </button>

          <button
            onClick={onOpenPhilosophy}
            className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-neutral-300 hover:text-white hover:bg-white/[0.05] transition-all flex items-center gap-1.5"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-emerald-300">Fair Use & Quality</span>
          </button>
        </div>

        {/* Right Status */}
        <div className="flex items-center gap-3">
          {hasActiveVideo && (
            <button
              onClick={onReset}
              className="text-xs text-neutral-400 hover:text-neutral-200 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/[0.06] hover:bg-white/[0.04] transition-all"
              title="Start with new video"
            >
              <RefreshCw className="w-3 h-3" />
              New Video
            </button>
          )}

          {/* Hardware status pill */}
          <button
            onClick={onOpenHardware}
            className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium bg-neutral-900 border border-white/[0.08] hover:border-white/40 transition-all text-neutral-300 shadow-sm"
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
            </span>
            <span className="font-mono text-[11px] truncate max-w-[130px] sm:max-w-none">
              {hardware?.hasNvidiaGpu ? (
                <>NVENC: {hardware.gpuName?.split(' ')[0] || 'GPU'}</>
              ) : (
                <>CPU ({hardware?.cpuCores || 8}C)</>
              )}
            </span>
          </button>
        </div>
      </div>
    </header>
  );
};

