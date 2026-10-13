/**
 * Renders styled text to a transparent PNG using a canvas.
 *
 * Used by font-preview styles whose visual font cannot survive a clipboard
 * copy: the plain text is rendered with the real font and downloaded as a
 * transparent-background image for thumbnails, overlays and artwork.
 */

export interface PngRenderOptions {
  /** CSS font stack, e.g. "'Orbitron', sans-serif". */
  fontFamily: string;
  fontSize?: number;
  /** CSS color for the glyphs (background stays transparent). */
  color?: string;
  padding?: number;
  /** Device pixel scale for crisp output (default 2). */
  scale?: number;
  maxWidth?: number;
}

export interface PngRenderResult {
  blob: Blob;
  width: number;
  height: number;
}

function pickCanvasFont(size: number, family: string): string {
  return `${size}px ${family}`;
}

/** Render text and return a PNG blob (transparent background). */
export async function renderTextToPng(text: string, options: PngRenderOptions): Promise<PngRenderResult> {
  const trimmed = text.replace(/\s+$/, '');
  if (!trimmed) throw new Error('Nothing to render — the text is empty.');

  const fontSize = options.fontSize ?? 64;
  const padding = options.padding ?? Math.round(fontSize * 0.35);
  const scale = options.scale ?? 2;
  const color = options.color ?? '#ffffff';
  const maxWidth = options.maxWidth ?? 1600;

  // Bundled/webfont families must be decoded before canvas can measure or
  // draw with them — otherwise the PNG silently falls back to a system font.
  try {
    await document.fonts.load(`${fontSize}px ${options.fontFamily}`, trimmed);
    await document.fonts.ready;
  } catch {
    /* font loading unsupported — proceed with whatever is available */
  }

  const measureCanvas = document.createElement('canvas');
  const measureCtx = measureCanvas.getContext('2d');
  if (!measureCtx) throw new Error('Canvas 2D is not available in this browser.');

  measureCtx.font = pickCanvasFont(fontSize, options.fontFamily);
  const metrics = measureCtx.measureText(trimmed);

  // Wrap simple single-line text; shrink font when it exceeds maxWidth.
  let usedFontSize = fontSize;
  let width = metrics.width;
  if (width > maxWidth) {
    usedFontSize = Math.max(12, Math.floor((fontSize * maxWidth) / width));
    measureCtx.font = pickCanvasFont(usedFontSize, options.fontFamily);
    width = measureCtx.measureText(trimmed).width;
  }

  const ascent = measureCtx.measureText(trimmed).actualBoundingBoxAscent || usedFontSize * 0.8;
  const descent = measureCtx.measureText(trimmed).actualBoundingBoxDescent || usedFontSize * 0.2;
  const textHeight = ascent + descent;

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil((width + padding * 2) * scale);
  canvas.height = Math.ceil((textHeight + padding * 2) * scale);

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available in this browser.');
  ctx.scale(scale, scale);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = pickCanvasFont(usedFontSize, options.fontFamily);
  ctx.fillStyle = color;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(trimmed, padding, padding + ascent);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('PNG encoding failed.');
  return { blob, width: canvas.width, height: canvas.height };
}

/** Trigger a browser download for a rendered PNG. */
export function downloadPng(result: PngRenderResult, filenameBase: string): void {
  const safeName = filenameBase.replace(/[^a-z0-9\-_]+/gi, '_').slice(0, 60) || 'styled-text';
  const url = URL.createObjectURL(result.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeName}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
