/**
 * Unicode style engine — the single module that converts text
 * into real Unicode-styled text.
 *
 * The output is plain characters, so it survives anywhere plain
 * text does: Discord nicknames, usernames, chat, code comments.
 * No font files are involved — the styling IS the text.
 *
 * Unicode safety rules enforced here:
 *  - Text is iterated by code point (`Array.from`/`for...of`, never
 *    UTF-16 string indexes), so surrogate pairs (emoji, 𐍈, ...) are
 *    never split into lone surrogates.
 *  - Characters with no mapping in a style — spaces, brackets,
 *    symbols, emoji, Khmer, CJK, combining marks — pass through
 *    unchanged. Nothing is invented to fill a gap.
 *  - Letters that are reserved in the Mathematical Alphanumeric
 *    Symbols block and live in the Letterlike Symbols block
 *    instead are declared explicitly (see the exception maps in
 *    unicodeAlphabets.ts): script B E F H I L M R e g o, fraktur
 *    C H I R Z, double-struck C H N P Q R Z, italic ℎ.
 *  - Digits are mapped only for styles that define digit glyphs;
 *    styles without digit forms leave digits untouched.
 */

import type { FontStyleDefinition } from './fontStyleTypes';
import { applyMapping } from './fontStyleEngine';
import {
  CIRCLED,
  FULLWIDTH,
  MATH_BOLD,
  MATH_BOLD_ITALIC,
  MATH_BOLD_SCRIPT,
  MATH_DOUBLE_STRUCK,
  MATH_FRAKTUR,
  MATH_FRAKTUR_BOLD,
  MATH_ITALIC,
  MATH_MONOSPACE,
  MATH_SANS,
  MATH_SANS_BOLD,
  MATH_SANS_BOLD_ITALIC,
  MATH_SANS_ITALIC,
  MATH_SCRIPT,
  NEGATIVE_CIRCLED,
  NEGATIVE_SQUARED,
  PARENTHESIZED,
  SMALL_CAPITALS,
  SQUARED,
} from './unicodeAlphabets';

/** The 20 Unicode styles offered by the engine. */
export type UnicodeStyleId =
  | 'bold-serif'
  | 'italic-serif'
  | 'bold-italic-serif'
  | 'sans'
  | 'sans-bold'
  | 'sans-italic'
  | 'sans-bold-italic'
  | 'monospace'
  | 'double-struck'
  | 'script'
  | 'bold-script'
  | 'fraktur'
  | 'bold-fraktur'
  | 'fullwidth'
  | 'circled'
  | 'negative-circled'
  | 'squared'
  | 'negative-squared'
  | 'small-caps'
  | 'parenthesized';

/** A Unicode style: a plain engine definition with a fixed style id. */
export interface UnicodeStyle extends FontStyleDefinition {
  id: UnicodeStyleId;
}

