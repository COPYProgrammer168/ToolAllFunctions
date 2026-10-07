export interface VideoMetadata {
  filename: string;
  originalName: string;
  sizeBytes: number;
  formatName: string;
  duration: number;
  bitrate: number;
  width: number;
  height: number;
  fps: number;
  avgFps: number;
  isVfr: boolean;
  codec: string;
  codecLongName: string;
  profile?: string;
  level?: number;
  pixelFormat: string;
  colorSpace?: string;
  colorPrimaries?: string;
  colorTransfer?: string;
  isHdr: boolean;
  aspectRatio: string;
  rotation: number;
  audioCodec?: string;
  audioBitrate?: number;
  audioSampleRate?: number;
  audioChannels?: number;
}

export interface QualityScore {
  overall: number;
  resolution: number;
  sharpness: number;
  compression: number;
  motion: number;
  color: number;
  audio: number;
}

export type ProcessingMode = 'smart' | 'max_quality' | 'fast' | 'preserve_original' | 'custom';
export type ScenarioType = 'realistic' | 'gaming' | 'vlog' | 'low_light';
export type AspectRatioStrategy = 'preserve' | 'fit' | 'crop' | 'smart_crop' | 'blur_background';
export type DetailEnhanceLevel = 'off' | 'soft' | 'natural' | 'sharp' | 'ultra_sharp';
export type DenoiseLevel = 'off' | 'low' | 'medium' | 'high';
export type MotionInterpolation = 'off' | 'smooth' | 'very_smooth' | '60fps';
export type ColorProfile = 'original' | 'natural' | 'vibrant' | 'cinematic';
export type AudioMode = 'original' | 'optimized';

export interface OptimizationReport {
  metadata: VideoMetadata;
  qualityScore: QualityScore;
  detectedProblems: string[];
  recommendations: {
    summary: string;
    details: string[];
    mode: ProcessingMode;
    targetResolution: string;
    targetFps: number;
    upscaleRequired: boolean;
    interpolationRequired: boolean;
    aspectRatioStrategy: AspectRatioStrategy;
  };
}

export interface JobConfig {
  mode: ProcessingMode;
  scenario: ScenarioType;
  preset: 'tiktok' | 'tiktok_4k' | 'youtube_4k' | 'reels' | 'shorts' | 'custom';
  targetResolution: 'original' | '720p' | '1080p' | '1440p' | '4k' | 'tiktok_1080x1920';
  targetFps: 'original' | 24 | 30 | 50 | 60;
  aspectRatioStrategy: AspectRatioStrategy;
  detail: DetailEnhanceLevel;
  denoise: DenoiseLevel;
  deblocking: boolean;
  debanding: boolean;
  motion: MotionInterpolation;
  color: ColorProfile;
  audio: AudioMode;
  loudnessNormalization: boolean;
  isPreview?: boolean;
  previewDuration?: number;
}

export type JobState =
  | 'UPLOADING'
  | 'ANALYZING'
  | 'PLANNING'
  | 'PROCESSING'
  | 'ENHANCING'
  | 'UPSCALING'
  | 'INTERPOLATING'
  | 'ENCODING'
  | 'VALIDATING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface QualityValidationReport {
  passed: boolean;
  inputDuration: number;
  outputDuration: number;
  durationDiffSec: number;
  inputFps: number;
  outputFps: number;
  inputResolution: string;
  outputResolution: string;
  outputCodec: string;
  audioSynced: boolean;
  fileSizeBytes: number;
  warnings: string[];
}

export interface JobProgress {
  state: JobState;
  percent: number;
  stageName: string;
  currentFrame: number;
  totalFrames: number;
  fps: number;
  speed: string;
  timeRemainingSec: number;
  error?: string;
  technicalError?: string;
  outputPath?: string;
  outputUrl?: string;
  outputSize?: number;
  inputSize?: number;
  validationReport?: QualityValidationReport;
  warnings: string[];
}

export interface HardwareInfo {
  hasNvidiaGpu: boolean;
  gpuName?: string;
  encoders: {
    nvenc_h264: boolean;
    nvenc_hevc: boolean;
    qsv_h264: boolean;
    amf_h264: boolean;
    cpu_x264: boolean;
  };
  recommendedEncoder: string;
  cpuCores: number;
  freeMemoryMB: number;
}

// ============================================================================
// MEDIA TOOLKIT CLIENT TYPES
// ============================================================================

export interface MediaFormatOption {
  id: string;
  type: 'video' | 'audio' | 'image';
  format: string;
  qualityLabel: string;
  resolution?: string;
  fps?: number;
  bitrateKbps?: number;
  filesizeEstimateBytes?: number;
  isLossless?: boolean;
  directDownloadUrl?: string;
  notes?: string;
}

export interface MediaAnalysisResult {
  sourceUrl: string;
  platform: 'youtube' | 'soundcloud' | 'pinterest' | 'tiktok' | 'direct' | 'generic';
  title: string;
  creator?: string;
  duration?: number;
  thumbnail?: string;
  mediaType: 'video' | 'audio' | 'image' | 'mixed';
  width?: number;
  height?: number;
  fps?: number;
  codec?: string;
  bitrate?: number;
  audioBitrate?: number;
  audioCodec?: string;
  audioSampleRate?: number;
  downloadAuthorized: boolean;
  authorizedNotice?: string;
  availableFormats: MediaFormatOption[];
  rawSourceUrl?: string;
  copyrightNotice?: string;
  tracks?: { title: string; url: string; creator?: string; duration?: number; thumbnail?: string }[];
}

export type MediaJobType = 'video' | 'audio' | 'image' | 'converter' | 'watermark' | 'outro';
export type MediaJobStatus =
  | 'QUEUED'
  | 'DOWNLOADING'
  | 'CONVERTING'
  | 'COMPLETED'
  | 'PAUSED'
  | 'FAILED'
  | 'CANCELLED';

export interface MediaJobProgress {
  status: MediaJobStatus;
  percent: number;
  downloadedBytes: number;
  totalBytes: number;
  speedBytesPerSec: number;
  speedFormatted: string;
  timeRemainingSec: number;
  stageName: string;
  error?: string;
  technicalError?: string;
}

export interface MediaJobRecord {
  id: string;
  title: string;
  filename: string;
  type: MediaJobType;
  format: string;
  sourceUrl?: string;
  progress: MediaJobProgress;
  createdAt: number;
  hasOutput?: boolean;
}

export interface AudioMetadataTags {
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  year?: string | number;
  trackNumber?: string | number;
  comment?: string;
  artworkPath?: string;
}

export interface DetectedOutro {
  detected: boolean;
  suggestedCutTime: number;
  totalDuration: number;
  outroStartFormatted: string;
  outroEndFormatted: string;
  reason: string;
  confidence: number;
}

export type WatermarkMethod = 'crop' | 'blur' | 'mask' | 'inpaint';

export interface WatermarkRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type AppNavSection =
  | 'studio-optimize'
  | 'media-hub'
  | 'media-video-to-music'
  | 'media-youtube'
  | 'media-soundcloud'
  | 'media-pinterest'
  | 'media-tiktok'
  | 'media-images'
  | 'media-videos'
  | 'media-audio-converter'
  | 'media-watermark'
  | 'media-outro'
  | 'media-downloads'
  | 'blender-3d'
  | 'settings';

