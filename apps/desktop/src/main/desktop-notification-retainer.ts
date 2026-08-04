export interface RetainedDesktopNotification {
  once(event: "close", listener: () => void): unknown;
  show(): void;
}

/**
 * Keeps the JavaScript notification wrapper alive until the native notification
 * closes, so its event listeners remain available while it is displayed.
 */
export class DesktopNotificationRetainer<T extends RetainedDesktopNotification> {
  private readonly notifications = new Set<T>();

  show(notification: T): void {
    this.notifications.add(notification);
    notification.once("close", () => {
      this.notifications.delete(notification);
    });
    notification.show();
  }

  get activeCount(): number {
    return this.notifications.size;
  }
}
