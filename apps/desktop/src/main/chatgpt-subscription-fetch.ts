import { createUpstreamFetchController, parseUpstreamProxyUrl } from "@eco/gateway";
import { startSocksToHttpBridge } from "./openai-account-service";

/**
 * Fetch used by the ChatGPT subscription OAuth flow.
 *
 * The proxy is resolved for every request so changing the desktop proxy
 * setting also affects refresh/revocation without requiring a restart.
 * Chromium cannot consume SOCKS URLs directly, therefore SOCKS is bridged to
 * a loopback HTTP CONNECT endpoint before being passed to undici.
 */
export function createChatGptSubscriptionFetch(getProxyUrl: () => string | undefined): typeof fetch {
  let activeProxy: string | undefined;
  let controller: ReturnType<typeof createUpstreamFetchController> | undefined;
  let socksBridge: { port: number; close: () => void } | undefined;
  let configureInFlight: Promise<void> | undefined;

  const closeController = () => {
    controller?.close();
    controller = undefined;
    socksBridge?.close();
    socksBridge = undefined;
    activeProxy = undefined;
  };

  const configure = async (rawProxy: string | undefined): Promise<void> => {
    const parsed = parseUpstreamProxyUrl(rawProxy);
    if (parsed === activeProxy && controller) return;

    const protocol = parsed ? new URL(parsed).protocol.toLowerCase() : undefined;
    const nextProxy = parsed;
    closeController();
    if (!nextProxy) return;

    let controllerProxy = nextProxy;
    if (protocol === "socks:" || protocol === "socks5:") {
      socksBridge = await startSocksToHttpBridge(nextProxy);
      controllerProxy = `http://127.0.0.1:${socksBridge.port}`;
    }
    controller = createUpstreamFetchController(controllerProxy);
    activeProxy = nextProxy;
  };

  return async (input, init) => {
    const rawProxy = getProxyUrl()?.trim() || undefined;
    if (!configureInFlight) {
      configureInFlight = configure(rawProxy).finally(() => {
        configureInFlight = undefined;
      });
    }
    await configureInFlight;
    return controller ? controller.fetch(input, init) : fetch(input, init);
  };
}

/** Create a fetcher pinned to one account's explicit proxy. */
export function createChatGptSubscriptionFetchForProxy(proxyUrl: string): typeof fetch {
  return createChatGptSubscriptionFetch(() => proxyUrl);
}
