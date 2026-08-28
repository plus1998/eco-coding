import { expect, test } from "bun:test";
import {
  clampComposerFloatingLeft,
  composerFloatingAvailableWidth,
  composerFloatingStyleForAnchor,
  composerFloatingViewport,
} from "../src/renderer/composer-floating";

test("composerFloatingViewport uses the window edges", () => {
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      innerWidth: 1200,
      innerHeight: 800,
    },
  });
  try {
    const viewport = composerFloatingViewport();
    expect(viewport.left).toBe(8);
    expect(viewport.right).toBe(1192);
    expect(viewport.width).toBe(1184);
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  }
});

test("clampComposerFloatingLeft clamps to the window viewport", () => {
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      innerWidth: 1200,
      innerHeight: 800,
    },
  });
  try {
    expect(clampComposerFloatingLeft(1100, 220)).toBe(972);
    expect(clampComposerFloatingLeft(0, 220)).toBe(8);
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  }
});

test("composerFloatingAvailableWidth never exceeds window minus margins", () => {
  const width = composerFloatingAvailableWidth();
  const max = (typeof window !== "undefined" ? window.innerWidth : 1200) - 16;
  expect(width).toBeLessThanOrEqual(max);
});

test("composerFloatingStyleForAnchor aligns popovers to the anchor trailing edge", () => {
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      innerWidth: 1200,
      innerHeight: 800,
    },
  });
  try {
    const anchor = {
      getBoundingClientRect: () =>
        ({
          left: 980,
          right: 1040,
          top: 640,
          bottom: 668,
          width: 60,
          height: 28,
        }) as DOMRect,
    } as HTMLElement;

    const style = composerFloatingStyleForAnchor(anchor, {
      width: 320,
      align: "end",
      prefer: "above",
    });

    expect(style.left).toBe(720);
    expect(style.width).toBe(320);
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  }
});
