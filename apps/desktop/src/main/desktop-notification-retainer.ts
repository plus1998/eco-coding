export interface RetainedDesktopNotification {
  once(event: "close", listener: () => void): unknown;
  show(): void;
}

export interface DesktopNotificationRetainerOptions {
  /**
   * How long to keep the JS wrapper after native `close`.
   * Some platforms emit `close` immediately after `show` or right after `click`;
   * releasing too early drops the click listener before it can run.
   */
  postCloseRetainMs?: number;
  /** Absolute max retain time after show (safety net). */
  maxRetainMs?: number;
}

const DEFAULT_POST_CLOSE_RETAIN_MS = 60_000;
const DEFAULT_MAX_RETAIN_MS = 15 * 60_000;

/**
 * Keeps the JavaScript notification wrapper alive while visible (and briefly after
 * close) so click listeners remain available.
 */
export class DesktopNotificationRetainer<T extends RetainedDesktopNotification> {
  private readonly notifications = new Map<T, ReturnType<typeof setTimeout>>();
  private readonly postCloseRetainMs: number;
  private readonly maxRetainMs: number;

  constructor(options: DesktopNotificationRetainerOptions = {}) {
    this.postCloseRetainMs = Math.max(0, options.postCloseRetainMs ?? DEFAULT_POST_CLOSE_RETAIN_MS);
    this.maxRetainMs = Math.max(this.postCloseRetainMs, options.maxRetainMs ?? DEFAULT_MAX_RETAIN_MS);
  }

  show(notification: T): void {
    this.retain(notification, this.maxRetainMs);
    notification.once("close", () => {
      this.retain(notification, this.postCloseRetainMs);
    });
    notification.show();
  }

  get activeCount(): number {
    return this.notifications.size;
  }

  private retain(notification: T, ms: number): void {
    this.clearTimer(notification);
    if (ms <= 0) {
      this.notifications.delete(notification);
      return;
    }
    // Presence in the map keeps the wrapper reachable even when timer is far away.
    const timer = setTimeout(() => {
      this.notifications.delete(notification);
    }, ms);
    this.notifications.set(notification, timer);
  }

  private clearTimer(notification: T): void {
    const existing = this.notifications.get(notification);
    if (existing !== undefined) {
      clearTimeout(existing);
    }
  }
}
