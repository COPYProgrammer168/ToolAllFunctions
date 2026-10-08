import React from 'react';
import {
  Sparkles,
  Music,
  CloudLightning,
  Pin,
  Flame,
  Image,
  Video,
  Sliders,
  Scissors,
  Download,
  Settings,
  Grid,
  Box,
} from 'lucide-react';
import type { AppNavSection } from '../types';

const YoutubeIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
  </svg>
);

interface SidebarNavigationProps {
  activeSection: AppNavSection;
  onSelectSection: (section: AppNavSection) => void;
  isOpenMobile: boolean;
  activeJobsCount?: number;
}

export const SidebarNavigation: React.FC<SidebarNavigationProps> = ({
  activeSection,
  onSelectSection,
  isOpenMobile,
  activeJobsCount = 0,
}) => {
  const sections = [
    {
      group: 'STUDIO',
      items: [
        {
          id: 'studio-optimize' as AppNavSection,
          label: 'Optimize Video',
          icon: Sparkles,
          accent: 'text-violet-400',
        },
      ],
    },
    {
      group: 'MEDIA TOOLS',
      items: [
        {
          id: 'media-hub' as AppNavSection,
          label: 'Overview Grid',
          icon: Grid,
          accent: 'text-sky-400',
        },
        {
          id: 'media-video-to-music' as AppNavSection,
          label: 'Video → Music',
          icon: Music,
          accent: 'text-fuchsia-400',
        },
        {
          id: 'media-youtube' as AppNavSection,
          label: 'YouTube Media',
          icon: YoutubeIcon,
          accent: 'text-red-400',
        },
        {
          id: 'media-soundcloud' as AppNavSection,
          label: 'SoundCloud Tracks',
          icon: CloudLightning,
          accent: 'text-orange-400',
        },
        {
          id: 'media-pinterest' as AppNavSection,
          label: 'Pinterest Media',
          icon: Pin,
          accent: 'text-rose-400',
        },
        {
          id: 'media-tiktok' as AppNavSection,
          label: 'TikTok Media',
          icon: Flame,
          accent: 'text-cyan-400',
        },
        {
          id: 'media-images' as AppNavSection,
          label: 'Image Downloader',
          icon: Image,
          accent: 'text-emerald-400',
        },
        {
          id: 'media-videos' as AppNavSection,
          label: 'Video Downloader',
          icon: Video,
          accent: 'text-blue-400',
        },
        {
          id: 'media-audio-converter' as AppNavSection,
          label: 'Audio Converter',
          icon: Sliders,
          accent: 'text-amber-400',
        },
        {
          id: 'media-watermark' as AppNavSection,
          label: 'Remove My Watermark',
          icon: Sparkles,
          accent: 'text-yellow-400',
        },
        {
          id: 'media-outro' as AppNavSection,
          label: 'Remove Ending',
          icon: Scissors,
          accent: 'text-pink-400',
        },
        {
          id: 'media-downloads' as AppNavSection,
          label: 'Download Manager',
          icon: Download,
          accent: 'text-indigo-400',
          badge: activeJobsCount > 0 ? activeJobsCount : undefined,
        },
      ],
    },
    {
      group: 'BLENDER STUDIO',
      items: [
        {
          id: 'blender-3d' as AppNavSection,
          label: 'Blender 3D',
          icon: Box,
          accent: 'text-orange-400',
        },
      ],
    },
    {
      group: 'SETTINGS',
      items: [
        {
          id: 'settings' as AppNavSection,
          label: 'Hardware & Settings',
          icon: Settings,
          accent: 'text-slate-400',
        },
      ],
    },
  ];

  return (
    <nav className={`sticky top-16 z-20 bg-neutral-950/95 backdrop-blur-xl border-b border-white/[0.06] lg:block ${isOpenMobile ? 'block' : 'hidden'}`}>
      <div className="mx-auto px-4 sm:px-6 lg:px-8 py-2 flex flex-col gap-y-3 lg:flex-row lg:flex-wrap lg:gap-x-6 lg:gap-y-2">
        {sections.map((section) => (
          <div key={section.group} className="flex flex-col gap-y-1 lg:flex-row lg:items-center lg:gap-1.5 shrink-0">
            <p className="text-[9px] font-mono font-bold tracking-wider text-neutral-600 uppercase mr-0.5">
              {section.group}
            </p>
            {section.items.map((item) => {
              const Icon = item.icon;
              const isActive = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onSelectSection(item.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 whitespace-nowrap transition-all border ${
                    isActive
                      ? 'bg-gradient-to-r from-white/15 to-neutral-400/10 border-white/20'
                      : 'border-transparent hover:bg-white/[0.05]'
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 ${item.accent}`} />
                  <span className={item.accent}>{item.label}</span>
                  {item.badge !== undefined && (
                    <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold bg-white text-neutral-950">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </nav>
  );
};

