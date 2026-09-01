export interface UpstreamRetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  maxElapsedMs?: number;
  signal?: AbortSignal;
  canRetry?: () => boolean;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  onRetry?: (attempt: number, error: unknown) => void;
}

export interface UpstreamRetryResult<T> {
  value: T;
  attempts: number;
}

export interface UpstreamResponseRetryOptions {
  maxAttempts?: number | undefined;
  baseDelayMs?: number | undefined;
  maxDelayMs?: number | undefined;
  maxElapsedMs?: number | undefined;
  signal?: AbortSignal | undefined;
  canRetry?: (() => boolean) | undefined;
  shouldRetryStatus?: ((status: number, attempt: number) => boolean) | undefined;
  shouldRetryError?: ((error: unknown, attempt: number) => boolean) | undefined;
  onRetry?:
    | ((info: {
        attempt: number;
        status?: number;
        error?: unknown;
        delayMs: number;
      }) => void)
    | undefined;
}

export const DEFAULT_UPSTREAM_RETRY = {
  maxAttempts: 5,
  baseDelayMs: 300,
  maxDelayMs: 3000,
  maxElapsedMs: 10_000,
} as const;

/** Gateway same-route budgets: 429 often needs longer than bridge defaults. */
export const GATEWAY_UPSTREAM_RETRY = {
  maxAttempts: 5,
  baseDelayMs: 300,
  maxDelayMs: 30_000,
  maxElapsedMs: 60_000,
} as const;

export function retryBackoffDelay(
  attempt: number,
  baseDelayMs: number = DEFAULT_UPSTREAM_RETRY.baseDelayMs,
  maxDelayMs: number = DEFAULT_UPSTREAM_RETRY.maxDelayMs,
): number {
  if (attempt <= 0) {
    return baseDelayMs;
  }
  const delay = baseDelayMs * 2 ** (attempt - 1);
  return Math.min(delay, maxDelayMs);
}

export function shouldFailoverUpstreamError(status: number): boolean {
  switch (status) {
    case 401:
    case 403:
    case 429:
    case 529:
      return true;
    default:
      return status >= 500;
  }
}

/** Same-route transient statuses (excludes auth 401/403). */
export function isTransientUpstreamHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 529 || status >= 500;
}

export function isRetryableNetworkError(error: unknown): boolean {
  const text = errorMessage(error).toLowerCase();
  if (!text) {
    return false;
  }
  return (
    text.includes('econnreset') ||
    text.includes('econnrefused') ||
    text.includes('etimedout') ||
    text.includes('fetch failed') ||
    text.includes('network') ||
    text.includes('socket hang up') ||
    text.includes('terminated')
  );
}

/** @deprecated Prefer isTransientUpstreamHttpStatus for same-route retry. */
export function isRetryableUpstreamHttpStatus(status: number): boolean {
  return shouldFailoverUpstreamError(status) || status === 408;
}

/**
 * Parse Retry-After header (delta-seconds or HTTP-date) to milliseconds.
 * Returns undefined when missing/invalid; clamps negative to 0.
 */
export function parseRetryAfterMs(
  headerValue: string | null | undefined,
  nowMs: number = Date.now(),
): number | undefined {
  if (headerValue === null || headerValue === undefined) {
    return undefined;
  }
  const trimmed = headerValue.trim();
  if (!trimmed) {
    return undefined;
  }
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (!Number.isFinite(seconds)) {
      return undefined;
    }
    return Math.max(0, Math.round(seconds * 1000));
  }
  const when = Date.parse(trimmed);
  if (Number.isNaN(when)) {
    return undefined;
  }
  return Math.max(0, when - nowMs);
}

export function upstreamRetryDelayMs(input: {
  attempt: number;
  retryAfterHeader?: string | null;
  baseDelayMs?: number;
  maxDelayMs?: number;
  nowMs?: number;
}): number {
  const maxDelayMs = input.maxDelayMs ?? DEFAULT_UPSTREAM_RETRY.maxDelayMs;
  const fromHeader = parseRetryAfterMs(input.retryAfterHeader, input.nowMs);
  if (fromHeader !== undefined) {
    return Math.min(fromHeader, maxDelayMs);
  }
  return retryBackoffDelay(input.attempt, input.baseDelayMs, maxDelayMs);
}

