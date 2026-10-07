import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import type { VideoMetadata, QualityValidationReport } from '../types/index.js';

const execAsync = promisify(exec);

export class QualityValidator {
  public static async validate(
    outputPath: string,
    inputMeta: VideoMetadata,
    isPreview = false
  ): Promise<QualityValidationReport> {
    const stats = await fs.stat(outputPath);
    if (stats.size === 0) {
      throw new Error('Validation failed: Output video file is 0 bytes.');
    }

    const cmd = `ffprobe -v quiet -print_format json -show_format -show_streams "${outputPath}"`;
    const { stdout } = await execAsync(cmd);
    const probeData = JSON.parse(stdout);

    const format = probeData.format || {};
    const streams = probeData.streams || [];

    const videoStream = streams.find((s: any) => s.codec_type === 'video');
    const audioStream = streams.find((s: any) => s.codec_type === 'audio');

    if (!videoStream) {
      throw new Error('Validation failed: Output contains no video stream.');
    }

    const parseRate = (str: string | undefined): number => {
      if (!str) return 30;
      const parts = str.split('/');
      if (parts.length === 2 && Number(parts[1]) > 0) {
        return Math.round((Number(parts[0]) / Number(parts[1])) * 100) / 100;
      }
      return Number(str) || 30;
    };

    const outFps = parseRate(videoStream.r_frame_rate || videoStream.avg_frame_rate);
    const outDuration = Number(format.duration) || Number(videoStream.duration) || 0;
    const outWidth = Number(videoStream.width);
    const outHeight = Number(videoStream.height);
    const durationDiff = Math.abs(outDuration - (isPreview ? Math.min(inputMeta.duration, 5) : inputMeta.duration));

    const warnings: string[] = [];

    // Check duration tolerance
    if (!isPreview && durationDiff > 1.5) {
      warnings.push(`Duration discrepancy detected (difference: ${durationDiff.toFixed(2)}s).`);
    }

    // Check audio sync
    let audioSynced = true;
    if (inputMeta.audioCodec) {
      if (!audioStream) {
        audioSynced = false;
        warnings.push('Audio stream missing in output video.');
      } else {
        const audioDuration = Number(audioStream.duration) || outDuration;
        if (Math.abs(audioDuration - outDuration) > 0.8) {
          audioSynced = false;
          warnings.push('Audio stream duration differs from video stream (possible sync drift).');
        }
      }
    }

    const passed = warnings.length === 0 || (warnings.length === 1 && durationDiff <= 2.0);

    return {
      passed,
      inputDuration: inputMeta.duration,
      outputDuration: Math.round(outDuration * 100) / 100,
      durationDiffSec: Math.round(durationDiff * 100) / 100,
      inputFps: inputMeta.fps,
      outputFps: outFps,
      inputResolution: `${inputMeta.width}×${inputMeta.height}`,
      outputResolution: `${outWidth}×${outHeight}`,
      outputCodec: videoStream.codec_name || 'h264',
      audioSynced,
      fileSizeBytes: stats.size,
      warnings,
    };
  }
}
