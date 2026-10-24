import { isAllowedMedalCdnUrl } from './url.js';
function cleanText(value, maxLength = 300) {
    if (typeof value !== 'string')
        return undefined;
    const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!cleaned)
        return undefined;
    return cleaned.slice(0, maxLength);
}
function firstString(value) {
    if (typeof value === 'string')
        return value;
    if (Array.isArray(value)) {
        for (const entry of value) {
            const found = firstString(entry);
            if (found)
                return found;
        }
    }
    if (value && typeof value === 'object') {
        const record = value;
        return firstString(record.url) || firstString(record.contentUrl) || firstString(record.name);
    }
    return undefined;
}
function entityDecode(value) {
    const named = {
        amp: '&',
        quot: '"',
        apos: "'",
        lt: '<',
        gt: '>',
        nbsp: ' ',
    };
    return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code) => {
        if (code[0] === '#') {
            const hex = code[1]?.toLowerCase() === 'x';
            const parsed = parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
            if (Number.isFinite(parsed) && parsed > 0 && parsed <= 0x10ffff) {
                try {
                    return String.fromCodePoint(parsed);
                }
                catch {
                    return match;
                }
            }
            return match;
        }
        return named[code.toLowerCase()] ?? match;
    });
}
function parseIsoDuration(value) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0)
        return value;
    if (typeof value !== 'string')
        return undefined;
    const match = value.trim().match(/^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
    if (!match)
        return undefined;
    const days = Number(match[1] || 0);
    const hours = Number(match[2] || 0);
    const minutes = Number(match[3] || 0);
    const seconds = Number(match[4] || 0);
    const total = days * 86400 + hours * 3600 + minutes * 60 + seconds;
    return Number.isFinite(total) && total > 0 && total < 43200 ? total : undefined;
}
function parseUploadDate(value) {
    if (typeof value !== 'string' || value.length > 80)
        return undefined;
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
        return undefined;
    const year = date.getUTCFullYear();
    if (year < 2000 || year > 2100)
        return undefined;
    return date.toISOString();
}
function isVideoObject(node) {
    const type = node['@type'];
    if (type === 'VideoObject')
        return true;
    return Array.isArray(type) && type.includes('VideoObject');
}
function findVideoObject(node, depth = 0) {
    if (depth > 6 || node === null || typeof node !== 'object')
        return null;
    if (Array.isArray(node)) {
        for (const entry of node) {
            const found = findVideoObject(entry, depth + 1);
            if (found)
                return found;
        }
        return null;
    }
    const record = node;
    if (isVideoObject(record))
        return record;
    for (const value of Object.values(record)) {
        const found = findVideoObject(value, depth + 1);
        if (found)
            return found;
    }
    return null;
}
/** Extracts public schema.org VideoObject metadata from a Medal clip page. */
export function parseClipPage(html) {
    let video = null;
    const scriptPattern = /<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    for (const match of html.matchAll(scriptPattern)) {
        try {
            const parsed = JSON.parse(match[1]);
            video = findVideoObject(parsed);
            if (video)
                break;
        }
        catch {
            // A page may carry unrelated or malformed JSON-LD blocks; keep looking.
        }
    }
    // Public page metadata supplies the game name; the JSON-LD object only has
    // free-form keywords. Reading <title>/og:title is not authentication bypass.
    const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    const metaTags = {};
    for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
        const attrs = {};
        for (const attr of tag[0].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
            attrs[attr[1].toLowerCase()] = attr[2] ?? attr[3] ?? attr[4] ?? '';
        }
        const key = (attrs.property || attrs.name || '').toLowerCase();
        if (key && attrs.content)
            metaTags[key] = entityDecode(attrs.content);
    }
    const readableTitle = titleTag ? entityDecode(titleTag) : '';
    const ogTitle = metaTags['og:title'] || '';
    const description = metaTags['description'] || metaTags['og:description'] || '';
    const searchableTitles = [ogTitle, readableTitle, description];
    let gameName;
    for (const text of searchableTitles) {
        const match = text.match(/\bClipped\s+(.+?)\s+with\s+Medal(?:\.tv)?/i) ||
            text.match(/\bother\s+(.+?)\s+videos\s+on\s+Medal/i);
        if (match) {
            gameName = cleanText(match[1], 120);
            if (gameName)
                break;
        }
    }
    const title = cleanText(video?.name) ||
        cleanText(ogTitle?.replace(/\s+-\s+Clipped\b.*$/i, '')) ||
        cleanText(readableTitle?.replace(/\s+-\s+Clipped\b.*$/i, '')) ||
        'Medal clip';
    let creator;
    const author = video?.author;
    if (typeof author === 'string')
        creator = cleanText(author, 120);
    else if (Array.isArray(author))
        creator = cleanText(firstString(author), 120);
    else if (author && typeof author === 'object') {
        creator = cleanText(author.name, 120);
    }
    const rawContentUrl = firstString(video?.contentUrl);
    const contentUrl = rawContentUrl && isAllowedMedalCdnUrl(rawContentUrl) ? rawContentUrl : undefined;
    const contentUrlRejected = Boolean(rawContentUrl && !contentUrl);
    const rawThumbnail = firstString(video?.thumbnailUrl) || firstString(video?.thumbnail);
    const thumbnailUrl = rawThumbnail && isAllowedMedalCdnUrl(rawThumbnail) ? rawThumbnail : undefined;
    let schemaGameSlug;
    const schemaId = typeof video?.['@id'] === 'string' ? video['@id'] : undefined;
    if (schemaId) {
        try {
            const schemaUrl = new URL(schemaId);
            if (schemaUrl.protocol === 'https:' && schemaUrl.hostname.toLowerCase() === 'medal.tv') {
                const parts = schemaUrl.pathname.split('/').filter(Boolean);
                if (parts.length === 4 && parts[0] === 'games' && parts[2] === 'clips') {
                    schemaGameSlug = parts[1].toLowerCase();
                }
            }
        }
        catch {
            // @id is optional metadata.
        }
    }
    if (!gameName && schemaGameSlug) {
        gameName = schemaGameSlug
            .split('-')
            .filter(Boolean)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' ');
    }
    return {
        title,
        creator,
        gameName,
        schemaGameSlug,
        durationSeconds: parseIsoDuration(video?.duration),
        thumbnailUrl,
        uploadedAt: parseUploadDate(video?.uploadDate),
        contentUrl,
        contentUrlRejected,
    };
}
