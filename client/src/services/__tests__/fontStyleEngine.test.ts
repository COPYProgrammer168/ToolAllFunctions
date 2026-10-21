import { describe, expect, it } from 'vitest';
import {
  FontStyleEngine,
  TextDecorationFormatter,
  TextTransformationRepository,
  addCombiningMark,
  applyCapitalization,
  applyMapping,
  insertLetterSpacing,
  insertSeparator,
  MAX_RECENTS,
  loadFavorites,
  loadRecents,
  pushRecent,
  saveFavorites,
  saveRecents,
} from '../fontStyleEngine';
import { FONT_STYLES } from '../fontStyleCatalog';
import {
  DECORATIONS,
  MATH_BOLD,
  MATH_DOUBLE_STRUCK,
  MATH_FRAKTUR,
  MATH_ITALIC,
  MATH_SCRIPT,
  SEPARATORS,
  SMALL_CAPITALS,
  SUPERSCRIPT,
} from '../unicodeAlphabets';
import type { FontStyleDefinition } from '../fontStyleTypes';

const engine = new FontStyleEngine(FONT_STYLES);
const repository = new TextTransformationRepository(engine);
const style = (id: string): FontStyleDefinition => {
  const found = FONT_STYLES.find((s) => s.id === id);
  if (!found) throw new Error(`missing style: ${id}`);
  return found;
};

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}

describe('applyMapping', () => {
  it('maps every ASCII letter and digit', () => {
    expect(applyMapping('ABCXYZ', MATH_BOLD)).toBe('𝐀𝐁𝐂𝐗𝐘𝐙');
    expect(applyMapping('abcxyz', MATH_BOLD)).toBe('𝐚𝐛𝐜𝐱𝐲𝐳');
    expect(applyMapping('0123456789', MATH_BOLD)).toBe('𝟎𝟏𝟐𝟑𝟒𝟓𝟔𝟕𝟖𝟗');
  });

  it('preserves punctuation and non-Latin scripts unchanged', () => {
    const input = 'Hello, 123! ខ្ញុំ 日本 🎉 😀';
    const out = applyMapping(input, MATH_BOLD);
    // Latin is transformed...
    expect(out).toContain('𝐇𝐞𝐥𝐥𝐨');
    // ...digits are transformed too...
    expect(out).toContain('𝟏𝟐𝟑');
    // ...but punctuation and non-Latin scripts stay exactly as typed
    expect(out).toContain(', ');
    expect(out).toContain('!');
    expect(out).toContain('ខ្ញុំ');
    expect(out).toContain('日本');
    expect(out).toContain('🎉 😀');
  });

  it('preserves emoji (supplementary plane) without splitting surrogates', () => {
    const emoji = '🎉';
    const out = applyMapping(emoji, MATH_BOLD);
    expect(out).toBe('🎉');
    expect([...out].length).toBe(1);
  });

  it('preserves Khmer script unchanged', () => {
    const khmer = 'ខ្ញុំ';
    expect(applyMapping(khmer, MATH_BOLD)).toBe(khmer);
    expect(applyMapping(khmer, MATH_FRAKTUR)).toBe(khmer);
  });

  it('preserves combining marks in place', () => {
    const decomposed = 'e\u0301'; // e + combining acute
    const out = applyMapping(decomposed, MATH_BOLD);
    expect(out).toBe('\u{1d41e}\u0301'); // mathematical bold e + combining acute, untouched
  });

  it('preserves CJK and mixed-language text structure', () => {
    const mixed = 'Hi 日本 ខ្ញុំ';
    const out = applyMapping(mixed, MATH_BOLD);
    expect(out).toBe('𝐇𝐢 日本 ខ្ញុំ');
  });
});

