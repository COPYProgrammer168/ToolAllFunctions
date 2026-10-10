/** Last time the store was swept of expired buckets. */
let lastSweep = 0;
function sweep(buckets, now) {
    // Sweep at most once per window so the cleanup cost stays negligible.
    if (now - lastSweep < 60_000)
        return;
    lastSweep = now;
    for (const [key, bucket] of buckets) {
        if (bucket.resetAt <= now)
            buckets.delete(key);
    }
}
/** Best-effort client identity: proxy header first, socket address fallback. */
function clientKey(req) {
    const forwarded = req.headers?.['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
        return forwarded.split(',')[0].trim();
    }
    return req.socket?.remoteAddress || req.ip || 'unknown';
}
export function rateLimit(options) {
    const { windowMs, max, label = 'rate-limit' } = options;
    const buckets = new Map();
    return (req, res, next) => {
        const now = Date.now();
        sweep(buckets, now);
        const key = clientKey(req);
        const bucket = buckets.get(key);
        if (!bucket || bucket.resetAt <= now) {
            buckets.set(key, { count: 1, resetAt: now + windowMs });
            next();
            return;
        }
        bucket.count += 1;
        if (bucket.count > max) {
            const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
            console.warn(`[${label}] IP ${key} exceeded ${max} req/${Math.round(windowMs / 1000)}s — blocked for ${retryAfterSec}s`);
            res.setHeader('Retry-After', String(retryAfterSec));
            res.status(429).json({
                error: 'rate_limited',
                message: `Too many requests. Try again in ${retryAfterSec} seconds.`,
                retry_after: retryAfterSec,
            });
            return;
        }
        next();
    };
}
