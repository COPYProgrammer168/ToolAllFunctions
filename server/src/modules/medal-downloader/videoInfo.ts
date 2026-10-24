import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ffprobeBin } from '../../utils/binaries.js';
import type { MedalVideoInfo } from './types.js';

const execFileAsync = promisify(execFile);

function parseFrameRate(value: unknown): number {
  if (typeof value !== 'string') return 0;
  const [num, den] = value.split('/').map(Number);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return 0;
  const fps = num / den;
  return Number.isFinite(fps) && fps > 0 ? Math.round(fps * 100) / 100 : 0;
}

/**
 * Validates the downloaded file with ffprobe before exposing it.
 *
 * The file is the untouched original from Medal's CDN; ffprobe only reads it.
 * A job only succeeds when the container is MP4/MOV and a real video stream is
 * present.
 */
export async function probeVideoFile(
  filePath: string,
  sizeBytes: number
): Promise<MedalVideoInfo> {
  const { stdout } = await execFileAsync(
    ffprobeBin(),
    [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      filePath,
    ],
    { timeout: 30_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }
  );

  let probe: any;
  try {
    probe = JSON.parse(stdout);
  } catch {
    throw new Error('The downloaded file could not be read as a video.');
  }

  const streams: any[] = Array.isArray(probe.streams) ? probe.streams : [];
  const video = streams.find((stream) => stream?.codec_type === 'video');
  if (!video) throw new Error('The downloaded file does not contain a video stream.');

  const formatName = String(probe.format?.format_name || '').toLowerCase();
  if (!formatName.includes('mp4') && !formatName.includes('mov')) {
    throw new Error('The downloaded file is not an MP4 video.');
  }

  const duration =
    Number(probe.format?.duration) || Number(video.duration) || 0;
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('The downloaded video has no readable duration.');
  }

  const width = Number(video.width);
  const height = Number(video.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('The downloaded video has no readable dimensions.');
  }

  const audio = streams.find((stream) => stream?.codec_type === 'audio');
  const fps = parseFrameRate(video.avg_frame_rate) || parseFrameRate(video.r_frame_rate);

  return {
    container: 'mp4',
    videoCodec: String(video.codec_name || 'unknown'),
    audioCodec: audio ? String(audio.codec_name || 'unknown') : undefined,
    width,
    height,
    fps,
    durationSeconds: Math.round(duration * 100) / 100,
    sizeBytes,
  };
}
