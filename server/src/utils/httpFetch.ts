import { RateLimitedError } from './errors.js';

/**
 * `fetch` with HTTP 429 back-off.
 *
 * Platforms (YouTube in particular) answer bursts of requests with 429. Without
 * retries those surfaced as "watch page request failed with HTTP 429", which
 * reads like the video is undownloadable. At most `RATE_LIMIT_RETRIES` retries
 * with exponential back-off are attempted; if the server keeps limiting, a
 * `RateLimitedError` (→ HTTP 503) is thrown.
 */

export const RATE_LIMIT_RETRIES = 2;
const BACKOFF_MS = [500, 1000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterSeconds(res: Response): number | undefined {
  const raw = res.headers.get('retry-after');
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) return seconds;
  return undefined;
}

export async function fetchWithRetry(url: string, init: RequestInit = {}, label = 'request'): Promise<Response> {
  let attempt = 0;
  for (;;) {
    const res = await fetch(url, init);
    if (res.status !== 429) return res;

    if (attempt >= RATE_LIMIT_RETRIES) {
      const retryAfterSec = retryAfterSeconds(res);
      throw new RateLimitedError(
        `${label} was rate-limited by the remote server (HTTP 429) after ${RATE_LIMIT_RETRIES} retries. Please wait a minute and try again.`,
        retryAfterSec
      );
    }

    await sleep(BACKOFF_MS[attempt]);
    attempt += 1;
  }
}
