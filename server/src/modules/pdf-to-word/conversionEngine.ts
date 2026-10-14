import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  PdfToWordOptions,
  ConversionResult,
  ConversionWarning,
  PdfInspection,
} from './types.js';
import { sanitizeDocxOutputName, parseAndValidatePageRange } from './validator.js';
import { inspectPdfDocument } from './inspector.js';
import {
  generatePlainTextDocx,
  generateLayoutDocx,
  type ConvertedPageData,
  type PageContentItem,
} from './docxGenerator.js';
import {
  runOcrOnPage,
  validateOcrLanguages,
  extractPageImages,
} from './ocrEngine.js';

export class ConversionError extends Error {
  constructor(
    message: string,
    public code: string,
    public needsPassword = false,
    public wrongPassword = false
  ) {
    super(message);
    this.name = 'ConversionError';
  }
}

/**
 * Converts a PDF file into a DOCX document according to user options.
 */
export async function convertPdfToDocx(
  filePath: string,
  originalFilename: string,
  outputDir: string,
  options: PdfToWordOptions,
  onProgress?: (percent: number, stage: string) => void,
  signal?: AbortSignal
): Promise<ConversionResult> {
  const warnings: ConversionWarning[] = [];
  const ocrPages: number[] = [];

  onProgress?.(10, 'Inspecting PDF document...');
  if (signal?.aborted) throw new ConversionError('Conversion cancelled', 'CANCELLED');

  // Step 1: Inspection
  const inspectionResult = await inspectPdfDocument(filePath, options.password);
  if (!inspectionResult.success || !inspectionResult.inspection) {
    if (inspectionResult.needsPassword) {
      throw new ConversionError(
        inspectionResult.error || 'Password required',
        'NEEDS_PASSWORD',
        true,
        inspectionResult.wrongPassword
      );
    }
    throw new ConversionError(
      inspectionResult.error || 'Failed to inspect PDF document',
      'INSPECTION_FAILED'
    );
  }

  const inspection: PdfInspection = inspectionResult.inspection;

  // Step 2: Validate page range
  const rangeCheck = parseAndValidatePageRange(options.pageRange, inspection.pageCount);
  if (!rangeCheck.valid) {
    throw new ConversionError(rangeCheck.error || 'Invalid page range', 'INVALID_PAGE_RANGE');
  }

  const targetPages = rangeCheck.pages;
  const totalPagesToConvert = targetPages.length;

  // Step 3: Validate OCR languages if OCR is requested
  const ocrLanguages = options.ocrLanguages && options.ocrLanguages.length > 0
    ? options.ocrLanguages
    : ['eng'];

  if (options.ocrMode !== 'disabled') {
    const langValidation = validateOcrLanguages(ocrLanguages);
    if (!langValidation.valid) {
      warnings.push({
        code: 'OCR_LANG_WARNING',
        message: `Some requested OCR languages (${langValidation.unsupported.join(', ')}) are unsupported and will be skipped.`,
      });
    }
  }

  onProgress?.(25, 'Reading document pages...');
  if (signal?.aborted) throw new ConversionError('Conversion cancelled', 'CANCELLED');

  // Load PDF.js for extraction
  let pdfjs: any;
  try {
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  } catch (err: any) {
    throw new ConversionError(`Failed to initialize PDF parser: ${err.message}`, 'PARSER_INIT_ERROR');
  }

  const fileBuffer = await fs.readFile(filePath);
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(fileBuffer),
    password: options.password || undefined,
    useSystemFonts: true,
    verbosity: 0,
    stopAtErrors: false,
  });

  const pdfDoc = await loadingTask.promise;
  const convertedPages: ConvertedPageData[] = [];

  try {
    for (let i = 0; i < targetPages.length; i++) {
      if (signal?.aborted) throw new ConversionError('Conversion cancelled', 'CANCELLED');
      const pageNum = targetPages[i];
      const pageProgress = 25 + Math.round(((i + 1) / totalPagesToConvert) * 50);
      onProgress?.(pageProgress, `Processing page ${pageNum} of ${inspection.pageCount}...`);

      const page = await pdfDoc.getPage(pageNum);
      const isScanned = inspection.scannedPages.includes(pageNum);
      let pageText = '';
      const items: PageContentItem[] = [];

      // Extract text content and layout positions
      try {
        const textContent = await page.getTextContent();
        const rawItems = textContent.items;

        // Group text items by Y coordinate to detect lines & headings
        interface TextItemRecord {
          str: string;
          x: number;
          y: number;
          height: number;
          width: number;
          fontName: string;
        }

        const positionedItems: TextItemRecord[] = [];
        for (const item of rawItems) {
          if ('str' in item && typeof item.str === 'string') {
            const str = item.str;
            pageText += (pageText.endsWith(' ') || !pageText ? '' : ' ') + str;
            const transform = item.transform || [1, 0, 0, 1, 0, 0];
            positionedItems.push({
              str,
              x: transform[4],
              y: transform[5],
              height: Math.abs(transform[0] || transform[3] || 12),
              width: item.width || 10,
              fontName: item.fontName || '',
            });
          }
        }

        if (options.mode === 'layout' && positionedItems.length > 0) {
          // Sort items top-to-bottom (descending Y in PDF), left-to-right (ascending X)
          positionedItems.sort((a, b) => {
            const yDiff = b.y - a.y;
            if (Math.abs(yDiff) > 4) return yDiff;
            return a.x - b.x;
          });

          // Group lines with ~4pt tolerance
          const lines: TextItemRecord[][] = [];
          let currentLine: TextItemRecord[] = [];
          let currentY = positionedItems[0].y;

          for (const it of positionedItems) {
            if (Math.abs(it.y - currentY) > 5) {
              if (currentLine.length > 0) lines.push(currentLine);
              currentLine = [it];
              currentY = it.y;
            } else {
              currentLine.push(it);
            }
          }
          if (currentLine.length > 0) lines.push(currentLine);

          // Detect potential tables (consecutive lines with 2+ horizontally separated items)
          let inTable = false;
          let tableRows: string[][] = [];

          for (const line of lines) {
            const lineText = line.map((t) => t.str.trim()).filter(Boolean);
            const avgHeight = line.reduce((acc, l) => acc + l.height, 0) / Math.max(1, line.length);

            // Heading detection: significant font height
            if (avgHeight >= 16 && lineText.length <= 8) {
              if (inTable && tableRows.length > 0) {
                items.push({ type: 'table', tableData: tableRows });
                tableRows = [];
                inTable = false;
              }
              items.push({
                type: 'heading',
                text: lineText.join(' '),
                level: avgHeight >= 22 ? 1 : avgHeight >= 18 ? 2 : 3,
              });
              continue;
            }

            // Simple table row detection (multiple columns with gaps)
            if (line.length >= 2 && line.length <= 6) {
              const cells = line.map((c) => c.str.trim());
              tableRows.push(cells);
              inTable = true;
            } else {
              if (inTable && tableRows.length > 0) {
                items.push({ type: 'table', tableData: tableRows });
                tableRows = [];
                inTable = false;
              }
              const joinedText = lineText.join(' ');
              if (joinedText) {
                items.push({
                  type: 'paragraph',
                  text: joinedText,
                  fontSize: Math.round(avgHeight),
                });
              }
            }
          }

          if (inTable && tableRows.length > 0) {
            items.push({ type: 'table', tableData: tableRows });
          }

          // Extract images for layout mode
          try {
            const pageImages = await extractPageImages(fileBuffer, pageNum - 1);
            for (const imgBuf of pageImages.slice(0, 5)) { // Max 5 images per page to prevent memory blowup
              items.push({
                type: 'image',
                imageBuffer: imgBuf,
                imageDimensions: { width: 350, height: 260 },
              });
            }
          } catch {
            // Non-critical image extraction skip
          }
        }
      } catch (err: any) {
        warnings.push({
          code: 'PAGE_EXTRACTION_WARNING',
          message: `Text extraction encountered an issue on page ${pageNum}: ${err.message}`,
        });
      }

      // Step 4: OCR evaluation
      const shouldRunOcr =
        (options.ocrMode === 'enabled' || (options.ocrMode === 'auto' && isScanned)) &&
        pageText.trim().length < 50;

      let ocrPerformed = false;
      if (shouldRunOcr) {
        onProgress?.(pageProgress, `Running OCR on page ${pageNum}...`);
        try {
          const ocrRes = await runOcrOnPage(fileBuffer, pageNum, ocrLanguages);
          if (ocrRes.hasUsableText) {
            pageText += (pageText ? '\n\n' : '') + ocrRes.text;
            items.push({
              type: 'ocr',
              text: ocrRes.text,
            });
            ocrPages.push(pageNum);
            ocrPerformed = true;
          }
        } catch (err: any) {
          warnings.push({
            code: 'OCR_PAGE_FAILED',
            message: `OCR recognition failed on page ${pageNum}: ${err.message}`,
          });
        }
      } else if (isScanned && options.ocrMode === 'disabled') {
        warnings.push({
          code: 'OCR_DISABLED_SCANNED_PAGE',
          message: `Page ${pageNum} appears to be a scanned image, but OCR was disabled. Resulting text may be empty.`,
        });
      }

      convertedPages.push({
        pageNumber: pageNum,
        items,
        rawText: pageText,
        isOcr: ocrPerformed,
      });

      page.cleanup();
    }
  } finally {
    try {
      await pdfDoc.destroy();
    } catch {}
  }

  onProgress?.(80, 'Generating DOCX document...');
  if (signal?.aborted) throw new ConversionError('Conversion cancelled', 'CANCELLED');

  await fs.mkdir(outputDir, { recursive: true });
  const outputName = sanitizeDocxOutputName(originalFilename);
  const outputPath = path.join(outputDir, outputName);

  let modeUsed = options.mode;
  let docxBytes = 0;

  // Step 5: Generate DOCX with fallback
  if (options.mode === 'layout') {
    try {
      docxBytes = await generateLayoutDocx(convertedPages, outputPath);
    } catch (err: any) {
      warnings.push({
        code: 'LAYOUT_FALLBACK',
        message: `Layout conversion encountered an issue (${err.message}). Fell back to high-fidelity plain-text mode.`,
      });
      modeUsed = 'plain-text';
      docxBytes = await generatePlainTextDocx(convertedPages, outputPath);
    }
  } else {
    docxBytes = await generatePlainTextDocx(convertedPages, outputPath);
  }

  // Validate output file
  const stat = await fs.stat(outputPath).catch(() => null);
  if (!stat || stat.size === 0 || docxBytes === 0) {
    throw new ConversionError('Failed to generate DOCX: output file is empty or missing.', 'EMPTY_DOCX');
  }

  onProgress?.(100, 'Conversion completed');

  return {
    outputPath,
    outputName,
    warnings,
    pagesConverted: targetPages.length,
    ocrPages,
    modeUsed,
  };
}
