import { ProxyAgent, fetch as undiciFetch } from 'undici';

/**
 * Optional outbound proxy support.
 *
 * TikTok (SlardarWAF) and YouTube both reject / throttle cloud-datacenter IPs:
 * TikTok answers plain fetches with a WAF challenge or "Your IP address is
 * blocked", YouTube answers bursts with 429s. Neither can be fixed by code —
 * they need requests to come from a different IP. Setting `TT_PROXY`
 * (or `HTTPS_PROXY`/`HTTP_PROXY`) to `http://host:port` makes every provider
 * fetch and every yt-dlp invocation go through that proxy instead.
 */

export interface ProxyConfig {
  url: string;
  agent: ProxyAgent;
}

let cachedConfig: ProxyConfig | null | undefined;

/** Resolves the configured proxy — `null` when none is set (the normal case). */
export function getProxy(): ProxyConfig | null {
  if (cachedConfig !== undefined) return cachedConfig;

  const url =
    process.env.TT_PROXY ||
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    '';

  // `TT_PROXY=none` (or 0/false) skips the standard env fallbacks entirely.
  const disabled = /^(none|0|false|off)$/i.test((process.env.TT_PROXY ?? '').trim());
  if (!url || disabled) {
    cachedConfig = null;
    return cachedConfig;
  }

  try {
    cachedConfig = { url, agent: new ProxyAgent(url) };
    console.log(`[proxy] Outbound platform requests go through ${url}`);
  } catch (err) {
    console.error('[proxy] Failed to build proxy agent — proceeding without proxy:', (err as Error).message);
    cachedConfig = null;
  }
  return cachedConfig;
}

export function hasProxy(): boolean {
  return getProxy() !== null;
}

/**
 * `fetch` that rides the configured proxy when one exists, otherwise a plain
 * global `fetch`. Uses undici's own `fetch` + `dispatcher` so the agent and
 * fetch share the same undici implementation (mixing the npm package's agent
 * with Node's built-in fetch is not supported).
 */
export async function proxiedFetch(
  url: string,
  init: RequestInit = {}
): Promise<Response> {
  const proxy = getProxy();
  if (!proxy) {
    return fetch(url, init);
  }
  const initAny: any = { ...init, dispatcher: proxy.agent };
  return undiciFetch(url, initAny) as unknown as Promise<Response>;
}

/** Extra yt-dlp CLI args that route through the configured proxy. */
export function ytdlpProxyArgs(): string[] {
  const proxy = getProxy();
  return proxy ? ['--proxy', proxy.url] : [];
}
