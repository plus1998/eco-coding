import { expect, test } from "bun:test";
import {
  DesktopNotificationRetainer,
  type RetainedDesktopNotification,
} from "../src/main/desktop-notification-retainer";

class FakeNotification implements RetainedDesktopNotification {
  private closeListener: (() => void) | undefined;
  shown = false;

  once(event: "close", listener: () => void): void {
    expect(event).toBe("close");
    this.closeListener = listener;
  }

  show(): void {
    this.shown = true;
  }

  close(): void {
    this.closeListener?.();
  }
}

test("retains an Electron notification until it closes", () => {
  const retainer = new DesktopNotificationRetainer<FakeNotification>();
  const notification = new FakeNotification();

  retainer.show(notification);

  expect(notification.shown).toBe(true);
  expect(retainer.activeCount).toBe(1);

  notification.close();

  expect(retainer.activeCount).toBe(0);
});
