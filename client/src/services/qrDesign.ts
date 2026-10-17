/**
 * The QR design model: every knob the designer exposes, plus the safety rules
 * that keep a styled code scannable.
 *
 * A QR scanner only needs enough module contrast to lock on. Over-styling is
 * the usual way a code "looks great" and then fails on a phone, so this module
 * owns the limits (logo coverage, contrast) rather than leaving each call site
 * to guess. Imported by the preview, the exporters and the view so all three
 * agree on what a valid design is.
 */

export type ErrorCorrection = 'L' | 'M' | 'Q' | 'H';

export type DotStyle =
  | 'square'
  | 'dots'
  | 'rounded'
  | 'classy'
  | 'classy-rounded'
  | 'extra-rounded';

export type CornerSquareStyle = 'square' | 'dot' | 'extra-rounded';
export type CornerDotStyle = 'square' | 'dot';

export interface GradientStop {
  offset: number;
  color: string;
}

export interface QrGradient {
  type: 'linear' | 'radial';
  /** Degrees; ignored for radial gradients. */
  rotation: number;
  stops: GradientStop[];
}

export interface QrDesign {
  /** Foreground colour used when the gradient is off. */
  fgColor: string;
  fgGradientEnabled: boolean;
  fgGradient: QrGradient;
  /** Background colour used when the gradient is off. */
  bgColor: string;
  bgGradientEnabled: boolean;
  bgGradient: QrGradient;
  dotStyle: DotStyle;
  cornerSquareStyle: CornerSquareStyle;
  cornerDotStyle: CornerDotStyle;
  errorCorrection: ErrorCorrection;
  /** Quiet zone in modules — 4 is the spec minimum. */
  margin: number;
  /** Rendered size in pixels for exported raster output. */
  size: number;
  /** Data URL of the centre logo, or null when no logo is set. */
  logoDataUrl: string | null;
  /** Logo width as a percentage of the code width. */
  logoSizePct: number;
  /** Padding around the logo inside its backing plate, as a percentage of the logo. */
  logoPaddingPct: number;
  /** Corner radius of the backing plate, as a percentage (0 square, 50 circular). */
  logoRadiusPct: number;
  /** Clear the modules behind the logo so it stays legible. */
  logoHideDots: boolean;
  caption: string;
  /** Draw a bordered plate around the code with the caption beneath it. */
  frameEnabled: boolean;
}

/**
 * Largest share of the code width a logo may cover. Error correction can
 * recover roughly 30% of the symbol at level H, but that budget is partly
 * spent on the frame and any print damage, so we stop well short of it.
 */
export const MAX_SAFE_LOGO_PCT = 25;

/** Default quiet zone, in modules, required by the QR specification. */
export const MIN_MARGIN_MODULES = 4;

export const DEFAULT_DESIGN: QrDesign = {
  fgColor: '#000000',
  fgGradientEnabled: false,
  fgGradient: {
    type: 'linear',
    rotation: 45,
    // Deliberately dark stops: a bright sky-blue gradient over a white
    // background drops under 3:1 contrast and stops scanning. See the
    // "built-in presets" contrast test.
    stops: [
      { offset: 0, color: '#0369a1' },
      { offset: 1, color: '#6d28d9' },
    ],
  },
  bgColor: '#ffffff',
  bgGradientEnabled: false,
  bgGradient: {
    type: 'linear',
    rotation: 45,
    stops: [
      { offset: 0, color: '#ffffff' },
      { offset: 1, color: '#e2e8f0' },
    ],
  },
  dotStyle: 'square',
  cornerSquareStyle: 'square',
  cornerDotStyle: 'square',
  errorCorrection: 'M',
  margin: MIN_MARGIN_MODULES,
  size: 1024,
  logoDataUrl: null,
  logoSizePct: 20,
  logoPaddingPct: 8,
  logoRadiusPct: 20,
  logoHideDots: true,
  caption: '',
  frameEnabled: false,
};

