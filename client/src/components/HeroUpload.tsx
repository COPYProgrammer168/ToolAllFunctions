import React, { useState, useRef, useEffect } from 'react';
import {
  UploadCloud,
  Film,
  PlayCircle,
  ShieldCheck,
  Zap,
  Sparkles,
  AlertCircle,
  MonitorPlay,
  Wand2,
  Layers,
  Gauge,
} from 'lucide-react';

/* ─── 4K Diamond Icon (inline SVG for brand) ─── */
const Icon4K = () => (
  <svg
    viewBox="0 0 48 48"
    className="w-7 h-7"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <defs>
      <linearGradient id="g4k" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
        <stop stopColor="#00f2fe" />
        <stop offset="0.5" stopColor="#7f5af0" />
        <stop offset="1" stopColor="#00b4d8" />
      </linearGradient>
    </defs>
    <rect x="2" y="2" width="44" height="44" rx="12" stroke="url(#g4k)" strokeWidth="2.5" fill="none" />
    <text
      x="24"
      y="31"
      textAnchor="middle"
      fill="url(#g4k)"
      fontFamily="Inter, system-ui, sans-serif"
      fontWeight="900"
      fontSize="20"
      letterSpacing="-1"
    >
      4K
    </text>
  </svg>
);

/* ─── Animated orbit ring (decorative) ─── */
const OrbitRing: React.FC<{ size: number; duration: number; reverse?: boolean; opacity?: number }> = ({
  size,
  duration,
  reverse,
  opacity = 0.08,
}) => (
  <div
    className="absolute rounded-full border pointer-events-none"
    style={{
      width: size,
      height: size,
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      borderColor: `rgba(0, 242, 254, ${opacity})`,
      animation: `orbitSpin ${duration}s linear infinite ${reverse ? 'reverse' : ''}`,
    }}
  />
);

interface HeroUploadProps {
  onFileSelect: (file: File) => void;
  onLoadDemo: () => void;
  isAnalyzing: boolean;
  isGeneratingDemo: boolean;
  uploadProgress: number;
}

