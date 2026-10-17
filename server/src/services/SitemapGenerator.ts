import path from 'node:path';
import fs from 'node:fs/promises';
import { URL } from 'node:url';
import { nanoid } from 'nanoid';
import { STORAGE_ROOT } from '../utils/paths.js';
import { decodeEntities, extractTitle, fetchPage, type FetchedPage } from './SeoAnalyzer.js';

/**
 * Bounded, polite site crawler powering the sitemap generator and the
 * whole-site SEO analysis.
 *
 * Same-host breadth-first search with hard caps (page count, time budget,
 * concurrency), robots.txt aware, and every request goes through
 * SeoAnalyzer's SSRF-guarded fetchPage.
 */

const MAX_PAGES = 60;
const MAX_DISCOVERED = 600;
const CRAWL_CONCURRENCY = 4;
const CRAWL_BUDGET_MS = 45_000;
const PAGE_TIMEOUT_MS = 12_000;
const PAGE_MAX_BYTES = 4 * 1024 * 1024;
const ROBOTS_MAX_BYTES = 256 * 1024;
const SITEMAP_MAX_BYTES = 1024 * 1024;
const ROBOTS_TIMEOUT_MS = 8_000;

const PRIORITY_BY_DEPTH = [1.0, 0.8, 0.6] as const;
const DEFAULT_PRIORITY = 0.4;

export interface SitemapPage {
  loc: string;
  title: string;
  lastmod?: string;
  priority: number;
  depth: number;
}

export interface SitemapExisting {
  robotsFound: boolean;
  robotsUrl: string;
  sitemapLinks: string[];
}

export interface SitemapReport {
  url: string;
  site: string;
  origin: string;
  generatedAt: string;
  /** Where the generated file should live once uploaded. */
  sitemapUrl: string;
  existing: SitemapExisting;
  pages: SitemapPage[];
  xml: string;
  robotsSnippet: string;
  downloads: { xml: string; robots: string };
  notices: string[];
}

export interface CrawledPage {
  loc: string;
  title: string;
  html: string;
  lastModified?: string;
  depth: number;
}

export interface CrawlSiteResult {
  input: string;
  startUrl: string;
  siteHost: string;
  origin: string;
  pages: CrawledPage[];
  robots: { found: boolean; url: string; sitemapLinks: string[] };
  notices: string[];
}

/** Lowercase host without a leading www. so www/non-www count as one site. */
function stripWww(host: string): string {
  return host.toLowerCase().replace(/^www\./, '');
}

/** Canonical crawl form: no fragment, no lone trailing slash on subpaths. */
function normalizeUrl(raw: string): string {
  const u = new URL(raw);
  u.hash = '';
  let s = u.toString();
  if (u.pathname !== '/' && s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

function sameSite(url: string, siteHost: string): boolean {
  try {
    return stripWww(new URL(url).host) === siteHost;
  } catch {
    return false;
  }
}

/** Files that can never be HTML pages — skip without fetching. */
const ASSET_RE =
  /\.(?:jpg|jpeg|png|gif|webp|avif|svg|ico|bmp|tiff?|css|js|mjs|map|json|xml|txt|rss|atom|pdf|zip|rar|7z|gz|tar|mp4|m4v|mov|avi|mkv|webm|mp3|m4a|wav|ogg|flac|woff2?|ttf|otf|eot|docx?|xlsx?|pptx?|csv|exe|dmg|apk)$/i;

/** Collect absolute, same-site candidate links from a page's anchors. */
function extractLinksFromHtml(html: string, pageUrl: string): string[] {
  const out: string[] = [];
  const re = /<a\b[^>]*href\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = decodeEntities((m[2] ?? m[3] ?? m[4] ?? '').trim());
    if (!href || href.startsWith('#') || /^(mailto|tel|javascript|data):/i.test(href)) continue;
    try {
      const u = new URL(href, pageUrl);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
      if (ASSET_RE.test(u.pathname)) continue;
      out.push(normalizeUrl(u.toString()));
    } catch {
      /* ignore malformed hrefs */
    }
  }
  return out;
}

/** HTTP Last-Modified (RFC 1123) -> W3C date (YYYY-MM-DD) for sitemap lastmod. */
function toDateOnly(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString().slice(0, 10);
}

/** Run async workers over items with a fixed concurrency, never rejecting. */
async function runPool<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  size: number
): Promise<Array<PromiseSettledResult<R>>> {
  const results: Array<PromiseSettledResult<R>> = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(size, items.length)) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = { status: 'fulfilled', value: await worker(items[i]) };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  });
  await Promise.all(runners);
  return results;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildSitemapXml(pages: SitemapPage[]): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];
  for (const p of pages) {
    lines.push('  <url>');
    lines.push(`    <loc>${escapeXml(p.loc)}</loc>`);
    if (p.lastmod) lines.push(`    <lastmod>${p.lastmod}</lastmod>`);
    lines.push(`    <priority>${p.priority.toFixed(1)}</priority>`);
    lines.push('  </url>');
  }
  lines.push('</urlset>', '');
  return lines.join('\n');
}