/** True when any foreground stops are light enough to risk low contrast. */
export function foregroundColors(design: QrDesign): string[] {
  return design.fgGradientEnabled ? design.fgGradient.stops.map((s) => s.color) : [design.fgColor];
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

/** Relative luminance per WCAG, used for the contrast warning. */
function luminance(hex: string): number | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Worst-case contrast ratio between any foreground stop and any background
 * stop. WCAG always divides the lighter luminance by the darker one, so the
 * pairing is ordered by luminance rather than by which colour is the
 * foreground — with a gradient the pair that matters is whichever two ends up
 * closest together, regardless of role.
 */
export function contrastRatio(design: QrDesign): number | null {
  const fgLums = foregroundColors(design)
    .map(luminance)
    .filter((l): l is number => l !== null);
  const bgColors = design.bgGradientEnabled
    ? design.bgGradient.stops.map((s) => s.color)
    : [design.bgColor];
  const bgLums = bgColors.map(luminance).filter((l): l is number => l !== null);
  if (fgLums.length === 0 || bgLums.length === 0) return null;

  let worst = Number.POSITIVE_INFINITY;
  for (const fg of fgLums) {
    for (const bg of bgLums) {
      const ratio = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
      if (ratio < worst) worst = ratio;
    }
  }
  return worst;
}

export interface DesignIssue {
  level: 'error' | 'warn';
  message: string;
}

/**
 * Checks a design against the rules that decide whether a phone can read it.
 * `errors` mean the code will likely not scan; `warnings` mean it is at risk.
 */
export function validateDesign(design: QrDesign): DesignIssue[] {
  const issues: DesignIssue[] = [];

  if (design.margin < MIN_MARGIN_MODULES) {
    issues.push({
      level: 'warn',
      message: `The quiet zone is under ${MIN_MARGIN_MODULES} modules, so some scanners may struggle to find the code.`,
    });
  }

  const ratio = contrastRatio(design);
  if (ratio !== null && ratio < 3) {
    issues.push({
      level: 'error',
      message: 'Low contrast between the code and its background. Use darker foreground or lighter background colours.',
    });
  } else if (ratio !== null && ratio < 4.5) {
    issues.push({
      level: 'warn',
      message: 'Contrast is below the recommended level — the code may not scan in poor lighting.',
    });
  }

  if (design.logoDataUrl && design.logoSizePct > MAX_SAFE_LOGO_PCT) {
    issues.push({
      level: 'warn',
      message: `The logo covers ${design.logoSizePct}% of the code. Above ${MAX_SAFE_LOGO_PCT}% scanning gets unreliable.`,
    });
  }

  if (
    design.logoDataUrl &&
    design.logoSizePct > MAX_SAFE_LOGO_PCT &&
    design.errorCorrection !== 'H'
  ) {
    issues.push({
      level: 'error',
      message: 'With a large logo the error correction level must be H (30%).',
    });
  }

  return issues;
}

/**
 * Error correction to actually encode with. A logo is treated as damage, so we
 * raise the level to H whenever one is present, regardless of the picker.
 */
export function effectiveErrorCorrection(design: QrDesign): ErrorCorrection {
  if (design.logoDataUrl && (design.errorCorrection === 'L' || design.errorCorrection === 'M')) {
    return 'H';
  }
  return design.errorCorrection;
}

/** Geometry of the drawn logo plate, shared by the canvas and SVG renderers. */
export interface LogoPlate {
  x: number;
  y: number;
  size: number;
  radius: number;
  padding: number;
}

/**
 * Computes the logo plate box in output pixels. The padding is inset so the
 * plate never grows past the requested logo size, which is what the safety
 * limit is expressed against.
 */
export function computeLogoPlate(design: QrDesign, outputSize: number): LogoPlate | null {
  if (!design.logoDataUrl) return null;

  const plateSize = (outputSize * design.logoSizePct) / 100;
  // Padding is inset into the plate, so it is capped at a quarter per side —
  // at 50% the logo would have no room left and the plate would render as a
  // solid block with the logo clipped out of existence.
  const padding = Math.min(plateSize * (design.logoPaddingPct / 100), plateSize * 0.25);
  const radius = plateSize * (design.logoRadiusPct / 100);

  return {
    x: (outputSize - plateSize) / 2,
    y: (outputSize - plateSize) / 2,
    size: plateSize,
    radius,
    padding,
  };
}

/* ── Presets ─────────────────────────────────────────────────────────────── */

export interface DesignPreset {
  id: string;
  name: string;
  design: QrDesign;
}

/** Starter looks, so the designer is useful before the user saves anything. */
export const BUILT_IN_PRESETS: DesignPreset[] = [
  {
    id: 'classic',
    name: 'Classic',
    design: { ...DEFAULT_DESIGN },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    design: {
      ...DEFAULT_DESIGN,
      fgColor: '#ffffff',
      bgColor: '#0b1120',
      dotStyle: 'rounded',
      cornerSquareStyle: 'extra-rounded',
      cornerDotStyle: 'dot',
    },
  },
  {
    id: 'gradient-pop',
    name: 'Gradient Pop',
    design: {
      ...DEFAULT_DESIGN,
      fgGradientEnabled: true,
      dotStyle: 'extra-rounded',
      cornerSquareStyle: 'extra-rounded',
      cornerDotStyle: 'dot',
      errorCorrection: 'H',
    },
  },
  {
    id: 'sticker',
    name: 'Sticker',
    design: {
      ...DEFAULT_DESIGN,
      dotStyle: 'dots',
      cornerSquareStyle: 'dot',
      cornerDotStyle: 'dot',
      frameEnabled: true,
      caption: 'SCAN ME',
      errorCorrection: 'Q',
    },
  },
];

const PRESET_KEY = 'qr-studio:presets';
const LIBRARY_KEY = 'qr-studio:library';

function readStorage(): Storage | undefined {
  return typeof window !== 'undefined' ? window.localStorage : undefined;
}

function readJson<T>(key: string, fallback: T): T {
  const storage = readStorage();
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    // Corrupt or unavailable storage must never break the view.
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  const storage = readStorage();
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota or private mode — the feature still works without persistence */
  }
}

