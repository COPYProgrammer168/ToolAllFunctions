import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Validates that the file begins with the PDF magic bytes `%PDF-`.
 */
export async function validatePdfSignature(filePath: string): Promise<boolean> {
  let fileHandle;
  try {
    fileHandle = await fs.open(filePath, 'r');
    const buffer = Buffer.alloc(8);
    const { bytesRead } = await fileHandle.read(buffer, 0, 8, 0);
    if (bytesRead < 5) return false;
    const header = buffer.toString('latin1', 0, 5);
    return header === '%PDF-';
  } catch {
    return false;
  } finally {
    if (fileHandle) {
      await fileHandle.close().catch(() => {});
    }
  }
}

/**
 * Validates PDF buffer magic bytes.
 */
export function validatePdfBufferSignature(buffer: Buffer): boolean {
  if (!buffer || buffer.length < 5) return false;
  return buffer.toString('latin1', 0, 5) === '%PDF-';
}

export interface PageRangeResult {
  valid: boolean;
  pages: number[];
  error?: string;
}

/**
 * Parses and validates page ranges such as "1-3", "1,3,5", "1-3,5,8-10".
 * Deduplicates numbers while preserving order, and validates against total page count.
 */
export function parseAndValidatePageRange(
  rangeStr: string | undefined,
  totalPageCount: number
): PageRangeResult {
  if (!rangeStr || rangeStr.trim() === '') {
    // Empty range means all pages
    const pages: number[] = [];
    for (let i = 1; i <= totalPageCount; i++) {
      pages.push(i);
    }
    return { valid: true, pages };
  }

  const cleaned = rangeStr.trim();
  // Valid characters: digits, comma, hyphen, whitespace
  if (!/^[\d\s,-]+$/.test(cleaned)) {
    return {
      valid: false,
      pages: [],
      error: `Invalid page range format "${rangeStr}". Only numbers, commas, and hyphens are allowed.`,
    };
  }

  const parts = cleaned.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) {
    return {
      valid: false,
      pages: [],
      error: 'Page range cannot be empty.',
    };
  }

  const pageSet = new Set<number>();
  const pageList: number[] = [];

  for (const part of parts) {
    if (part.includes('-')) {
      const bounds = part.split('-').map((s) => s.trim());
      if (bounds.length !== 2 || !bounds[0] || !bounds[1]) {
        return {
          valid: false,
          pages: [],
          error: `Malformed range segment: "${part}"`,
        };
      }
      const start = parseInt(bounds[0], 10);
      const end = parseInt(bounds[1], 10);

      if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end <= 0) {
        return {
          valid: false,
          pages: [],
          error: `Page numbers must be positive integers: "${part}"`,
        };
      }

      if (start > end) {
        return {
          valid: false,
          pages: [],
          error: `Start page (${start}) cannot be greater than end page (${end}) in "${part}".`,
        };
      }

      for (let p = start; p <= end; p++) {
        if (p > totalPageCount) {
          return {
            valid: false,
            pages: [],
            error: `Page ${p} exceeds total page count of ${totalPageCount}.`,
          };
        }
        if (!pageSet.has(p)) {
          pageSet.add(p);
          pageList.push(p);
        }
      }
    } else {
      const pageNum = parseInt(part, 10);
      if (!Number.isFinite(pageNum) || pageNum <= 0) {
        return {
          valid: false,
          pages: [],
          error: `Page number must be a positive integer: "${part}"`,
        };
      }
      if (pageNum > totalPageCount) {
        return {
          valid: false,
          pages: [],
          error: `Page ${pageNum} exceeds total page count of ${totalPageCount}.`,
        };
      }
      if (!pageSet.has(pageNum)) {
        pageSet.add(pageNum);
        pageList.push(pageNum);
      }
    }
  }

  if (pageList.length === 0) {
    return {
      valid: false,
      pages: [],
      error: 'No valid pages found in specified page range.',
    };
  }

  return { valid: true, pages: pageList };
}

/**
 * Sanitizes base filename to prevent path traversal and ensure clean .docx output name.
 */
export function sanitizeDocxOutputName(originalName: string): string {
  const base = path.basename(originalName);
  // Strip trailing .pdf and/or .docx to prevent accidental names like example.pdf.docx
  const stripped = base.replace(/(\.pdf|\.docx)+$/i, '');
  const safeBase = stripped
    .replace(/[^a-zA-Z0-9_\-\.\u00A0-\uFFFF ]/g, '_')
    .trim() || 'document';
  return `${safeBase}.docx`;
}
