import { expect, test } from "bun:test";
import { clearVitePreloadRecovery, recoverVitePreloadError } from "../src/renderer/vite-preload-recovery";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

test("vite preload recovery reloads once until a dynamic module succeeds", () => {
  const storage = memoryStorage();
  let reloads = 0;
  let prevented = 0;
  const event = { preventDefault: () => void (prevented += 1) };

  expect(recoverVitePreloadError(event, storage, () => void (reloads += 1))).toBe(true);
  expect(recoverVitePreloadError(event, storage, () => void (reloads += 1))).toBe(false);
  expect(reloads).toBe(1);
  expect(prevented).toBe(2);

  clearVitePreloadRecovery(storage);
  expect(recoverVitePreloadError(event, storage, () => void (reloads += 1))).toBe(true);
  expect(reloads).toBe(2);
});
