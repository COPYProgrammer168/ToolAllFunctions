import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MedalProvider, toPublicInspection } from '../src/modules/medal-downloader/provider.js';
import { MedalJobManager } from '../src/modules/medal-downloader/jobManager.js';
import { parseClipPage } from '../src/modules/medal-downloader/clipPage.js';
import { parseMedalClipUrl } from '../src/modules/medal-downloader/url.js';
import {
  MedalAuthorizationRequiredError,
  MedalRateLimitedError,
} from '../src/modules/medal-downloader/errors.js';
import { MEDAL_UNAVAILABLE_MESSAGE } from '../src/modules/medal-downloader/config.js';
import type {
  MedalInspectionInternal,
  MedalMediaInfo,
  MedalVideoInfo,
} from '../src/modules/medal-downloader/types.js';

const CLIP_ID = 'nMVYBnbtZWJPDsstr';
const CLIP_URL = `https://medal.tv/games/racing-master/clips/${CLIP_ID}?invite=cr-MSxBUG8sOTcwMDM2MTg3`;
const MEDIA_URL =
  'https://cdn.medal.tv/mediac/mbvu5oLbYmxrB8.mp4?auth=exp=1792848600~data=test~hmac=test';
const THUMBNAIL_URL =
  'https://cdn.medal.tv/ugcc/content-thumbnail/NERWI21XCdfRWYE1rymxEg-0.jpg?auth=test';

const clipPageHtml = `<!doctype html>
<html>
  <head>
    <title>Untitled - Clipped RACING MASTER with Medal.tv</title>
    <meta property="og:title" content="Untitled - Clipped RACING MASTER with Medal.tv" />
    <meta name="description" content="Watch Untitled by kyukaiz and millions of other RACING MASTER videos on Medal." />
    <script type="application/ld+json">
      {
        "@context": "https://schema.org/",
        "@type": "VideoObject",
        "name": "Untitled",
        "thumbnailUrl": ["${THUMBNAIL_URL}"],
        "@id": "https://medal.tv/games/racing-master/clips/${CLIP_ID}",
        "uploadDate": "2026-10-24T06:57:38.145Z",
        "duration": "PT0H1M0.13S",
        "contentUrl": "${MEDIA_URL}",
        "author": { "@type": "Person", "name": "kyukaiz" },
        "keywords": "racing master"
      }
    </script>
  </head>
  <body>clip page</body>
</html>`;

function mp4Bytes(size = 4096): Buffer {
  const bytes = Buffer.alloc(size);
  bytes.writeUInt32BE(24, 0);
  bytes.write('ftyp', 4, 'ascii');
  bytes.write('isom', 8, 'ascii');
  return bytes;
}

const videoInfo: MedalVideoInfo = {
  container: 'mp4',
  videoCodec: 'h264',
  audioCodec: 'aac',
  width: 1244,
  height: 720,
  fps: 60,
  durationSeconds: 60.13,
  sizeBytes: 4096,
};

const availableInspection: MedalInspectionInternal = {
  clip: {
    clipId: CLIP_ID,
    gameSlug: 'racing-master',
    gameName: 'RACING MASTER',
    title: 'Untitled',
    creator: 'kyukaiz',
    durationSeconds: 60.13,
    thumbnailUrl: THUMBNAIL_URL,
    uploadedAt: '2026-10-24T06:57:38.145Z',
    canonicalUrl: `https://medal.tv/games/racing-master/clips/${CLIP_ID}`,
  },
  media: {
    mediaUrl: MEDIA_URL,
    contentType: 'video/mp4',
    container: 'mp4',
    sizeBytes: 4096,
    acceptRanges: true,
  },
  available: true,
  inspectedAt: new Date().toISOString(),
};

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 10_000
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for condition');
}

