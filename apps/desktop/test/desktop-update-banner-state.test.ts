import { expect, test } from "bun:test";
import type { DesktopUpdateState } from "../src/shared/desktop-update";
import { shouldRevealDesktopUpdateBanner } from "../src/renderer/desktop-update-banner-state";

const baseState = {
  capability: "auto",
  currentVersion: "0.1.0-beta.1",
  channel: "beta",
} satisfies Omit<DesktopUpdateState, "phase">;

test("download progress does not reopen a dismissed banner", () => {
  const previous: DesktopUpdateState = {
    ...baseState,
    phase: "downloading",
    availableVersion: "0.1.0-beta.2",
    progress: { percent: 10, transferred: 10, total: 100, bytesPerSecond: 10 },
  };
  const next: DesktopUpdateState = {
    ...previous,
    progress: { percent: 20, transferred: 20, total: 100, bytesPerSecond: 10 },
  };

  expect(shouldRevealDesktopUpdateBanner(previous, next)).toBe(false);
});

test("checking the same available version does not reopen a dismissed banner", () => {
  const checking: DesktopUpdateState = {
    ...baseState,
    phase: "checking",
    availableVersion: "0.1.0-beta.2",
  };

  expect(
    shouldRevealDesktopUpdateBanner(checking, {
      ...checking,
      phase: "available",
    }),
  ).toBe(false);
});

test("a new version and a completed download reveal the banner", () => {
  const available: DesktopUpdateState = {
    ...baseState,
    phase: "available",
    availableVersion: "0.1.0-beta.2",
  };
  expect(shouldRevealDesktopUpdateBanner({ ...available, availableVersion: "0.1.0-beta.1" }, available)).toBe(
    true,
  );
  expect(
    shouldRevealDesktopUpdateBanner(available, {
      ...available,
      phase: "downloaded",
    }),
  ).toBe(true);
});

test("an update error reveals the banner", () => {
  const downloading: DesktopUpdateState = {
    ...baseState,
    phase: "downloading",
    availableVersion: "0.1.0-beta.2",
  };

  expect(
    shouldRevealDesktopUpdateBanner(downloading, {
      ...downloading,
      phase: "error",
      reason: "download-failed",
      error: "network unavailable",
    }),
  ).toBe(true);
});

test("disabled automatic updates stay hidden while manual updates are shown", () => {
  expect(
    shouldRevealDesktopUpdateBanner(undefined, {
      phase: "disabled",
      capability: "disabled",
      currentVersion: "0.1.0-beta.1",
    }),
  ).toBe(false);
  expect(
    shouldRevealDesktopUpdateBanner(undefined, {
      phase: "disabled",
      capability: "manual",
      currentVersion: "0.1.0-beta.1",
      reason: "unsigned_macos",
    }),
  ).toBe(true);
});
