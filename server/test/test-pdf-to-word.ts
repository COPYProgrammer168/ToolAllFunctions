import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { validatePdfSignature, parseAndValidatePageRange, sanitizeDocxOutputName } from '../src/modules/pdf-to-word/validator.js';
import { inspectPdfDocument } from '../src/modules/pdf-to-word/inspector.js';
import { convertPdfToDocx } from '../src/modules/pdf-to-word/conversionEngine.js';
import { PdfJobManager } from '../src/modules/pdf-to-word/jobManager.js';
import { validateOcrLanguages } from '../src/modules/pdf-to-word/ocrEngine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, '../../storage/test-pdf-fixtures');

async function createFixtures() {
  await fs.mkdir(FIXTURES_DIR, { recursive: true });

  // 1. Text-only PDF
  const textPdf = await PDFDocument.create();
  const font = await textPdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await textPdf.embedFont(StandardFonts.HelveticaBold);
  const page1 = textPdf.addPage([600, 400]);
  page1.drawText('Quarterly Business Report', { x: 50, y: 350, size: 22, font: fontBold });
  page1.drawText('This is a text-only PDF designed to verify high-fidelity DOCX conversion.', {
    x: 50,
    y: 310,
    size: 12,
    font,
  });
  page1.drawText('Unicode test characters: English, Symbols (copyright, registered, tm), and Numerals 01234.', {
    x: 50,
    y: 280,
    size: 12,
    font,
  });
  const page2 = textPdf.addPage([600, 400]);
  page2.drawText('Second Page Details', { x: 50, y: 350, size: 18, font: fontBold });
  page2.drawText('This second page validates multi-page pagination and page breaks in DOCX.', {
    x: 50,
    y: 310,
    size: 12,
    font,
  });
  const textPdfBytes = await textPdf.save();
  const textPdfPath = path.join(FIXTURES_DIR, 'text_only.pdf');
  await fs.writeFile(textPdfPath, textPdfBytes);

  // 2. PDF with Table
  const tablePdf = await PDFDocument.create();
  const tPage = tablePdf.addPage([600, 400]);
  tPage.drawText('Financial Overview Table', { x: 50, y: 350, size: 20, font: fontBold });
  // Draw simulated table rows
  tPage.drawText('Item Name', { x: 50, y: 300, size: 12, font: fontBold });
  tPage.drawText('Category', { x: 200, y: 300, size: 12, font: fontBold });
  tPage.drawText('Amount', { x: 350, y: 300, size: 12, font: fontBold });

  tPage.drawText('Server Hosting', { x: 50, y: 270, size: 11, font });
  tPage.drawText('Infrastructure', { x: 200, y: 270, size: 11, font });
  tPage.drawText('$450.00', { x: 350, y: 270, size: 11, font });

  tPage.drawText('Domain Renewal', { x: 50, y: 240, size: 11, font });
  tPage.drawText('Operations', { x: 200, y: 240, size: 11, font });
  tPage.drawText('$25.00', { x: 350, y: 240, size: 11, font });

  const tablePdfBytes = await tablePdf.save();
  const tablePdfPath = path.join(FIXTURES_DIR, 'table_document.pdf');
  await fs.writeFile(tablePdfPath, tablePdfBytes);

  // 3. PDF with embedded Image
  const imgPdf = await PDFDocument.create();
  const iPage = imgPdf.addPage([600, 400]);
  iPage.drawText('Document with Embedded Image', { x: 50, y: 350, size: 18, font: fontBold });
  // Valid 1x1 base64 PNG
  const tinyPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  const embeddedImg = await imgPdf.embedPng(tinyPng);
  iPage.drawImage(embeddedImg, { x: 50, y: 150, width: 100, height: 100 });
  const imgPdfBytes = await imgPdf.save();
  const imgPdfPath = path.join(FIXTURES_DIR, 'image_document.pdf');
  await fs.writeFile(imgPdfPath, imgPdfBytes);

  // 4. Scanned image-only PDF (no extractable text, only image)
  const scannedPdf = await PDFDocument.create();
  const sPage = scannedPdf.addPage([500, 700]);
  const sImg = await scannedPdf.embedPng(tinyPng);
  sPage.drawImage(sImg, { x: 0, y: 0, width: 500, height: 700 });
  const scannedPdfBytes = await scannedPdf.save();
  const scannedPdfPath = path.join(FIXTURES_DIR, 'scanned_image.pdf');
  await fs.writeFile(scannedPdfPath, scannedPdfBytes);

  // 5. Corrupt file & non-PDF file renamed to .pdf
  const corruptPath = path.join(FIXTURES_DIR, 'corrupt.pdf');
  await fs.writeFile(corruptPath, Buffer.from('%PDF-1.4\n%MalformedGarbageData12345\n%%EOF'));

  const nonPdfPath = path.join(FIXTURES_DIR, 'fake_renamed.pdf');
  await fs.writeFile(nonPdfPath, Buffer.from('This is a text file that was maliciously renamed to .pdf'));

  const emptyPdfPath = path.join(FIXTURES_DIR, 'empty.pdf');
  await fs.writeFile(emptyPdfPath, Buffer.alloc(0));

  return {
    textPdfPath,
    tablePdfPath,
    imgPdfPath,
    scannedPdfPath,
    corruptPath,
    nonPdfPath,
    emptyPdfPath,
  };
}

