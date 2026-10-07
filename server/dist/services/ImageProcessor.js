import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
const execAsync = promisify(exec);
export class ImageProcessor {
    static async convert(inputPath, outputPath, targetFormat) {
        if (targetFormat === 'original') {
            await fs.copyFile(inputPath, outputPath);
        }
        else {
            let formatArgs = '';
            if (targetFormat === 'jpg') {
                formatArgs = '-q:v 2';
            }
            else if (targetFormat === 'webp') {
                formatArgs = '-c:v libwebp -lossless 0 -q:v 85';
            }
            else if (targetFormat === 'png') {
                formatArgs = '-c:v png';
            }
            else if (targetFormat === 'avif') {
                formatArgs = '-c:v libaom-av1 -crf 28';
            }
            const cmd = `ffmpeg -y -i "${inputPath}" ${formatArgs} "${outputPath}"`;
            await execAsync(cmd);
        }
        const stats = await fs.stat(outputPath);
        // Probe dimensions
        let width = 0;
        let height = 0;
        try {
            const probeCmd = `ffprobe -v quiet -print_format json -show_streams -select_streams v "${outputPath}"`;
            const { stdout } = await execAsync(probeCmd);
            const data = JSON.parse(stdout);
            const stream = data.streams?.[0];
            if (stream) {
                width = Number(stream.width) || 0;
                height = Number(stream.height) || 0;
            }
        }
        catch { }
        return {
            outputPath,
            format: targetFormat,
            fileSizeBytes: stats.size,
            width,
            height,
        };
    }
}