test('parseMedalClipUrl accepts supported public clip forms', () => {
  const exact = parseMedalClipUrl(CLIP_URL);
  assert.equal(exact.clipId, CLIP_ID);
  assert.equal(exact.gameSlug, 'racing-master');
  assert.equal(exact.canonicalUrl, `https://medal.tv/games/racing-master/clips/${CLIP_ID}`);
  assert.equal(
    exact.requestUrl,
    `https://medal.tv/games/racing-master/clips/${CLIP_ID}?invite=cr-MSxBUG8sOTcwMDM2MTg3`
  );

  const short = parseMedalClipUrl(`https://www.medal.tv/clips/${CLIP_ID}`);
  assert.equal(short.clipId, CLIP_ID);
  assert.equal(short.gameSlug, undefined);
  assert.equal(short.canonicalUrl, `https://medal.tv/clips/${CLIP_ID}`);

  const trailing = parseMedalClipUrl(
    `https://medal.tv/games/racing-master/clips/${CLIP_ID}/?utm_source=test`
  );
  assert.equal(trailing.gameSlug, 'racing-master');
  assert.equal(trailing.requestUrl, `https://medal.tv/games/racing-master/clips/${CLIP_ID}`);
});

test('parseMedalClipUrl rejects unsafe and unsupported links', () => {
  const invalid = [
    `http://medal.tv/clips/${CLIP_ID}`,
    `https://medal.tv.evil.example/clips/${CLIP_ID}`,
    `https://evil.example/clips/${CLIP_ID}`,
    `https://user:pass@medal.tv/clips/${CLIP_ID}`,
    `https://medal.tv:8443/clips/${CLIP_ID}`,
    'https://cdn.medal.tv/mediac/video.mp4',
    'javascript:alert(1)',
    'not a url',
    `https://medal.tv/clips/${CLIP_ID}?next=https://evil.example`,
  ];

  for (const url of invalid) {
    if (url.includes('?next=')) {
      // Arbitrary query parameters are discarded, not forwarded; the clip
      // itself is still a valid Medal clip.
      assert.equal(parseMedalClipUrl(url).requestUrl, `https://medal.tv/clips/${CLIP_ID}`);
      continue;
    }
    assert.throws(() => parseMedalClipUrl(url), /Medal|clip|HTTPS|port|credentials/i, url);
  }

  assert.throws(
    () => parseMedalClipUrl(`https://medal.tv/games/racing-master/clips/${CLIP_ID}/extra`),
    /Only Medal/i
  );
  assert.throws(
    () => parseMedalClipUrl('https://medal.tv/games/racing-master'),
    /Only Medal/i
  );
});

test('parseClipPage reads genuine public schema.org metadata', () => {
  const parsed = parseClipPage(clipPageHtml);
  assert.equal(parsed.title, 'Untitled');
  assert.equal(parsed.creator, 'kyukaiz');
  assert.equal(parsed.gameName, 'RACING MASTER');
  assert.equal(parsed.schemaGameSlug, 'racing-master');
  assert.equal(parsed.durationSeconds, 60.13);
  assert.equal(parsed.uploadedAt, '2026-10-24T06:57:38.145Z');
  assert.equal(parsed.contentUrl, MEDIA_URL);
  assert.equal(parsed.thumbnailUrl, THUMBNAIL_URL);
  assert.equal(parsed.contentUrlRejected, false);
});

test('parseClipPage refuses a contentUrl outside Medal’s CDN', () => {
  const html = clipPageHtml.replace(
    MEDIA_URL,
    'https://attacker.example/video.mp4?auth=test'
  );
  const parsed = parseClipPage(html);
  assert.equal(parsed.contentUrl, undefined);
  assert.equal(parsed.contentUrlRejected, true);
});

test('parseClipPage handles @graph wrappers', () => {
  const html = `<script type="application/ld+json">
    {"@context":"https://schema.org","@graph":[
      {"@type":"WebPage","name":"Clip page"},
      {"@type":"VideoObject","name":"Graph clip","contentUrl":"${MEDIA_URL}"}
    ]}
  </script>`;
  const parsed = parseClipPage(html);
  assert.equal(parsed.title, 'Graph clip');
  assert.equal(parsed.contentUrl, MEDIA_URL);
});

