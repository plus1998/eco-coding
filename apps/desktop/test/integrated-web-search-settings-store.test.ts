import { expect, test } from "bun:test";
import { DatabaseSync } from "node:sqlite";
import { IntegratedWebSearchSettingsStore } from "../src/main/integrated-web-search-settings-store";

test("integrated web search reports an actionable error for stale safeStorage ciphertext", () => {
  const store = new IntegratedWebSearchSettingsStore(new DatabaseSync(":memory:"), {
    isAvailable: () => true,
    encrypt: (value) => `safe-v1:${value}`,
    decrypt: () => {
      throw new Error("Error while decrypting the ciphertext provided to safeStorage.decryptString.");
    },
  });
  store.initialize();
  store.save({ enabled: true, apiKey: "stale-key" });

  expect(() => store.getApiKey()).toThrow(
    "Integrated Web Search API Key 解密失败，请在设置中重新输入并保存。原始错误：Error while decrypting the ciphertext provided to safeStorage.decryptString.",
  );
});
