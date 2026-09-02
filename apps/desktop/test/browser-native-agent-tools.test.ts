import { expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import {
  formatAgentBrowserTabList,
  isFullPageScreenshot,
  resolveAgentBrowserScreenshotPath,
} from "../src/main/browser-native-agent-tools";

test("resolveAgentBrowserScreenshotPath defaults to temp png", () => {
  const resolved = resolveAgentBrowserScreenshotPath({});
  expect(path.dirname(resolved)).toBe(os.tmpdir());
  expect(path.basename(resolved)).toMatch(/^eco-browser-screenshot-\d+\.png$/);
});

test("resolveAgentBrowserScreenshotPath honors explicit path", () => {
  expect(resolveAgentBrowserScreenshotPath({ path: "C:/shots/a.png" })).toBe("C:/shots/a.png");
});

test("isFullPageScreenshot detects full flag", () => {
  expect(isFullPageScreenshot({})).toBe(false);
  expect(isFullPageScreenshot({ full: true })).toBe(true);
  expect(isFullPageScreenshot({ fullPage: true })).toBe(true);
});

test("formatAgentBrowserTabList returns empty sentinel without minting tabs", () => {
  expect(formatAgentBrowserTabList([])).toBe("(no tabs)");
});

test("formatAgentBrowserTabList matches agent-browser tab list lines", () => {
  expect(formatAgentBrowserTabList([{ url: "about:blank" }, { url: "https://example.com/" }])).toBe(
    "[t1] about:blank\n[t2] https://example.com/",
  );
});
