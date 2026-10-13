/**
 * Font Studio / Text Forge — style catalog.
 *
 * Every definition performs a real transformation into Unicode characters
 * defined by the Unicode Standard, so the preview is exactly what a copy
 * would produce anywhere — Discord nicknames included (they only accept
 * Unicode characters, never font files).
 *
 * "Font-preview" styles additionally carry a bundled/webfont family. That
 * visual look cannot survive a copy as text, so those cards keep the
 * Image/PNG export (render in the real font) while Copy gives real
 * Unicode text.
 */

import type { FontStyleCategory, FontStyleCategoryId, FontStyleDefinition } from './fontStyleTypes';
import { addCombiningMark, applyMapping, insertLetterSpacing, insertSeparator } from './fontStyleEngine';
import {
  CIRCLED,
  FULLWIDTH,
  MATH_BOLD,
  MATH_BOLD_ITALIC,
  MATH_BOLD_SCRIPT,
  MATH_DOUBLE_STRUCK,
  MATH_FRAKTUR,
  MATH_FRAKTUR_BOLD,
  MATH_ITALIC,
  MATH_MONOSPACE,
  MATH_SANS,
  MATH_SANS_BOLD,
  MATH_SANS_ITALIC,
  MATH_SCRIPT,
  SMALL_CAPITALS,
  SUPERSCRIPT,
} from './unicodeAlphabets';
import { UNICODE_STYLES, type UnicodeStyleId } from './unicodeStyleEngine';

export const FONT_STYLE_CATEGORIES: FontStyleCategory[] = [
  { id: 'scifi', name: 'Sci-Fi & Futuristic', description: 'Clean mathematical display lettering' },
  { id: 'cyberpunk', name: 'Cyberpunk & Digital', description: 'Neon consoles, data streams, glitch' },
  { id: 'gothic', name: 'Gothic & Blackletter', description: 'Fraktur, manuscripts, cathedrals' },
  { id: 'dark-fantasy', name: 'Dark Fantasy & Medieval', description: 'Runes, rings, old inscriptions' },
  { id: 'gaming', name: 'Gaming & Esports', description: 'Bold broadcast and arcade looks' },
  { id: 'space', name: 'Space & Technology', description: 'Starfarers and orbital typography' },
  { id: 'minimal', name: 'Minimalist & Spaced', description: 'Breathing room, quiet elegance' },
  { id: 'decorative', name: 'Decorative & Framed', description: 'Frames and ornaments' },
];

/**
 * The Unicode nickname styles offered by every card's style dropdown
 * (see unicodeStyleEngine.ts). Letters and digits the Unicode Standard
 * does not define for a style — script/fraktur/double-struck escapes,
 * lowercase enclosed forms — simply stay plain.
 */
export const NICKNAME_STYLES: readonly FontStyleDefinition[] = UNICODE_STYLES;
const NICKNAME_STYLE_BY_ID = new Map(NICKNAME_STYLES.map((s) => [s.id, s]));

/** CSS font stacks — every family is SIL OFL 1.1 licensed (see index.html). */
const FONT_ORBITRON = "'Orbitron', 'Rajdhani', sans-serif";
const FONT_AUDIOWIDE = "'Audiowide', 'Orbitron', sans-serif";
const FONT_UNIFRAKTUR = "'UnifrakturMaguntia', 'Cinzel', serif";
const FONT_PIRATA = "'Pirata One', 'UnifrakturMaguntia', serif";
const FONT_PRESS_START = "'Press Start 2P', monospace";
const FONT_CINZEL = "'Cinzel', serif";
const FONT_SHARE_TECH = "'Share Tech Mono', 'JetBrains Mono', monospace";

/**
 * Bundled display fonts (personal-use/demo licensed — see
 * src/assets/fonts/FONT-LICENSES.md). Copy and preview produce real
 * Unicode text via the given nickname style; the bundled family stays
 * available for the Image/PNG export, which keeps the visual look.
 */
