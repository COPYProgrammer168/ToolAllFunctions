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

export interface MediaTrackInfo {
  title: string;
  url: string;
  creator?: string;
  duration?: number;
  thumbnail?: string;
  /** Hint for list UIs (video channels vs audio playlists) */
  mediaType?: 'video' | 'audio';
}

/** @deprecated Use MediaTrackInfo */
export type SoundCloudTrackInfo = MediaTrackInfo;

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
  /** Best muxed (audio+video) stream, if one exists. */
  rawMuxedUrl?: string;
  /** Best adaptive video-only stream URL (needs muxing for full A/V). */
  rawVideoUrl?: string;
  /** Best audio-only stream URL. */
  rawAudioUrl?: string;
  copyrightNotice?: string;
  tracks?: MediaTrackInfo[];
}

export interface IMediaProvider {
  id: string;
  displayName: string;
  matches(url: string): boolean;
  analyze(url: string): Promise<MediaAnalysisResult>;
  getAuthorizedDownloadUrl?(url: string, formatId: string): Promise<string | null>;
}