export async function runWithUpstreamRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options?: UpstreamRetryOptions,
): Promise<UpstreamRetryResult<T>> {
  const maxAttempts = options?.maxAttempts ?? DEFAULT_UPSTREAM_RETRY.maxAttempts;
  const maxElapsedMs = options?.maxElapsedMs ?? DEFAULT_UPSTREAM_RETRY.maxElapsedMs;
  const started = Date.now();
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (options?.signal?.aborted) {
      throw options.signal.reason ?? new Error('Aborted');
    }
    if (options?.canRetry !== undefined && attempt > 1 && !options.canRetry()) {
      break;
    }

    try {
      const value = await fn(attempt);
      return { value, attempts: attempt };
    } catch (error) {
      lastError = error;
      const shouldRetry =
        attempt < maxAttempts &&
        Date.now() - started < maxElapsedMs &&
        (options?.shouldRetry?.(error, attempt) ?? defaultShouldRetry(error));

      if (!shouldRetry) {
        throw error;
      }

      options?.onRetry?.(attempt, error);
      const delay = retryBackoffDelay(attempt, options?.baseDelayMs, options?.maxDelayMs);
      await sleepWithSignal(delay, options?.signal);
    }
  }

  throw lastError ?? new Error('Upstream retry exhausted');
}

/**
 * Retry when `fn` returns a Response with a transient HTTP status, or throws a
 * retryable network error. Non-transient responses are returned as-is.
 */
export async function runWithUpstreamResponseRetry(
  fn: (attempt: number) => Promise<Response>,
  options?: UpstreamResponseRetryOptions,
): Promise<UpstreamRetryResult<Response>> {
  const maxAttempts = options?.maxAttempts ?? DEFAULT_UPSTREAM_RETRY.maxAttempts;
  const maxElapsedMs = options?.maxElapsedMs ?? DEFAULT_UPSTREAM_RETRY.maxElapsedMs;
  const baseDelayMs = options?.baseDelayMs ?? DEFAULT_UPSTREAM_RETRY.baseDelayMs;
  const maxDelayMs = options?.maxDelayMs ?? DEFAULT_UPSTREAM_RETRY.maxDelayMs;
  const started = Date.now();
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (options?.signal?.aborted) {
      throw options.signal.reason ?? new Error('Aborted');
    }
    if (options?.canRetry !== undefined && attempt > 1 && !options.canRetry()) {
      break;
    }

    try {
      const response = await fn(attempt);
      const status = response.status;
      const shouldRetryStatus =
        options?.shouldRetryStatus?.(status, attempt) ?? isTransientUpstreamHttpStatus(status);
      const canContinue =
        attempt < maxAttempts &&
        Date.now() - started < maxElapsedMs &&
        shouldRetryStatus &&
        (options?.canRetry === undefined || options.canRetry());

      if (!canContinue) {
        return { value: response, attempts: attempt };
      }

      const delayMs = upstreamRetryDelayMs({
        attempt,
        retryAfterHeader: response.headers.get('retry-after'),
        baseDelayMs,
        maxDelayMs,
      });
      options?.onRetry?.({ attempt, status, delayMs });
      await drainResponseBody(response);
      await sleepWithSignal(delayMs, options?.signal);
    } catch (error) {
      lastError = error;
      const shouldRetryError =
        options?.shouldRetryError?.(error, attempt) ?? isRetryableNetworkError(error);
      const canContinue =
        attempt < maxAttempts &&
        Date.now() - started < maxElapsedMs &&
        shouldRetryError &&
        (options?.canRetry === undefined || options.canRetry());

      if (!canContinue) {
        throw error;
      }

      const delayMs = retryBackoffDelay(attempt, baseDelayMs, maxDelayMs);
      options?.onRetry?.({ attempt, error, delayMs });
      await sleepWithSignal(delayMs, options?.signal);
    }
  }

  throw lastError ?? new Error('Upstream retry exhausted');
}

function defaultShouldRetry(error: unknown): boolean {
  if (isRetryableNetworkError(error)) {
    return true;
  }
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status: number }).status;
    return isTransientUpstreamHttpStatus(status);
  }
  return false;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function drainResponseBody(response: Response): Promise<void> {
  try {
    await response.arrayBuffer();
  } catch {
    // Body may already be locked/consumed; ignore.
  }
}

async function sleepWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(signal?.reason ?? new Error('Aborted'));
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
