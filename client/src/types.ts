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
  /** Adaptive video-only stream URL (muxed with audioUrl server-side when set). */
  videoUrl?: string;
  /** Adaptive audio-only stream URL — the muxing partner of videoUrl. */
  audioUrl?: string;
  /** Segmented HLS manifest URLs — downloaded via ffmpeg when set. */
  hlsVideoUrl?: string;
  hlsAudioUrl?: string;
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
  /** Best muxed (audio+video) stream, if one exists. */
  rawMuxedUrl?: string;
  /** Best adaptive video-only stream URL. */
  rawVideoUrl?: string;
  /** Best audio-only stream URL. */
  rawAudioUrl?: string;
  copyrightNotice?: string;
  tracks?: {
    title: string;
    url: string;
    creator?: string;
    duration?: number;
    thumbnail?: string;
    mediaType?: 'video' | 'audio';
    /** Platform track id (present for SoundCloud playlists). */
    id?: number;
    /** Set when the track is listed but not downloadable (private, region-blocked). */
    unavailable?: string;
  }[];
  /** Full size of a listing, used for the "TRACKS (55)" header. */
  totalTracks?: number;
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

// ============================================================================
// CAPTION / SUBTITLE GENERATION TYPES
// ============================================================================

export interface CaptionCue {
  /** Start time in seconds. */
  start: number;
  /** End time in seconds. */
  end: number;
  text: string;
}

export interface CaptionGenerationResponse {
  success: boolean;
  /** Which engine produced the captions. */
  source: 'youtube' | 'yt-dlp' | 'whisper';
  /** Human-readable engine detail, e.g. "Whisper local transcription (base model)". */
  engineDetail: string;
  language: string;
  title?: string;
  durationSec?: number;
  cueCount: number;
  cues: CaptionCue[];
  srt: string;
  vtt: string;
  txt: string;
  downloads: {
    srt: string;
    vtt: string;
    txt: string;
  };
  notices: string[];
}

export interface CaptionEnginesStatus {
  platformCaptions: boolean;
  ytDlp: boolean;
  whisper: boolean;
}

/* ─── SEO / GEO website analyzer ─── */

export interface SeoKeyword {
  term: string;
  count: number;
  /** 0-100 relative importance (the top keyword = 100). */
  score: number;
  inTitle: boolean;
  inHeadings: boolean;
}

export interface SeoPageInfo {
  title: string;
  metaDescription: string;
  metaKeywords: string;
  language: string;
  h1: string[];
  h2: string[];
  h3: string[];
  wordCount: number;
  imageCount: number;
  imagesMissingAlt: number;
  internalLinks: number;
  externalLinks: number;
  hasCanonical: boolean;
  hasOpenGraph: boolean;
  hasTwitterCard: boolean;
  hasStructuredData: boolean;
  openGraph: {
    title?: string;
    description?: string;
    image?: string;
    type?: string;
  };
}

export interface SeoCaptionDraft {
  platform: string;
  label: string;
  text: string;
}

export interface SeoReport {
  url: string;
  finalUrl: string;
  siteName: string;
  fetchedAt: string;
  page: SeoPageInfo;
  seoKeywords: SeoKeyword[];
  geoKeywords: string[];
  geoQuestions: string[];
  h1Suggestions: string[];
  metaDescriptions: string[];
  hashtags: string[];
  metaKeywordTags: string[];
  captions: SeoCaptionDraft[];
  issues: string[];
  notices: string[];
  /** Present when the analysis ran in whole-site mode. */
  site?: SeoSiteAudit;
}

export type SeoAnalyzeScope = 'page' | 'site';

export interface SeoPageAudit {
  url: string;
  title: string;
  metaDescription: string;
  h1Count: number;
  wordCount: number;
  issueCount: number;
  issues: string[];
}

export interface SeoDuplicateGroup {
  value: string;
  urls: string[];
}

export interface SeoSiteAudit {
  pageCount: number;
  pages: SeoPageAudit[];
  duplicateTitles: SeoDuplicateGroup[];
  duplicateDescriptions: SeoDuplicateGroup[];
  siteKeywords: SeoKeyword[];
  totals: {
    issuePages: number;
    missingTitles: number;
    missingDescriptions: number;
    missingH1: number;
    multipleH1: number;
    thinPages: number;
  };
  notices: string[];
}

/* ─── Sitemap generator ─── */

export interface SitemapPage {
  loc: string;
  title: string;
  lastmod?: string;
  priority: number;
  depth: number;
}

export interface SitemapExisting {
  robotsFound: boolean;
  robotsUrl: string;
  sitemapLinks: string[];
}

export interface SitemapReport {
  url: string;
  site: string;
  origin: string;
  generatedAt: string;
  /** Where the generated file should live once uploaded. */
  sitemapUrl: string;
  existing: SitemapExisting;
  pages: SitemapPage[];
  xml: string;
  robotsSnippet: string;
  downloads: { xml: string; robots: string };
  notices: string[];
}

/* ─── Medal.tv downloader ─── */

export type MedalJobState =
  | 'queued'
  | 'inspecting'
  | 'downloading'
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'download_not_available';

export interface MedalClipInfo {
  clipId: string;
  gameSlug?: string;
  gameName?: string;
  title: string;
  creator?: string;
  durationSeconds?: number;
  thumbnailUrl?: string;
  uploadedAt?: string;
  canonicalUrl: string;
}

export interface MedalInspection {
  clip: MedalClipInfo;
  download: {
    available: boolean;
    state: 'available' | 'download_not_available';
    message?: string;
    reason?: string;
    container?: 'mp4';
    contentType?: string;
    sizeBytes?: number;
  };
  authorizationRequired: true;
  authorizationNotice: string;
  officialWorkflowUrl: string;
  officialWorkflowLabel: string;
  inspectedAt: string;
}

export interface MedalVideoInfo {
  container: string;
  videoCodec: string;
  audioCodec?: string;
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  sizeBytes: number;
}

export interface MedalJobStatus {
  jobId: string;
  state: MedalJobState;
  stage: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  clip?: MedalClipInfo;
  media?: MedalVideoInfo;
  progress: {
    /** Real percentage only; `null` when the upstream size is unknown. */
    percent: number | null;
    downloadedBytes: number;
    totalBytes: number;
  };
  filename?: string;
  downloadUrl?: string;
  error?: string;
  errorCode?: string;
  message?: string;
}

export type AppNavSection =
  | 'studio-optimize'
  | 'seo-studio'
  | 'font-studio'
  | 'qr-studio'
  | 'pdf-to-word'
  | 'media-hub'
  | 'media-medal-downloader'
  | 'media-video-to-music'
  | 'media-youtube'
  | 'media-soundcloud'
  | 'media-pinterest'
  | 'media-tiktok'
  | 'media-images'
  | 'media-videos'
  | 'media-audio-converter'
  | 'media-captions'
  | 'media-watermark'
  | 'media-outro'
  | 'media-downloads'
  | 'settings';