function buildRobotsSnippet(origin: string): string {
  return ['User-agent: *', 'Allow: /', '', `Sitemap: ${origin}/sitemap.xml`, ''].join('\n');
}

interface RobotsRule {
  allow: boolean;
  raw: string;
}

interface RobotsInfo {
  found: boolean;
  url: string;
  sitemapLinks: string[];
  rules: RobotsRule[];
}

/** Compile a robots path pattern (\\* = any run, trailing $ = exact end). */
function robotsRuleRegex(raw: string): RegExp {
  const endAnchored = raw.endsWith('$');
  const core = endAnchored ? raw.slice(0, -1) : raw;
  const pattern = core.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp('^' + pattern + (endAnchored ? '$' : ''));
}

/** Read robots.txt: Sitemap directives plus Allow/Disallow rules for User-agent: *. */
async function loadRobots(origin: string): Promise<RobotsInfo> {
  const url = origin + '/robots.txt';
  try {
    const res = await fetchPage(url, { expect: 'any', maxBytes: ROBOTS_MAX_BYTES, timeoutMs: ROBOTS_TIMEOUT_MS });
    const sitemapLinks: string[] = [];
    const rules: RobotsRule[] = [];
    let agents: string[] = [];
    let seenDirective = false;

    for (const rawLine of res.html.split(/\r?\n/)) {
      const line = rawLine.split('#')[0].trim();
      if (!line) continue;
      const sep = line.indexOf(':');
      if (sep <= 0) continue;
      const key = line.slice(0, sep).trim().toLowerCase();
      const value = line.slice(sep + 1).trim();

      if (key === 'user-agent') {
        if (seenDirective) {
          agents = [];
          seenDirective = false;
        }
        agents.push(value.toLowerCase());
        continue;
      }

      if (key === 'disallow' || key === 'allow') {
        seenDirective = true;
        // Wildcard group only — named-bot groups (e.g. "Disallow: /" aimed at
        // HTTrack or Nutch) must not block our anonymous crawl.
        if (!agents.includes('*') || !value) continue;
        rules.push({ allow: key === 'allow', raw: value });
        continue;
      }

      if (key === 'sitemap' && value) {
        try {
          sitemapLinks.push(new URL(value, origin).toString());
        } catch {
          /* ignore malformed sitemap URL */
        }
      }
    }

    return { found: true, url, sitemapLinks: [...new Set(sitemapLinks)], rules };
  } catch {
    return { found: false, url, sitemapLinks: [], rules: [] };
  }
}

/** Longest-match Allow/Disallow evaluation (Google semantics, allow wins ties). */
function blockedByRobots(pageUrl: string, rules: RobotsRule[]): boolean {
  if (rules.length === 0) return false;
  let pathname = '/';
  try {
    pathname = new URL(pageUrl).pathname;
  } catch {
    return false;
  }

  let bestLength = -1;
  let blocked = false;
  for (const rule of rules) {
    if (!robotsRuleRegex(rule.raw).test(pathname)) continue;
    const length = rule.raw.replace(/\*/g, '').length;
    if (length > bestLength || (length === bestLength && rule.allow)) {
      bestLength = length;
      blocked = !rule.allow;
    }
  }
  return blocked;
}

