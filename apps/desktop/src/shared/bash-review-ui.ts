import type { BashReviewMode } from "../../../../packages/bash-policy/src";

export type { BashReviewMode };

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

export const BASH_REVIEW_MODES = BASH_REVIEW_UI.map((option) => option.value);

export function isBashReviewMode(value: unknown): value is BashReviewMode {
  return value === "always" || value === "auto" || value === "allow_all";
}

export function normalizeBashReviewMode(value: unknown): BashReviewMode {
  return isBashReviewMode(value) ? value : "always";
}

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

/** Returns true when the caller may proceed to enable full access. */
export function confirmFullAccessBashReviewMode(
  confirm: (message: string) => boolean,
  message: string,
): boolean {
  return confirm(message);
}