describe('mathematical alphabet gaps', () => {
  it('mathematical italic escapes ℎ to the Planck constant', () => {
    expect(applyMapping('h', MATH_ITALIC)).toBe('\u210e');
    // every other letter maps into the italic block
    expect(applyMapping('a', MATH_ITALIC)).toBe('\u{1d44e}');
  });

  it('mathematical script escapes B E F H I L M R / e g o', () => {
    expect(applyMapping('B', MATH_SCRIPT)).toBe('\u212c');
    expect(applyMapping('E', MATH_SCRIPT)).toBe('\u2130');
    expect(applyMapping('F', MATH_SCRIPT)).toBe('\u2131');
    expect(applyMapping('H', MATH_SCRIPT)).toBe('\u210b');
    expect(applyMapping('I', MATH_SCRIPT)).toBe('\u2110');
    expect(applyMapping('L', MATH_SCRIPT)).toBe('\u2112');
    expect(applyMapping('M', MATH_SCRIPT)).toBe('\u2133');
    expect(applyMapping('R', MATH_SCRIPT)).toBe('\u211b');
    expect(applyMapping('e', MATH_SCRIPT)).toBe('\u212f');
    expect(applyMapping('g', MATH_SCRIPT)).toBe('\u210a');
    expect(applyMapping('o', MATH_SCRIPT)).toBe('\u2134');
  });

  it('fraktur escapes C H I R Z', () => {
    expect(applyMapping('CHIRZ', MATH_FRAKTUR)).toBe('\u212d\u210c\u2111\u211c\u2128');
  });

  it('double-struck escapes C H N P Q R Z', () => {
    expect(applyMapping('CHNPQRZ', MATH_DOUBLE_STRUCK)).toBe('\u2102\u210d\u2115\u2119\u211a\u211d\u2124');
  });

  it('small capitals leave unmapped letters unchanged (real Unicode gaps)', () => {
    // 'A' and 'P' map; 'C' has a form but 'B' does not — gaps stay plain
    expect(applyMapping('APB', SMALL_CAPITALS)).toBe('\u1d00\u1d18B');
    // 'b', 'f', 'g', 'h', 'i', 'l', 'n', 'q', 'r', 's', 'x', 'y' have no small-capital form
    for (const ch of 'bfghilnqrsxy') {
      expect(applyMapping(ch, SMALL_CAPITALS)).toBe(ch);
    }
  });

  it('superscript leaves q and capitals unchanged', () => {
    expect(applyMapping('q', SUPERSCRIPT)).toBe('q');
    expect(applyMapping('A', SUPERSCRIPT)).toBe('A');
    expect(applyMapping('a', SUPERSCRIPT)).toBe('\u1d43');
    expect(applyMapping('1', SUPERSCRIPT)).toBe('\u00b9');
    expect(applyMapping('4', SUPERSCRIPT)).toBe('\u2074');
  });
});

describe('text utilities', () => {
  it('addCombiningMark strikes each base character once', () => {
    expect(addCombiningMark('ab', '\u0336')).toBe('a\u0336b\u0336');
  });

  it('addCombiningMark never appends after an existing combining mark', () => {
    const decomposed = 'e\u0301';
    expect(addCombiningMark(decomposed, '\u0336')).toBe('e\u0336\u0301');
  });

  it('addCombiningMark keeps emoji intact', () => {
    expect(addCombiningMark('🎉', '\u0336')).toBe('🎉\u0336');
  });

  it('insertLetterSpacing adds spaces and keeps marks attached', () => {
    expect(insertLetterSpacing('ab', 1)).toBe('a b');
    expect(insertLetterSpacing('ab', 3)).toBe('a   b');
    expect(insertLetterSpacing('a b', 1)).toBe('a b');
    expect(insertLetterSpacing('ab', 0)).toBe('ab');
  });

  it('never splits a combining cluster with spacing', () => {
    const decomposed = 'e\u0301x';
    const out = insertLetterSpacing(decomposed, 1);
    // no padding between the base letter and its combining mark
    expect(out).toBe('e\u0301x');
  });

  it('keeps Khmer coeng subscripts intact under spacing', () => {
    // U+17D2 (Khmer coeng) is a combining mark — no split allowed
    expect(insertLetterSpacing('\u1781\u17d2\u1789', 1)).toBe('\u1781\u17d2\u1789');
  });

  it('insertSeparator inserts between non-mark characters only', () => {
    expect(insertSeparator('ab', '·')).toBe('a·b');
    expect(insertSeparator('a b', '·')).toBe('a b');
  });

  it('applyCapitalization handles all modes', () => {
    expect(applyCapitalization('AbC', 'upper')).toBe('ABC');
    expect(applyCapitalization('AbC', 'lower')).toBe('abc');
    expect(applyCapitalization('AbC', 'none')).toBe('AbC');
  });
});

