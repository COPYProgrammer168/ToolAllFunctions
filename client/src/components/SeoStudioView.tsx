import React, { useState } from 'react';
import {
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FileDown,
  Globe2,
  Hash,
  Heading1,
  Layers,
  Loader2,
  Map,
  MessageSquareText,
  Search,
  Sparkles,
  Tags,
  TrendingUp,
  Wand2,
} from 'lucide-react';
import type { SeoAnalyzeScope, SeoReport, SeoSiteAudit, SitemapReport } from '../types';
import { analyzeSeoUrl, generateSitemap } from '../services/api';

/** Small color helper: green when a string length sits in the ideal range. */
const charClass = (len: number, min: number, max: number): string =>
  len >= min && len <= max ? 'text-emerald-400' : 'text-amber-400';

interface CopyButtonProps {
  id: string;
  text: string;
  copied: string | null;
  onCopy: (id: string, text: string) => void;
  label?: string;
}

const CopyButton: React.FC<CopyButtonProps> = ({ id, text, copied, onCopy, label = 'Copy' }) => {
  const isCopied = copied === id;
  return (
    <button
      onClick={() => onCopy(id, text)}
      className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold transition-all flex items-center gap-1.5 shrink-0 ${
        isCopied
          ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-300'
          : 'bg-white/5 hover:bg-white/10 border-white/10 text-neutral-300'
      }`}
    >
      {isCopied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {isCopied ? 'Copied' : label}
    </button>
  );
};

export const SeoStudioView: React.FC = () => {
  const [url, setUrl] = useState('');
  const [scope, setScope] = useState<SeoAnalyzeScope>('site');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<SeoReport | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [sitemap, setSitemap] = useState<SitemapReport | null>(null);
  const [isSitemapLoading, setIsSitemapLoading] = useState(false);
  const [sitemapError, setSitemapError] = useState<string | null>(null);

  const handleCopy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };

  const handleAnalyze = async () => {
    const target = url.trim();
    if (!target) {
      setError('Paste a website URL first, for example https://example.com/blog-post');
      return;
    }

    setError(null);
    setReport(null);
    setSitemap(null);
    setSitemapError(null);
    setIsAnalyzing(true);
    try {
      const data = await analyzeSeoUrl(target, scope);
      setReport(data);
    } catch (err: any) {
      setError(err.message || 'The website could not be analyzed.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const downloadReport = () => {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `seo-geo-report-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const handleGenerateSitemap = async (targetUrl: string) => {
    setIsSitemapLoading(true);
    setSitemapError(null);
    setSitemap(null);
    try {
      const data = await generateSitemap(targetUrl);
      setSitemap(data);
    } catch (err: any) {
      setSitemapError(err.message || 'The sitemap could not be generated.');
    } finally {
      setIsSitemapLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Hero Header */}
      <div className="text-center space-y-3">
        <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-sky-500/10 border border-sky-500/30 text-sky-300 text-xs font-semibold uppercase tracking-wider">
          <Search className="w-3.5 h-3.5" />
          Content & Search Studio
        </div>
        <h2 className="text-3xl sm:text-4xl font-extrabold text-sky-300 tracking-tight">SEO & GEO Studio</h2>
        <p className="text-sm text-neutral-400 max-w-2xl mx-auto leading-relaxed">
          Paste any public website URL — even just the homepage — and the tool can crawl the whole site or focus on
          that one page. You get SEO keywords, GEO (AI search) question phrasings, H1 titles, meta descriptions,
          hashtags and ready-to-post captions, all derived from the live content.
        </p>
      </div>

      {/* URL Input */}
      <div className="glass-panel p-5 sm:p-6 rounded-2xl border border-white/[0.08] space-y-4">
        <label className="text-xs font-semibold uppercase tracking-wider text-neutral-400 flex items-center gap-2">
          <Globe2 className="w-3.5 h-3.5 text-sky-300" />
          Website URL
        </label>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !isAnalyzing) handleAnalyze();
            }}
            placeholder="https://example.com/blog-post"
            disabled={isAnalyzing}
            className="w-full min-w-0 bg-white/5 border border-white/10 rounded-xl px-3.5 py-3 text-sm text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-sky-400/60 disabled:opacity-50"
          />
          <button
            onClick={handleAnalyze}
            disabled={isAnalyzing}
            className="px-5 py-3 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:opacity-60 text-neutral-950 font-bold text-sm transition-all shadow-lg shadow-sky-500/20 flex items-center justify-center gap-2 shrink-0"
          >
            {isAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
            {isAnalyzing ? 'Analyzing…' : 'Analyze Website'}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">Analyze</span>
          <div className="flex rounded-xl overflow-hidden border border-white/10">
            {(
              [
                { value: 'site', label: 'Whole site' },
                { value: 'page', label: 'This page only' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.value}
                onClick={() => setScope(opt.value)}
                disabled={isAnalyzing}
                className={`px-3 py-1.5 text-[11px] font-semibold transition-all disabled:opacity-60 ${
                  scope === opt.value
                    ? 'bg-sky-500 text-neutral-950'
                    : 'bg-white/5 text-neutral-400 hover:text-neutral-200 hover:bg-white/10'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <span className="text-[10px] text-neutral-500">
            {scope === 'site'
              ? 'crawls up to 25 internal pages from this URL and audits every page'
              : 'analyzes only the URL you entered'}
          </span>
        </div>
        <p className="text-[11px] text-neutral-500 leading-relaxed">
          Works with public article pages, landing pages and portfolios. JavaScript-only apps may return little text —
          the report tells you when that happens.
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <p className="break-words">{error}</p>
        </div>
      )}

      {/* Loading */}
      {isAnalyzing && (
        <div className="glass-panel p-10 rounded-2xl border border-white/[0.08] text-center space-y-3">
          <Loader2 className="w-8 h-8 animate-spin text-sky-300 mx-auto" />
          <p className="text-sm font-semibold text-white">
            {scope === 'site' ? 'Crawling and analyzing the whole site…' : 'Fetching and analyzing the page…'}
          </p>
          <p className="text-xs text-neutral-500">
            {scope === 'site'
              ? 'Discovering internal pages (up to 25), then auditing titles, descriptions, headings and keywords across all of them.'
              : 'Extracting headings, keywords, metadata and deriving content ideas.'}
          </p>
        </div>
      )}

      {report && !isAnalyzing && (
        <SeoReportView
          report={report}
          copied={copied}
          onCopy={handleCopy}
          onDownload={downloadReport}
          sitemap={sitemap}
          sitemapLoading={isSitemapLoading}
          sitemapError={sitemapError}
          onGenerateSitemap={() => handleGenerateSitemap(report.finalUrl)}
        />
      )}
    </div>
  );
};

interface SeoReportViewProps {
  report: SeoReport;
  copied: string | null;
  onCopy: (id: string, text: string) => void;
  onDownload: () => void;
  sitemap: SitemapReport | null;
  sitemapLoading: boolean;
  sitemapError: string | null;
  onGenerateSitemap: () => void;
}

const Flag: React.FC<{ ok: boolean; label: string }> = ({ ok, label }) => (
  <span
    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border ${
      ok
        ? 'bg-emerald-500/10 border-emerald-400/30 text-emerald-300'
        : 'bg-white/5 border-white/10 text-neutral-500'
    }`}
  >
    {ok ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
    {label}
  </span>
);

const SectionCard: React.FC<{
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}> = ({ icon, title, subtitle, action, children }) => (
  <div className="glass-panel p-5 sm:p-6 rounded-2xl border border-white/[0.08] space-y-4 min-w-0">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-2.5 min-w-0">
        <div className="w-8 h-8 rounded-lg bg-white/10 border border-white/15 flex items-center justify-center text-sky-300 shrink-0">
          {icon}
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-white">{title}</h3>
          {subtitle && <p className="text-[11px] text-neutral-500 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
    {children}
  </div>
);

const SiteAuditSection: React.FC<{
  site: SeoSiteAudit;
  copied: string | null;
  onCopy: (id: string, text: string) => void;
}> = ({ site, copied, onCopy }) => (
  <SectionCard
    icon={<Layers className="w-4 h-4" />}
    title="Whole-site audit"
    subtitle={`${site.pageCount} page${site.pageCount === 1 ? '' : 's'} crawled from the URL you entered`}
    action={
      site.siteKeywords.length > 0 ? (
        <CopyButton
          id="site-keywords"
          text={site.siteKeywords.map((k) => k.term).join(', ')}
          copied={copied}
          onCopy={onCopy}
          label="Copy site keywords"
        />
      ) : undefined
    }
  >
    <div className="space-y-4">
      {/* Totals */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        {[
          { label: 'Pages', value: site.pageCount, warn: false },
          { label: 'With issues', value: site.totals.issuePages, warn: site.totals.issuePages > 0 },
          { label: 'Missing title', value: site.totals.missingTitles, warn: site.totals.missingTitles > 0 },
          { label: 'Missing meta', value: site.totals.missingDescriptions, warn: site.totals.missingDescriptions > 0 },
          { label: 'Missing H1', value: site.totals.missingH1, warn: site.totals.missingH1 > 0 },
          { label: 'Thin pages', value: site.totals.thinPages, warn: site.totals.thinPages > 0 },
        ].map((s) => (
          <div key={s.label} className="bg-white/5 p-3 rounded-xl border border-white/5 text-center">
            <p className="text-[10px] text-neutral-500 uppercase tracking-wider font-semibold">{s.label}</p>
            <p className={`text-sm font-bold mt-1 ${s.warn ? 'text-amber-300' : 'text-emerald-300'}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Duplicate titles */}
      {site.duplicateTitles.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">
            Duplicate titles ({site.duplicateTitles.length} group{site.duplicateTitles.length === 1 ? '' : 's'})
          </p>
          {site.duplicateTitles.map((g) => (
            <div key={g.value} className="p-2.5 rounded-xl bg-amber-500/5 border border-amber-500/20 min-w-0">
              <p className="text-xs text-amber-200 break-words">
                “{g.value}” <span className="text-amber-400/80">— {g.urls.length} pages</span>
              </p>
              <p className="text-[10px] font-mono text-neutral-500 break-all">
                {g.urls.slice(0, 3).join('  ')}
                {g.urls.length > 3 ? ' …' : ''}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Duplicate meta descriptions */}
      {site.duplicateDescriptions.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">
            Duplicate meta descriptions ({site.duplicateDescriptions.length} group
            {site.duplicateDescriptions.length === 1 ? '' : 's'})
          </p>
          {site.duplicateDescriptions.map((g) => (
            <div key={g.value} className="p-2.5 rounded-xl bg-amber-500/5 border border-amber-500/20 min-w-0">
              <p className="text-xs text-amber-200 break-words">
                “{g.value}” <span className="text-amber-400/80">— {g.urls.length} pages</span>
              </p>
              <p className="text-[10px] font-mono text-neutral-500 break-all">
                {g.urls.slice(0, 3).join('  ')}
                {g.urls.length > 3 ? ' …' : ''}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Per-page audit */}
      <div className="space-y-2">
        <p className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">
          Pages analyzed ({site.pages.length})
        </p>
        <div className="max-h-80 overflow-y-auto rounded-xl border border-white/10 divide-y divide-white/5">
          {site.pages.map((p) => (
            <div key={p.url} className="flex items-center gap-3 px-3 py-2 min-w-0">
              <span
                className={`w-9 shrink-0 text-center text-[10px] font-bold rounded-md py-1 ${
                  p.issueCount === 0 ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'
                }`}
              >
                {p.issueCount}
              </span>
              <div className="min-w-0 flex-1">
                <a
                  href={p.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-neutral-200 hover:text-sky-300 truncate block"
                >
                  {p.title || p.url.replace(/^https?:\/\/[^/]+/, '') || '/'}
                </a>
                <p className="text-[10px] font-mono text-neutral-500 truncate">{p.url}</p>
              </div>
              <span className="text-[10px] font-mono text-neutral-500 shrink-0">{p.wordCount.toLocaleString()} w</span>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-neutral-600">
          Badge = number of audit issues on that page. Click a page to open it.
        </p>
      </div>

      {/* Site-wide keywords */}
      {site.siteKeywords.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">Top site-wide keywords</p>
          <div className="flex flex-wrap gap-1.5">
            {site.siteKeywords.slice(0, 12).map((k) => (
              <button
                key={k.term}
                onClick={() => onCopy(`site-kw-${k.term}`, k.term)}
                className={`px-2.5 py-1 rounded-full border text-[11px] transition-all ${
                  copied === `site-kw-${k.term}`
                    ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-300'
                    : 'bg-sky-500/10 border-sky-400/20 text-sky-300 hover:bg-sky-500/20'
                }`}
                title="Click to copy"
              >
                {k.term} <span className="text-neutral-500">×{k.count}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Crawl notices */}
      {site.notices.map((n, i) => (
        <p key={i} className="text-[11px] text-amber-300 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span className="break-words">{n}</span>
        </p>
      ))}
    </div>
  </SectionCard>
);

const SeoReportView: React.FC<SeoReportViewProps> = ({
  report,
  copied,
  onCopy,
  onDownload,
  sitemap,
  sitemapLoading,
  sitemapError,
  onGenerateSitemap,
}) => {
  const { page } = report;

  const copyAllKeywords = report.seoKeywords.map((k) => k.term).join(', ');
  const copyAllGeo = [...report.geoKeywords, ...report.geoQuestions].join('\n');

  return (
    <div className="space-y-6">
      {/* Summary strip */}
      <div className="glass-panel p-5 rounded-2xl border border-white/[0.08] flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wider text-neutral-500 font-semibold">Analyzed page</p>
          <p className="text-sm font-bold text-white truncate max-w-full sm:max-w-xl">{page.title || report.finalUrl}</p>
          <a
            href={report.finalUrl}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] font-mono text-sky-300 hover:text-sky-200 truncate block max-w-full sm:max-w-xl"
          >
            {report.finalUrl}
          </a>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            onClick={onGenerateSitemap}
            disabled={sitemapLoading}
            className="px-3.5 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:opacity-60 text-neutral-950 text-xs font-bold transition-all flex items-center gap-1.5 shadow-lg shadow-sky-500/20"
          >
            {sitemapLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Map className="w-3.5 h-3.5" />}
            {sitemapLoading ? 'Crawling site…' : 'Generate sitemap'}
          </button>
          <button
            onClick={onDownload}
            className="px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-neutral-200 transition-all flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            Download report (.json)
          </button>
        </div>
      </div>

      {/* Notices */}
      {report.notices.map((n, i) => (
        <div
          key={i}
          className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs leading-relaxed flex items-start gap-2"
        >
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <p>{n}</p>
        </div>
      ))}

      {/* Page overview */}
      <SectionCard
        icon={<Globe2 className="w-4 h-4" />}
        title="Page overview"
        subtitle={`${report.siteName || 'website'} • fetched ${new Date(report.fetchedAt).toLocaleString()}`}
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {[
            { label: 'Words', value: page.wordCount.toLocaleString() },
            { label: 'H1 / H2 / H3', value: `${page.h1.length} / ${page.h2.length} / ${page.h3.length}` },
            { label: 'Images', value: `${page.imageCount}${page.imagesMissingAlt ? ` (${page.imagesMissingAlt} no alt)` : ''}` },
            { label: 'Links', value: `${page.internalLinks} in / ${page.externalLinks} out` },
          ].map((s) => (
            <div key={s.label} className="bg-white/5 p-3 rounded-xl border border-white/5 text-center">
              <p className="text-[10px] text-neutral-500 uppercase tracking-wider font-semibold">{s.label}</p>
              <p className="text-sm font-semibold text-white mt-1 truncate">{s.value}</p>
            </div>
          ))}
        </div>

        <div className="space-y-2 text-xs">
          <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-3">
            <span className="text-neutral-500 font-semibold shrink-0 w-36">Title tag</span>
            <span className="text-neutral-200 break-words">{page.title || <em className="text-amber-400">missing</em>}</span>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-3">
            <span className="text-neutral-500 font-semibold shrink-0 w-36">Meta description</span>
            <span className="text-neutral-200 break-words">
              {page.metaDescription || <em className="text-amber-400">missing</em>}
            </span>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-3">
            <span className="text-neutral-500 font-semibold shrink-0 w-36">Language</span>
            <span className="text-neutral-200">{page.language || <em className="text-amber-400">not set</em>}</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Flag ok={page.h1.length === 1} label={`H1 (${page.h1.length})`} />
          <Flag ok={page.hasCanonical} label="Canonical" />
          <Flag ok={page.hasOpenGraph} label="Open Graph" />
          <Flag ok={page.hasTwitterCard} label="Twitter card" />
          <Flag ok={page.hasStructuredData} label="JSON-LD schema" />
          <Flag ok={page.imagesMissingAlt === 0} label="Alt text" />
        </div>
      </SectionCard>

      {/* Issues */}
      <SectionCard
        icon={<AlertTriangle className="w-4 h-4" />}
        title="Quick SEO audit"
        subtitle={report.issues.length ? `${report.issues.length} issue(s) to improve` : 'No major on-page issues found'}
      >
        {report.issues.length === 0 ? (
          <p className="text-xs text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            The essentials (title, description, H1, alt text, schema) look good.
          </p>
        ) : (
          <ul className="space-y-2">
            {report.issues.map((issue, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-neutral-300">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0 mt-1.5" />
                <span className="break-words">{issue}</span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* Whole-site audit */}
      {report.site && <SiteAuditSection site={report.site} copied={copied} onCopy={onCopy} />}

      {/* Keywords */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 min-w-0">
        <SectionCard
          icon={<TrendingUp className="w-4 h-4" />}
          title="SEO keywords"
          subtitle="Most frequent meaningful terms — “Title”/“Heading” badges mean strong placement"
          action={
            report.seoKeywords.length > 0 ? (
              <CopyButton id="seo-keywords" text={copyAllKeywords} copied={copied} onCopy={onCopy} label="Copy all" />
            ) : undefined
          }
        >
          {report.seoKeywords.length === 0 ? (
            <p className="text-xs text-neutral-500">Not enough visible text to extract keywords.</p>
          ) : (
            <div className="space-y-2">
              {report.seoKeywords.map((k) => (
                <div key={k.term} className="flex items-center gap-3 min-w-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-neutral-200 break-words">{k.term}</span>
                      {k.inTitle && (
                        <span className="px-1.5 py-0.5 rounded bg-sky-500/15 border border-sky-400/30 text-sky-300 text-[9px] font-bold uppercase">
                          Title
                        </span>
                      )}
                      {k.inHeadings && (
                        <span className="px-1.5 py-0.5 rounded bg-violet-500/15 border border-violet-400/30 text-violet-300 text-[9px] font-bold uppercase">
                          Heading
                        </span>
                      )}
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-sky-400 to-violet-400"
                        style={{ width: `${Math.max(4, k.score)}%` }}
                      />
                    </div>
                  </div>
                  <span className="text-[11px] font-mono text-neutral-500 shrink-0">×{k.count}</span>
                  <CopyButton id={`kw-${k.term}`} text={k.term} copied={copied} onCopy={onCopy} label="" />
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard
          icon={<Sparkles className="w-4 h-4" />}
          title="GEO — AI search keywords"
          subtitle="Conversational phrasings generative engines (ChatGPT, Perplexity, AI Overviews) quote and answer"
          action={
            report.geoKeywords.length + report.geoQuestions.length > 0 ? (
              <CopyButton id="geo-all" text={copyAllGeo} copied={copied} onCopy={onCopy} label="Copy all" />
            ) : undefined
          }
        >
          {report.geoKeywords.length === 0 && report.geoQuestions.length === 0 ? (
            <p className="text-xs text-neutral-500">Not enough text to derive AI-search phrasings.</p>
          ) : (
            <div className="space-y-4">
              {report.geoKeywords.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">Angle phrases</p>
                  <div className="flex flex-wrap gap-1.5">
                    {report.geoKeywords.map((g) => (
                      <button
                        key={g}
                        onClick={() => onCopy(`geo-${g}`, g)}
                        className={`px-2.5 py-1.5 rounded-lg border text-[11px] transition-all text-left ${
                          copied === `geo-${g}`
                            ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-300'
                            : 'bg-white/5 hover:bg-white/10 border-white/10 text-neutral-300'
                        }`}
                        title="Click to copy"
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {report.geoQuestions.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">
                    Questions already on the page
                  </p>
                  <ul className="space-y-1.5">
                    {report.geoQuestions.map((q) => (
                      <li key={q} className="flex items-start justify-between gap-2 min-w-0">
                        <span className="text-xs text-neutral-300 break-words">{q}</span>
                        <CopyButton id={`gq-${q}`} text={q} copied={copied} onCopy={onCopy} label="" />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </SectionCard>
      </div>

      {/* H1 suggestions */}
      <SectionCard
        icon={<Heading1 className="w-4 h-4" />}
        title="H1 title suggestions"
        subtitle="Green length 30–60 characters — pick one and replace the page H1"
      >
        {report.h1Suggestions.length === 0 ? (
          <p className="text-xs text-neutral-500">Not enough content to suggest headings.</p>
        ) : (
          <div className="space-y-2">
            {report.h1Suggestions.map((s, i) => (
              <div
                key={`${s}-${i}`}
                className="flex flex-col sm:flex-row sm:items-center gap-2 p-3 rounded-xl bg-white/5 border border-white/5"
              >
                <span className="text-sm font-semibold text-neutral-100 break-words flex-1 min-w-0">{s}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-[11px] font-mono ${charClass(s.length, 30, 60)}`}>{s.length} chars</span>
                  <CopyButton id={`h1-${i}`} text={s} copied={copied} onCopy={onCopy} />
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Meta descriptions */}
      <SectionCard
        icon={<MessageSquareText className="w-4 h-4" />}
        title="Meta description drafts"
        subtitle="Green length 120–160 characters — paste into the page <meta name='description'>"
      >
        {report.metaDescriptions.length === 0 ? (
          <p className="text-xs text-neutral-500">Not enough content to build descriptions.</p>
        ) : (
          <div className="space-y-2">
            {report.metaDescriptions.map((d, i) => (
              <div key={i} className="p-3 rounded-xl bg-white/5 border border-white/5 space-y-2">
                <p className="text-xs text-neutral-200 leading-relaxed break-words">{d}</p>
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-[11px] font-mono ${charClass(d.length, 110, 165)}`}>{d.length} chars</span>
                  <CopyButton id={`md-${i}`} text={d} copied={copied} onCopy={onCopy} />
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Tags */}
      <SectionCard
        icon={<Tags className="w-4 h-4" />}
        title="Tags — hashtags & meta keywords"
        subtitle="Hashtags for social posts; meta keywords for legacy engines and CMS tag fields"
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold flex items-center gap-1.5">
                <Hash className="w-3 h-3" /> Hashtags
              </p>
              {report.hashtags.length > 0 && (
                <CopyButton id="hashtags" text={report.hashtags.join(' ')} copied={copied} onCopy={onCopy} label="Copy all" />
              )}
            </div>
            {report.hashtags.length === 0 ? (
              <p className="text-xs text-neutral-500">No hashtags could be derived.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {report.hashtags.map((h) => (
                  <button
                    key={h}
                    onClick={() => onCopy(`tag-${h}`, h)}
                    className={`px-2.5 py-1 rounded-full border text-[11px] font-mono transition-all ${
                      copied === `tag-${h}`
                        ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-300'
                        : 'bg-sky-500/10 border-sky-400/20 text-sky-300 hover:bg-sky-500/20'
                    }`}
                    title="Click to copy"
                  >
                    {h}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">Meta keywords</p>
              {report.metaKeywordTags.length > 0 && (
                <CopyButton
                  id="meta-keywords"
                  text={report.metaKeywordTags.join(', ')}
                  copied={copied}
                  onCopy={onCopy}
                  label="Copy all"
                />
              )}
            </div>
            <p className="text-xs font-mono text-neutral-300 break-words">
              {report.metaKeywordTags.length ? report.metaKeywordTags.join(', ') : '—'}
            </p>
          </div>
        </div>
      </SectionCard>

      {/* Captions */}
      <SectionCard
        icon={<MessageSquareText className="w-4 h-4" />}
        title="Social captions"
        subtitle="Ready-to-post drafts built from the page title, key phrases and highlights"
      >
        {report.captions.length === 0 ? (
          <p className="text-xs text-neutral-500">Not enough content to draft captions.</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {report.captions.map((c) => (
              <div key={c.platform} className="p-4 rounded-xl bg-white/5 border border-white/5 space-y-3 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold text-white">{c.label}</p>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[11px] font-mono text-neutral-500">{c.text.length} chars</span>
                    <CopyButton id={`cap-${c.platform}`} text={c.text} copied={copied} onCopy={onCopy} />
                  </div>
                </div>
                <p className="text-xs text-neutral-300 leading-relaxed whitespace-pre-line break-words">{c.text}</p>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Sitemap generator */}
      {sitemapError && (
        <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <p className="break-words">{sitemapError}</p>
        </div>
      )}

      {sitemapLoading && (
        <div className="glass-panel p-10 rounded-2xl border border-white/[0.08] text-center space-y-3">
          <Loader2 className="w-8 h-8 animate-spin text-sky-300 mx-auto" />
          <p className="text-sm font-semibold text-white">Crawling the site for the sitemap…</p>
          <p className="text-xs text-neutral-500">
            Discovering internal pages (up to 60), checking robots.txt and existing sitemaps.
          </p>
        </div>
      )}

      {sitemap && !sitemapLoading && (
        <SectionCard
          icon={<Map className="w-4 h-4" />}
          title="Sitemap & robots.txt"
          subtitle={`${sitemap.pages.length} page${sitemap.pages.length === 1 ? '' : 's'} on ${sitemap.site} • generated ${new Date(
            sitemap.generatedAt
          ).toLocaleString()}`}
          action={
            <div className="flex flex-wrap gap-2">
              <a
                href={sitemap.downloads.xml}
                className="px-3 py-1.5 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 border border-sky-400/40 text-sky-300 text-[11px] font-semibold transition-all flex items-center gap-1.5"
              >
                <FileDown className="w-3 h-3" /> sitemap.xml
              </a>
              <a
                href={sitemap.downloads.robots}
                className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-neutral-300 text-[11px] font-semibold transition-all flex items-center gap-1.5"
              >
                <FileDown className="w-3 h-3" /> robots.txt
              </a>
            </div>
          }
        >
          <div className="space-y-4">
            {/* The link to submit */}
            <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-400/25 space-y-2 min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-emerald-300 font-semibold">
                Your sitemap link (submit this)
              </p>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 min-w-0">
                <a
                  href={sitemap.sitemapUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-mono text-emerald-200 hover:text-emerald-100 flex-1 min-w-0 flex items-center gap-1.5"
                >
                  <ExternalLink className="w-3 h-3 shrink-0" />
                  <span className="truncate">{sitemap.sitemapUrl}</span>
                </a>
                <CopyButton id="sitemap-link" text={sitemap.sitemapUrl} copied={copied} onCopy={onCopy} label="Copy link" />
              </div>
              <p className="text-[11px] text-emerald-200/70 leading-relaxed">
                Upload the generated sitemap.xml to this address, then add the link in Google Search Console → Sitemaps.
              </p>
            </div>

            {/* Existing sitemaps */}
            <div className="space-y-2">
              <p className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold flex items-center gap-1.5">
                <Bot className="w-3 h-3" /> Existing sitemaps detected
              </p>
              {sitemap.existing.sitemapLinks.length === 0 ? (
                <p className="text-xs text-neutral-500">
                  None found
                  {sitemap.existing.robotsFound ? ' (robots.txt has no Sitemap directive)' : ' (no robots.txt)'} — the
                  generated file would be the site's first sitemap.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {sitemap.existing.sitemapLinks.map((l) => (
                    <a
                      key={l}
                      href={l}
                      target="_blank"
                      rel="noreferrer"
                      className="px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-400/25 text-amber-300 hover:bg-amber-500/20 text-[11px] font-mono truncate max-w-full"
                    >
                      {l}
                    </a>
                  ))}
                </div>
              )}
            </div>

            {/* robots.txt snippet */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">robots.txt snippet</p>
                <CopyButton
                  id="robots-snippet"
                  text={sitemap.robotsSnippet}
                  copied={copied}
                  onCopy={onCopy}
                  label="Copy snippet"
                />
              </div>
              <pre className="p-3 rounded-xl bg-black/40 border border-white/10 text-[11px] font-mono text-neutral-300 overflow-x-auto whitespace-pre-wrap break-words">
                {sitemap.robotsSnippet}
              </pre>
            </div>

            {/* Pages */}
            <div className="space-y-2">
              <p className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">
                Pages in the sitemap ({sitemap.pages.length})
              </p>
              <div className="max-h-72 overflow-y-auto rounded-xl border border-white/10 divide-y divide-white/5">
                {sitemap.pages.map((p) => (
                  <div key={p.loc} className="flex items-center gap-3 px-3 py-2 min-w-0">
                    <span className="w-7 text-[10px] font-mono text-neutral-600 shrink-0">d{p.depth}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-neutral-200 truncate">
                        {p.title || p.loc.replace(/^https?:\/\/[^/]+/, '') || '/'}
                      </p>
                      <p className="text-[10px] font-mono text-neutral-500 truncate">{p.loc}</p>
                    </div>
                    <span className="text-[10px] font-mono text-neutral-500 shrink-0">
                      {p.priority.toFixed(1)}
                      {p.lastmod ? ` • ${p.lastmod}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Crawl notices */}
            {sitemap.notices.map((n, i) => (
              <p key={i} className="text-[11px] text-amber-300 flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span className="break-words">{n}</span>
              </p>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
};
