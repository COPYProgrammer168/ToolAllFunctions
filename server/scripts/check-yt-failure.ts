import { YouTubeProvider } from '../src/services/providers/YouTubeProvider.js';

// Force the Innertube path to fail by pointing at a non-existent / removed
// video: this is the fastest way to see what a failed resolution reports.
const ids: string[] = process.argv.slice(2);
for (const id of ['ZZZZZZZZZZZ', 'dQw4w9WgXc', 'aaaaaaaaaaa']) {
  const p = new YouTubeProvider();
  const r = await p.analyze(`https://www.youtube.com/watch?v=${id}`).catch((e) => ({ error: e.message }));
  console.log(`--- ${id} ---`);
  console.log('authorized:', (r as any).downloadAuthorized);
  console.log('notice:', (r as any).authorizedNotice);
  console.log('error:', (r as any).error);
}
