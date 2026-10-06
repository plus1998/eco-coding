export function addOpenTaskPanelTab<T extends string>(tabs: T[], tabId: T): T[] {
  return tabs.includes(tabId) ? tabs : [...tabs, tabId];
}

export function replaceOpenTaskPanelTab<T extends string>(tabs: T[], sourceTabId: T, tabId: T): T[] {
  if (tabs.includes(tabId)) {
    return tabs.filter((openTabId) => openTabId !== sourceTabId || openTabId === tabId);
  }
  if (!tabs.includes(sourceTabId)) {
    return addOpenTaskPanelTab(tabs, tabId);
  }
  return tabs.map((openTabId) => (openTabId === sourceTabId ? tabId : openTabId));
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
