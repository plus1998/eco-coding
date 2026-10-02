import { GATEWAY_UPSTREAM_RETRY, runWithUpstreamResponseRetry } from "@eco/openai-anthropic-bridge";
import { fetchWithRequestLifecycle, type RequestLifecycleContext } from "../request-lifecycle.js";
import type { GatewayLogFn } from "../server.js";
import { UPSTREAM_PROXY_URL } from "../upstream-proxy.js";

export interface FetchUpstreamWithRetryOptions {
  fetchImpl: typeof fetch;
  url: string;
  init: RequestInit;
  lifecycle?: RequestLifecycleContext | undefined;
  onLog?: GatewayLogFn | undefined;
  signal?: AbortSignal | undefined;
  maxAttempts?: number | undefined;
  baseDelayMs?: number | undefined;
  maxDelayMs?: number | undefined;
  maxElapsedMs?: number | undefined;
  /** Optional account-level proxy selected after credential resolution. */
  upstreamProxyUrl?: string | undefined;
}

/**
 * Same-route upstream fetch with transient HTTP / network retries before any
 * client body is written. Uses lifecycle attemptIndex when provided.
 */
export async function fetchUpstreamWithRetry(options: FetchUpstreamWithRetryOptions): Promise<Response> {
  const {
    fetchImpl,
    url,
    init,
    lifecycle,
    onLog = () => undefined,
    signal,
    maxAttempts = GATEWAY_UPSTREAM_RETRY.maxAttempts,
    baseDelayMs = GATEWAY_UPSTREAM_RETRY.baseDelayMs,
    maxDelayMs = GATEWAY_UPSTREAM_RETRY.maxDelayMs,
    maxElapsedMs = GATEWAY_UPSTREAM_RETRY.maxElapsedMs,
  } = options;

  const requestInit = {
    ...(signal ? { ...init, signal } : init),
    ...(options.upstreamProxyUrl ? { [UPSTREAM_PROXY_URL]: options.upstreamProxyUrl } : {}),
  } as RequestInit;

  const { value } = await runWithUpstreamResponseRetry(
    async () => {
      if (lifecycle) {
        return fetchWithRequestLifecycle(fetchImpl, url, requestInit, lifecycle);
      }
      return fetchImpl(url, requestInit);
    },
    {
      maxAttempts,
      baseDelayMs,
      maxDelayMs,
      maxElapsedMs,
      signal,
      onRetry: ({ attempt, status, error, delayMs }) => {
        if (status !== undefined) {
          onLog(`upstream retry attempt=${attempt} status=${status} delayMs=${delayMs} url=${url}`);
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        onLog(`upstream retry attempt=${attempt} transport=${message} delayMs=${delayMs} url=${url}`);
      },
    },
  );

  return value;
}