/** Page URLs listed in the first existing sitemap (single file, no recursion). */
async function harvestSitemapUrls(links: string[]): Promise<string[]> {
  const first = links[0];
  if (!first) return [];
  try {
    const res = await fetchPage(first, { expect: 'any', maxBytes: SITEMAP_MAX_BYTES, timeoutMs: ROBOTS_TIMEOUT_MS });
    const urls: string[] = [];
    const re = /<\s*loc\s*>\s*([^<]+?)\s*<\/\s*loc\s*>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(res.html))) {
      const loc = decodeEntities(m[1]).trim();
      if (/^https?:\/\//i.test(loc)) urls.push(loc);
      if (urls.length >= MAX_PAGES) break;
    }
    return urls;
  } catch {
    return [];
  }
}

/**
 * Crawl a site from one seed URL and return the pages' HTML.
 * Shared by the sitemap generator and the whole-site SEO analysis.
 */
export async function crawlSite(rawUrl: string, opts: { maxPages?: number } = {}): Promise<CrawlSiteResult> {
  const maxPages = opts.maxPages ?? MAX_PAGES;
  const input = (rawUrl || '').trim();
  if (!/^https?:\/\//i.test(input)) {
    throw new Error('Enter a full website URL starting with http:// or https://.');
  }

  // The seed page must load — this surfaces clear errors (bad host, 404, non-HTML).
  const first = await fetchPage(input, { maxBytes: PAGE_MAX_BYTES, timeoutMs: PAGE_TIMEOUT_MS });
  const startUrl = normalizeUrl(first.finalUrl);
  const siteHost = stripWww(new URL(startUrl).host);
  const origin = new URL(startUrl).origin;

  const notices: string[] = [];
  const robots = await loadRobots(origin);

  const visited = new Set<string>([startUrl]);
  const pages: CrawledPage[] = [
    { loc: startUrl, title: extractTitle(first.html), html: first.html, lastModified: first.lastModified, depth: 0 },
  ];
  const queue: Array<{ url: string; depth: number }> = [];
  const queued = new Set<string>();

  const acceptCandidate = (url: string, depth: number) => {
    if (visited.has(url) || queued.has(url)) return;
    if (queued.size >= MAX_DISCOVERED) return;
    if (!sameSite(url, siteHost)) return;
    if (blockedByRobots(url, robots.rules)) return;
    queued.add(url);
    queue.push({ url, depth });
  };

  for (const link of extractLinksFromHtml(first.html, startUrl)) acceptCandidate(link, 1);
  if (origin + '/' !== startUrl) acceptCandidate(origin + '/', 0);

  const started = Date.now();
  let capped = false;
  while (queue.length > 0 && pages.length < maxPages) {
    if (Date.now() - started > CRAWL_BUDGET_MS) {
      capped = true;
      break;
    }

    const batch = queue.splice(0, Math.min(CRAWL_CONCURRENCY, maxPages - pages.length));
    const settled = await runPool(
      batch,
      async (item) => {
        const res = await fetchPage(item.url, { maxBytes: PAGE_MAX_BYTES, timeoutMs: PAGE_TIMEOUT_MS });
        return { item, res };
      },
      CRAWL_CONCURRENCY
    );

    for (const s of settled) {
      if (s.status !== 'fulfilled') continue;
      const { item, res } = s.value;
      const finalUrl = normalizeUrl(res.finalUrl);
      if (!sameSite(finalUrl, siteHost) || visited.has(finalUrl)) continue;
      visited.add(finalUrl);
      pages.push({
        loc: finalUrl,
        title: extractTitle(res.html),
        html: res.html,
        lastModified: res.lastModified,
        depth: item.depth,
      });

      for (const link of extractLinksFromHtml(res.html, finalUrl)) {
        acceptCandidate(link, item.depth + 1);
      }
    }
  }

  if (pages.length >= maxPages) {
    notices.push(`Reached the ${maxPages}-page cap — the analysis covers the first ${maxPages} pages found.`);
  } else if (capped || queue.length > 0) {
    notices.push(`Stopped at the ${Math.round(CRAWL_BUDGET_MS / 1000)}-second crawl budget with ${pages.length} pages.`);
  }
  if (pages.length === 1 && queue.length === 0) {
    notices.push(
      'Only one HTML page could be discovered from this URL — the site may be a single-page app or block crawlers.'
    );
  }

  return {
    input,
    startUrl,
    siteHost,
    origin,
    pages,
    robots: { found: robots.found, url: robots.url, sitemapLinks: robots.sitemapLinks },
    notices,
  };
}

