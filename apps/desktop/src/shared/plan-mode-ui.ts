import type { SessionMode } from "./session-mode";
import { SESSION_MODE_UI, sessionModeUi, type SessionModeUiOption } from "./session-mode-ui";

export { SESSION_MODE_UI, sessionModeUi, type SessionMode, type SessionModeUiOption };

export function withSessionMode<T extends { sessionMode?: SessionMode }>(
  config: T,
  sessionMode: SessionMode,
): T & { sessionMode: SessionMode } {
  return {
    ...config,
    sessionMode,
  };
}
