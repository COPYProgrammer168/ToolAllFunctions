import { URL } from 'node:url';
import { InvalidMedalUrlError, UnsupportedMedalUrlError } from './errors.js';
const PAGE_HOSTS = new Set(['medal.tv', 'www.medal.tv']);
const MEDIA_HOSTS = new Set(['cdn.medal.tv']);
const CLIP_ID_PATTERN = /^[A-Za-z0-9_-]{6,64}$/;
const GAME_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const INVITE_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;
const MAX_URL_LENGTH = 2048;
export function prettifyGameSlug(slug) {
    if (!slug)
        return undefined;
    return slug
        .split('-')
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}
/**
 * Strict parser for public Medal clip links.
 *
 * Accepted forms (HTTPS only, exact Medal hosts):
 *   https://medal.tv/games/{game}/clips/{clipId}
 *   https://www.medal.tv/games/{game}/clips/{clipId}
 *   https://medal.tv/clips/{clipId}
 *   https://www.medal.tv/clips/{clipId}
 *
 * Any query string is discarded except a simple `invite` token. Fragments,
 * credentials, non-default ports, lookalike domains and arbitrary media URLs
 * are rejected; nothing supplied by the caller is ever fetched directly.
 */
export function parseMedalClipUrl(raw) {
    if (typeof raw !== 'string') {
        throw new InvalidMedalUrlError('A Medal.tv clip URL is required.');
    }
    const trimmed = raw.trim();
    if (!trimmed || trimmed.length > MAX_URL_LENGTH) {
        throw new InvalidMedalUrlError();
    }
    let parsed;
    try {
        parsed = new URL(trimmed);
    }
    catch {
        throw new InvalidMedalUrlError();
    }
    if (parsed.protocol !== 'https:') {
        throw new InvalidMedalUrlError('Only HTTPS Medal.tv clip links are accepted.');
    }
    if (parsed.username || parsed.password) {
        throw new InvalidMedalUrlError('Medal.tv links containing credentials are not accepted.');
    }
    if (parsed.port) {
        throw new InvalidMedalUrlError('Non-standard ports are not accepted on Medal.tv links.');
    }
    const hostname = parsed.hostname.toLowerCase();
    if (!PAGE_HOSTS.has(hostname)) {
        throw new InvalidMedalUrlError('Only exact medal.tv clip links are accepted.');
    }
    const parts = parsed.pathname.split('/').filter(Boolean);
    let gameSlug;
    let clipId;
    if (parts.length === 4 && parts[0] === 'games' && parts[2] === 'clips') {
        gameSlug = parts[1].toLowerCase();
        clipId = parts[3];
        if (!GAME_SLUG_PATTERN.test(gameSlug)) {
            throw new InvalidMedalUrlError('The game name in this Medal.tv link is not valid.');
        }
    }
    else if (parts.length === 2 && parts[0] === 'clips') {
        clipId = parts[1];
    }
    else {
        throw new UnsupportedMedalUrlError();
    }
    if (!clipId || !CLIP_ID_PATTERN.test(clipId)) {
        throw new InvalidMedalUrlError('The clip ID in this Medal.tv link is not valid.');
    }
    const path = gameSlug ? `/games/${gameSlug}/clips/${clipId}` : `/clips/${clipId}`;
    const canonicalUrl = `https://medal.tv${path}`;
    // Do not forward arbitrary query parameters to Medal. A referral invite is
    // the only one the exact public link form needs.
    const invite = parsed.searchParams.get('invite');
    const requestUrl = invite && INVITE_PATTERN.test(invite)
        ? `${canonicalUrl}?invite=${encodeURIComponent(invite)}`
        : canonicalUrl;
    return { clipId, gameSlug, canonicalUrl, requestUrl };
}
/** True when `raw` is a signed HTTPS asset URL hosted on Medal's media CDN. */
export function isAllowedMedalCdnUrl(raw) {
    if (typeof raw !== 'string' || !raw || raw.length > MAX_URL_LENGTH)
        return false;
    let parsed;
    try {
        parsed = new URL(raw);
    }
    catch {
        return false;
    }
    return (parsed.protocol === 'https:' &&
        !parsed.username &&
        !parsed.password &&
        !parsed.port &&
        MEDIA_HOSTS.has(parsed.hostname.toLowerCase()) &&
        parsed.pathname !== '/');
}
/**
 * Checks a URL that a fetch is about to request (including redirect hops).
 * The company host allowlist is stricter than the general SSRF validator.
 */
export function assertAllowedHop(raw, kind) {
    let parsed;
    try {
        parsed = new URL(raw);
    }
    catch {
        throw new InvalidMedalUrlError('Medal returned an invalid redirect URL.');
    }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) {
        throw new InvalidMedalUrlError('Medal returned an unsafe redirect URL.');
    }
    const host = parsed.hostname.toLowerCase();
    if (kind === 'page' ? !PAGE_HOSTS.has(host) : !MEDIA_HOSTS.has(host)) {
        throw new InvalidMedalUrlError('Medal redirected to an unapproved host.');
    }
    return parsed;
}
