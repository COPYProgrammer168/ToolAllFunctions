import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, Minus, Plus } from 'lucide-react';

interface ComparisonViewerProps {
  srcOriginal: string;
  srcOptimized: string;
}

export const ComparisonViewer: React.FC<ComparisonViewerProps> = ({ srcOriginal, srcOptimized }) => {
  const [sliderPos, setSliderPos] = useState(50);
  const [isPlaying, setIsPlaying] = useState(false);
  const [zoom, setZoom] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const x = clientX - rect.left;
    const pct = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setSliderPos(pct);
  };

  useEffect(() => {
    const orig = document.getElementById('comp-video-original') as HTMLVideoElement | null;
    const opt = document.getElementById('comp-video-optimized') as HTMLVideoElement | null;
    if (!orig || !opt) return;

    const sync = () => {
      if (isPlaying) {
        opt.currentTime = orig.currentTime;
      }
    };
    orig.addEventListener('timeupdate', sync);
    orig.addEventListener('seeked', () => { opt.currentTime = orig.currentTime; });

    return () => {
      orig.removeEventListener('timeupdate', sync);
    };
  }, [isPlaying]);

  const togglePlay = () => {
    const orig = document.getElementById('comp-video-original') as HTMLVideoElement | null;
    const opt = document.getElementById('comp-video-optimized') as HTMLVideoElement | null;
    if (!orig || !opt) return;

    if (isPlaying) {
      orig.pause();
      opt.pause();
    } else {
      orig.play();
      opt.play();
    }
    setIsPlaying(!isPlaying);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={togglePlay}
            className="p-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-white transition-all"
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
          <span className="text-xs text-neutral-400 font-mono">
            {isPlaying ? 'Playing' : 'Paused'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setZoom((z) => Math.max(1, z - 1))}
            className="p-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-neutral-300 transition-all"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <span className="text-xs font-mono text-neutral-400 w-12 text-center">{zoom}×</span>
          <button
            onClick={() => setZoom((z) => Math.min(8, z + 1))}
            className="p-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-neutral-300 transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        onMouseMove={handleMove}
        onTouchMove={handleMove}
        className="relative w-full aspect-video bg-black rounded-2xl overflow-hidden border border-white/10 cursor-ew-resize select-none"
        style={{ touchAction: 'none' }}
      >
        {/* Original (left side) */}
        <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}>
          <video
            id="comp-video-original"
            src={srcOriginal}
            className="w-full h-full object-contain"
            style={{ transform: `scale(${zoom})`, transformOrigin: 'center center' }}
            playsInline
            muted
          />
          <div className="absolute top-3 left-3 px-2 py-1 rounded-lg bg-black/60 text-[10px] font-mono text-neutral-300 border border-white/10">
            ORIGINAL
          </div>
        </div>

        {/* Optimized (right side) */}
        <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${sliderPos}%)` }}>
          <video
            id="comp-video-optimized"
            src={srcOptimized}
            className="w-full h-full object-contain"
            style={{ transform: `scale(${zoom})`, transformOrigin: 'center center' }}
            playsInline
            muted
          />
          <div className="absolute top-3 right-3 px-2 py-1 rounded-lg bg-white/20 text-[10px] font-mono text-white border border-white/30">
            OPTIMIZED
          </div>
        </div>

        {/* Slider handle */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-white/80 shadow-lg pointer-events-none"
          style={{ left: `${sliderPos}%` }}
        >
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white shadow-xl flex items-center justify-center">
            <div className="w-1 h-4 flex gap-0.5">
              <div className="w-0.5 h-full bg-neutral-800 rounded-full" />
              <div className="w-0.5 h-full bg-neutral-800 rounded-full" />
            </div>
          </div>
        </div>
      </div>

      <p className="text-[11px] text-neutral-500 text-center">Drag the divider to compare original vs optimized. Use zoom for pixel-level inspection.</p>
    </div>
  );
};