export function loadPresets(): DesignPreset[] {
  return readJson<DesignPreset[]>(PRESET_KEY, []);
}

export function savePreset(preset: DesignPreset): DesignPreset[] {
  // Saved presets replace a built-in of the same name instead of duplicating.
  const next = [...loadPresets().filter((p) => p.name !== preset.name), preset];
  writeJson(PRESET_KEY, next);
  return next;
}

export function deletePreset(id: string): DesignPreset[] {
  const next = loadPresets().filter((p) => p.id !== id);
  writeJson(PRESET_KEY, next);
  return next;
}

/* ── Saved library ───────────────────────────────────────────────────────── */

export interface SavedQr {
  id: string;
  title: string;
  type: string;
  /** The exact encoded content, so the code can be regenerated unchanged. */
  payload: string;
  design: QrDesign;
  createdAt: number;
  favorite: boolean;
}

export function loadLibrary(): SavedQr[] {
  return readJson<SavedQr[]>(LIBRARY_KEY, []);
}

export function saveToLibrary(entry: SavedQr): SavedQr[] {
  const next = [entry, ...loadLibrary().filter((e) => e.id !== entry.id)];
  writeJson(LIBRARY_KEY, next);
  return next;
}

export function removeFromLibrary(id: string): SavedQr[] {
  const next = loadLibrary().filter((e) => e.id !== id);
  writeJson(LIBRARY_KEY, next);
  return next;
}

export function toggleLibraryFavorite(id: string): SavedQr[] {
  const next = loadLibrary().map((e) => (e.id === id ? { ...e, favorite: !e.favorite } : e));
  writeJson(LIBRARY_KEY, next);
  return next;
}
