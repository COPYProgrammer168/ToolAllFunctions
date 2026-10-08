import { chromium } from 'playwright';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ userAgent: UA, viewport: { width: 1280, height: 900 } });
try {
  page.on('response', async (res) => {
    if (/\/api\/post\/item_list\//i.test(res.url())) {
      const text = await res.text().catch(() => '');
      let n = -3; try { const j = JSON.parse(text || '{}'); n = Array.isArray(j.itemList) ? j.itemList.length : -2; } catch {}
      console.log('item_list', res.status(), 'len', text.length, 'count', n);
    }
  });
  await page.goto('https://www.tiktok.com/@kyukai168', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(4500);
  const info = await page.evaluate(() => {
    try {
      const el = document.querySelector('#__UNIVERSAL_DATA_FOR_REHYDRATION__');
      const d = JSON.parse(el.textContent || '{}');
      const ud = d.__DEFAULT_SCOPE__['webapp.user-detail'];
      return { status: ud?.statusCode, itemList: (ud?.userInfo?.itemList || []).length, links: document.querySelectorAll('a[href*="/video/"]').length, followerText: (document.querySelector('h1')?.textContent || '').slice(0,60), needLogin: ud?.needFix };
    } catch { return null; }
  });
  console.log('summary', JSON.stringify(info));
} catch(e) { console.log('ERR', e.message); }
await browser.close();
