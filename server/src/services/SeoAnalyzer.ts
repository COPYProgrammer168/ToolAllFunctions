import { URL } from 'node:url';
import { validateRemoteUrl } from '../utils/security.js';

/**
 * SEO & GEO (Generative Engine Optimization) website analyzer.
 *
 * Fetches a public web page with a static HTTP request, extracts its on-page
 * SEO signal (title, meta, headings, links, images, structured data) and
 * derives ready-to-paste content: SEO keywords, GEO / AI-search question
 * phrasings, H1 suggestions, meta description drafts, hashtags, meta keyword
 * tags and social captions.
 *
 * Everything is computed locally from the page text — no external API and no
 * LLM required. Pages that render entirely with JavaScript are detected and
 * reported honestly instead of silently returning empty results.
 */

const MAX_HTML_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 5;

const USER_AGENT =
  'Mozilla/5.0 (compatible; VideoOptimizeSeoBot/1.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

export interface SeoKeyword {
  term: string;
  count: number;
  /** 0-100 relative importance (the top keyword = 100). */
  score: number;
  inTitle: boolean;
  inHeadings: boolean;
}

export interface SeoPageInfo {
  title: string;
  metaDescription: string;
  metaKeywords: string;
  language: string;
  h1: string[];
  h2: string[];
  h3: string[];
  wordCount: number;
  imageCount: number;
  imagesMissingAlt: number;
  internalLinks: number;
  externalLinks: number;
  hasCanonical: boolean;
  hasOpenGraph: boolean;
  hasTwitterCard: boolean;
  hasStructuredData: boolean;
  openGraph: {
    title?: string;
    description?: string;
    image?: string;
    type?: string;
  };
}

export interface SeoCaptionDraft {
  platform: string;
  label: string;
  text: string;
}

export interface SeoReport {
  url: string;
  finalUrl: string;
  siteName: string;
  fetchedAt: string;
  page: SeoPageInfo;
  seoKeywords: SeoKeyword[];
  geoKeywords: string[];
  geoQuestions: string[];
  h1Suggestions: string[];
  metaDescriptions: string[];
  hashtags: string[];
  metaKeywordTags: string[];
  captions: SeoCaptionDraft[];
  issues: string[];
  notices: string[];
}

interface FetchedPage {
  html: string;
  finalUrl: string;
}

/**
 * Fetch a page while re-validating every redirect hop against the SSRF guard,
 * capping the body size and enforcing a hard timeout.
 */
async function fetchPage(rawUrl: string): Promise<FetchedPage> {
  let current = rawUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const check = await validateRemoteUrl(current);
    if (!check.valid || !check.normalizedUrl) {
      throw new Error(check.error || 'The URL is not allowed.');
    }
    current = check.normalizedUrl;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
          'Accept-Language': 'en-US,en;q=0.8',
        },
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        await res.body?.cancel().catch(() => {});
        if (!location) {
          throw new Error(`The website sent a redirect without a destination (HTTP ${res.status}).`);
        }
        current = new URL(location, current).toString();
        continue;
      }

      if (!res.ok) {
        throw new Error(`The website responded with HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}.`);
      }

      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
        throw new Error(
          `The URL did not return an HTML page (content-type: ${contentType || 'unknown'}). Open a regular website page instead.`
        );
      }

      const contentLength = Number(res.headers.get('content-length') || 0);
      if (contentLength > MAX_HTML_BYTES) {
        throw new Error('The page is too large to analyze (over 5 MB of HTML).');
      }

      const html = await readBodyCapped(res, MAX_HTML_BYTES);
      return { html, finalUrl: current };
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        throw new Error('The website took too long to respond (20 second limit).');
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error('The website redirected too many times (limit: 5 hops).');
}

/** Read a response body as UTF-8, aborting once the byte cap is exceeded. */
async function readBodyCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let received = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error('The page is too large to analyze (over 5 MB of HTML).');
    }
    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks).toString('utf8');
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”',
  trade: '™', copy: '©', reg: '®', middot: '·', bull: '•',
  eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç', uuml: 'ü', ouml: 'ö', auml: 'ä', szlig: 'ß',
};

export function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z][a-z0-9]+);/gi, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

