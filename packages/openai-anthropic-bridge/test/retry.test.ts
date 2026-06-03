import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_UPSTREAM_RETRY,
  retryBackoffDelay,
  runWithUpstreamRetry,
  shouldFailoverUpstreamError,
} from '../src/retry.js';

describe('retry', () => {
  test('shouldFailoverUpstreamError', () => {
    expect(shouldFailoverUpstreamError(401)).toBe(true);
    expect(shouldFailoverUpstreamError(429)).toBe(true);
    expect(shouldFailoverUpstreamError(500)).toBe(true);
    expect(shouldFailoverUpstreamError(400)).toBe(false);
  });

  test('retryBackoffDelay caps at max', () => {
    expect(retryBackoffDelay(1)).toBe(DEFAULT_UPSTREAM_RETRY.baseDelayMs);
    expect(retryBackoffDelay(10)).toBe(DEFAULT_UPSTREAM_RETRY.maxDelayMs);
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
});
