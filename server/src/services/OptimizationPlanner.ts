import type { VideoMetadata, JobConfig, ProcessingMode, ScenarioType, AspectRatioStrategy } from '../types/index.js';
import { HardwareDetector } from './HardwareDetector.js';

export interface PlannedPipeline {
  config: JobConfig;
  filters: {
    deblock: boolean;
    deband: boolean;
    denoise: 'off' | 'low' | 'medium' | 'high';
    sharpen: 'off' | 'soft' | 'natural' | 'sharp' | 'ultra_sharp';
    scaleWidth?: number;
    scaleHeight?: number;
    upscalingMethod: 'none' | 'lanczos' | 'spline';
    targetFps: number;
    interpolateMode: 'none' | 'mci' | 'blend';
    aspectRatioStrategy: AspectRatioStrategy;
    colorProfile: 'original' | 'natural' | 'vibrant' | 'cinematic';
    audioNormalization: boolean;
  };
  encoding: {
    videoCodec: string;
    audioCodec: string;
    crf: number;
    videoBitrateKbps: number;
    audioBitrateKbps: number;
    preset: string;
    profile: string;
    level: string;
    pixFmt: string;
  };
  warnings: string[];
  explanation: string;
}

/** Vertical 9:16 canvas presets (TikTok/Reels/Shorts family). */
const VERTICAL_PRESETS = new Set(['tiktok', 'tiktok_4k', 'reels', 'shorts']);

/**
 * Default output resolution implied by each export preset.
 *
 * TikTok/Reels/Shorts only accept up to 1080×1920 uploads, so every social
 * preset (including the legacy `tiktok_4k` id) exports the platform-ready
 * 1080×1920 canvas. True 4K output stays available through `youtube_4k` or an
 * explicit `targetResolution: '4k'`.
 */
const PRESET_RESOLUTION: Partial<Record<JobConfig['preset'], JobConfig['targetResolution']>> = {
  tiktok: 'tiktok_1080x1920',
  reels: 'tiktok_1080x1920',
  shorts: 'tiktok_1080x1920',
  tiktok_4k: 'tiktok_1080x1920',
  youtube_4k: '4k',
};

/**
 * H.264 Annex A levels and their macroblock-per-second budgets. 4K at 60 FPS
 * needs 1,944,000 MB/s (level 5.2); the old hard-coded 4.2 made libx264 reject
 * or mislabel every 4K 60 output.
 */
const H264_LEVEL_MBPS: Array<{ level: string; maxMbps: number }> = [
  { level: '4.1', maxMbps: 245_760 },
  { level: '4.2', maxMbps: 522_240 },
  { level: '5.0', maxMbps: 589_824 },
  { level: '5.1', maxMbps: 983_040 },
  { level: '5.2', maxMbps: 2_073_600 },
  { level: '6.0', maxMbps: 4_177_920 },
  { level: '6.1', maxMbps: 8_355_840 },
  { level: '6.2', maxMbps: 16_711_680 },
];

/** Smallest H.264 level whose macroblock budget supports this output. */
function h264LevelFor(width: number, height: number, fps: number): string {
  const mbPerSec = Math.ceil(width / 16) * Math.ceil(height / 16) * Math.max(1, fps);
  return H264_LEVEL_MBPS.find((l) => mbPerSec <= l.maxMbps)?.level || '6.2';
}

