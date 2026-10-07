import React from 'react';
import {
  CloudLightning,
  Pin,
  Flame,
  Image,
  Video,
  ShieldAlert,
} from 'lucide-react';
import type { AppNavSection, MediaFormatOption } from '../types';
import { UniversalMediaInput } from './UniversalMediaInput';

const YoutubeIcon: React.FC<{ className?: string }> = ({ className = 'w-3.5 h-3.5' }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
  </svg>
);

interface PlatformMediaViewProps {
  section: AppNavSection;
  onSendToOptimizer?: (urlOrPath: string, title: string) => void;
  onDirectDownload?: (format: MediaFormatOption) => void;
  onJobStarted?: (jobId: string, filename: string) => void;
}

export const PlatformMediaView: React.FC<PlatformMediaViewProps> = ({
  section,
  onSendToOptimizer,
  onDirectDownload,
  onJobStarted,
}) => {
  const getPlatformDetails = () => {
    switch (section) {
      case 'media-youtube':
        return {
          title: 'YouTube Media',
          icon: YoutubeIcon,
          color: 'text-red-400 bg-red-500/10 border-red-500/30',
          desc: 'Inspect authorized/publicly downloadable media links. 320 kbps MP3 export available with fidelity notices.',
          legalNotice:
            'YouTube streams are subject to platform terms. This tool does not bypass DRM or authentication. Only authorized media can be downloaded.',
          filter: 'youtube' as const,
        };
      case 'media-soundcloud':
        return {
          title: 'SoundCloud Media',
          icon: CloudLightning,
          color: 'text-orange-400 bg-orange-500/10 border-orange-500/30',
          desc: 'Inspect track metadata, artist credits, and authorized downloads. Lossless FLAC offered only when uploaded as master.',
          legalNotice:
            'Only tracks where the artist has explicitly enabled direct downloads can be downloaded.',
          filter: 'soundcloud' as const,
        };
      case 'media-pinterest':
        return {
          title: 'Pinterest Media',
          icon: Pin,
          color: 'text-rose-400 bg-rose-500/10 border-rose-500/30',
          desc: 'Download public pin images and videos. Convert images to JPG, PNG, or WebP without recompressing Original.',
          legalNotice:
            'Use only for pins you own or have permission to save and optimize.',
          filter: 'pinterest' as const,
        };
      case 'media-tiktok':
        return {
          title: 'TikTok Media',
          icon: Flame,
          color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30',
          desc: 'Inspect public short-form content. Download authorized videos or hand off directly to the 60 FPS Video Optimizer.',
          legalNotice:
            'Downloading requires creator authorization. Watermark removal is strictly reserved for your own content.',
          filter: 'tiktok' as const,
        };
      case 'media-images':
        return {
          title: 'Image Downloader & Converter',
          icon: Image,
          color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
          desc: 'Download direct image URLs. Convert between JPG, PNG, WebP, and AVIF while preserving native resolution.',
          legalNotice: 'Verify image licensing before commercial use.',
          filter: 'direct' as const,
        };
      case 'media-videos':
      default:
        return {
          title: 'Universal Video Downloader',
          icon: Video,
          color: 'text-blue-400 bg-blue-500/10 border-blue-500/30',
          desc: 'Download direct video resources with HTTP Range resumability. Send directly to Video Optimizer.',
          legalNotice: 'Only public, authorized direct media streams are supported.',
          filter: 'direct' as const,
        };
    }
  };

  const details = getPlatformDetails();
  const Icon = details.icon;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="text-center space-y-2">
        <div
          className={`inline-flex items-center gap-2 px-3.5 py-1 rounded-full text-xs font-semibold uppercase tracking-wider border ${details.color}`}
        >
          <Icon className="w-3.5 h-3.5" />
          {details.title}
        </div>
        <h2 className={`text-2xl sm:text-3xl font-extrabold ${details.color.split(' ')[0]}`}>{details.title}</h2>
        <p className="text-xs sm:text-sm text-neutral-400 max-w-xl mx-auto">{details.desc}</p>
      </div>

      {/* Legal Platform Notice */}
      <div className="p-4 rounded-2xl bg-neutral-900/80 border border-white/5 flex items-start gap-3 text-xs text-neutral-400 leading-relaxed">
        <ShieldAlert className="w-4 h-4 text-white shrink-0 mt-0.5" />
        <p>
          <span className="text-neutral-200 font-semibold">Platform & Legal Compliance:</span>{' '}
          {details.legalNotice}
        </p>
      </div>

      {/* Universal Input pre-tuned */}
      <UniversalMediaInput
        onSendToOptimizer={onSendToOptimizer}
        onDirectDownload={onDirectDownload}
        onJobStarted={onJobStarted}
        platformFilter={details.filter}
        audioActionLabel="Download"
      />
    </div>
  );
};


