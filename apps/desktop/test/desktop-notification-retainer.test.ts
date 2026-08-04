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

test("retains an Electron notification until the max retain window ends", () => {
  const retainer = new DesktopNotificationRetainer<FakeNotification>({
    postCloseRetainMs: 0,
    maxRetainMs: 0,
  });
  const notification = new FakeNotification();

  retainer.show(notification);

  expect(notification.shown).toBe(true);
  // maxRetainMs 0 schedules an immediate release on show after show() returns
  expect(retainer.activeCount).toBe(0);
});

test("keeps the wrapper after native close so late click handlers can fire", async () => {
  const retainer = new DesktopNotificationRetainer<FakeNotification>({
    postCloseRetainMs: 40,
    maxRetainMs: 10_000,
  });
  const notification = new FakeNotification();

  retainer.show(notification);
  expect(retainer.activeCount).toBe(1);

  notification.close();
  expect(retainer.activeCount).toBe(1);

  await Bun.sleep(60);
  expect(retainer.activeCount).toBe(0);
});
