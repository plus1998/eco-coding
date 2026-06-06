import type { OrchestrationModeSetting } from "./ipc";

export interface OrchestrationModeUiOption {
  value: OrchestrationModeSetting;
  title: string;
  subtitle: string;
  description: string;
}

export const ORCHESTRATION_MODE_UI: OrchestrationModeUiOption[] = [
  {
    value: "autonomous",
    title: "自主编排",
    subtitle: "autonomous",
    description: "主 Agent 按任务风险自选子代理；子代理默认全开，不可单独开关。",
  },
  {
    value: "manual",
    title: "固定编排",
    subtitle: "manual",
    description: "强制先计划后执行，走预设流水线；可在设置中单独开关子代理。",
  },
];

export function orchestrationModeUi(mode: OrchestrationModeSetting): OrchestrationModeUiOption {
  const option = ORCHESTRATION_MODE_UI.find((entry) => entry.value === mode);
  if (!option) {
    throw new Error(`Unknown orchestration mode: ${mode}`);
  }
  return option;
}

export function toggleOrchestrationMode(mode: OrchestrationModeSetting): OrchestrationModeSetting {
  return mode === "manual" ? "autonomous" : "manual";
}
