export interface PlanModeUiOption {
  value: boolean;
  title: string;
  subtitle: string;
  description: string;
}

export const PLAN_MODE_UI: PlanModeUiOption[] = [
  {
    value: false,
    title: "计划模式关",
    subtitle: "off",
    description: "主代理直接自主处理任务，并按需要调用已启用的子代理。",
  },
  {
    value: true,
    title: "计划模式开",
    subtitle: "on",
    description: "先强制生成计划并等待确认，批准后再进入执行。",
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