describe('FontStyleEngine', () => {
  it('applies capitalization before transformation', () => {
    expect(engine.transform('abc', style('sci-bold'), { capitalization: 'upper' })).toBe('𝐀𝐁𝐂');
    expect(engine.transform('ABC', style('sci-bold'), { capitalization: 'lower' })).toBe('𝐚𝐛𝐜');
  });

  it('applies letter spacing after transformation', () => {
    expect(engine.transform('ab', style('sci-bold'), { letterSpacing: 1 })).toBe('𝐚 𝐛');
  });

  it('clamps letter spacing to 0..4', () => {
    const out = engine.transform('ab', style('sci-bold'), { letterSpacing: 99 });
    expect(out.split(' ').length).toBe(5); // 4 spaces -> 5 tokens
  });

  it('applies decoration prefix/suffix', () => {
    const out = engine.transform('hi', style('sci-bold'), { decorationId: 'fancy' });
    expect(out).toBe('【𝐡𝐢】');
    expect(engine.transform('hi', style('sci-bold'), { decorationId: 'none' })).toBe('𝐡𝐢');
    expect(engine.transform('hi', style('sci-bold'))).toBe('𝐡𝐢');
  });

  it('applies separator between characters', () => {
    expect(engine.transform('hi', style('sci-bold'), { separatorId: 'middot' })).toBe('𝐡·𝐢');
  });

  it('is deterministic', () => {
    const a = engine.transform('Font Studio 42', style('go-fraktur'), { letterSpacing: 2 });
    const b = engine.transform('Font Studio 42', style('go-fraktur'), { letterSpacing: 2 });
    expect(a).toBe(b);
  });

  it('treats empty and whitespace-only text gracefully', () => {
    expect(engine.transform('', style('sci-bold'))).toBe('');
    expect(engine.transform('   ', style('mn-spaced'))).toBe('   ');
    expect(engine.transform('   ', style('sci-bold'), { letterSpacing: 1 })).toBe('   ');
  });

  it('rejects styles it does not know via getStyle', () => {
    expect(engine.getStyle('nope')).toBeUndefined();
    expect(engine.getStyle('sci-bold')?.id).toBe('sci-bold');
  });
});

describe('TextDecorationFormatter', () => {
  const formatter = new TextDecorationFormatter();

  it('decorates with presets', () => {
    expect(formatter.decorate('hi', 'neon')).toBe('║ hi ║');
    expect(formatter.decorate('hi', 'none')).toBe('hi');
    expect(formatter.decorate('hi')).toBe('hi');
    expect(formatter.decorate('hi', undefined, 'bullet')).toBe('h•i');
  });

  it('exposes every catalog decoration/separator', () => {
    for (const d of DECORATIONS) expect(formatter.getDecoration(d.id)).toBeDefined();
    for (const s of SEPARATORS) expect(formatter.getSeparator(s.id)).toBeDefined();
  });
});

