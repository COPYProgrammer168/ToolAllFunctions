/**
 * Unicode alphabets for the Font Studio engine.
 *
 * Every code point in this file is a real, assigned Unicode character.
 * Alphabets with gaps in the standard (mathematical script/italic escapes,
 * fraktur escapees, superscript letters, small-capital letters, ...) declare
 * their exceptions explicitly — nothing is invented to fill a gap.
 *
 * Ranges are generated from base code points so typos cannot silently
 * produce wrong letters; exceptions override specific letters with the
 * characters that actually exist in the Unicode Standard.
 */

import type { UnicodeMapping } from './fontStyleTypes';

export const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
export const DIGITS = '0123456789';

/**
 * Build a character mapping from sequential code-point ranges.
 *
 * @param upperStart      Code point of the styled uppercase 'A'
 *                        (omit when the alphabet has no uppercase set)
 * @param lowerStart      Code point of the styled lowercase 'a'
 * @param digitStart      Code point of the styled digit '0'
 * @param upperExceptions Letter -> code point overrides (real Unicode escapes)
 * @param lowerExceptions Letter -> code point overrides (real Unicode escapes)
 * @param extras          Any additional literal character mappings
 */
export function buildAlphabet(params: {
  upperStart?: number;
  lowerStart?: number;
  digitStart?: number;
  upperExceptions?: Record<string, number>;
  lowerExceptions?: Record<string, number>;
  extras?: Record<string, string>;
}): Map<string, string> {
  const map = new Map<string, string>();
  const upperExc = params.upperExceptions ?? {};
  const lowerExc = params.lowerExceptions ?? {};

  if (params.upperStart !== undefined) {
    UPPERCASE.split('').forEach((ch, i) => {
      const cp = upperExc[ch] ?? params.upperStart! + i;
      map.set(ch, String.fromCodePoint(cp));
    });
  }
  if (params.lowerStart !== undefined) {
    LOWERCASE.split('').forEach((ch, i) => {
      const cp = lowerExc[ch] ?? params.lowerStart! + i;
      map.set(ch, String.fromCodePoint(cp));
    });
  }
  if (params.digitStart !== undefined) {
    DIGITS.split('').forEach((ch, i) => {
      map.set(ch, String.fromCodePoint(params.digitStart! + i));
    });
  }
  for (const [from, to] of Object.entries(params.extras ?? {})) {
    map.set(from, to);
  }
  return map;
}

/** Exceptions that genuinely exist in the Mathematical Alphanumeric Symbols
 *  block and the enclosing Letterlike Symbols block. */

/** Mathematical Script (U+1D49C / U+1D4B6) — 8 capitals + 3 lowercase escape. */
const SCRIPT_UPPER = { B: 0x212c, E: 0x2130, F: 0x2131, H: 0x210b, I: 0x2110, L: 0x2112, M: 0x2133, R: 0x211b };
const SCRIPT_LOWER = { e: 0x212f, g: 0x210a, o: 0x2134 };

/** Mathematical Fraktur (U+1D504 / U+1D51E) — 5 capitals escape to U+2120s. */
const FRAKTUR_UPPER = { C: 0x212d, H: 0x210c, I: 0x2111, R: 0x211c, Z: 0x2128 };

/** Mathematical Italic (U+1D434 / U+1D44E) — only ℎ escapes (U+210E). */
const ITALIC_LOWER = { h: 0x210e };

/** Mathematical Double-Struck (U+1D538 / U+1D552) — 7 capitals escape. */
const DOUBLE_STRUCK_UPPER = { C: 0x2102, H: 0x210d, N: 0x2115, P: 0x2119, Q: 0x211a, R: 0x211d, Z: 0x2124 };

/** Superscript digits: ¹²³ live outside the U+2070 run. */
const SUPERSCRIPT_DIGIT_EXCEPTIONS: Record<string, number> = { 1: 0x00b9, 2: 0x00b2, 3: 0x00b3 };

/** Build the digit map with the ¹²³ exceptions applied. */
function buildSuperscriptDigits(): Map<string, string> {
  const map = new Map<string, string>();
  DIGITS.split('').forEach((ch, i) => {
    const cp = SUPERSCRIPT_DIGIT_EXCEPTIONS[ch] ?? 0x2070 + i;
    map.set(ch, String.fromCodePoint(cp));
  });
  return map;
}

/* ── Complete mathematical alphabets ─────────────────────────────────────── */

export const MATH_BOLD = buildAlphabet({ upperStart: 0x1d400, lowerStart: 0x1d41a, digitStart: 0x1d7ce });

export const MATH_ITALIC = buildAlphabet({ upperStart: 0x1d434, lowerStart: 0x1d44e, lowerExceptions: ITALIC_LOWER });

export const MATH_BOLD_ITALIC = buildAlphabet({ upperStart: 0x1d468, lowerStart: 0x1d482 });

export const MATH_SCRIPT = buildAlphabet({
  upperStart: 0x1d49c,
  lowerStart: 0x1d4b6,
  upperExceptions: SCRIPT_UPPER,
  lowerExceptions: SCRIPT_LOWER,
});

export const MATH_BOLD_SCRIPT = buildAlphabet({ upperStart: 0x1d4d0, lowerStart: 0x1d4ea });

export const MATH_FRAKTUR = buildAlphabet({
  upperStart: 0x1d504,
  lowerStart: 0x1d51e,
  upperExceptions: FRAKTUR_UPPER,
});

export const MATH_FRAKTUR_BOLD = buildAlphabet({ upperStart: 0x1d56c, lowerStart: 0x1d586 });

