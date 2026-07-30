import { expect, test } from "bun:test";
import { type PresentableDesktopWindow, presentDesktopWindow } from "../src/main/desktop-single-instance";

function createWindow(minimized: boolean): {
  window: PresentableDesktopWindow;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    window: {
      isMinimized: () => minimized,
      restore: () => calls.push("restore"),
      show: () => calls.push("show"),
      focus: () => calls.push("focus"),
    },
  };
}

test("presentDesktopWindow restores and focuses a minimized primary window", () => {
  const { window, calls } = createWindow(true);

  expect(presentDesktopWindow(window)).toBe(true);
  expect(calls).toEqual(["restore", "show", "focus"]);
});

test("presentDesktopWindow focuses a visible primary window without restoring it", () => {
  const { window, calls } = createWindow(false);

  expect(presentDesktopWindow(window)).toBe(true);
  expect(calls).toEqual(["show", "focus"]);
});

test("presentDesktopWindow reports when the primary window is not ready", () => {
  expect(presentDesktopWindow(undefined)).toBe(false);
});
