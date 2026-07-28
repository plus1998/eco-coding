export function addOpenTaskPanelTab<T extends string>(tabs: T[], tabId: T): T[] {
  return tabs.includes(tabId) ? tabs : [...tabs, tabId];
}

export function removeOpenTaskPanelTab<T extends string>(
  tabs: readonly T[],
  tabId: T,
): { tabs: T[]; fallback?: T } {
  const removedIndex = tabs.indexOf(tabId);
  if (removedIndex < 0) {
    return { tabs: [...tabs] };
  }

  const next = tabs.filter((openTabId) => openTabId !== tabId);
  const fallback = next[Math.max(0, removedIndex - 1)];
  return fallback ? { tabs: next, fallback } : { tabs: next };
}
