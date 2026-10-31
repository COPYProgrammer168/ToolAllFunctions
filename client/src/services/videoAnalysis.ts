import mediaInfoFactory from 'mediainfo.js';
import type {
  AudioTrack,
  GeneralTrack,
  MediaInfo,
  MediaInfoResult,
  VideoTrack,
} from 'mediainfo.js';
import mediaInfoWasmUrl from 'mediainfo.js/MediaInfoModule.wasm?url';
import type {
  AspectRatioStrategy,
  OptimizationReport,
  ProcessingMode,
  QualityScore,
  VideoMetadata,
} from '../types';

/**
 * File metadata is read entirely in the browser. MediaInfo only receives
 * slices of the local `File`, so the video itself never goes over the network
 * for analysis — which keeps files far above Vercel's 4.5 MB body limit usable.
 */
export class VideoAnalysisError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'VideoAnalysisError';
  }
}

const READ_CHUNK_SIZE = 4 * 1024 * 1024;

/** Analyze a selected video with MediaInfo.js, reading it in chunks on the client. */
export async function analyzeVideoFileInBrowser(
  file: File,
  onProgress?: (percent: number) => void
): Promise<OptimizationReport> {
  if (file.size <= 0) {
    throw new VideoAnalysisError(
      `"${file.name}" is empty, so it has no video metadata to read. Choose a valid video file.`
    );
  }

  let mediaInfo: MediaInfo<'object'> | undefined;
  let bytesRead = 0;
  let reportedProgress = 0;

  try {
    mediaInfo = await mediaInfoFactory({
      format: 'object',
      chunkSize: READ_CHUNK_SIZE,
      locateFile: () => mediaInfoWasmUrl,
    });

    const result = await mediaInfo.analyzeData(file.size, async (size, offset) => {
      const end = Math.min(file.size, offset + size);
      const chunk = await file.slice(offset, end).arrayBuffer();
      bytesRead += chunk.byteLength;

      if (onProgress && file.size > 0) {
        // MediaInfo may seek around the file, so use the cumulative high-water
        // mark and stop short of 100% until the report is actually built.
        const percent = Math.min(99, Math.round((bytesRead / file.size) * 100));
        if (percent > reportedProgress) {
          reportedProgress = percent;
          onProgress(percent);
        }
      }

      return new Uint8Array(chunk);
    });

    if (!result) {
      throw new VideoAnalysisError(
        `MediaInfo could not read metadata from "${file.name}". The file may be corrupt or use an unsupported format.`
      );
    }

    return buildOptimizationReport(result, file);
  } catch (err) {
    if (err instanceof VideoAnalysisError) throw err;

    throw new VideoAnalysisError(
      `MediaInfo could not analyze "${file.name}". The file may be corrupt, encrypted, or in a format the browser cannot read. Try a different video.`,
      { cause: err }
    );
  } finally {
    try {
      mediaInfo?.close();
    } catch {
      // Closing failure must not hide the analysis result or the real error.
    }
  }
}

