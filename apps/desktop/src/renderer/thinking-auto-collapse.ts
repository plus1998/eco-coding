export const THINKING_AUTO_COLLAPSE_READ_MS = 7000;
export const THINKING_COLLAPSE_MS = 320;

export function shouldScheduleThinkingAutoCollapse({
  streaming,
  hasBody,
  collapsed,
  autoCollapseEligible,
  autoCollapseSuppressed,
}: {
  streaming: boolean | undefined;
  hasBody: boolean;
  collapsed: boolean;
  autoCollapseEligible: boolean;
  autoCollapseSuppressed: boolean;
}): boolean {
  return !streaming && hasBody && !collapsed && autoCollapseEligible && !autoCollapseSuppressed;
}
