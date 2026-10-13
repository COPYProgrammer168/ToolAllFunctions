/**
 * Font Studio / Text Forge — style catalog.
 *
 * Every definition performs a real transformation. "Font preview" styles are
 * explicitly non-copyable: the output is plain text shown in a styled web
 * font (SIL OFL-licensed, loaded in index.html), so users always know that
 * copying the text does not carry the visual font — for that they export a
 * transparent PNG instead.
 */

import type { FontStyleCategory, FontStyleDefinition } from './fontStyleTypes';
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

/** CSS font stacks — every family is SIL OFL 1.1 licensed (see index.html). */
const FONT_ORBITRON = "'Orbitron', 'Rajdhani', sans-serif";
const FONT_AUDIOWIDE = "'Audiowide', 'Orbitron', sans-serif";
const FONT_UNIFRAKTUR = "'UnifrakturMaguntia', 'Cinzel', serif";
const FONT_PIRATA = "'Pirata One', 'UnifrakturMaguntia', serif";
const FONT_PRESS_START = "'Press Start 2P', monospace";
const FONT_CINZEL = "'Cinzel', serif";
const FONT_SHARE_TECH = "'Share Tech Mono', 'JetBrains Mono', monospace";

/** Frame text with flanking ornaments; empty/whitespace text stays empty. */
const framed =
  (left: string, right: string, inner: (t: string) => string = (t) => t) =>
  (t: string): string =>
    t.trim() ? `${left} ${inner(t)} ${right}` : '';