/** Build the same report shape the server's ffprobe-based analyzer returned. */
export function buildOptimizationReport(
  result: MediaInfoResult,
  file: Pick<File, 'name' | 'size'>
): OptimizationReport {
  const tracks = result.media?.track ?? [];
  const general = tracks.find((track): track is GeneralTrack => track['@type'] === 'General');
  const video = tracks.find((track): track is VideoTrack => track['@type'] === 'Video');
  const audio = tracks.find((track): track is AudioTrack => track['@type'] === 'Audio');

  if (!video) {
    throw new VideoAnalysisError(
      `No video track was found in "${file.name}". The file may be audio-only or use an unsupported container.`
    );
  }

  const width = positiveNumber(video.Width) || 1920;
  const height = positiveNumber(video.Height) || 1080;
  const fps =
    positiveNumber(video.FrameRate) ||
    positiveNumber(video.FrameRate_Real) ||
    positiveNumber(video.FrameRate_Nominal) ||
    30;
  const avgFps = positiveNumber(video.FrameRate_Real) || fps;
  const frameRateMode = `${video.FrameRate_Mode ?? ''} ${video.FrameRate_Mode_String ?? ''}`;
  const isVfr =
    /vfr|variable/i.test(frameRateMode) ||
    (avgFps > 0 && Math.abs(fps - avgFps) > 0.5);
  const duration =
    positiveNumber(general?.Duration) ||
    positiveNumber(video.Duration) ||
    positiveNumber(video.Source_Duration) ||
    0;
  const bitrate =
    positiveNumber(general?.OverallBitRate) ||
    positiveNumber(video.BitRate) ||
    positiveNumber(video.BitRate_Nominal) ||
    0;

  const colorPrimaries = normalizeColorName(video.colour_primaries);
  const colorTransfer = normalizeColorName(video.transfer_characteristics);
  const colorSpace =
    normalizeColorName(video.matrix_coefficients) ||
    normalizeColorName(video.ColorSpace) ||
    undefined;
  const isHdr = Boolean(
    video.HDR_Format ||
      video.HDR_Format_String ||
      (colorPrimaries && (colorPrimaries.includes('bt2020') || colorPrimaries.includes('2020'))) ||
      (colorTransfer &&
        (colorTransfer.includes('smpte2084') ||
          colorTransfer.includes('arib-std-b67') ||
          colorTransfer.includes('pq') ||
          colorTransfer.includes('hlg')))
  );

  const metadata: VideoMetadata = {
    filename: file.name,
    originalName: file.name,
    sizeBytes: file.size,
    formatName: general?.Format || fileExtension(file.name) || 'mp4',
    duration: roundTo(duration, 2),
    bitrate,
    width,
    height,
    fps: roundTo(fps, 2),
    avgFps: roundTo(avgFps, 2),
    isVfr,
    codec: normalizeVideoCodec(video.Format),
    codecLongName: video.Format_Commercial || video.Format || 'unknown',
    profile: video.Format_Profile,
    level: Number(video.Format_Level) || undefined,
    pixelFormat: buildPixelFormat(video),
    colorSpace,
    colorPrimaries,
    colorTransfer,
    isHdr,
    aspectRatio: aspectRatioFor(width, height),
    rotation: Number(video.Rotation) || 0,
    audioCodec: audio ? normalizeAudioCodec(audio.Format) : undefined,
    audioBitrate: positiveNumber(audio?.BitRate) || undefined,
    audioSampleRate: positiveNumber(audio?.SamplingRate) || undefined,
    audioChannels: positiveNumber(audio?.Channels) || undefined,
  };

  const qualityScore = calculateQualityScore(metadata);

  return {
    metadata,
    qualityScore,
    detectedProblems: detectProblems(metadata),
    recommendations: generateRecommendations(metadata, qualityScore),
  };
}

/* ─── Normalizers ─── */

function positiveNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function roundTo(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function fileExtension(name: string): string | undefined {
  const extension = name.match(/\.([a-z0-9]+)$/i)?.[1];
  return extension?.toLowerCase();
}

/** Convert MediaInfo labels ("BT.709", "PQ") to ffprobe-style values. */
function normalizeColorName(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!normalized) return undefined;
  if (normalized.includes('bt2020') || normalized.includes('2020')) {
    return normalized.includes('nonconstant') || normalized.includes('nc') ? 'bt2020nc' : 'bt2020';
  }
  if (normalized === 'bt709' || normalized.includes('709')) return 'bt709';
  if (normalized.includes('smpte2084') || normalized === 'pq') return 'smpte2084';
  if (normalized.includes('aribstdb67') || normalized === 'hlg') return 'arib-std-b67';
  if (normalized.includes('bt601') || normalized.includes('601')) return 'smpte170m';
  return value;
}

const VIDEO_CODECS: Record<string, string> = {
  AVC: 'h264',
  'MPEG-4 AVC': 'h264',
  HEVC: 'hevc',
  'MPEG-H HEVC': 'hevc',
  'MPEG-4 Visual': 'mpeg4',
  'MPEG Video': 'mpeg2video',
  'MPEG-2 Video': 'mpeg2video',
  'VC-1': 'vc1',
  VP8: 'vp8',
  VP9: 'vp9',
  AV1: 'av1',
  ProRes: 'prores',
  Theora: 'theora',
  VVC: 'vvc',
};

function normalizeVideoCodec(format: string | undefined): string {
  if (!format) return 'unknown';
  return VIDEO_CODECS[format] || format.toLowerCase().replace(/\s+/g, '');
}

const AUDIO_CODECS: Record<string, string> = {
  AAC: 'aac',
  'AC-3': 'ac3',
  'E-AC-3': 'eac3',
  DTS: 'dts',
  'MPEG Audio': 'mp3',
  Opus: 'opus',
  FLAC: 'flac',
  Vorbis: 'vorbis',
  'MLP FBA': 'truehd',
  PCM: 'pcm_s16le',
};

