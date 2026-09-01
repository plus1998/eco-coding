import { afterEach, expect, test } from "bun:test";
import http from "node:http";
import { FORBIDDEN_CDP_PORT, startMultiBrowserCdpProxy } from "../src/main/browser-cdp-proxy";

const proxies: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  while (proxies.length > 0) {
    const proxy = proxies.pop();
    if (proxy) {
      await proxy.close();
    }
  }
});

async function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("failed to reserve port"));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

test("preferredPort binds the requested port", async () => {
  const port = await reservePort();
  const proxy = await startMultiBrowserCdpProxy({
    getTargets: () => [],
    preferredPort: port,
  });
  proxies.push(proxy);
  expect(proxy.port).toBe(port);
});

test("preferredPort 9222 falls back to ephemeral port", async () => {
  const proxy = await startMultiBrowserCdpProxy({
    getTargets: () => [],
    preferredPort: FORBIDDEN_CDP_PORT,
  });
  proxies.push(proxy);
  expect(proxy.port).not.toBe(FORBIDDEN_CDP_PORT);
  expect(proxy.port).toBeGreaterThan(0);
});

test("preferredPort falls back to ephemeral when port is in use", async () => {
  const port = await reservePort();
  const blocker = http.createServer();
  await new Promise<void>((resolve, reject) => {
    blocker.listen(port, "127.0.0.1", () => resolve());
    blocker.on("error", reject);
  });

  const proxy = await startMultiBrowserCdpProxy({
    getTargets: () => [],
    preferredPort: port,
  });
  proxies.push(proxy);

  expect(proxy.port).not.toBe(port);
  expect(proxy.port).toBeGreaterThan(0);

  await new Promise<void>((resolve) => blocker.close(() => resolve()));
});
