/** Base class for errors that map to a specific HTTP response. */
export class MedalError extends Error {
    status;
    code;
    retryAfterSec;
    constructor(message, options) {
        super(message);
        this.name = 'MedalError';
        this.status = options.status;
        this.code = options.code;
        this.retryAfterSec = options.retryAfterSec;
    }
}
export class InvalidMedalUrlError extends MedalError {
    constructor(message = 'Enter a valid Medal.tv clip link.') {
        super(message, { status: 400, code: 'invalid_url' });
        this.name = 'InvalidMedalUrlError';
    }
}
export class UnsupportedMedalUrlError extends MedalError {
    constructor(message = 'Only Medal.tv clip links in the form medal.tv/games/{game}/clips/{id} or medal.tv/clips/{id} are supported.') {
        super(message, { status: 400, code: 'unsupported_url' });
        this.name = 'UnsupportedMedalUrlError';
    }
}
export class MedalClipNotFoundError extends MedalError {
    constructor(message = 'This Medal clip was not found or is no longer public.') {
        super(message, { status: 404, code: 'clip_not_found' });
        this.name = 'MedalClipNotFoundError';
    }
}
export class MedalRateLimitedError extends MedalError {
    constructor(retryAfterSec = 60, message = 'Medal is rate-limiting this server. Please try again shortly.') {
        super(message, {
            status: 429,
            code: 'rate_limited',
            retryAfterSec: Math.max(1, Math.round(retryAfterSec)),
        });
        this.name = 'MedalRateLimitedError';
    }
}
export class MedalUpstreamError extends MedalError {
    constructor(message = 'Medal.tv could not be reached. Please try again shortly.') {
        super(message, { status: 502, code: 'upstream_error' });
        this.name = 'MedalUpstreamError';
    }
}
export class MedalFileTooLargeError extends MedalError {
    constructor(message = 'This clip is larger than the download limit for this tool.') {
        super(message, { status: 413, code: 'file_too_large' });
        this.name = 'MedalFileTooLargeError';
    }
}
export class MedalQueueFullError extends MedalError {
    constructor(message = 'The Medal download queue is full. Please try again shortly.') {
        super(message, { status: 503, code: 'queue_full' });
        this.name = 'MedalQueueFullError';
    }
}
export class MedalAuthorizationRequiredError extends MedalError {
    constructor(message = 'Confirm that you own this clip or have permission to download it before continuing.') {
        super(message, { status: 400, code: 'authorization_required' });
        this.name = 'MedalAuthorizationRequiredError';
    }
}
