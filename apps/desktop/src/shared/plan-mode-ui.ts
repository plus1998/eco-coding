import { resolveSessionMode, sessionModeToPlanModeEnabled, type SessionMode } from "./session-mode";
import { SESSION_MODE_UI, sessionModeUi, type SessionModeUiOption } from "./session-mode-ui";

/** @deprecated Use SessionModeUiOption with sessionMode instead of boolean planModeEnabled. */
export interface PlanModeUiOption {
  value: boolean;
  title: string;
  subtitle: string;
  description: string;
}

/** Agent + Plan only; use SESSION_MODE_UI for Ask. */
export const PLAN_MODE_UI: PlanModeUiOption[] = SESSION_MODE_UI.filter(
  (entry) => entry.value !== "ask",
).map((entry) => ({
  value: entry.value === "plan",
  title: entry.title,
  subtitle: entry.subtitle,
  description: entry.description,
}));

/** @deprecated Use sessionModeUi */
export function planModeUi(planModeEnabled: boolean): PlanModeUiOption {
  const option = sessionModeUi(planModeEnabled ? "plan" : "agent");
  return {
    value: planModeEnabled,
    title: option.title,
    subtitle: option.subtitle,
    description: option.description,
  };
}

/** @deprecated Use explicit session mode selection */
export function togglePlanMode(planModeEnabled: boolean): boolean {
  return !planModeEnabled;
}

export { SESSION_MODE_UI, sessionModeUi, type SessionMode, type SessionModeUiOption };

export function withSessionMode<T extends { sessionMode?: SessionMode; planModeEnabled?: boolean }>(
  config: T,
  sessionMode: SessionMode,
): T & { sessionMode: SessionMode; planModeEnabled: boolean } {
  return {
    ...config,
    sessionMode,
    planModeEnabled: sessionModeToPlanModeEnabled(sessionMode),
  };
}

export function sessionModeFromLegacyPlanToggle(planModeEnabled: boolean): SessionMode {
  return resolveSessionMode({ planModeEnabled });
}
