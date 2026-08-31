import { expect, test } from "bun:test";
import type { DesktopUpdateState } from "../src/shared/desktop-update";
import {
  resolveSidebarUpdateAction,
  shouldShowSidebarUpdateDownload,
  sidebarSettingsVersionLabel,
} from "../src/renderer/desktop-update-banner-state";

const baseState = {
  capability: "auto",
  currentVersion: "0.1.0-beta.1",
  channel: "beta",
} satisfies Omit<DesktopUpdateState, "phase">;

test("sidebar stays on version help while idle or fully disabled", () => {
  expect(resolveSidebarUpdateAction(undefined).kind).toBe("version");
  expect(resolveSidebarUpdateAction({ ...baseState, phase: "idle" }).kind).toBe("version");
  expect(
    resolveSidebarUpdateAction({
      phase: "disabled",
      capability: "disabled",
      currentVersion: "0.1.0-beta.1",
    }).kind,
  ).toBe("version");
});

test("sidebar download action is only shown when an auto update is available", () => {
  expect(shouldShowSidebarUpdateDownload(undefined)).toBe(false);
  expect(shouldShowSidebarUpdateDownload({ ...baseState, phase: "idle" })).toBe(false);
  expect(shouldShowSidebarUpdateDownload({ ...baseState, phase: "checking" })).toBe(false);
  expect(
    shouldShowSidebarUpdateDownload({
      ...baseState,
      phase: "available",
      availableVersion: "0.1.0-beta.2",
    }),
  ).toBe(true);
  expect(
    shouldShowSidebarUpdateDownload({
      ...baseState,
      phase: "downloading",
      availableVersion: "0.1.0-beta.2",
    }),
  ).toBe(false);
  expect(
    shouldShowSidebarUpdateDownload({
      phase: "available",
      capability: "disabled",
      currentVersion: "0.1.0-beta.1",
      availableVersion: "0.1.0-beta.2",
    }),
  ).toBe(false);
});

test("sidebar maps checking downloading restart and error phases", () => {
  expect(resolveSidebarUpdateAction({ ...baseState, phase: "checking" }).kind).toBe("checking");
  expect(
    resolveSidebarUpdateAction({
      ...baseState,
      phase: "downloading",
      availableVersion: "0.1.0-beta.2",
      progress: { percent: 41.6, transferred: 41, total: 100, bytesPerSecond: 10 },
    }),
  ).toEqual({
    kind: "progress",
    currentVersion: "0.1.0-beta.1",
    availableVersion: "0.1.0-beta.2",
    percent: 42,
  });
  expect(
    resolveSidebarUpdateAction({
      ...baseState,
      phase: "downloaded",
      availableVersion: "0.1.0-beta.2",
    }).kind,
  ).toBe("restart");
  expect(
    resolveSidebarUpdateAction({
      ...baseState,
      phase: "installing",
      availableVersion: "0.1.0-beta.2",
    }).kind,
  ).toBe("installing");
  expect(
    resolveSidebarUpdateAction({
      ...baseState,
      phase: "error",
      error: "network unavailable",
    }),
  ).toEqual({
    kind: "error",
    currentVersion: "0.1.0-beta.1",
    error: "network unavailable",
  });
});

test("manual and unsigned macOS updates surface an open-release action", () => {
  expect(
    resolveSidebarUpdateAction({
      phase: "disabled",
      capability: "manual",
      currentVersion: "0.1.0-beta.1",
      reason: "unsigned_macos",
    }),
  ).toEqual({
    kind: "manual",
    currentVersion: "0.1.0-beta.1",
    manualReason: "unsigned_macos",
  });
  expect(
    resolveSidebarUpdateAction({
      phase: "available",
      capability: "manual",
      currentVersion: "0.1.0-beta.1",
      availableVersion: "0.1.0-beta.2",
      reason: "unsigned_macos",
    }).kind,
  ).toBe("manual");
});

test("sidebar version tooltip uses the current app version", () => {
  expect(sidebarSettingsVersionLabel(undefined)).toBe("");
  expect(sidebarSettingsVersionLabel({ ...baseState, phase: "idle" })).toBe("0.1.0-beta.1");
  expect(sidebarSettingsVersionLabel({ ...baseState, phase: "idle", currentVersion: "  0.2.0  " })).toBe(
    "0.2.0",
  );
  expect(sidebarSettingsVersionLabel({ ...baseState, phase: "idle", currentVersion: "   " })).toBe("");
});
