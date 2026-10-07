import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { VideoMetadata, QualityScore, OptimizationReport, ProcessingMode, AspectRatioStrategy } from '../types/index.js';

const execAsync = promisify(exec);

export class VideoAnalyzer {
  public static async analyze(filePath: string, originalName?: string): Promise<OptimizationReport> {
    const stats = await fs.stat(filePath);
    const sizeBytes = stats.size;

    // Run ffprobe with JSON output
    const cmd = `ffprobe -v quiet -print_format json -show_format -show_streams "${filePath}"`;
    const { stdout } = await execAsync(cmd, { maxBuffer: 10 * 1024 * 1024 });
    const probeData = JSON.parse(stdout);

    const format = probeData.format || {};
    const streams = probeData.streams || [];

    const videoStream = streams.find((s: any) => s.codec_type === 'video');
    const audioStream = streams.find((s: any) => s.codec_type === 'audio');

    if (!videoStream) {
      throw new Error('No video stream found in the uploaded file.');
    }

    // Extract FPS
    const parseRate = (str: string | undefined): number => {
      if (!str) return 30;
      const parts = str.split('/');
      if (parts.length === 2 && Number(parts[1]) > 0) {
        return Math.round((Number(parts[0]) / Number(parts[1])) * 100) / 100;
      }
      const num = Number(str);
      return isNaN(num) || num <= 0 ? 30 : num;
    };

    const rFps = parseRate(videoStream.r_frame_rate);
    const avgFps = parseRate(videoStream.avg_frame_rate);
    const fps = rFps > 0 ? rFps : (avgFps > 0 ? avgFps : 30);
    const isVfr = Math.abs(rFps - avgFps) > 0.5 && avgFps > 0;

    const width = Number(videoStream.width) || 1920;
    const height = Number(videoStream.height) || 1080;
    const duration = Number(format.duration) || Number(videoStream.duration) || 0;
    const bitrate = Number(format.bit_rate) || Number(videoStream.bit_rate) || 0;

    // Rotation
    let rotation = 0;
    if (videoStream.tags?.rotate) {
      rotation = Number(videoStream.tags.rotate) || 0;
    } else if (videoStream.side_data_list) {
      const displayMatrix = videoStream.side_data_list.find((sd: any) => sd.rotation !== undefined);
      if (displayMatrix) {
        rotation = Number(displayMatrix.rotation) || 0;
      }
    }

    // Calculate Aspect Ratio string
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    const divisor = gcd(width, height);
    const aspectW = Math.round(width / divisor);
    const aspectH = Math.round(height / divisor);
    let aspectRatio = `${aspectW}:${aspectH}`;
    if (aspectRatio === '16:9' || aspectRatio === '9:16' || aspectRatio === '4:3' || aspectRatio === '1:1') {
      // standard
    } else {
      const ratio = width / height;
      if (Math.abs(ratio - 16 / 9) < 0.05) aspectRatio = '16:9';
      else if (Math.abs(ratio - 9 / 16) < 0.05) aspectRatio = '9:16';
      else if (Math.abs(ratio - 4 / 3) < 0.05) aspectRatio = '4:3';
      else if (Math.abs(ratio - 1) < 0.05) aspectRatio = '1:1';
    }

    // Color & HDR
    const colorPrimaries = videoStream.color_primaries;
    const colorTransfer = videoStream.color_transfer;
    const colorSpace = videoStream.color_space;
    const isHdr = Boolean(
      (colorPrimaries && (colorPrimaries.includes('bt2020') || colorPrimaries.includes('2020'))) ||
      (colorTransfer && (colorTransfer.includes('smpte2084') || colorTransfer.includes('arib-std-b67')))
    );

    const metadata: VideoMetadata = {
      filename: path.basename(filePath),
      originalName: originalName || path.basename(filePath),
      sizeBytes,
      formatName: format.format_name || 'mp4',
      duration: Math.round(duration * 100) / 100,
      bitrate,
      width,
      height,
      fps,
      avgFps,
      isVfr,
      codec: videoStream.codec_name || 'unknown',
      codecLongName: videoStream.codec_long_name || videoStream.codec_name || 'H.264',
      profile: videoStream.profile,
      level: videoStream.level,
      pixelFormat: videoStream.pix_fmt || 'yuv420p',
      colorSpace,
      colorPrimaries,
      colorTransfer,
      isHdr,
      aspectRatio,
      rotation,
      audioCodec: audioStream?.codec_name,
      audioBitrate: Number(audioStream?.bit_rate) || undefined,
      audioSampleRate: Number(audioStream?.sample_rate) || undefined,
      audioChannels: Number(audioStream?.channels) || undefined,
    };

    // Calculate Quality Score
    const qualityScore = this.calculateQualityScore(metadata);

    // Detect Problems
    const detectedProblems: string[] = [];
    
    // Compression check (bits per pixel per frame)
    const totalPixels = width * height;
    const bpp = bitrate > 0 && fps > 0 ? bitrate / (totalPixels * fps) : 0.1;
    if (bpp < 0.06) {
      detectedProblems.push('Heavily compressed source (low bitrate for resolution/FPS)');
    } else if (bpp < 0.12) {
      detectedProblems.push('Moderate compression artifacts detected');
    }

    // Resolution check
    if (height < 1080 && width < 1080) {
      detectedProblems.push(`Sub-HD resolution (${width}×${height}) — detail loss on modern mobile displays`);
    } else if (height === 1080 && bpp < 0.10) {
      detectedProblems.push('Slight softness in edge details and textures');
    }

    // FPS check
    if (fps <= 30) {
      detectedProblems.push(`Lower motion rate (${fps} FPS) — motion can be significantly smoother`);
    } else if (fps < 50) {
      detectedProblems.push(`Non-standard framerate (${fps} FPS) — jitter risk on 60Hz displays`);
    }

    if (isVfr) {
      detectedProblems.push('Variable frame rate (VFR) detected — can cause playback stutter and desync');
    }

    // Aspect ratio check for TikTok
    if (width > height) {
      detectedProblems.push('Landscape orientation (16:9/horizontal) — needs vertical framing for TikTok');
    }

    // Audio check
    if (!audioStream) {
      detectedProblems.push('No audio stream detected in video');
    } else {
      if (metadata.audioSampleRate && metadata.audioSampleRate !== 48000) {
        detectedProblems.push(`Non-standard audio sample rate (${metadata.audioSampleRate} Hz, 48 kHz recommended)`);
      }
      if (metadata.audioBitrate && metadata.audioBitrate < 128000) {
        detectedProblems.push('Low audio bitrate (< 128 kbps)');
      }
    }

    if (detectedProblems.length === 0) {
      detectedProblems.push('High fidelity source video — pristine condition');
    }

    // Generate Recommendations
    const recommendations = this.generateRecommendations(metadata, qualityScore);

    return {
      metadata,
      qualityScore,
      detectedProblems,
      recommendations,
    };
  }

