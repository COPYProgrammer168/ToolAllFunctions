import { exec } from 'node:child_process';
import { promisify } from 'node:util';
const execAsync = promisify(exec);
export class WatermarkEditor {
    static LEGAL_WARNING = 'Removing a watermark from third-party content may violate copyright or platform rules. Use this tool only for content you own or have permission to edit.';
    static RECONSTRUCTION_DISCLAIMER = 'AI reconstruction attempts to restore the surrounding area. Results depend on the background and movement behind the watermark.';
    /**
     * Applies the selected watermark removal filter to a user-owned video
     */
    static async removeWatermark(options) {
        const { inputPath, outputPath, method, region, blurStrength = 10 } = options;
        let filterString = '';
        // Probe dimensions to clamp coordinates
        const probeCmd = `ffprobe -v quiet -print_format json -show_streams -select_streams v "${inputPath}"`;
        const { stdout } = await execAsync(probeCmd);
        const data = JSON.parse(stdout);
        const vStream = data.streams?.[0] || { width: 1920, height: 1080 };
        const vidW = Number(vStream.width) || 1920;
        const vidH = Number(vStream.height) || 1080;
        // Clamp coordinates safely
        const x = Math.max(0, Math.min(region.x, vidW - 2));
        const y = Math.max(0, Math.min(region.y, vidH - 2));
        const w = Math.max(4, Math.min(region.width, vidW - x));
        const h = Math.max(4, Math.min(region.height, vidH - y));
        switch (method) {
            case 'crop':
                // Crop out the watermark region: if watermark is at bottom, crop bottom height
                if (y > vidH / 2) {
                    // Crop top section
                    const newH = Math.max(128, y);
                    filterString = `crop=w=${vidW}:h=${newH}:x=0:y=0`;
                }
                else {
                    // Crop bottom section
                    const newH = Math.max(128, vidH - (y + h));
                    filterString = `crop=w=${vidW}:h=${newH}:x=0:y=${y + h}`;
                }
                break;
            case 'blur':
                // Boxblur or delogo with blur band
                filterString = `split[main][blur];[blur]crop=${w}:${h}:${x}:${y},boxblur=${blurStrength}[blurred];[main][blurred]overlay=${x}:${y}`;
                break;
            case 'mask':
                // Mask / pixel blend using neighboring vertical band
                filterString = `split[main][src];[src]crop=${w}:${h}:${x}:${Math.max(0, y - h)}[patch];[main][patch]overlay=${x}:${y}`;
                break;
            case 'inpaint':
            default:
                // FFmpeg delogo filter: uses surrounding pixels with edge gradient interpolation
                filterString = `delogo=x=${x}:y=${y}:w=${w}:h=${h}:show=0`;
                break;
        }
        const cmd = `ffmpeg -y -i "${inputPath}" -vf "${filterString}" -c:a copy "${outputPath}"`;
        await execAsync(cmd);
        return {
            outputPath,
            method,
            legalNotice: this.LEGAL_WARNING,
            qualityDisclaimer: this.RECONSTRUCTION_DISCLAIMER,
        };
    }
}