test('MedalProvider inspects and probes a public clip without exposing the media URL', async () => {
  const requests: { url: string; headers?: Headers; method?: string }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, headers: new Headers(init?.headers), method: init?.method });
    if (url.includes('cdn.medal.tv')) {
      return new Response(mp4Bytes(), {
        status: 206,
        headers: {
          'content-type': 'video/mp4',
          'content-range': 'bytes 0-4095/4096',
          'accept-ranges': 'bytes',
        },
      });
    }
    return new Response(clipPageHtml, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  };

  const provider = new MedalProvider({
    fetchImpl,
    validateUrl: async (url) => ({ valid: true, normalizedUrl: url }),
  });

  const inspection = await provider.inspect(CLIP_URL);
  assert.equal(inspection.available, true);
  assert.equal(inspection.media?.sizeBytes, 4096);
  assert.equal(inspection.clip.creator, 'kyukaiz');

  const publicInspection = toPublicInspection(inspection);
  assert.equal(publicInspection.download.state, 'available');
  assert.equal(publicInspection.download.sizeBytes, 4096);
  assert.equal(JSON.stringify(publicInspection).includes(MEDIA_URL), false);
  assert.equal(JSON.stringify(publicInspection).includes('mediac/'), false);
  assert.equal(requests[0].headers?.get('user-agent')?.includes('VideoOptimize'), true);
  assert.match(requests[1].headers?.get('range') || '', /^bytes=0-/);
});

