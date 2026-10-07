export interface VideoMetadata {
  filename: string;
  originalName: string;
  sizeBytes: number;
  formatName: string;
  duration: number; // in seconds
  bitrate: number; // in bps
  width: number;
  height: number;
  fps: number;
  avgFps: number;
  isVfr: boolean; // variable frame rate
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
  overall: number; // 0 - 100
  resolution: number;
  sharpness: number;
  compression: number;
  motion: number;
  color: number;
  audio: number;
}

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

export type ProcessingMode = 'smart' | 'max_quality' | 'fast' | 'preserve_original' | 'custom';
export type ScenarioType = 'realistic' | 'gaming' | 'vlog' | 'low_light';
export type AspectRatioStrategy = 'preserve' | 'fit' | 'crop' | 'smart_crop' | 'blur_background';
export type DetailEnhanceLevel = 'off' | 'soft' | 'natural' | 'sharp' | 'ultra_sharp';
export type DenoiseLevel = 'off' | 'low' | 'medium' | 'high';
export type MotionInterpolation = 'off' | 'smooth' | 'very_smooth' | '60fps';
export type ColorProfile = 'original' | 'natural' | 'vibrant' | 'cinematic';
export type AudioMode = 'original' | 'optimized';

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
  previewDuration?: number; // seconds, e.g. 5
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
