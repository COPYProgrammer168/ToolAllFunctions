/**
 * Font Studio / Text Forge — transformation engine.
 *
 * Pure, deterministic, offline. No DOM, React, or network access.
 *
 * Unicode safety rules enforced here:
 *  - Text is iterated by Unicode code points (`for...of`), never by UTF-16
 *    code unit, so supplementary-plane characters (emoji, 𐍈, ...) are never
 *    split into lone surrogates.
 *  - Unsupported characters are always preserved unchanged — no invented
 *    characters are used to fill mapping gaps.
 *  - Existing combining marks are never reordered, dropped, or duplicated;
 *    spacing and separators are never inserted next to them.
 */

import type {
  CapitalizationMode,
  FontStyleCategoryFilter,
  FontStyleDefinition,
  FontStyleResult,
  StyleFilter,
  TransformOptions,
} from './fontStyleTypes';
import { DECORATIONS, SEPARATORS, type Decoration, type Separator } from './unicodeAlphabets';

export const MAX_CHARACTER_COUNT = 5000;

/* ── Code-point helpers ──────────────────────────────────────────────────── */

/**
 * True when the code point is a Unicode combining mark (General_Category
 * M — Mn, Mc and Me). Uses property escapes so ALL scripts are covered
 * (Khmer coeng, Indic vowel signs, Arabic marks, ...), not just Latin.
 * Cached for speed on long texts.
 */
const combiningMarkCache = new Map<number, boolean>();
function isCombiningMark(codePoint: number): boolean {
  const cached = combiningMarkCache.get(codePoint);
  if (cached !== undefined) return cached;
  const result = /\p{M}/u.test(String.fromCodePoint(codePoint));
  combiningMarkCache.set(codePoint, result);
  return result;
}

/** Split a string into Unicode code points. */
export function toCodePoints(text: string): string[] {
  return [...text];
}

/* ── TextTransformations ─────────────────────────────────────────────────── */

/** Apply a character mapping, preserving anything the mapping does not cover. */
export function applyMapping(text: string, alphabet: Map<string, string>): string {
  let out = '';
  for (const ch of text) {
    out += alphabet.get(ch) ?? ch;
  }
  return out;
}

/** Append a combining mark after every base character (glitch styles).
 *  Never appended after whitespace or an existing combining mark, so
 *  accents, emoji sequences and spacing are not corrupted. */
export function addCombiningMark(text: string, mark: string): string {
  let out = '';
  for (const ch of text) {
    out += ch;
    const cp = ch.codePointAt(0)!;
    if (!isCombiningMark(cp) && !/\s/.test(ch)) out += mark;
  }
  return out;
}

/** Insert `spaces` spaces between letters, never inside a combining cluster. */
export function insertLetterSpacing(text: string, spaces: number): string {
  if (spaces <= 0) return text;
  const pad = ' '.repeat(spaces);
  const points = toCodePoints(text);
  let out = '';
  for (let i = 0; i < points.length; i++) {
    out += points[i];
    const next = points[i + 1];
    if (
      next !== undefined &&
      next !== ' ' &&
      points[i] !== ' ' &&
      !isCombiningMark(next.codePointAt(0)!) &&
      !isCombiningMark(points[i].codePointAt(0)!)
    ) {
      out += pad;
    }
  }
  return out;
}

/** Insert a separator between every non-combining, non-space character. */
export function insertSeparator(text: string, separator: string): string {
  if (!separator) return text;
  const points = toCodePoints(text);
  let out = '';
  for (let i = 0; i < points.length; i++) {
    out += points[i];
    const next = points[i + 1];
    if (
      next !== undefined &&
      next !== ' ' &&
      points[i] !== ' ' &&
      !isCombiningMark(next.codePointAt(0)!) &&
      !isCombiningMark(points[i].codePointAt(0)!)
    ) {
      out += separator;
    }
  }
  return out;
}

export function applyCapitalization(text: string, mode: CapitalizationMode): string {
  if (mode === 'upper') return text.toUpperCase();
  if (mode === 'lower') return text.toLowerCase();
  return text;
}

/* ── Engine ──────────────────────────────────────────────────────────────── */

/**
 * Deterministic style engine. The same input always produces the same output.
 */
export class FontStyleEngine {
  readonly styles: readonly FontStyleDefinition[];

  constructor(styles: readonly FontStyleDefinition[]) {
    this.styles = styles;
  }

  /** All style definitions known to the engine. */
  listStyles(): readonly FontStyleDefinition[] {
    return this.styles;
  }

  getStyle(id: string): FontStyleDefinition | undefined {
    return this.styles.find((s) => s.id === id);
  }

  /**
   * Transform text with one style.
   *
   * Pipeline: capitalization → style transform → separator → letter spacing
   * → decoration prefix/suffix.
   */
  transform(text: string, style: FontStyleDefinition, options: TransformOptions = {}): string {
    const capitalization = options.caseMode ?? options.capitalization ?? 'none';
    const decoration = options.decorationId
      ? DECORATIONS.find((d) => d.id === options.decorationId)
      : undefined;
    const separator = options.separatorId
      ? SEPARATORS.find((s) => s.id === options.separatorId)
      : undefined;

    let out = applyCapitalization(text, capitalization);
    out = style.transform(out);
    if (separator && separator.id !== 'none') {
      out = insertSeparator(out, separator.char);
    }
    const spacing = Math.min(Math.max(Math.round(options.letterSpacing ?? 0), 0), 4);
    if (spacing > 0 && style.supportsSpacing !== false) {
      out = insertLetterSpacing(out, spacing);
    }
    if (decoration && decoration.id !== 'none') {
      out = `${decoration.prefix}${out}${decoration.suffix}`;
    }
    return out;
  }
}

