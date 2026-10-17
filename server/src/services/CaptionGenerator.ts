import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { YTDLP_UA, findYtDlpInvocation, tempCookieJar } from '../utils/ytDlp.js';
import { findCookiesFile } from '../utils/cookies.js';
import { fetchWithRetry } from '../utils/httpFetch.js';
import { RateLimitedError } from '../utils/errors.js';

const execFileAsync = promisify(execFile);

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** A single subtitle event. Times are seconds from the start of the video. */
export interface CaptionCue {
  start: number;
  end: number;
  text: string;
}

export interface CaptionGenerationResult {
  /** Which engine produced the cues. */
  source: 'youtube' | 'yt-dlp' | 'whisper';
  /** Human-readable engine detail, e.g. `Whisper (base model)`. */
  engineDetail: string;
  /** Language code reported by the engine, when known. */
  language: string;
  title?: string;
  durationSec?: number;
  cues: CaptionCue[];
  notices: string[];
}

export interface CaptionOptions {
  /** Preferred language code, e.g. `en`. Falls back to whatever exists. */
  language?: string;
  /** Whisper model for local transcription (default WHISPER_MODEL env or `base`). */
  model?: string;
}

export const WHISPER_MISSING_MESSAGE =
  'No local speech-to-text engine is available for this video. Install openai-whisper on the server ' +
  '(pip install openai-whisper — ffmpeg must be on PATH; optionally set WHISPER_PATH and WHISPER_MODEL), ' +
  'or paste the original YouTube link instead so the platform captions can be fetched without a local engine.';

/** How to invoke the optional `whisper` CLI (openai-whisper). */
interface WhisperInvocation {
  command: string;
  prefixArgs: string[];
}

/** Locate an optional whisper CLI. Mirrors the yt-dlp lookup strategy. */
function findWhisper(): string | null {
  const home = os.homedir();
  const candidates = [
    process.env.WHISPER_PATH,
    'whisper',
    'whisper.exe',
    path.join(home, '.local', 'bin', 'whisper'),
    path.join(home, 'AppData', 'Roaming', 'Python', 'Python314', 'Scripts', 'whisper.exe'),
    path.join(home, 'AppData', 'Roaming', 'Python', 'Python313', 'Scripts', 'whisper.exe'),
    path.join(home, 'AppData', 'Roaming', 'Python', 'Python312', 'Scripts', 'whisper.exe'),
    path.join(home, 'AppData', 'Roaming', 'Python', 'Python311', 'Scripts', 'whisper.exe'),
    path.join(home, 'AppData', 'Local', 'Programs', 'Python', 'Python313', 'Scripts', 'whisper.exe'),
    path.join(home, '.pyenv', 'shims', 'whisper'),
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    try {
      if (c === 'whisper' || c === 'whisper.exe') {
        const pathVar = process.env.PATH || '';
        const found = pathVar
          .split(path.delimiter)
          .filter(Boolean)
          .some((dir) => fs.existsSync(path.join(dir, c)));
        if (found) return c;
        continue;
      }
      if (fs.existsSync(c)) return c;
    } catch {}
  }
  return null;
}

async function findWhisperInvocation(): Promise<WhisperInvocation | null> {
  const binary = findWhisper();
  return binary ? { command: binary, prefixArgs: [] } : null;
}

/** Seconds (fractional) from h/m/s/ms parts. */
function toSeconds(h: string, m: string, s: string, frac: string): number {
  const fraction = Number(`0.${frac.padEnd(3, '0').slice(0, 3)}`);
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + fraction;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

/** Parse an SRT document into cues. */
export function parseSrt(raw: string): CaptionCue[] {
  const cues: CaptionCue[] = [];
  const normalized = raw.replace(/\r\n/g, '\n').replace(/^\uFEFF/, '');
  for (const block of normalized.split(/\n{2,}/)) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    const timeIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeIdx === -1) continue;
    const m = lines[timeIdx].match(
      /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/
    );
    if (!m) continue;
    const text = lines.slice(timeIdx + 1).join('\n').trim();
    if (!text) continue;
    cues.push({
      start: toSeconds(m[1], m[2], m[3], m[4]),
      end: toSeconds(m[5], m[6], m[7], m[8]),
      text,
    });
  }
  return cues;
}

/** Parse a WebVTT document into cues (used when yt-dlp emits .vtt). */
export function parseVtt(raw: string): CaptionCue[] {
  const cues: CaptionCue[] = [];
  const normalized = raw.replace(/\r\n/g, '\n').replace(/^\uFEFF/, '');
  for (const block of normalized.split(/\n{2,}/)) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    const timeIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeIdx === -1) continue;
    const m = lines[timeIdx].match(
      /(\d{1,2}):(\d{2}):(\d{2})[.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[.](\d{1,3})/
    );
    if (!m) continue;
    // Drop VTT cue-position suffixes after the end timestamp.
    const text = lines
      .slice(timeIdx + 1)
      .join('\n')
      .replace(/<[^>]+>/g, '')
      .trim();
    if (!text) continue;
    cues.push({
      start: toSeconds(m[1], m[2], m[3], m[4]),
      end: toSeconds(m[5], m[6], m[7], m[8]),
      text,
    });
  }
  return cues;
}

