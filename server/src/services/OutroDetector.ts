import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';

const execAsync = promisify(exec);

export interface DetectedOutro {
  detected: boolean;
  suggestedCutTime: number; // in seconds
  totalDuration: number;
  outroStartFormatted: string; // e.g. "00:24.8"
  outroEndFormatted: string; // e.g. "00:27.4"
  reason: string;
  confidence: number; // 0 - 100
}

export class OutroDetector {
  /**
   * Formats seconds into MM:SS.S
   */
  public static formatTime(sec: number): string {
    const mins = Math.floor(sec / 60);
    const remainder = sec % 60;
    const formattedSec = remainder.toFixed(1).padStart(4, '0');
    return `${String(mins).padStart(2, '0')}:${formattedSec}`;
  }

  /**
   * Analyzes media to detect possible outros (silence, black frames, freezeframe/static card)
   */
  public static async detect(filePath: string): Promise<DetectedOutro> {
    // 1. Get total duration
    const probeCmd = `ffprobe -v quiet -print_format json -show_format -show_streams "${filePath}"`;
    const { stdout: probeOut } = await execAsync(probeCmd);
    const probeData = JSON.parse(probeOut);
    const totalDuration = Number(probeData.format?.duration) || 30;

    if (totalDuration < 3) {
      return {
        detected: false,
        suggestedCutTime: totalDuration,
        totalDuration,
        outroStartFormatted: this.formatTime(totalDuration),
        outroEndFormatted: this.formatTime(totalDuration),
        reason: 'Media is too short for outro detection.',
        confidence: 0,
      };
    }

    // Analyze the last 20% or max last 15 seconds
    const inspectWindow = Math.min(15, Math.max(3, totalDuration * 0.25));
    const startWindow = totalDuration - inspectWindow;

    let detectedCut: number | null = null;
    let detectionReason = '';

    // 2. Black frame detection on final segment
    try {
      const blackCmd = `ffmpeg -ss ${startWindow} -i "${filePath}" -vf "blackdetect=d=0.5:pix_th=0.1" -an -f null -`;
      const { stderr: blackErr } = await execAsync(blackCmd);

      const blackMatch = blackErr.match(/black_start:([0-9.]+)/);
      if (blackMatch) {
        const offset = parseFloat(blackMatch[1]);
        detectedCut = startWindow + offset;
        detectionReason = 'Black frame / fade to black detected';
      }
    } catch {
      // Continue
    }

    // 3. Audio silence detection on final segment
    if (detectedCut === null) {
      try {
        const silenceCmd = `ffmpeg -ss ${startWindow} -i "${filePath}" -af "silencedetect=noise=-35dB:d=0.8" -vn -f null -`;
        const { stderr: silenceErr } = await execAsync(silenceCmd);

        const silenceMatch = silenceErr.match(/silence_start: ([0-9.]+)/);
        if (silenceMatch) {
          const offset = parseFloat(silenceMatch[1]);
          detectedCut = startWindow + offset;
          detectionReason = 'Audio silence / trailing silence detected';
        }
      } catch {
        // Continue
      }
    }

    // 4. If neither triggered, check if standard TikTok/Reels end card is plausible (last 1.8-2.5s)
    if (detectedCut === null && totalDuration >= 6) {
      // Common short-form platform static watermark/outro length is between 1.5 to 2.8 seconds
      detectedCut = Math.max(0, totalDuration - 2.4);
      detectionReason = 'Heuristic: Potential ending card / platform watermark region';
    }

    const cutTime = detectedCut !== null ? Math.round(detectedCut * 10) / 10 : Math.max(0, totalDuration - 2.0);

    return {
      detected: true,
      suggestedCutTime: cutTime,
      totalDuration: Math.round(totalDuration * 10) / 10,
      outroStartFormatted: this.formatTime(cutTime),
      outroEndFormatted: this.formatTime(totalDuration),
      reason: detectionReason || 'End screen segment detected',
      confidence: detectionReason.includes('detected') ? 88 : 65,
    };
  }

  /**
   * Applies the ending trim, optionally with smooth audio/video fade-out
   */
  public static async trimEnding(
    inputPath: string,
    outputPath: string,
    cutTimeSec: number,
    applyFadeOut = true
  ): Promise<{ outputPath: string; outputDuration: number }> {
    const fadeDuration = Math.min(0.8, cutTimeSec);
    const fadeStart = Math.max(0, cutTimeSec - fadeDuration);

    const args = ['-y', '-i', `"${inputPath}"`, '-t', cutTimeSec.toString()];

    if (applyFadeOut) {
      args.push(
        '-vf', `fade=t=out:st=${fadeStart}:d=${fadeDuration}`,
        '-af', `afade=t=out:st=${fadeStart}:d=${fadeDuration}`
      );
    } else {
      args.push('-c', 'copy');
    }

    args.push(`"${outputPath}"`);

    await execAsync(`ffmpeg ${args.join(' ')}`);

    return {
      outputPath,
      outputDuration: cutTimeSec,
    };
  }
}