export class OptimizationPlanner {
  public static plan(meta: VideoMetadata, userConfig: Partial<JobConfig>, hasGpu: boolean): PlannedPipeline {
    const mode: ProcessingMode = userConfig.mode || 'smart';
    const scenario: ScenarioType = userConfig.scenario || 'realistic';
    const isLandscape = meta.width > meta.height;

    // Default configuration template
    let config: JobConfig = {
      mode,
      scenario,
      preset: userConfig.preset || 'tiktok',
      // An explicit targetResolution always wins; otherwise the export preset
      // decides (e.g. youtube_4k → 4k, tiktok_4k → 4k, tiktok → 1080×1920).
      targetResolution:
        userConfig.targetResolution ||
        PRESET_RESOLUTION[userConfig.preset || 'tiktok'] ||
        'original',
      targetFps: userConfig.targetFps || 60,
      aspectRatioStrategy: userConfig.aspectRatioStrategy || (isLandscape ? 'blur_background' : 'preserve'),
      detail: userConfig.detail || 'natural',
      denoise: userConfig.denoise || 'low',
      deblocking: userConfig.deblocking !== undefined ? userConfig.deblocking : true,
      debanding: userConfig.debanding !== undefined ? userConfig.debanding : false,
      motion: userConfig.motion || '60fps',
      color: userConfig.color || 'natural',
      audio: userConfig.audio || 'optimized',
      loudnessNormalization: userConfig.loudnessNormalization !== undefined ? userConfig.loudnessNormalization : true,
      isPreview: userConfig.isPreview || false,
      previewDuration: userConfig.previewDuration || 5,
    };

    const warnings: string[] = [];

    // Adjust based on Mode
    if (mode === 'preserve_original') {
      config.targetResolution = 'original';
      config.targetFps = 'original';
      config.detail = 'off';
      config.denoise = 'off';
      config.deblocking = false;
      config.debanding = false;
      config.motion = 'off';
      config.color = 'original';
      config.audio = 'original';
      config.aspectRatioStrategy = 'preserve';
      config.loudnessNormalization = false;
      warnings.push('Preserve Original: Original resolution, framing, and framerate are kept without AI enhancement.');
    } else if (mode === 'fast') {
      config.detail = 'soft';
      config.denoise = 'low';
      config.debanding = false;
      if (meta.fps >= 50) config.motion = 'off';
    } else if (mode === 'max_quality') {
      config.detail = 'sharp';
      config.denoise = 'medium';
      config.deblocking = true;
      config.debanding = true;
      config.motion = '60fps';
    }

    // Scenario specific tuning
    if (scenario === 'gaming') {
      config.denoise = 'off'; // Preserve small UI details & HUD
      config.detail = 'sharp';
      if (config.color === 'natural') config.color = 'vibrant';
    } else if (scenario === 'vlog') {
      config.detail = 'natural'; // Keep skin textures natural
      config.color = 'natural';
    } else if (scenario === 'low_light') {
      config.denoise = 'medium';
      config.deblocking = true;
    }

    // Memory-aware planning: ffmpeg's motion-interpolation filter
    // (`minterpolate`, mi_mode=mci) allocates ~1GB+ per megapixel at 60fps
    // (a 1080p output peaks around 2-3GB). Instances with small memory
    // ceilings — e.g. a 512MB cgroup limit — die with an OOM kill the moment it
    // engages, which crashes the whole service and surfaces as 502s for every
    // pending request. Downgrade to the cheap
    // `blend` interpolation (a few frame buffers, linear streaming) instead.
    const memoryBudgetMB = HardwareDetector.memoryBudgetMB();

    // Determine target dimensions
    let scaleWidth: number | undefined;
    let scaleHeight: number | undefined;
    let upscalingMethod: 'none' | 'lanczos' | 'spline' = 'none';

    const isVerticalPreset = VERTICAL_PRESETS.has(config.preset);

    // A tight memory ceiling also can't survive big upscale targets: 4K encodes
    // hold hundreds of MB of reference/lookahead frames that aren't worth the
    // risk on small instances. Cap the target resolution when RAM is limited.
    if (config.targetResolution === '4k' && memoryBudgetMB <= 4096) {
      config.targetResolution = memoryBudgetMB <= 2048 ? '1080p' : '1440p';
      warnings.push(
        `Output capped at ${config.targetResolution.toUpperCase()} (target was 4K): encoding 4K needs more than the ${memoryBudgetMB}MB this server has available.`
      );
    } else if (config.targetResolution === '1440p' && memoryBudgetMB <= 2048) {
      config.targetResolution = '1080p';
      warnings.push(
        `Output capped at 1080p (target was 1440p): the ${memoryBudgetMB}MB memory budget is too small for larger canvases.`
      );
    }

    if (config.targetResolution === '4k') {
      if (isVerticalPreset) {
        // TikTok 4K and friends always produce a 9:16 vertical canvas.
        scaleWidth = 2160;
        scaleHeight = 3840;
      } else {
        scaleWidth = isLandscape ? 3840 : 2160;
        scaleHeight = isLandscape ? 2160 : 3840;
      }
    } else if (config.targetResolution === 'tiktok_1080x1920' || isVerticalPreset) {
      scaleWidth = 1080;
      scaleHeight = 1920;
    } else if (config.targetResolution === '1440p') {
      scaleWidth = isLandscape ? 2560 : 1440;
      scaleHeight = isLandscape ? 1440 : 2560;
    } else if (config.targetResolution === '1080p') {
      scaleWidth = isLandscape ? 1920 : 1080;
      scaleHeight = isLandscape ? 1080 : 1920;
    } else if (config.targetResolution === '720p') {
      scaleWidth = isLandscape ? 1280 : 720;
      scaleHeight = isLandscape ? 720 : 1280;
    }

    // A target canvas with more pixels than the source is an upscale; compare
    // pixel counts so 9:16 canvases and vertical sources are judged correctly.
    if (scaleWidth && scaleHeight) {
      if (scaleWidth * scaleHeight > Math.max(1, meta.width * meta.height)) {
        upscalingMethod = 'lanczos';
        if (config.targetResolution === '4k') {
          warnings.push('Upscaling to 4K: Output resolution will increase, but original detail cannot be fully recreated.');
        }
      }
    }

    // Peak RSS estimate for full motion-compensated interpolation at this
    // source resolution and target FPS framebuffer rate. minterpolate runs
    // before scaling, so the source resolution decides its memory cost.
    let targetFps = meta.fps;
    const mciPeakMBFor = (fps: number) =>
      Math.round(((meta.width * meta.height) / 1_000_000) * (fps / 60) * 1200);
    const mciAllowedFor = (fps: number) =>
      memoryBudgetMB >= 2048 && mciPeakMBFor(fps) <= memoryBudgetMB * 0.55;
    const mciPeakMB = mciPeakMBFor(60);
    const mciAllowed = mciAllowedFor(60);

    // Determine target FPS & Interpolation
    let interpolateMode: 'none' | 'mci' | 'blend' = 'none';

    if (config.targetFps === 60 || config.motion === '60fps' || config.motion === 'very_smooth') {
      if (meta.fps < 50) {
        targetFps = 60;
        interpolateMode = mciAllowed ? 'mci' : 'blend';
        if (mciAllowed) {
          warnings.push(
            `Frame Interpolation: Synthesizing intermediate frames (${meta.fps} → 60 FPS). Fast erratic motion may show slight blending.`
          );
        } else {
          warnings.push(
            `Motion interpolation downgraded to frame blending: full motion-compensated interpolation needs ~${mciPeakMB}MB but this server only has ${memoryBudgetMB}MB available.`
          );
        }
      } else {
        targetFps = Math.round(meta.fps);
        interpolateMode = 'none';
      }
    } else if (typeof config.targetFps === 'number') {
      targetFps = config.targetFps;
      if (targetFps > meta.fps + 5) {
        interpolateMode = mciAllowedFor(targetFps) ? 'mci' : 'blend';
        if (!mciAllowedFor(targetFps)) {
          warnings.push(
            `Motion interpolation downgraded to frame blending: this server (~${memoryBudgetMB}MB) cannot run motion-compensated interpolation at ${meta.width}×${meta.height}.`
          );
        }
      }
    }

    // Calculate Adaptive Bitrate
    const outputWidth = scaleWidth || meta.width;
    const outputHeight = scaleHeight || meta.height;
    const outPixels = outputWidth * outputHeight;
    let baseBpp = 0.12;
    if (scenario === 'gaming') baseBpp = 0.18;
    if (mode === 'max_quality') baseBpp = 0.16;
    if (mode === 'fast') baseBpp = 0.10;

    let targetBitrateKbps = Math.round((outPixels * targetFps * baseBpp) / 1000);
    // TikTok cap recommendation: ~12,000 - 18,000 kbps for 1080x1920 60fps
    if (scaleWidth === 1080 && scaleHeight === 1920) {
      targetBitrateKbps = Math.min(18000, Math.max(8000, targetBitrateKbps));
    } else if (scaleWidth === 2160 && scaleHeight === 3840) {
      // Vertical 4K 60 FPS (TikTok 4K) — same pixel budget as UHD.
      targetBitrateKbps = Math.min(45000, Math.max(22000, targetBitrateKbps));
    } else if (scaleWidth === 3840 || scaleHeight === 3840) {
      targetBitrateKbps = Math.min(45000, Math.max(22000, targetBitrateKbps));
    } else if (scaleWidth === 2560 || scaleHeight === 2560) {
      targetBitrateKbps = Math.min(30000, Math.max(12000, targetBitrateKbps));
    } else {
      targetBitrateKbps = Math.min(25000, Math.max(5000, targetBitrateKbps));
    }

    // Encoding parameters
    const encoding = {
      videoCodec: 'libx264',
      audioCodec: 'aac',
      crf: mode === 'max_quality' ? 17 : (mode === 'fast' ? 22 : 19),
      videoBitrateKbps: targetBitrateKbps,
      audioBitrateKbps: 256,
      preset: mode === 'fast' ? 'faster' : (mode === 'max_quality' ? 'slow' : 'medium'),
      profile: 'high',
      // H.264 level must cover the output macroblock rate: 4K 60 FPS needs 5.2.
      level: h264LevelFor(outputWidth, outputHeight, targetFps),
      pixFmt: 'yuv420p',
    };

    let explanation = `Pipeline optimized for ${mode.replace('_', ' ')} mode in ${scenario} scenario.`;
    explanation += ` Output canvas: ${outputWidth}x${outputHeight} @ ${targetFps} FPS (H.264 level ${encoding.level}).`;
    if (config.aspectRatioStrategy === 'blur_background' && isLandscape) {
      explanation += ' Applying 9:16 vertical canvas with blurred background fill to preserve entire landscape frame.';
    }

    return {
      config,
      filters: {
        deblock: config.deblocking,
        deband: config.debanding,
        denoise: config.denoise,
        sharpen: config.detail,
        scaleWidth,
        scaleHeight,
        upscalingMethod,
        targetFps,
        interpolateMode,
        aspectRatioStrategy: config.aspectRatioStrategy,
        colorProfile: config.color,
        audioNormalization: config.loudnessNormalization,
      },
      encoding,
      warnings,
      explanation,
    };
  }
}
