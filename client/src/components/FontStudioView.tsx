import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Clipboard,
  Copy,
  Heart,
  ImageDown,
  ImagePlus,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  Type,
  X,
} from 'lucide-react';
import { FONT_STYLES, FONT_STYLE_CATEGORIES, NICKNAME_STYLES } from '../services/fontStyleCatalog';
import {
  FontStyleEngine,
  TextTransformationRepository,
  MAX_CHARACTER_COUNT,
  loadFavorites,
  loadRecents,
  pushRecent,
  saveFavorites,
  saveRecents,
} from '../services/fontStyleEngine';
import { DECORATIONS, SEPARATORS } from '../services/unicodeAlphabets';
import type { UnicodeStyleId } from '../services/unicodeStyleEngine';
import { downloadPng, renderTextToPng } from '../services/textPngExporter';
import type {
  CapitalizationMode,
  FontStyleCategoryFilter,
  FontStyleResult,
  OutputKind,
  TransformOptions,
} from '../services/fontStyleTypes';

/* ── View-model (state + actions, kept out of the render tree) ──────────── */

type StudioStatus = 'empty' | 'ready' | 'error';
type SortMode = 'popular' | 'recent' | 'name';

const engine = new FontStyleEngine(FONT_STYLES);
const repository = new TextTransformationRepository(engine);
const styleById = new Map(FONT_STYLES.map((s) => [s.id, s]));

/**
 * Copy a rendered PNG straight to the clipboard so the styled text can be
 * pasted as an image into chats, documents, design tools, etc.
 * Requires a secure context (localhost/HTTPS) and a browser with
 * ClipboardItem; returns false when unavailable so callers can fall back.
 */
async function copyImageToClipboard(blob: Blob): Promise<boolean> {
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return true;
    }
  } catch {
    /* clipboard blocked or unsupported */
  }
  return false;
}

/**
 * Copy real Unicode-styled text to the clipboard.
 *
 * Discord nicknames (and every other plain-text surface) accept the
 * styled characters directly — no font needed. Uses the async clipboard
 * API with a textarea + execCommand fallback for non-secure contexts.
 */
async function copyStyledText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    textarea.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Clipboard read — only ever called from a user gesture (button click). */
async function readClipboard(): Promise<string | null> {
  try {
    if (navigator.clipboard?.readText) {
      return await navigator.clipboard.readText();
    }
    return null;
  } catch {
    return null;
  }
}

/** Matches characters outside common Latin/punctuation ranges (scripts, emoji, …). */
const NON_LATIN_HINT = /[^\u0020-\u024f\u2000-\u206f\u3000-\u303f\uff00-\uffef]/;

/** Debounce a rapidly-changing value (live preview) by `delay` ms. */
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** Results rendered per page — keeps the grid light on low-end devices. */
const RESULTS_PAGE_SIZE = 24;

/** Discord nickname limit, counted in code points. */
const NICKNAME_LIMIT = 32;

/** Engine over the nickname styles — powers the per-card style override. */
const nicknameEngine = new FontStyleEngine(NICKNAME_STYLES);

/* ── Component ──────────────────────────────────────────────────────────── */

