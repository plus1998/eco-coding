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
    title: "每次确认",
    subtitle: "always",
    description: "执行命令或访问工作区外路径前都询问",
  },
  {
    value: "auto",
    title: "风险时确认",
    subtitle: "auto",
    description: "低风险自动执行；高风险命令或外路径访问仍询问",
  },
  {
    value: "allow_all",
    title: "自动执行",
    subtitle: "allow",
    description: "跳过确认（仍受当前模式、编排与安全策略限制）",
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
