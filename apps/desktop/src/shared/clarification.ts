/** UI-only option label; answer submitted uses textarea content, not this label. */
export const CLARIFICATION_CUSTOM_OPTION_LABEL = "其他（自定义说明）";

export function optionRequiresCustomExplanation(label: string): boolean {
  if (label === CLARIFICATION_CUSTOM_OPTION_LABEL) {
    return true;
  }
  // Match AI options that explicitly ask for free-form input — not bare「其他」choices.
  return /请说明|请描述|请输入|请填写|自定义说明|(?:^|\b)other\b.*(?:specify|explain)|\bspecify\b|\bexplain\b/i.test(
    label,
  );
}

export function resolveClarificationQuestionAnswer(
  selectedLabels: string[],
  customText: string,
  preserveCustomText = false,
  allowCustom = true,
): string[] {
  if (!allowCustom) {
    return selectedLabels;
  }
  const trimmed = customText.trim();
  if (selectedLabels.includes(CLARIFICATION_CUSTOM_OPTION_LABEL)) {
    if (preserveCustomText && customText.length > 0) {
      return [customText];
    }
    if (trimmed) {
      return [trimmed];
    }
  }
  return selectedLabels.filter((label) => label !== CLARIFICATION_CUSTOM_OPTION_LABEL);
}

export function isClarificationQuestionReady(
  selectedLabels: string[],
  customText: string,
  preserveCustomText = false,
  allowCustom = true,
): boolean {
  if (!allowCustom) {
    return selectedLabels.length > 0;
  }
  if (selectedLabels.includes(CLARIFICATION_CUSTOM_OPTION_LABEL)) {
    return preserveCustomText ? customText.length > 0 : customText.trim().length > 0;
  }
  if (selectedLabels.length === 0) {
    return false;
  }
  if (selectedLabels.some((label) => optionRequiresCustomExplanation(label))) {
    return false;
  }
  return true;
}
