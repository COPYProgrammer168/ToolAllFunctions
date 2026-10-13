import { describe, expect, it } from 'vitest';
import { FONT_STYLES, FONT_STYLE_CATEGORIES } from '../fontStyleCatalog';
import { FontStyleEngine, TextTransformationRepository } from '../fontStyleEngine';
import { toCodePoints } from '../fontStyleEngine';

const engine = new FontStyleEngine(FONT_STYLES);
const repository = new TextTransformationRepository(engine);

/** Text exercising every tricky Unicode surface at once. */
const TORTURE = 'AbZ zZa 09 ! ? ខ្ញុំ 日本 こんにちは 🎉😀 𐍈 e\u0301';

describe('style catalog integrity', () => {
  it('has unique stable ids', () => {
    const ids = FONT_STYLES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^[a-z0-9-]+$/.test(id))).toBe(true);
  });

  it('only references known categories', () => {
    const known = new Set(FONT_STYLE_CATEGORIES.map((c) => c.id));
    for (const style of FONT_STYLES) {
      expect(known.has(style.category)).toBe(true);
    }
  });

  it('covers every category with at least two styles', () => {
    for (const category of FONT_STYLE_CATEGORIES) {
      const count = FONT_STYLES.filter((s) => s.category === category.id).length;
      expect(count, `category ${category.id}`).toBeGreaterThanOrEqual(2);
    }
  });

  it('marks font-preview styles with a font family and unicode styles without', () => {
    for (const style of FONT_STYLES) {
      if (style.outputKind === 'font-preview') {
        expect(style.fontFamily, style.id).toBeTruthy();
        expect(style.transform('unchanged'), style.id).toBe('unchanged');
      } else {
        expect(style.fontFamily, style.id).toBeUndefined();
      }
    }
  });

  it('has a Sci-Fi and a Gothic category with styles in each', () => {
    expect(FONT_STYLES.some((s) => s.category === 'scifi')).toBe(true);
    expect(FONT_STYLES.some((s) => s.category === 'gothic')).toBe(true);
  });

  it('every unicode transform actually changes plain ASCII text', () => {
    for (const style of FONT_STYLES) {
      if (style.outputKind !== 'unicode') continue;
      expect(style.transform('Hello'), style.id).not.toBe('Hello');
    }
  });
});

describe('every transformation mapping', () => {
  it('transforms all 26 lowercase and 26 uppercase ASCII letters for complete alphabets', () => {
    const completeAlphabets = [
      'sci-bold',
      'go-fraktur',
      'go-fraktur-bold',
      'cp-sans',
      'cp-mono',
      'cp-double',
      'gm-sansbold',
      'sp-sansitalic',
      'go-boldscript',
      'sci-fullwidth',
      'sci-italic',
      'sci-script',
      'df-circled',
    ];
    const input = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    for (const id of completeAlphabets) {
      const out = FONT_STYLES.find((s) => s.id === id)!.transform(input);
      // every letter changed position (none preserved unchanged)
      expect(toCodePoints(out).length, id).toBe(52);
      for (let i = 0; i < 26; i++) {
        expect(out[i], `${id} upper ${i}`).not.toBe(input[i]);
        expect(out[26 + i], `${id} lower ${i}`).not.toBe(input[26 + i]);
      }
    }
  });

  it('maps digits where the alphabet defines them', () => {
    const digits = '0123456789';
    for (const id of ['sci-bold', 'cp-sans', 'cp-mono', 'cp-double', 'gm-sansbold', 'sci-fullwidth']) {
      const out = FONT_STYLES.find((s) => s.id === id)!.transform(digits);
      expect(out, id).not.toBe(digits);
      expect([...out].length, id).toBe(10);
    }
  });

  it('preserves unsupported characters under torture input for every style', () => {
    const mustPreserve = ['ខ', '្ញ', 'ុ', 'ំ', '日', '本', 'こ', 'ん', 'に', 'ち', 'は', '🎉', '😀', '𐍈', '\u0301'];
    for (const style of FONT_STYLES) {
      const out = engine.transform(TORTURE, style);
      for (const ch of mustPreserve) {
        expect(out, `style ${style.id} must preserve ${ch.codePointAt(0)?.toString(16)}`).toContain(ch);
      }
    }
  });

  it('never splits supplementary-plane characters', () => {
    for (const style of FONT_STYLES) {
      const out = engine.transform('🎉😀', style);
      expect(out, style.id).toContain('🎉');
      expect(out, style.id).toContain('😀');
      // no lone surrogates in output
      expect(encodeURIComponent(out).includes('%ED%A0%80')).toBe(false);
    }
  });

  it('keeps combining sequences intact under every style', () => {
    for (const style of FONT_STYLES) {
      const out = engine.transform('e\u0301', style);
      expect(out, style.id).toContain('\u0301');
    }
  });

  it('empty and whitespace inputs produce empty/whitespace outputs', () => {
    for (const style of FONT_STYLES) {
      expect(engine.transform('', style), style.id).toBe('');
      expect(engine.transform(' ', style).trim(), style.id).toBe('');
    }
  });

  it('handles very long text (10k chars) without dropping content', () => {
    const long = 'A'.repeat(10000);
    for (const style of FONT_STYLES) {
      const out = engine.transform(long, style);
      // pure ASCII letters may be transformed, but nothing may be dropped
      expect([...out].length, style.id).toBeGreaterThanOrEqual(10000);
    }
  });
});

describe('catalog copy semantics', () => {
  it('copy-all only includes copyable unicode styles when asked', () => {
    const results = repository.generate('Hello');
    const unicodeOnly = repository.formatCopyAll(results, { unicodeOnly: true });
    for (const style of FONT_STYLES) {
      if (style.outputKind === 'font-preview') {
        expect(unicodeOnly).not.toContain(`${style.name}:`);
      }
    }
  });

  it('full copy-all includes font previews with their plain output', () => {
    const results = repository.generate('Hello');
    const payload = repository.formatCopyAll(results);
    for (const style of FONT_STYLES) {
      expect(payload).toContain(`${style.name}:`);
    }
  });
});
