import React, { useEffect, useRef, useState } from 'react';
import { Play, Pause, ListMusic, X, Music } from 'lucide-react';
import { playerStore, usePlayer } from '../services/player';

function formatTime(s: number) {
  if (!s || Number.isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export const MusicPlayerBar: React.FC = () => {
  const { tracks, currentId, playing } = usePlayer();
  const current = tracks.find((t) => t.id === currentId) || null;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [progress, setProgress] = useState({ current: 0, duration: 0 });
  const [showList, setShowList] = useState(false);

  useEffect(() => {
    if (!audioRef.current) audioRef.current = new Audio();
    audioRef.current.crossOrigin = 'anonymous';
  }, []);

  // Audio analyser for reactive visualizer
  useEffect(() => {
    if (!playing || !audioRef.current) return;
    try {
      if (!audioCtxRef.current) {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const source = ctx.createMediaElementSource(audioRef.current);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analyser.connect(ctx.destination);
        audioCtxRef.current = ctx;
        analyserRef.current = analyser;
      }
      audioCtxRef.current.resume().catch(() => {});
    } catch {
      // visualizer unavailable
    }
  }, [playing]);

  // Draw visualizer
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      const analyser = analyserRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(217,70,239,0.9)';
      ctx.fillStyle = 'rgba(217,70,239,0.5)';
      if (analyser) {
        const freq = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(freq);
        const bars = 32;
        const step = Math.max(1, Math.floor(freq.length / bars));
        const bw = w / bars;
        for (let i = 0; i < bars; i++) {
          const v = freq[i * step] / 255;
          const bh = Math.max(2, v * h);
          ctx.fillRect(i * bw + 1, h - bh, bw - 2, bh);
        }
        const wave = new Uint8Array(analyser.fftSize);
        analyser.getByteTimeDomainData(wave);
        ctx.beginPath();
        for (let i = 0; i < wave.length; i++) {
          const x = (i / wave.length) * w;
          const y = (wave[i] / 128) * (h / 2);
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
      } else {
        // idle subtle line
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !current) return;
    if (audio.src !== current.url) {
      audio.src = current.url;
      audio.currentTime = 0;
    }
    if (playing) {
      audio.play().catch(() => playerStore.setPlaying(false));
    } else {
      audio.pause();
    }
  }, [current, playing]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setProgress({ current: audio.currentTime, duration: audio.duration || 0 });
    const onMeta = () => setProgress({ current: 0, duration: audio.duration || 0 });
    const onEnd = () => playerStore.setPlaying(false);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('ended', onEnd);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('ended', onEnd);
    };
  }, []);

  if (tracks.length === 0) return null;

  return (
    <div className="fixed bottom-0 inset-x-0 z-50">
      {showList && (
        <div className="mx-auto max-w-3xl mb-2 rounded-2xl border border-white/10 bg-neutral-950/95 backdrop-blur-xl p-3 space-y-1 max-h-64 overflow-y-auto">
          <p className="text-[10px] uppercase tracking-wider text-neutral-500 font-mono px-2">Playlist</p>
          {tracks.map((t) => (
            <button
              key={t.id}
              onClick={() => playerStore.playTrack(t.id)}
              className={`w-full text-left px-3 py-2 rounded-lg text-xs flex items-center gap-2 transition-colors ${
                t.id === currentId ? 'bg-fuchsia-500/15 text-fuchsia-300' : 'text-neutral-300 hover:bg-white/5'
              }`}
            >
              <Music className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{t.title}</span>
              {t.creator && <span className="text-neutral-500 shrink-0">• {t.creator}</span>}
            </button>
          ))}
        </div>
      )}

      <div className="border-t border-white/10 bg-neutral-950/95 backdrop-blur-xl px-4 py-3">
        <div className="max-w-5xl mx-auto flex items-center gap-4">
          <button
            onClick={() => playerStore.toggle()}
            className="w-10 h-10 rounded-full bg-fuchsia-500/20 hover:bg-fuchsia-500/30 border border-fuchsia-500/40 text-fuchsia-300 flex items-center justify-center transition-all shrink-0"
          >
            {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>

          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-white truncate">
              {current?.title || 'Nothing playing'}
            </p>
            {current?.creator && (
              <p className="text-[11px] text-neutral-400 truncate -mt-0.5">{current.creator}</p>
            )}
            <canvas ref={canvasRef} width={600} height={28} className="w-full h-7 rounded-md bg-white/[0.03]" />
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-neutral-500">{formatTime(progress.current)}</span>
              <input
                type="range"
                min={0}
                max={progress.duration || 1}
                step={0.5}
                value={progress.current}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (audioRef.current) audioRef.current.currentTime = v;
                  setProgress((p) => ({ ...p, current: v }));
                }}
                className="flex-1 accent-fuchsia-400 h-1.5 cursor-pointer"
              />
              <span className="text-[10px] font-mono text-neutral-500">{formatTime(progress.duration)}</span>
            </div>
          </div>

          <button
            onClick={() => setShowList((v) => !v)}
            className={`p-2 rounded-lg border text-xs transition-all ${
              showList ? 'bg-fuchsia-500/20 border-fuchsia-500/40 text-fuchsia-300' : 'bg-white/5 border-white/10 text-neutral-300 hover:bg-white/10'
            }`}
            title="Playlist"
          >
            <ListMusic className="w-4 h-4" />
          </button>
          <button
            onClick={() => playerStore.clear()}
            className="p-2 rounded-lg bg-white/5 border border-white/10 text-neutral-400 hover:bg-white/10 hover:text-white text-xs transition-all"
            title="Clear playlist"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
