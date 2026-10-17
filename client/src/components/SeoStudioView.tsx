import React, { useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Download,
  Globe2,
  Hash,
  Heading1,
  Loader2,
  MessageSquareText,
  Search,
  Sparkles,
  Tags,
  TrendingUp,
  Wand2,
} from 'lucide-react';
import type { SeoReport } from '../types';
import { analyzeSeoUrl } from '../services/api';

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
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<SeoReport | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

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
    setIsAnalyzing(true);
    try {
      const data = await analyzeSeoUrl(target);
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
          Paste any public website URL and generate SEO keywords, GEO (AI search) question phrasings, H1 titles,
          meta descriptions, hashtags and ready-to-post captions — all derived from the live page content.
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
          <p className="text-sm font-semibold text-white">Fetching and analyzing the page…</p>
          <p className="text-xs text-neutral-500">Extracting headings, keywords, metadata and deriving content ideas.</p>
        </div>
      )}

      {report && !isAnalyzing && (
        <SeoReportView report={report} copied={copied} onCopy={handleCopy} onDownload={downloadReport} />
      )}
    </div>
  );
};

interface SeoReportViewProps {
  report: SeoReport;
  copied: string | null;
  onCopy: (id: string, text: string) => void;
  onDownload: () => void;
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

const SeoReportView: React.FC<SeoReportViewProps> = ({ report, copied, onCopy, onDownload }) => {
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
        <button
          onClick={onDownload}
          className="px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-neutral-200 transition-all flex items-center gap-1.5 shrink-0"
        >
          <Download className="w-3.5 h-3.5" />
          Download report (.json)
        </button>
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
    </div>
  );
};
