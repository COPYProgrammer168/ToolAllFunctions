/**
 * Error types that carry an HTTP status so the API layer can translate them
 * into a proper response instead of a generic 400/500.
 */

/** Default back-off suggested to the client when the platform sends no hint. */
export const DEFAULT_RATE_LIMIT_RETRY_AFTER_SEC = 60;

/**
 * The remote platform is rate-limiting us (HTTP 429).
 *
 * The API layer answers `429 Too Many Requests` with a `Retry-After` header and
 * a `rate_limited` JSON payload, so the client can show a countdown instead of
 * a generic failure. It is deliberately *not* a 503: a 503 reads like "this
 * video cannot be downloaded", while a 429 reads like "wait and try again".
 */
export class RateLimitedError extends Error {
  readonly status = 429;
  /** Machine-readable error code for the API response body. */
  readonly code = 'rate_limited';
  /** True when retrying the same request later may succeed. */
  readonly retryable = true;

  constructor(
    message: string,
    /** Seconds the remote server asked us to wait (`Retry-After`), if any. */
    readonly retryAfterSec: number = DEFAULT_RATE_LIMIT_RETRY_AFTER_SEC
  ) {
    super(message);
    this.name = 'RateLimitedError';
  }
}
