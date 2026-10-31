import { describe, expect, it } from 'vitest';
import type { MediaInfoResult, Track } from 'mediainfo.js';
import { buildOptimizationReport, VideoAnalysisError } from '../videoAnalysis';

function mediaInfo(overrides: {
  video?: Record<string, unknown>;
  audio?: Record<string, unknown> | null;
  general?: Record<string, unknown>;
} = {}): MediaInfoResult {
  const tracks: Track[] = [
    {
      '@type': 'General',
      Format: 'MPEG-4',
      Duration: 120.5,
      OverallBitRate: 50_000_000,
      ...overrides.general,
    },
    {
      '@type': 'Video',
      Format: 'AVC',
      Format_Profile: 'High',
      Format_Level: '5.1',
      Width: 3840,
      Height: 2160,
      FrameRate: 59.94,
      BitRate: 48_000_000,
      ColorSpace: 'YUV',
      ChromaSubsampling: '4:2:0',
      BitDepth: 8,
      colour_primaries: 'BT.709',
      transfer_characteristics: 'BT.709',
      matrix_coefficients: 'BT.709',
      ...overrides.video,
    },
  ];

  if (overrides.audio !== null) {
    tracks.push({
      '@type': 'Audio',
      Format: 'AAC',
      BitRate: 192_000,
      SamplingRate: 48_000,
      Channels: 2,
      ...overrides.audio,
    });
  }

  return { media: { '@ref': 'test.mp4', track: tracks } };
}

const file = { name: 'gameplay.mp4', size: 123_456_789 };

describe('buildOptimizationReport', () => {
  it('maps MediaInfo fields into the optimizer report format', () => {
    const report = buildOptimizationReport(mediaInfo(), file);

    expect(report.metadata).toMatchObject({
      filename: 'gameplay.mp4',
      originalName: 'gameplay.mp4',
      sizeBytes: 123_456_789,
      formatName: 'MPEG-4',
      width: 3840,
      height: 2160,
      fps: 59.94,
      avgFps: 59.94,
      duration: 120.5,
      bitrate: 50_000_000,
      codec: 'h264',
      codecLongName: 'AVC',
      profile: 'High',
      level: 5.1,
      pixelFormat: 'yuv420p',
      colorSpace: 'bt709',
      colorPrimaries: 'bt709',
      colorTransfer: 'bt709',
      isHdr: false,
      aspectRatio: '16:9',
      audioCodec: 'aac',
      audioBitrate: 192_000,
      audioSampleRate: 48_000,
      audioChannels: 2,
    });
    expect(report.qualityScore.overall).toBeGreaterThan(0);
    expect(report.qualityScore.overall).toBeLessThanOrEqual(100);
    expect(report.recommendations.targetResolution).toBe('original');
    expect(report.recommendations.interpolationRequired).toBe(false);
    expect(report.detectedProblems.length).toBeGreaterThan(0);
  });

  it('detects HDR and 10-bit color from MediaInfo labels', () => {
    const report = buildOptimizationReport(
      mediaInfo({
        video: {
          Format: 'HEVC',
          BitDepth: 10,
          colour_primaries: 'BT.2020',
          transfer_characteristics: 'PQ',
          matrix_coefficients: 'BT.2020 non-constant',
        },
      }),
      file
    );

    expect(report.metadata.codec).toBe('hevc');
    expect(report.metadata.pixelFormat).toBe('yuv420p10le');
    expect(report.metadata.colorSpace).toBe('bt2020nc');
    expect(report.metadata.colorPrimaries).toBe('bt2020');
    expect(report.metadata.colorTransfer).toBe('smpte2084');
    expect(report.metadata.isHdr).toBe(true);
    expect(report.qualityScore.color).toBe(96);
  });

  it('flags variable frame rate sources', () => {
    const report = buildOptimizationReport(
      mediaInfo({ video: { FrameRate: 60, FrameRate_Real: 30, FrameRate_Mode: 'VFR' } }),
      file
    );

    expect(report.metadata.isVfr).toBe(true);
    expect(report.detectedProblems).toContain(
      'Variable frame rate (VFR) detected — can cause playback stutter and desync'
    );
  });

  it('throws a clear error when the file has no video track', () => {
    expect(() =>
      buildOptimizationReport(
        {
          media: {
            '@ref': 'audio.mp3',
            track: [{ '@type': 'General', Format: 'MPEG Audio' }, { '@type': 'Audio', Format: 'MP3' }],
          },
        },
        { name: 'audio.mp3', size: 1000 }
      )
    ).toThrow(VideoAnalysisError);

    expect(() =>
      buildOptimizationReport(
        {
          media: {
            '@ref': 'audio.mp3',
            track: [{ '@type': 'General', Format: 'MPEG Audio' }, { '@type': 'Audio', Format: 'MP3' }],
          },
        },
        { name: 'audio.mp3', size: 1000 }
      )
    ).toThrow(/No video track was found in "audio.mp3"/);
  });
});
