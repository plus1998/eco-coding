import type { SessionMode } from "./session-mode";
import { resolveSessionMode, type SessionModeSource } from "./session-mode";

export interface SessionModeUiOption {
  value: SessionMode;
  title: string;
  subtitle: string;
  description: string;
}

export const SESSION_MODE_UI: SessionModeUiOption[] = [
  {
    value: "agent",
    title: "Agent",
    subtitle: "default",
    description: "代理直接处理任务，并按需要调用已启用的子代理。",
  },
  {
    value: "plan",
    title: "Plan",
    subtitle: "plan",
    description: "先生成计划并等待确认，批准后再进入执行。",
  },
  {
    value: "ask",
    title: "Ask",
    subtitle: "read-only",
    description: "只读回答与代码探索，不修改文件、不执行命令。",
  },
];

export function sessionModeUi(mode: SessionMode): SessionModeUiOption {
  const option = SESSION_MODE_UI.find((entry) => entry.value === mode);
  if (!option) {
    throw new Error(`Unknown session mode: ${String(mode)}`);
  }
  return option;
}

export function sessionModeUiFromConfig(source: SessionModeSource): SessionModeUiOption {
  return sessionModeUi(resolveSessionMode(source));
}
