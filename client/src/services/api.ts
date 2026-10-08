import type { OptimizationReport, JobConfig, JobProgress, HardwareInfo } from '../types';

export interface AnalysisResponse {
  report: OptimizationReport;
  tempPath: string;
  originalName: string;
  sizeBytes: number;
}

export async function fetchHardwareInfo(): Promise<HardwareInfo> {
  const res = await fetch('/api/system/hardware');
  if (!res.ok) throw new Error('Failed to fetch hardware status');
  return res.json();
}

export async function analyzeVideoFile(file: File, onUploadProgress?: (percent: number) => void): Promise<AnalysisResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('video', file);

    xhr.open('POST', '/api/video/analyze');

    if (xhr.upload && onUploadProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const percent = Math.round((e.loaded / e.total) * 100);
          onUploadProgress(percent);
        }
      };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          resolve(data);
        } catch {
          reject(new Error('Invalid response from server'));
        }
      } else {
        try {
          const err = JSON.parse(xhr.responseText);
          reject(new Error(err.error || 'Video analysis failed'));
        } catch {
          reject(new Error(`Server error: ${xhr.status}`));
        }
      }
    };

    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(formData);
  });
}

export async function generateDemoVideo(): Promise<AnalysisResponse> {
  const res = await fetch('/api/video/demo', { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to generate demo clip');
  }
  return res.json();
}

export async function createOptimizationJob(params: {
  file?: File | null;
  tempPath?: string | null;
  originalName: string;
  config: Partial<JobConfig>;
}): Promise<{ jobId: string }> {
  const formData = new FormData();
  if (params.file) {
    formData.append('video', params.file);
  }
  if (params.tempPath) {
    formData.append('tempPath', params.tempPath);
  }
  formData.append('originalName', params.originalName);
  formData.append('config', JSON.stringify(params.config));

  const res = await fetch('/api/jobs', {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to start optimization job');
  }

  return res.json();
}

export async function cancelJob(jobId: string): Promise<boolean> {
  const res = await fetch(`/api/jobs/${jobId}/cancel`, { method: 'POST' });
  if (!res.ok) return false;
  const data = await res.json();
  return Boolean(data.success);
}

export function subscribeJobProgress(
  jobId: string,
  onProgress: (progress: JobProgress) => void,
  onError: (err: any) => void
): () => void {
  const eventSource = new EventSource(`/api/jobs/${jobId}/events`);

  eventSource.onmessage = (e) => {
    try {
      const data: JobProgress = JSON.parse(e.data);
      onProgress(data);
    } catch (err) {
      console.error('Error parsing SSE data:', err);
    }
  };

  eventSource.onerror = (e) => {
    onError(e);
  };

  return () => {
    eventSource.close();
  };
}

// ============================================================================
// MEDIA TOOLKIT API CLIENT
// ============================================================================

import type {
  MediaAnalysisResult,
  MediaJobRecord,
  MediaJobProgress,
  AudioMetadataTags,
  DetectedOutro,
  WatermarkMethod,
  WatermarkRegion,
} from '../types';

export async function probeStreamBitrate(sourceUrl: string): Promise<number | null> {
  try {
    const res = await fetch('/api/media/probe-bitrate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceUrl }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || typeof data.bitrateKbps !== 'number') return null;
    return data.bitrateKbps;
  } catch {
    return null;
  }
}

export async function analyzeMediaUrl(url: string): Promise<MediaAnalysisResult> {
  const res = await fetch('/api/media/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to analyze media URL');
  }

  return res.json();
}

export async function startMediaDownload(params: {
  sourceUrl?: string;
  directUrl?: string;
  title?: string;
  type?: string;
  format?: string;
  customBitrate?: number;
  /** Adaptive video-only URL (muxed with audioUrl server-side when present). */
  videoUrl?: string;
  /** Matching audio-only URL, used together with videoUrl. */
  audioUrl?: string;
}): Promise<{ jobId: string; status: string; filename: string }> {
  const res = await fetch('/api/media/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to initiate media download');
  }

  return res.json();
}

export async function fetchMediaJobs(): Promise<MediaJobRecord[]> {
  const res = await fetch('/api/media/jobs');
  if (!res.ok) throw new Error('Failed to fetch media jobs');
  const data = await res.json();
  return data.jobs || [];
}

export function subscribeMediaJobProgress(
  jobId: string,
  onProgress: (progress: MediaJobProgress) => void,
  onError?: (err: any) => void
): () => void {
  const eventSource = new EventSource(`/api/media/jobs/${jobId}/events`);

  eventSource.onmessage = (e) => {
    try {
      const data: MediaJobProgress = JSON.parse(e.data);
      onProgress(data);
    } catch (err) {
      console.error('Error parsing SSE media job:', err);
    }
  };

  eventSource.onerror = (e) => {
    if (onError) onError(e);
  };

  return () => {
    eventSource.close();
  };
}

export async function pauseMediaJob(jobId: string): Promise<boolean> {
  const res = await fetch(`/api/media/jobs/${jobId}/pause`, { method: 'POST' });
  return res.ok;
}

export async function resumeMediaJob(jobId: string): Promise<boolean> {
  const res = await fetch(`/api/media/jobs/${jobId}/resume`, { method: 'POST' });
  return res.ok;
}

export async function cancelMediaJob(jobId: string): Promise<boolean> {
  const res = await fetch(`/api/media/jobs/${jobId}/cancel`, { method: 'POST' });
  return res.ok;
}

export async function deleteMediaJob(jobId: string): Promise<boolean> {
  const res = await fetch(`/api/media/jobs/${jobId}`, { method: 'DELETE' });
  return res.ok;
}

export async function extractAudio(params: {
  tempPath: string;
  format?: string;
  bitrate?: number;
  preferStreamCopy?: boolean;
  metadata?: AudioMetadataTags;
}): Promise<{
  success: boolean;
  outputPath: string;
  downloadUrl: string;
  fileSizeBytes: number;
  sourceBitrateKbps: number;
  outputBitrateKbps: number;
  isStreamCopy: boolean;
  qualityNotice?: string;
}> {
  const res = await fetch('/api/audio/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to extract audio');
  }

  return res.json();
}

