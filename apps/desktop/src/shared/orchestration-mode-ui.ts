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
    description: "主 Agent 根据任务目标选择可用子代理，适合开放式任务和通用场景。",
  },
  {
    value: "manual",
    title: "固定编排",
    subtitle: "manual",
    description: "按当前编排配置执行预设步骤，适合需要稳定流程和人工审批的任务。",
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
