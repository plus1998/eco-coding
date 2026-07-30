import { expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ModelsDevPricingCache } from "../src/main/models-dev-pricing-cache";

async function tempCachePath(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  return path.join(dir, "models-dev-pricing.json");
}

test("getCatalog degrades to empty catalog when fetch fails without disk cache", async () => {
  const cachePath = await tempCachePath("eco-models-dev-empty-");
  const cache = new ModelsDevPricingCache({
    cachePath,
    fetchImpl: (async () => {
      throw new TypeError("fetch failed", {
        cause: Object.assign(new Error("Connect Timeout Error"), {
          code: "UND_ERR_CONNECT_TIMEOUT",
        }),
      });
    }) as typeof fetch,
  });

  const catalog = await cache.getCatalog();
  expect(catalog).toEqual({});
  expect(cache.getLastLoadError()).toContain("fetch failed");
  expect(await cache.listModelOptions()).toEqual([]);

  await expect(fs.access(cachePath)).rejects.toThrow();
});

test("getCatalog serves stale disk cache when refresh fetch fails", async () => {
  const cachePath = await tempCachePath("eco-models-dev-stale-");
  const staleCatalog = {
    anthropic: {
      id: "anthropic",
      models: {
        "claude-sonnet-4-6": {
          id: "claude-sonnet-4-6",
          name: "Claude Sonnet 4.6",
          cost: { input: 3, output: 15 },
        },
      },
    },
  };
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(
    cachePath,
    JSON.stringify({
      // Force expired disk TTL so loadCatalog attempts network.
      fetchedAt: Date.now() - 25 * 60 * 60 * 1000,
      catalog: staleCatalog,
    }),
    "utf8",
  );

  const cache = new ModelsDevPricingCache({
    cachePath,
    fetchImpl: (async () => {
      throw new Error("models.dev unreachable");
    }) as typeof fetch,
  });

  const catalog = await cache.getCatalog();
  expect(catalog.anthropic?.models?.["claude-sonnet-4-6"]?.id).toBe("claude-sonnet-4-6");
  expect(cache.getLastLoadError()).toBe("models.dev unreachable");
});

test("getCatalog writes disk cache after successful fetch", async () => {
  const cachePath = await tempCachePath("eco-models-dev-ok-");
  const payload = {
    anthropic: {
      id: "anthropic",
      models: {
        "claude-haiku-4-5": {
          id: "claude-haiku-4-5",
          name: "Claude Haiku 4.5",
          cost: { input: 0.8, output: 4 },
        },
      },
    },
  };
  const cache = new ModelsDevPricingCache({
    cachePath,
    fetchImpl: (async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch,
  });

  const catalog = await cache.getCatalog();
  expect(catalog.anthropic?.models?.["claude-haiku-4-5"]?.cost?.input).toBe(0.8);
  expect(cache.getLastLoadError()).toBeNull();

  const onDisk = JSON.parse(await fs.readFile(cachePath, "utf8")) as {
    catalog: typeof payload;
  };
  expect(onDisk.catalog.anthropic.models["claude-haiku-4-5"].id).toBe("claude-haiku-4-5");
});
