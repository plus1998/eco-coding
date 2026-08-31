import { expect, test } from "bun:test";
import {
  applyDesktopAutoUpdaterPolicy,
  formatDesktopUpdateError,
  type DesktopAutoUpdaterPolicyTarget,
} from "../src/main/desktop-update-policy";

test("desktop updater policy disables downgrades and GitHub prerelease heuristics", () => {
  let assignedChannel: string | null = null;
  const updater: DesktopAutoUpdaterPolicyTarget = {
    get channel() {
      return assignedChannel;
    },
    set channel(value) {
      assignedChannel = value;
      this.allowDowngrade = true;
    },
    allowDowngrade: false,
    allowPrerelease: true,
    autoDownload: true,
    autoInstallOnAppQuit: true,
    disableDifferentialDownload: false,
  };

  applyDesktopAutoUpdaterPolicy(updater, "beta");

  expect(updater.channel).toBe("beta");
  expect(updater.allowDowngrade).toBe(false);
  expect(updater.allowPrerelease).toBe(false);
  expect(updater.autoDownload).toBe(false);
  expect(updater.autoInstallOnAppQuit).toBe(false);
  expect(updater.disableDifferentialDownload).toBe(true);
});

test("stable channel also keeps allowPrerelease off on the generic feed", () => {
  const updater: DesktopAutoUpdaterPolicyTarget = {
    channel: null,
    allowDowngrade: true,
    allowPrerelease: true,
    autoDownload: true,
    autoInstallOnAppQuit: true,
  };

  applyDesktopAutoUpdaterPolicy(updater, "latest");

  expect(updater.channel).toBe("latest");
  expect(updater.allowPrerelease).toBe(false);
  expect(updater.allowDowngrade).toBe(false);
});

test("formatDesktopUpdateError collapses channel-file 404 noise", () => {
  expect(
    formatDesktopUpdateError(
      new Error(
        'Cannot find latest.yml in the latest release artifacts (https://github.com/plus1998/eco-coding/releases/download/v0.1.0-beta.3/latest.yml): HttpError: 404 "method: GET url: https://github.com/plus1998/eco-coding/releases/download/v0.1.0-beta.3/latest.yml"',
      ),
    ),
  ).toBe("CHANNEL_FILE_NOT_FOUND");
  expect(formatDesktopUpdateError(new Error("ENOTFOUND api.github.com"))).toBe("NETWORK_ERROR");
  expect(formatDesktopUpdateError(new Error("plain failure"))).toBe("plain failure");
});