function safeCodePoint(code: number): string {
  if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

export function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

/** Class/id fragments that almost always hold navigation or citation chrome. */
const NOISE_BLOCK =
  'reflist|references|reference|footnotes|footnote|citation|navbox|catlinks|mw-editsection|sidebar|metadata|printfooter|mw-navigation|vector-toc';

/** Strip scripts/styles/markup and return the visible text of a fragment. */
export function htmlToText(html: string, opts: { dropNavChrome?: boolean } = {}): string {
  let out = html;
  out = out.replace(/<script\b[\s\S]*?<\/script>/gi, ' ');
  out = out.replace(/<style\b[\s\S]*?<\/style>/gi, ' ');
  out = out.replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ');
  out = out.replace(/<template\b[\s\S]*?<\/template>/gi, ' ');
  out = out.replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ');
  out = out.replace(/<iframe\b[\s\S]*?<\/iframe>/gi, ' ');
  out = out.replace(/<sup\b[\s\S]*?<\/sup>/gi, ' ');
  out = out.replace(/<!--[\s\S]*?-->/g, ' ');
  if (opts.dropNavChrome) {
    out = out.replace(/<(nav|footer|header|aside)\b[\s\S]*?<\/\1>/gi, ' ');
    const noiseRe = new RegExp(
      `<(div|ol|ul|table|section|span)\\b[^>]*(?:class|id)\\s*=\\s*("[^"]*(?:${NOISE_BLOCK})[^"]*"|'[^']*(?:${NOISE_BLOCK})[^']*')[^>]*>[\\s\\S]*?<\\/\\1>`,
      'gi'
    );
    out = out.replace(noiseRe, ' ');
  }
  out = out.replace(/<[^>]+>/g, ' ');
  out = out
    .replace(/\[\s*(?:\d+|edit|citation needed|note\s*\d+)\s*\]/gi, ' ')
    .replace(/\[\s*\d+\s*\]/g, ' ');
  return normalizeWhitespace(decodeEntities(out));
}

/** Read an attribute value from a single tag string. */
function attr(tag: string, name: string): string {
  const re = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i');
  const m = re.exec(tag);
  const raw = m?.[2] ?? m?.[3] ?? m?.[4] ?? '';
  return decodeEntities(raw.trim());
}

function extractMeta(html: string): Record<string, string> {
  const map: Record<string, string> = {};
  const re = /<meta\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const key = attr(m[0], 'name') || attr(m[0], 'property') || attr(m[0], 'itemprop');
    const content = attr(m[0], 'content');
    if (key && content) map[key.toLowerCase()] = content;
  }
  return map;
}

function extractHeadings(html: string, level: 1 | 2 | 3): string[] {
  const re = new RegExp(`<h${level}\\b[^>]*>([\\s\\S]*?)<\\/h${level}>`, 'gi');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const text = normalizeWhitespace(decodeEntities(m[1].replace(/<[^>]+>/g, ' ')));
    if (text) out.push(text);
  }
  return out;
}

function countImages(html: string): { total: number; missingAlt: number } {
  const re = /<img\b[^>]*>/gi;
  let total = 0;
  let missingAlt = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    total += 1;
    if (!attr(m[0], 'alt')) missingAlt += 1;
  }
  return { total, missingAlt };
}

function countLinks(html: string, pageUrl: string): { internal: number; external: number } {
  let host = '';
  try {
    host = new URL(pageUrl).host;
  } catch {
    /* keep empty */
  }

  const re = /<a\b[^>]*href\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))[^>]*>/gi;
  let internal = 0;
  let external = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = decodeEntities((m[2] ?? m[3] ?? m[4] ?? '').trim());
    if (!href || href.startsWith('#') || /^(mailto|tel|javascript|data):/i.test(href)) continue;
    try {
      const u = new URL(href, pageUrl);
      if (u.host === host) internal += 1;
      else external += 1;
    } catch {
      /* ignore malformed hrefs */
    }
  }
  return { internal, external };
}

