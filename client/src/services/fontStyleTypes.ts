/**
 * Font Studio / Text Forge — domain types.
 *
 * The transformation engine is pure TypeScript with no DOM or React
 * dependencies so it can be unit-tested in isolation and reused by any
 * future UI layer (web, mobile, CLI, ...).
 */

import type { UnicodeStyleId } from './unicodeStyleEngine';

/** Style categories offered by the Font Studio. */
export type FontStyleCategoryId =
  | 'scifi'
  | 'cyberpunk'
  | 'gothic'
  | 'dark-fantasy'
  | 'gaming'
  | 'space'
  | 'minimal'
  | 'decorative';

/** 'all' is the virtual category used when browsing every style. */
export type FontStyleCategoryFilter = FontStyleCategoryId | 'all';

export interface FontStyleCategory {
  id: FontStyleCategoryId;
  name: string;
  /** Short blurb shown under the category name. */
  description: string;
}

export type CapitalizationMode = 'none' | 'upper' | 'lower';

/** Controls applied on top of a style's base transformation. */
export interface TransformOptions {
  capitalization?: CapitalizationMode;
  /** Extra spaces inserted between letters (0 = off, max 4). */
  letterSpacing?: number;
  /** Decoration preset id (see TextDecorationFormatter). */
  decorationId?: string;
  /** Separator preset id inserted between every character. */
  separatorId?: string;
  /** Letter-case preset applied to the input before transforming. */
  caseMode?: CapitalizationMode;
}

/** A mapping from a source character to a styled replacement. */
export interface UnicodeMapping {
  /** Source character (a full Unicode code point). */
  from: string;
  /** Replacement character(s). */
  to: string;
}

/** Whether the output is real copyable text, or a visual font preview only. */
export type OutputKind =
  /** Real Unicode text — copying preserves the appearance everywhere
   *  (Discord nicknames included), even without the font installed. */
  | 'unicode'
  /** Real Unicode text as well, plus a visual font that only survives
   *  as a rendered image (Image/PNG export). */
  | 'font-preview';

export interface FontStyleDefinition {
  /** Stable identifier, safe to persist in favorites/history. */
  id: string;
  name: string;
  category: FontStyleCategoryId;
  description: string;
  /** Default sort weight (higher = more popular, shown first). */
  popularity: number;
  outputKind: OutputKind;
  /** CSS font stack for font-preview styles (undefined for unicode styles). */
  fontFamily?: string;
  /** Default nickname style id (see UNICODE_STYLES) used for the card
   *  preview and the Copy button; undefined for styles without a plain
   *  Letterlike/Alphanumeric equivalent (glitch, frames, spacing…). */
  defaultStyleId?: UnicodeStyleId;
  /** Base transformation. Must preserve unsupported characters unchanged. */
  transform: (text: string) => string;
  /** Whether the letter-spacing control applies to this style. */
  supportsSpacing?: boolean;
}

export interface FontStyleResult {
  styleId: string;
  styleName: string;
  category: FontStyleCategoryId;
  output: string;
  outputKind: OutputKind;
  fontFamily?: string;
  /** Raw text the result was generated from (Image/PNG render this in the
   *  card's visual font, so the font look survives the export). */
  sourceText: string;
  /** Card's default nickname style id, when it has one. */
  defaultStyleId?: UnicodeStyleId;
}

export interface StyleFilter {
  category?: FontStyleCategoryFilter;
  search?: string;
  favoriteIds?: string[];
  favoritesOnly?: boolean;
  /** Ordering key; defaults to popularity. */
  sort?: 'popular' | 'name' | 'recent';
  /** Recently used style ids, most recent first (for 'recent' sorting). */
  recentIds?: string[];
}
