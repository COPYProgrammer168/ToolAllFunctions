// Responsive audit for the Font Studio page: opens the running Vite dev server,
// walks the page at phone/tablet/desktop widths and reports any element that
// overflows the viewport horizontally, plus a full-page screenshot per width.
//
// Usage: node test/audit-font-studio-responsive.mjs [baseUrl]
// Requires the client dev server (npm run dev in ../client).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] || 'http://localhost:5173';
const OUT_DIR = path.join(process.env.TEMP || __dirname, 'font-studio-audit');

const VIEWPORTS = [
  { name: 'phone-360', width: 360, height: 780 },
  { name: 'phone-390', width: 390, height: 844 },
  { name: 'phone-414', width: 414, height: 896 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'laptop-1024', width: 1024, height: 768 },
  { name: 'laptop-1280', width: 1280, height: 800 },
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'wide-1920', width: 1920, height: 1080 },
];

const OVERFLOW_PROBE = () => {
  const vw = document.documentElement.clientWidth;
  const bad = [];
  // `clipped` = an ancestor already scrolls/clips horizontally, so anything
  // sticking out there is that container's own scrollbar, not page overflow.
  const walk = (el, clipped = false) => {
    if (!(el instanceof HTMLElement)) return;
    // Decorative background layers live in a fixed, overflow-hidden scene and
    // never affect layout — they would only add noise here.
    if (el.closest('.bg-scene')) return;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    const overflowRight = Math.round(r.right - vw);
    const overflowLeft = Math.round(-r.left);
    if (!clipped && (overflowRight > 1 || overflowLeft > 1)) {
      const cls = (el.className || '').toString().slice(0, 140);
      bad.push({
        tag: el.tagName.toLowerCase(),
        cls,
        text: (el.textContent || '').trim().slice(0, 60),
        left: Math.round(r.left),
        right: Math.round(r.right),
        width: Math.round(r.width),
      });
    }
    const selfClips = style.overflowX !== 'visible';
    for (const child of el.children) walk(child, clipped || selfClips);
  };
  walk(document.body);
  return {
    viewportWidth: vw,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    overflowing: bad.slice(0, 25),
    overflowCount: bad.length,
  };
};

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const report = [];

  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await context.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });

    // Open the Font Studio section (sidebar collapses into a drawer on phones).
    const navItem = page.getByText('Font Studio', { exact: true }).first();
    if (!(await navItem.isVisible().catch(() => false))) {
      // try the sidebar toggle (any button that reveals the navigation)
      const toggles = await page.locator('button[aria-label*="menu" i], button[aria-label*="sidebar" i], button[aria-label*="navigation" i]').all();
      for (const t of toggles) {
        await t.click({ timeout: 2000 }).catch(() => {});
        if (await navItem.isVisible().catch(() => false)) break;
      }
    }
    await navItem.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);

    // Fill the input so the results grid renders too.
    const input = page.getByLabel('Your Text');
    if (await input.isVisible().catch(() => false)) {
      await input.fill('Responsive audit 123');
      await page.waitForSelector('[aria-label="Generated styles"]', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(400);
    } else {
      console.log(`[${vp.name}] Font Studio input not visible — section may not have opened`);
    }

    const metrics = await page.evaluate(OVERFLOW_PROBE);
    const shot = path.join(OUT_DIR, `${vp.name}.png`);
    await page.screenshot({ path: shot, fullPage: true });

    report.push({ viewport: vp, metrics, screenshot: shot });
    const ok = metrics.overflowCount === 0 && metrics.scrollWidth <= metrics.viewportWidth + 1;
    console.log(
      `${ok ? 'OK  ' : 'FAIL'} ${vp.name} vw=${metrics.viewportWidth} scrollWidth=${metrics.scrollWidth} overflowing=${metrics.overflowCount}`
    );
    if (!ok) {
      for (const b of metrics.overflowing.slice(0, 8)) {
        console.log(`       <${b.tag}> right=${b.right} width=${b.width} text="${b.text}" class=${b.cls}`);
      }
    }
    await context.close();
  }

  await browser.close();
  fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`\nScreenshots + report.json -> ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