const STOPWORDS = new Set(
  (
    'a about above after again against all also am an and any are as at be because been before being below ' +
    'between both but by can cannot could did do does doing done down during each few for from further get got ' +
    'had has have having he her here hers herself him himself his how i if in into is it its itself just let me ' +
    'more most my myself no nor not of off on once only or other ought our ours ourselves out over own same she ' +
    'should so some such than that the their theirs them themselves then there these they this those through to ' +
    'too under until up very was we were what when where which while who whom why will with would you your yours ' +
    'yourself yourselves aren couldn didn doesn isn wasn weren won wouldn shouldn hasn haven hadn mustn shan t s d ' +
    'll re ve m home menu login sign signin signup subscribe newsletter cookie cookies privacy policy ' +
    'terms contact us click read more learn share follow loading skip toggle close open window data page site ' +
    'website web online view all new post posts comment comments related tag tags category published updated ' +
    'powered rights reserved copyright email address phone number ' +
    'may might must shall will says said according retrieved archived archive wayback webarchive permalink ' +
    'citation cited footnote footnotes isbn doi pmid issn oclc jump free encyclopedia discuss improve talk ' +
    'article portal toolbar navigation sidebar please file files pages'
  ).split(/\s+/)
);

const TOKEN_RE = /[\p{L}\p{N}][\p{L}\p{N}''-]*/gu;

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(TOKEN_RE) || [])
    .map((t) => t.replace(/^[''-]+|[''-]+$/g, ''))
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
}

function buildKeywords(bodyText: string, title: string, headingText: string): SeoKeyword[] {
  const tokens = tokenize(bodyText);
  const titleLower = normalizeWhitespace(title.toLowerCase());
  const headingsLower = headingText.toLowerCase();

  const counts = new Map<string, number>();
  const addPhrase = (term: string) => counts.set(term, (counts.get(term) || 0) + 1);

  for (let i = 0; i < tokens.length; i++) {
    addPhrase(tokens[i]);
    if (i + 1 < tokens.length) addPhrase(`${tokens[i]} ${tokens[i + 1]}`);
    if (i + 2 < tokens.length) addPhrase(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
  }

  const scored: SeoKeyword[] = [];
  for (const [term, count] of counts) {
    if (count < 2) continue;
    const words = term.split(' ');
    if (words.length > 1 && count < 2) continue;

    const inTitle = titleLower.includes(term);
    const inHeadings = headingsLower.includes(term);
    let score = count * (1 + 0.35 * (words.length - 1));
    if (inTitle) score *= 1.6;
    if (inHeadings) score *= 1.2;

    scored.push({ term, count, score, inTitle, inHeadings });
  }

  scored.sort((a, b) => b.score - a.score || b.count - a.count || a.term.localeCompare(b.term));

  // Drop phrase candidates that a longer phrase of equal weight already covers.
  const picked: SeoKeyword[] = [];
  const seen = new Set<string>();
  for (const k of scored) {
    if (seen.has(k.term)) continue;
    if (picked.length >= 24) break;
    seen.add(k.term);
    picked.push(k);
  }

  const top = picked[0]?.score || 1;
  return picked.map((k) => ({ ...k, score: Math.round((k.score / top) * 100) }));
}

/** Promotional/navigational boilerplate that should never become a caption. */
const SENTENCE_NOISE =
  /jump to|from wikipedia|free encyclopedia|redirected here|please help|talk page|wayback machine|archived (from|on|at)|retrieved (on|from)|cookie|subscribe|newsletter|sign ?in|log ?in|privacy policy|terms of (use|service)|all rights reserved|follow us|share (this|on)|citation needed/i;

/** Reasonable sentences (length- and noise-filtered) for descriptions and captions. */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[\p{Lu}\p{N}"'“([])/u)
    .map((s) => normalizeWhitespace(s.replace(/^(\s*\([^)]*\)\s*)+/, '')))
    .filter((s) => s.length >= 45 && s.length <= 240 && !SENTENCE_NOISE.test(s));
}

const QUESTION_START =
  /^(what|how|why|when|where|who|which|whose|can|could|do|does|did|is|are|was|were|should|would|will|may|might|must)\b/i;

/** Question-like sentences the page already contains (AI engines love these). */
function extractQuestions(sentences: string[]): string[] {
  const out: string[] = [];
  for (const s of sentences) {
    if (s.length > 180) continue;
    if (s.endsWith('?') || QUESTION_START.test(s)) out.push(s);
    if (out.length >= 10) break;
  }
  return dedupe(out);
}

const GEO_PATTERNS: Array<(term: string) => string> = [
  (t) => `what is ${t}`,
  (t) => `how does ${t} work`,
  (t) => `best ${t} in ${new Date().getFullYear()}`,
  (t) => `${t} explained`,
  (t) => `is ${t} worth it`,
  (t) => `${t} vs alternatives`,
  (t) => `${t} tips and best practices`,
  (t) => `how to choose ${t}`,
];

