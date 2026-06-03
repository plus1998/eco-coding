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

export const DEFAULT_UPSTREAM_RETRY = {
  maxAttempts: 5,
  baseDelayMs: 300,
  maxDelayMs: 3000,
  maxElapsedMs: 10_000,
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

export function isRetryableUpstreamHttpStatus(status: number): boolean {
  return shouldFailoverUpstreamError(status) || status === 408;
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

function defaultShouldRetry(error: unknown): boolean {
  if (isRetryableNetworkError(error)) {
    return true;
  }
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status: number }).status;
    return isRetryableUpstreamHttpStatus(status);
  }
  return false;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
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
