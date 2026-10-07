import path from 'node:path';
export class DirectMediaProvider {
    id = 'direct';
    displayName = 'Direct Media Stream';
    matches(url) {
        // Matches any direct media file extension or generic authorized media resource
        const parsed = new URL(url);
        const pathname = parsed.pathname.toLowerCase();
        const mediaExts = [
            '.mp4', '.m4v', '.mov', '.mkv', '.webm', '.avi',
            '.mp3', '.m4a', '.wav', '.flac', '.aac', '.ogg',
            '.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif'
        ];
        return mediaExts.some((ext) => pathname.endsWith(ext)) || !!parsed.searchParams.get('media');
    }
    async analyze(url) {
        const parsed = new URL(url);
        const basename = path.basename(parsed.pathname) || 'media';
        const ext = path.extname(basename).toLowerCase();
        let contentType = '';
        let contentLength = 0;
        let supportsRange = false;
        try {
            const headRes = await fetch(url, {
                method: 'HEAD',
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
                signal: AbortSignal.timeout(6000),
            });
            if (headRes.ok) {
                contentType = headRes.headers.get('content-type') || '';
                contentLength = parseInt(headRes.headers.get('content-length') || '0', 10);
                supportsRange = headRes.headers.get('accept-ranges') === 'bytes';
            }
        }
        catch {
            // Continue with extension-based analysis
        }
        const isVideo = contentType.startsWith('video/') || ['.mp4', '.mov', '.mkv', '.webm', '.avi'].includes(ext);
        const isAudio = contentType.startsWith('audio/') || ['.mp3', '.m4a', '.wav', '.flac', '.aac', '.ogg'].includes(ext);
        const isImage = contentType.startsWith('image/') || ['.jpg', '.jpeg', '.png', '.webp', '.avif'].includes(ext);
        let mediaType = 'video';
        if (isImage)
            mediaType = 'image';
        else if (isAudio)
            mediaType = 'audio';
        const formats = [];
        if (mediaType === 'image') {
            formats.push({
                id: 'img-orig',
                type: 'image',
                format: 'original',
                qualityLabel: 'Original Image (No Recompression)',
                directDownloadUrl: url,
                filesizeEstimateBytes: contentLength || undefined,
            }, {
                id: 'img-png',
                type: 'image',
                format: 'png',
                qualityLabel: 'Lossless PNG',
                directDownloadUrl: url,
            }, {
                id: 'img-webp',
                type: 'image',
                format: 'webp',
                qualityLabel: 'WebP (Optimized Web)',
                directDownloadUrl: url,
            }, {
                id: 'img-jpg',
                type: 'image',
                format: 'jpg',
                qualityLabel: 'JPG (Universal Compatibility)',
                directDownloadUrl: url,
            });
        }
        else if (mediaType === 'video') {
            formats.push({
                id: 'vid-orig',
                type: 'video',
                format: 'original',
                qualityLabel: `Direct Stream (${supportsRange ? 'Resumable' : 'Standard'})`,
                directDownloadUrl: url,
                filesizeEstimateBytes: contentLength || undefined,
                notes: supportsRange ? 'Server supports HTTP Range resumable downloads.' : undefined,
            }, {
                id: 'vid-opt',
                type: 'video',
                format: 'mp4',
                qualityLabel: 'Send to Video Optimizer (4K / 60 FPS)',
                directDownloadUrl: url,
            }, {
                id: 'vid-audio-extract',
                type: 'audio',
                format: 'mp3',
                qualityLabel: 'Extract Audio (MP3 320 kbps)',
                bitrateKbps: 320,
                directDownloadUrl: url,
            });
        }
        else {
            formats.push({
                id: 'aud-orig',
                type: 'audio',
                format: 'original',
                qualityLabel: 'Original Audio Master',
                directDownloadUrl: url,
                filesizeEstimateBytes: contentLength || undefined,
            }, {
                id: 'aud-mp3-320',
                type: 'audio',
                format: 'mp3',
                qualityLabel: 'MP3 320 kbps CBR',
                bitrateKbps: 320,
                directDownloadUrl: url,
            }, {
                id: 'aud-flac',
                type: 'audio',
                format: 'flac',
                qualityLabel: 'FLAC Lossless',
                isLossless: true,
                directDownloadUrl: url,
            });
        }
        return {
            sourceUrl: url,
            platform: 'direct',
            title: basename,
            mediaType,
            thumbnail: isImage ? url : undefined,
            downloadAuthorized: true,
            availableFormats: formats,
            rawSourceUrl: url,
            copyrightNotice: 'Ensure you have necessary rights and licenses for media downloaded from third-party servers.',
        };
    }
}
