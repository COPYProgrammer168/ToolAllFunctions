const url = 'https://www.youtube.com/@PASTELGHOSTx/videos';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const page = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
const html = await page.text();
const apiKey = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1];
const m = html.match(/ytInitialData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
const data = JSON.parse(m[1]);

function findToken(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 40) return;
  if (Array.isArray(obj)) {
    for (const x of obj) {
      const t = findToken(x, depth + 1);
      if (t) return t;
    }
    return;
  }
  const t = obj.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
  if (t) return t;
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') {
      const found = findToken(v, depth + 1);
      if (found) return found;
    }
  }
}

const token = findToken(data);
const browse = await fetch(`https://www.youtube.com/youtubei/v1/browse?key=${apiKey}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
  body: JSON.stringify({
    context: { client: { clientName: 'WEB', clientVersion: '2.20240726.01.00' } },
    continuation: token,
  }),
});
const next = await browse.json();
console.log(JSON.stringify(next.onResponseReceivedEndpoints, null, 2).slice(0, 3000));
const str = JSON.stringify(next);
console.log('videoId count', (str.match(/"videoId":"/g) || []).length);
console.log('contentId count', (str.match(/"contentId":"/g) || []).length);
console.log('lockup count', (str.match(/lockupViewModel/g) || []).length);
console.log('appendContinuation', /appendContinuationItemsAction/.test(str));
console.log('reloadContinuation', /reloadContinuationItemsCommand/.test(str));
