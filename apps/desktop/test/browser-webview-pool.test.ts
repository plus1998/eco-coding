import { expect, test } from "bun:test";
import {
  registerBrowserWebviewHostSlot,
  resetBrowserWebviewLayoutForTests,
  resolveBrowserWebviewViewportRect,
  setBrowserWebviewViewportRect,
  subscribeBrowserWebviewViewportRect,
} from "../src/renderer/browser-webview-layout";
import { BrowserWebviewPool } from "../src/renderer/browser-webview-pool";
import { createMockHostSlot, withBrowserWebviewTestDom } from "./browser-webview-test-dom";

test("layout registry stores viewport rects independently from host slots", () => {
  resetBrowserWebviewLayoutForTests();
  const rect = {
    left: 10,
    top: 20,
    width: 800,
    height: 600,
    right: 810,
    bottom: 620,
    x: 10,
    y: 20,
    toJSON: () => ({}),
  } as DOMRectReadOnly;

  let notified = 0;
  const unsubscribe = subscribeBrowserWebviewViewportRect("browser-a", () => {
    notified += 1;
  });

  setBrowserWebviewViewportRect("browser-a", rect);
  expect(resolveBrowserWebviewViewportRect("browser-a")).toBe(rect);
  expect(notified).toBe(1);

  setBrowserWebviewViewportRect("browser-a", null);
  expect(resolveBrowserWebviewViewportRect("browser-a")).toBeNull();
  expect(notified).toBe(2);

  unsubscribe();
  resetBrowserWebviewLayoutForTests();
});

test("pool release is the only destroy path", () => {
  withBrowserWebviewTestDom(() => {
    const pool = new BrowserWebviewPool();
    pool.resetForTests();
    resetBrowserWebviewLayoutForTests();

    const slot = createMockHostSlot();
    registerBrowserWebviewHostSlot("browser-x", slot);

    pool.sync([{ id: "browser-x", partition: "persist:eco-browser:x" }]);
    const webview = pool.getWebviewForTests("browser-x");
    expect(webview?.isConnected).toBe(true);

    pool.attach("browser-x");
    expect(webview?.parentElement).toBe(slot);

    pool.release("browser-x");
    expect(pool.has("browser-x")).toBe(false);
    expect(slot.childElementCount).toBe(0);

    pool.resetForTests();
    resetBrowserWebviewLayoutForTests();
  });
});

test("pool recreates guest when partition changes for same browser id", () => {
  withBrowserWebviewTestDom(() => {
    const pool = new BrowserWebviewPool();
    pool.resetForTests();
    resetBrowserWebviewLayoutForTests();

    const slot = createMockHostSlot();
    registerBrowserWebviewHostSlot("browser-y", slot);

    pool.sync([{ id: "browser-y", partition: "persist:eco-browser:a" }]);
    const first = pool.getWebviewForTests("browser-y");

    pool.sync([{ id: "browser-y", partition: "persist:eco-browser:b" }]);
    const second = pool.getWebviewForTests("browser-y");
    expect(second).not.toBe(first);
    expect(second?.partition).toBe("persist:eco-browser:b");

    pool.resetForTests();
    resetBrowserWebviewLayoutForTests();
  });
});