test('MedalProvider returns download_not_available when no original is exposed', async () => {
  const html = clipPageHtml.replace(/\s*"contentUrl":\s*"[^"]+",?/, '');
  const provider = new MedalProvider({
    fetchImpl: async () =>
      new Response(html, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    validateUrl: async (url) => ({ valid: true, normalizedUrl: url }),
  });

  const inspection = await provider.inspect(CLIP_URL);
  assert.equal(inspection.available, false);
  const publicInspection = toPublicInspection(inspection);
  assert.equal(publicInspection.download.state, 'download_not_available');
  assert.equal(publicInspection.download.message, MEDAL_UNAVAILABLE_MESSAGE);
  assert.equal(JSON.stringify(publicInspection).includes(MEDIA_URL), false);
  assert.equal(JSON.stringify(publicInspection).includes('mediac/'), false);
});

test('MedalProvider treats a restricted media probe as unavailable', async () => {
  const provider = new MedalProvider({
    fetchImpl: async (input) => {
      if (String(input).includes('cdn.medal.tv')) {
        return new Response(null, { status: 403 });
      }
      return new Response(clipPageHtml, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    },
    validateUrl: async (url) => ({ valid: true, normalizedUrl: url }),
  });

  const inspection = await provider.inspect(CLIP_URL);
  assert.equal(inspection.available, false);
  assert.equal(inspection.unavailableReason, 'media_not_public');
});

test('MedalProvider rejects a redirect to an unapproved host', async () => {
  const provider = new MedalProvider({
    fetchImpl: async () =>
      new Response(null, {
        status: 302,
        headers: { location: 'https://attacker.example/clip' },
      }),
    validateUrl: async (url) => ({ valid: true, normalizedUrl: url }),
  });

  await assert.rejects(() => provider.inspect(CLIP_URL), /unapproved host|not safe/i);
});

test('MedalProvider maps upstream 429 to a typed rate limit', async () => {
  const provider = new MedalProvider({
    fetchImpl: async () =>
      new Response(null, {
        status: 429,
        headers: { 'retry-after': '42' },
      }),
    validateUrl: async (url) => ({ valid: true, normalizedUrl: url }),
  });

  await assert.rejects(
    () => provider.inspect(CLIP_URL),
    (err: unknown) =>
      err instanceof MedalRateLimitedError && err.retryAfterSec === 42 && err.status === 429
  );
});

test('MedalJobManager downloads, validates, and exposes token-authorized results', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'medal-downloader-test-'));
  const media = mp4Bytes();
  const provider = {
    inspect: async (): Promise<MedalInspectionInternal> => availableInspection,
    openDownload: async (
      _media: MedalMediaInfo,
      _signal: AbortSignal
    ): Promise<{ response: Response; totalBytes: number }> => ({
      response: new Response(media, {
        status: 200,
        headers: { 'content-type': 'video/mp4', 'content-length': String(media.length) },
      }),
      totalBytes: media.length,
    }),
  };

  const manager = new MedalJobManager(provider, {
    config: { tempDir, maxConcurrentJobs: 1 },
    probeFile: async (_filePath, sizeBytes) => ({ ...videoInfo, sizeBytes }),
  });

  try {
    await manager.init();
    assert.throws(
      () => manager.createJob('127.0.0.1', CLIP_URL, false),
      MedalAuthorizationRequiredError
    );

    const job = manager.createJob('127.0.0.1', CLIP_URL, true);
    await waitFor(() => manager.getJob(job.jobId)?.state === 'done');

    const finished = manager.getJob(job.jobId);
    assert.ok(finished);
    assert.equal(finished?.progressPercent, 100);
    assert.equal(finished?.media?.width, 1244);
    assert.equal(finished?.media?.videoCodec, 'h264');
    assert.equal(finished?.filename, `Untitled-${CLIP_ID}.mp4`);
    assert.ok(finished?.filePath);
    assert.deepEqual(await fs.readFile(finished!.filePath!), media);

    assert.ok(manager.getAuthorizedJob(job.jobId, job.downloadToken));
    assert.equal(manager.getAuthorizedJob(job.jobId, 'wrong-token'), undefined);

    const publicJob = manager.toPublicJob(finished!);
    assert.equal(publicJob.state, 'done');
    assert.equal(publicJob.progress.percent, 100);
    assert.equal(publicJob.downloadUrl?.includes(job.downloadToken), false);
    assert.equal(JSON.stringify(publicJob).includes(MEDIA_URL), false);
    assert.equal(JSON.stringify(publicJob).includes(job.downloadToken), false);
  } finally {
    await manager.stop();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('MedalJobManager reports download_not_available from job-time re-inspection', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'medal-downloader-test-'));
  const provider = {
    inspect: async (): Promise<MedalInspectionInternal> => ({
      ...availableInspection,
      media: undefined,
      available: false,
      unavailableReason: 'no_public_original',
    }),
    openDownload: async () => {
      throw new Error('must not download');
    },
  };
  const manager = new MedalJobManager(provider, {
    config: { tempDir, maxConcurrentJobs: 1 },
    probeFile: async () => videoInfo,
  });

  try {
    await manager.init();
    const job = manager.createJob('127.0.0.1', CLIP_URL, true);
    await waitFor(() => manager.getJob(job.jobId)?.state === 'download_not_available');
    const finished = manager.getJob(job.jobId)!;
    assert.equal(finished.message, MEDAL_UNAVAILABLE_MESSAGE);
    assert.equal(manager.toPublicJob(finished).state, 'download_not_available');
  } finally {
    await manager.stop();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('MedalJobManager cancellation aborts an in-flight inspection', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'medal-downloader-test-'));
  const provider = {
    inspect: async (_url: string, signal?: AbortSignal): Promise<MedalInspectionInternal> =>
      new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      }),
    openDownload: async () => {
      throw new Error('must not download');
    },
  };
  const manager = new MedalJobManager(provider, {
    config: { tempDir, maxConcurrentJobs: 1 },
    probeFile: async () => videoInfo,
  });

  try {
    await manager.init();
    const job = manager.createJob('127.0.0.1', CLIP_URL, true);
    await waitFor(() => manager.getJob(job.jobId)?.state === 'inspecting');
    assert.equal(await manager.cancelJob(job.jobId), true);
    await waitFor(() => manager.getJob(job.jobId)?.state === 'cancelled');
    assert.equal(manager.getJob(job.jobId)?.state, 'cancelled');
  } finally {
    await manager.stop();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('MedalJobManager cleans up a failed download', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'medal-downloader-test-'));
  const provider = {
    inspect: async (): Promise<MedalInspectionInternal> => availableInspection,
    openDownload: async (): Promise<{ response: Response; totalBytes: number }> => ({
      response: new Response(null, { status: 500 }),
      totalBytes: 0,
    }),
  };
  const manager = new MedalJobManager(provider, {
    config: { tempDir, maxConcurrentJobs: 1 },
    probeFile: async () => videoInfo,
  });

  try {
    await manager.init();
    const job = manager.createJob('127.0.0.1', CLIP_URL, true);
    await waitFor(() => manager.getJob(job.jobId)?.state === 'failed');
    const finished = manager.getJob(job.jobId)!;
    assert.equal(finished.errorCode, 'upstream_error');
    assert.equal(finished.filePath, undefined);
    await assert.rejects(fs.access(path.join(tempDir, job.jobId)));
  } finally {
    await manager.stop();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
