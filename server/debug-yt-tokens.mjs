const url = 'https://www.youtube.com/@PASTELGHOSTx/videos';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const page = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
const html = await page.text();
const apiKey = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1];
const m = html.match(/ytInitialData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
const data = JSON.parse(m[1]);

const tokens = [];
function walk(obj, path = '', depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 40) return;
  if (Array.isArray(obj)) {
    obj.forEach((x, i) => walk(x, `${path}[${i}]`, depth + 1));
    return;
  }
  if (obj.continuationItemRenderer) {
    const t =
      obj.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token ||
      obj.continuationItemRenderer?.continuationEndpoint?.commandExecutorCommand?.commands?.find(
        (c) => c.continuationCommand?.token
      )?.continuationCommand?.token;
    if (t) tokens.push({ path: path.slice(-120), token: t.slice(0, 60), full: t });
  }
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object') walk(v, `${path}.${k}`, depth + 1);
  }
}
walk(data);
console.log('tokens', tokens.length);
tokens.forEach((t, i) => console.log(i, t.path, t.token));

for (let i = 0; i < tokens.length; i++) {
  const browse = await fetch(`https://www.youtube.com/youtubei/v1/browse?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({
      context: { client: { clientName: 'WEB', clientVersion: '2.20240726.01.00' } },
      continuation: tokens[i].full,
    }),
  });
  const next = await browse.json();
  const str = JSON.stringify(next);
  console.log(
    `token ${i}: lockups=${(str.match(/lockupViewModel/g) || []).length} contentIds=${(str.match(/"contentId":"/g) || []).length} about=${/aboutChannelRenderer/.test(str)}`
  );
}
