/**
 * Standalone smoke test for the QR "hosted file" module.
 *
 * REQUIRES THE SERVER RUNNING on http://localhost:3001 (the default dev port).
 * Override the base URL with the QR_TEST_BASE_URL env var or the first argv:
 *   npx tsx test/test-qr-files.ts http://localhost:3001
 *
 * Exits non-zero if any assertion fails.
 */

const BASE_URL =
  process.argv[2] || process.env.QR_TEST_BASE_URL || 'http://localhost:3001';
const UPLOAD_URL = `${BASE_URL}/api/tools/qr-files/upload`;

// Smallest valid PNG (1x1 transparent) so the server sees a real image file.
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (condition) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${msg}`);
    failed++;
  }
}

async function upload(
  filename: string,
  bytes: Buffer,
  mime: string
): Promise<globalThis.Response> {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mime }), filename);
  return fetch(UPLOAD_URL, { method: 'POST', body: form });
}

async function run(): Promise<void> {
  console.log('====================================================');
  console.log('QR HOSTED FILES — SMOKE TEST');
  console.log(`Target: ${BASE_URL}`);
  console.log('====================================================\n');

  // 1. Happy path: upload a PNG and fetch it back.
  console.log('[Test 1] PNG upload + inline serve');
  const uploadRes = await upload('test-image.png', PNG_BYTES, 'image/png');
  assert(uploadRes.status === 200, `Upload returned 200 (got ${uploadRes.status})`);

  const body: any = await uploadRes.json().catch(() => ({}));
  assert(typeof body.id === 'string' && body.id.length > 0, 'Response contains an id');
  assert(
    typeof body.url === 'string' && body.url.startsWith('/api/tools/qr-files/f/'),
    `Response url is the expected shape (${body.url})`
  );
  assert(body.mime === 'image/png', `Response mime is image/png (got ${body.mime})`);
  assert(
    typeof body.size === 'number' && body.size === PNG_BYTES.length,
    `Response size matches upload (${body.size})`
  );

  if (typeof body.url === 'string') {
    const serveRes = await fetch(`${BASE_URL}${body.url}`);
    assert(serveRes.status === 200, `Serve returned 200 (got ${serveRes.status})`);
    assert(
      (serveRes.headers.get('content-type') || '').startsWith('image/png'),
      `Serve content-type is image/png (got ${serveRes.headers.get('content-type')})`
    );
    assert(
      serveRes.headers.get('x-content-type-options') === 'nosniff',
      'Serve sends x-content-type-options: nosniff'
    );
    await serveRes.arrayBuffer();
  }

  // 2. Rejection: SVG is an active-content vector and must be refused.
  console.log('\n[Test 2] SVG upload rejected');
  const svgRes = await upload(
    'evil.svg',
    Buffer.from('<svg onload="alert(1)"></svg>'),
    'image/svg+xml'
  );
  assert(svgRes.status === 400, `SVG upload rejected with 400 (got ${svgRes.status})`);
  await svgRes.json().catch(() => ({}));

  // 3. Rejection: traversal-shaped id.
  // The `..` is percent-encoded so the value survives URL normalization intact
  // (a literal `../..` is collapsed to `/api/` before the request is sent) and
  // actually reaches the route, where the id regex must reject it.
  console.log('\n[Test 3] Traversal id rejected');
  const travRes = await fetch(
    `${BASE_URL}/api/tools/qr-files/f/%2e%2e%2f%2e%2e%2fpackage.json`
  );
  assert(travRes.status === 400, `Traversal id rejected with 400 (got ${travRes.status})`);
  await travRes.text().catch(() => '');

  console.log('\n====================================================');
  console.log(`TEST SUMMARY: ${passed} passed, ${failed} failed`);
  console.log('====================================================');

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
