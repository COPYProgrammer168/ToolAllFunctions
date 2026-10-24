import { MEDAL_CONFIG, MEDAL_MAX_FILE_SIZE_BYTES, MEDAL_UNAVAILABLE_MESSAGE } from './config.js';
import { MEDAL_DOWNLOAD_GUIDE_URL } from './config.js';
import { parseClipPage } from './clipPage.js';
import { InvalidMedalUrlError, MedalFileTooLargeError, MedalRateLimitedError, MedalUpstreamError, } from './errors.js';
import { assertAllowedHop, isAllowedMedalCdnUrl, parseMedalClipUrl, prettifyGameSlug } from './url.js';
import { validateRemoteUrl } from '../../utils/security.js';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 VideoOptimize/1.0';
const AUTHORIZATION_NOTICE = 'Only download clips you own or have permission to download. This tool does not bypass private, premium, DRM, CAPTCHA, or rate-limit restrictions.';
function retryAfterSeconds(response) {
    const raw = response.headers.get('retry-after');
    if (!raw)
        return 60;
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds > 0)
        return seconds;
    const date = Date.parse(raw);
    if (!Number.isNaN(date))
        return Math.max(1, Math.ceil((date - Date.now()) / 1000));
    return 60;
}
function totalBytesFrom(response) {
    const contentRange = response.headers.get('content-range');
    if (contentRange) {
        const match = contentRange.match(/bytes\s+(\d+)-(\d+)\/(\d+)/i);
        if (match) {
            const start = Number(match[1]);
            const total = Number(match[3]);
            if (start !== 0) {
                throw new MedalUpstreamError('Medal returned an unexpected partial media response.');
            }
            if (Number.isFinite(total) && total > 0)
                return total;
        }
    }
    const length = Number(response.headers.get('content-length'));
    return Number.isFinite(length) && length > 0 ? length : undefined;
}
function isMp4Header(bytes) {
    if (bytes.length < 12)
        return false;
    return (bytes[4] === 0x66 && // f
        bytes[5] === 0x74 && // t
        bytes[6] === 0x79 && // y
        bytes[7] === 0x70 // p
    );
}
async function readBytesLimited(response, maxBytes) {
    if (!response.body)
        throw new MedalUpstreamError('Medal returned an empty media response.');
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
        while (total < maxBytes) {
            const { done, value } = await reader.read();
            if (done)
                break;
            if (!value)
                continue;
            const remaining = maxBytes - total;
            const slice = value.byteLength > remaining ? value.slice(0, remaining) : value;
            chunks.push(slice);
            total += slice.byteLength;
        }
    }
    finally {
        await reader.cancel().catch(() => { });
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return out;
}
async function readTextLimited(response, maxBytes) {
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
        throw new MedalUpstreamError('The Medal clip page was larger than expected.');
    }
    if (!response.body)
        throw new MedalUpstreamError('Medal returned an empty clip page.');
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            if (!value)
                continue;
            total += value.byteLength;
            if (total > maxBytes) {
                throw new MedalUpstreamError('The Medal clip page was larger than expected.');
            }
            chunks.push(Buffer.from(value));
        }
    }
    finally {
        await reader.cancel().catch(() => { });
    }
    return new TextDecoder('utf-8').decode(Buffer.concat(chunks));
}
export class MedalProvider {
    fetchImpl;
    validateUrl;
    constructor(deps = {}) {
        this.fetchImpl = deps.fetchImpl || fetch;
        this.validateUrl = deps.validateUrl || validateRemoteUrl;
    }
    /**
     * Fetches a URL while re-validating every redirect hop against the Medal
     * host allowlist and the general public-IP SSRF guard.
     */
    async guardedFetch(target, kind, init) {
        let current = assertAllowedHop(target, kind).toString();
        for (let redirectCount = 0; redirectCount <= MEDAL_CONFIG.maxRedirects; redirectCount += 1) {
            assertAllowedHop(current, kind);
            const validation = await this.validateUrl(current);
            if (!validation.valid) {
                throw new MedalUpstreamError('Medal returned an address that is not safe to fetch.');
            }
            let response;
            try {
                response = await this.fetchImpl(current, { ...init, redirect: 'manual' });
            }
            catch (err) {
                if (err?.name === 'AbortError' || err?.name === 'TimeoutError')
                    throw err;
                throw new MedalUpstreamError('Could not connect to Medal.tv.');
            }
            if ([301, 302, 303, 307, 308].includes(response.status)) {
                if (redirectCount === MEDAL_CONFIG.maxRedirects) {
                    throw new MedalUpstreamError('Medal returned too many redirects.');
                }
                const location = response.headers.get('location');
                if (!location) {
                    throw new MedalUpstreamError('Medal returned a redirect without a destination.');
                }
                current = new URL(location, current).toString();
                await response.body?.cancel().catch(() => { });
                continue;
            }
            return response;
        }
        throw new MedalUpstreamError('Medal returned too many redirects.');
    }
    baseClip(ref, title = 'Medal clip') {
        return {
            clipId: ref.clipId,
            gameSlug: ref.gameSlug,
            gameName: prettifyGameSlug(ref.gameSlug),
            title,
            canonicalUrl: ref.canonicalUrl,
        };
    }
    async inspect(rawUrl, externalSignal) {
        const ref = parseMedalClipUrl(rawUrl);
        const inspectedAt = new Date().toISOString();
        const timeoutSignal = AbortSignal.timeout(MEDAL_CONFIG.pageTimeoutSeconds * 1000);
        const signal = externalSignal
            ? AbortSignal.any([externalSignal, timeoutSignal])
            : timeoutSignal;
        let pageResponse;
        try {
            pageResponse = await this.guardedFetch(ref.requestUrl, 'page', {
                signal,
                headers: {
                    'User-Agent': USER_AGENT,
                    Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.8',
                },
            });
        }
        catch (err) {
            if (err?.name === 'TimeoutError') {
                throw new MedalUpstreamError('Medal.tv did not respond in time. Please try again.');
            }
            throw err;
        }
        // A private, deleted or restricted clip is not an error the tool can fix;
        // report it as unavailable and point at Medal's own workflow.
        if ([401, 403, 404, 410].includes(pageResponse.status)) {
            await pageResponse.body?.cancel().catch(() => { });
            return {
                clip: this.baseClip(ref),
                available: false,
                unavailableReason: pageResponse.status === 404 || pageResponse.status === 410
                    ? 'clip_not_found'
                    : 'clip_restricted',
                inspectedAt,
            };
        }
        if (pageResponse.status === 429) {
            await pageResponse.body?.cancel().catch(() => { });
            throw new MedalRateLimitedError(retryAfterSeconds(pageResponse));
        }
        if (!pageResponse.ok) {
            await pageResponse.body?.cancel().catch(() => { });
            throw new MedalUpstreamError(`Medal.tv returned HTTP ${pageResponse.status} while reading this clip.`);
        }
        const contentType = pageResponse.headers.get('content-type') || '';
        if (!contentType.toLowerCase().includes('text/html')) {
            await pageResponse.body?.cancel().catch(() => { });
            throw new MedalUpstreamError('Medal.tv returned an unexpected response for this clip.');
        }
        let html;
        try {
            html = await readTextLimited(pageResponse, MEDAL_CONFIG.pageMaxBytes);
        }
        catch (err) {
            if (err?.name === 'TimeoutError') {
                throw new MedalUpstreamError('Medal.tv did not finish sending the clip page in time.');
            }
            throw err;
        }
        const parsed = parseClipPage(html);
        const gameSlug = ref.gameSlug || parsed.schemaGameSlug || undefined;
        const clip = {
            clipId: ref.clipId,
            gameSlug,
            gameName: parsed.gameName || prettifyGameSlug(gameSlug),
            title: parsed.title,
            creator: parsed.creator,
            durationSeconds: parsed.durationSeconds,
            thumbnailUrl: parsed.thumbnailUrl,
            uploadedAt: parsed.uploadedAt,
            canonicalUrl: gameSlug
                ? `https://medal.tv/games/${gameSlug}/clips/${ref.clipId}`
                : ref.canonicalUrl,
        };
        if (!parsed.contentUrl) {
            return {
                clip,
                available: false,
                unavailableReason: parsed.contentUrlRejected
                    ? 'unsupported_media_source'
                    : 'no_public_original',
                inspectedAt,
            };
        }
        const media = await this.probeMedia(parsed.contentUrl);
        if (!media) {
            return {
                clip,
                available: false,
                unavailableReason: 'media_not_public',
                inspectedAt,
            };
        }
        return { clip, media, available: true, inspectedAt };
    }
    /** Probes the signed CDN URL with a small Range request and MP4 signature check. */
    async probeMedia(mediaUrl) {
        if (!isAllowedMedalCdnUrl(mediaUrl)) {
            throw new InvalidMedalUrlError('Medal exposed a media URL outside its approved CDN.');
        }
        const signal = AbortSignal.timeout(MEDAL_CONFIG.pageTimeoutSeconds * 1000);
        const response = await this.guardedFetch(mediaUrl, 'media', {
            signal,
            headers: {
                'User-Agent': USER_AGENT,
                Accept: 'video/mp4,video/*;q=0.9,*/*;q=0.1',
                Range: `bytes=0-${MEDAL_CONFIG.mediaProbeBytes - 1}`,
                Referer: 'https://medal.tv/',
            },
        });
        if ([401, 403, 404, 410].includes(response.status)) {
            await response.body?.cancel().catch(() => { });
            return null;
        }
        if (response.status === 429) {
            await response.body?.cancel().catch(() => { });
            throw new MedalRateLimitedError(retryAfterSeconds(response));
        }
        if (response.status >= 500) {
            await response.body?.cancel().catch(() => { });
            throw new MedalUpstreamError('Medal media storage is temporarily unavailable.');
        }
        if (response.status !== 200 && response.status !== 206) {
            await response.body?.cancel().catch(() => { });
            return null;
        }
        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        if (contentType.includes('text/html') || contentType.includes('application/json')) {
            await response.body?.cancel().catch(() => { });
            return null;
        }
        let bytes;
        let sizeBytes;
        try {
            sizeBytes = totalBytesFrom(response);
            bytes = await readBytesLimited(response, MEDAL_CONFIG.mediaProbeBytes);
        }
        catch (err) {
            if (err?.name === 'TimeoutError') {
                throw new MedalUpstreamError('Medal media storage did not respond in time.');
            }
            throw err;
        }
        if (!isMp4Header(bytes))
            return null;
        if (sizeBytes !== undefined && sizeBytes > MEDAL_MAX_FILE_SIZE_BYTES) {
            throw new MedalFileTooLargeError(`This clip is ${(sizeBytes / (1024 * 1024)).toFixed(1)} MB; the download limit is ${MEDAL_CONFIG.maxFileSizeMB} MB.`);
        }
        return {
            mediaUrl,
            contentType: 'video/mp4',
            container: 'mp4',
            sizeBytes,
            acceptRanges: response.status === 206 ||
                (response.headers.get('accept-ranges') || '').toLowerCase().includes('bytes'),
        };
    }
    async openDownload(media, signal) {
        if (!isAllowedMedalCdnUrl(media.mediaUrl)) {
            throw new MedalUpstreamError('The media URL for this clip is no longer valid.');
        }
        const response = await this.guardedFetch(media.mediaUrl, 'media', {
            signal,
            headers: {
                'User-Agent': USER_AGENT,
                Accept: 'video/mp4,video/*;q=0.9,*/*;q=0.1',
                Referer: 'https://medal.tv/',
            },
        });
        if (response.status === 429) {
            await response.body?.cancel().catch(() => { });
            throw new MedalRateLimitedError(retryAfterSeconds(response));
        }
        if (!response.ok) {
            await response.body?.cancel().catch(() => { });
            throw new MedalUpstreamError(`Medal media storage returned HTTP ${response.status}. Please inspect the clip again.`);
        }
        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        if (contentType.includes('text/html') || contentType.includes('application/json')) {
            await response.body?.cancel().catch(() => { });
            throw new MedalUpstreamError('Medal returned a web page instead of the video file.');
        }
        const totalBytes = totalBytesFrom(response);
        if (totalBytes !== undefined && totalBytes > MEDAL_MAX_FILE_SIZE_BYTES) {
            await response.body?.cancel().catch(() => { });
            throw new MedalFileTooLargeError(`This clip is ${(totalBytes / (1024 * 1024)).toFixed(1)} MB; the download limit is ${MEDAL_CONFIG.maxFileSizeMB} MB.`);
        }
        return { response, totalBytes };
    }
}
export function toPublicInspection(inspection) {
    const download = inspection.available && inspection.media
        ? {
            available: true,
            state: 'available',
            container: inspection.media.container,
            contentType: inspection.media.contentType,
            sizeBytes: inspection.media.sizeBytes,
        }
        : {
            available: false,
            state: 'download_not_available',
            message: MEDAL_UNAVAILABLE_MESSAGE,
            reason: inspection.unavailableReason || 'no_public_original',
        };
    return {
        clip: inspection.clip,
        download,
        authorizationRequired: true,
        authorizationNotice: AUTHORIZATION_NOTICE,
        officialWorkflowUrl: MEDAL_DOWNLOAD_GUIDE_URL,
        officialWorkflowLabel: 'Open Medal download guide',
        inspectedAt: inspection.inspectedAt,
    };
}
