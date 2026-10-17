/**
 * Verifies that a designed QR code can actually be decoded.
 *
 * Styling is the main way a QR code silently breaks: dot styles with gaps,
 * logos that cover too many modules and low contrast all produce something
 * that looks correct on screen but fails on a phone. Rather than trust the
 * safety rules, this renders the real composition and runs a decoder over the
 * pixels — the same check a scanner performs.
 *
 * Uses the QR-only composition (no frame or caption) because those sit outside
 * the symbol and cannot affect decoding.
 */

import jsQR from 'jsqr';
import { composeCanvas } from './qrExporter';
import type { QrDesign } from './qrDesign';

export interface ScanResult {
  /** A code was found in the rendered image. */
  decoded: boolean;
  /** The decoded text matched the intended payload exactly. */
  matches: boolean;
  /** Text the decoder read, when it found anything. */
  text?: string;
  /** Why verification failed, suitable for showing to the user. */
  reason?: string;
}

/** Verification render size — large enough to decode, cheap enough to run live. */
const VERIFY_SIZE = 512;

/** Long payloads produce dense modules that survive print worse than on screen. */
const DENSE_PAYLOAD_CHARS = 300;

/**
 * Renders `design` at a fixed size and attempts to decode it.
 *
 * Never throws: a failure to render is reported as a failed scan so the UI can
 * stay in its normal state.
 */
export async function verifyScannable(payload: string, design: QrDesign): Promise<ScanResult> {
  if (!payload) {
    return { decoded: false, matches: false, reason: 'Nothing to encode yet.' };
  }

  try {
    // Scale the code down for verification while keeping the design's own
    // proportions — a logo that is too large fails at any size.
    const verifyDesign: QrDesign = { ...design, size: VERIFY_SIZE };
    const canvas = await composeCanvas(payload, verifyDesign);

    const ctx = canvas.getContext('2d');
    if (!ctx) return { decoded: false, matches: false, reason: 'Canvas 2D is not available.' };

    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const result = jsQR(image.data, image.width, image.height, {
      inversionAttempts: 'attemptBoth',
    });

    if (!result || !result.data) {
      return {
        decoded: false,
        matches: false,
        reason: 'The code could not be read. Try a larger logo margin, higher contrast, or a simpler dot style.',
      };
    }

    if (result.data !== payload) {
      return {
        decoded: true,
        matches: false,
        text: result.data,
        reason: 'The decoder read different content than expected — the code may be damaged.',
      };
    }

    return { decoded: true, matches: true, text: result.data };
  } catch (err) {
    return {
      decoded: false,
      matches: false,
      reason: err instanceof Error ? err.message : 'Verification failed.',
    };
  }
}

/** True when the payload is long enough that scanning gets less reliable. */
export function isDensePayload(payload: string): boolean {
  return payload.length > DENSE_PAYLOAD_CHARS;
}