function normalizeAudioCodec(format: string | undefined): string | undefined {
  if (!format) return undefined;
  return AUDIO_CODECS[format] || format.toLowerCase().replace(/\s+/g, '');
}

function buildPixelFormat(video: VideoTrack): string {
  const bitDepth = positiveNumber(video.BitDepth) || 8;
  const space = (video.ColorSpace || 'YUV').toUpperCase();
  const depthSuffix = bitDepth > 8 ? `${bitDepth}le` : '';

  if (space.includes('YUV') || space.includes('YCBCR')) {
    const chroma = (video.ChromaSubsampling || '').replace(/[^0-9]/g, '');
    const layout = chroma === '422' ? '422' : chroma === '444' ? '444' : '420';
    return `yuv${layout}p${depthSuffix}`;
  }
  if (space.includes('RGB')) {
    return bitDepth > 8 ? `rgb48le` : 'rgb24';
  }
  return `${space.toLowerCase()}${depthSuffix}`;
}

function aspectRatioFor(width: number, height: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(width, height);
  const aspectW = Math.round(width / divisor);
  const aspectH = Math.round(height / divisor);
  let aspectRatio = `${aspectW}:${aspectH}`;
  if (!['16:9', '9:16', '4:3', '1:1'].includes(aspectRatio)) {
    const ratio = width / height;
    if (Math.abs(ratio - 16 / 9) < 0.05) aspectRatio = '16:9';
    else if (Math.abs(ratio - 9 / 16) < 0.05) aspectRatio = '9:16';
    else if (Math.abs(ratio - 4 / 3) < 0.05) aspectRatio = '4:3';
    else if (Math.abs(ratio - 1) < 0.05) aspectRatio = '1:1';
  }
  return aspectRatio;
}

/* ─── Scoring & recommendations (kept in sync with server VideoAnalyzer) ─── */

function calculateQualityScore(m: VideoMetadata): QualityScore {
  let resolution = 70;
  const maxDim = Math.max(m.width, m.height);
  const minDim = Math.min(m.width, m.height);
  if (minDim >= 2160 || maxDim >= 3840) resolution = 98;
  else if (minDim >= 1440 || maxDim >= 2560) resolution = 92;
  else if (minDim >= 1080 || maxDim >= 1920) resolution = 85;
  else if (minDim >= 720 || maxDim >= 1280) resolution = 68;
  else resolution = 45;

  let motion = 75;
  if (m.fps >= 59) motion = 96;
  else if (m.fps >= 50) motion = 90;
  else if (m.fps >= 30) motion = 80;
  else if (m.fps >= 24) motion = 72;
  else motion = 55;
  if (m.isVfr) motion -= 8;

  const totalPixels = m.width * m.height;
  const bpp = m.bitrate > 0 && m.fps > 0 ? m.bitrate / (totalPixels * m.fps) : 0.1;
  let compression = 80;
  if (bpp >= 0.25) compression = 95;
  else if (bpp >= 0.15) compression = 88;
  else if (bpp >= 0.09) compression = 82;
  else if (bpp >= 0.05) compression = 70;
  else compression = 55;

  const sharpness = Math.round(resolution * 0.6 + compression * 0.4);

  let color = 85;
  if (m.isHdr) color = 96;
  else if (m.pixelFormat.includes('10le') || m.pixelFormat.includes('10bit')) color = 93;
  else if (m.pixelFormat === 'yuv420p') color = 88;

  let audio = 85;
  if (!m.audioCodec) {
    audio = 50;
  } else {
    if (m.audioSampleRate === 48000) audio += 5;
    if (m.audioBitrate && m.audioBitrate >= 192000) audio += 5;
    else if (m.audioBitrate && m.audioBitrate < 128000) audio -= 10;
    if (m.audioChannels && m.audioChannels >= 2) audio += 2;
  }
  audio = Math.min(100, Math.max(30, audio));

  const overall = Math.round(
    resolution * 0.25 +
      sharpness * 0.2 +
      compression * 0.2 +
      motion * 0.15 +
      color * 0.1 +
      audio * 0.1
  );

  return { overall, resolution, sharpness, compression, motion, color, audio };
}

