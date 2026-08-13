import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_UPSTREAM_RETRY,
  isTransientUpstreamHttpStatus,
  parseRetryAfterMs,
  retryBackoffDelay,
  runWithUpstreamResponseRetry,
  runWithUpstreamRetry,
  shouldFailoverUpstreamError,
  upstreamRetryDelayMs,
} from '../src/retry.js';

describe('retry', () => {
  test('shouldFailoverUpstreamError', () => {
    expect(shouldFailoverUpstreamError(401)).toBe(true);
    expect(shouldFailoverUpstreamError(429)).toBe(true);
    expect(shouldFailoverUpstreamError(500)).toBe(true);
    expect(shouldFailoverUpstreamError(400)).toBe(false);
  });

  test('isTransientUpstreamHttpStatus excludes auth', () => {
    expect(isTransientUpstreamHttpStatus(401)).toBe(false);
    expect(isTransientUpstreamHttpStatus(403)).toBe(false);
    expect(isTransientUpstreamHttpStatus(408)).toBe(true);
    expect(isTransientUpstreamHttpStatus(429)).toBe(true);
    expect(isTransientUpstreamHttpStatus(529)).toBe(true);
    expect(isTransientUpstreamHttpStatus(500)).toBe(true);
    expect(isTransientUpstreamHttpStatus(400)).toBe(false);
  });

  test('retryBackoffDelay caps at max', () => {
    expect(retryBackoffDelay(1)).toBe(DEFAULT_UPSTREAM_RETRY.baseDelayMs);
    expect(retryBackoffDelay(10)).toBe(DEFAULT_UPSTREAM_RETRY.maxDelayMs);
  });

  test('parseRetryAfterMs supports delta-seconds and HTTP-date', () => {
    expect(parseRetryAfterMs('2')).toBe(2000);
    expect(parseRetryAfterMs('0')).toBe(0);
    expect(parseRetryAfterMs(null)).toBeUndefined();
    expect(parseRetryAfterMs('')).toBeUndefined();
    const now = Date.parse('Wed, 21 Oct 2015 07:28:00 GMT');
    expect(parseRetryAfterMs('Wed, 21 Oct 2015 07:28:05 GMT', now)).toBe(5000);
    expect(parseRetryAfterMs('Wed, 21 Oct 2015 07:27:00 GMT', now)).toBe(0);
  });

  test('upstreamRetryDelayMs prefers Retry-After capped by maxDelayMs', () => {
    expect(
      upstreamRetryDelayMs({
        attempt: 1,
        retryAfterHeader: '60',
        maxDelayMs: 30_000,
      }),
    ).toBe(30_000);
    expect(
      upstreamRetryDelayMs({
        attempt: 1,
        retryAfterHeader: '1',
        baseDelayMs: 300,
        maxDelayMs: 30_000,
      }),
    ).toBe(1000);
    expect(
      upstreamRetryDelayMs({
        attempt: 1,
        baseDelayMs: 300,
        maxDelayMs: 30_000,
      }),
    ).toBe(300);
  });

  test('runWithUpstreamRetry succeeds after transient failure', async () => {
    let calls = 0;
    const { value, attempts } = await runWithUpstreamRetry(async () => {
      calls += 1;
      if (calls < 2) {
        throw new Error('fetch failed');
      }
      return 'ok';
    }, { baseDelayMs: 0, maxDelayMs: 0 });
    expect(value).toBe('ok');
    expect(attempts).toBe(2);
  });

  test('runWithUpstreamRetry does not retry 401 status errors', async () => {
    let calls = 0;
    await expect(
      runWithUpstreamRetry(
        async () => {
          calls += 1;
          const error = new Error('unauthorized') as Error & { status: number };
          error.status = 401;
          throw error;
        },
        { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0 },
      ),
    ).rejects.toThrow('unauthorized');
    expect(calls).toBe(1);
  });

  test('runWithUpstreamRetry throws when exhausted', async () => {
    await expect(
      runWithUpstreamRetry(
        async () => {
          throw new Error('fetch failed');
        },
        { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0 },
      ),
    ).rejects.toThrow('fetch failed');
  });

  test('runWithUpstreamResponseRetry succeeds after 429', async () => {
    let calls = 0;
    const { value, attempts } = await runWithUpstreamResponseRetry(
      async () => {
        calls += 1;
        if (calls === 1) {
          return new Response('rate limited', {
            status: 429,
            headers: { 'retry-after': '0' },
          });
        }
        return new Response('ok', { status: 200 });
      },
      { baseDelayMs: 0, maxDelayMs: 0, maxElapsedMs: 60_000 },
    );
    expect(value.status).toBe(200);
    expect(await value.text()).toBe('ok');
    expect(attempts).toBe(2);
    expect(calls).toBe(2);
  });

  test('runWithUpstreamResponseRetry does not retry 401', async () => {
    let calls = 0;
    const { value, attempts } = await runWithUpstreamResponseRetry(
      async () => {
        calls += 1;
        return new Response('unauthorized', { status: 401 });
      },
      { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0 },
    );
    expect(value.status).toBe(401);
    expect(attempts).toBe(1);
    expect(calls).toBe(1);
  });

  test('runWithUpstreamResponseRetry returns last 429 when exhausted', async () => {
    let calls = 0;
    const { value, attempts } = await runWithUpstreamResponseRetry(
      async () => {
        calls += 1;
        return new Response(`attempt ${calls}`, {
          status: 429,
          headers: { 'retry-after': '0' },
        });
      },
      { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0, maxElapsedMs: 60_000 },
    );
    expect(value.status).toBe(429);
    expect(await value.text()).toBe('attempt 3');
    expect(attempts).toBe(3);
    expect(calls).toBe(3);
  });
});
