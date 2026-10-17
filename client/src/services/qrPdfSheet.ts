/**
 * Builds a printable PDF sheet of QR codes.
 *
 * Done in the browser with jsPDF rather than on the server because the codes
 * are already rendered here: sending the finished PNG data URLs to the server
 * just to place them on a page would be a round-trip for no benefit, and the
 * print preview then matches exactly what the user sees.
 *
 * Each cell is drawn as the QR image plus an optional caption, which is what
 * makes a sheet of labels usable before cutting it up.
 */

import { jsPDF } from 'jspdf';
import { exportRaster } from './qrExporter';
import type { QrDesign } from './qrDesign';

export interface SheetOptions {
  paper: 'a4' | 'letter';
  /** Codes laid out across the page. */
  columns: number;
  /** Vertical gap between rows, in millimetres. */
  rowGapMm: number;
  /** Margins around the grid, in millimetres. */
  marginMm: number;
  /** Print a caption under each code. */
  showLabels: boolean;
}

export const DEFAULT_SHEET_OPTIONS: SheetOptions = {
  paper: 'a4',
  columns: 3,
  rowGapMm: 8,
  marginMm: 14,
  showLabels: true,
};

/** One code to place on the sheet. */
export interface SheetItem {
  /** Encoded content. */
  payload: string;
  /** Label printed under the code (falls back to nothing). */
  label: string;
  design: QrDesign;
}

/** Page dimensions in millimetres. */
const PAPER_SIZES: Record<SheetOptions['paper'], [number, number]> = {
  a4: [210, 297],
  letter: [215.9, 279.4],
};

/** Largest raster used on a sheet — print resolution at label scale. */
const SHEET_RENDER_SIZE = 600;

/**
 * Renders every item and returns a PDF blob with `perPage` codes per page,
 * repeating the list until each requested copy is placed.
 */
export async function buildQrSheet(
  items: SheetItem[],
  options: SheetOptions,
  copies = 1
): Promise<Blob> {
  if (items.length === 0) throw new Error('Add at least one QR code to the sheet.');

  const [pageW, pageH] = PAPER_SIZES[options.paper];
  const columns = Math.min(Math.max(1, Math.floor(options.columns)), 6);
  const margin = Math.max(5, options.marginMm);
  const gap = Math.max(2, options.rowGapMm);

  const cellW = (pageW - margin * 2 - gap * (columns - 1)) / columns;
  const labelBand = options.showLabels ? 6 : 0;
  const cellH = cellW + labelBand;
  const usableH = pageH - margin * 2;
  const rows = Math.max(1, Math.floor((usableH + gap) / (cellH + gap)));
  const perPage = rows * columns;

  // Render each distinct design+payload once; copies reuse the same image.
  const rendered = await Promise.all(
    items.map(async (item) => ({
      label: item.label,
      dataUrl: await rasterToDataUrl(item.payload, { ...item.design, size: SHEET_RENDER_SIZE }),
    }))
  );

  const doc = new jsPDF({ unit: 'mm', format: options.paper, orientation: 'portrait' });

  // Expand the list to the requested number of copies, page by page.
  const queue: typeof rendered = [];
  for (let copy = 0; copy < Math.max(1, copies); copy += 1) queue.push(...rendered);

  queue.forEach((entry, index) => {
    const positionOnPage = index % perPage;
    if (index > 0 && positionOnPage === 0) doc.addPage();

    const row = Math.floor(positionOnPage / columns);
    const col = positionOnPage % columns;

    const cellX = margin + col * (cellW + gap);
    const cellY = margin + row * (cellH + gap);

    // Centre the code within its cell so mixed label heights stay aligned.
    doc.addImage(entry.dataUrl, 'PNG', cellX, cellY, cellW, cellW);

    if (options.showLabels && entry.label) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.text(entry.label, cellX + cellW / 2, cellY + cellW + 3.5, {
        align: 'center',
        maxWidth: cellW,
      });
    }
  });

  return doc.output('blob');
}

/** Renders one design to a PNG data URL for embedding in the PDF. */
async function rasterToDataUrl(payload: string, design: QrDesign): Promise<string> {
  const blob = await exportRaster(payload, design, 'png');
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not encode a QR image for the sheet.'));
    reader.readAsDataURL(blob);
  });
}
