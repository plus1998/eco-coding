import { expect, test } from "bun:test";
import { ecoPiSessionSettings } from "../src/pi-coding-agent-driver.js";

test("Eco PI sessions turn cache warming off", async () => {
  const { SettingsManager } = await import("@earendil-works/pi-coding-agent");

  // PI 1.0.3 defaults to "streaming" when the setting is absent, so the explicit
  // value below is what keeps Eco from paying for speculative warm requests.
  expect(SettingsManager.inMemory({}).getCacheWarmingMode()).toBe("streaming");
  expect(SettingsManager.inMemory(ecoPiSessionSettings()).getCacheWarmingMode()).toBe("off");
});

test("Eco PI session settings keep native compaction and agent-level retry", () => {
  expect(ecoPiSessionSettings()).toEqual({
    compaction: { enabled: true },
    retry: { enabled: true, maxRetries: 3, provider: { maxRetries: 0 } },
    cacheWarming: "off",
  });
});