const localFont = (
  id: string,
  name: string,
  category: FontStyleCategoryId,
  family: string,
  description: string,
  popularity: number,
  styleId: UnicodeStyleId
): FontStyleDefinition => {
  const style = NICKNAME_STYLE_BY_ID.get(styleId);
  if (!style) throw new Error(`unknown nickname style: ${styleId}`);
  return {
    id,
    name,
    category,
    description,
    popularity,
    outputKind: 'font-preview',
    fontFamily: `'${family}', sans-serif`,
    defaultStyleId: styleId,
    transform: style.transform,
  };
};

/** The 30 bundled families, grouped by category. Each entry names the
 *  closest Unicode nickname style to the font's look (change freely —
 *  the per-card dropdown exposes every style). */
const LOCAL_FONTS: FontStyleDefinition[] = [
  /* ── Sci-Fi & Futuristic (bundled) ── */
  // Wide interstellar display lettering → fullwidth width.
  localFont('sf-astron-valley', 'Astron Valley', 'scifi', 'Astron Valley', 'Wide interstellar display lettering for starship titles.', 92, 'fullwidth'),
  // Sleek cosmic sans → clean sans.
  localFont('sf-aetherin', 'Aetherin', 'scifi', 'Aetherin', 'Sleek cosmic sans with a satellite-dish calm.', 90, 'sans'),
  // Rugged armored tech display → heavy sans bold.
  localFont('sf-barkmo', 'Barkmo', 'scifi', 'Barkmo', 'Rugged tech display with armored edges.', 88, 'sans-bold'),
  // Cutting-edge data type for HUDs → monospace.
  localFont('sf-byte-sharp', 'Byte Sharp', 'scifi', 'Byte Sharp', 'Cutting-edge data type for HUDs and alerts.', 90, 'monospace'),
  // Geometric future signage → geometric sans.
  localFont('sf-chorus', 'Chorus', 'scifi', 'Chorus', 'Geometric chorus of clean future signage.', 86, 'sans'),
  // Liquid-chrome quantum branding → double-struck blackboard letters.
  localFont('sf-chrome-quantum', 'Chrome Quantum', 'scifi', 'Chrome Quantum', 'Liquid-chrome sci-fi for quantum-lab branding.', 89, 'double-struck'),
  // Fractured futuristic display → dynamic bold italic sans.
  localFont('sf-digital-divide', 'Digital Divide', 'scifi', 'Digital Divide', 'Fractured futuristic display with a hard edge.', 91, 'sans-bold-italic'),
  // Compact mission-control readout → monospace.
  localFont('sf-digitalize', 'Digitalize', 'scifi', 'Digitalize', 'Compact digital readout for mission control.', 87, 'monospace'),
  // Playful rounded orbit-era lettering → rounded sans bold.
  localFont('sf-djingo', 'Djingo', 'scifi', 'Djingo', 'Playful orbit-era lettering with a bounce.', 84, 'sans-bold'),
  // Drone-fleet stencil → blocky squared.
  localFont('sf-dronez', 'Dronez', 'scifi', 'Dronez', 'Drone-fleet stencil for tactical overlays.', 83, 'squared'),
  // Tech display with fogglass translucency → sans.
  localFont('sf-fogarde', 'Fogarde', 'scifi', 'Fogarde', 'Tech display with fogglass translucency.', 85, 'sans'),
  // Heavy mecha-movie weight → heavy sans bold.
  localFont('sf-megatrox', 'Megatrox', 'scifi', 'Megatrox', 'Heavy mecha-movie title weight.', 93, 'sans-bold'),
  // Modern futuristic force field → forceful bold italic sans.
  localFont('sf-nero-force', 'Nero Force', 'scifi', 'Nero Force', 'Modern futuristic force field lettering.', 89, 'sans-bold-italic'),
  // Off-world schema language → monospace.
  localFont('sf-ofform', 'Ofform', 'scifi', 'Ofform', 'Off-world form language for schemas.', 82, 'monospace'),
  // Retro space-age futurism → wide fullwidth.
  localFont('sf-ptg-futurizm', 'PTG Futurizm', 'scifi', 'PTG Futurizm', 'Retro-futurism straight from the space age.', 88, 'fullwidth'),
  // Radiating party-tech display → circled rings.
  localFont('sf-radiant-pafista', 'Radiant Pafista', 'scifi', 'Radiant Pafista', 'Radiating party-tech display type.', 86, 'circled'),
  // Cargo-container tech → solid negative squared blocks.
  localFont('sf-seabox', 'Seabox', 'scifi', 'Seabox', 'Cargo-container tech for shipping lanes.', 81, 'negative-squared'),
  // Lightweight signal flares → light sans italic.
  localFont('sf-siegra', 'Siegra', 'scifi', 'Siegra', 'Lightweight signal-flare lettering.', 84, 'sans-italic'),
  // Broken-orbit display → bold italic sans.
  localFont('sf-space-broke', 'Space Broke', 'scifi', 'Space Broke', 'Broken-orbit modern futuristic display.', 90, 'sans-bold-italic'),
  // Sonic-slab lettering → slab serif weight.
  localFont('sf-transonite', 'Transonite', 'scifi', 'Transonite', 'Transparent sonic-slab lettering.', 85, 'bold-serif'),
  // Universal galaxy-map signage → clean sans.
  localFont('sf-universa', 'Universa', 'scifi', 'Universa', 'Universal sci-fi signage for galaxy maps.', 91, 'sans'),
  // Wild deep-space transmission glyphs → monospace telemetry.
  localFont('sf-wildtras', 'Wildtras', 'scifi', 'Wildtras', 'Wild transmission glyphs from deep space.', 83, 'monospace'),
  // Rounded rover console lettering → rounded sans bold.
  localFont('sf-womes', 'Womes', 'scifi', 'Womes', 'Rounded rover console lettering.', 82, 'sans-bold'),
  // Movie-game title weight → serif title weight.
  localFont('sf-zephyrus', 'Zephyrus', 'scifi', 'Zephyrus', 'West-wind tech for movie-game titles.', 87, 'bold-serif'),

  /* ── Gothic & Blackletter (bundled) ── */
  // Sci-fi blackletter crossover → fraktur.
  localFont('go-xylver', 'Xylver Blackletter', 'gothic', 'Xylver', 'Sci-fi blackletter crossover — cathedral meets starship.', 94, 'fraktur'),
  // Heavy regal medieval crown → bold fraktur.
  localFont('go-the-king', 'The King', 'gothic', 'The King', 'Regal medieval crown of heavy display type.', 89, 'bold-fraktur'),
  // Saint Glass inscription with solemn curves → script.
  localFont('go-saint-carell', 'Saint Carell', 'gothic', 'Saint Carell', 'Saint Glass inscription with solemn curves.', 87, 'script'),
  // Kinetic serif marching across the page → italic serif weight.
  localFont('go-movement', 'Movement', 'gothic', 'Movement', 'Kinetic serif that marches across the page.', 84, 'bold-italic-serif'),
  // Classic scholarly blackletter → fraktur.
  localFont('go-newton-howard', 'Newton Howard', 'gothic', 'Newton Howard', 'Classic scholarly blackletter for treatises.', 86, 'fraktur'),
  // Spiked metal blackletter → bold fraktur.
  localFont('go-gorez', 'Gorez Metal', 'gothic', 'Gorez', 'Spiked metal blackletter for album and game art.', 88, 'bold-fraktur'),
];

