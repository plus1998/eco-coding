const STORAGE_KEY = "eco.workspace-cards.expanded";

type ExpandedMap = Record<string, boolean>;

function readMap(): ExpandedMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return parsed as ExpandedMap;
  } catch {
    return {};
  }
}

function writeMap(map: ExpandedMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore quota errors
  }
}

export function readCardExpanded(cardId: string, defaultExpanded = true): boolean {
  const map = readMap();
  if (cardId in map) {
    return map[cardId] === true;
  }
  return defaultExpanded;
}

export function persistCardExpanded(cardId: string, expanded: boolean): void {
  const map = readMap();
  map[cardId] = expanded;
  writeMap(map);
}