const SITEMAP_CANDIDATE_PATHS = ['/sitemap.xml', '/sitemap_index.xml', '/sitemap-index.xml'];

export class SitemapGenerator {
  /** Crawl a site and produce a sitemap.xml + robots.txt snippet with downloads. */
  static async generate(rawUrl: string): Promise<SitemapReport> {
    const crawl = await crawlSite(rawUrl, { maxPages: MAX_PAGES });
    const { input, siteHost, origin, robots } = crawl;
    const notices = [...crawl.notices];

    // Detect existing sitemaps: robots.txt directives plus well-known paths.
    const sitemapLinks = new Set(robots.sitemapLinks);
    const checks = await Promise.allSettled(
      SITEMAP_CANDIDATE_PATHS.map((p) =>
        fetchPage(origin + p, { expect: 'any', maxBytes: SITEMAP_MAX_BYTES, timeoutMs: ROBOTS_TIMEOUT_MS })
      )
    );
    checks.forEach((r, i) => {
      if (r.status === 'fulfilled') sitemapLinks.add(origin + SITEMAP_CANDIDATE_PATHS[i]);
    });
    const existing: SitemapExisting = {
      robotsFound: robots.found,
      robotsUrl: robots.url,
      sitemapLinks: [...sitemapLinks],
    };

    const pages: SitemapPage[] = crawl.pages.map((p) => ({
      loc: p.loc,
      title: p.title,
      lastmod: toDateOnly(p.lastModified),
      priority: PRIORITY_BY_DEPTH[p.depth] ?? DEFAULT_PRIORITY,
      depth: p.depth,
    }));

    // Merge URLs from an existing sitemap so already-published pages are kept.
    if (existing.sitemapLinks.length > 0 && pages.length < MAX_PAGES) {
      const visited = new Set(pages.map((p) => p.loc));
      const harvested = await harvestSitemapUrls(existing.sitemapLinks);
      let merged = 0;
      for (const loc of harvested) {
        if (pages.length >= MAX_PAGES) break;
        let normalized: string;
        try {
          normalized = normalizeUrl(loc);
        } catch {
          continue;
        }
        if (!sameSite(normalized, siteHost) || visited.has(normalized)) continue;
        try {
          if (ASSET_RE.test(new URL(normalized).pathname)) continue;
        } catch {
          continue;
        }
        visited.add(normalized);
        pages.push({ loc: normalized, title: '', priority: 0.6, depth: 1 });
        merged++;
      }
      if (merged > 0) notices.push(`Merged ${merged} extra URL(s) from the site's existing sitemap.`);
    }

    pages.sort((a, b) => a.depth - b.depth || a.loc.localeCompare(b.loc));

    const xml = buildSitemapXml(pages);
    const robotsSnippet = buildRobotsSnippet(origin);

    // Persist both files so the UI can hand out download links.
    const seoDir = path.join(STORAGE_ROOT, 'seo');
    await fs.mkdir(seoDir, { recursive: true });
    const stamp = Date.now();
    const xmlPath = path.join(seoDir, `sitemap_${stamp}_${nanoid(6)}.xml`);
    const robotsPath = path.join(seoDir, `robots_${stamp}_${nanoid(6)}.txt`);
    await Promise.all([
      fs.writeFile(xmlPath, xml, 'utf8'),
      fs.writeFile(robotsPath, robotsSnippet, 'utf8'),
    ]);

    const fileUrl = (p: string, name: string) =>
      `/api/media/file?path=${encodeURIComponent(p)}&name=${encodeURIComponent(name)}`;

    return {
      url: input,
      site: siteHost,
      origin,
      generatedAt: new Date().toISOString(),
      sitemapUrl: `${origin}/sitemap.xml`,
      existing,
      pages,
      xml,
      robotsSnippet,
      downloads: {
        xml: fileUrl(xmlPath, 'sitemap.xml'),
        robots: fileUrl(robotsPath, 'robots.txt'),
      },
      notices,
    };
  }
}



