const url = 'https://www.youtube.com/@PASTELGHOSTx/videos';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const res = await fetch(url, {
  headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
  redirect: 'follow',
});
const html = await res.text();
const m = html.match(/ytInitialData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
const data = JSON.parse(m[1]);

function findRichItems(obj, out = [], depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 30) return out;
  if (Array.isArray(obj)) {
    obj.forEach((x) => findRichItems(x, out, depth + 1));
    return out;
  }
  if (obj.richItemRenderer) out.push(obj.richItemRenderer);
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') findRichItems(v, out, depth + 1);
  }
  return out;
}

const items = findRichItems(data);
console.log('rich items', items.length);
if (items[0]) {
  console.log('content keys', Object.keys(items[0].content || {}));
  console.log('sample content', JSON.stringify(items[0].content, null, 2).slice(0, 2500));
}

// Also check lockupViewModel / videoLockup etc
const str = JSON.stringify(data);
for (const key of [
  'lockupViewModel',
  'videoLockupViewModel',
  'shortsLockupViewModel',
  'compactVideoRenderer',
  'playlistVideoRenderer',
  'gridVideoRenderer',
  'videoRenderer',
  'reelItemRenderer',
]) {
  console.log(key, (str.match(new RegExp(`"${key}"`, 'g')) || []).length);
}
