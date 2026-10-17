import type { JobConfig } from '../types';

/**
 * Full configuration for an export preset.
 *
 * Selecting a preset used to send only the preset id while resolution/FPS
 * options stayed at whatever was configured before, so "YouTube 4K" could
 * still render a 1080×1920 TikTok canvas — the 4K choice never reached the
 * pipeline. Preset clicks now apply the matching resolution/FPS/motion values
 * together with the preset itself.
 */
export function configForPreset(preset: string): Partial<JobConfig> {
  switch (preset) {
    // Vertical 9:16 social presets — TikTok/Reels/Shorts only accept up to
    // 1080×1920 uploads, so these always export 1080×1920 at 60 FPS even when
    // the source is 4K (the 4K source still goes through the full-quality pipeline).
    case 'tiktok':
    case 'tiktok_4k':
    case 'reels':
    case 'shorts':
      return {
        preset: preset as JobConfig['preset'],
        targetResolution: 'tiktok_1080x1920',
        targetFps: 60,
        motion: '60fps',
        aspectRatioStrategy: 'blur_background',
      };
    // Landscape/native 4K export: keep the source framing at full resolution
    // (use this for YouTube/archive — TikTok rejects 4K uploads).
    case 'youtube_4k':
      return {
        preset: 'youtube_4k',
        targetResolution: '4k',
        targetFps: 60,
        motion: '60fps',
        aspectRatioStrategy: 'preserve',
      };
    default:
      return { preset: preset as JobConfig['preset'] };
  }
}

/**
 * The preset the smart recommendation applies for a source: a 4K landscape
 * source keeps its resolution (YouTube 4K); everything else — including 4K
 * vertical sources — exports the platform-ready 1080×1920 at 60 FPS, because
 * TikTok/Reels/Shorts only accept 1080-wide uploads.
 */
export function recommendedPresetFor(metadata: { width: number; height: number }): JobConfig['preset'] {
  const isLandscape = metadata.width > metadata.height;
  const is4kSource = metadata.height >= 2160 || metadata.width >= 3840;
  if (is4kSource && isLandscape) {
    return 'youtube_4k';
  }
  return 'tiktok';
}
