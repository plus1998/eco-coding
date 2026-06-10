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
    title: "Bash 全审",
    subtitle: "always",
    description: "每条 Bash 命令都需要你手动确认后才会执行。",
  },
  {
    value: "auto",
    title: "Bash 智能审",
    subtitle: "auto",
    description: "低风险命令自动放行；风险分数超过 85 的命令仍需确认。",
  },
  {
    value: "allow_all",
    title: "Bash 放行",
    subtitle: "allow",
    description: "默认自动执行 Bash；绝对拒绝规则（如 rm /、cwd 越界）仍然生效。",
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
