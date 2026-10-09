/**
 * Verifies HTTP 429 handling:
 *   - fetchWithRetry retries at most twice with back-off, then throws RateLimitedError
 *   - YouTubeProvider runs the watch page through it and lets the error bubble up
 */
import http from 'node:http';
import { YouTubeProvider } from '../src/services/providers/YouTubeProvider.js';
import { fetchWithRetry } from '../src/utils/httpFetch.js';
import { RateLimitedError } from '../src/utils/errors.js';

// --- Test 1: a server that always answers 429 -----------------------------
let hits = 0;
const server = http.createServer((_req, res) => {
  hits += 1;
  res.writeHead(429, { 'retry-after': '60', 'content-type': 'text/plain' });
  res.end('rate limited');
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const addr = server.address();
const port = typeof addr === 'object' && addr ? addr.port : 0;

const started = Date.now();
try {
  await fetchWithRetry(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(5000) }, 'test');
  console.log('Test1: FAILED - no error thrown');
} catch (err: any) {
  const ms = Date.now() - started;
  console.log('Test1 error type       :', err.constructor.name);
  console.log('Test1 is RateLimited   :', err instanceof RateLimitedError);
  console.log('Test1 request attempts :', hits, '(expected 3 = 1 + 2 retries)');
  console.log('Test1 retryAfterSec    :', err.retryAfterSec);
  console.log('Test1 elapsed ms       :', ms, '(>= 1500 expected for 500+1000 back-off)');
  console.log('Test1 message          :', err.message);
}
server.close();

// --- Test 2: provider surfaces it instead of a generic failure ------------
const realFetch = globalThis.fetch;
globalThis.fetch = (async () =>
  new Response('nope', { status: 429, headers: { 'retry-after': '1' } })) as typeof fetch;
try {
  await new YouTubeProvider().analyze('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  console.log('Test2: FAILED - no error thrown');
} catch (err: any) {
  console.log('Test2 is RateLimited   :', err instanceof RateLimitedError);
  console.log('Test2 status           :', err.status);
  console.log('Test2 message          :', err.message);
} finally {
  globalThis.fetch = realFetch;
}
process.exit(0);
