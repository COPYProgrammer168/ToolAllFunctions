import fs from 'node:fs';
import path from 'node:path';
import type { StreamCredentials } from '../services/StreamCredentials.js';
import { buildStreamHeaders } from '../services/StreamCredentials.js';
import { streamDownloadToFile } from './streamRange.js';

/**
 * Shell-free remote download.
 *
 * The previous implementation shelled out to `curl.exe`, which only exists on
 * Windows — every muxed download (YouTube adaptive streams, TikTok audio) failed
 * on Render's Linux hosts with "curl.exe: command not found". It also interpolated
 * untrusted URLs straight into a shell command.
 *
 * This uses `fetch` + stream piping instead, forwards HTTP Range so downloads can
 * resume, and attaches the platform credentials recorded during analysis.
 */
export async function downloadToFile(
  remoteUrl: string,
  destination: string,
  options: {
    credentials?: StreamCredentials;
    headers?: Record<string, string>;
    timeoutMs?: number;
    startByte?: number;
    onProgress?: (receivedBytes: number, totalBytes: number) => void;
  } = {}
): Promise<{ bytes: number; contentType?: string }> {
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });

  const headers = buildStreamHeaders(remoteUrl, options.headers || {});
  if (options.credentials) {
    if (options.credentials.cookie) headers.Cookie = options.credentials.cookie;
    if (options.credentials.referer) headers.Referer = options.credentials.referer;
    if (options.credentials.origin) headers.Origin = options.credentials.origin;
    if (options.credentials.userAgent) headers['User-Agent'] = options.credentials.userAgent;
    if (options.credentials.headers) Object.assign(headers, options.credentials.headers);
  }

  const controller = new AbortController();
  const timer = options.timeoutMs
    ? setTimeout(() => controller.abort(), options.timeoutMs)
    : null;

  try {
    const result = await streamDownloadToFile(remoteUrl, destination, {
      headers,
      startByte: options.startByte,
      signal: controller.signal,
      onProgress: options.onProgress,
    });

    const stat = await fs.promises.stat(destination);
    return { bytes: stat.size, contentType: result.contentType };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
