import { describe, expect, it } from 'vitest';
import {
  UNICODE_STYLES,
  applyUnicodeStyle,
  getUnicodeStyle,
  type UnicodeStyleId,
} from '../unicodeStyleEngine';

const style = (id: UnicodeStyleId) => {
  const found = getUnicodeStyle(id);
  if (!found) throw new Error(`missing style: ${id}`);
  return found;
};

describe('unicodeStyleEngine module', () => {
  it('offers the 32 styles in a stable dropdown order', () => {
    expect(UNICODE_STYLES.map((s) => s.id)).toEqual([
      'bold-serif',
      'italic-serif',
      'bold-italic-serif',
      'sans',
      'sans-bold',
      'sans-italic',
      'sans-bold-italic',
      'monospace',
      'double-struck',
      'script',
      'bold-script',
      'fraktur',
      'bold-fraktur',
      'fullwidth',
      'circled',
      'negative-circled',
      'squared',
      'negative-squared',
      'small-caps',
      'parenthesized',
      'superscript',
      'subscript',
      'strikethrough',
      'underline',
      'double-underline',
      'overline',
      'slashed',
      'wavy-underline',
      'upside-down',
      'braille',
      'regional',
      'cyrillic',
    ]);
    expect(new Set(UNICODE_STYLES.map((s) => s.id)).size).toBe(32);
  });

  it('every style really styles plain ASCII text', () => {
    for (const s of UNICODE_STYLES) {
      expect(applyUnicodeStyle('Hello', s.id), s.id).not.toBe('Hello');
    }
  });

  it('transforms letters for every style', () => {
    expect(applyUnicodeStyle('abc', 'bold-serif')).toBe('𝐚𝐛𝐜');
    expect(applyUnicodeStyle('ABC', 'italic-serif')).toBe('𝐴𝐵𝐶');
    expect(applyUnicodeStyle('abc', 'bold-italic-serif')).toBe('𝒂𝒃𝒄');
    expect(applyUnicodeStyle('abc', 'sans')).toBe('𝖺𝖻𝖼');
    expect(applyUnicodeStyle('abc', 'sans-bold')).toBe('𝗮𝗯𝗰');
    expect(applyUnicodeStyle('abc', 'sans-italic')).toBe('𝘢𝘣𝘤');
    expect(applyUnicodeStyle('abc', 'sans-bold-italic')).toBe('𝙖𝙗𝙘');
    expect(applyUnicodeStyle('abc', 'monospace')).toBe('𝚊𝚋𝚌');
    expect(applyUnicodeStyle('abc', 'double-struck')).toBe('𝕒𝕓𝕔');
    expect(applyUnicodeStyle('abc', 'script')).toBe('𝒶𝒷𝒸');
    expect(applyUnicodeStyle('abc', 'bold-script')).toBe('𝓪𝓫𝓬');
    expect(applyUnicodeStyle('abc', 'fraktur')).toBe('𝔞𝔟𝔠');
    expect(applyUnicodeStyle('abc', 'bold-fraktur')).toBe('𝖆𝖇𝖈');
    expect(applyUnicodeStyle('abc', 'fullwidth')).toBe('ａｂｃ');
    expect(applyUnicodeStyle('abc', 'circled')).toBe('ⓐⓑⓒ');
    expect(applyUnicodeStyle('ABC', 'negative-circled')).toBe('🅐🅑🅒');
    expect(applyUnicodeStyle('ABC', 'squared')).toBe('🄰🄱🄲');
    expect(applyUnicodeStyle('ABC', 'negative-squared')).toBe('🅰🅱🅲');
    expect(applyUnicodeStyle('abc', 'parenthesized')).toBe('⒜⒝⒞');
    expect(applyUnicodeStyle('ab', 'superscript')).toBe('ᵃᵇ');
    expect(applyUnicodeStyle('ab', 'subscript')).toBe('ₐb');
    expect(applyUnicodeStyle('AE', 'subscript')).toBe('ₐₑ');
    expect(applyUnicodeStyle('ab', 'strikethrough')).toBe('a\u0336b\u0336');
    expect(applyUnicodeStyle('ab', 'underline')).toBe('a\u0332b\u0332');
    expect(applyUnicodeStyle('ab', 'double-underline')).toBe('a\u0333b\u0333');
    expect(applyUnicodeStyle('ab', 'overline')).toBe('a\u0305b\u0305');
    expect(applyUnicodeStyle('ab', 'slashed')).toBe('a\u0338b\u0338');
    expect(applyUnicodeStyle('ab', 'wavy-underline')).toBe('a\u0330b\u0330');
    expect(applyUnicodeStyle('abc', 'upside-down')).toBe('ɔqɐ');
    expect(applyUnicodeStyle('abc', 'braille')).toBe('⠁⠃⠉');
    expect(applyUnicodeStyle('ab', 'regional')).toBe('🇦🇧');
    expect(applyUnicodeStyle('AB', 'cyrillic')).toBe('\u0410\u0412');
  });

  it('maps digits for styles that define digit glyphs', () => {
    const digits = '0123456789';
    for (const id of ['bold-serif', 'sans', 'sans-bold', 'monospace', 'double-struck', 'fullwidth'] as const) {
      const out = applyUnicodeStyle(digits, id);
      expect([...out].length, id).toBe(10);
      expect(out, id).not.toBe(digits);
    }
    // circled/parenthesized/negative-circled digits 1-9 exist; 0 only circled
    expect(applyUnicodeStyle('0', 'circled')).toBe('\u24ea');
    expect(applyUnicodeStyle('123', 'circled')).toBe('①②③');
    expect(applyUnicodeStyle('123', 'negative-circled')).toBe('❶❷❸');
    expect(applyUnicodeStyle('123', 'parenthesized')).toBe('⑴⑵⑶');
    expect(applyUnicodeStyle('0', 'parenthesized')).toBe('0');
    // styles without digit forms leave them untouched
    expect(applyUnicodeStyle('42', 'script')).toBe('42');
    expect(applyUnicodeStyle('42', 'fraktur')).toBe('42');
    expect(applyUnicodeStyle('42', 'squared')).toBe('42');
  });

  it('small caps leave letters with no Unicode form unchanged', () => {
    // 'b' has no small-capital form — it stays plain, nothing invented
    expect(applyUnicodeStyle('ab', 'small-caps')).toBe('ᴀb');
  });

  it('passes spaces, brackets, symbols, emoji, Khmer and CJK through unchanged', () => {
    const pass = ' []() 🎉 ខ្ញុំ 日本';
    // Combining-mark styles decorate every base character (including
    // punctuation); upside-down reorders by design. All other styles keep
    // the original sequence exactly.
    const decorated = new Set(['strikethrough', 'underline', 'double-underline', 'overline', 'slashed', 'wavy-underline']);
    for (const s of UNICODE_STYLES) {
      if (s.id === 'upside-down' || decorated.has(s.id)) continue;
      const out = applyUnicodeStyle(pass, s.id);
      expect(out, s.id).toContain(' []() ');
      expect(out, s.id).toContain('🎉');
      expect(out, s.id).toContain('ខ្ញុំ');
      expect(out, s.id).toContain('日本');
    }
    for (const id of decorated) {
      const out = applyUnicodeStyle(' a b ', id as UnicodeStyleId);
      expect(out).toContain(' ');
      // Spaces are never decorated, so no combining mark may follow one.
      expect(/\s\p{M}/u.test(out), id).toBe(false);
    }
    const flipped = applyUnicodeStyle(pass, 'upside-down');
    for (const ch of [' ', '[', ']', '(', ')', '🎉']) {
      expect(flipped).toContain(ch);
    }
    // Flipping reverses whole clusters; each code point still survives.
    for (const ch of [...'ខ្ញុំ日本']) expect(flipped).toContain(ch);
  });

  it('never splits supplementary-plane characters', () => {
    for (const s of UNICODE_STYLES) {
      const out = applyUnicodeStyle('🎉😀', s.id);
      // Base code points stay whole; combining-mark styles add marks after them.
      const bases = [...out].filter((ch) => !/\p{M}/u.test(ch));
      expect(bases.length, s.id).toBe(2);
      expect(out, s.id).toContain('🎉');
      expect(out, s.id).toContain('😀');
      if (s.id !== 'upside-down') {
        // Removing any combining decorations must leave the emoji untouched.
        expect(out.replace(/\p{M}/gu, ''), s.id).toBe('🎉😀');
      }
    }
    // Flip text reverses the grapheme order, but each emoji stays whole.
    expect(applyUnicodeStyle('🎉😀', 'upside-down')).toBe('😀🎉');
  });

  it('keeps combining marks attached', () => {
    for (const s of UNICODE_STYLES) {
      expect(applyUnicodeStyle('e\u0301', s.id), s.id).toContain('\u0301');
    }
  });

  it('handles the mathematical alphabet holes', () => {
    expect(applyUnicodeStyle('BEFHILMRego', 'script')).toBe(
      '\u212c\u2130\u2131\u210b\u2110\u2112\u2133\u211b\u212f\u210a\u2134'
    );
    expect(applyUnicodeStyle('CHIRZ', 'fraktur')).toBe('\u212d\u210c\u2111\u211c\u2128');
    expect(applyUnicodeStyle('CHNPQRZ', 'double-struck')).toBe('\u2102\u210d\u2115\u2119\u211a\u211d\u2124');
    expect(applyUnicodeStyle('h', 'italic-serif')).toBe('\u210e');
    // enclosed styles only define one case — the other stays plain
    expect(applyUnicodeStyle('abc', 'squared')).toBe('abc');
    expect(applyUnicodeStyle('abc', 'negative-circled')).toBe('abc');
    expect(applyUnicodeStyle('abc', 'negative-squared')).toBe('abc');
    // parenthesized defines both cases
    expect(applyUnicodeStyle('ABC', 'parenthesized')).toBe('🄐🄑🄒');
  });

  it('is deterministic', () => {
    for (const s of UNICODE_STYLES) {
      const a = applyUnicodeStyle('Font Studio 42', s.id);
      const b = applyUnicodeStyle('Font Studio 42', s.id);
      expect(a, s.id).toBe(b);
    }
  });

  it('getUnicodeStyle returns undefined for unknown ids', () => {
    expect(getUnicodeStyle('nope' as UnicodeStyleId)).toBeUndefined();
    expect(style('sans-bold').name).toBe('Sans Bold');
  });

  it('applyUnicodeStyle accepts style objects and unknown ids gracefully', () => {
    expect(applyUnicodeStyle('Hi', style('monospace'))).toBe('𝙷𝚒');
    expect(applyUnicodeStyle('Hi', 'nope' as UnicodeStyleId)).toBe('Hi');
  });

  it('generated results carry the source text and default style for the UI', () => {
    // engine-pipeline integration: engine.transform with a nickname style
    expect(style('bold-serif').transform('Hi')).toBe('𝐇𝐢');
  });
});