function detectProblems(m: VideoMetadata): string[] {
  const problems: string[] = [];
  const totalPixels = m.width * m.height;
  const bpp = m.bitrate > 0 && m.fps > 0 ? m.bitrate / (totalPixels * m.fps) : 0.1;

  if (bpp < 0.06) {
    problems.push('Heavily compressed source (low bitrate for resolution/FPS)');
  } else if (bpp < 0.12) {
    problems.push('Moderate compression artifacts detected');
  }

  if (m.height < 1080 && m.width < 1080) {
    problems.push(`Sub-HD resolution (${m.width}×${m.height}) — detail loss on modern mobile displays`);
  } else if (m.height === 1080 && bpp < 0.1) {
    problems.push('Slight softness in edge details and textures');
  }

  if (m.fps <= 30) {
    problems.push(`Lower motion rate (${m.fps} FPS) — motion can be significantly smoother`);
  } else if (m.fps < 50) {
    problems.push(`Non-standard framerate (${m.fps} FPS) — jitter risk on 60Hz displays`);
  }

  if (m.isVfr) {
    problems.push('Variable frame rate (VFR) detected — can cause playback stutter and desync');
  }

  if (m.width > m.height) {
    problems.push('Landscape orientation (16:9/horizontal) — needs vertical framing for TikTok');
  }

  if (!m.audioCodec) {
    problems.push('No audio stream detected in video');
  } else {
    if (m.audioSampleRate && m.audioSampleRate !== 48000) {
      problems.push(`Non-standard audio sample rate (${m.audioSampleRate} Hz, 48 kHz recommended)`);
    }
    if (m.audioBitrate && m.audioBitrate < 128000) {
      problems.push('Low audio bitrate (< 128 kbps)');
    }
  }

  if (problems.length === 0) {
    problems.push('High fidelity source video — pristine condition');
  }

  return problems;
}

function generateRecommendations(m: VideoMetadata, q: QualityScore): OptimizationReport['recommendations'] {
  const isLandscape = m.width > m.height;
  const details: string[] = [];
  const mode: ProcessingMode = 'smart';
  let targetResolution = '1080p';
  let targetFps = 60;
  let upscaleRequired = false;
  let interpolationRequired = false;
  const aspectRatioStrategy: AspectRatioStrategy = isLandscape ? 'blur_background' : 'preserve';

  if (m.height < 1080 && m.width < 1080) {
    targetResolution = '1080p';
    upscaleRequired = true;
    details.push('Upscale to 1080×1920 for maximum TikTok sharpness');
  } else if (m.height >= 2160 || m.width >= 3840) {
    targetResolution = 'original';
    details.push(
      '4K source detected — keep full 4K for YouTube/archive; TikTok, Reels and Shorts cap uploads at 1080×1920'
    );
  } else {
    targetResolution = '1080p';
    details.push('Keep 1080p native resolution (avoid unnecessary scaling)');
  }

  if (m.fps < 50) {
    targetFps = 60;
    interpolationRequired = true;
    details.push(`Interpolate motion from ${m.fps} FPS to 60 FPS using motion estimation`);
  } else {
    targetFps = Math.round(m.fps);
    details.push(`Maintain native ${m.fps} FPS (already fluid)`);
  }

  if (q.compression < 80 || q.sharpness < 80) {
    details.push('Apply edge-aware CAS sharpening & conservative deblocking');
  } else {
    details.push('Preserve original detail without aggressive sharpening');
  }

  details.push('Encode with TikTok-compliant H.264 High Profile and AAC 48 kHz stereo');

  let summary = '';
  if (isLandscape) {
    summary =
      targetResolution === 'original'
        ? `Source is landscape 4K (${m.width}×${m.height}) at ${m.fps} FPS. Recommended: keep the 16:9 frame at 4K 60 FPS for YouTube — social platforms downscale uploads to 1080×1920.`
        : `Source is landscape (${m.width}×${m.height}) at ${m.fps} FPS. Recommended: 9:16 vertical conversion with blurred background padding + 60 FPS interpolation.`;
  } else if (m.fps < 50) {
    summary = `Source is ${m.width}×${m.height} at ${m.fps} FPS. Recommended: 60 FPS motion smoothing + edge-aware detail enhancement.`;
  } else {
    summary = `High quality source (${m.width}×${m.height}, ${m.fps} FPS). Recommended: Lossless/preservation pipeline with TikTok-optimized encoding.`;
  }

  return {
    summary,
    details,
    mode,
    targetResolution,
    targetFps,
    upscaleRequired,
    interpolationRequired,
    aspectRatioStrategy,
  };
}
