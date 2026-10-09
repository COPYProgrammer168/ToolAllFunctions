import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { buildStreamHeaders } from '../services/StreamCredentials.js';
/**
 * Shell-free remote download.
 *
 * The previous implementation shelled out to `curl.exe`, which only exists on
 * Windows — every muxed download (YouTube adaptive streams, TikTok audio) failed
 * on Render's Linux hosts with "curl.exe: command not found". It also interpolated
 * untrusted URLs straight into a shell command.
 *
 * This uses `fetch` + stream piping instead, forwards HTTP Range so downloads can
 * resume, and attaches the platform credentials recorded during analysis.
 */
export async function downloadToFile(remoteUrl, destination, options = {}) {
    await fs.promises.mkdir(path.dirname(destination), { recursive: true });
    const headers = buildStreamHeaders(remoteUrl, options.headers || {});
    if (options.credentials) {
        if (options.credentials.cookie)
            headers.Cookie = options.credentials.cookie;
        if (options.credentials.referer)
            headers.Referer = options.credentials.referer;
        if (options.credentials.origin)
            headers.Origin = options.credentials.origin;
        if (options.credentials.userAgent)
            headers['User-Agent'] = options.credentials.userAgent;
        if (options.credentials.headers)
            Object.assign(headers, options.credentials.headers);
    }
    if (typeof options.startByte === 'number' && options.startByte >= 0) {
        headers.Range = `bytes=${options.startByte}-`;
    }
    else if (!headers.Range) {
        // Always send a Range header: some CDNs (notably Google's `googlevideo`
        // audio endpoints) answer a plain 200 with a Content-Length and then never
        // send the body, which looks like a permanent hang.
        headers.Range = 'bytes=0-';
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10 * 60 * 1000);
    try {
        const response = await fetch(remoteUrl, {
            headers,
            redirect: 'follow',
            signal: controller.signal,
        });
        if (!response.ok && response.status !== 206) {
            throw new Error(`Remote server responded with HTTP ${response.status} ${response.statusText}`);
        }
        if (!response.body) {
            throw new Error('Remote server returned an empty response body.');
        }
        const partial = response.status === 206 && !!options.startByte;
        const mode = partial ? 'a' : 'w';
        let received = partial ? options.startByte : 0;
        const total = received + (parseInt(response.headers.get('content-length') || '0', 10) || 0);
        const nodeStream = Readable.fromWeb(response.body);
        if (options.onProgress) {
            nodeStream.on('data', (chunk) => {
                received += chunk.length;
                options.onProgress(received, total);
            });
        }
        await pipeline(nodeStream, fs.createWriteStream(destination, { flags: mode }));
        const stat = await fs.promises.stat(destination);
        return { bytes: stat.size, contentType: response.headers.get('content-type') || undefined };
    }
    finally {
        clearTimeout(timer);
    }
}