  private static calculateQualityScore(m: VideoMetadata): QualityScore {
    // 1. Resolution score (0 - 100)
    let resolution = 70;
    const maxDim = Math.max(m.width, m.height);
    const minDim = Math.min(m.width, m.height);
    if (minDim >= 2160 || maxDim >= 3840) resolution = 98;
    else if (minDim >= 1440 || maxDim >= 2560) resolution = 92;
    else if (minDim >= 1080 || maxDim >= 1920) resolution = 85;
    else if (minDim >= 720 || maxDim >= 1280) resolution = 68;
    else resolution = 45;

    // 2. Motion score
    let motion = 75;
    if (m.fps >= 59) motion = 96;
    else if (m.fps >= 50) motion = 90;
    else if (m.fps >= 30) motion = 80;
    else if (m.fps >= 24) motion = 72;
    else motion = 55;

    if (m.isVfr) motion -= 8;

    // 3. Compression score
    const totalPixels = m.width * m.height;
    const bpp = m.bitrate > 0 && m.fps > 0 ? m.bitrate / (totalPixels * m.fps) : 0.1;
    let compression = 80;
    if (bpp >= 0.25) compression = 95;
    else if (bpp >= 0.15) compression = 88;
    else if (bpp >= 0.09) compression = 82;
    else if (bpp >= 0.05) compression = 70;
    else compression = 55;

    // 4. Sharpness score (combined resolution and bitrate)
    let sharpness = Math.round((resolution * 0.6) + (compression * 0.4));

    // 5. Color score
    let color = 85;
    if (m.isHdr) color = 96;
    else if (m.pixelFormat.includes('10le') || m.pixelFormat.includes('10bit')) color = 93;
    else if (m.pixelFormat === 'yuv420p') color = 88;

    // 6. Audio score
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

    // Overall weighted score
    const overall = Math.round(
      resolution * 0.25 +
      sharpness * 0.20 +
      compression * 0.20 +
      motion * 0.15 +
      color * 0.10 +
      audio * 0.10
    );

    return {
      overall,
      resolution,
      sharpness,
      compression,
      motion,
      color,
      audio,
    };
  }

  private static generateRecommendations(m: VideoMetadata, q: QualityScore) {
    const isLandscape = m.width > m.height;
    const details: string[] = [];
    let mode: ProcessingMode = 'smart';
    let targetResolution = '1080p';
    let targetFps = 60;
    let upscaleRequired = false;
    let interpolationRequired = false;
    let aspectRatioStrategy: AspectRatioStrategy = isLandscape ? 'blur_background' : 'preserve';

    // Resolution decision
    if (m.height < 1080 && m.width < 1080) {
      targetResolution = '1080p';
      upscaleRequired = true;
      details.push('Upscale to 1080×1920 for maximum TikTok sharpness');
    } else if (m.height >= 2160 || m.width >= 3840) {
      targetResolution = 'original';
      details.push('Keep original 4K resolution (no downscale)');
    } else {
      targetResolution = '1080p';
      details.push('Keep 1080p native resolution (avoid unnecessary scaling)');
    }

    // FPS decision
    if (m.fps < 50) {
      targetFps = 60;
      interpolationRequired = true;
      details.push(`Interpolate motion from ${m.fps} FPS to 60 FPS using motion estimation`);
    } else {
      targetFps = Math.round(m.fps);
      details.push(`Maintain native ${m.fps} FPS (already fluid)`);
    }

    // Enhancement & Encoding decision
    if (q.compression < 80 || q.sharpness < 80) {
      details.push('Apply edge-aware CAS sharpening & conservative deblocking');
    } else {
      details.push('Preserve original detail without aggressive sharpening');
    }

    details.push('Encode with TikTok-compliant H.264 High Profile and AAC 48 kHz stereo');

    let summary = '';
    if (isLandscape) {
      summary = `Source is landscape (${m.width}×${m.height}) at ${m.fps} FPS. Recommended: 9:16 vertical conversion with blurred background padding + 60 FPS interpolation.`;
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
}
