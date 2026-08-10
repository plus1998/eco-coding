import { expect, test } from "bun:test";
import {
  applyDesktopAutoUpdaterPolicy,
  type DesktopAutoUpdaterPolicyTarget,
} from "../src/main/desktop-update-policy";

test("desktop updater policy disables implicit channel downgrades", () => {
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
    autoDownload: true,
    autoInstallOnAppQuit: true,
  };

  applyDesktopAutoUpdaterPolicy(updater, "beta");

  expect(updater.channel).toBe("beta");
  expect(updater.allowDowngrade).toBe(false);
  expect(updater.autoDownload).toBe(false);
  expect(updater.autoInstallOnAppQuit).toBe(false);
});