export const FONT_STYLES: FontStyleDefinition[] = [
  /* ── Sci-Fi & Futuristic ─────────────────────────────────────────────── */
  {
    id: 'sci-bold',
    name: 'Quantum Bold',
    category: 'scifi',
    description: 'Mathematical bold serif — heavy sci-fi console lettering.',
    popularity: 100,
    outputKind: 'unicode',
    transform: (t) => applyMapping(t, MATH_BOLD),
  },
  {
    id: 'sci-italic',
    name: 'Vector Italic',
    category: 'scifi',
    description: 'Mathematical italic with true vector curves (ℎ keeps its Planck form).',
    popularity: 95,
    outputKind: 'unicode',
    transform: (t) => applyMapping(t, MATH_ITALIC),
  },
  {
    id: 'sci-script',
    name: 'Astra Script',
    category: 'scifi',
    description: 'Flowing mathematical script — premium starship branding.',
    popularity: 90,
    outputKind: 'unicode',
    transform: (t) => applyMapping(t, MATH_SCRIPT),
  },
  {
    id: 'sci-fullwidth',
    name: 'Wideband',
    category: 'scifi',
    description: 'Fullwidth latin — wide, retro-futuristic vapourwave text.',
    popularity: 85,
    outputKind: 'unicode',
    transform: (t) => applyMapping(t, FULLWIDTH),
  },
  {
    id: 'sci-orbitron',
    name: 'Orbit Display',
    category: 'scifi',
    description: 'Orbitron display face (real font preview — export PNG to keep the look).',
    popularity: 88,
    outputKind: 'font-preview',
    fontFamily: FONT_ORBITRON,
    transform: (t) => t,
  },

  /* ── Cyberpunk & Digital ─────────────────────────────────────────────── */
  {
    id: 'cp-sans',
    name: 'Neon Sans',
    category: 'cyberpunk',
    description: 'Geometric sans-serif numerals of the night city.',
    popularity: 92,
    outputKind: 'unicode',
    transform: (t) => applyMapping(t, MATH_SANS),
  },
  {
    id: 'cp-mono',
    name: 'Data Mono',
    category: 'cyberpunk',
    description: 'Monospace machine code — terminal feeds and tooltips.',
    popularity: 90,
    outputKind: 'unicode',
    transform: (t) => applyMapping(t, MATH_MONOSPACE),
  },
  {
    id: 'cp-double',
    name: 'Circuit Double',
    category: 'cyberpunk',
    description: 'Double-struck blackboard letters (ℂ ℍ ℕ ℙ ℚ ℝ ℤ stay canonical).',
    popularity: 88,
    outputKind: 'unicode',
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
    description: 'Audiowide display face (font preview — PNG export keeps the font).',
    popularity: 87,
    outputKind: 'font-preview',
    fontFamily: FONT_AUDIOWIDE,
    transform: (t) => t,
  },
  {
    id: 'cp-terminal',
    name: 'Terminal Glow',
    category: 'cyberpunk',
    description: 'Share Tech Mono readout face (font preview — PNG export keeps the font).',
    popularity: 84,
    outputKind: 'font-preview',
    fontFamily: FONT_SHARE_TECH,
    transform: (t) => t,
  },

  /* ── Gothic & Blackletter ────────────────────────────────────────────── */
  {
    id: 'go-fraktur',
    name: 'Blackletter',
    category: 'gothic',
    description: 'True Fraktur blackletter (ℭ ℌ ℑ ℜ ℨ keep their canonical forms).',
    popularity: 96,
    outputKind: 'unicode',
    transform: (t) => applyMapping(t, MATH_FRAKTUR),
  },
  {
    id: 'go-fraktur-bold',
    name: 'Heavy Blackletter',
    category: 'gothic',
    description: 'Bold Fraktur — cathedral inscriptions and album covers.',
    popularity: 94,
    outputKind: 'unicode',
    transform: (t) => applyMapping(t, MATH_FRAKTUR_BOLD),
  },
  {
    id: 'go-boldscript',
    name: 'Gothic Flourish',
    category: 'gothic',
    description: 'Bold calligraphic script with medieval flourish.',
    popularity: 84,
    outputKind: 'unicode',
    transform: (t) => applyMapping(t, MATH_BOLD_SCRIPT),
  },
  {
    id: 'go-obsidian',
    name: 'Obsidian Fraktur',
    category: 'gothic',
    description: 'Fraktur set inside a Maltese-cross shrine — gothic combination.',
    popularity: 83,
    outputKind: 'unicode',
    transform: framed('\u2720', '\u2720', (t) => applyMapping(t, MATH_FRAKTUR)),
  },
  {
    id: 'go-unifraktur',
    name: 'Fraktur Display',
    category: 'gothic',
    description: 'UnifrakturMaguntia blackletter font preview (PNG export keeps the font).',
    popularity: 93,
    outputKind: 'font-preview',
    fontFamily: FONT_UNIFRAKTUR,
    transform: (t) => t,
  },

  /* ── Dark Fantasy & Medieval ─────────────────────────────────────────── */
  {
    id: 'df-smallcaps',
    name: 'Small Capitals',
    category: 'dark-fantasy',
    description: 'Small-capital letters where Unicode provides them; others stay plain.',
    popularity: 80,
    outputKind: 'unicode',
    transform: (t) => applyMapping(t, SMALL_CAPITALS),
  },
  {
    id: 'df-circled',
    name: 'Enchanted Ring',
    category: 'dark-fantasy',
    description: 'Circled letters — sealed sigils and spell components.',
    popularity: 78,
    outputKind: 'unicode',
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
    transform: framed('\u2020', '\u2020', (t) => applyMapping(t, MATH_BOLD_ITALIC)),
  },
  {
    id: 'df-cinzel',
    name: 'Cinzel Inscription',
    category: 'dark-fantasy',
    description: 'Cinzel Roman capitals font preview (PNG export keeps the font).',
    popularity: 82,
    outputKind: 'font-preview',
    fontFamily: FONT_CINZEL,
    transform: (t) => t,
  },
  {
    id: 'df-pirata',
    name: 'Pirata Display',
    category: 'dark-fantasy',
    description: 'Pirata One blackletter font preview (PNG export keeps the font).',
    popularity: 81,
    outputKind: 'font-preview',
    fontFamily: FONT_PIRATA,
    transform: (t) => t,
  },

  /* ── Gaming & Esports ────────────────────────────────────────────────── */
  {
    id: 'gm-sansbold',
    name: 'Esports Bold',
    category: 'gaming',
    description: 'Heavy sans-serif broadcast lettering with matching digits.',
    popularity: 89,
    outputKind: 'unicode',
    transform: (t) => applyMapping(t, MATH_SANS_BOLD),
  },
  {
    id: 'gm-power',
    name: 'Power Frame',
    category: 'gaming',
    description: 'Esports bold inside a HUD bracket — gamer tag ready.',
    popularity: 83,
    outputKind: 'unicode',
    transform: framed('\u2591\u2591', '\u2591\u2591', (t) => applyMapping(t, MATH_SANS_BOLD)),
  },
  {
    id: 'gm-pixel',
    name: 'Pixel Forge',
    category: 'gaming',
    description: 'Press Start 2P arcade font preview (PNG export keeps the font).',
    popularity: 85,
    outputKind: 'font-preview',
    fontFamily: FONT_PRESS_START,
    transform: (t) => t,
  },

  /* ── Space & Technology ──────────────────────────────────────────────── */
  {
    id: 'sp-sansitalic',
    name: 'Zero Gravity',
    category: 'space',
    description: 'Weightless sans-italic for mission patches and star charts.',
    popularity: 76,
    outputKind: 'unicode',
    transform: (t) => applyMapping(t, MATH_SANS_ITALIC),
  },
  {
    id: 'sp-star',
    name: 'Star Field',
    category: 'space',
    description: 'Monospace telemetry ringed by four-point stars.',
    popularity: 74,
    outputKind: 'unicode',
    transform: framed('\u2727', '\u2727', (t) => applyMapping(t, MATH_MONOSPACE)),
  },
  {
    id: 'sp-orbit',
    name: 'Orbit Frame',
    category: 'space',
    description: 'Orbital sans text between comets — satellite insignia.',
    popularity: 72,
    outputKind: 'unicode',
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
    transform: framed('\u2551', '\u2551', (t) => applyMapping(t, MATH_BOLD)),
  },
  {
    id: 'dc-wave',
    name: 'Wave Line',
    category: 'decorative',
    description: 'Sans-serif text drifting between wave dashes.',
    popularity: 71,
    outputKind: 'unicode',
    transform: framed('\uff5e\uff5e', '\uff5e\uff5e', (t) => applyMapping(t, MATH_SANS)),
  },
];
