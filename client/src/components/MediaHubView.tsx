import React from 'react';
import {
  Music,
  CloudLightning,
  Pin,
  Flame,
  Image,
  Video,
  Sliders,
  Sparkles,
  Scissors,
  Download,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react';
import type { AppNavSection } from '../types';

const YoutubeIcon: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
  </svg>
);

interface MediaHubViewProps {
  onNavigate: (section: AppNavSection) => void;
}

export const MediaHubView: React.FC<MediaHubViewProps> = ({ onNavigate }) => {
  const tools = [
    {
      id: 'media-video-to-music' as AppNavSection,
      title: 'Video → Music',
      badge: 'Smart Bitrate',
      desc: 'Extract pristine audio tracks from any video with stream-copy and ID3 tags.',
      icon: Music,
      color: 'from-fuchsia-500/20 to-purple-500/10 text-fuchsia-400 border-fuchsia-500/30',
      titleColor: 'text-fuchsia-300',
    },
    {
      id: 'media-youtube' as AppNavSection,
      title: 'YouTube Media',
      badge: 'Authorized Only',
      desc: 'Inspect authorized public streams with strict copyright safeguards and quality checks.',
      icon: YoutubeIcon,
      color: 'from-red-500/20 to-red-400/10 text-red-400 border-red-500/30',
      titleColor: 'text-red-300',
    },
    {
      id: 'media-soundcloud' as AppNavSection,
      title: 'SoundCloud Tracks',
      badge: 'Lossless Aware',
      desc: 'Process artist-authorized downloads with master quality preservation.',
      icon: CloudLightning,
      color: 'from-orange-500/20 to-orange-400/10 text-orange-400 border-orange-500/30',
      titleColor: 'text-orange-300',
    },
    {
      id: 'media-pinterest' as AppNavSection,
      title: 'Pinterest Media',
      badge: 'Image & Video',
      desc: 'Download public pins in full native resolution, convert formats, or send to optimizer.',
      icon: Pin,
      color: 'from-rose-500/20 to-rose-400/10 text-rose-400 border-rose-500/30',
      titleColor: 'text-rose-300',
    },
    {
      id: 'media-tiktok' as AppNavSection,
      title: 'TikTok Media',
      badge: 'Audio / Video',
      desc: 'Authorized short-form downloads and direct handoff to the 60 FPS optimizer.',
      icon: Flame,
      color: 'from-cyan-400/20 to-teal-400/10 text-cyan-400 border-cyan-400/30',
      titleColor: 'text-cyan-300',
    },
    {
      id: 'media-audio-converter' as AppNavSection,
      title: 'Pro Audio Editor',
      badge: 'Waveform & Trims',
      desc: 'Waveform visualizer, precision start/end trimming, fade-in/out, and loudness normalization.',
      icon: Sliders,
      color: 'from-amber-400/20 to-amber-300/10 text-amber-400 border-amber-400/30',
      titleColor: 'text-amber-300',
    },
    {
      id: 'media-images' as AppNavSection,
      title: 'Image Converter',
      badge: 'Lossless Mode',
      desc: 'Inspect public image URLs and convert between JPG, PNG, WebP, and AVIF.',
      icon: Image,
      color: 'from-emerald-400/20 to-emerald-300/10 text-emerald-400 border-emerald-400/30',
      titleColor: 'text-emerald-300',
    },
    {
      id: 'media-videos' as AppNavSection,
      title: 'Video Downloader',
      badge: 'Direct Stream',
      desc: 'Download direct HTTPS video streams with HTTP Range resumability.',
      icon: Video,
      color: 'from-blue-500/20 to-sky-400/10 text-blue-400 border-blue-500/30',
      titleColor: 'text-blue-300',
    },
    {
      id: 'media-watermark' as AppNavSection,
      title: 'Remove My Watermark',
      badge: 'User Content',
      desc: 'Remove your own logo or username with AI inpainting, blurring, or neighboring mask.',
      icon: Sparkles,
      color: 'from-yellow-400/20 to-yellow-300/10 text-yellow-400 border-yellow-400/30',
      titleColor: 'text-yellow-300',
    },
    {
      id: 'media-outro' as AppNavSection,
      title: 'Remove Ending',
      badge: 'Smart Detection',
      desc: 'Auto-detect trailing silence or static end cards and trim with gentle audio fade-out.',
      icon: Scissors,
      color: 'from-pink-400/20 to-pink-300/10 text-pink-400 border-pink-400/30',
      titleColor: 'text-pink-300',
    },
    {
      id: 'media-downloads' as AppNavSection,
      title: 'Download Manager',
      badge: 'Resumable',
      desc: 'Central dashboard to monitor speeds, pause/resume downloads, and manage files.',
      icon: Download,
      color: 'from-indigo-400/20 to-indigo-300/10 text-indigo-400 border-indigo-400/30',
      titleColor: 'text-indigo-300',
    },
  ];

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      {/* Hero Header */}
      <div className="text-center space-y-3">
        <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-violet-500/10 border border-violet-500/30 text-violet-300 text-xs font-semibold uppercase tracking-wider">
          <Sparkles className="w-3.5 h-3.5" />
          Creative Media Ecosystem
        </div>
        <h2 className="text-3xl sm:text-4xl font-extrabold text-violet-300 tracking-tight">
          Media Tools Hub
        </h2>
        <p className="text-sm text-neutral-400 max-w-2xl mx-auto leading-relaxed">
          One connected suite for audio extraction, authorized platform downloads, precision audio editing, watermark removal, and AI video optimization.
        </p>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {tools.map((t) => {
          const Icon = t.icon;
          return (
            <div
              key={t.id}
              onClick={() => onNavigate(t.id)}
              className="glass-panel p-5 rounded-2xl border border-white/[0.08] hover:border-white/30 transition-all duration-300 group cursor-pointer flex flex-col justify-between hover:scale-[1.01] hover:shadow-glow-white/5"
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div
                    className={`w-10 h-10 rounded-xl bg-gradient-to-br ${t.color} border flex items-center justify-center transition-transform group-hover:scale-105`}
                  >
                    <Icon className="w-5 h-5" />
                  </div>
                  <span className="text-[10px] font-mono font-semibold uppercase px-2 py-0.5 rounded bg-white/5 text-neutral-300 border border-white/5">
                    {t.badge}
                  </span>
                </div>

                <div>
                  <h3 className={`text-base font-bold ${t.titleColor} group-hover:opacity-80 transition-colors`}>
                    {t.title}
                  </h3>
                  <p className="text-xs text-neutral-400 leading-relaxed mt-1">{t.desc}</p>
                </div>
              </div>

              <div className="pt-4 mt-3 border-t border-white/5 flex items-center justify-between text-xs font-semibold text-neutral-300 group-hover:text-white">
                <span>Launch Tool</span>
                <ArrowRight className="w-3.5 h-3.5 transform group-hover:translate-x-1 transition-transform" />
              </div>
            </div>
          );
        })}
      </div>

      {/* Philosophy banner */}
      <div className="p-5 rounded-2xl bg-neutral-900/60 border border-white/5 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-6 h-6 text-white shrink-0" />
          <p className="text-xs text-neutral-400 leading-relaxed">
            <span className="text-white font-semibold">Strict Platform Compliance:</span> All media tools only process user-owned or authorized public downloads without DRM circumvention or access bypass.
          </p>
        </div>
        <button
          onClick={() => onNavigate('studio-optimize')}
          className="px-4 py-2 rounded-xl bg-white/20 hover:bg-white/30 border border-white/30 text-white text-xs font-semibold shrink-0 transition-all"
        >
          Open Video Optimizer
        </button>
      </div>
    </div>
  );
};