function formatTimestamp(seconds: number, msSeparator: ',' | '.'): string {
  const total = Math.max(0, seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const ms = Math.round((total - Math.floor(total)) * 1000);
  // Guard against 999.6ms rounding up past a second boundary.
  const safeMs = Math.min(ms, 999);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${msSeparator}${String(safeMs).padStart(3, '0')}`;
}

/** Serialize cues to a numbered SRT document. */
export function cuesToSrt(cues: CaptionCue[]): string {
  if (cues.length === 0) return '';
  return (
    cues
      .map(
        (c, i) =>
          `${i + 1}\n${formatTimestamp(c.start, ',')} --> ${formatTimestamp(c.end, ',')}\n${c.text}`
      )
      .join('\n\n') + '\n'
  );
}

/** Serialize cues to a WebVTT document. */
export function cuesToVtt(cues: CaptionCue[]): string {
  const body = cues
    .map(
      (c) => `${formatTimestamp(c.start, '.')} --> ${formatTimestamp(c.end, '.')}\n${c.text}`
    )
    .join('\n\n');
  return `WEBVTT\n\n${body}${body ? '\n' : ''}`;
}

/** Serialize cues to a plain-text transcript (one caption line per row). */
export function cuesToTxt(cues: CaptionCue[]): string {
  const rows = cues.map((c) => c.text.replace(/\n+/g, ' ').trim()).filter(Boolean);
  return rows.length ? rows.join('\n') + '\n' : '';
}

/**
 * True when a cue contains at least one letter or digit. Whisper hallucinates
 * bare punctuation on non-speech audio (a lone "." or "♪♪"), which would
 * otherwise show up as a garbage caption line.
 */
function hasSpeakableContent(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

/** De-duplicate consecutive identical cue texts (rolling auto-captions). */
function dedupeCues(cues: CaptionCue[]): CaptionCue[] {
  const out: CaptionCue[] = [];
  let lastText = '';
  for (const cue of cues) {
    const text = cue.text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (!hasSpeakableContent(text)) continue;
    if (text === lastText) continue;
    lastText = text;
    out.push({ ...cue, text });
  }
  return out;
}

function extractYouTubeId(url: string): string | null {
  const m =
    /(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/i.exec(url);
  return m ? m[1] : null;
}

/**
 * Video caption / subtitle generation.
 *
 * Three engines, tried in order of cost:
 *  1. YouTube's own caption tracks (public timedtext endpoints) — no extra deps.
 *  2. yt-dlp subtitle extraction (optional install) — covers YouTube + other
 *     platforms whose players expose subtitle tracks.
 *  3. Local Whisper transcription (optional install) — the only engine that can
 *     transcribe uploaded/local files with no platform metadata at all.
 */
export class CaptionGenerator {
  public static async generateFromUrl(url: string, options: CaptionOptions = {}): Promise<CaptionGenerationResult> {
    if (!/^https?:\/\//i.test(url)) {
      throw new Error('Please provide a valid video URL (http/https).');
    }
    const language = (options.language || 'en').toLowerCase();
    const notices: string[] = [];

    const videoId = extractYouTubeId(url);
    if (videoId) {
      try {
        const result = await this.youtubeCaptions(videoId, language);
        if (result) {
          notices.push('Captions fetched from the video platform and converted to subtitle files.');
          return { ...result, notices };
        }
        notices.push('The platform exposed no caption track for this video; trying yt-dlp subtitles.');
      } catch (err) {
        if (err instanceof RateLimitedError) throw err;
        notices.push(`Platform caption fetch failed (${(err as Error).message}); trying yt-dlp subtitles.`);
      }
    }

    const viaYtDlp = await this.ytDlpCaptions(url, language);
    if (viaYtDlp) {
      notices.push('Captions extracted with yt-dlp from the platform subtitle tracks.');
      return { ...viaYtDlp, notices };
    }

    throw new Error(
      'No captions could be obtained from this URL. The video may have no subtitle track, or the platform ' +
        'did not expose one to this server. For videos you own, download the file first and generate captions ' +
        'with the local Whisper engine instead.'
    );
  }

  public static async generateFromLocalFile(
    filePath: string,
    options: CaptionOptions = {}
  ): Promise<CaptionGenerationResult> {
    if (!filePath) throw new Error('A local video file path is required.');
    await fsp.access(filePath);
    const language = (options.language || '').toLowerCase();
    return this.whisperTranscribe(filePath, language, options);
  }

  /** True when a local Whisper install is usable (surfaced to the UI). */
  public static async whisperAvailable(): Promise<boolean> {
    return (await findWhisperInvocation()) !== null;
  }

  // -------------------------------------------------------------------------
  // Engine 1: YouTube timedtext caption tracks
  // -------------------------------------------------------------------------

  private static async youtubeCaptions(
    videoId: string,
    language: string
  ): Promise<Omit<CaptionGenerationResult, 'notices'> | null> {
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const pageRes = await fetchWithRetry(
      watchUrl,
      {
        headers: {
          'User-Agent': UA,
          'Accept-Language': 'en-US,en;q=0.9',
          Cookie: 'SOCS=CAI; CONSENT=PENDING+999',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(10000),
      },
      'YouTube watch page'
    );
    if (!pageRes.ok) return null;

    const html = await pageRes.text();
    const apiKey = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1];
    const visitorData =
      html.match(/"visitorData":"([^"]+)"/)?.[1] ||
      html.match(/ytcfg\.set\(\{[^]*?"VISITOR_DATA":"([^"]+)"/)?.[1];
    if (!apiKey) return null;

    const clients = [
      { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 30, osName: 'Android', osVersion: '12' },
      { clientName: 'IOS', clientVersion: '21.02.3', deviceMake: 'Apple', deviceModel: 'iPhone16,2', osName: 'iOS', osVersion: '17.5.1' },
      { clientName: 'WEB', clientVersion: '2.20250610.01.00' },
      { clientName: 'TVHTML5', clientVersion: '7.20250316.18.00' },
    ];

    for (const client of clients) {
      try {
        const playerRes = await fetchWithRetry(
          `https://www.youtube.com/youtubei/v1/player?key=${apiKey}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': UA,
              ...(visitorData ? { 'X-Goog-Visitor-Id': visitorData } : {}),
            },
            body: JSON.stringify({
              context: {
                client: { ...client, hl: 'en', gl: 'US', ...(visitorData ? { visitorData } : {}) },
              },
              videoId,
              contentCheckOk: true,
              racyCheckOk: true,
            }),
            signal: AbortSignal.timeout(10000),
          },
          `Innertube player (${client.clientName})`
        );
        if (!playerRes.ok) continue;
        const data = (await playerRes.json()) as any;
        if (data?.playabilityStatus?.status && data.playabilityStatus.status !== 'OK') continue;

        const tracks: any[] = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
        if (tracks.length === 0) continue;

        const picked =
          tracks.find((t) => t.languageCode === language && t.kind !== 'asr') ||
          tracks.find((t) => t.languageCode === language) ||
          tracks.find((t) => `${t.languageCode || ''}`.startsWith(language)) ||
          tracks.find((t) => t.kind !== 'asr') ||
          tracks[0];

        const cues = await this.fetchTimedText(picked.baseUrl);
        if (cues.length === 0) continue;

        const title = data?.videoDetails?.title as string | undefined;
        const durationSec = Number(data?.videoDetails?.lengthSeconds) || undefined;
        return {
          source: 'youtube',
          engineDetail: `YouTube caption track (${picked.languageCode || language}${picked.kind === 'asr' ? ', auto-generated' : ''})`,
          language: picked.languageCode || language,
          title,
          durationSec,
          cues: dedupeCues(cues),
        };
      } catch (err) {
        if (err instanceof RateLimitedError) throw err;
        // Try the next client profile.
      }
    }
    return null;
  }

  /** Fetch and parse a timedtext URL (json3 first, then the XML default). */
  private static async fetchTimedText(baseUrl: string): Promise<CaptionCue[]> {
    const jsonUrl = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}fmt=json3`;

    try {
      const res = await fetchWithRetry(
        jsonUrl,
        { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) },
        'YouTube timedtext (json3)'
      );
      if (res.ok) {
        const data = (await res.json()) as any;
        const cues: CaptionCue[] = [];
        for (const event of data?.events || []) {
          // `aAppend` events re-announce the previous line; skip them.
          if (event?.aAppend) continue;
          const text = (event?.segs || [])
            .map((s: any) => s?.utf8 || '')
            .join('')
            .replace(/\n+/g, ' ')
            .trim();
          if (!text) continue;
          const start = Number(event?.tStartMs || 0) / 1000;
          const duration = Number(event?.dDurationMs || 0) / 1000;
          cues.push({ start, end: start + (duration > 0 ? duration : 2), text });
        }
        if (cues.length > 0) return cues;
      }
    } catch (err) {
      if (err instanceof RateLimitedError) throw err;
      // Fall through to the XML format.
    }

    try {
      const res = await fetchWithRetry(
        baseUrl,
        { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) },
        'YouTube timedtext (xml)'
      );
      if (!res.ok) return [];
      const xml = await res.text();
      const cues: CaptionCue[] = [];
      const re = /<text start="([\d.]+)"(?: dur="([\d.]+)")?[^>]*>([\s\S]*?)<\/text>/g;
      let match: RegExpExecArray | null;
      while ((match = re.exec(xml)) !== null) {
        const text = decodeEntities(match[3].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
        if (!text) continue;
        const start = Number(match[1]) || 0;
        const duration = Number(match[2]) || 0;
        cues.push({ start, end: start + (duration > 0 ? duration : 2), text });
      }
      return cues;
    } catch (err) {
      if (err instanceof RateLimitedError) throw err;
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // Engine 2: yt-dlp subtitle extraction
  // -------------------------------------------------------------------------

  private static async ytDlpCaptions(
    url: string,
    language: string
  ): Promise<Omit<CaptionGenerationResult, 'notices'> | null> {
    const invocation = await findYtDlpInvocation();
    if (!invocation) return null;

    const configuredCookies = findCookiesFile();
    const jar = configuredCookies || tempCookieJar();
    const outDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'vo-captions-'));

    try {
      const langs = [...new Set([language, `${language}.*`, 'en', 'en.*'])].join(',');
      const args = [
        ...invocation.prefixArgs,
        '--no-warnings',
        '--skip-download',
        '--write-subs',
        '--write-auto-subs',
        '--sub-langs',
        langs,
        '--convert-subs',
        'srt',
        '--no-playlist',
        '--cookies',
        jar,
        '--user-agent',
        YTDLP_UA,
        '-o',
        path.join(outDir, '%(id)s.%(ext)s'),
        url,
      ];
      await execFileAsync(invocation.command, args, {
        timeout: 120_000,
        maxBuffer: 32 * 1024 * 1024,
      });

      const files = await fsp.readdir(outDir);
      const subtitleFile = files.find((f) => f.endsWith('.srt')) || files.find((f) => f.endsWith('.vtt'));
      if (!subtitleFile) return null;

      const raw = await fsp.readFile(path.join(outDir, subtitleFile), 'utf8');
      const cues = dedupeCues(subtitleFile.endsWith('.srt') ? parseSrt(raw) : parseVtt(raw));
      if (cues.length === 0) return null;

      const detected = /\.([a-zA-Z-]{2,7})\.(?:srt|vtt)$/.exec(subtitleFile)?.[1];
      return {
        source: 'yt-dlp',
        engineDetail: `yt-dlp subtitles (${detected || language})`,
        language: detected || language,
        cues,
      };
    } catch {
      return null;
    } finally {
      await fsp.rm(outDir, { recursive: true, force: true }).catch(() => {});
      if (!configuredCookies) {
        try {
          fs.unlinkSync(jar);
        } catch {}
      }
    }
  }

  // -------------------------------------------------------------------------
  // Engine 3: local Whisper transcription
  // -------------------------------------------------------------------------

  private static async whisperTranscribe(
    filePath: string,
    language: string,
    options: CaptionOptions
  ): Promise<CaptionGenerationResult> {
    const invocation = await findWhisperInvocation();
    if (!invocation) {
      throw new Error(WHISPER_MISSING_MESSAGE);
    }

    const model = options.model || process.env.WHISPER_MODEL || 'base';
    const outDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'vo-whisper-'));
    try {
      const args = [
        ...invocation.prefixArgs,
        '--model',
        model,
        '--output_format',
        'srt',
        '--output_dir',
        outDir,
        '--verbose',
        'False',
      ];
      if (language) args.push('--language', language);
      args.push(filePath);

      // Long videos on CPU can take a while; the CLI is killed after 90 minutes.
      await execFileAsync(invocation.command, args, {
        timeout: 90 * 60 * 1000,
        maxBuffer: 64 * 1024 * 1024,
      });

      const files = await fsp.readdir(outDir);
      const srtFile = files.find((f) => f.endsWith('.srt'));
      if (!srtFile) {
        throw new Error('Whisper finished without producing a transcript file.');
      }
      const cues = dedupeCues(parseSrt(await fsp.readFile(path.join(outDir, srtFile), 'utf8')));
      if (cues.length === 0) {
        throw new Error('Whisper detected no speech in this video (the audio may be silent or purely musical).');
      }

      return {
        source: 'whisper',
        engineDetail: `Whisper local transcription (${model} model)`,
        language: language || 'auto-detected',
        cues,
        notices: [
          'Transcribed locally with Whisper — review the text before publishing, especially names and numbers.',
        ],
      };
    } finally {
      await fsp.rm(outDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
