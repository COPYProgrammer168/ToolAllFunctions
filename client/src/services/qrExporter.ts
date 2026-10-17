/**
 * Renders and exports QR codes.
 *
 * The QR matrix comes from `qr-code-styling` (dot shapes, corner styles,
 * gradients) but the logo is composited here rather than through the library's
 * `image` option. The library draws the image with no backing plate, so a
 * transparent logo would let modules show through it; drawing the plate
 * ourselves is also what keeps the PNG, JPEG, SVG and PDF exports identical.
 *
 * Everything is rendered at `design.size` and then placed onto a larger
 * composition canvas, so adding a frame or caption never changes the module
 * size — only the surrounding space.
 */

import QRCodeStyling from 'qr-code-styling';
import type { Gradient, Options } from 'qr-code-styling';
import {
  computeLogoPlate,
  effectiveErrorCorrection,
  type GradientStop,
  type QrDesign,
} from './qrDesign';

export type RasterFormat = 'png' | 'jpeg';

/** Geometry of the exported image, including any frame and caption band. */
export interface ComposeLayout {
  outputWidth: number;
  outputHeight: number;
  qrSize: number;
  qrX: number;
  qrY: number;
  framePad: number;
  frameWidth: number;
  captionBand: number;
  captionFontSize: number;
}

/**
 * Lays out the QR plus its frame and caption. The caption band sits below the
 * code and outside the frame inset so the frame always wraps the whole block.
 */
export function computeLayout(design: QrDesign): ComposeLayout {
  const size = design.size;
  const framePad = design.frameEnabled ? Math.round(size * 0.05) : 0;
  const hasCaption = design.caption.trim().length > 0;
  const captionBand = hasCaption ? Math.round(size * 0.14) : 0;

  return {
    outputWidth: size + framePad * 2,
    outputHeight: size + framePad * 2 + captionBand,
    qrSize: size,
    qrX: framePad,
    qrY: framePad,
    framePad,
    frameWidth: design.frameEnabled ? Math.max(2, Math.round(size * 0.008)) : 0,
    captionBand,
    captionFontSize: hasCaption ? Math.round(captionBand * 0.42) : 0,
  };
}

/**
 * Converts an editor angle to the rotation the QR library expects.
 *
 * The editor (and the swatch it renders) uses CSS's convention — 0° points up,
 * 90° points right — which the background gradient also follows. The library's
 * 0 radians points left-to-right, so its angles are a quarter turn behind.
 * Without this the foreground gradient would run 90° off the swatch.
 */
function libraryRotation(degrees: number): number {
  return ((degrees - 90) * Math.PI) / 180;
}

/** The library's gradient shape, shared by the dots and both corner styles. */
function foregroundMark(design: QrDesign): { gradient: Gradient } | { color: string } {
  if (!design.fgGradientEnabled) return { color: design.fgColor };
  return {
    gradient: {
      type: design.fgGradient.type,
      rotation: libraryRotation(design.fgGradient.rotation),
      colorStops: design.fgGradient.stops.map((s) => ({ offset: s.offset, color: s.color })),
    },
  };
}

/** Maps the design model onto the library's options object. */
export function toQrOptions(payload: string, design: QrDesign, size: number): Options {
  const options: Options = {
    width: size,
    height: size,
    type: 'canvas',
    data: payload,
    margin: design.margin,
    qrOptions: {
      // Always level H when a logo is present: the plate is damage as far as
      // the decoder is concerned.
      errorCorrectionLevel: effectiveErrorCorrection(design),
    },
    dotsOptions: { type: design.dotStyle, ...foregroundMark(design) },
    cornersSquareOptions: { type: design.cornerSquareStyle, ...foregroundMark(design) },
    cornersDotOptions: { type: design.cornerDotStyle, ...foregroundMark(design) },
    // The library paints its own background rect inside the QR box, with
    // gradient geometry spanning only that box. The composition fills the whole
    // output instead (see `paintBackground`), so the default white here would
    // cover the gradient. A transparent colour keeps the rect but makes it
    // invisible, whatever the library merges in from its own defaults.
    backgroundOptions: { color: 'transparent' },
  };

  return options;
}

