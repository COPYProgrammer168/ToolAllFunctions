// @vitest-environment jsdom
/**
 * Tests the design safety rules — the checks that decide whether a styled code
 * can still be read by a phone.
 */

import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_PRESETS,
  DEFAULT_DESIGN,
  MAX_SAFE_LOGO_PCT,
  MIN_MARGIN_MODULES,
  computeLogoPlate,
  contrastRatio,
  effectiveErrorCorrection,
  validateDesign,
  type QrDesign,
} from '../qrDesign';

const withLogo = (overrides: Partial<QrDesign> = {}): QrDesign => ({
  ...DEFAULT_DESIGN,
  logoDataUrl: 'data:image/png;base64,AAAA',
  ...overrides,
});

describe('contrastRatio', () => {
  it('reports maximum contrast for black on white', () => {
    const ratio = contrastRatio(DEFAULT_DESIGN);
    expect(ratio).toBeGreaterThan(20);
  });

  it('detects an unreadable low-contrast pairing', () => {
    // Grey code on a near-white background is the classic "looks nice, will
    // not scan" mistake.
    const ratio = contrastRatio({ ...DEFAULT_DESIGN, fgColor: '#dddddd', bgColor: '#ffffff' });
    expect(ratio).not.toBeNull();
    expect(ratio as number).toBeLessThan(3);
  });

  it('uses the worst-case stop when gradients are enabled', () => {
    const ratio = contrastRatio({
      ...DEFAULT_DESIGN,
      fgGradientEnabled: true,
      fgGradient: {
        type: 'linear',
        rotation: 0,
        stops: [
          { offset: 0, color: '#000000' },
          { offset: 1, color: '#f0f0f0' },
        ],
      },
    });
    // The light stop against a white background is nearly invisible, so the
    // reported ratio must reflect that rather than the dark stop.
    expect(ratio as number).toBeLessThan(3);
  });

  it('returns null for an unparseable colour', () => {
    expect(contrastRatio({ ...DEFAULT_DESIGN, fgColor: 'not-a-colour' })).toBeNull();
  });
});

describe('validateDesign', () => {
  it('accepts the default design', () => {
    expect(validateDesign(DEFAULT_DESIGN).filter((i) => i.level === 'error')).toHaveLength(0);
  });

  it('flags a quiet zone below the spec minimum', () => {
    const issues = validateDesign({ ...DEFAULT_DESIGN, margin: MIN_MARGIN_MODULES - 1 });
    expect(issues.some((i) => i.level === 'warn' && /quiet zone/i.test(i.message))).toBe(true);
  });

  it('treats unreadable contrast as an error', () => {
    const issues = validateDesign({ ...DEFAULT_DESIGN, fgColor: '#eeeeee', bgColor: '#ffffff' });
    expect(issues.some((i) => i.level === 'error')).toBe(true);
  });

  it('warns when the logo covers too much of the code', () => {
    const issues = validateDesign(withLogo({ logoSizePct: MAX_SAFE_LOGO_PCT + 5 }));
    expect(issues.some((i) => i.level === 'warn' && /logo covers/i.test(i.message))).toBe(true);
  });

  it('requires level H when a large logo is used', () => {
    const tooBig = withLogo({ logoSizePct: MAX_SAFE_LOGO_PCT + 5, errorCorrection: 'M' });
    expect(validateDesign(tooBig).some((i) => i.level === 'error')).toBe(true);

    // The same design at level H is acceptable (merely warned about).
    const atH = withLogo({ logoSizePct: MAX_SAFE_LOGO_PCT + 5, errorCorrection: 'H' });
    expect(validateDesign(atH).some((i) => i.level === 'error')).toBe(false);
  });
});

describe('effectiveErrorCorrection', () => {
  it('leaves the level alone without a logo', () => {
    expect(effectiveErrorCorrection({ ...DEFAULT_DESIGN, errorCorrection: 'L' })).toBe('L');
  });

  it('raises L and M to H once a logo is present', () => {
    expect(effectiveErrorCorrection(withLogo({ errorCorrection: 'L' }))).toBe('H');
    expect(effectiveErrorCorrection(withLogo({ errorCorrection: 'M' }))).toBe('H');
  });

  it('keeps an explicitly requested Q or H', () => {
    expect(effectiveErrorCorrection(withLogo({ errorCorrection: 'Q' }))).toBe('Q');
    expect(effectiveErrorCorrection(withLogo({ errorCorrection: 'H' }))).toBe('H');
  });
});

describe('computeLogoPlate', () => {
  it('returns null when there is no logo', () => {
    expect(computeLogoPlate(DEFAULT_DESIGN, 1000)).toBeNull();
  });

  it('centres the plate and sizes it from the percentage', () => {
    const plate = computeLogoPlate(withLogo({ logoSizePct: 20 }), 1000);
    expect(plate).not.toBeNull();
    if (!plate) return;
    expect(plate.size).toBe(200);
    expect(plate.x).toBe(400);
    expect(plate.y).toBe(400);
    // The plate must stay inside the code bounds.
    expect(plate.x + plate.size).toBeLessThanOrEqual(1000);
  });

  it('keeps the padding inside the plate size', () => {
    // Padding is inset, so the plate never grows past the size the safety
    // limit is expressed against.
    const plate = computeLogoPlate(withLogo({ logoSizePct: 25, logoPaddingPct: 100 }), 1000);
    expect(plate).not.toBeNull();
    if (!plate) return;
    expect(plate.padding).toBeLessThanOrEqual(plate.size / 2);
  });
});

describe('built-in presets', () => {
  it('are all internally consistent designs', () => {
    for (const preset of BUILT_IN_PRESETS) {
      expect(preset.id).toBeTruthy();
      expect(preset.name).toBeTruthy();
      expect(preset.design.errorCorrection).toMatch(/^[LMQH]$/);
      expect(preset.design.logoSizePct).toBeLessThanOrEqual(100);
    }
  });

  it('do not ship a preset with unreadable contrast', () => {
    for (const preset of BUILT_IN_PRESETS) {
      const ratio = contrastRatio(preset.design);
      expect(ratio, `preset ${preset.id}`).not.toBeNull();
      expect(ratio as number, `preset ${preset.id}`).toBeGreaterThanOrEqual(3);
    }
  });
});
