// @vitest-environment jsdom
/**
 * Tests the composition geometry that the preview and every export share.
 *
 * The subtle one is the background: the QR library paints its own background
 * inside the QR box, while the frame, caption and quiet zone sit outside it.
 * The composition therefore paints the whole output itself and asks the library
 * for a transparent box, and these tests pin that arrangement down — a
 * regression here is invisible until someone exports a framed, gradient-backed
 * code and sees a seam.
 */

import { describe, expect, it } from 'vitest';
import { composeSvg, computeLayout, toQrOptions } from '../qrExporter';
import { DEFAULT_DESIGN, type QrDesign } from '../qrDesign';

const PAYLOAD = 'https://example.com';

function design(overrides: Partial<QrDesign> = {}): QrDesign {
  return { ...DEFAULT_DESIGN, ...overrides };
}

describe('toQrOptions', () => {
  it('keeps the library from painting over the composed background', () => {
    // The library deep-merges its defaults, whose background is opaque white.
    // Anything falsy or omitted would leave that rect covering the gradient.
    const options = toQrOptions(PAYLOAD, design(), 512);
    expect(options.backgroundOptions?.color).toBe('transparent');
    expect(options.backgroundOptions?.gradient).toBeUndefined();
  });

  it('translates the editor angle into the library convention', () => {
    const options = toQrOptions(PAYLOAD, design({ fgGradientEnabled: true }), 512);
    const rotation = options.dotsOptions?.gradient?.rotation;

    // The editor shows CSS angles (0° = up); the library's 0 points right, so
    // its radians must be a quarter turn behind.
    expect(rotation).toBeCloseTo(((DEFAULT_DESIGN.fgGradient.rotation - 90) * Math.PI) / 180);
  });

  it('applies one foreground treatment to dots and both corner styles', () => {
    const options = toQrOptions(PAYLOAD, design({ fgGradientEnabled: true }), 512);
    const dots = options.dotsOptions?.gradient;
    expect(options.cornersSquareOptions?.gradient).toEqual(dots);
    expect(options.cornersDotOptions?.gradient).toEqual(dots);
  });

  it('uses the flat colour when the gradient is off', () => {
    const options = toQrOptions(PAYLOAD, design(), 512);
    expect(options.dotsOptions?.color).toBe(DEFAULT_DESIGN.fgColor);
    expect(options.dotsOptions?.gradient).toBeUndefined();
  });
});

describe('computeLayout', () => {
  it('leaves the code size untouched by the frame', () => {
    const plain = computeLayout(design());
    const framed = computeLayout(design({ frameEnabled: true }));

    // The frame adds space around the code; the code itself must not shrink,
    // or every module would change size when a frame is toggled.
    expect(framed.qrSize).toBe(plain.qrSize);
    expect(framed.outputWidth).toBeGreaterThan(plain.outputWidth);
  });

  it('reserves a caption band only when there is a caption', () => {
    const plain = computeLayout(design());
    const captioned = computeLayout(design({ caption: 'SCAN ME' }));
    expect(captioned.outputHeight).toBeGreaterThan(plain.outputHeight);
    expect(captioned.captionBand).toBeGreaterThan(0);
  });

  it('ignores a caption that is only whitespace', () => {
    expect(computeLayout(design({ caption: '   ' })).captionBand).toBe(0);
  });
});

describe('composeSvg', () => {
  it('produces a standalone SVG at the composed size', async () => {
    const layout = computeLayout(design());
    const svg = await composeSvg(PAYLOAD, design());

    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain(`width="${layout.outputWidth}"`);
    expect(svg).toContain(`height="${layout.outputHeight}"`);
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
    // Exactly one root document, not the library's nested one leaked through.
    expect(svg.match(/<svg\b/g)).toHaveLength(2); // root + the nested QR box
  });

  it('paints a flat background when no gradient is set', async () => {
    const svg = await composeSvg(PAYLOAD, design());
    expect(svg).toContain(`<rect width="100%" height="100%" fill="${DEFAULT_DESIGN.bgColor}"`);
    expect(svg).not.toContain('qr-background');
  });

  it('spans a background gradient across the whole output, not just the code', async () => {
    const d = design({
      bgGradientEnabled: true,
      frameEnabled: true,
      caption: 'SCAN ME',
    });
    const layout = computeLayout(d);
    const svg = await composeSvg(PAYLOAD, d);

    expect(svg).toContain('id="qr-background"');
    // A userSpaceOnUse gradient sized to the code box would leave the frame and
    // caption band outside the gradient. The line must at least span the code.
    const x1 = Number(svg.match(/x1="(-?[\d.]+)"/)?.[1]);
    const y1 = Number(svg.match(/y1="(-?[\d.]+)"/)?.[1]);
    const x2 = Number(svg.match(/x2="(-?[\d.]+)"/)?.[1]);
    const y2 = Number(svg.match(/y2="(-?[\d.]+)"/)?.[1]);

    const span = Math.hypot(x2 - x1, y2 - y1);
    expect(span).toBeGreaterThanOrEqual(Math.max(layout.outputWidth, layout.outputHeight) - 1);
  });

  it('emits the background stops in the order the gradient needs them', async () => {
    const d = design({
      bgGradientEnabled: true,
      bgGradient: {
        type: 'linear',
        rotation: 0,
        // Deliberately out of order: SVG applies stops in document order.
        stops: [
          { offset: 1, color: '#111111' },
          { offset: 0, color: '#eeeeee' },
        ],
      },
    });
    const svg = await composeSvg(PAYLOAD, d);

    const offsets = [...svg.matchAll(/<stop offset="([\d.]+)%"/g)].map((m) => Number(m[1]));
    expect(offsets).toEqual([0, 100]);
  });

  it('keeps the caption and frame on the same background as the code', async () => {
    const d = design({ bgGradientEnabled: true, frameEnabled: true, caption: 'SCAN ME' });
    const svg = await composeSvg(PAYLOAD, d);

    // The background rect must be emitted before the nested QR box so it sits
    // behind the code rather than over it.
    const background = svg.indexOf('fill="url(#qr-background)"');
    const codeBox = svg.indexOf('<svg x="');
    expect(background).toBeGreaterThan(-1);
    expect(codeBox).toBeGreaterThan(-1);
    expect(background).toBeLessThan(codeBox);
    expect(svg).toContain('SCAN ME');
  });
});
