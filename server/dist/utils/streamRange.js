import fs from 'node:fs';
import { finished } from 'node:stream/promises';
import { Readable } from 'node:stream';
/**
 * Bounded-range helpers for downloading CDN media streams.
 *
 * YouTube's `googlevideo` CDN does not accept an open-ended `Range: bytes=0-`,
 * nor a window wider than ~2 MB on audio-only streams: both are answered with
 * `403 Forbidden`. The audio-only case is what made every music download fail
 * while muxed video downloads happened to work.
 *
 * Requesting a small, explicitly bounded window is accepted for both kinds, so
 * downloads proceed in chunks and can resume from the last completed byte.
 */
/** Largest verified-safe window: 2 MB is accepted, 3 MB is refused. */
export const DOWNLOAD_CHUNK_BYTES = 1024 * 1024;
/** `bytes=<start>-<end>` for the bounded chunk at `start`. */
export function nextRangeHeader(start, chunkBytes = DOWNLOAD_CHUNK_BYTES) {
    return `bytes=${start}-${start + chunkBytes - 1}`;
}
/** Parses `Content-Range: bytes 0-1048575/30767611`. */
export function parseContentRange(header) {
    if (!header)
        return null;
    const match = /bytes\s+(\d+)-(\d+)\/(\d+|\*)/i.exec(header);
    if (!match)
        return null;
    const start = Number(match[1]);
    const end = Number(match[2]);
    return {
        start,
        length: Math.max(0, end - start + 1),
        total: match[3] === '*' ? undefined : Number(match[3]),
    };
}
/** Pipes a web body into the file stream, counting bytes as they land. */
async function writeBody(body, writeStream, onBytes) {
    if (!body)
        throw new Error('Remote server returned an empty response body.');
    for await (const chunk of Readable.fromWeb(body)) {
        const buffer = Buffer.from(chunk);
        onBytes(buffer.length);
        if (!writeStream.write(buffer)) {
            await new Promise((resolve) => writeStream.once('drain', resolve));
        }
    }
}
/**
 * Downloads `remoteUrl` into `destination` using bounded range requests,
 * appending each chunk in turn. Returns once the whole object is on disk.
 */
export async function streamDownloadToFile(remoteUrl, destination, options) {
    let received = options.startByte && options.startByte > 0 ? options.startByte : 0;
    let totalBytes = 0;
    let supportsRange = true;
    let contentType;
    let writeStream = fs.createWriteStream(destination, { flags: received > 0 ? 'a' : 'w' });
    /** Set once the open-ended window has been tried, so we never retry it. */
    let triedOpenEnded = false;
    const reopenFromScratch = async () => {
        await finished(writeStream.end()).catch(() => { });
        received = 0;
        writeStream = fs.createWriteStream(destination, { flags: 'w' });
    };
    try {
        for (;;) {
            // The first request is open-ended (`bytes=0-`): it is a single round trip
            // and every CDN that supports ranges honours it. Some (audio-only
            // googlevideo) refuse open-ended windows, so if it comes back refused we
            // continue below with small bounded windows instead.
            const useOpenEnded = !triedOpenEnded;
            triedOpenEnded = true;
            const response = await fetch(remoteUrl, {
                headers: {
                    ...options.headers,
                    Range: useOpenEnded ? `bytes=${received}-` : nextRangeHeader(received),
                },
                redirect: 'follow',
                ...(options.signal ? { signal: options.signal } : {}),
            });
            if (!response.ok && response.status !== 206) {
                // The open-ended window was refused; retry with a bounded one.
                if (useOpenEnded)
                    continue;
                throw new Error(`Remote server responded with HTTP ${response.status} ${response.statusText}`);
            }
            const type = response.headers.get('content-type');
            if (type)
                contentType = type;
            const parsed = parseContentRange(response.headers.get('content-range'));
            if (!parsed) {
                // The server ignored Range: it is sending the entire object in one body.
                supportsRange = false;
                if (received > 0)
                    await reopenFromScratch();
                await writeBody(response.body, writeStream, (len) => {
                    received += len;
                });
                break;
            }
            if (parsed.total)
                totalBytes = parsed.total;
            // The remote object no longer matches what is already on disk (a stale
            // partial file): start over rather than splice mismatched bytes.
            if (received > 0 && parsed.start !== received) {
                await reopenFromScratch();
                continue;
            }
            await writeBody(response.body, writeStream, (len) => {
                received += len;
            });
            options.onProgress?.(received, totalBytes || received);
            // Stop when the whole object is present, or when the size is unknown and
            // the server has no more data to offer.
            if (!parsed.total || received >= parsed.total)
                break;
        }
    }
    finally {
        await finished(writeStream.end()).catch(() => { });
    }
    return { bytes: received, totalBytes, supportsRange, contentType };
}
