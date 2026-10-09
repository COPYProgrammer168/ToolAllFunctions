/**
 * Error types that carry an HTTP status so the API layer can translate them
 * into a proper response instead of a generic 400/500.
 */
/**
 * The remote platform is rate-limiting us (HTTP 429). The API layer answers
 * `503 Service Unavailable` for these so the client knows it is transient and
 * can retry later, instead of showing "this video cannot be downloaded".
 */
export class RateLimitedError extends Error {
    retryAfterSec;
    status = 503;
    /** True when retrying the same request later may succeed. */
    retryable = true;
    constructor(message, 
    /** Seconds the remote server asked us to wait (`Retry-After`), if any. */
    retryAfterSec) {
        super(message);
        this.retryAfterSec = retryAfterSec;
        this.name = 'RateLimitedError';
    }
}