/** Renders the bare QR (no logo) as a canvas via the library. */
async function renderQrCanvas(payload: string, design: QrDesign, size: number): Promise<HTMLCanvasElement> {
  const qr = new QRCodeStyling(toQrOptions(payload, design, size));
  const blob = await qr.getRawData('png');
  if (!(blob instanceof Blob)) throw new Error('The QR renderer returned no image.');

  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available in this browser.');
  ctx.drawImage(bitmap, 0, 0, size, size);
  bitmap.close();
  return canvas;
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = src;
  // `decode()` rejects on a corrupt data URL, which is the case we want to
  // report rather than draw a blank plate.
  await img.decode();
  return img;
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

/** The stops of the active background gradient, in offset order. */
function backgroundStops(design: QrDesign): GradientStop[] {
  return [...design.bgGradient.stops].sort((a, b) => a.offset - b.offset);
}

/**
 * A single flat colour standing in for the background.
 *
 * Used for the logo plate, which must blend into the background wherever it
 * sits; with a gradient there is no single correct colour, so the average of
 * the stops is the closest approximation.
 */
function dominantBackground(design: QrDesign): string {
  if (!design.bgGradientEnabled) return design.bgColor;
  const valid = design.bgGradient.stops
    .map((s) => hexToRgb(s.color))
    .filter((c): c is [number, number, number] => c !== null);
  if (valid.length === 0) return design.bgColor;
  const avg = [0, 1, 2].map((i) =>
    Math.round(valid.reduce((sum, c) => sum + c[i], 0) / valid.length)
  );
  return `#${avg.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Geometry of the background gradient, shared by the canvas and SVG painters. */
type GradientLine =
  | { kind: 'radial'; cx: number; cy: number; r: number }
  | { kind: 'linear'; x1: number; y1: number; x2: number; y2: number };

/**
 * Endpoints of the background gradient within the output box.
 *
 * Canvas and SVG need the gradient expressed differently, but they must agree on
 * its geometry, so the maths lives here. The angle follows CSS's 0°-points-up
 * convention, matching the angle shown in the editor. The line spans the whole
 * box on the diagonal so the full stop range is always visible.
 */
function gradientLine(design: QrDesign, layout: ComposeLayout): GradientLine {
  const w = layout.outputWidth;
  const h = layout.outputHeight;
  const half = Math.max(w, h) / 2;
  if (design.bgGradient.type === 'radial') {
    return { kind: 'radial', cx: w / 2, cy: h / 2, r: half };
  }
  const rad = (design.bgGradient.rotation * Math.PI) / 180;
  const dx = Math.sin(rad) * half;
  const dy = -Math.cos(rad) * half;
  return { kind: 'linear', x1: w / 2 - dx, y1: h / 2 - dy, x2: w / 2 + dx, y2: h / 2 + dy };
}

/**
 * Paints the background across the whole composition.
 *
 * The library draws its own background inside the QR box, but the frame,
 * caption and any quiet-zone margin sit outside that box. Filling the entire
 * output here is what keeps those areas on the same paint as the code, rather
 * than showing a flat colour against a gradient.
 */
function paintBackground(
  ctx: CanvasRenderingContext2D,
  design: QrDesign,
  layout: ComposeLayout
): string | CanvasGradient {
  if (!design.bgGradientEnabled) return design.bgColor;

  const line = gradientLine(design, layout);
  const gradient =
    line.kind === 'radial'
      ? ctx.createRadialGradient(line.cx, line.cy, 0, line.cx, line.cy, line.r)
      : ctx.createLinearGradient(line.x1, line.y1, line.x2, line.y2);

  for (const stop of backgroundStops(design)) {
    gradient.addColorStop(Math.min(1, Math.max(0, stop.offset)), stop.color);
  }
  return gradient;
}

/** SVG equivalent of {@link paintBackground}, for the vector export. */
function backgroundSvgMarkup(design: QrDesign, layout: ComposeLayout): string {
  if (!design.bgGradientEnabled) {
    return `<rect width="100%" height="100%" fill="${escapeXml(design.bgColor)}"/>`;
  }

  const line = gradientLine(design, layout);
  const isRadial = line.kind === 'radial';
  const attrs = isRadial
    ? `cx="${line.cx}" cy="${line.cy}" r="${line.r}"`
    : `x1="${line.x1}" y1="${line.y1}" x2="${line.x2}" y2="${line.y2}"`;

  const stops = backgroundStops(design)
    .map(
      (s) =>
        `<stop offset="${Math.min(1, Math.max(0, s.offset)) * 100}%" stop-color="${escapeXml(s.color)}"/>`
    )
    .join('');

  const id = 'qr-background';
  const element = isRadial ? 'radialGradient' : 'linearGradient';
  return (
    `<defs><${element} id="${id}" ${attrs} gradientUnits="userSpaceOnUse">${stops}</${element}></defs>` +
    `<rect width="100%" height="100%" fill="url(#${id})"/>`
  );
}

function hexToRgb(hex: string): [number, number, number] | null {
  const value = hex.trim().replace(/^#/, '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/**
 * Draws the full composition: background, QR, logo plate, logo, frame and
 * caption. `background` is filled first because JPEG has no alpha channel.
 */
export async function composeCanvas(
  payload: string,
  design: QrDesign
): Promise<HTMLCanvasElement> {
  const layout = computeLayout(design);
  const qrCanvas = await renderQrCanvas(payload, design, design.size);

  const canvas = document.createElement('canvas');
  canvas.width = layout.outputWidth;
  canvas.height = layout.outputHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available in this browser.');

  // JPEG cannot store transparency, so both formats get an opaque base.
  ctx.fillStyle = paintBackground(ctx, design, layout);
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.drawImage(qrCanvas, layout.qrX, layout.qrY, layout.qrSize, layout.qrSize);

  // Logo plate + logo, drawn over the modules they cover.
  const plate = computeLogoPlate(design, design.size);
  if (plate && design.logoDataUrl) {
    const px = layout.qrX + plate.x;
    const py = layout.qrY + plate.y;
    const plateColor = dominantBackground(design);

    if (design.logoHideDots) {
      ctx.save();
      roundRectPath(ctx, px, py, plate.size, plate.size, plate.radius);
      ctx.fillStyle = plateColor;
      ctx.fill();
      ctx.restore();
    }

    try {
      const logo = await loadImage(design.logoDataUrl);
      const inner = plate.size - plate.padding * 2;
      ctx.save();
      roundRectPath(ctx, px + plate.padding, py + plate.padding, inner, inner, Math.max(0, plate.radius - plate.padding / 2));
      ctx.clip();
      // Contain the logo rather than stretch it, so non-square marks are not
      // distorted inside the plate.
      const scale = Math.min(inner / logo.width, inner / logo.height);
      const w = logo.width * scale;
      const h = logo.height * scale;
      ctx.drawImage(logo, px + plate.padding + (inner - w) / 2, py + plate.padding + (inner - h) / 2, w, h);
      ctx.restore();
    } catch {
      /* a broken logo must not lose the code — export without it */
    }
  }

  if (design.frameEnabled) {
    const inset = layout.frameWidth / 2;
    roundRectPath(
      ctx,
      inset,
      inset,
      canvas.width - layout.frameWidth,
      canvas.height - layout.frameWidth,
      Math.round(design.size * 0.04)
    );
    ctx.lineWidth = layout.frameWidth;
    ctx.strokeStyle = design.fgColor;
    ctx.stroke();
  }

  if (layout.captionBand > 0) {
    ctx.fillStyle = design.fgColor;
    ctx.font = `700 ${layout.captionFontSize}px "Rajdhani", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      design.caption.trim(),
      canvas.width / 2,
      layout.qrY + layout.qrSize + layout.framePad + layout.captionBand / 2
    );
  }

  return canvas;
}

