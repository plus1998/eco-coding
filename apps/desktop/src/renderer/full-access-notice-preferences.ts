export const FULL_ACCESS_NOTICE_STORAGE_KEY = "eco.full-access-notice-hidden";

interface StorageReader {
  getItem(key: string): string | null;
}

interface StorageWriter {
  setItem(key: string, value: string): void;
}

function browserStorage(): Storage | undefined {
  return typeof localStorage === "undefined" ? undefined : localStorage;
}

export function readFullAccessNoticeHidden(storage: StorageReader | undefined = browserStorage()): boolean {
  try {
    return storage?.getItem(FULL_ACCESS_NOTICE_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function persistFullAccessNoticeHidden(
  hidden: boolean,
  storage: StorageWriter | undefined = browserStorage(),
): void {
  try {
    storage?.setItem(FULL_ACCESS_NOTICE_STORAGE_KEY, String(hidden));
  } catch {
    // The in-memory state still applies when storage is unavailable.
  }
}