/** Every style, in dropdown order. */
export const UNICODE_STYLES: readonly UnicodeStyle[] = [
  { id: 'bold-serif', name: 'Bold Serif', category: 'scifi', description: 'Mathematical bold serif — heavy display lettering.', popularity: 100, outputKind: 'unicode', transform: (t) => applyMapping(t, MATH_BOLD) },
  { id: 'italic-serif', name: 'Italic Serif', category: 'scifi', description: 'Mathematical italic with true vector curves (ℎ keeps its Planck form).', popularity: 95, outputKind: 'unicode', transform: (t) => applyMapping(t, MATH_ITALIC) },
  { id: 'bold-italic-serif', name: 'Bold Italic Serif', category: 'dark-fantasy', description: 'Bold italic serif for tombstone-weight headlines.', popularity: 90, outputKind: 'unicode', transform: (t) => applyMapping(t, MATH_BOLD_ITALIC) },
  { id: 'sans', name: 'Sans', category: 'cyberpunk', description: 'Geometric sans-serif letters and digits.', popularity: 93, outputKind: 'unicode', transform: (t) => applyMapping(t, MATH_SANS) },
  { id: 'sans-bold', name: 'Sans Bold', category: 'gaming', description: 'Heavy sans-serif broadcast lettering.', popularity: 94, outputKind: 'unicode', transform: (t) => applyMapping(t, MATH_SANS_BOLD) },
  { id: 'sans-italic', name: 'Sans Italic', category: 'space', description: 'Weightless sans-italic curves.', popularity: 85, outputKind: 'unicode', transform: (t) => applyMapping(t, MATH_SANS_ITALIC) },
  { id: 'sans-bold-italic', name: 'Sans Bold Italic', category: 'gaming', description: 'Dynamic heavy italic sans.', popularity: 88, outputKind: 'unicode', transform: (t) => applyMapping(t, MATH_SANS_BOLD_ITALIC) },
  { id: 'monospace', name: 'Monospace', category: 'cyberpunk', description: 'Monospace machine code — terminal feeds.', popularity: 92, outputKind: 'unicode', transform: (t) => applyMapping(t, MATH_MONOSPACE) },
  { id: 'double-struck', name: 'Double-Struck', category: 'cyberpunk', description: 'Blackboard letters — ℂ ℍ ℕ ℙ ℚ ℝ ℤ stay canonical.', popularity: 89, outputKind: 'unicode', transform: (t) => applyMapping(t, MATH_DOUBLE_STRUCK) },
  { id: 'script', name: 'Script', category: 'dark-fantasy', description: 'Flowing script — ℬ ℰ ℱ ℋ ℐ ℒ ℳ ℯ ℊ ℴ keep canonical forms.', popularity: 91, outputKind: 'unicode', transform: (t) => applyMapping(t, MATH_SCRIPT) },
  { id: 'bold-script', name: 'Bold Script', category: 'gothic', description: 'Bold calligraphic script with flourish.', popularity: 86, outputKind: 'unicode', transform: (t) => applyMapping(t, MATH_BOLD_SCRIPT) },
  { id: 'fraktur', name: 'Fraktur', category: 'gothic', description: 'True Fraktur blackletter — ℭ ℌ ℑ ℜ ℨ keep canonical forms.', popularity: 96, outputKind: 'unicode', transform: (t) => applyMapping(t, MATH_FRAKTUR) },
  { id: 'bold-fraktur', name: 'Bold Fraktur', category: 'gothic', description: 'Bold Fraktur — cathedral inscriptions.', popularity: 90, outputKind: 'unicode', transform: (t) => applyMapping(t, MATH_FRAKTUR_BOLD) },
  { id: 'fullwidth', name: 'Fullwidth', category: 'scifi', description: 'Fullwidth latin — wide vapourwave text.', popularity: 87, outputKind: 'unicode', transform: (t) => applyMapping(t, FULLWIDTH) },
  { id: 'circled', name: 'Circled', category: 'dark-fantasy', description: 'Circled letters and digits — sealed sigils.', popularity: 82, outputKind: 'unicode', transform: (t) => applyMapping(t, CIRCLED) },
  { id: 'negative-circled', name: 'Negative Circled', category: 'gaming', description: 'Solid circled capitals and digits — loud badges. Lowercase stays plain.', popularity: 78, outputKind: 'unicode', transform: (t) => applyMapping(t, NEGATIVE_CIRCLED) },
  { id: 'squared', name: 'Squared', category: 'scifi', description: 'Squared capitals — blocky stencil tags. Lowercase stays plain.', popularity: 76, outputKind: 'unicode', transform: (t) => applyMapping(t, SQUARED) },
  { id: 'negative-squared', name: 'Negative Squared', category: 'gaming', description: 'Solid squared capitals — cargo-crate weight. Lowercase stays plain.', popularity: 74, outputKind: 'unicode', transform: (t) => applyMapping(t, NEGATIVE_SQUARED) },
  { id: 'small-caps', name: 'Small Caps', category: 'dark-fantasy', description: 'Small-capital letters where Unicode provides them.', popularity: 80, outputKind: 'unicode', transform: (t) => applyMapping(t, SMALL_CAPITALS) },
  { id: 'parenthesized', name: 'Parenthesized', category: 'minimal', description: 'Parenthesized letters and digits — airy, understated.', popularity: 72, outputKind: 'unicode', transform: (t) => applyMapping(t, PARENTHESIZED) },
] as const;

const styleById = new Map<string, UnicodeStyle>(UNICODE_STYLES.map((style) => [style.id, style]));

/** Look up a style by id (undefined when the id is unknown). */
export function getUnicodeStyle(id: UnicodeStyleId): UnicodeStyle | undefined {
  return styleById.get(id);
}

/**
 * Convert text into a Unicode style.
 *
 * Iteration is code-point safe, so supplementary characters are never
 * split. Every character the style's alphabet does not cover is
 * preserved exactly as typed.
 *
 * @param text  The text to convert.
 * @param style A style id, or a style object (for ad-hoc use).
 */
export function applyUnicodeStyle(
  text: string,
  style: UnicodeStyleId | UnicodeStyle
): string {
  const definition = typeof style === 'string' ? styleById.get(style) : style;
  if (!definition) return text;
  let out = '';
  for (const ch of Array.from(text)) {
    out += definition.transform(ch);
  }
  return out;
}
