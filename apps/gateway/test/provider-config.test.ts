import { describe, expect, test } from "bun:test";
import { buildProviderProxyRoutes, normalizeProvider } from "../src/provider-config.js";
import type { GatewayProvider } from "../src/types.js";

function provider(overrides: Partial<GatewayProvider> = {}): GatewayProvider {
  return {
    id: "p1",
    name: "P1",
    upstreamKind: "anthropic-messages",
    baseUrl: "https://api.example.com",
    apiKey: "key",
    upstreamModelId: "model-a",
    models: ["model-a"],
    ...overrides,
  };
}

describe("normalizeProvider", () => {
  test("keeps a valid per-provider proxy URL", () => {
    const normalized = normalizeProvider(
      provider({ upstreamProxyUrl: " socks5://127.0.0.1:7890 " }),
    );
    expect(normalized.upstreamProxyUrl).toBe("socks5://127.0.0.1:7890");
  });

  test("drops blank proxy URLs and rejects invalid ones", () => {
    expect(normalizeProvider(provider({ upstreamProxyUrl: "   " })).upstreamProxyUrl).toBeUndefined();
    expect(() => normalizeProvider(provider({ upstreamProxyUrl: "ftp://x:21" }))).toThrow(
      /Unsupported proxy protocol/,
    );
    expect(() => normalizeProvider(provider({ upstreamProxyUrl: "not a url" }))).toThrow(
      /Invalid upstream proxy URL/,
    );
  });
});

describe("buildProviderProxyRoutes", () => {
  test("skips providers without a proxy", () => {
    const routes = buildProviderProxyRoutes([
      provider({ id: "a" }),
      provider({ id: "b", baseUrl: "https://api.b.example", upstreamProxyUrl: "socks5://p:1080" }),
    ]);
    expect(routes).toEqual([{ origin: "https://api.b.example", proxyUrl: "socks5://p:1080" }]);
  });

  test("dedupes by origin (last provider wins)", () => {
    const routes = buildProviderProxyRoutes([
      provider({ id: "a", baseUrl: "https://api.b.example", upstreamProxyUrl: "socks5://first:1080" }),
      provider({ id: "b", baseUrl: "https://api.b.example", upstreamProxyUrl: "socks5://second:1080" }),
    ]);
    expect(routes).toEqual([{ origin: "https://api.b.example", proxyUrl: "socks5://second:1080" }]);
  });

  test("normalizes origin from baseUrl (strips path / trailing slash)", () => {
    const routes = buildProviderProxyRoutes([
      provider({ id: "a", baseUrl: "https://api.b.example/anthropic/", upstreamProxyUrl: "http://p:8080" }),
    ]);
    expect(routes).toEqual([{ origin: "https://api.b.example", proxyUrl: "http://p:8080" }]);
  });
});
