import { MediaSourceResolver } from '../src/services/MediaSourceResolver.js';
import { buildStreamHeaders } from '../src/services/StreamCredentials.js';

const targets = [
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  'https://www.tiktok.com/@tiktok/video/7694307066965396766',
];

async function probe(label: string, url: string): Promise<void> {
  if (!url) {
    console.log(`  ${label}: <none>`);
    return;
  }
  try {
    const res = await fetch(url, {
      headers: { ...buildStreamHeaders(url), Range: 'bytes=0-1023' },
      redirect: 'follow',
      signal: AbortSignal.timeout(20000),
    });
    const buf = Buffer.from(await res.arrayBuffer());
    console.log(
      `  ${label}: HTTP ${res.status} ${res.headers.get('content-type')} bytes=${buf.length} head=${buf
        .subarray(0, 12)
        .toString('hex')}`
    );
  } catch (e: any) {
    console.log(`  ${label}: FETCH ERROR ${e.message}`);
  }
}

for (const url of targets) {
  console.log(`\n=== ${url}`);
  try {
    const r = await MediaSourceResolver.resolveAndAnalyze(url);
    console.log({
      platform: r.platform,
      title: r.title,
      duration: r.duration,
      downloadAuthorized: r.downloadAuthorized,
      authorizedNotice: r.authorizedNotice,
      rawMuxedUrl: r.rawMuxedUrl?.slice(0, 90),
      rawVideoUrl: r.rawVideoUrl?.slice(0, 90),
      rawAudioUrl: r.rawAudioUrl?.slice(0, 90),
      formats: r.availableFormats.map((f) => `${f.type}/${f.format}: ${!!f.directDownloadUrl}`),
    });
    await probe('muxed/video', r.rawMuxedUrl || r.rawVideoUrl);
    await probe('audio', r.rawAudioUrl);
  } catch (e: any) {
    console.log('ANALYZE ERROR:', e.message);
  }
}

process.exit(0);