/** Conversational angle phrases derived from the top ranking keywords. */
function buildGeoKeywords(keywords: SeoKeyword[]): string[] {
  // Multi-word phrases read naturally in questions, so they seed first.
  const phraseSeeds = keywords.filter((k) => k.term.includes(' ')).slice(0, 4);
  const wordSeeds = keywords.filter((k) => !k.term.includes(' ')).slice(0, 3);
  const seeds = [...phraseSeeds, ...wordSeeds].slice(0, 7).map((k) => k.term);
  const out: string[] = [];
  seeds.forEach((seed, i) => {
    for (let p = 0; p < 2; p++) {
      const phrase = GEO_PATTERNS[(i * 2 + p) % GEO_PATTERNS.length](seed);
      if (!out.includes(phrase)) out.push(phrase);
    }
  });
  return out.slice(0, 14);
}

function dedupe(list: string[]): string[] {
  return [...new Set(list)];
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function toTitleCase(input: string): string {
  return input
    .split(' ')
    .map((w) => (w.length <= 2 && !/^\d+$/.test(w) ? w : capitalize(w)))
    .join(' ');
}

/** Strip site-name suffixes ("Title | Brand") keeping the meaningful part. */
function cleanTitle(title: string, primary: string): string {
  const parts = title
    .split(/\s*[|•·—–-]\s*/)
    .map((p) => normalizeWhitespace(p))
    .filter(Boolean);
  if (parts.length <= 1) return normalizeWhitespace(title);
  const withPrimary = parts.find((p) => p.toLowerCase().includes(primary));
  if (withPrimary && withPrimary.length >= 12) return withPrimary;
  return parts.reduce((a, b) => (b.length > a.length ? b : a), parts[0]);
}

function clampSentence(text: string, limit: number): string {
  const t = normalizeWhitespace(text);
  if (t.length <= limit) return t;
  const cut = t.slice(0, limit - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
}

function buildH1Suggestions(title: string, keywords: SeoKeyword[], primary: string): string[] {
  const secondary = keywords.find((k) => !k.term.includes(' ') && k.term !== primary && !primary.includes(k.term))
    ?.term;
  const base = cleanTitle(title, primary) || toTitleCase(primary);
  const kw = toTitleCase(primary);
  const year = new Date().getFullYear();

  if (!primary) return base ? [base] : [];

  const out = [
    base,
    `${kw} — Complete Guide for ${year}`,
    `${kw}: Tips, Examples & Best Practices`,
    `The Ultimate ${kw} Guide`,
  ];
  if (secondary && !secondary.includes(' ') && secondary !== primary) {
    out.push(`${kw} vs ${toTitleCase(secondary)}: What to Choose`);
  }
  return dedupe(out.map(normalizeWhitespace).filter(Boolean)).slice(0, 5);
}

function buildMetaDescriptions(
  pageDescription: string,
  sentences: string[],
  primary: string
): string[] {
  const out: string[] = [];
  const push = (s: string) => {
    const t = normalizeWhitespace(s);
    if (!t || t.length < 60) return;
    const clamped = clampSentence(t, 165);
    if (!out.includes(clamped)) out.push(clamped);
  };

  if (pageDescription) push(pageDescription);

  const ranked = [...sentences].sort((a, b) => {
    const scoreA = (a.toLowerCase().includes(primary) ? 3 : 0) + Math.min(a.length, 160) / 100;
    const scoreB = (b.toLowerCase().includes(primary) ? 3 : 0) + Math.min(b.length, 160) / 100;
    return scoreB - scoreA;
  });
  for (const s of ranked.slice(0, 4)) push(s);

  if (out.length < 3 && primary) {
    push(`Everything you need to know about ${toTitleCase(primary)}. ${ranked[0] || ''}`.trim());
  }

  return out.slice(0, 4);
}

function buildHashtags(keywords: SeoKeyword[]): string[] {
  const out: string[] = [];
  for (const k of keywords) {
    const tag =
      '#' +
      k.term
        .split(' ')
        .map((w) => (w.length <= 3 ? w.toUpperCase() : capitalize(w)))
        .join('');
    if (!out.includes(tag)) out.push(tag);
    if (out.length >= 15) break;
  }
  return out;
}

function buildCaptions(
  url: string,
  title: string,
  keywords: SeoKeyword[],
  sentences: string[],
  hashtags: string[],
  primary: string
): SeoCaptionDraft[] {
  const hook = toTitleCase(cleanTitle(title, primary) || primary);
  const keyPhrases = keywords
    .slice(0, 3)
    .map((k) => toTitleCase(k.term))
    .join(' • ');
  const topSentences = sentences.slice(0, 2);
  const tags = hashtags.slice(0, 12).join(' ');

  const short = [`${hook}`, topSentences[0] ? `\n${clampSentence(topSentences[0], 180)}` : '', `\n🔗 ${url}`]
    .join('')
    .trim();

  const social = [
    `${hook} ✨`,
    topSentences[0] ? `\n${clampSentence(topSentences[0], 220)}` : '',
    topSentences[1] ? `\n${clampSentence(topSentences[1], 220)}` : '',
    `\n📌 Save this for later`,
    `\n🔗 ${url}`,
    `\n\n${tags}`,
  ]
    .join('')
    .trim();

  const professional = [
    `${hook}`,
    topSentences[0] ? `\n\n${clampSentence(topSentences[0], 260)}` : '',
    keyPhrases ? `\n\nKey topics: ${keyPhrases}` : '',
    `\n\nRead more: ${url}`,
  ]
    .join('')
    .trim();

  const videoDescription = [
    hook,
    topSentences[0] ? `\n\n${clampSentence(topSentences[0], 240)}` : '',
    keyPhrases ? `\n\nIn this page: ${keyPhrases}` : '',
    `\n\n🔗 ${url}`,
    `\n\n${hashtags.slice(0, 6).join(' ')}`,
  ]
    .join('')
    .trim();

  return [
    { platform: 'x', label: 'X / Twitter post', text: clampSentence(short, 280) },
    { platform: 'social', label: 'Instagram / TikTok caption', text: clampSentence(social, 2200) },
    { platform: 'linkedin', label: 'LinkedIn / Facebook post', text: clampSentence(professional, 1400) },
    { platform: 'youtube', label: 'YouTube description', text: clampSentence(videoDescription, 1600) },
  ];
}

function buildIssues(page: SeoPageInfo): string[] {
  const issues: string[] = [];
  const titleLen = page.title.length;
  if (!page.title) issues.push('Missing <title> tag — search results will show a fallback title.');
  else if (titleLen < 30 || titleLen > 65) {
    issues.push(`Title is ${titleLen} characters — the sweet spot is 30–60 so it does not get truncated.`);
  }

  const descLen = page.metaDescription.length;
  if (!page.metaDescription) issues.push('Missing meta description — search engines will invent a snippet.');
  else if (descLen < 110 || descLen > 165) {
    issues.push(`Meta description is ${descLen} characters — aim for 120–160.`);
  }

  if (page.h1.length === 0) issues.push('Missing H1 heading — add one that contains your primary keyword.');
  else if (page.h1.length > 1) issues.push(`${page.h1.length} H1 headings found — keep exactly one per page.`);

  if (page.imageCount > 0 && page.imagesMissingAlt > 0) {
    issues.push(`${page.imagesMissingAlt} of ${page.imageCount} images are missing alt text.`);
  }
  if (!page.hasCanonical) issues.push('No canonical link — add one to consolidate duplicate URLs.');
  if (!page.hasOpenGraph) issues.push('No Open Graph tags — social shares will not show a rich preview.');
  if (!page.hasTwitterCard) issues.push('No Twitter card tags — X shares will fall back to a plain link.');
  if (!page.hasStructuredData) issues.push('No JSON-LD structured data — add schema.org markup for rich results.');
  if (page.wordCount > 0 && page.wordCount < 300) {
    issues.push(`Thin content: only ${page.wordCount} words of visible text were found.`);
  }
  if (!page.language) issues.push('The <html> tag has no lang attribute.');
  return issues;
}

function extractTitle(html: string): string {
  const m = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? normalizeWhitespace(decodeEntities(m[1])) : '';
}

function hasLinkRel(html: string, rel: string): boolean {
  const re = /<link\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const relValue = attr(m[0], 'rel').toLowerCase();
    if (relValue.split(/\s+/).includes(rel)) return true;
  }
  return false;
}

export class SeoAnalyzer {
  /** Fetch a public web page and derive the full SEO/GEO content report. */
  static async analyze(rawUrl: string): Promise<SeoReport> {
    const input = (rawUrl || '').trim();
    if (!/^https?:\/\//i.test(input)) {
      throw new Error('Enter a full website URL starting with http:// or https://.');
    }

    const { html, finalUrl } = await fetchPage(input);
    const meta = extractMeta(html);
    const notices: string[] = [];

    const title = normalizeWhitespace(extractTitle(html) || meta['og:title'] || '');
    const metaDescription = normalizeWhitespace(meta['description'] || meta['og:description'] || '');
    const htmlTag = /<html\b[^>]*>/i.exec(html)?.[0] || '';
    const language = attr(htmlTag, 'lang');
    const h1 = extractHeadings(html, 1);
    const h2 = extractHeadings(html, 2);
    const h3 = extractHeadings(html, 3);

    const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html);
    const bodyHtml = bodyMatch ? bodyMatch[1] : html;
    const visibleText = htmlToText(bodyHtml, { dropNavChrome: true });
    const wordCount = (visibleText.match(/[\p{L}\p{N}]+/gu) || []).length;

    if (wordCount < 80) {
      notices.push(
        html.length > 60_000
          ? 'This page appears to render its content with JavaScript, so a static fetch may have missed text. ' +
              'For single-page apps, analyze a server-rendered page or add pre-rendered HTML for crawlers.'
          : 'This page has very little visible text, so keyword, description and caption suggestions are limited.'
      );
    }

    const { total: imageCount, missingAlt: imagesMissingAlt } = countImages(bodyHtml);
    const { internal: internalLinks, external: externalLinks } = countLinks(bodyHtml, finalUrl);

    const ogKeys = Object.keys(meta).filter((k) => k.startsWith('og:'));
    const hasStructuredData = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["']/i.test(html);

    const sentences = splitSentences(visibleText);
    const keywords = buildKeywords(visibleText, title, [...h1, ...h2, ...h3].join(' '));
    const geoQuestions = extractQuestions(sentences);

    const page: SeoPageInfo = {
      title,
      metaDescription,
      metaKeywords: meta['keywords'] || '',
      language,
      h1,
      h2,
      h3,
      wordCount,
      imageCount,
      imagesMissingAlt,
      internalLinks,
      externalLinks,
      hasCanonical: hasLinkRel(html, 'canonical'),
      hasOpenGraph: ogKeys.length > 0,
      hasTwitterCard: Object.keys(meta).some((k) => k.startsWith('twitter:')),
      hasStructuredData,
      openGraph: {
        title: meta['og:title'],
        description: meta['og:description'],
        image: meta['og:image'],
        type: meta['og:type'],
      },
    };

    let siteName = meta['og:site_name'] || '';
    if (!siteName) {
      try {
        siteName = new URL(finalUrl).host.replace(/^www\./i, '');
      } catch {
        siteName = '';
      }
    }

    const hashtags = buildHashtags(keywords);

    // Prefer the headline's own key phrase when it has one — it reads far
    // better in captions and titles than a bare high-frequency word
    // ("search engine optimization" beats "search").
    const titleTokens = tokenize(cleanTitle(title, keywords[0]?.term || ''));
    const titlePhrase = titleTokens.slice(0, 4).join(' ');
    const topPhrase = keywords.find((k) => k.term.includes(' '));
    const primary =
      titleTokens.length >= 2
        ? titlePhrase
        : topPhrase && topPhrase.score >= (keywords[0]?.score ?? 0) * 0.5
          ? topPhrase.term
          : keywords[0]?.term || '';

    return {
      url: input,
      finalUrl,
      siteName,
      fetchedAt: new Date().toISOString(),
      page,
      seoKeywords: keywords,
      geoKeywords: buildGeoKeywords(keywords),
      geoQuestions,
      h1Suggestions: buildH1Suggestions(title, keywords, primary),
      metaDescriptions: buildMetaDescriptions(metaDescription, sentences, primary),
      hashtags,
      metaKeywordTags: keywords.slice(0, 15).map((k) => k.term),
      captions: buildCaptions(finalUrl, title, keywords, sentences, hashtags, primary),
      issues: buildIssues(page),
      notices,
    };
  }
}
