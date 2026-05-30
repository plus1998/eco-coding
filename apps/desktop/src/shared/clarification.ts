/** UI-only option label; answer submitted uses textarea content, not this label. */
export const CLARIFICATION_CUSTOM_OPTION_LABEL = "其他（自定义说明）";

export function optionRequiresCustomExplanation(label: string): boolean {
  return /说明|自定义|其他|other|请描述|请输入|请填写|specify|explain/i.test(label);
}

export function resolveClarificationQuestionAnswer(
  selectedLabels: string[],
  customText: string,
): string[] {
  const trimmed = customText.trim();
  if (selectedLabels.includes(CLARIFICATION_CUSTOM_OPTION_LABEL) && trimmed) {
    return [trimmed];
  }
  return selectedLabels.filter((label) => label !== CLARIFICATION_CUSTOM_OPTION_LABEL);
}

export function isClarificationQuestionReady(selectedLabels: string[], customText: string): boolean {
  if (selectedLabels.includes(CLARIFICATION_CUSTOM_OPTION_LABEL)) {
    return customText.trim().length > 0;
  }
  if (selectedLabels.length === 0) {
    return false;
  }
  if (selectedLabels.some((label) => optionRequiresCustomExplanation(label))) {
    return false;
  }
  return true;
}