export const MATH_DOUBLE_STRUCK = buildAlphabet({
  upperStart: 0x1d538,
  lowerStart: 0x1d552,
  digitStart: 0x1d7d8,
  upperExceptions: DOUBLE_STRUCK_UPPER,
});

export const MATH_SANS = buildAlphabet({ upperStart: 0x1d5a0, lowerStart: 0x1d5ba, digitStart: 0x1d7e2 });

export const MATH_SANS_BOLD = buildAlphabet({ upperStart: 0x1d5d4, lowerStart: 0x1d5ee, digitStart: 0x1d7ec });

export const MATH_SANS_ITALIC = buildAlphabet({ upperStart: 0x1d608, lowerStart: 0x1d622 });

export const MATH_MONOSPACE = buildAlphabet({ upperStart: 0x1d670, lowerStart: 0x1d68a, digitStart: 0x1d7f6 });

export const FULLWIDTH = buildAlphabet({ upperStart: 0xff21, lowerStart: 0xff41, digitStart: 0xff10 });

export const CIRCLED = buildAlphabet({ upperStart: 0x24b6, lowerStart: 0x24d0 });

/* ── Partial alphabets (real gaps preserved unchanged by the engine) ──────── */

/** Superscript letters — 'q' and all capitals have no superscript form. */
export const SUPERSCRIPT = new Map<string, string>([
  ['a', '\u1d43'], ['b', '\u1d47'], ['c', '\u1d9c'], ['d', '\u1d48'], ['e', '\u1d49'],
  ['f', '\u1da0'], ['g', '\u1d4d'], ['h', '\u02b0'], ['i', '\u2071'], ['j', '\u02b2'],
  ['k', '\u1d4f'], ['l', '\u02e1'], ['m', '\u1d50'], ['n', '\u207f'], ['o', '\u1d52'],
  ['p', '\u1d56'], ['r', '\u02b3'], ['s', '\u02e2'], ['t', '\u1d57'], ['u', '\u1d58'],
  ['v', '\u1d5b'], ['w', '\u02b7'], ['x', '\u02e3'], ['y', '\u02b8'], ['z', '\u1dbb'],
  ...buildSuperscriptDigits(),
]);

/**
 * Small-capital letters from the Phonetic Extensions block (U+1D00 – U+1D22).
 * Many letters (B, F, G, H, I, L, N, Q, R, S, X, Y) have no small-capital
 * form in Unicode — those are intentionally absent and stay unchanged.
 */
export const SMALL_CAPITALS = new Map<string, string>([
  ['a', '\u1d00'], ['c', '\u1d04'], ['d', '\u1d05'], ['e', '\u1d07'], ['j', '\u1d0a'],
  ['k', '\u1d0b'], ['m', '\u1d0d'], ['o', '\u1d0f'], ['p', '\u1d18'], ['t', '\u1d1b'],
  ['u', '\u1d1c'], ['v', '\u1d20'], ['w', '\u1d21'], ['z', '\u1d22'],
  ['A', '\u1d00'], ['C', '\u1d04'], ['D', '\u1d05'], ['E', '\u1d07'], ['J', '\u1d0a'],
  ['K', '\u1d0b'], ['M', '\u1d0d'], ['O', '\u1d0f'], ['P', '\u1d18'], ['T', '\u1d1b'],
  ['U', '\u1d1c'], ['V', '\u1d20'], ['W', '\u1d21'], ['Z', '\u1d22'],
]);

/* ── Decorations & separators ────────────────────────────────────────────── */

export interface Decoration {
  id: string;
  name: string;
  prefix: string;
  suffix: string;
}

export const DECORATIONS: Decoration[] = [
  { id: 'none', name: 'None', prefix: '', suffix: '' },
  { id: 'brackets', name: 'Square [ ]', prefix: '[', suffix: ']' },
  { id: 'fancy', name: 'Fancy 【】', prefix: '【', suffix: '】' },
  { id: 'lenticular', name: 'Lenticular ⟦ ⟧', prefix: '⟦', suffix: '⟧' },
  { id: 'angle', name: 'Angle « »', prefix: '«', suffix: '»' },
  { id: 'neon', name: 'Neon ║ ║', prefix: '║ ', suffix: ' ║' },
  { id: 'gothic', name: 'Gothic ✠ ✠', prefix: '✠ ', suffix: ' ✠' },
  { id: 'cyber', name: 'Cyber ▰▰ ▰▰', prefix: '▰▰ ', suffix: ' ▰▰' },
  { id: 'space', name: 'Space ✧ ✧', prefix: '✧ ', suffix: ' ✧' },
  { id: 'gamer', name: 'Gamer ▛ ▟', prefix: '▛ ', suffix: ' ▟' },
  { id: 'wave', name: 'Wave 〜〜 〜〜', prefix: '〜〜 ', suffix: ' 〜〜' },
  { id: 'double-line', name: 'Double ═══ ═══', prefix: '═══ ', suffix: ' ═══' },
];

export interface Separator {
  id: string;
  name: string;
  char: string;
}

export const SEPARATORS: Separator[] = [
  { id: 'none', name: 'None', char: '' },
  { id: 'middot', name: 'Middle dot ·', char: '·' },
  { id: 'bullet', name: 'Bullet •', char: '•' },
  { id: 'slash', name: 'Slash /', char: '/' },
  { id: 'star', name: 'Star ✦', char: '✦' },
  { id: 'diaeresis', name: 'Diaeresis ¨', char: '¨' },
];

/* ── Mapping helpers ─────────────────────────────────────────────────────── */

/** Convert a Map alphabet into a plain mapping list (useful for tests). */
export function toMappingList(alphabet: Map<string, string>): UnicodeMapping[] {
  return [...alphabet.entries()].map(([from, to]) => ({ from, to }));
}
