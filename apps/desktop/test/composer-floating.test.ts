import { expect, test } from "bun:test";
import {
  clampComposerFloatingLeft,
  composerFloatingAvailableWidth,
  composerFloatingStyleForAnchor,
  resolveComposerFloatingRightBound,
} from "../src/renderer/composer-floating";

test("resolveComposerFloatingRightBound ignores hidden obstructors", () => {
  const right = resolveComposerFloatingRightBound({
    windowWidth: 1200,
    obstructors: [
      { left: 900, width: 300, height: 800, visible: false },
      { left: 50, width: 240, height: 600, visible: true },
    ],
  });
  expect(right).toBe(1192);
});

test("resolveComposerFloatingRightBound shrinks for visible right panel", () => {
  const right = resolveComposerFloatingRightBound({
    windowWidth: 1200,
    obstructors: [{ left: 900, width: 300, height: 800, visible: true }],
  });
  expect(right).toBe(892);
});

test("resolveComposerFloatingRightBound picks the leftmost obstructing panel", () => {
  const right = resolveComposerFloatingRightBound({
    windowWidth: 1200,
    obstructors: [
      { left: 920, width: 280, height: 700, visible: true },
      { left: 720, width: 480, height: 700, visible: true },
    ],
  });
  expect(right).toBe(712);
});

test("resolveComposerFloatingRightBound ignores panels outside the feed column", () => {
  const right = resolveComposerFloatingRightBound({
    windowWidth: 1200,
    contentRight: 820,
    obstructors: [{ left: 900, width: 300, height: 800, visible: true }],
  });
  expect(right).toBe(820);
});

test("resolveComposerFloatingRightBound shrinks for panels overlapping the feed column", () => {
  const right = resolveComposerFloatingRightBound({
    windowWidth: 1200,
    contentRight: 820,
    obstructors: [{ left: 700, width: 300, height: 800, visible: true }],
  });
  expect(right).toBe(692);
});

test("resolveComposerFloatingRightBound caps to feed column before panel overlap", () => {
  const right = resolveComposerFloatingRightBound({
    windowWidth: 1200,
    contentRight: 820,
    obstructors: [],
  });
  expect(right).toBe(820);
});

test("clampComposerFloatingLeft uses window edge when no obstructors in DOM", () => {
  const left = clampComposerFloatingLeft(1100, 220);
  expect(left).toBeLessThanOrEqual(
    (typeof window !== "undefined" ? window.innerWidth : 1200) - 8 - 220,
  );
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
