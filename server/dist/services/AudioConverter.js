import fs from 'node:fs/promises';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
const execAsync = promisify(exec);
export class AudioConverter {
    /**
     * Generates a normalized array of peaks (0.0 to 1.0) for waveform visualization in client UI
     */
    static async generateWaveform(filePath, sampleCount = 100) {
        try {
            // Extract raw audio samples to compute RMS peaks
            const cmd = `ffmpeg -v quiet -i "${filePath}" -ac 1 -filter:a aresample=8000 -map 0:a -c:a pcm_s16le -f s16le -`;
            const { stdout } = await execAsync(cmd, { encoding: 'buffer', maxBuffer: 15 * 1024 * 1024 });
            const buffer = stdout;
            const totalSamples = buffer.length / 2; // 16-bit = 2 bytes per sample
            if (totalSamples <= 0) {
                return Array(sampleCount).fill(0.2);
            }
            const chunkSize = Math.max(1, Math.floor(totalSamples / sampleCount));
            const peaks = [];
            for (let i = 0; i < sampleCount; i++) {
                let maxVal = 0;
                const start = i * chunkSize;
                const end = Math.min(start + chunkSize, totalSamples);
                for (let j = start; j < end; j += 4) {
                    const sample = Math.abs(buffer.readInt16LE(j * 2));
                    if (sample > maxVal)
                        maxVal = sample;
                }
                peaks.push(Math.round((maxVal / 32768) * 100) / 100);
            }
            return peaks;
        }
        catch {
            // Fallback synthetic wave if raw pipe fails
            return Array.from({ length: sampleCount }, (_, idx) => {
                const val = 0.2 + 0.6 * Math.abs(Math.sin((idx / sampleCount) * Math.PI * 4));
                return Math.round(val * 100) / 100;
            });
        }
    }
    /**
     * Process audio editing: trimming, fade-in, fade-out, volume normalization, format export
     */
    static async editAndConvert(options) {
        const { inputPath, outputPath, format, startSec, endSec, fadeInSec, fadeOutSec, volumeMultiplier, normalizeLoudness, bitrateKbps = 320, } = options;
        const audioFilters = [];
        // Volume adjustment
        if (volumeMultiplier !== undefined && volumeMultiplier !== 1.0) {
            audioFilters.push(`volume=${volumeMultiplier}`);
        }
        // Loudness Normalization
        if (normalizeLoudness) {
            audioFilters.push('loudnorm=I=-16:TP=-1.5:LRA=11');
        }
        // Fade-in
        if (fadeInSec && fadeInSec > 0) {
            audioFilters.push(`afade=t=in:ss=0:d=${fadeInSec}`);
        }
        // Fade-out
        if (fadeOutSec && fadeOutSec > 0 && endSec && startSec !== undefined) {
            const activeDuration = endSec - (startSec || 0);
            const fadeStart = Math.max(0, activeDuration - fadeOutSec);
            audioFilters.push(`afade=t=out:st=${fadeStart}:d=${fadeOutSec}`);
        }
        const args = ['-y'];
        // Start trim
        if (startSec !== undefined && startSec > 0) {
            args.push('-ss', startSec.toString());
        }
        args.push('-i', `"${inputPath}"`);
        // End trim duration
        if (endSec !== undefined && endSec > 0) {
            const duration = (startSec !== undefined && startSec > 0) ? (endSec - startSec) : endSec;
            if (duration > 0) {
                args.push('-t', duration.toString());
            }
        }
        if (audioFilters.length > 0) {
            args.push('-af', `"${audioFilters.join(',')}"`);
        }
        if (format === 'mp3') {
            args.push('-c:a', 'libmp3lame', '-b:a', `${bitrateKbps}k`);
        }
        else if (format === 'm4a') {
            args.push('-c:a', 'aac', '-b:a', `${Math.min(bitrateKbps, 256)}k`);
        }
        else if (format === 'flac') {
            args.push('-c:a', 'flac');
        }
        else if (format === 'wav') {
            args.push('-c:a', 'pcm_s16le');
        }
        args.push(`"${outputPath}"`);
        const fullCmd = `ffmpeg ${args.join(' ')}`;
        await execAsync(fullCmd);
        const stats = await fs.stat(outputPath);
        // Probe output duration
        let outDuration = 0;
        try {
            const probeCmd = `ffprobe -v quiet -print_format json -show_format "${outputPath}"`;
            const { stdout } = await execAsync(probeCmd);
            const data = JSON.parse(stdout);
            outDuration = Number(data.format?.duration) || 0;
        }
        catch { }
        return {
            outputPath,
            fileSizeBytes: stats.size,
            duration: outDuration,
        };
    }
}
