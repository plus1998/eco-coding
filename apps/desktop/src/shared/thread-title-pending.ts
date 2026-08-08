/** Placeholder titles that mean auto-title has not succeeded yet. */
export const PENDING_THREAD_TITLE_ZH = "新任务";
export const PENDING_THREAD_TITLE_EN = "New Task";
/** Historical placeholder still treated as an auto-generated title. */
export const LEGACY_PENDING_THREAD_TITLES = ["新编码任务"] as const;

export const pendingThreadTitles = new Set<string>([
  PENDING_THREAD_TITLE_ZH,
  PENDING_THREAD_TITLE_EN,
  ...LEGACY_PENDING_THREAD_TITLES,
]);

/** True when the visible thread title is still a default / replaceable placeholder. */
export function isPendingThreadTitle(title: string): boolean {
  return pendingThreadTitles.has(title.trim());
}

/** A title may be regenerated only while it is still the original placeholder. */
export function canRegenerateThreadTitle(title: string, titleGenerating: boolean): boolean {
  return !titleGenerating && isPendingThreadTitle(title);
}
