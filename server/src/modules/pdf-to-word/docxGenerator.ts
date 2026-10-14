import fs from 'node:fs/promises';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  HeadingLevel,
  BorderStyle,
  WidthType,
  ImageRun,
} from 'docx';

export interface PageContentItem {
  type: 'paragraph' | 'heading' | 'table' | 'image' | 'ocr';
  text?: string;
  level?: 1 | 2 | 3;
  tableData?: string[][];
  imageBuffer?: Buffer;
  imageDimensions?: { width: number; height: number };
  isBold?: boolean;
  isItalic?: boolean;
  fontSize?: number;
}

export interface ConvertedPageData {
  pageNumber: number;
  items: PageContentItem[];
  rawText: string;
  isOcr?: boolean;
}

/**
 * Builds a plain-text DOCX document from extracted page texts and OCR results.
 * Preserves page ordering, inserts page breaks, and supports all Unicode scripts (including Khmer).
 */
export async function generatePlainTextDocx(
  pages: ConvertedPageData[],
  outputPath: string
): Promise<number> {
  const children: Paragraph[] = [];

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const isFirstPage = i === 0;

    // Page indicator header
    const pageHeader = new Paragraph({
      heading: HeadingLevel.HEADING_3,
      pageBreakBefore: !isFirstPage,
      children: [
        new TextRun({
          text: `Page ${page.pageNumber}${page.isOcr ? ' (OCR Extracted)' : ''}`,
          color: '666666',
          size: 20, // 10pt
          italics: true,
        }),
      ],
      spacing: { after: 200 },
    });
    children.push(pageHeader);

    const paragraphs = page.rawText.split(/\r?\n\s*\r?\n/);
    let addedContent = false;

    for (const para of paragraphs) {
      const cleanPara = para.trim();
      if (!cleanPara) continue;

      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: cleanPara,
              font: 'Calibri',
              size: 24, // 12pt
            }),
          ],
          spacing: { after: 160, line: 360 }, // 1.5 line spacing
        })
      );
      addedContent = true;
    }

    if (!addedContent) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: '[No extractable text on this page]',
              italics: true,
              color: '999999',
            }),
          ],
          spacing: { after: 200 },
        })
      );
    }
  }

  const doc = new Document({
    sections: [
      {
        properties: {},
        children,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  await fs.writeFile(outputPath, buffer);
  return buffer.length;
}

/**
 * Builds a layout-preserved DOCX document.
 * Formats headings, paragraphs, structured tables, images, and page breaks.
 */
export async function generateLayoutDocx(
  pages: ConvertedPageData[],
  outputPath: string
): Promise<number> {
  const children: (Paragraph | Table)[] = [];

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const isFirstPage = i === 0;

    let firstItemOnPage = true;

    if (page.items.length === 0 && !page.rawText.trim()) {
      children.push(
        new Paragraph({
          pageBreakBefore: !isFirstPage,
          children: [
            new TextRun({
              text: `[Page ${page.pageNumber}: Empty or image-only content]`,
              italics: true,
              color: '888888',
            }),
          ],
          spacing: { after: 200 },
        })
      );
      continue;
    }

    for (const item of page.items) {
      const pageBreakBefore = !isFirstPage && firstItemOnPage;
      if (firstItemOnPage) firstItemOnPage = false;

      if (item.type === 'heading') {
        const headingLvl =
          item.level === 1
            ? HeadingLevel.HEADING_1
            : item.level === 2
            ? HeadingLevel.HEADING_2
            : HeadingLevel.HEADING_3;

        children.push(
          new Paragraph({
            heading: headingLvl,
            pageBreakBefore,
            children: [
              new TextRun({
                text: item.text || '',
                bold: true,
                font: 'Calibri',
                size: item.level === 1 ? 36 : item.level === 2 ? 30 : 26,
              }),
            ],
            spacing: { before: 240, after: 160 },
          })
        );
      } else if (item.type === 'table' && item.tableData && item.tableData.length > 0) {
        const rows: TableRow[] = item.tableData.map((rowCells, rIdx) => {
          const isHeaderRow = rIdx === 0;
          return new TableRow({
            tableHeader: isHeaderRow,
            children: rowCells.map(
              (cellText) =>
                new TableCell({
                  width: { size: 100 / Math.max(1, rowCells.length), type: WidthType.PERCENTAGE },
                  children: [
                    new Paragraph({
                      children: [
                        new TextRun({
                          text: cellText.trim() || ' ',
                          bold: isHeaderRow,
                          font: 'Calibri',
                          size: 22,
                        }),
                      ],
                    }),
                  ],
                })
            ),
          });
        });

        const table = new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: {
            top: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
            bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
            left: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
            right: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
            insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'E0E0E0' },
            insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'E0E0E0' },
          },
          rows,
        });

        children.push(table);
      } else if (item.type === 'image' && item.imageBuffer) {
        const dims = item.imageDimensions || { width: 320, height: 240 };
        // Constrain dimensions to reasonable max page width (e.g. 500 max)
        const maxWidth = 500;
        let finalW = dims.width;
        let finalH = dims.height;
        if (finalW > maxWidth) {
          finalH = Math.round((finalH * maxWidth) / finalW);
          finalW = maxWidth;
        }

        children.push(
          new Paragraph({
            pageBreakBefore,
            children: [
              new ImageRun({
                data: item.imageBuffer,
                transformation: {
                  width: Math.max(40, finalW),
                  height: Math.max(40, finalH),
                },
                type: 'jpg',
              }),
            ],
            spacing: { before: 120, after: 160 },
          })
        );
      } else {
        // Standard paragraph
        const text = item.text?.trim() || '';
        if (text) {
          children.push(
            new Paragraph({
              pageBreakBefore,
              children: [
                new TextRun({
                  text,
                  bold: item.isBold,
                  italics: item.isItalic,
                  font: 'Calibri',
                  size: item.fontSize ? item.fontSize * 2 : 24,
                }),
              ],
              spacing: { after: 140, line: 320 },
            })
          );
        }
      }
    }
  }

  const doc = new Document({
    sections: [
      {
        properties: {},
        children,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  await fs.writeFile(outputPath, buffer);
  return buffer.length;
}
