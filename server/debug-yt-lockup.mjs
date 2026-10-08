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

function findLockups(obj, out = [], depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 30) return out;
  if (Array.isArray(obj)) {
    obj.forEach((x) => findLockups(x, out, depth + 1));
    return out;
  }
  if (obj.lockupViewModel) out.push(obj.lockupViewModel);
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') findLockups(v, out, depth + 1);
  }
  return out;
}

const lockups = findLockups(data);
const L = lockups[0];
console.log('top keys', Object.keys(L));
console.log('metadata keys', Object.keys(L.metadata || {}));
console.log('metadata', JSON.stringify(L.metadata, null, 2).slice(0, 4000));
console.log('---');
console.log('contentId', L.contentId);
console.log('rendererContext', JSON.stringify(L.rendererContext, null, 2).slice(0, 1500));
