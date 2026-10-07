export interface MediaFormatOption {
  id: string;
  type: 'video' | 'audio' | 'image';
  format: string; // 'mp4', 'mp3', 'm4a', 'wav', 'flac', 'jpg', 'png', 'webp'
  qualityLabel: string; // 'Original', '1080p', '720p', '320 kbps', 'Lossless FLAC', etc.
  resolution?: string; // '1920x1080'
  fps?: number;
  bitrateKbps?: number;
  filesizeEstimateBytes?: number;
  isLossless?: boolean;
  directDownloadUrl?: string;
  notes?: string;
}

export interface SoundCloudTrackInfo {
  title: string;
  url: string;
  creator?: string;
  duration?: number;
  thumbnail?: string;
}

export interface MediaAnalysisResult {
  sourceUrl: string;
  platform: 'youtube' | 'soundcloud' | 'pinterest' | 'tiktok' | 'direct' | 'generic';
  title: string;
  creator?: string;
  duration?: number; // seconds
  thumbnail?: string;
  mediaType: 'video' | 'audio' | 'image' | 'mixed';
  width?: number;
  height?: number;
  fps?: number;
  codec?: string;
  bitrate?: number; // bps
  audioBitrate?: number; // bps
  audioCodec?: string;
  audioSampleRate?: number;
  downloadAuthorized: boolean;
  authorizedNotice?: string;
  availableFormats: MediaFormatOption[];
  rawSourceUrl?: string;
  copyrightNotice?: string;
  tracks?: SoundCloudTrackInfo[];
}

export interface IMediaProvider {
  id: string;
  displayName: string;
  matches(url: string): boolean;
  analyze(url: string): Promise<MediaAnalysisResult>;
  getAuthorizedDownloadUrl?(url: string, formatId: string): Promise<string | null>;
}
