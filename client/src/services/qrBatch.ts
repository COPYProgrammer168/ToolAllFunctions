/**
 * Batch generation: turns a pasted list of URLs into a ZIP of QR images.
 *
 * Parsing is kept separate from rendering so a messy paste (blank lines,
 * comments, a `label,url` CSV, stray whitespace) can be reasoned about and
 * tested without a canvas. Rendering then walks the parsed list and reports
 * progress, since a few hundred codes takes long enough that a silent UI
 * would look frozen.
 */

import JSZip from 'jszip';
import { exportRaster, safeFileName } from './qrExporter';
import type { QrDesign } from './qrDesign';

export interface BatchEntry {
  /** Text or URL to encode. */
  payload: string;
  /** Optional label, used for the file name and printed caption. */
  label: string;
}

/**
 * Decides whether the text before the first comma is a label.
 *
 * A label is short and word-like; a URL prefix contains a dot or a scheme. This
 * matters because a bare URL can legitimately contain commas in its query
 * string, and splitting on the first comma alone would truncate it.
 */
function looksLikeLabel(candidate: string): boolean {
  if (!candidate) return false;
  if (candidate.length > 40) return false;
  return !/[.:/\s]/.test(candidate);
}

/**
 * Parses one entry per line.
 *
 * Accepts either a bare value or a `label,value` row so a spreadsheet export
 * works directly. Lines starting with `#` are treated as comments, and a
 * header row is skipped when it looks like one.
 */
export function parseBatchList(input: string): BatchEntry[] {
  const lines = input.split(/\r?\n/);
  const entries: BatchEntry[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const commaIndex = line.indexOf(',');
    const candidate = commaIndex > 0 ? line.slice(0, commaIndex).trim() : '';

    // Skip a spreadsheet header such as `label,url`.
    if (/^(label|name|title)$/i.test(candidate)) {
      const value = line.slice(commaIndex + 1).trim();
      if (/^(url|link|value|text)$/i.test(value)) continue;
    }

    const hasLabel = looksLikeLabel(candidate);
    const label = hasLabel ? candidate : '';
    const value = (hasLabel
      ? line.slice(commaIndex + 1)
      : // A leading comma means "no label", so the value starts after it.
        commaIndex === 0
        ? line.slice(1)
        : line
    ).trim();
    if (!value) continue;

    entries.push({ payload: value, label: label || value });
  }

  return entries;
}

/** Adds a scheme when the entry is a bare domain, leaving free text alone. */
function normalizeEntry(payload: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(payload)) return payload;
  if (/\s/.test(payload) || !payload.includes('.')) return payload;
  return `https://${payload}`;
}

/** Makes each file name unique within the archive. */
function uniqueName(used: Set<string>, label: string, index: number): string {
  const base = safeFileName(label || `qr-${index + 1}`, 'png');
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let counter = 2;
  while (used.has(`${counter}-${base}`)) counter += 1;
  const unique = `${counter}-${base}`;
  used.add(unique);
  return unique;
}

/**
 * Renders every entry and packages the PNGs into a ZIP.
 *
 * `onProgress` receives `(done, total)` after each code so the caller can show
 * a real percentage rather than an indeterminate spinner.
 */
export async function buildBatchZip(
  entries: BatchEntry[],
  design: QrDesign,
  onProgress?: (done: number, total: number) => void
): Promise<Blob> {
  if (entries.length === 0) throw new Error('Add at least one URL or line to generate.');

  const zip = new JSZip();
  const used = new Set<string>();
  const total = entries.length;

  for (let index = 0; index < total; index += 1) {
    const entry = entries[index];
    const payload = normalizeEntry(entry.payload);
    const blob = await exportRaster(payload, design, 'png');
    zip.file(uniqueName(used, entry.label, index), blob);
    onProgress?.(index + 1, total);
  }

  // A manifest keeps the mapping from file name back to URL reviewable before
  // the codes are printed and separated from their source list.
  const manifest = entries
    .map((entry, index) => `${index + 1}. ${entry.label}\n${normalizeEntry(entry.payload)}`)
    .join('\n\n');
  zip.file('README.txt', `QR codes — ${total} codes\n\n${manifest}\n`);

  return zip.generateAsync({ type: 'blob' });
}

/** A CSV of the batch, so the list can be reopened or reused later. */
export function batchToCsv(entries: BatchEntry[]): string {
  const escape = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const rows = [['label', 'url'], ...entries.map((e) => [e.label, normalizeEntry(e.payload)])];
  return rows.map((row) => row.map(escape).join(',')).join('\n');
}
