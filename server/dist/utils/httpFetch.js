import { RateLimitedError } from './errors.js';
/**
 * `fetch` with bounded retries for transient upstream failures.
 *
 * Policy (tuned to stop the server IP from being throttled by platforms that
 * answer bursts with HTTP 429):
 *
 *  - **429 is never retried here.** Retrying a rate limit is what turns one
 *    throttled response into a longer block, so it is reported immediately as
 *    a `RateLimitedError` (→ HTTP 429 + `Retry-After` for the client).
 *  - Network errors and 5xx responses are retried at most `MAX_RETRIES` times
 *    with exponential backoff plus jitter, so a burst of clients cannot
 *    re-align their retries onto the same instant.
 *  - Every non-2xx upstream status is logged, which makes it visible in the
 *    server output when a platform starts throttling.
 */
export const MAX_RETRIES = 2;
const BASE_BACKOFF_MS = 400;
const MAX_JITTER_MS = 250;
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/** Exponential backoff + random jitter for a given retry attempt (0-based). */
export function backoffDelay(attempt) {
    return BASE_BACKOFF_MS * 2 ** attempt + Math.floor(Math.random() * MAX_JITTER_MS);
}
function logUpstream(label, status) {
    const suffix = status === 429 ? ' (rate-limited by remote)' : '';
    console.warn(`[http] ${label}: upstream ${status}${suffix}`);
}
function retryAfterSeconds(res) {
    const raw = res.headers.get('retry-after');
    if (!raw)
        return undefined;
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds > 0)
        return seconds;
    return undefined;
}
export async function fetchWithRetry(url, init = {}, label = 'request') {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        let res;
        try {
            res = await fetch(url, init);
        }
        catch (err) {
            if (attempt >= MAX_RETRIES)
                throw err;
            await sleep(backoffDelay(attempt));
            continue;
        }
        if (res.status === 429) {
            logUpstream(label, 429);
            throw new RateLimitedError(`${label} was rate-limited by the remote server (HTTP 429).`, retryAfterSeconds(res));
        }
        // 5xx / gateway failures are transient — back off and retry.
        if (res.status >= 500 && attempt < MAX_RETRIES) {
            logUpstream(label, res.status);
            await sleep(backoffDelay(attempt));
            continue;
        }
        if (!res.ok)
            logUpstream(label, res.status);
        return res;
    }
    // Unreachable: the loop returns or throws above.
    throw new Error(`${label} failed after ${MAX_RETRIES} retries.`);
}
