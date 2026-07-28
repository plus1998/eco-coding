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
    title: "bash.review.always",
    subtitle: "always",
    description: "bash.review.alwaysDesc",
  },
  {
    value: "auto",
    title: "bash.review.auto",
    subtitle: "auto",
    description: "bash.review.autoDesc",
  },
  {
    value: "allow_all",
    title: "bash.review.allowAll",
    subtitle: "allow",
    description: "bash.review.allowAllDesc",
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