export const HeroUpload: React.FC<HeroUploadProps> = ({
  onFileSelect,
  onLoadDemo,
  isAnalyzing,
  isGeneratingDemo,
  uploadProgress,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 50);
    return () => clearTimeout(timer);
  }, []);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (validateFile(file)) {
        onFileSelect(file);
      }
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      if (validateFile(file)) {
        onFileSelect(file);
      }
    }
  };

  const validateFile = (file: File): boolean => {
    const validExts = ['.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v'];
    const name = file.name.toLowerCase();
    const isValid = validExts.some((ext) => name.endsWith(ext)) || file.type.startsWith('video/');
    if (!isValid) {
      alert('Please upload a supported video format (MP4, MOV, MKV, WebM, AVI).');
      return false;
    }
    return true;
  };

  if (!mounted) return null;

  return (
    <div className="relative w-full overflow-hidden">
      {/* ─── Background: radial glow + grid ─── */}
      <div className="absolute inset-0 hero-grid-bg noise-overlay" />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[500px] bg-gradient-radial from-white/8 via-white/5 to-transparent rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-1/4 w-[600px] h-[300px] bg-gradient-radial from-white/6 to-transparent rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 w-full max-w-6xl mx-auto px-4 sm:px-6 pt-8 sm:pt-16 pb-12 sm:pb-20 space-y-14">
        {/* ═══ HERO HEADLINE SECTION ═══ */}
        <div className="text-center space-y-6 max-w-7xl mx-auto">
          {/* Badge pill */}
          <div
            className={`anim-fade-in-up delay-0 inline-flex items-center gap-2.5 px-4 py-2 rounded-full
              bg-gradient-to-r from-studio-900/90 via-studio-850/80 to-studio-900/90
              border border-white/20 anim-glow-pulse`}
          >
            <Icon4K />
            <span className="text-xs font-semibold tracking-wide text-neutral-200">
              Ultra-Sharp Video Enhancement Engine
            </span>
            <span className="ml-1 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest rounded-full bg-white/15 text-white border border-white/20">
              v2.0
            </span>
          </div>

          {/* Main headline with staggered fade-in */}
          <h1 className="text-4xl sm:text-5xl md:text-7xl font-extrabold tracking-tight leading-[1.1]">
            <span className="anim-fade-in-up delay-100 inline-block text-violet-300">
              Crystal Clear.
            </span>
            <br className="hidden sm:inline" />
            <span className="anim-fade-in-up delay-300 inline-block">
              <span
                className="anim-text-shimmer bg-gradient-to-r from-sky-300 via-violet-300 via-fuchsia-300 to-sky-300 bg-clip-text text-transparent"
                style={{ backgroundSize: '200% auto' }}
              >
                Buttery Smooth.
              </span>
            </span>
            <br className="hidden sm:inline" />
            <span className="anim-fade-in-up delay-500 inline-block text-fuchsia-300">
              4K Ready.
            </span>
          </h1>

          {/* Sub-headline */}
          <p className="anim-fade-in-up delay-600 text-base sm:text-lg md:text-xl text-neutral-400 max-w-2xl mx-auto leading-relaxed">
            Sharpen, upscale, smooth to 60 FPS — make every pixel count.
            <br className="hidden sm:inline" />
            <span className="text-neutral-300 font-medium">Zero quality loss. Ready to post.</span>
          </p>

          {/* Quick stat chips */}
          <div className="anim-fade-in-up delay-700 flex flex-wrap items-center justify-center gap-3">
            {[
              { icon: Gauge, label: '4K Upscale', color: 'text-sky-400' },
              { icon: Zap, label: '60 FPS Smooth', color: 'text-emerald-400' },
              { icon: Wand2, label: 'AI Sharpen', color: 'text-violet-400' },
              { icon: ShieldCheck, label: 'Zero Loss', color: 'text-amber-400' },
            ].map((chip) => (
              <div
                key={chip.label}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/[0.03] border border-white/[0.06]
                  hover:border-white/30 hover:bg-white/5 transition-all duration-300 group cursor-default`}
              >
                <chip.icon className={`w-3.5 h-3.5 ${chip.color} group-hover:scale-110 transition-transform`} />
                <span className="text-xs font-medium text-neutral-300">{chip.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ═══ UPLOAD BOX ═══ */}
        <div className="anim-scale-in delay-800 relative group max-w-3xl mx-auto">
          {/* Ambient glow behind the box */}
          <div className="absolute -inset-2 bg-gradient-to-r from-white/15 via-white/15 to-white/15 rounded-3xl blur-2xl opacity-50 group-hover:opacity-100 transition-all duration-700 -z-10" />

          {/* Orbit decorations */}
          <OrbitRing size={580} duration={25} opacity={0.06} />
          <OrbitRing size={460} duration={18} reverse opacity={0.04} />

          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => !isAnalyzing && !isGeneratingDemo && fileInputRef.current?.click()}
            className={`relative overflow-hidden rounded-2xl glass-panel anim-border-glow transition-all duration-300 p-8 sm:p-14 text-center cursor-pointer ${
              isDragOver
                ? 'border-white bg-studio-850/90 shadow-glow-white'
                : 'border-white/10 hover:border-white/40 hover:bg-studio-900/70'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*,.mkv,.mp4,.mov,.webm,.avi"
              onChange={handleFileInput}
              className="hidden"
              disabled={isAnalyzing || isGeneratingDemo}
            />

            {isAnalyzing || isGeneratingDemo ? (
              /* ─── Analyzing state ─── */
              <div className="py-8 space-y-5">
                <div className="relative w-20 h-20 mx-auto">
                  <div className="absolute inset-0 rounded-full border-2 border-white/20 border-t-white animate-spin" />
                  <div
                    className="absolute inset-2 rounded-full border-2 border-white/20 border-b-neutral-300 animate-spin"
                    style={{ animationDirection: 'reverse', animationDuration: '1.5s' }}
                  />
                  <div
                    className="absolute inset-4 rounded-full border border-white/15 border-l-neutral-300 animate-spin"
                    style={{ animationDuration: '2s' }}
                  />
                  <MonitorPlay className="w-6 h-6 text-white absolute inset-0 m-auto" />
                </div>
                <div className="space-y-1.5">
                  <h3 className="text-lg font-bold text-white">
                    {isGeneratingDemo ? 'Generating demo clip...' : 'Analyzing video stream...'}
                  </h3>
                  <p className="text-xs text-neutral-400 font-mono">
                    {isAnalyzing && uploadProgress > 0 && uploadProgress < 100
                      ? `Uploading: ${uploadProgress}%`
                      : 'Extracting codec, bitrate, motion vectors, color space...'}
                  </p>
                </div>
                {uploadProgress > 0 && uploadProgress < 100 && (
                  <div className="w-56 mx-auto bg-studio-800 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-white to-neutral-300 h-full transition-all duration-200"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                )}
              </div>
            ) : (
              /* ─── Default upload state ─── */
              <div className="space-y-6">
                {/* Icon container with glow */}
                <div className="relative w-24 h-24 mx-auto flex items-center justify-center rounded-3xl bg-gradient-to-br from-white/15 via-white/10 to-white/15 border border-white/25 shadow-glow-white group-hover:scale-105 transition-transform duration-500">
                  <UploadCloud className="w-11 h-11 text-sky-400 group-hover:text-sky-300 transition-colors duration-300" />
                  <div className="absolute inset-0 rounded-3xl bg-white/8 blur-lg -z-10" />
                  {/* Floating particles */}
                  <div className="absolute -top-2 -right-2 w-3 h-3 rounded-full bg-white/40 anim-float" />
                  <div className="absolute -bottom-1 -left-3 w-2 h-2 rounded-full bg-neutral-300/40 anim-float" style={{ animationDelay: '1s' }} />
                  <div className="absolute top-1/2 -right-4 w-1.5 h-1.5 rounded-full bg-neutral-300/30 anim-float" style={{ animationDelay: '2s' }} />
                </div>

                <div className="space-y-2">
                  <h3 className="text-xl sm:text-2xl font-bold text-sky-300 tracking-tight">
                    Drop your video here
                  </h3>
                  <p className="text-sm text-neutral-400">
                    or{' '}
                    <span className="text-white hover:text-white underline underline-offset-4 decoration-white/30 font-medium transition-colors">
                      browse files
                    </span>{' '}
                    to start optimizing
                  </p>
                </div>

                {/* Format tags */}
                <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                  {['MP4', 'MOV', 'MKV', 'WebM', 'AVI'].map((ext, i) => (
                    <span
                      key={ext}
                      className={`px-3 py-1.5 text-[11px] font-mono font-semibold rounded-lg bg-white/[0.04] border border-white/[0.07] hover:border-white/20 transition-all duration-200 ${
                        ['text-sky-300', 'text-emerald-300', 'text-violet-300', 'text-amber-300', 'text-rose-300'][i % 5]
                      }`}
                    >
                      .{ext.toLowerCase()}
                    </span>
                  ))}
                  <span className="text-xs text-neutral-500 ml-1">• Up to 2 GB</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ═══ DEMO ACTION ═══ */}
        <div className="anim-fade-in-up delay-900 flex flex-col sm:flex-row items-center justify-center gap-4 text-center">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onLoadDemo();
            }}
            disabled={isAnalyzing || isGeneratingDemo}
            className="inline-flex items-center gap-2.5 px-6 py-3 rounded-xl
              bg-gradient-to-r from-studio-900/90 to-studio-850/80
              hover:from-studio-800/90 hover:to-studio-800/80
              border border-white/25 hover:border-white/50
              text-sm font-medium text-neutral-200 hover:text-white
              transition-all duration-300 shadow-sm group"
          >
            <PlayCircle className="w-4.5 h-4.5 text-white group-hover:scale-110 transition-transform" />
            <span>
              No video?{' '}
              <strong className="text-white font-bold">Try a sample clip</strong>
            </span>
          </button>
        </div>

        {/* ═══ FEATURE CARDS ═══ */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-2">
          {[
            {
              icon: Film,
              title: 'Analyze First',
              desc: 'Scans 18+ stream parameters before processing — no blind re-encoding.',
              color: 'text-sky-400',
              titleColor: 'text-sky-300',
              delay: 'delay-1000',
            },
            {
              icon: ShieldCheck,
              title: 'Preserve Quality',
              desc: 'Single-pass pipeline eliminates generational loss. Your source stays pristine.',
              color: 'text-emerald-400',
              titleColor: 'text-emerald-300',
              delay: 'delay-1100',
            },
            {
              icon: Layers,
              title: 'True 60 FPS',
              desc: 'Bidirectional motion estimation generates real intermediate frames.',
              color: 'text-violet-400',
              titleColor: 'text-violet-300',
              delay: 'delay-1200',
            },
            {
              icon: Sparkles,
              title: 'Social Ready',
              desc: 'Smart 9:16 canvas, 48 kHz AAC, H.264 profile — optimized for TikTok & Reels.',
              color: 'text-amber-400',
              titleColor: 'text-amber-300',
              delay: 'delay-1300',
            },
          ].map((card) => (
            <div
              key={card.title}
              className={`anim-card-reveal ${card.delay} glass-panel p-5 rounded-2xl border border-white/[0.06] space-y-3
                hover:border-white/20 hover:bg-white/[0.03] transition-all duration-300 group`}
            >
              <div
                className={`w-10 h-10 rounded-xl bg-white/10 border border-white/15
                  flex items-center justify-center ${card.color}
                  group-hover:scale-110 group-hover:shadow-lg transition-all duration-300`}
              >
                <card.icon className="w-5 h-5" />
              </div>
              <h4 className={`text-sm font-bold ${card.titleColor} tracking-tight`}>{card.title}</h4>
              <p className="text-xs text-neutral-400 leading-relaxed">{card.desc}</p>
            </div>
          ))}
        </div>

        {/* ═══ PRIVACY NOTICE ═══ */}
        <div className="anim-fade-in delay-1400 flex items-center justify-center gap-2 text-xs text-neutral-500 text-center">
          <AlertCircle className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
          <span>Your video is processed in-memory only — never stored or shared. No login required.</span>
        </div>
      </div>
    </div>
  );
};







