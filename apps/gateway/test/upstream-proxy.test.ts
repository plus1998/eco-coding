import { describe, expect, mock, test } from "bun:test";
import { createUpstreamFetchController, parseUpstreamProxyUrl } from "../src/upstream-proxy.js";

describe("parseUpstreamProxyUrl", () => {
  test("accepts http, https, socks5, socks", () => {
    expect(parseUpstreamProxyUrl("http://127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
    expect(parseUpstreamProxyUrl(" https://proxy.example:1080 ")).toBe("https://proxy.example:1080");
    expect(parseUpstreamProxyUrl("socks5://127.0.0.1:7890")).toBe("socks5://127.0.0.1:7890");
    expect(parseUpstreamProxyUrl("socks://127.0.0.1:7890")).toBe("socks://127.0.0.1:7890");
  });

  test("empty / blank returns undefined", () => {
    expect(parseUpstreamProxyUrl(undefined)).toBeUndefined();
    expect(parseUpstreamProxyUrl("")).toBeUndefined();
    expect(parseUpstreamProxyUrl("   ")).toBeUndefined();
  });

  test("rejects unsupported protocol, missing host, and newlines", () => {
    expect(() => parseUpstreamProxyUrl("ftp://example.com:21")).toThrow(/Unsupported proxy protocol/);
    expect(() => parseUpstreamProxyUrl("not a url")).toThrow(/Invalid upstream proxy URL/);
    expect(() => parseUpstreamProxyUrl("http://a\nb")).toThrow(/must not contain newlines/i);
  });
});

interface FakeProxyAgent {
  url: string;
  close(): void;
}

interface FakeUndiciModule {
  fetch: (input: RequestInfo | URL, init?: { dispatcher?: FakeProxyAgent }) => Promise<Response>;
  ProxyAgent: new (url: string) => FakeProxyAgent;
}

describe("createUpstreamFetchController", () => {
  test("no proxy: passes through to global fetch", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response("direct"),
    });
    try {
      const controller = createUpstreamFetchController();
      const response = await controller.fetch(`http://127.0.0.1:${server.port}/ok`);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("direct");
      controller.close();
    } finally {
      server.stop();
    }
  });

  test("per-origin route wins over global proxy; unmatched origin falls back to global", async () => {
    const calls: Array<{ url: string; dispatcherUrl?: string }> = [];
    mock.module("undici", (): FakeUndiciModule => ({
      fetch: async (input, init) => {
        calls.push({
          url: typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
          dispatcherUrl: init?.dispatcher?.url,
        });
        return new Response("proxied");
      },
      ProxyAgent: class {
        constructor(public url: string) {}
        close() {
          closed.push(this.url);
        }
      },
    }));

    const controller = createUpstreamFetchController("socks5://global.example:1080");
    controller.setProxyRoutes([
      { origin: "https://a.example", proxyUrl: "socks5://a-proxy.example:7890" },
    ]);
    try {
      await controller.fetch("https://a.example/v1/messages");
      await controller.fetch("https://b.example/v1/messages");
    } finally {
      controller.close();
    }
    expect(calls.map((call) => call.dispatcherUrl)).toEqual([
      "socks5://a-proxy.example:7890",
      "socks5://global.example:1080",
    ]);
  });

  test("replacing routes closes no-longer-referenced dispatchers", async () => {
    const closed: string[] = [];
    mock.module("undici", (): FakeUndiciModule => ({
      fetch: async () => new Response("proxied"),
      ProxyAgent: class {
        constructor(public url: string) {}
        close() {
          closed.push(this.url);
        }
      },
    }));

    const controller = createUpstreamFetchController();
    controller.setProxyRoutes([
      { origin: "https://a.example", proxyUrl: "socks5://one.example:1080" },
      { origin: "https://b.example", proxyUrl: "socks5://two.example:1080" },
    ]);
    // Force dispatcher creation so close can be observed on prune.
    await controller.fetch("https://a.example/x");
    await controller.fetch("https://b.example/x");
    expect(closed).toEqual([]);

    controller.setProxyRoutes([{ origin: "https://a.example", proxyUrl: "socks5://three.example:1080" }]);
    expect(closed).toContain("socks5://two.example:1080");
    expect(closed).toContain("socks5://one.example:1080");

    controller.setProxyRoutes([]);
    expect(closed).toContain("socks5://three.example:1080");
    controller.close();
  });

  test("setProxyUrl change closes the previous global dispatcher", async () => {
    const closed: string[] = [];
    mock.module("undici", (): FakeUndiciModule => ({
      fetch: async () => new Response("proxied"),
      ProxyAgent: class {
        constructor(public url: string) {}
        close() {
          closed.push(this.url);
        }
      },
    }));

    const controller = createUpstreamFetchController("socks5://old.example:1080");
    // Force creation of the initial global dispatcher via a proxied fetch.
    await controller.fetch("https://any.example/x");
    controller.setProxyUrl("socks5://new.example:1080");
    expect(closed).toContain("socks5://old.example:1080");
    expect(controller.getProxyUrl()).toBe("socks5://new.example:1080");
    controller.close();
  });

  test("invalid proxy URL throws on set", () => {
    const controller = createUpstreamFetchController();
    expect(() => controller.setProxyUrl("ftp://example.com:21")).toThrow(/Unsupported proxy protocol/);
    expect(() =>
      controller.setProxyRoutes([{ origin: "https://a.example", proxyUrl: "not a url" }]),
    ).toThrow(/Invalid upstream proxy URL/);
    controller.close();
  });
});
