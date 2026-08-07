/**
 * Outbound HTTP/HTTPS/SOCKS5 proxy for gateway upstream fetch.
 * Host injects this fetch; does not use process-global dispatcher.
 */

export const GATEWAY_SUPPORTED_PROXY_PROTOCOLS = [
  "http:",
  "https:",
  "socks5:",
  "socks:",
] as const;

export function parseUpstreamProxyUrl(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.includes("\r") || trimmed.includes("\n")) {
    throw new Error("Upstream proxy URL must not contain newlines.");
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`Invalid upstream proxy URL: ${trimmed}`);
  }
  const protocol = url.protocol.toLowerCase();
  if (
    !GATEWAY_SUPPORTED_PROXY_PROTOCOLS.includes(
      protocol as (typeof GATEWAY_SUPPORTED_PROXY_PROTOCOLS)[number],
    )
  ) {
    throw new Error(
      `Unsupported proxy protocol '${protocol}'. Use http://, https://, socks5://, or socks://`,
    );
  }
  if (!url.hostname) {
    throw new Error(`Upstream proxy URL missing host: ${trimmed}`);
  }
  return trimmed;
}

export interface UpstreamFetchController {
  fetch: typeof fetch;
  setProxyUrl: (proxyUrl: string | undefined) => void;
  getProxyUrl: () => string | undefined;
}

type ProxiedFetchFn = (
  input: RequestInfo | URL,
  init?: RequestInit & { dispatcher?: unknown },
) => Promise<Response>;

/**
 * Mutable outbound fetch that optionally routes through undici ProxyAgent.
 * Lazy-loads undici so pure unit tests without undici still import the module.
 */
export function createUpstreamFetchController(
  initialProxyUrl?: string,
): UpstreamFetchController {
  let proxyUrl = parseUpstreamProxyUrl(initialProxyUrl);
  let dispatcher: { close?: () => void } | undefined;
  let undiciFetch: ProxiedFetchFn | undefined;
  let ProxyAgentCtor:
    | (new (url: string) => { close?: () => void })
    | undefined;

  async function ensureUndici(): Promise<void> {
    if (undiciFetch && ProxyAgentCtor) {
      return;
    }
    const undici = await import("undici");
    undiciFetch = undici.fetch as unknown as ProxiedFetchFn;
    ProxyAgentCtor = undici.ProxyAgent as unknown as new (
      url: string,
    ) => { close?: () => void };
  }

  function rebuildDispatcher(next: string | undefined): void {
    if (dispatcher && typeof dispatcher.close === "function") {
      try {
        dispatcher.close();
      } catch {
        // ignore close races
      }
    }
    dispatcher = undefined;
    if (!next || !ProxyAgentCtor) {
      return;
    }
    dispatcher = new ProxyAgentCtor(next);
  }

  const controlledFetch: typeof fetch = async (input, init) => {
    const activeProxy = proxyUrl;
    if (!activeProxy) {
      return fetch(input, init);
    }
    await ensureUndici();
    if (!dispatcher) {
      rebuildDispatcher(activeProxy);
    }
    if (!undiciFetch || !dispatcher) {
      throw new Error("Failed to initialize undici proxy fetch.");
    }
    return undiciFetch(input, {
      ...(init as RequestInit),
      dispatcher,
    });
  };

  return {
    fetch: controlledFetch,
    setProxyUrl: (next) => {
      const parsed = parseUpstreamProxyUrl(next);
      if (parsed === proxyUrl) {
        return;
      }
      proxyUrl = parsed;
      // Drop dispatcher so next request rebuilds (async load on demand).
      if (dispatcher && typeof dispatcher.close === "function") {
        try {
          dispatcher.close();
        } catch {
          // ignore
        }
      }
      dispatcher = undefined;
      if (parsed && ProxyAgentCtor) {
        rebuildDispatcher(parsed);
      }
    },
    getProxyUrl: () => proxyUrl,
  };
}
