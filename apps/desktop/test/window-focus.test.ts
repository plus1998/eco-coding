import { expect, test } from "bun:test";
import { isThreadActivelyViewed } from "../src/renderer/window-focus";

test("thread is actively viewed only when selected and the window is focused", () => {
  expect(isThreadActivelyViewed("thread-1", "thread-1", true)).toBe(true);
  expect(isThreadActivelyViewed("thread-1", "thread-1", false)).toBe(false);
  expect(isThreadActivelyViewed("thread-2", "thread-1", true)).toBe(false);
  expect(isThreadActivelyViewed(undefined, "thread-1", true)).toBe(false);
});
