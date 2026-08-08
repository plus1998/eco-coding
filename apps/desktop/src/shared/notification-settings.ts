/** When to show OS notifications for turn completion. */
export type TurnCompletionNotifyMode = "unfocused" | "never" | "always";

export const TURN_COMPLETION_NOTIFY_MODES = ["unfocused", "never", "always"] as const;

export type DesktopNotificationKind = "completion" | "approval" | "question";

export function isTurnCompletionNotifyMode(value: unknown): value is TurnCompletionNotifyMode {
  return (
    typeof value === "string" &&
    (TURN_COMPLETION_NOTIFY_MODES as readonly string[]).includes(value)
  );
}

export interface NotificationSettingsSnapshot {
  turnCompletion: TurnCompletionNotifyMode;
  permissionEnabled: boolean;
  questionEnabled: boolean;
}

export function defaultNotificationSettings(): NotificationSettingsSnapshot {
  return {
    turnCompletion: "unfocused",
    permissionEnabled: true,
    questionEnabled: true,
  };
}

export function normalizeNotificationSettingsSnapshot(value: unknown): NotificationSettingsSnapshot {
  if (!value || typeof value !== "object") {
    return defaultNotificationSettings();
  }
  const record = value as Record<string, unknown>;
  return {
    turnCompletion: isTurnCompletionNotifyMode(record.turnCompletion)
      ? record.turnCompletion
      : "unfocused",
    permissionEnabled: record.permissionEnabled !== false,
    questionEnabled: record.questionEnabled !== false,
  };
}

export function isNotificationSettingsSnapshot(value: unknown): value is NotificationSettingsSnapshot {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (!isTurnCompletionNotifyMode(record.turnCompletion)) {
    return false;
  }
  if (typeof record.permissionEnabled !== "boolean") {
    return false;
  }
  if (typeof record.questionEnabled !== "boolean") {
    return false;
  }
  return true;
}

export function shouldNotifyTurnCompletion(
  mode: TurnCompletionNotifyMode,
  activelyViewed: boolean,
): boolean {
  if (mode === "never") {
    return false;
  }
  if (mode === "always") {
    return true;
  }
  return !activelyViewed;
}

export function shouldNotifyPermission(enabled: boolean, activelyViewed: boolean): boolean {
  return enabled && !activelyViewed;
}

export function shouldNotifyQuestion(enabled: boolean, activelyViewed: boolean): boolean {
  return enabled && !activelyViewed;
}

/** App preference gate for Electron desktop notifications. */
export function preferenceAllowsDesktopNotification(
  settings: NotificationSettingsSnapshot,
  kind: DesktopNotificationKind,
  activelyViewed: boolean,
): boolean {
  switch (kind) {
    case "completion":
      return shouldNotifyTurnCompletion(settings.turnCompletion, activelyViewed);
    case "approval":
      return shouldNotifyPermission(settings.permissionEnabled, activelyViewed);
    case "question":
      return shouldNotifyQuestion(settings.questionEnabled, activelyViewed);
  }
}