/** Frame text with flanking ornaments; empty/whitespace text stays empty. */
const framed =
  (left: string, right: string, inner: (t: string) => string = (t) => t) =>
  (t: string): string =>
    t.trim() ? `${left} ${inner(t)} ${right}` : '';

export const FONT_STYLES: FontStyleDefinition[] = [
  ...LOCAL_FONTS,
  /* ── Sci-Fi & Futuristic ─────────────────────────────────────────────── */
  {
    id: 'sci-bold',
    name: 'Quantum Bold',
    category: 'scifi',
    description: 'Mathematical bold serif — heavy sci-fi console lettering.',
    popularity: 100,
    outputKind: 'unicode',
    defaultStyleId: 'bold-serif',
    transform: (t) => applyMapping(t, MATH_BOLD),
  },
  {
    id: 'sci-italic',
    name: 'Vector Italic',
    category: 'scifi',
    description: 'Mathematical italic with true vector curves (ℎ keeps its Planck form).',
    popularity: 95,
    outputKind: 'unicode',
    defaultStyleId: 'italic-serif',
    transform: (t) => applyMapping(t, MATH_ITALIC),
  },
  {
    id: 'sci-script',
    name: 'Astra Script',
    category: 'scifi',
    description: 'Flowing mathematical script — premium starship branding.',
    popularity: 90,
    outputKind: 'unicode',
    defaultStyleId: 'script',
    transform: (t) => applyMapping(t, MATH_SCRIPT),
  },
  {
    id: 'sci-fullwidth',
    name: 'Wideband',
    category: 'scifi',
    description: 'Fullwidth latin — wide, retro-futuristic vapourwave text.',
    popularity: 85,
    outputKind: 'unicode',
    defaultStyleId: 'fullwidth',
    transform: (t) => applyMapping(t, FULLWIDTH),
  },
  {
    id: 'sci-orbitron',
    name: 'Orbit Display',
    category: 'scifi',
    description: 'Orbitron display face — copy as bold sans Unicode; Image/PNG keep the font.',
    popularity: 88,
    outputKind: 'font-preview',
    fontFamily: FONT_ORBITRON,
    defaultStyleId: 'sans-bold',
    transform: (t) => applyMapping(t, MATH_SANS_BOLD),
  },

  /* ── Cyberpunk & Digital ─────────────────────────────────────────────── */
  {
    id: 'cp-sans',
    name: 'Neon Sans',
    category: 'cyberpunk',
    description: 'Geometric sans-serif numerals of the night city.',
    popularity: 92,
    outputKind: 'unicode',
    defaultStyleId: 'sans',
    transform: (t) => applyMapping(t, MATH_SANS),
  },
  {
    id: 'cp-mono',
    name: 'Data Mono',
    category: 'cyberpunk',
    description: 'Monospace machine code — terminal feeds and tooltips.',
    popularity: 90,
    outputKind: 'unicode',
    defaultStyleId: 'monospace',
    transform: (t) => applyMapping(t, MATH_MONOSPACE),
  },
  {
    id: 'cp-double',
    name: 'Circuit Double',
    category: 'cyberpunk',
    description: 'Double-struck blackboard letters (ℂ ℍ ℕ ℙ ℚ ℝ ℤ stay canonical).',
    popularity: 88,
    outputKind: 'unicode',
    defaultStyleId: 'double-struck',
    transform: (t) => applyMapping(t, MATH_DOUBLE_STRUCK),
  },
  {
    id: 'cp-glitch',
    name: 'Strike Glitch',
    category: 'cyberpunk',
    description: 'Each letter struck through with a glitch overlay mark.',
    popularity: 86,
    outputKind: 'unicode',
    transform: (t) => addCombiningMark(t, '\u0336'),
  },
  {
    id: 'cp-audiowide',
    name: 'Cyber Deck',
    category: 'cyberpunk',
    description: 'Audiowide wide display face — copy as fullwidth Unicode; Image/PNG keep the font.',
    popularity: 87,
    outputKind: 'font-preview',
    fontFamily: FONT_AUDIOWIDE,
    defaultStyleId: 'fullwidth',
    transform: (t) => applyMapping(t, FULLWIDTH),
  },
  {
    id: 'cp-terminal',
    name: 'Terminal Glow',
    category: 'cyberpunk',
    description: 'Share Tech Mono readout face — copy as monospace Unicode; Image/PNG keep the font.',
    popularity: 84,
    outputKind: 'font-preview',
    fontFamily: FONT_SHARE_TECH,
    defaultStyleId: 'monospace',
    transform: (t) => applyMapping(t, MATH_MONOSPACE),
  },

  /* ── Gothic & Blackletter ────────────────────────────────────────────── */
  {
    id: 'go-fraktur',
    name: 'Blackletter',
    category: 'gothic',
    description: 'True Fraktur blackletter (ℭ ℌ ℑ ℜ ℨ keep their canonical forms).',
    popularity: 96,
    outputKind: 'unicode',
    defaultStyleId: 'fraktur',
    transform: (t) => applyMapping(t, MATH_FRAKTUR),
  },
  {
    id: 'go-fraktur-bold',
    name: 'Heavy Blackletter',
    category: 'gothic',
    description: 'Bold Fraktur — cathedral inscriptions and album covers.',
    popularity: 94,
    outputKind: 'unicode',
    defaultStyleId: 'bold-fraktur',
    transform: (t) => applyMapping(t, MATH_FRAKTUR_BOLD),
  },
  {
    id: 'go-boldscript',
    name: 'Gothic Flourish',
    category: 'gothic',
    description: 'Bold calligraphic script with medieval flourish.',
    popularity: 84,
    outputKind: 'unicode',
    defaultStyleId: 'bold-script',
    transform: (t) => applyMapping(t, MATH_BOLD_SCRIPT),
  },
  {
    id: 'go-obsidian',
    name: 'Obsidian Fraktur',
    category: 'gothic',
    description: 'Fraktur set inside a Maltese-cross shrine — gothic combination.',
    popularity: 83,
    outputKind: 'unicode',
    defaultStyleId: 'fraktur',
    transform: framed('\u2720', '\u2720', (t) => applyMapping(t, MATH_FRAKTUR)),
  },
  {
    id: 'go-unifraktur',
    name: 'Fraktur Display',
    category: 'gothic',
    description: 'UnifrakturMaguntia blackletter face — copy as Fraktur Unicode; Image/PNG keep the font.',
    popularity: 93,
    outputKind: 'font-preview',
    fontFamily: FONT_UNIFRAKTUR,
    defaultStyleId: 'fraktur',
    transform: (t) => applyMapping(t, MATH_FRAKTUR),
  },

  /* ── Dark Fantasy & Medieval ─────────────────────────────────────────── */
  {
    id: 'df-smallcaps',
    name: 'Small Capitals',
    category: 'dark-fantasy',
    description: 'Small-capital letters where Unicode provides them; others stay plain.',
    popularity: 80,
    outputKind: 'unicode',
    defaultStyleId: 'small-caps',
    transform: (t) => applyMapping(t, SMALL_CAPITALS),
  },
  {
    id: 'df-circled',
    name: 'Enchanted Ring',
    category: 'dark-fantasy',
    description: 'Circled letters — sealed sigils and spell components.',
    popularity: 78,
    outputKind: 'unicode',
    defaultStyleId: 'circled',
    transform: (t) => applyMapping(t, CIRCLED),
  },
  {
    id: 'df-super',
    name: 'Rising Superscript',
    category: 'dark-fantasy',
    description: 'Superscript letters where Unicode defines them (q and capitals stay plain).',
    popularity: 70,
    outputKind: 'unicode',
    transform: (t) => applyMapping(t, SUPERSCRIPT),
  },
  {
    id: 'df-dagger',
    name: 'Dagger Frame',
    category: 'dark-fantasy',
    description: 'Bold italic script flanked by daggers — tombstone engraving.',
    popularity: 76,
    outputKind: 'unicode',
    defaultStyleId: 'bold-italic-serif',
    transform: framed('\u2020', '\u2020', (t) => applyMapping(t, MATH_BOLD_ITALIC)),
  },
  {
    id: 'df-cinzel',
    name: 'Cinzel Inscription',
    category: 'dark-fantasy',
    description: 'Cinzel Roman capitals face — copy as small-caps Unicode; Image/PNG keep the font.',
    popularity: 82,
    outputKind: 'font-preview',
    fontFamily: FONT_CINZEL,
    defaultStyleId: 'small-caps',
    transform: (t) => applyMapping(t, SMALL_CAPITALS),
  },
  {
    id: 'df-pirata',
    name: 'Pirata Display',
    category: 'dark-fantasy',
    description: 'Pirata One blackletter face — copy as bold Fraktur Unicode; Image/PNG keep the font.',
    popularity: 81,
    outputKind: 'font-preview',
    fontFamily: FONT_PIRATA,
    defaultStyleId: 'bold-fraktur',
    transform: (t) => applyMapping(t, MATH_FRAKTUR_BOLD),
  },

  /* ── Gaming & Esports ────────────────────────────────────────────────── */
  {
    id: 'gm-sansbold',
    name: 'Esports Bold',
    category: 'gaming',
    description: 'Heavy sans-serif broadcast lettering with matching digits.',
    popularity: 89,
    outputKind: 'unicode',
    defaultStyleId: 'sans-bold',
    transform: (t) => applyMapping(t, MATH_SANS_BOLD),
  },
  {
    id: 'gm-power',
    name: 'Power Frame',
    category: 'gaming',
    description: 'Esports bold inside a HUD bracket — gamer tag ready.',
    popularity: 83,
    outputKind: 'unicode',
    defaultStyleId: 'sans-bold',
    transform: framed('\u2591\u2591', '\u2591\u2591', (t) => applyMapping(t, MATH_SANS_BOLD)),
  },
  {
    id: 'gm-pixel',
    name: 'Pixel Forge',
    category: 'gaming',
    description: 'Press Start 2P arcade face — copy as monospace Unicode; Image/PNG keep the font.',
    popularity: 85,
    outputKind: 'font-preview',
    fontFamily: FONT_PRESS_START,
    defaultStyleId: 'monospace',
    transform: (t) => applyMapping(t, MATH_MONOSPACE),
  },

  /* ── Space & Technology ──────────────────────────────────────────────── */
  {
    id: 'sp-sansitalic',
    name: 'Zero Gravity',
    category: 'space',
    description: 'Weightless sans-italic for mission patches and star charts.',
    popularity: 76,
    outputKind: 'unicode',
    defaultStyleId: 'sans-italic',
    transform: (t) => applyMapping(t, MATH_SANS_ITALIC),
  },
  {
    id: 'sp-star',
    name: 'Star Field',
    category: 'space',
    description: 'Monospace telemetry ringed by four-point stars.',
    popularity: 74,
    outputKind: 'unicode',
    defaultStyleId: 'monospace',
    transform: framed('\u2727', '\u2727', (t) => applyMapping(t, MATH_MONOSPACE)),
  },
  {
    id: 'sp-orbit',
    name: 'Orbit Frame',
    category: 'space',
    description: 'Orbital sans text between comets — satellite insignia.',
    popularity: 72,
    outputKind: 'unicode',
    defaultStyleId: 'sans',
    transform: framed('\u2604', '\u2604', (t) => applyMapping(t, MATH_SANS)),
  },

  /* ── Minimalist & Spaced ─────────────────────────────────────────────── */
  {
    id: 'mn-spaced',
    name: 'Spaced Out',
    category: 'minimal',
    description: 'Single-spaced lettering — clean editorial look.',
    popularity: 77,
    outputKind: 'unicode',
    transform: (t) => insertLetterSpacing(t, 1),
  },
  {
    id: 'mn-dotted',
    name: 'Dotted Line',
    category: 'minimal',
    description: 'Middle-dot separators for understated, airy captions.',
    popularity: 75,
    outputKind: 'unicode',
    transform: (t) => insertSeparator(t, '\u00b7'),
  },
  {
    id: 'mn-quiet',
    name: 'Quiet Frame',
    category: 'minimal',
    description: 'Plain text inside hairline rules — gallery label style.',
    popularity: 73,
    outputKind: 'unicode',
    transform: (t) => (t.trim() ? `\u2014 ${t} \u2014` : ''),
  },

  /* ── Decorative & Framed ─────────────────────────────────────────────── */
  {
    id: 'dc-fancy',
    name: 'Fancy Brackets',
    category: 'decorative',
    description: 'Tortoise-shell brackets — quote banners and shoutouts.',
    popularity: 79,
    outputKind: 'unicode',
    transform: (t) => (t.trim() ? `\u3010${t}\u3011` : ''),
  },
  {
    id: 'dc-neon',
    name: 'Neon Cage',
    category: 'decorative',
    description: 'Bold letters locked in a glowing double-bar cage.',
    popularity: 82,
    outputKind: 'unicode',
    defaultStyleId: 'bold-serif',
    transform: framed('\u2551', '\u2551', (t) => applyMapping(t, MATH_BOLD)),
  },
  {
    id: 'dc-wave',
    name: 'Wave Line',
    category: 'decorative',
    description: 'Sans-serif text drifting between wave dashes.',
    popularity: 71,
    outputKind: 'unicode',
    defaultStyleId: 'sans',
    transform: framed('\uff5e\uff5e', '\uff5e\uff5e', (t) => applyMapping(t, MATH_SANS)),
  },
];
