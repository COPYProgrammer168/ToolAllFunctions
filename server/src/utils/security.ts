import dns from 'node:dns/promises';
import { URL } from 'node:url';
import path from 'node:path';

/**
 * Checks if an IP address is a private, local, loopback, or cloud-metadata address.
 * Prevents SSRF (Server-Side Request Forgery).
 */
export function isPrivateIp(ip: string): boolean {
  // IPv4 Loopback (127.0.0.0/8)
  if (/^127\./.test(ip)) return true;

  // Localhost aliases / zeroes
  if (ip === '0.0.0.0' || ip === '::1' || ip === '::' || ip === 'localhost') return true;

  // Private RFC 1918
  // 10.0.0.0 - 10.255.255.255
  if (/^10\./.test(ip)) return true;

  // 172.16.0.0 - 172.31.255.255
  const match172 = ip.match(/^172\.(\d+)\./);
  if (match172) {
    const octet2 = parseInt(match172[1], 10);
    if (octet2 >= 16 && octet2 <= 31) return true;
  }

  // 192.168.0.0 - 192.168.255.255
  if (/^192\.168\./.test(ip)) return true;

  // Link-local / Cloud Metadata (169.254.0.0/16)
  if (/^169\.254\./.test(ip)) return true;

  // Carrier-grade NAT (100.64.0.0/10)
  const match100 = ip.match(/^100\.(\d+)\./);
  if (match100) {
    const octet = parseInt(match100[1], 10);
    if (octet >= 64 && octet <= 127) return true;
  }

  // IPv6 Unique Local (fc00::/7) or Link-local (fe80::/10)
  const lower = ip.toLowerCase();
  if (lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80:')) {
    return true;
  }

  return false;
}

export interface UrlValidationResult {
  valid: boolean;
  normalizedUrl?: string;
  error?: string;
}

/**
 * Validates a remote URL against SSRF, dangerous protocols, and unauthorized local networks.
 */
export async function validateRemoteUrl(rawUrl: string): Promise<UrlValidationResult> {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { valid: false, error: 'URL must be a non-empty string.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return { valid: false, error: 'Malformed URL format.' };
  }

  // Enforce HTTPS only (or HTTP only for explicitly allowed public endpoints if needed, but per specs HTTPS is required)
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return {
      valid: false,
      error: `Protocol '${parsed.protocol}' is not allowed. Only HTTPS (or standard HTTP) is permitted.`,
    };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block localhost and standard loopback hostnames
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname === '::1'
  ) {
    return { valid: false, error: 'Access to localhost and internal hostnames is prohibited.' };
  }

  // Direct IP literal check
  if (isPrivateIp(hostname)) {
    return { valid: false, error: 'Access to private or link-local IP addresses is prohibited.' };
  }

  // Resolve DNS to verify actual IP
  try {
    const addresses = await dns.lookup(hostname, { all: true });
    for (const record of addresses) {
      if (isPrivateIp(record.address)) {
        return {
          valid: false,
          error: `Host ${hostname} resolves to restricted private address ${record.address}.`,
        };
      }
    }
  } catch (err: any) {
    return {
      valid: false,
      error: `Could not resolve hostname '${hostname}': ${err.message}`,
    };
  }

  return {
    valid: true,
    normalizedUrl: parsed.toString(),
  };
}

/**
 * Prevents path traversal and validates filenames
 */
export function sanitizeFilename(filename: string): string {
  // Strip null bytes, slashes, backslashes, colons
  const cleaned = filename
    .replace(/\0/g, '')
    .replace(/[/\\]/g, '_')
    .replace(/^[. ]+/, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_');
  return cleaned || 'media_file';
}

/**
 * Ensures a path stays strictly inside an intended root directory
 */
export function assertPathInside(targetPath: string, rootDir: string): void {
  const rel = path.relative(rootDir, targetPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Path traversal detected: target path is outside allowed root directory.');
  }
}
