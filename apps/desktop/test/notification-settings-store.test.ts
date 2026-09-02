import { expect, test } from "bun:test";
import { NotificationSettingsStore } from "../src/main/notification-settings-store";
import { IPC_CHANNELS, isKnownIpcChannel } from "../src/shared/ipc";
import {
  defaultNotificationSettings,
  type NotificationSettingsSnapshot,
} from "../src/shared/notification-settings";

class MemoryNotificationDatabase {
  private readonly rows = new Map<string, string>();

  exec(_sql: string): void {}

  prepare(sql: string) {
    const normalized = sql.replace(/\s+/g, " ").trim();
    return {
      get: (...args: unknown[]) => {
        if (normalized.startsWith("SELECT value_json FROM notification_settings")) {
          const key = String(args[0]);
          const value = this.rows.get(key);
          return value === undefined ? undefined : { value_json: value };
        }
        return undefined;
      },
      run: (...args: unknown[]) => {
        if (normalized.startsWith("INSERT INTO notification_settings")) {
          const key = String(args[0]);
          const valueJson = String(args[1]);
          this.rows.set(key, valueJson);
        }
      },
    };
  }
}

test("notification settings store defaults and persists snapshots", () => {
  const store = new NotificationSettingsStore(new MemoryNotificationDatabase() as never);
  store.initialize();
  expect(store.get()).toEqual(defaultNotificationSettings());

  const next: NotificationSettingsSnapshot = {
    turnCompletion: "always",
    permissionEnabled: false,
    questionEnabled: true,
  };
  expect(store.save(next)).toEqual(next);
  expect(store.get()).toEqual(next);
});

test("notification settings store recovers from corrupt json", () => {
  const db = new MemoryNotificationDatabase();
  const store = new NotificationSettingsStore(db as never);
  store.initialize();
  db.prepare(`INSERT INTO notification_settings (key, value_json, updated_at) VALUES (?, ?, ?)`).run(
    "snapshot",
    "{not-json",
    "2020-01-01T00:00:00.000Z",
  );
  expect(store.get()).toEqual(defaultNotificationSettings());
});

test("notification settings IPC channels are known", () => {
  expect(IPC_CHANNELS.notificationSettingsGet).toBe("notification-settings:get");
  expect(IPC_CHANNELS.notificationSettingsSave).toBe("notification-settings:save");
  expect(IPC_CHANNELS.appShowThreadClarificationNotification).toBe(
    "app:show-thread-clarification-notification",
  );
  expect(isKnownIpcChannel(IPC_CHANNELS.notificationSettingsGet)).toBe(true);
  expect(isKnownIpcChannel(IPC_CHANNELS.notificationSettingsSave)).toBe(true);
  expect(isKnownIpcChannel(IPC_CHANNELS.appShowThreadClarificationNotification)).toBe(true);
});
