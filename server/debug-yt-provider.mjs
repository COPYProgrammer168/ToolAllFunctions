import { YouTubeProvider } from './dist/services/providers/YouTubeProvider.js';

const p = new YouTubeProvider();
const url = 'https://www.youtube.com/@PASTELGHOSTx/videos';
console.log('matches', p.matches(url));
const result = await p.analyze(url);
console.log({
  title: result.title,
  creator: result.creator,
  tracks: result.tracks?.length,
  notice: result.authorizedNotice,
  sample: result.tracks?.slice(0, 3).map((t) => ({ title: t.title, url: t.url, duration: t.duration })),
});
