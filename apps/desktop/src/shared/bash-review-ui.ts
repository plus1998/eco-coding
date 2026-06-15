import type { BashReviewMode } from "../../../../packages/bash-policy/src";

export interface BashReviewUiOption {
  value: BashReviewMode;
  title: string;
  subtitle: string;
  description: string;
}

export const BASH_REVIEW_UI: BashReviewUiOption[] = [
  {
    value: "always",
    title: "请求批准",
    subtitle: "always",
    description: "执行 Bash 命令时始终询问",
  },
  {
    value: "auto",
    title: "替我审批",
    subtitle: "auto",
    description: "仅对检测到的风险操作请求批准",
  },
  {
    value: "allow_all",
    title: "完全访问权限",
    subtitle: "allow",
    description: "自动批准 Bash 命令（仍需 Agent Profile 允许 Bash 工具）",
  },
];

export function bashReviewUi(mode: BashReviewMode): BashReviewUiOption {
  const option = BASH_REVIEW_UI.find((entry) => entry.value === mode);
  if (!option) {
    throw new Error(`Unknown bash review mode: ${mode}`);
  }
  return option;
}

export function cycleBashReviewMode(mode: BashReviewMode): BashReviewMode {
  const index = BASH_REVIEW_UI.findIndex((entry) => entry.value === mode);
  if (index < 0) {
    return "always";
  }
  return BASH_REVIEW_UI[(index + 1) % BASH_REVIEW_UI.length]?.value ?? "always";
}
