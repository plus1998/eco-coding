import { expect, test } from "bun:test";
import {
  clampComposerFloatingLeft,
  composerFloatingAvailableWidth,
  composerFloatingStyleForAnchor,
  composerFloatingViewport,
} from "../src/renderer/composer-floating";
import { withGlobalWindow } from "./support/global-document";

const viewportWindow = { innerWidth: 1200, innerHeight: 800 };

test("composerFloatingViewport uses the window edges", () => {
  withGlobalWindow(viewportWindow, () => {
    const viewport = composerFloatingViewport();
    expect(viewport.left).toBe(8);
    expect(viewport.right).toBe(1192);
    expect(viewport.width).toBe(1184);
  });
});

test("clampComposerFloatingLeft clamps to the window viewport", () => {
  withGlobalWindow(viewportWindow, () => {
    expect(clampComposerFloatingLeft(1100, 220)).toBe(972);
    expect(clampComposerFloatingLeft(0, 220)).toBe(8);
  });
});

test("composerFloatingAvailableWidth never exceeds window minus margins", () => {
  withGlobalWindow(viewportWindow, () => {
    const width = composerFloatingAvailableWidth();
    // The task panel margins are the only space the composer gives up.
    expect(width).toBeLessThanOrEqual(viewportWindow.innerWidth - 16);
  });
});

test("composerFloatingStyleForAnchor aligns popovers to the anchor trailing edge", () => {
  withGlobalWindow(viewportWindow, () => {
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
  });
});