export async function convertAudio(params: {
  tempPath: string;
  format?: string;
  startSec?: number;
  endSec?: number;
  fadeInSec?: number;
  fadeOutSec?: number;
  volumeMultiplier?: number;
  normalizeLoudness?: boolean;
  bitrateKbps?: number;
}): Promise<{
  success: boolean;
  outputPath: string;
  downloadUrl: string;
  fileSizeBytes: number;
  duration: number;
}> {
  const res = await fetch('/api/audio/convert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to convert audio');
  }

  return res.json();
}

export async function fetchAudioWaveform(filePath: string): Promise<number[]> {
  const res = await fetch('/api/audio/waveform', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filePath }),
  });

  if (!res.ok) return Array(100).fill(0.3);
  const data = await res.json();
  return data.peaks || [];
}

export async function detectOutro(filePath: string): Promise<DetectedOutro> {
  const res = await fetch('/api/media/detect-outro', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filePath }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Outro detection failed');
  }

  return res.json();
}

export async function trimEnding(params: {
  filePath: string;
  cutTimeSec: number;
  applyFadeOut?: boolean;
}): Promise<{
  success: boolean;
  outputPath: string;
  downloadUrl: string;
  outputDuration: number;
}> {
  const res = await fetch('/api/media/trim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Trimming failed');
  }

  return res.json();
}

export async function removeWatermark(params: {
  filePath: string;
  method: WatermarkMethod;
  region: WatermarkRegion;
  blurStrength?: number;
}): Promise<{
  success: boolean;
  outputPath: string;
  downloadUrl: string;
  legalNotice: string;
  qualityDisclaimer: string;
}> {
  const res = await fetch('/api/user-content/watermark/remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Watermark removal failed');
  }

  return res.json();
}

export async function sendMediaToOptimizer(
  filePath: string,
  originalName?: string
): Promise<AnalysisResponse> {
  const res = await fetch('/api/media/send-to-optimizer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filePath, originalName }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to send media to optimizer');
  }

  return res.json();
}

export async function uploadFileChunked(
  file: File,
  onProgress?: (percent: number) => void
): Promise<AnalysisResponse> {
  const CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB chunks
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  const fileId = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9]/g, '')}`;

  let finalResponse: AnalysisResponse | null = null;

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
    const start = chunkIndex * CHUNK_SIZE;
    const end = Math.min(file.size, start + CHUNK_SIZE);
    const chunk = file.slice(start, end);

    const formData = new FormData();
    formData.append('chunk', chunk);
    formData.append('fileId', fileId);
    formData.append('chunkIndex', chunkIndex.toString());
    formData.append('totalChunks', totalChunks.toString());
    formData.append('fileName', file.name);

    const res = await fetch('/api/media/upload-chunk', {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      throw new Error(`Upload failed on chunk ${chunkIndex + 1}/${totalChunks}`);
    }

    const data = await res.json();
    if (onProgress) {
      onProgress(Math.round(((chunkIndex + 1) / totalChunks) * 100));
    }

    if (data.completed) {
      // Analyze the assembled file with optimizer
      return await sendMediaToOptimizer(data.tempPath, data.originalName);
    }
  }

  if (!finalResponse) {
    throw new Error('Chunked upload did not complete cleanly.');
  }

  return finalResponse;
}

