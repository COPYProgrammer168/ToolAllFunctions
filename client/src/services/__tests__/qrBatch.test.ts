// @vitest-environment jsdom
/**
 * Tests batch list parsing. The input here comes from spreadsheets and pasted
 * lists, so the parser has to cope with mess rather than demand clean data.
 */

import { describe, expect, it } from 'vitest';
import { batchToCsv, parseBatchList } from '../qrBatch';

describe('parseBatchList', () => {
  it('reads one bare value per line', () => {
    expect(parseBatchList('a.com\nb.com')).toEqual([
      { payload: 'a.com', label: 'a.com' },
      { payload: 'b.com', label: 'b.com' },
    ]);
  });

  it('reads label,value rows', () => {
    expect(parseBatchList('Promo,a.com/sale')).toEqual([
      { payload: 'a.com/sale', label: 'Promo' },
    ]);
  });

  it('ignores blank lines and comments', () => {
    expect(parseBatchList('\n  \n# a comment\na.com\n')).toEqual([
      { payload: 'a.com', label: 'a.com' },
    ]);
  });

  it('skips a spreadsheet header row', () => {
    expect(parseBatchList('label,url\nPromo,a.com')).toEqual([
      { payload: 'a.com', label: 'Promo' },
    ]);
  });

  it('keeps commas that appear inside the value', () => {
    // Only the first comma separates label from value, so a query string with
    // commas survives intact.
    expect(parseBatchList('Menu,a.com/x?ids=1,2,3')).toEqual([
      { payload: 'a.com/x?ids=1,2,3', label: 'Menu' },
    ]);
  });

  it('handles CRLF line endings', () => {
    expect(parseBatchList('a.com\r\nb.com')).toHaveLength(2);
  });

  it('falls back to the value when a label is empty', () => {
    expect(parseBatchList(',a.com')[0]).toEqual({ payload: 'a.com', label: 'a.com' });
  });

  it('returns nothing for empty input', () => {
    expect(parseBatchList('')).toEqual([]);
    expect(parseBatchList('   \n  ')).toEqual([]);
  });
});

describe('batchToCsv', () => {
  it('writes a header and escapes values containing commas', () => {
    const csv = batchToCsv([{ payload: 'a.com?x=1,2', label: 'A, B' }]);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('label,url');
    // Every field containing a comma must be quote-wrapped, or the row parses
    // as extra columns.
    expect(lines[1]).toBe('"A, B","https://a.com?x=1,2"');
  });

  it('adds a scheme to bare domains only', () => {
    expect(batchToCsv([{ payload: 'a.com', label: 'x' }])).toContain('https://a.com');
    expect(batchToCsv([{ payload: 'plain text', label: 'y' }])).toContain('plain text');
  });
});
