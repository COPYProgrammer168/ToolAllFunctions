export type MedalJobState =
  | 'queued'
  | 'inspecting'
  | 'downloading'
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'download_not_available';

export interface MedalClipReference {
  clipId: string;
  gameSlug?: string;
  /** Normalized clip page URL (apex host, no tracking parameters). */
  canonicalUrl: string;
  /** URL actually requested from Medal, including a validated invite token. */
  requestUrl: string;
}

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

/**
 * Signed CDN details. `mediaUrl` must never be returned to clients or written
 * to logs: it grants temporary access to the original file.
 */
export interface MedalMediaInfo {
  mediaUrl: string;
  contentType: string;
  container: 'mp4';
  sizeBytes?: number;
  acceptRanges: boolean;
}

export interface MedalInspectionInternal {
  clip: MedalClipInfo;
  media?: MedalMediaInfo;
  available: boolean;
  unavailableReason?: string;
  inspectedAt: string;
}

export interface MedalDownloadAvailability {
  available: boolean;
  state: 'available' | 'download_not_available';
  message?: string;
  reason?: string;
  container?: 'mp4';
  contentType?: string;
  sizeBytes?: number;
}

export interface MedalInspectionPublic {
  clip: MedalClipInfo;
  download: MedalDownloadAvailability;
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

export interface MedalJob {
  jobId: string;
  downloadToken: string;
  clientIp: string;
  sourceUrl: string;
  clipId: string;
  state: MedalJobState;
  stage: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  clip?: MedalClipInfo;
  media?: MedalVideoInfo;
  progressPercent: number | null;
  downloadedBytes: number;
  totalBytes: number;
  filename?: string;
  filePath?: string;
  error?: string;
  errorCode?: string;
  message?: string;
  cancelled: boolean;
}

export interface MedalJobPublic {
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