async function runTestSuite() {
  console.log('====================================================');
  console.log('PDF TO WORD CONVERTER — PRODUCTION TEST SUITE');
  console.log('====================================================\n');

  const fixtures = await createFixtures();
  await PdfJobManager.init();

  const outDir = path.join(FIXTURES_DIR, 'output');
  await fs.mkdir(outDir, { recursive: true });

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string) {
    if (condition) {
      console.log(`  ✓ ${msg}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${msg}`);
      failed++;
    }
  }

  // 1. Signature & Magic Byte Validation
  console.log('[Test 1] Magic Bytes Verification');
  assert(await validatePdfSignature(fixtures.textPdfPath), 'Valid PDF magic bytes verified');
  assert(!(await validatePdfSignature(fixtures.nonPdfPath)), 'Non-PDF file correctly rejected');
  assert(!(await validatePdfSignature(fixtures.emptyPdfPath)), 'Empty file correctly rejected');

  // 2. Page Range Parser & Validator
  console.log('\n[Test 2] Page Range Syntax & Bounds');
  const r1 = parseAndValidatePageRange('1-2', 5);
  assert(r1.valid && r1.pages.length === 2 && r1.pages[0] === 1 && r1.pages[1] === 2, 'Range 1-2 parsed');

  const r2 = parseAndValidatePageRange('1,3,5', 10);
  assert(r2.valid && r2.pages.join(',') === '1,3,5', 'Comma-separated range 1,3,5 parsed');

  const r3 = parseAndValidatePageRange('1-3,5,8-10', 12);
  assert(r3.valid && r3.pages.length === 7, 'Combined range 1-3,5,8-10 parsed');

  const r4 = parseAndValidatePageRange('10-5', 15);
  assert(!r4.valid, 'Inverted range (10-5) rejected with error');

  const r5 = parseAndValidatePageRange('1-99', 5);
  assert(!r5.valid, 'Out-of-bounds page range rejected');

  const r6 = parseAndValidatePageRange('abc', 5);
  assert(!r6.valid, 'Non-numeric page range rejected');

  // 3. Document Inspection & Scanned Detection
  console.log('\n[Test 3] PDF Document Inspection & Page Classification');
  const inspText = await inspectPdfDocument(fixtures.textPdfPath);
  assert(inspText.success && inspText.inspection?.pageCount === 2, 'Text PDF has 2 pages');
  assert(inspText.inspection?.hasExtractableText === true, 'Extractable text detected in text PDF');
  assert(inspText.inspection?.pageClassifications[0].classification === 'text', 'Page 1 classified as text');

  const inspScanned = await inspectPdfDocument(fixtures.scannedPdfPath);
  assert(inspScanned.success && inspScanned.inspection?.pageCount === 1, 'Scanned PDF inspected');
  assert(inspScanned.inspection?.scannedPages.includes(1) === true, 'Page 1 classified as scanned');

  // 4. Safe Filename Sanitization
  console.log('\n[Test 4] Output Filename Sanitization');
  assert(sanitizeDocxOutputName('My Report.pdf') === 'My Report.docx', 'Normal PDF extension replaced');
  assert(sanitizeDocxOutputName('../../../etc/passwd.pdf') === 'passwd.docx', 'Path traversal stripped');
  assert(sanitizeDocxOutputName('document.pdf.docx') === 'document.docx', 'Accidental names like example.pdf.docx avoided');

  // 5. OCR Language Validator
  console.log('\n[Test 5] OCR Language Validation');
  const langOk = validateOcrLanguages(['eng', 'khm']);
  assert(langOk.valid, 'Standard OCR languages (eng, khm) accepted');

  const langBad = validateOcrLanguages(['eng', 'klingon_fake']);
  assert(!langBad.valid && langBad.unsupported.includes('klingon_fake'), 'Unsupported OCR language detected');

  // 6. Text-only PDF to DOCX (Layout Mode)
  console.log('\n[Test 6] Accurate Layout Conversion (Text PDF)');
  const res1 = await convertPdfToDocx(
    fixtures.textPdfPath,
    'text_only.pdf',
    outDir,
    { mode: 'layout', ocrMode: 'disabled', ocrLanguages: ['eng'] }
  );
  assert(res1.pagesConverted === 2, 'Converted all 2 requested pages');
  assert(res1.outputName === 'text_only.docx', 'Output filename is text_only.docx');
  const stat1 = await fs.stat(res1.outputPath);
  assert(stat1.size > 2000, `Output DOCX is non-empty (${stat1.size} bytes)`);

  // 7. Plain-Text Conversion Mode
  console.log('\n[Test 7] Plain-Text Mode Conversion');
  const res2 = await convertPdfToDocx(
    fixtures.textPdfPath,
    'text_plain.pdf',
    outDir,
    { mode: 'plain-text', ocrMode: 'disabled', ocrLanguages: ['eng'] }
  );
  assert(res2.modeUsed === 'plain-text', 'Plain-text mode used');
  const stat2 = await fs.stat(res2.outputPath);
  assert(stat2.size > 2000, `Plain-text DOCX generated (${stat2.size} bytes)`);

  // 8. PDF with Table Conversion
  console.log('\n[Test 8] Table PDF Conversion');
  const resTable = await convertPdfToDocx(
    fixtures.tablePdfPath,
    'table_document.pdf',
    outDir,
    { mode: 'layout', ocrMode: 'disabled', ocrLanguages: ['eng'] }
  );
  assert(resTable.pagesConverted === 1, 'Table document converted successfully');

  // 9. Scanned PDF with OCR Disabled Warning
  console.log('\n[Test 9] Scanned PDF with OCR Disabled (Warning Verification)');
  const resScannedDisabled = await convertPdfToDocx(
    fixtures.scannedPdfPath,
    'scanned_no_ocr.pdf',
    outDir,
    { mode: 'layout', ocrMode: 'disabled', ocrLanguages: ['eng'] }
  );
  assert(
    resScannedDisabled.warnings.some((w) => w.code === 'OCR_DISABLED_SCANNED_PAGE'),
    'OCR_DISABLED_SCANNED_PAGE warning generated when OCR is turned off for scanned document'
  );

  // 10. Queue & Job Management Workflow
  console.log('\n[Test 10] Background Job Manager & Queue');
  const job = PdfJobManager.createJob(
    '127.0.0.1',
    [
      {
        originalname: 'file1.pdf',
        filename: 'file1.pdf',
        path: fixtures.textPdfPath,
        size: (await fs.stat(fixtures.textPdfPath)).size,
      },
      {
        originalname: 'file2.pdf',
        filename: 'file2.pdf',
        path: fixtures.tablePdfPath,
        size: (await fs.stat(fixtures.tablePdfPath)).size,
      },
    ],
    { mode: 'layout', ocrMode: 'disabled', ocrLanguages: ['eng'] }
  );
  assert(Boolean(job.jobId && job.downloadToken), 'Job created with ID and downloadToken');
  assert(job.files.length === 2, 'Batch job contains 2 files');

  // Wait for background job to finish
  let attempts = 0;
  while (job.state !== 'done' && job.state !== 'failed' && attempts < 20) {
    await new Promise((r) => setTimeout(r, 500));
    attempts++;
  }
  assert(job.state === 'done', `Batch job completed successfully in background (state: ${job.state})`);

  // 11. Batch ZIP Download
  console.log('\n[Test 11] Batch ZIP Archive Generation');
  const { stream, count } = PdfJobManager.createBatchZipStream(job.jobId);
  assert(count === 2, `ZIP contains all ${count} completed DOCX files`);

  // 12. Job Cancellation
  console.log('\n[Test 12] Job Cancellation');
  const cancelJob = PdfJobManager.createJob(
    '127.0.0.1',
    [
      {
        originalname: 'cancel_me.pdf',
        filename: 'cancel_me.pdf',
        path: fixtures.textPdfPath,
        size: 5000,
      },
    ],
    { mode: 'layout', ocrMode: 'disabled', ocrLanguages: ['eng'] }
  );
  const cancelSuccess = await PdfJobManager.cancelJob(cancelJob.jobId);
  assert(cancelSuccess, 'Job cancellation returned true');
  assert(cancelJob.state === 'cancelled', 'Job marked as cancelled');

  // Cleanup test outputs
  await fs.rm(FIXTURES_DIR, { recursive: true, force: true }).catch(() => {});

  console.log('\n====================================================');
  console.log(`TEST SUMMARY: ${passed} passed, ${failed} failed`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
