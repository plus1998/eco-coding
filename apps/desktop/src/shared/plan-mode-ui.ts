export interface PlanModeUiOption {
  value: boolean;
  title: string;
  subtitle: string;
  description: string;
}

export const PLAN_MODE_UI: PlanModeUiOption[] = [
  {
    value: false,
    title: "Agent",
    subtitle: "off",
    description: "代理直接处理任务，并按需要调用已启用的子代理。",
  },
  {
    value: true,
    title: "Plan",
    subtitle: "on",
    description: "先生成计划并等待确认，批准后再进入执行。",
  },
];

export function planModeUi(planModeEnabled: boolean): PlanModeUiOption {
  const option = PLAN_MODE_UI.find((entry) => entry.value === planModeEnabled);
  if (!option) {
    throw new Error(`Unknown plan mode: ${String(planModeEnabled)}`);
  }
  return option;
}

export function togglePlanMode(planModeEnabled: boolean): boolean {
  return !planModeEnabled;
}
