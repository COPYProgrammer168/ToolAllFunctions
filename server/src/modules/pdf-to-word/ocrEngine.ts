import { PDFDocument, PDFName, PDFDict, PDFRawStream } from 'pdf-lib';
import { createWorker } from 'tesseract.js';

export const SUPPORTED_OCR_LANGUAGES: Record<string, string> = {
  eng: 'English',
  khm: 'Khmer',
  fra: 'French',
  deu: 'German',
  spa: 'Spanish',
  ita: 'Italian',
  por: 'Portuguese',
  rus: 'Russian',
  chi_sim: 'Chinese (Simplified)',
  jpn: 'Japanese',
  kor: 'Korean',
  vie: 'Vietnamese',
  tha: 'Thai',
  ara: 'Arabic',
  hin: 'Hindi',
};

/**
 * Validates that all requested language codes are recognized and supported.
 */
export function validateOcrLanguages(languages: string[]): {
  valid: boolean;
  unsupported: string[];
} {
  const unsupported = languages.filter((lang) => !SUPPORTED_OCR_LANGUAGES[lang.toLowerCase()]);
  return {
    valid: unsupported.length === 0,
    unsupported,
  };
}

/**
 * Extracts raw image buffers (JPEG/PNG/stream) from a specific page in a PDF document using pdf-lib.
 */
export async function extractPageImages(
  pdfBuffer: Buffer,
  pageIndexZeroBased: number
): Promise<Buffer[]> {
  const images: Buffer[] = [];
  try {
    const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
    const pages = pdfDoc.getPages();
    if (pageIndexZeroBased < 0 || pageIndexZeroBased >= pages.length) {
      return images;
    }

    const page = pages[pageIndexZeroBased];
    const resources = page.node.Resources();
    if (!resources) return images;

    const xObjects = resources.lookup(PDFName.of('XObject'));
    if (!(xObjects instanceof PDFDict)) return images;

    for (const [nameKey, objRef] of xObjects.entries()) {
      const obj = pdfDoc.context.lookup(objRef);
      if (!(obj instanceof PDFRawStream)) continue;

      const subtype = obj.dict.lookup(PDFName.of('Subtype'));
      if (subtype?.toString() !== '/Image') continue;

      const filter = obj.dict.lookup(PDFName.of('Filter'));
      const filterStr = filter?.toString() || '';

      // DCTDecode is standard JPEG
      if (filterStr === '/DCTDecode' || filterStr.includes('DCTDecode')) {
        const rawBytes = obj.contents;
        images.push(Buffer.from(rawBytes));
      } else {
        // Other image streams (e.g., FlateDecode)
        try {
          const rawBytes = obj.contents;
          if (rawBytes && rawBytes.length > 100) {
            images.push(Buffer.from(rawBytes));
          }
        } catch {
          // Skip if stream decompression is unsupported
        }
      }
    }
  } catch {
    // Graceful fallback if image extraction encounters malformed streams
  }

  return images;
}

export interface PageOcrResult {
  pageNumber: number;
  text: string;
  confidence: number;
  hasUsableText: boolean;
}

/**
 * Runs OCR on a single page's images using tesseract.js.
 */
export async function runOcrOnPage(
  pdfBuffer: Buffer,
  pageNumberOneBased: number,
  languages: string[]
): Promise<PageOcrResult> {
  const pageIdx = pageNumberOneBased - 1;
  const imageBuffers = await extractPageImages(pdfBuffer, pageIdx);

  if (imageBuffers.length === 0) {
    return {
      pageNumber: pageNumberOneBased,
      text: '',
      confidence: 0,
      hasUsableText: false,
    };
  }

  const langCode = languages.join('+') || 'eng';
  let fullText = '';
  let totalConfidence = 0;
  let ocrCount = 0;

  let worker: any = null;
  try {
    worker = await createWorker(langCode);

    for (const imgBuf of imageBuffers) {
      try {
        const ret = await worker.recognize(imgBuf);
        if (ret && ret.data && ret.data.text) {
          const trimmed = ret.data.text.trim();
          if (trimmed.length > 0) {
            fullText += (fullText ? '\n\n' : '') + trimmed;
            totalConfidence += ret.data.confidence || 0;
            ocrCount++;
          }
        }
      } catch {
        // Individual image OCR failed
      }
    }
  } catch (err: any) {
    console.warn(`[OCR Warning] Tesseract worker execution failed for page ${pageNumberOneBased}: ${err.message}`);
  } finally {
    if (worker) {
      try {
        await worker.terminate();
      } catch {}
    }
  }

  const avgConfidence = ocrCount > 0 ? totalConfidence / ocrCount : 0;
  const hasUsableText = fullText.trim().length > 10;

  return {
    pageNumber: pageNumberOneBased,
    text: fullText,
    confidence: avgConfidence,
    hasUsableText,
  };
}
