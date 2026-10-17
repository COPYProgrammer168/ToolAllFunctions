// End-to-end check: POST /api/media/download with type=audio, format=mp3,
// customBitrate=320 and confirm the produced job output really is 320 kbps.
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MEDIA_DIR = path.join(ROOT, 'storage', 'test-media');
const API_PORT = Number(process.env.API_PORT || 3199);
const SRC_PORT = Number(process.env.SRC_PORT || 8199);

const log = (...a) => console.log(...a);

function probeBitrate(file) {
  const out = execFileSync(
    'ffprobe',
    ['-v', 'quiet', '-print_format', 'json', '-show_streams', '-select_streams', 'a', file],
    { encoding: 'utf8' }
  );
  const s = JSON.parse(out).streams?.[0];
  return { codec: s?.codec_name, kbps: Math.round((Number(s?.bit_rate) || 0) / 1000) };
}

function makeSource(name, args) {
  const out = path.join(MEDIA_DIR, name);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', ...args, out]);
  return out;
}

// Minimal Range-capable static server (mirrors a platform CDN).
function serveFile(file) {
  const server = http.createServer((req, res) => {
    const stat = fs.statSync(file);
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d+)-(\d*)/.exec(range);
      const start = m ? Number(m[1]) : 0;
      // Unsatisfiable window (a resumed, already-complete download) — RFC 7233.
      if (start >= stat.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
        res.end();
        return;
      }
      const end = m && m[2] ? Math.min(Number(m[2]), stat.size - 1) : stat.size - 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Type': 'audio/mpeg',
      });
      fs.createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Length': stat.size, 'Accept-Ranges': 'bytes', 'Content-Type': 'audio/mpeg' });
      fs.createReadStream(file).pipe(res);
    }
  });
  return new Promise((resolve) => server.listen(SRC_PORT, '127.0.0.1', () => resolve(server)));
}

async function waitForHealth(timeoutMs = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${API_PORT}/health`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('API server did not become healthy');
}

async function startDownload(payload) {
  const res = await fetch(`http://127.0.0.1:${API_PORT}/api/media/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`download start failed: ${JSON.stringify(body)}`);
  return body.jobId;
}

async function waitForJob(jobId, timeoutMs = 120000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    const res = await fetch(`http://127.0.0.1:${API_PORT}/api/media/jobs/${jobId}`);
    last = await res.json();
    if (last.progress?.status === 'COMPLETED' || last.progress?.status === 'FAILED') return last;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`job ${jobId} timed out: ${JSON.stringify(last)}`);
}

function findOutput(jobId) {
  const dir = path.join(ROOT, 'storage', 'media-tools', jobId, 'output');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  if (!files.length) return null;
  return path.join(dir, files[0]);
}

/** Waits for a job to finish (or fail) *and* have its output file on disk. */
async function waitForOutput(jobId, timeoutMs = 120000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    const res = await fetch(`http://127.0.0.1:${API_PORT}/api/media/jobs/${jobId}`);
    last = await res.json();
    if (last.progress?.status === 'FAILED') return last;
    if (last.progress?.status === 'COMPLETED' && findOutput(jobId)) return last;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`job ${jobId} output never reappeared: ${JSON.stringify(last)}`);
}

async function main() {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });

  const src128 = makeSource('e2e_src_128.mp3', ['-c:a', 'libmp3lame', '-b:a', '128k']);
  log('source:', src128, probeBitrate(src128));

  const srcServer = await serveFile(src128);

  const tsxCli = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const api = spawn(process.execPath, [tsxCli, 'src/server.ts'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(API_PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  api.stdout.on('data', (d) => process.stdout.write(`[api] ${d}`));
  api.stderr.on('data', (d) => process.stdout.write(`[api:err] ${d}`));

  const results = [];
  try {
    await waitForHealth();

    // Case A: Music download with explicit 320 kbps request.
    const jobIdA = await startDownload({
      sourceUrl: `http://127.0.0.1:${SRC_PORT}/e2e_src_128.mp3`,
      title: 'Music Case A',
      type: 'audio',
      format: 'mp3',
      customBitrate: 320,
    });
    const jobA = await waitForJob(jobIdA);
    const outA = findOutput(jobIdA);
    const measA = outA ? probeBitrate(outA) : null;
    log('CASE A (customBitrate=320):', jobA.progress.status, outA, measA);
    results.push({ case: 'A explicit 320', status: jobA.progress.status, measured: measA });

    // Case B: same source, no customBitrate (what the UI sends when a format
    // entry has no bitrateKbps). MP3 exports are 320 kbps by contract, so the
    // server must not fall back to a stream copy of the 128 kbps source.
    const jobIdB = await startDownload({
      sourceUrl: `http://127.0.0.1:${SRC_PORT}/e2e_src_128.mp3`,
      title: 'Music Case B',
      type: 'audio',
      format: 'mp3',
    });
    const jobB = await waitForJob(jobIdB);
    const outB = findOutput(jobIdB);
    const measB = outB ? probeBitrate(outB) : null;
    log('CASE B (no customBitrate):', jobB.progress.status, outB, measB);
    results.push({ case: 'B no bitrate', status: jobB.progress.status, measured: measB });

    // Case C: pause/resume. Resuming used to copy the raw source straight over
    // the output, publishing the 128 kbps source (and container) instead of the
    // converted file. The output is deleted first so the test can only pass if
    // resume really re-runs the conversion and rewrites it.
    const bytesB = outB ? fs.statSync(outB).size : 0;
    if (outB) fs.rmSync(outB, { force: true });
    const resumeRes = await fetch(`http://127.0.0.1:${API_PORT}/api/media/jobs/${jobIdB}/resume`, {
      method: 'POST',
    });
    const resumeBody = await resumeRes.json();
    const jobC = await waitForOutput(jobIdB, 60000);
    const outC = findOutput(jobIdB);
    const measC = outC ? probeBitrate(outC) : null;
    const bytesC = outC ? fs.statSync(outC).size : 0;
    log('CASE C (resume):', resumeBody, jobC.progress.status, outC, measC, `bytes ${bytesB} -> ${bytesC}`);
    results.push({
      case: 'C resume',
      status: jobC.progress.status,
      measured: measC,
      resumed: resumeRes.ok,
      sourceBytes: fs.statSync(src128).size,
      outputBytes: bytesC,
    });
  } finally {
    api.kill();
    srcServer.close();
  }

  log('\nSUMMARY');
  for (const r of results) log(JSON.stringify(r));

  const get = (name) => results.find((r) => r.case.startsWith(name));
  const kbpsOf = (r) => r?.measured?.kbps ?? 0;
  const done = (r) => r?.status === 'COMPLETED';
  const checks = [
    ['A: explicit 320 kbps request honored', done(get('A')) && kbpsOf(get('A')) >= 300],
    ['B: MP3 download without a bitrate is still 320 kbps', done(get('B')) && kbpsOf(get('B')) >= 300],
    [
      'C: resumed job re-encodes (320 kbps, not a copy of the 128 kbps source)',
      done(get('C')) && kbpsOf(get('C')) >= 300 && get('C')?.outputBytes !== get('C')?.sourceBytes,
    ],
  ];

  let failed = 0;
  for (const [label, ok] of checks) {
    log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
    if (!ok) failed++;
  }
  if (failed) {
    console.error(`\n${failed} check(s) failed`);
    process.exit(1);
  }
  log('\nALL MUSIC BITRATE CHECKS PASSED');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