/* ── Decoration formatting ───────────────────────────────────────────────── */

/** Formats text with the preset decorations/separators, independent of styles. */
export class TextDecorationFormatter {
  readonly decorations: readonly Decoration[];
  readonly separators: readonly Separator[];

  constructor(
    decorations: readonly Decoration[] = DECORATIONS,
    separators: readonly Separator[] = SEPARATORS
  ) {
    this.decorations = decorations;
    this.separators = separators;
  }

  getDecoration(id: string): Decoration | undefined {
    return this.decorations.find((d) => d.id === id);
  }

  getSeparator(id: string): Separator | undefined {
    return this.separators.find((s) => s.id === id);
  }

  decorate(text: string, decorationId?: string, separatorId?: string): string {
    let out = text;
    const sep = separatorId ? this.getSeparator(separatorId) : undefined;
    if (sep && sep.id !== 'none') out = insertSeparator(out, sep.char);
    const dec = decorationId ? this.getDecoration(decorationId) : undefined;
    if (dec && dec.id !== 'none') out = `${dec.prefix}${out}${dec.suffix}`;
    return out;
  }
}

/* ── Repository ──────────────────────────────────────────────────────────── */

/**
 * Generates style results for text, applying filtering/search/sorting.
 * Equivalent of an Android use-case/repository class: pure and injectable.
 */
export class TextTransformationRepository {
  readonly decorationFormatter: TextDecorationFormatter;
  readonly engine: FontStyleEngine;

  constructor(
    engine: FontStyleEngine,
    decorationFormatter: TextDecorationFormatter = new TextDecorationFormatter()
  ) {
    this.engine = engine;
    this.decorationFormatter = decorationFormatter;
  }

  /** Styles matching a filter, ordered by the requested sort mode. */
  queryStyles(filter: StyleFilter = {}): FontStyleDefinition[] {
    const { category = 'all', search = '', favoriteIds = [], favoritesOnly = false, sort = 'popular', recentIds = [] } = filter;
    const needle = search.trim().toLowerCase();

    let styles = this.engine.listStyles().filter((style) => {
      if (category !== 'all' && style.category !== category) return false;
      if (favoritesOnly && !favoriteIds.includes(style.id)) return false;
      if (needle) {
        const haystack = `${style.name} ${style.description} ${style.category}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });

    styles = [...styles].sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'recent') {
        const ai = recentIds.indexOf(a.id);
        const bi = recentIds.indexOf(b.id);
        if (ai !== bi) return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi);
        return b.popularity - a.popularity;
      }
      return b.popularity - a.popularity || a.name.localeCompare(b.name);
    });
    return styles;
  }

  /** Generate transformed results for every style matching the filter. */
  generate(
    text: string,
    options: TransformOptions = {},
    filter: StyleFilter = {}
  ): FontStyleResult[] {
    return this.queryStyles(filter).map((style) => ({
      styleId: style.id,
      styleName: style.name,
      category: style.category,
      output: this.engine.transform(text, style, options),
      outputKind: style.outputKind,
      fontFamily: style.fontFamily,
    }));
  }

  /** Predictable "copy everything" payload: one `Name: output` per line. */
  formatCopyAll(results: FontStyleResult[], options: { unicodeOnly?: boolean } = {}): string {
    const selected = options.unicodeOnly ? results.filter((r) => r.outputKind === 'unicode') : results;
    return selected.map((r) => `${r.styleName}: ${r.output}`).join('\n');
  }
}

/* ── Local persistence (favorites & recents — never the typed text) ──────── */

export interface RecentEntry {
  styleId: string;
  usedAt: number;
}

const FAVORITES_KEY = 'font-studio:favorites';
const RECENTS_KEY = 'font-studio:recents';
const MAX_RECENTS = 12;

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function loadFavorites(storage: Storage | undefined): string[] {
  if (!storage) return [];
  const parsed = safeParse<unknown>(storage.getItem(FAVORITES_KEY), []);
  return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
}

export function saveFavorites(storage: Storage | undefined, ids: string[]): void {
  try {
    if (ids.length === 0) storage?.removeItem(FAVORITES_KEY);
    else storage?.setItem(FAVORITES_KEY, JSON.stringify(ids));
  } catch {
    /* storage unavailable (private mode) — favorites stay in-memory */
  }
}

export function loadRecents(storage: Storage | undefined): RecentEntry[] {
  if (!storage) return [];
  const parsed = safeParse<unknown>(storage.getItem(RECENTS_KEY), []);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(
      (v): v is RecentEntry =>
        typeof v === 'object' && v !== null &&
        typeof (v as RecentEntry).styleId === 'string' &&
        typeof (v as RecentEntry).usedAt === 'number'
    )
    .slice(0, MAX_RECENTS);
}

export function saveRecents(storage: Storage | undefined, entries: RecentEntry[]): void {
  try {
    if (entries.length === 0) storage?.removeItem(RECENTS_KEY);
    else storage?.setItem(RECENTS_KEY, JSON.stringify(entries.slice(0, MAX_RECENTS)));
  } catch {
    /* storage unavailable */
  }
}

/** Record a style usage, de-duplicated, newest first. */
export function pushRecent(recents: RecentEntry[], styleId: string, now = Date.now()): RecentEntry[] {
  return [{ styleId, usedAt: now }, ...recents.filter((r) => r.styleId !== styleId)].slice(0, MAX_RECENTS);
}

export { FAVORITES_KEY, RECENTS_KEY, MAX_RECENTS };
export type { FontStyleCategoryFilter };
