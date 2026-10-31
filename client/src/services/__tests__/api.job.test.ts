import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOptimizationJob, JobStartError } from '../api';

const MIB = 1024 * 1024;

function videoFile(sizeBytes: number, name = 'clip.mp4'): File {
  return new File([new Uint8Array(sizeBytes)], name, { type: 'video/mp4' });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface FetchCall {
  url: string;
  body: FormData;
}

function installFetch(
  handler: (call: FetchCall, index: number) => Response | Promise<Response>
): { calls: FetchCall[]; mock: ReturnType<typeof vi.fn> } {
  const calls: FetchCall[] = [];
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), body: init?.body as FormData };
    calls.push(call);
    return handler(call, calls.length - 1);
  });
  vi.stubGlobal('fetch', mock);
  return { calls, mock };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('createOptimizationJob', () => {
  it('uploads a small file directly with the job request', async () => {
    const { calls } = installFetch(() => jsonResponse({ jobId: 'job-small' }));

    const result = await createOptimizationJob({
      file: videoFile(1 * MIB),
      originalName: 'clip.mp4',
      config: { preset: 'tiktok' },
    });

    expect(result).toEqual({ jobId: 'job-small' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/jobs');
    expect(calls[0].body.get('video')).toBeInstanceOf(File);
    expect(calls[0].body.get('tempPath')).toBeNull();
  });

  it('uploads large files in chunks, reports progress, and passes tempPath', async () => {
    const progress: number[] = [];
    const { calls } = installFetch((call) => {
      if (call.url === '/api/media/upload-chunk') {
        const index = Number(call.body.get('chunkIndex'));
        const total = Number(call.body.get('totalChunks'));
        return jsonResponse(
          index === total - 1
            ? {
                completed: true,
                tempPath: '/tmp/uploads/assembled.mp4',
                originalName: 'clip.mp4',
                sizeBytes: 7 * MIB,
              }
            : { completed: false, chunkIndex: index }
        );
      }
      return jsonResponse({ jobId: 'job-large' });
    });

    const result = await createOptimizationJob({
      file: videoFile(7 * MIB),
      originalName: 'clip.mp4',
      config: { preset: 'tiktok' },
      onUploadProgress: (percent) => progress.push(percent),
    });

    expect(result).toEqual({ jobId: 'job-large' });
    const chunkCalls = calls.filter((c) => c.url === '/api/media/upload-chunk');
    expect(chunkCalls).toHaveLength(3);
    expect(progress).toEqual([33, 67, 100]);

    const jobCall = calls.at(-1)!;
    expect(jobCall.url).toBe('/api/jobs');
    expect(jobCall.body.get('video')).toBeNull();
    expect(jobCall.body.get('tempPath')).toBe('/tmp/uploads/assembled.mp4');
  });

  it('retries the upload once when the server reports UPLOAD_EXPIRED', async () => {
    let jobAttempts = 0;
    const { calls } = installFetch((call) => {
      if (call.url === '/api/media/upload-chunk') {
        const index = Number(call.body.get('chunkIndex'));
        const total = Number(call.body.get('totalChunks'));
        return jsonResponse(
          index === total - 1
            ? {
                completed: true,
                tempPath: `/tmp/uploads/assembled-${index}.mp4`,
                originalName: 'clip.mp4',
                sizeBytes: 5 * MIB,
              }
            : { completed: false, chunkIndex: index }
        );
      }

      jobAttempts += 1;
      if (jobAttempts === 1) {
        return jsonResponse(
          {
            error: 'The uploaded video is no longer available on this server.',
            code: 'UPLOAD_EXPIRED',
          },
          410
        );
      }
      return jsonResponse({ jobId: 'job-retried' });
    });

    const result = await createOptimizationJob({
      file: videoFile(5 * MIB),
      originalName: 'clip.mp4',
      config: {},
    });

    expect(result).toEqual({ jobId: 'job-retried' });
    expect(jobAttempts).toBe(2);
    expect(calls.filter((c) => c.url === '/api/media/upload-chunk')).toHaveLength(4);
  });

  it('retries the chunked upload once when a chunk is reported missing during assembly', async () => {
    let finalChunkAttempts = 0;
    const { calls } = installFetch((call) => {
      if (call.url === '/api/media/upload-chunk') {
        const index = Number(call.body.get('chunkIndex'));
        const total = Number(call.body.get('totalChunks'));
        if (index === total - 1) {
          finalChunkAttempts += 1;
          if (finalChunkAttempts === 1) {
            return jsonResponse(
              { error: 'Chunk part 1/2 is missing or expired.', code: 'CHUNK_MISSING' },
              400
            );
          }
          return jsonResponse({
            completed: true,
            tempPath: '/tmp/uploads/assembled-clean.mp4',
            originalName: 'clip.mp4',
            sizeBytes: 5 * MIB,
          });
        }
        return jsonResponse({ completed: false, chunkIndex: index });
      }
      return jsonResponse({ jobId: 'job-chunk-retried' });
    });

    const result = await createOptimizationJob({
      file: videoFile(5 * MIB),
      originalName: 'clip.mp4',
      config: {},
    });

    expect(result).toEqual({ jobId: 'job-chunk-retried' });
    expect(finalChunkAttempts).toBe(2);
    expect(calls.filter((c) => c.url === '/api/media/upload-chunk')).toHaveLength(4);
  });

  it('does not retry UPLOAD_EXPIRED for a server-side tempPath', async () => {
    const { calls } = installFetch(() =>
      jsonResponse({ error: 'Upload expired', code: 'UPLOAD_EXPIRED' }, 410)
    );

    await expect(
      createOptimizationJob({
        tempPath: '/tmp/uploads/existing.mp4',
        originalName: 'clip.mp4',
        config: {},
      })
    ).rejects.toMatchObject({ status: 410, code: 'UPLOAD_EXPIRED' });

    expect(calls).toHaveLength(1);
  });

  it('keeps the technical error for display', async () => {
    installFetch(() =>
      jsonResponse(
        {
          error: 'Failed to create optimization job',
          technicalError: 'ENOENT: source file missing',
        },
        500
      )
    );

    const error = await createOptimizationJob({
      file: videoFile(1 * MIB),
      originalName: 'clip.mp4',
      config: {},
    }).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(JobStartError);
    expect(error).toMatchObject({
      message: 'Failed to create optimization job',
      status: 500,
      technicalError: 'ENOENT: source file missing',
    });
  });
});