/** Serialises an SVG with the logo, frame and caption injected. */
export async function composeSvg(payload: string, design: QrDesign): Promise<string> {
  const qr = new QRCodeStyling({ ...toQrOptions(payload, design, design.size), type: 'svg' });
  const blob = await qr.getRawData('svg');
  if (!(blob instanceof Blob)) throw new Error('The QR renderer returned no SVG.');

  const inner = await blob.text();
  const layout = computeLayout(design);

  // Lift the library's own <svg> attributes so the inner group can be nested
  // inside our larger document without losing its viewBox.
  const svgOpen = inner.match(/<svg\b[^>]*>/)?.[0] ?? '<svg>';
  const innerBody = inner
    .replace(/^[\s\S]*?<svg\b[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '');
  const viewBox = svgOpen.match(/viewBox="([^"]+)"/)?.[1] ?? `0 0 ${design.size} ${design.size}`;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
      `width="${layout.outputWidth}" height="${layout.outputHeight}" viewBox="0 0 ${layout.outputWidth} ${layout.outputHeight}">`
  );
  parts.push(backgroundSvgMarkup(design, layout));
  parts.push(
    `<svg x="${layout.qrX}" y="${layout.qrY}" width="${layout.qrSize}" height="${layout.qrSize}" viewBox="${escapeXml(viewBox)}">${innerBody}</svg>`
  );

  const plate = computeLogoPlate(design, design.size);
  if (plate && design.logoDataUrl) {
    const px = layout.qrX + plate.x;
    const py = layout.qrY + plate.y;
    if (design.logoHideDots) {
      parts.push(
        `<rect x="${px}" y="${py}" width="${plate.size}" height="${plate.size}" ` +
          `rx="${plate.radius}" ry="${plate.radius}" fill="${escapeXml(dominantBackground(design))}"/>`
      );
    }
    const innerSize = plate.size - plate.padding * 2;
    parts.push(
      `<clipPath id="qr-logo-clip"><rect x="${px + plate.padding}" y="${py + plate.padding}" ` +
        `width="${innerSize}" height="${innerSize}" rx="${Math.max(0, plate.radius - plate.padding / 2)}" ry="${Math.max(0, plate.radius - plate.padding / 2)}"/></clipPath>`
    );
    parts.push(
      `<image clip-path="url(#qr-logo-clip)" x="${px + plate.padding}" y="${py + plate.padding}" ` +
        `width="${innerSize}" height="${innerSize}" preserveAspectRatio="xMidYMid meet" xlink:href="${escapeXml(design.logoDataUrl)}"/>`
    );
  }

  if (design.frameEnabled) {
    const inset = layout.frameWidth / 2;
    parts.push(
      `<rect x="${inset}" y="${inset}" width="${layout.outputWidth - layout.frameWidth}" ` +
        `height="${layout.outputHeight - layout.frameWidth}" rx="${Math.round(design.size * 0.04)}" ` +
        `fill="none" stroke="${escapeXml(design.fgColor)}" stroke-width="${layout.frameWidth}"/>`
    );
  }

  if (layout.captionBand > 0) {
    const captionY = layout.qrY + layout.qrSize + layout.framePad + layout.captionBand / 2;
    parts.push(
      `<text x="${layout.outputWidth / 2}" y="${captionY}" fill="${escapeXml(design.fgColor)}" ` +
        `font-family="Rajdhani, system-ui, sans-serif" font-size="${layout.captionFontSize}" font-weight="700" ` +
        `text-anchor="middle" dominant-baseline="middle">${escapeXml(design.caption.trim())}</text>`
    );
  }

  parts.push('</svg>');
  return parts.join('');
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function exportRaster(
  payload: string,
  design: QrDesign,
  format: RasterFormat
): Promise<Blob> {
  const canvas = await composeCanvas(payload, design);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, format === 'jpeg' ? 'image/jpeg' : 'image/png', format === 'jpeg' ? 0.94 : undefined)
  );
  if (!blob) throw new Error(`${format.toUpperCase()} encoding failed.`);
  return blob;
}

export async function exportSvgBlob(payload: string, design: QrDesign): Promise<Blob> {
  const svg = await composeSvg(payload, design);
  return new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
}

/** Turns any label into a safe file name, matching the Font Studio exporter. */
export function safeFileName(base: string, extension: string): string {
  const cleaned = base.replace(/[^a-z0-9\-_]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 60);
  return `${cleaned || 'qrcode'}.${extension}`;
}

/** Triggers a browser download for a generated blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Copies a PNG blob to the clipboard, falling back to a download if blocked. */
export async function copyPngToClipboard(blob: Blob, fallbackName: string): Promise<boolean> {
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch {
    downloadBlob(blob, fallbackName);
    return false;
  }
}
