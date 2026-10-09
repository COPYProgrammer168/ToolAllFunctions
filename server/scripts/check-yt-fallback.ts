import { YouTubeProvider } from '../src/services/providers/YouTubeProvider.js';
import { buildStreamHeaders } from '../src/services/StreamCredentials.js';

const id = process.argv[2] || 'dQw4w9WgXcQ';
const watchUrl = `https://www.youtube.com/watch?v=${id}`;
const provider: any = new YouTubeProvider();

const res = await provider.ytDlpExtractMedia(id, watchUrl);
console.log('yt-dlp result:', {
  videoUrl: res.videoUrl?.slice(0, 90),
  audioUrl: res.audioUrl?.slice(0, 90),
  durationSec: res.durationSec,
  title: res.title,
  author: res.author,
  resolution: res.resolution,
  error: res.error,
});

for (const [label, url] of [
  ['video', res.videoUrl],
  ['audio', res.audioUrl],
] as const) {
  if (!url) continue;
  try {
    const r = await fetch(url, {
      headers: { ...buildStreamHeaders(url), Range: 'bytes=0-2047' },
      signal: AbortSignal.timeout(20000),
    });
    const buf = Buffer.from(await r.arrayBuffer());
    console.log(`  ${label}: HTTP ${r.status} ${r.headers.get('content-type')} bytes=${buf.length}`);
  } catch (e: any) {
    console.log(`  ${label}: ERROR ${e.message}`);
  }
}
process.exit(0);
