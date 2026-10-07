import path from 'node:path';
import fs from 'node:fs/promises';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

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

export interface AudioExtractionOptions {
  inputPath: string;
  outputPath: string;
  format: 'mp3' | 'm4a' | 'aac' | 'wav' | 'flac';
  targetBitrateKbps?: number; // e.g. 320, 256, 192, 128
  preferStreamCopy?: boolean;
  metadata?: AudioMetadataTags;
}

export interface AudioExtractionResult {
  outputPath: string;
  format: string;
  fileSizeBytes: number;
  sourceBitrateKbps: number;
  outputBitrateKbps: number;
  isStreamCopy: boolean;
  qualityNotice?: string;
}

export class AudioExtractor {
  /**
   * Probe source file to extract audio stream details (codec, bitrate, sample rate, channels)
   */
  public static async probeAudio(filePath: string): Promise<{
    hasAudio: boolean;
    codec: string;
    bitrateKbps: number;
    sampleRate: number;
    channels: number;
    isLossless: boolean;
  }> {
    try {
      const cmd = `ffprobe -v quiet -print_format json -show_streams -select_streams a "${filePath}"`;
      const { stdout } = await execAsync(cmd);
      const data = JSON.parse(stdout);
      const stream = data.streams?.[0];

      if (!stream) {
        return {
          hasAudio: false,
          codec: 'none',
          bitrateKbps: 0,
          sampleRate: 0,
          channels: 0,
          isLossless: false,
        };
      }

      const codec = (stream.codec_name || '').toLowerCase();
      let bitrate = Number(stream.bit_rate) || 0;
      if (!bitrate && stream.tags?.BPS) {
        bitrate = Number(stream.tags.BPS) || 0;
      }
      const bitrateKbps = bitrate > 0 ? Math.round(bitrate / 1000) : 128; // Default estimation
      const sampleRate = Number(stream.sample_rate) || 44100;
      const channels = Number(stream.channels) || 2;
      const isLossless = ['flac', 'pcm_s16le', 'pcm_s24le', 'alac', 'wav'].some((c) =>
        codec.includes(c)
      );

      return {
        hasAudio: true,
        codec,
        bitrateKbps,
        sampleRate,
        channels,
        isLossless,
      };
    } catch {
      return {
        hasAudio: true,
        codec: 'unknown',
        bitrateKbps: 128,
        sampleRate: 44100,
        channels: 2,
        isLossless: false,
      };
    }
  }

  /**
   * Extract or transcode audio track with smart bitrate analysis and direct stream copy
   */
  public static async extract(options: AudioExtractionOptions): Promise<AudioExtractionResult> {
    const { inputPath, outputPath, format, preferStreamCopy, metadata } = options;
    const probe = await this.probeAudio(inputPath);

    if (!probe.hasAudio) {
      throw new Error('Source file does not contain an accessible audio stream.');
    }

    let isStreamCopy = false;
    let qualityNotice: string | undefined;
    let outputBitrate = options.targetBitrateKbps || 320;

    // Check if Direct Stream Copy is feasible (e.g. AAC source to M4A/AAC output, or MP3 source to MP3 output)
    const canStreamCopy =
      preferStreamCopy !== false &&
      ((probe.codec === 'aac' && (format === 'm4a' || format === 'aac')) ||
        (probe.codec === 'mp3' && format === 'mp3') ||
        (probe.isLossless && (format === 'flac' || format === 'wav')));

    let ffmpegArgs: string[] = [];

    if (canStreamCopy && !metadata?.artworkPath) {
      // Direct Stream Copy: Lossless extraction without re-encoding
      isStreamCopy = true;
      outputBitrate = probe.bitrateKbps;
      ffmpegArgs = [
        '-y',
        '-i', `"${inputPath}"`,
        '-vn', // no video
        '-c:a', 'copy',
      ];
    } else {
      // Smart Re-encoding
      isStreamCopy = false;

      // Smart quality notice for 320 kbps MP3 up-allocation
      if (format === 'mp3' && outputBitrate >= 320 && probe.bitrateKbps > 0 && probe.bitrateKbps < 300) {
        qualityNotice = `The output will be encoded at 320 kbps CBR, but the source contains approximately ${probe.bitrateKbps} kbps audio information. This increases file size but does not restore lost detail.`;
      }

      if (probe.isLossless && format === 'flac') {
        outputBitrate = probe.bitrateKbps;
        qualityNotice = 'Preserving full lossless audio fidelity with FLAC compression.';
      }

      ffmpegArgs = ['-y', '-i', `"${inputPath}"`, '-vn'];

      if (format === 'mp3') {
        ffmpegArgs.push('-c:a', 'libmp3lame', '-b:a', `${outputBitrate}k`);
      } else if (format === 'm4a' || format === 'aac') {
        ffmpegArgs.push('-c:a', 'aac', '-b:a', `${Math.min(outputBitrate, 256)}k`);
      } else if (format === 'flac') {
        ffmpegArgs.push('-c:a', 'flac');
      } else if (format === 'wav') {
        ffmpegArgs.push('-c:a', 'pcm_s16le');
      }
    }

    // Apply metadata tags
    if (metadata) {
      if (metadata.title) ffmpegArgs.push('-metadata', `title="${metadata.title.replace(/"/g, '\\"')}"`);
      if (metadata.artist) ffmpegArgs.push('-metadata', `artist="${metadata.artist.replace(/"/g, '\\"')}"`);
      if (metadata.album) ffmpegArgs.push('-metadata', `album="${metadata.album.replace(/"/g, '\\"')}"`);
      if (metadata.genre) ffmpegArgs.push('-metadata', `genre="${metadata.genre.replace(/"/g, '\\"')}"`);
      if (metadata.year) ffmpegArgs.push('-metadata', `date="${metadata.year}"`);
      if (metadata.trackNumber) ffmpegArgs.push('-metadata', `track="${metadata.trackNumber}"`);
      if (metadata.comment) ffmpegArgs.push('-metadata', `comment="${metadata.comment.replace(/"/g, '\\"')}"`);

      // Cover artwork if provided
      if (metadata.artworkPath) {
        ffmpegArgs.push('-i', `"${metadata.artworkPath}"`, '-map', '0:a', '-map', '1:v', '-c:v', 'copy', '-id3v2_version', '3', '-metadata:s:v', 'title="Album cover"', '-metadata:s:v', 'comment="Cover (front)"');
      }
    }

    ffmpegArgs.push(`"${outputPath}"`);

    const fullCmd = `ffmpeg ${ffmpegArgs.join(' ')}`;
    await execAsync(fullCmd);

    const stats = await fs.stat(outputPath);

    return {
      outputPath,
      format,
      fileSizeBytes: stats.size,
      sourceBitrateKbps: probe.bitrateKbps,
      outputBitrateKbps: outputBitrate,
      isStreamCopy,
      qualityNotice,
    };
  }
}
