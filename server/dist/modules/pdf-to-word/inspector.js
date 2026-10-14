import fs from 'node:fs/promises';
import { validatePdfSignature } from './validator.js';
/**
 * Inspects a PDF file using Mozilla PDF.js.
 * Determines page count, password protection status, text extractability,
 * and classifies each page as text-based, scanned, mixed, or uncertain.
 */
export async function inspectPdfDocument(filePath, password) {
    const isSignatureValid = await validatePdfSignature(filePath);
    if (!isSignatureValid) {
        return {
            success: false,
            isCorrupt: true,
            error: 'File is not a valid PDF document (missing %PDF- header signature).',
        };
    }
    let fileBuffer;
    try {
        fileBuffer = await fs.readFile(filePath);
        if (fileBuffer.length === 0) {
            return {
                success: false,
                isCorrupt: true,
                error: 'PDF file is empty (0 bytes).',
            };
        }
    }
    catch (err) {
        return {
            success: false,
            error: `Failed to read file: ${err.message}`,
        };
    }
    let pdfjs;
    try {
        // Dynamic import of PDF.js legacy build for Node
        pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    }
    catch (err) {
        return {
            success: false,
            error: `PDF inspection engine unavailable: ${err.message}`,
        };
    }
    const loadingTask = pdfjs.getDocument({
        data: new Uint8Array(fileBuffer),
        password: password || undefined,
        useSystemFonts: true,
        verbosity: 0,
        stopAtErrors: false,
    });
    let doc;
    try {
        doc = await loadingTask.promise;
    }
    catch (err) {
        if (err && err.name === 'PasswordException') {
            if (err.code === pdfjs.PasswordResponses?.INCORRECT_PASSWORD || (password && password.length > 0)) {
                return {
                    success: false,
                    needsPassword: true,
                    wrongPassword: true,
                    error: 'The provided password for this protected PDF is incorrect.',
                };
            }
            return {
                success: false,
                needsPassword: true,
                wrongPassword: false,
                error: 'This PDF document is encrypted and requires a password to open.',
            };
        }
        return {
            success: false,
            isCorrupt: true,
            error: `PDF document is corrupt or malformed: ${err.message || 'Unknown parsing error'}`,
        };
    }
    try {
        const pageCount = doc.numPages;
        const pageClassifications = [];
        const scannedPages = [];
        let totalTextChars = 0;
        const paintImageXObject = pdfjs.OPS?.paintImageXObject ?? 85;
        const paintInlineImageXObject = pdfjs.OPS?.paintInlineImageXObject ?? 86;
        const paintImageMaskXObject = pdfjs.OPS?.paintImageMaskXObject ?? 87;
        for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
            const page = await doc.getPage(pageNum);
            let pageText = '';
            let imageCount = 0;
            try {
                const textContent = await page.getTextContent();
                for (const item of textContent.items) {
                    if ('str' in item && typeof item.str === 'string') {
                        pageText += item.str;
                    }
                }
            }
            catch {
                // Text content retrieval failed on this page
            }
            try {
                const opList = await page.getOperatorList();
                if (opList && Array.isArray(opList.fnArray)) {
                    for (const op of opList.fnArray) {
                        if (op === paintImageXObject ||
                            op === paintInlineImageXObject ||
                            op === paintImageMaskXObject) {
                            imageCount++;
                        }
                    }
                }
            }
            catch {
                // Operator list retrieval failed on this page
            }
            const textLength = pageText.trim().length;
            totalTextChars += textLength;
            const hasImages = imageCount > 0;
            let classification = 'text';
            if (textLength < 40 && hasImages) {
                classification = 'scanned';
                scannedPages.push(pageNum);
            }
            else if (textLength >= 40 && hasImages) {
                classification = 'mixed';
            }
            else if (textLength >= 40 && !hasImages) {
                classification = 'text';
            }
            else {
                // Less than 40 chars and no images detected
                classification = textLength === 0 ? 'uncertain' : 'text';
                if (textLength === 0) {
                    scannedPages.push(pageNum);
                }
            }
            pageClassifications.push({
                pageNumber: pageNum,
                classification,
                textLength,
                hasImages,
                imageCount,
            });
            page.cleanup();
        }
        const inspection = {
            pageCount,
            isPasswordProtected: Boolean(password && password.length > 0),
            isEncrypted: false,
            hasExtractableText: totalTextChars > 20,
            scannedPages,
            pageClassifications,
        };
        return {
            success: true,
            inspection,
        };
    }
    catch (err) {
        return {
            success: false,
            error: `Failed to inspect PDF pages: ${err.message}`,
        };
    }
    finally {
        try {
            await doc.destroy();
        }
        catch {
            // Ignore cleanup error
        }
    }
}
