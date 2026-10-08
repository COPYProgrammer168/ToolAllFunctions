const url = 'https://www.youtube.com/@PASTELGHOSTx/videos';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const res = await fetch(url, {
  headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
  redirect: 'follow',
});
console.log('status', res.status, 'final', res.url);
const html = await res.text();
console.log('len', html.length);
const apiKey = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1];
console.log('apiKey', apiKey ? apiKey.slice(0, 12) + '...' : null);
const channelId =
  html.match(/"channelId":"(UC[\w-]+)"/)?.[1] ||
  html.match(/"externalId":"(UC[\w-]+)"/)?.[1] ||
  html.match(/youtube\.com\/channel\/(UC[\w-]+)/)?.[1];
console.log('channelId', channelId);
console.log('ytInitialData var', /ytInitialData\s*=/.test(html));
console.log('ytInitialData JSON.parse style', /var ytInitialData\s*=/.test(html));
console.log('has videoRenderer', /videoRenderer/.test(html));
console.log('has gridVideoRenderer', /gridVideoRenderer/.test(html));
console.log('has richItemRenderer', /richItemRenderer/.test(html));
console.log('consent', /consent\.google|Before you continue to YouTube/i.test(html));
console.log('title', html.match(/<title>([^<]+)<\/title>/i)?.[1]);
console.log('og:title', html.match(/property="og:title"\s+content="([^"]+)"/i)?.[1]);

// Try extract ytInitialData more carefully
const m1 = html.match(/ytInitialData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
console.log('greedy match len', m1?.[1]?.length);
if (m1) {
  try {
    JSON.parse(m1[1]);
    console.log('greedy parse OK');
  } catch (e) {
    console.log('greedy parse FAIL', e.message);
  }
}

const m2 = html.match(/ytInitialData\s*=\s*(\{.*\});<\/script>/s);
console.log('dotall match len', m2?.[1]?.length);

// Find script containing ytInitialData
const idx = html.indexOf('ytInitialData');
console.log('ytInitialData idx', idx);
if (idx > 0) {
  console.log('snippet', html.slice(idx, idx + 120).replace(/\n/g, ' '));
}

if (apiKey && channelId) {
  const browse = await fetch(`https://www.youtube.com/youtubei/v1/browse?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({
      context: { client: { clientName: 'WEB', clientVersion: '2.20240726.01.00' } },
      browseId: channelId,
      params: 'EgZ2aWRlb3PyBgQKAjoA',
    }),
  });
  console.log('browse status', browse.status);
  const data = await browse.json();
  console.log('browse keys', Object.keys(data));
  console.log('playability/error', data.error || data.alerts?.[0] || data.contents ? 'has contents' : 'no contents');
  const str = JSON.stringify(data);
  console.log('videoRenderer count', (str.match(/"videoRenderer"/g) || []).length);
  console.log('gridVideoRenderer count', (str.match(/"gridVideoRenderer"/g) || []).length);
  console.log('richItemRenderer count', (str.match(/"richItemRenderer"/g) || []).length);
  // sample first videoId
  const vid = str.match(/"videoId":"([\w-]{11})"/);
  console.log('sample videoId', vid?.[1]);
  if (data.error) console.log('error detail', JSON.stringify(data.error).slice(0, 500));
}