describe('TextTransformationRepository', () => {
  it('filters by category', () => {
    const results = repository.generate('Hi', {}, { category: 'gothic' });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.category === 'gothic')).toBe(true);
  });

  it('filters by search on name and description', () => {
    expect(repository.generate('Hi', {}, { search: 'fraktur' }).length).toBeGreaterThan(0);
    expect(repository.generate('Hi', {}, { search: 'zzz-no-such-style' })).toHaveLength(0);
  });

  it('finds Discord-ready styles through search tags', () => {
    // Every card copies real Unicode text, so "discord" finds all of them.
    expect(repository.queryStyles({ search: 'discord' })).toHaveLength(FONT_STYLES.length);
    const imageCards = FONT_STYLES.filter((s) => s.outputKind === 'font-preview').length;
    expect(repository.queryStyles({ search: 'png' })).toHaveLength(imageCards);
  });

  it('filters to favorites', () => {
    const ids = ['sci-bold', 'go-fraktur'];
    const results = repository.generate('Hi', {}, { favoriteIds: ids, favoritesOnly: true });
    expect(results.map((r) => r.styleId).sort()).toEqual([...ids].sort());
  });

  it('sorts by popularity, name, and recents', () => {
    const popular = repository.queryStyles({ sort: 'popular' });
    expect(popular[0].popularity).toBeGreaterThanOrEqual(popular[popular.length - 1].popularity);

    const byName = repository.queryStyles({ sort: 'name' });
    expect(byName.map((s) => s.name)).toEqual([...byName.map((s) => s.name)].sort((a, b) => a.localeCompare(b)));

    const recent = repository.queryStyles({ sort: 'recent', recentIds: ['gm-pixel'] });
    expect(recent[0].id).toBe('gm-pixel');
  });

  it('never drops unsupported characters in generated results', () => {
    const input = 'Hi ខ្ញុំ 日本 🎉 Q';
    const unsupported = ['ខ', '្ញ', 'ុ', 'ំ', '日', '本', '🎉'];
    for (const result of repository.generate(input)) {
      for (const glyph of unsupported) {
        // Upside-down reverses the cluster order; every code point survives.
        for (const ch of [...glyph]) {
          expect(result.output).toContain(ch);
        }
      }
    }
  });

  it('formats copy-all output predictably', () => {
    const results = repository.generate('Hi');
    const payload = repository.formatCopyAll(results);
    const lines = payload.split('\n');
    expect(lines).toHaveLength(results.length);
    expect(lines[0]).toBe(`${results[0].styleName}: ${results[0].output}`);
  });

  it('copy-all can be limited to copyable unicode results only', () => {
    const results = repository.generate('Hi');
    const payload = repository.formatCopyAll(results, { unicodeOnly: true });
    const unicodeCount = results.filter((r) => r.outputKind === 'unicode').length;
    expect(payload.split('\n')).toHaveLength(unicodeCount);
    expect(payload.split('\n').every((l) => l.includes(':'))).toBe(true);
  });
});

describe('favorites & recents persistence', () => {
  it('round-trips favorites through storage', () => {
    const storage = new MemoryStorage();
    saveFavorites(storage, ['sci-bold', 'go-fraktur']);
    expect(loadFavorites(storage)).toEqual(['sci-bold', 'go-fraktur']);
  });

  it('returns empty favorites when storage is empty, broken, or missing', () => {
    expect(loadFavorites(undefined)).toEqual([]);
    const storage = new MemoryStorage();
    storage.setItem('font-studio:favorites', '{not json');
    expect(loadFavorites(storage)).toEqual([]);
  });

  it('round-trips recents and drops malformed entries', () => {
    const storage = new MemoryStorage();
    storage.setItem('font-studio:recents', '[{"styleId":"sci-bold","usedAt":123},{"bad":true},null]');
    const loaded = loadRecents(storage);
    expect(loaded).toEqual([{ styleId: 'sci-bold', usedAt: 123 }]);
  });

  it('pushRecent de-duplicates, keeps newest first, caps length', () => {
    let recents = pushRecent([], 'a', 1);
    recents = pushRecent(recents, 'b', 2);
    recents = pushRecent(recents, 'a', 3);
    expect(recents).toEqual([
      { styleId: 'a', usedAt: 3 },
      { styleId: 'b', usedAt: 2 },
    ]);
    for (let i = 0; i < 30; i++) recents = pushRecent(recents, `s${i}`, i);
    expect(recents.length).toBe(MAX_RECENTS);
  });

  it('persists recents capped at MAX_RECENTS', () => {
    const storage = new MemoryStorage();
    saveRecents(storage, Array.from({ length: 30 }, (_, i) => ({ styleId: `s${i}`, usedAt: i })));
    expect(loadRecents(storage)).toHaveLength(MAX_RECENTS);
  });

  it('never stores typed text — only style ids', () => {
    const storage = new MemoryStorage();
    saveFavorites(storage, ['sci-bold']);
    saveRecents(storage, [{ styleId: 'sci-bold', usedAt: 1 }]);
    for (const value of [storage.getItem('font-studio:favorites'), storage.getItem('font-studio:recents')]) {
      expect(value).not.toContain('Hello');
    }
  });
});
