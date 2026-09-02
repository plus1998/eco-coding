import type { SessionMode } from "./session-mode";
import { SESSION_MODE_UI, type SessionModeUiOption, sessionModeUi } from "./session-mode-ui";

export { SESSION_MODE_UI, type SessionMode, type SessionModeUiOption, sessionModeUi };

export function withSessionMode<T extends { sessionMode?: SessionMode }>(
  config: T,
  sessionMode: SessionMode,
): T & { sessionMode: SessionMode } {
  return {
    ...config,
    sessionMode,
  };
}
