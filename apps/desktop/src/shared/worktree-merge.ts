export interface FileDiffStat {
  path: string;
  additions: number;
  deletions: number;
}

export interface WorktreeMergeSummary {
  fileCount: number;
  files: FileDiffStat[];
  totalAdditions: number;
  totalDeletions: number;
}

export const WORKTREE_MERGE_MESSAGE_PREFIX = "__eco_worktree_merge__\n";

const LEGACY_WORKTREE_MERGE_PATTERN = /^已合并\s*(\d+)\s*个文件的更改到工作区（未自动提交）[：:]\s*(.*)$/u;

export function parseUnifiedDiffStats(diff: string): WorktreeMergeSummary {
  const fileStats = new Map<string, { additions: number; deletions: number }>();
  let currentPath: string | undefined;
  let additions = 0;
  let deletions = 0;

  for (const rawLine of diff.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line.startsWith("diff --git ")) {
      if (currentPath) {
        const existing = fileStats.get(currentPath) ?? { additions: 0, deletions: 0 };
        fileStats.set(currentPath, {
          additions: existing.additions + additions,
          deletions: existing.deletions + deletions,
        });
      }
      additions = 0;
      deletions = 0;
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      currentPath = match?.[2] ?? match?.[1];
      continue;
    }
    if (line.startsWith("+++ ")) {
      const path = line.slice(4).trim();
      if (path !== "/dev/null") {
        currentPath = path.startsWith("b/") ? path.slice(2) : path;
      }
      continue;
    }
    if (!currentPath || line.startsWith("--- ") || line.startsWith("@@")) {
      continue;
    }
    if (line.startsWith("+")) {
      additions += 1;
    } else if (line.startsWith("-")) {
      deletions += 1;
    }
  }

  if (currentPath) {
    const existing = fileStats.get(currentPath) ?? { additions: 0, deletions: 0 };
    fileStats.set(currentPath, {
      additions: existing.additions + additions,
      deletions: existing.deletions + deletions,
    });
  }

  const files = [...fileStats.entries()]
    .map(([path, stats]) => ({
      path,
      additions: stats.additions,
      deletions: stats.deletions,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

  let totalAdditions = 0;
  let totalDeletions = 0;
  for (const file of files) {
    totalAdditions += file.additions;
    totalDeletions += file.deletions;
  }

  return {
    fileCount: files.length,
    files,
    totalAdditions,
    totalDeletions,
  };
}

export function buildWorktreeMergeSummary(diff: string, filePaths: readonly string[]): WorktreeMergeSummary {
  const fromDiff = parseUnifiedDiffStats(diff);
  if (fromDiff.files.length > 0) {
    return {
      ...fromDiff,
      fileCount: Math.max(fromDiff.fileCount, filePaths.length),
    };
  }

  const files = filePaths.map((path) => ({
    path,
    additions: 0,
    deletions: 0,
  }));

  return {
    fileCount: files.length,
    files,
    totalAdditions: 0,
    totalDeletions: 0,
  };
}

export function serializeWorktreeMergeMessage(summary: WorktreeMergeSummary): string {
  return `${WORKTREE_MERGE_MESSAGE_PREFIX}${JSON.stringify(summary)}`;
}

export function formatWorktreeMergeThreadMessage(fileCount: number): string {
  return `已合并 ${fileCount} 个文件到工作区（未自动提交）`;
}

function parseLegacyWorktreeMergeMessage(text: string): WorktreeMergeSummary | null {
  const trimmed = text.trim();
  const match = LEGACY_WORKTREE_MERGE_PATTERN.exec(trimmed);
  if (!match) {
    return null;
  }
  const fileCount = Number.parseInt(match[1] ?? "0", 10);
  if (!Number.isFinite(fileCount) || fileCount < 0) {
    return null;
  }
  const rawFiles = (match[2] ?? "").trim();
  const paths = rawFiles
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const files = paths.map((path) => ({ path, additions: 0, deletions: 0 }));
  return {
    fileCount: Math.max(fileCount, files.length),
    files,
    totalAdditions: 0,
    totalDeletions: 0,
  };
}

export function parseWorktreeMergeMessage(text: string): WorktreeMergeSummary | null {
  const trimmed = text.trim();
  if (trimmed.startsWith(WORKTREE_MERGE_MESSAGE_PREFIX)) {
    try {
      const parsed = JSON.parse(trimmed.slice(WORKTREE_MERGE_MESSAGE_PREFIX.length)) as WorktreeMergeSummary;
      if (!parsed || !Array.isArray(parsed.files)) {
        return null;
      }
      const files = parsed.files
        .map((file) => ({
          path: String(file.path ?? "").trim(),
          additions: Number(file.additions) || 0,
          deletions: Number(file.deletions) || 0,
        }))
        .filter((file) => file.path.length > 0);
      const totalAdditions = files.reduce((sum, file) => sum + file.additions, 0);
      const totalDeletions = files.reduce((sum, file) => sum + file.deletions, 0);
      return {
        fileCount: Number(parsed.fileCount) || files.length,
        files,
        totalAdditions: Number(parsed.totalAdditions) || totalAdditions,
        totalDeletions: Number(parsed.totalDeletions) || totalDeletions,
      };
    } catch {
      return null;
    }
  }
  return parseLegacyWorktreeMergeMessage(trimmed);
}

export function isWorktreeMergeMessage(text: string): boolean {
  return parseWorktreeMergeMessage(text) !== null;
}
