import { AudioExtractor } from '../src/services/AudioExtractor.js';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs/promises';

const execAsync = promisify(exec);
const TEST_DIR = path.resolve(import.meta.dirname, '../../storage/test-media');

async function genSrc(name: string, args: string[]) {
  const out = path.join(TEST_DIR, name);
  await execAsync(`ffmpeg -y -f lavfi -i "sine=frequency=440:duration=3" ${args.join(' ')} "${out}"`);
  return out;
}

async function probe(file: string) {
  const { stdout } = await execAsync(`ffprobe -v quiet -print_format json -show_streams -select_streams a "${file}"`);
  const s = JSON.parse(stdout).streams?.[0];
  return Math.round((Number(s?.bit_rate) || 0) / 1000);
}

await fs.mkdir(TEST_DIR, { recursive: true });

// Simulate a SoundCloud-style 128 kbps MP3 progressive source
const src128 = await genSrc('src_128.mp3', ['-c:a', 'libmp3lame', '-b:a', '128k']);
// A high-quality MP3 source (stream copy should still be allowed)
const src320 = await genSrc('src_320.mp3', ['-c:a', 'libmp3lame', '-b:a', '320k']);
// A video source with AAC audio (YouTube/TikTok style)
const srcAacMp4 = await genSrc('src_aac.mp4', ['-f', 'lavfi', '-i', 'testsrc=duration=3:size=320x240:rate=15', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k']);

const run = async (label: string, input: string, opts: any) => {
  const out = path.join(TEST_DIR, `out_${label.replace(/\W+/g, '_')}.${opts.format}`);
  const res = await AudioExtractor.extract({ inputPath: input, outputPath: out, ...opts });
  const measured = await probe(out);
  console.log(`${label}: codec-source-bitrate=${res.sourceBitrateKbps} | streamCopy=${res.isStreamCopy} | reported=${res.outputBitrateKbps}k | measured=${measured}k`);
  return { res, measured };
};

console.log('== Case 1: "Download All -> Music" (explicit 320) on a 128 kbps MP3 source ==');
const c1 = await run('c1', src128, { format: 'mp3', targetBitrateKbps: 320, preferStreamCopy: true });
console.log(c1.res.isStreamCopy ? 'FAIL: still stream-copied (stays 128k)' : 'PASS: re-encoded, 320k honored');

console.log('== Case 2: Music (explicit 320) on AAC video source ==');
const c2 = await run('c2', srcAacMp4, { format: 'mp3', targetBitrateKbps: 320, preferStreamCopy: true });
console.log(!c2.res.isStreamCopy && c2.measured >= 300 ? 'PASS: 320k' : 'FAIL');

console.log('== Case 3: source already >= requested (320 MP3, explicit 320) -> copy OK ==');
const c3 = await run('c3', src320, { format: 'mp3', targetBitrateKbps: 320, preferStreamCopy: true });
console.log(c3.res.isStreamCopy && c3.measured >= 300 ? 'PASS: copied at 320k, no needless re-encode' : 'UNEXPECTED');

console.log('== Case 4: "Original container" request (no explicit bitrate), mp3 source ==');
const c4 = await run('c4', src128, { format: 'mp3', preferStreamCopy: true });
console.log(c4.res.isStreamCopy ? 'PASS: original stream copy preserved' : 'FAIL: original behavior changed');

console.log('== Case 5: "Original container" (no explicit bitrate), AAC source -> m4a ==');
const c5 = await run('c5', srcAacMp4, { format: 'm4a', preferStreamCopy: true });
console.log(c5.res.isStreamCopy ? 'PASS: original stream copy preserved' : 'FAIL: original behavior changed');

const failed = (!c1.res.isStreamCopy ? 0 : 1) + (c2.res.isStreamCopy ? 1 : 0) + (c3.res.isStreamCopy ? 0 : 1) + (c4.res.isStreamCopy ? 0 : 1) + (c5.res.isStreamCopy ? 0 : 1);
console.log(failed === 0 ? '\nALL CASES PASSED' : `\n${failed} CASE(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
