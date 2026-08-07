export type StorageCategoryId =
  | "database"
  | "logs"
  | "claudeSessions"
  | "codexCheckpoints"
  | "codexHome"
  | "otherUserData";

export type StorageUnmeteredId = never;

export interface StorageCategoryUsage {
  id: StorageCategoryId;
  path: string;
  bytes: number;
  exists: boolean;
  detail?: {
    threadCount?: number;
    fileCount?: number;
  };
}

export interface StorageUnmeteredItem {
  id: string;
  reason: string;
}

export interface StorageUsageSnapshot {
  totalBytes: number;
  categories: StorageCategoryUsage[];
  unmetered: StorageUnmeteredItem[];
}

export type StorageCleanupAction =
  | "clearLogs"
  | "clearCodexCheckpoints"
  | "clearCodexHomeCaches"
  | "clearClaudeSessions"
  | "clearAllConversations"
  | "vacuumDatabase";

export interface StorageCleanupRequest {
  action: StorageCleanupAction;
  options?: {
    /** Only for clearLogs: delete upstream-*.log older than N days (mtime). */
    olderThanDays?: number;
    /**
     * For clearCodexCheckpoints: remove dirs whose thread is not in DB.
     * For clearClaudeSessions: remove only Eco worktree project dirs with no active Eco session.
     */
    orphansOnly?: boolean;
  };
}

export interface StorageCleanupResult {
  ok: boolean;
  freedBytes?: number;
  deletedCount?: number;
  skippedThreadIds?: string[];
  errors?: string[];
  message?: string;
}