export const FontStudioView: React.FC = () => {
  const storage = typeof window !== 'undefined' ? window.localStorage : undefined;

  const [inputText, setInputText] = useState('');
  const [category, setCategory] = useState<FontStyleCategoryFilter>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortMode>('popular');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [capitalization, setCapitalization] = useState<CapitalizationMode>('none');
  const [letterSpacing, setLetterSpacing] = useState(0);
  const [decorationId, setDecorationId] = useState('none');
  const [separatorId, setSeparatorId] = useState('none');
  const [favorites, setFavorites] = useState<string[]>(() => loadFavorites(storage));
  const [recents, setRecents] = useState(() => loadRecents(storage));
  const [visibleCount, setVisibleCount] = useState(RESULTS_PAGE_SIZE);
  /** Per-card Unicode style overrides, keyed by card id ('' = card default). */
  const [styleOverrides, setStyleOverrides] = useState<Record<string, UnicodeStyleId | ''>>({});
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2400);
  }, []);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  // A new filter/search resets paging to the first page of results.
  useEffect(() => {
    setVisibleCount(RESULTS_PAGE_SIZE);
  }, [category, search, favoritesOnly, sort]);

  const codePointCount = useMemo(() => [...inputText].length, [inputText]);
  const overLimit = codePointCount > MAX_CHARACTER_COUNT;
  const hasUnsupportedScript = NON_LATIN_HINT.test(inputText);

  // Live preview is debounced so fast typing never regenerates all styles
  // per keystroke — keeps scrolling and input smooth on low-end devices.
  const previewText = useDebouncedValue(inputText, 150);
  const previewTrimmed = previewText.trim();
  const previewOverLimit = previewTrimmed.length > MAX_CHARACTER_COUNT;

  // Generation is local, synchronous and fast — no network, no fake loading
  // state. The status is fully derived from the inputs, never set imperatively.
  const generation = useMemo<{ results: FontStyleResult[]; failed: boolean }>(() => {
    if (!previewTrimmed || previewOverLimit) return { results: [], failed: false };
    try {
      const options: TransformOptions = { capitalization, letterSpacing, decorationId, separatorId };
      const base = repository.generate(previewText, options, {
        category,
        search,
        favoriteIds: favorites,
        favoritesOnly,
        sort,
        recentIds: recents.map((r) => r.styleId),
      });
      // Apply per-card style overrides on top of each card's default style.
      const results = base.map((r) => {
        const override = styleOverrides[r.styleId];
        if (!override || override === r.defaultStyleId) return r;
        const style = nicknameEngine.getStyle(override);
        if (!style) return r;
        return { ...r, output: nicknameEngine.transform(r.sourceText, style, options) };
      });
      return { results, failed: false };
    } catch (err) {
      console.error('Font Studio generation failed', err);
      return { results: [], failed: true };
    }
  }, [previewText, previewTrimmed, previewOverLimit, capitalization, letterSpacing, decorationId, separatorId, category, search, favorites, favoritesOnly, sort, recents, styleOverrides]);

  const status: StudioStatus = generation.failed
    ? 'error'
    : previewTrimmed && !previewOverLimit
      ? 'ready'
      : 'empty';
  const results = generation.results;

  const recordUsage = useCallback(
    (styleId: string) => {
      setRecents((prev) => {
        const next = pushRecent(prev, styleId);
        saveRecents(storage, next);
        return next;
      });
    },
    [storage]
  );

  const handleCopy = useCallback(
    async (result: FontStyleResult) => {
      // Every card copies real Unicode text — it keeps its look in Discord
      // nicknames and anywhere else plain text survives.
      const ok = await copyStyledText(result.output);
      if (!ok) {
        showToast('Clipboard blocked by the browser');
        return;
      }
      recordUsage(result.styleId);
      showToast('Copied styled text. Paste it into your Discord nickname.');
    },
    [recordUsage, showToast]
  );

  const handleCopyAll = useCallback(async () => {
    if (!results.length) {
      showToast('Nothing copyable to copy');
      return;
    }
    const ok = await copyStyledText(repository.formatCopyAll(results));
    if (!ok) {
      showToast('Clipboard blocked by the browser');
      return;
    }
    showToast(`Copied ${results.length} styled texts — paste any of them into Discord`);
  }, [results, showToast]);

  const handlePaste = useCallback(async () => {
    const text = await readClipboard();
    if (text === null) {
      showToast('Clipboard read blocked — paste manually (Ctrl+V)');
      return;
    }
    if (!text) {
      showToast('Clipboard is empty');
      return;
    }
    setInputText(text);
    showToast('Pasted from clipboard');
  }, [showToast]);

  const handleClear = useCallback(() => {
    setInputText('');
    setSearch('');
  }, []);

  const handleResetControls = useCallback(() => {
    setCategory('all');
    setSearch('');
    setSort('popular');
    setFavoritesOnly(false);
    setCapitalization('none');
    setLetterSpacing(0);
    setDecorationId('none');
    setSeparatorId('none');
    setStyleOverrides({});
    setInputText('');
  }, []);

  const toggleFavorite = useCallback((styleId: string) => {
    setFavorites((prev) => {
      const next = prev.includes(styleId) ? prev.filter((id) => id !== styleId) : [...prev, styleId];
      saveFavorites(storage, next);
      return next;
    });
  }, [storage]);

  /** Override the Unicode style used for one card ('' restores its default). */
  const handleStyleChange = useCallback((cardId: string, styleId: UnicodeStyleId | '') => {
    setStyleOverrides((prev) => {
      const next = { ...prev };
      if (styleId) next[cardId] = styleId;
      else delete next[cardId];
      return next;
    });
  }, []);

  const handleCopyImage = useCallback(
    async (result: FontStyleResult) => {
      const family = result.fontFamily ?? 'sans-serif';
      try {
        // Image/PNG keep the card's visual font look by rendering the
        // source text in that font — the Unicode text stays for copying.
        const rendered = await renderTextToPng(result.sourceText, { fontFamily: family });
        const copied = await copyImageToClipboard(rendered.blob);
        if (copied) {
          recordUsage(result.styleId);
          showToast(`Copied “${result.styleName}” as an image — paste it anywhere`);
        } else {
          // Nothing is lost: download the PNG when the image
          // clipboard is unavailable (non-secure context / older browser).
          downloadPng(rendered, result.styleName);
          showToast(`Image clipboard blocked — PNG downloaded for “${result.styleName}”`);
        }
      } catch (err: any) {
        showToast(err?.message || 'Image copy failed');
      }
    },
    [recordUsage, showToast]
  );

  const handlePngExport = useCallback(
    async (result: FontStyleResult) => {
      const family = result.fontFamily ?? 'sans-serif';
      try {
        const rendered = await renderTextToPng(result.sourceText, { fontFamily: family });
        downloadPng(rendered, result.styleName);
        showToast(`PNG exported for “${result.styleName}”`);
      } catch (err: any) {
        showToast(err?.message || 'PNG export failed');
      }
    },
    [showToast]
  );

  const resetDefaults = () => handleResetControls();

  // Every card copies real Unicode text now, so everything is copyable.
  const copyableCount = results.length;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* ── Header ── */}
      <div className="text-center space-y-2">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border text-cyan-300 bg-cyan-500/10 border-cyan-500/30 text-xs font-semibold uppercase tracking-wider">
          <Sparkles className="w-3.5 h-3.5" />
          Creative Studio
        </div>
        <h2 className="text-2xl sm:text-3xl font-extrabold text-cyan-300">Font Studio · Text Forge</h2>
        <p className="text-xs sm:text-sm text-neutral-400 max-w-2xl mx-auto">
          Turn any text into sci-fi, cyberpunk, gothic, medieval and gaming styles. Everything runs offline in
          your browser — nothing is uploaded. Copy gives you real Unicode-styled text that works in a Discord
          nickname; font cards also export their visual look as a PNG image.
        </p>
      </div>

      {/* ── Input ── */}
      <section className="glass-panel p-5 rounded-2xl border border-white/[0.08] space-y-3">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="font-studio-input" className="text-xs font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-2">
            <Type className="w-3.5 h-3.5 text-cyan-400" />
            Your Text
          </label>
          <span className={`text-[11px] font-mono ${overLimit ? 'text-rose-400' : 'text-neutral-500'}`}>
            {codePointCount} / {MAX_CHARACTER_COUNT}
          </span>
        </div>
        <textarea
          id="font-studio-input"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          rows={3}
          spellCheck={false}
          placeholder="Type anything — titles, gamer tags, thumbnails, chapter headings…"
          className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-neutral-100 placeholder:text-neutral-600 focus:outline-none focus:border-cyan-500/50 resize-y"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handlePaste}
            className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-neutral-200 transition-all flex items-center gap-2"
          >
            <Clipboard className="w-3.5 h-3.5" />
            Paste
          </button>
          <button
            onClick={handleClear}
            disabled={!inputText}
            className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-neutral-200 transition-all flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <X className="w-3.5 h-3.5" />
            Clear
          </button>
          <div className="flex-1" />
          <button
            onClick={handleCopyAll}
            disabled={copyableCount === 0}
            className="px-4 py-2 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-xs font-bold text-cyan-200 transition-all flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Copy className="w-3.5 h-3.5" />
            Copy All ({copyableCount})
          </button>
        </div>
        {overLimit && (
          <p className="text-[11px] text-rose-400">
            Text exceeds {MAX_CHARACTER_COUNT.toLocaleString()} characters — shorten it to generate styles.
          </p>
        )}
        {hasUnsupportedScript && !overLimit && (
          <p className="text-[11px] text-neutral-500">
            Mixed scripts, Khmer, CJK and emoji detected — characters without a styled glyph are preserved exactly as typed.
          </p>
        )}
      </section>

      {/* ── Controls ── */}
      <section className="glass-panel p-5 rounded-2xl border border-white/[0.08] space-y-4">
        {/* Categories */}
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1" role="tablist" aria-label="Style categories">
          {[{ id: 'all' as const, name: 'All Styles' }, ...FONT_STYLE_CATEGORIES].map((cat) => (
            <button
              key={cat.id}
              role="tab"
              aria-selected={category === cat.id}
              onClick={() => setCategory(cat.id as FontStyleCategoryFilter)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all border ${
                category === cat.id
                  ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-200'
                  : 'bg-white/5 border-white/10 text-neutral-300 hover:bg-white/10'
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>

        {/* Search + sort */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search styles by name…"
              aria-label="Search styles"
              className="w-full bg-black/40 border border-white/10 rounded-xl pl-9 pr-3 py-2 text-xs text-neutral-100 placeholder:text-neutral-600 focus:outline-none focus:border-cyan-500/50"
            />
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortMode)}
            aria-label="Sort styles"
            className="bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-neutral-200 focus:outline-none focus:border-cyan-500/50"
          >
            <option value="popular">Most popular</option>
            <option value="recent">Recently used</option>
            <option value="name">Name (A–Z)</option>
          </select>
          <button
            onClick={() => setFavoritesOnly((v) => !v)}
            aria-pressed={favoritesOnly}
            className={`px-3 py-2 rounded-xl border text-xs font-semibold transition-all flex items-center gap-2 ${
              favoritesOnly
                ? 'bg-rose-500/20 border-rose-500/40 text-rose-200'
                : 'bg-white/5 border-white/10 text-neutral-300 hover:bg-white/10'
            }`}
          >
            <Heart className={`w-3.5 h-3.5 ${favoritesOnly ? 'fill-current' : ''}`} />
            Favorites {favorites.length > 0 && `(${favorites.length})`}
          </button>
        </div>

        {/* Transform controls */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <span className="block text-[10px] font-bold uppercase tracking-wider text-neutral-500 mb-1.5">Capitalization</span>
            <div className="flex bg-black/40 border border-white/10 rounded-xl p-1">
              {(['none', 'upper', 'lower'] as CapitalizationMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setCapitalization(mode)}
                  className={`flex-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold transition-all ${
                    capitalization === mode ? 'bg-white/20 text-white' : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  {mode === 'none' ? 'Aa' : mode === 'upper' ? 'AA' : 'aa'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label htmlFor="font-studio-spacing" className="block text-[10px] font-bold uppercase tracking-wider text-neutral-500 mb-1.5">
              Letter spacing: {letterSpacing === 0 ? 'off' : `+${letterSpacing}`}
            </label>
            <input
              id="font-studio-spacing"
              type="range"
              min={0}
              max={4}
              step={1}
              value={letterSpacing}
              onChange={(e) => setLetterSpacing(Number(e.target.value))}
              className="w-full accent-cyan-400 h-1.5 cursor-pointer mt-2"
            />
          </div>
          <div>
            <label htmlFor="font-studio-decoration" className="block text-[10px] font-bold uppercase tracking-wider text-neutral-500 mb-1.5">
              Decoration frame
            </label>
            <select
              id="font-studio-decoration"
              value={decorationId}
              onChange={(e) => setDecorationId(e.target.value)}
              className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-neutral-200 focus:outline-none focus:border-cyan-500/50"
            >
              {DECORATIONS.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="font-studio-separator" className="block text-[10px] font-bold uppercase tracking-wider text-neutral-500 mb-1.5">
              Separator
            </label>
            <select
              id="font-studio-separator"
              value={separatorId}
              onChange={(e) => setSeparatorId(e.target.value)}
              className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-neutral-200 focus:outline-none focus:border-cyan-500/50"
            >
              {SEPARATORS.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            onClick={resetDefaults}
            className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-neutral-300 transition-all flex items-center gap-2"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset to defaults
          </button>
        </div>
      </section>

      {/* ── Results / states ── */}
      {status === 'empty' && (
        <div className="glass-panel p-10 rounded-2xl border border-white/[0.08] text-center space-y-2">
          <Type className="w-8 h-8 text-neutral-600 mx-auto" />
          <h3 className="text-sm font-bold text-neutral-300">Enter text to forge styles</h3>
          <p className="text-xs text-neutral-500 max-w-md mx-auto">
            Type or paste above and {FONT_STYLES.length} transformations appear instantly — no account, no upload.
          </p>
        </div>
      )}

      {status === 'error' && (
        <div className="glass-panel p-10 rounded-2xl border border-rose-500/30 text-center space-y-3">
          <h3 className="text-sm font-bold text-rose-300">Generation failed</h3>
          <p className="text-xs text-neutral-400">Something went wrong while transforming your text.</p>
          <button
            onClick={handleClear}
            className="px-4 py-2 rounded-xl bg-white/10 border border-white/20 text-xs font-semibold text-neutral-200"
          >
            Start over
          </button>
        </div>
      )}

      {status === 'ready' && results.length === 0 && (
        <div className="glass-panel p-10 rounded-2xl border border-white/[0.08] text-center space-y-2">
          <Search className="w-8 h-8 text-neutral-600 mx-auto" />
          <h3 className="text-sm font-bold text-neutral-300">No styles match your filters</h3>
          <p className="text-xs text-neutral-500">Try another category, clear the search, or reset to defaults.</p>
        </div>
      )}

      {status === 'ready' && results.length > 0 && (
        <section className="space-y-4" aria-label="Generated styles">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {results.slice(0, visibleCount).map((result) => (
              <FontStyleCard
                key={result.styleId}
                result={result}
                isFavorite={favorites.includes(result.styleId)}
                styleId={styleOverrides[result.styleId] ?? result.defaultStyleId ?? ''}
                onStyleChange={handleStyleChange}
                onCopy={() => handleCopy(result)}
                onCopyImage={() => handleCopyImage(result)}
                onToggleFavorite={() => toggleFavorite(result.styleId)}
                onExportPng={() => handlePngExport(result)}
              />
            ))}
          </div>
          {results.length > visibleCount && (
            <div className="flex justify-center">
              <button
                onClick={() => setVisibleCount((n) => n + RESULTS_PAGE_SIZE)}
                className="px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-neutral-200 transition-all"
              >
                Show more styles ({results.length - visibleCount} remaining)
              </button>
            </div>
          )}
        </section>
      )}

      {/* ── Recent history (style ids only — never your text) ── */}
      {recents.length > 0 && (
        <section className="glass-panel p-4 rounded-2xl border border-white/[0.08] space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400">Recent Styles</h3>
            <button
              onClick={() => {
                setRecents([]);
                saveRecents(storage, []);
              }}
              className="text-[11px] text-neutral-500 hover:text-neutral-300 flex items-center gap-1.5"
            >
              <Trash2 className="w-3 h-3" />
              Clear history
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {recents.map((entry) => {
              const style = styleById.get(entry.styleId);
              if (!style) return null;
              return (
                <span key={entry.styleId} className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-[11px] text-neutral-300">
                  {style.name}
                </span>
              );
            })}
          </div>
          <p className="text-[10px] text-neutral-600">History stores style names only — never the text you type.</p>
        </section>
      )}

      {/* ── Toast ── */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl bg-neutral-900/95 border border-cyan-500/40 shadow-lg shadow-cyan-500/10 text-xs font-semibold text-cyan-100 flex items-center gap-2 backdrop-blur-xl anim-fade-in-up"
        >
          <Check className="w-3.5 h-3.5 text-cyan-400" />
          {toast}
        </div>
      )}

      {/* ── Licensing & honesty footer ── */}
      <p className="text-[10px] text-neutral-600 text-center max-w-2xl mx-auto leading-relaxed">
        Google preview fonts (Orbitron, Audiowide, UnifrakturMaguntia, Pirata One, Press Start 2P, Cinzel,
        Share Tech Mono) are SIL OFL 1.1 licensed. Bundled display families (Astron Valley, Megatrox, Xylver,
        The King, …) are personal-use/demo licensed — see <code className="text-neutral-500">src/assets/fonts/FONT-LICENSES.md</code>.
        “Copy” copies real Unicode-styled text that survives in Discord nicknames and every other plain-text
        surface; “Image” copies a rendered PNG of the font look you can paste anywhere; “PNG” downloads it as
        a file. Unicode transformations use only characters defined by the Unicode Standard.
      </p>
    </div>
  );
};

/* ── Result card ────────────────────────────────────────────────────────── */

interface FontStyleCardProps {
  result: FontStyleResult;
  isFavorite: boolean;
  /** Effective Unicode style id (per-card override, else the card default). */
  styleId: UnicodeStyleId | '';
  onStyleChange: (cardId: string, styleId: UnicodeStyleId | '') => void;
  onCopy: () => void;
  onCopyImage: () => void;
  onToggleFavorite: () => void;
  onExportPng: () => void;
}

const kindBadge = (kind: OutputKind) =>
  kind === 'unicode'
    ? { label: 'Unicode · copyable', className: 'text-cyan-300 bg-cyan-500/10 border-cyan-500/30' }
    : { label: 'Unicode + font image', className: 'text-violet-300 bg-violet-500/10 border-violet-500/30' };

/** Memoized: only cards whose inputs changed re-render when results update. */
const FontStyleCard: React.FC<FontStyleCardProps> = React.memo(
  ({ result, isFavorite, styleId, onStyleChange, onCopy, onCopyImage, onToggleFavorite, onExportPng }) => {
    const badge = kindBadge(result.outputKind);
    // Styled text can eat more of Discord's limit than plain letters,
    // so the counter measures the converted string, not the input.
    const nicknameLength = [...result.output].length;
    const overNicknameLimit = nicknameLength > NICKNAME_LIMIT;

    return (
      <article className="glass-panel rounded-2xl border border-white/[0.08] p-4 flex flex-col gap-3 hover:border-white/20 transition-all">
        <header className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-neutral-100 truncate">{result.styleName}</h3>
            <span className={`inline-block mt-1 px-2 py-0.5 rounded-md border text-[10px] font-semibold uppercase tracking-wider ${badge.className}`}>
              {badge.label}
            </span>
          </div>
          <button
            onClick={onToggleFavorite}
            aria-label={`${isFavorite ? 'Remove from' : 'Add to'} favorites: ${result.styleName}`}
            aria-pressed={isFavorite}
            className={`p-2 rounded-lg border transition-all shrink-0 ${
              isFavorite
                ? 'bg-rose-500/20 border-rose-500/40 text-rose-300'
                : 'bg-white/5 border-white/10 text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <Heart className={`w-3.5 h-3.5 ${isFavorite ? 'fill-current' : ''}`} />
          </button>
        </header>

        {/* Preview is deliberately a plain system font: what you see here
            is character-for-character what Copy puts on the clipboard. */}
        <p className="text-lg leading-relaxed text-neutral-100 break-words min-h-[2rem]">
          {result.output || <span className="text-neutral-600 text-sm">(empty output)</span>}
        </p>

        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className={`text-[11px] font-mono ${overNicknameLimit ? 'text-rose-400' : 'text-neutral-500'}`}>
            {nicknameLength} / {NICKNAME_LIMIT} nickname chars
          </span>
          {overNicknameLimit && (
            <span className="text-[11px] font-semibold text-amber-400">
              Over Discord's {NICKNAME_LIMIT}-character nickname limit
            </span>
          )}
        </div>

        <div>
          <label
            htmlFor={`style-${result.styleId}`}
            className="block text-[10px] font-bold uppercase tracking-wider text-neutral-500 mb-1.5"
          >
            Unicode style
          </label>
          <select
            id={`style-${result.styleId}`}
            value={styleId}
            onChange={(e) => onStyleChange(result.styleId, e.target.value as UnicodeStyleId | '')}
            className="w-full bg-black/40 border border-white/10 rounded-xl px-2.5 py-1.5 text-[11px] text-neutral-200 focus:outline-none focus:border-cyan-500/50"
          >
            {!result.defaultStyleId && <option value="">Card default (no override)</option>}
            {NICKNAME_STYLES.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        <footer className="flex flex-wrap items-center gap-2 pt-1 border-t border-white/5">
          <button
            onClick={onCopy}
            className="flex-1 px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-xs font-semibold text-neutral-100 transition-all flex items-center justify-center gap-2 min-w-[5.5rem]"
          >
            <Copy className="w-3.5 h-3.5" />
            Copy
          </button>
          {result.outputKind === 'font-preview' && (
            <>
              <button
                onClick={onCopyImage}
                aria-label={`Copy ${result.styleName} as image`}
                title="Copy the rendered text as a PNG image (paste anywhere)"
                className="px-2.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] text-neutral-400 hover:text-neutral-200 transition-all flex items-center gap-1.5"
              >
                <ImagePlus className="w-3 h-3" />
                Image
              </button>
              <button
                onClick={onExportPng}
                aria-label={`Download ${result.styleName} as transparent PNG`}
                title="Download the rendered text as a transparent PNG file"
                className="px-2.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] text-neutral-400 hover:text-neutral-200 transition-all flex items-center gap-1.5"
              >
                <ImageDown className="w-3 h-3" />
                PNG
              </button>
            </>
          )}
        </footer>
      </article>
    );
  }
);
FontStyleCard.displayName = 'FontStyleCard';
