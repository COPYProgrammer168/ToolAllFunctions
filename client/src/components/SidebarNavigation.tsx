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
  Search,
  Type,
  FileText,
  Captions,
  QrCode,
  Medal,
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
  /** Backdrop tap sends the user here so the App can close the drawer. */
  onCloseMobile?: () => void;
  activeJobsCount?: number;
}

/** Vertical section list shared by the desktop rail & the mobile drawer. */
const SidebarContent: React.FC<{
  activeSection: AppNavSection;
  onSelectSection: (section: AppNavSection) => void;
  activeJobsCount: number;
}> = ({ activeSection, onSelectSection, activeJobsCount }) => {
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
        {
          id: 'font-studio' as AppNavSection,
          label: 'Font Studio',
          icon: Type,
          accent: 'text-cyan-400',
        },
        {
          id: 'seo-studio' as AppNavSection,
          label: 'SEO & GEO',
          icon: Search,
          accent: 'text-sky-400',
        },
        {
          id: 'pdf-to-word' as AppNavSection,
          label: 'PDF to Word',
          icon: FileText,
          accent: 'text-amber-400',
        },
        {
          id: 'qr-studio' as AppNavSection,
          label: 'QR Studio',
          icon: QrCode,
          accent: 'text-purple-400',
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
          id: 'media-medal-downloader' as AppNavSection,
          label: 'Medal.tv Clips',
          icon: Medal,
          accent: 'text-amber-300',
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
          id: 'media-captions' as AppNavSection,
          label: 'Video Captions',
          icon: Captions,
          accent: 'text-teal-400',
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
    // pb-24 keeps the last group clear of the fixed MusicPlayerBar overlay.
    <nav className="w-full pt-4 pb-24 px-3 space-y-5">
      {sections.map((section) => (
        <div key={section.group} className="space-y-1">
          <p className="px-2.5 text-[9px] font-mono font-bold tracking-wider text-neutral-600 uppercase">
            {section.group}
          </p>
          {section.items.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelectSection(item.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`w-full px-2.5 py-2 rounded-lg text-xs font-medium flex items-center gap-2.5 text-left whitespace-nowrap transition-all border ${
                  isActive
                    ? 'bg-gradient-to-r from-white/15 to-neutral-400/10 border-white/20'
                    : 'border-transparent hover:bg-white/[0.05]'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 shrink-0 ${item.accent}`} />
                <span className={`truncate ${item.accent} ${isActive ? 'font-semibold' : ''}`}>
                  {item.label}
                </span>
                {item.badge !== undefined && (
                  <span className="ml-auto px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-white text-neutral-950 shrink-0">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
};

export const SidebarNavigation: React.FC<SidebarNavigationProps> = ({
  activeSection,
  onSelectSection,
  isOpenMobile,
  onCloseMobile,
  activeJobsCount = 0,
}) => (
  <>
    {/* Mobile backdrop — tapping outside closes the drawer */}
    <div
      onClick={onCloseMobile}
      aria-hidden="true"
      className={`fixed inset-0 z-30 bg-black/70 backdrop-blur-sm lg:hidden transition-opacity duration-300 ${
        isOpenMobile ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
    />

    {/* Mobile drawer — slides in from the left */}
    <aside
      className={`fixed inset-y-0 left-0 z-40 w-72 overflow-y-auto bg-neutral-950/95 backdrop-blur-xl border-r border-white/[0.06] transition-transform duration-300 lg:hidden ${
        isOpenMobile ? 'translate-x-0 shadow-2xl shadow-black/60' : '-translate-x-full'
      }`}
    >
      <SidebarContent
        activeSection={activeSection}
        onSelectSection={onSelectSection}
        activeJobsCount={activeJobsCount}
      />
    </aside>

    {/* Desktop — permanent vertical rail pinned below the top navbar and to
        the left of the content column (main compensates with lg:pl-64). */}
    <aside className="hidden lg:block fixed top-16 bottom-0 left-0 z-20 w-64 overflow-y-auto bg-neutral-950/95 backdrop-blur-xl border-r border-white/[0.06]">
      <SidebarContent
        activeSection={activeSection}
        onSelectSection={onSelectSection}
        activeJobsCount={activeJobsCount}
      />
    </aside>
  </>
);
