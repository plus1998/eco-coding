import os from "node:os";
import path from "node:path";

/**
 * Claude Code / Agent SDK config root.
 * Override: CLAUDE_CONFIG_DIR (same as Claude CLI).
 */
export function resolveClaudeConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.CLAUDE_CONFIG_DIR?.trim();
  if (fromEnv) {
    return path.resolve(fromEnv);
  }
  return path.join(os.homedir(), ".claude");
}

/** JSONL session transcripts: `{config}/projects/<project-key>/<sessionId>.jsonl`. */
export function resolveClaudeProjectsDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveClaudeConfigDir(env), "projects");
}

/** File checkpoint snapshots for enableFileCheckpointing. */
export function resolveClaudeFileHistoryDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveClaudeConfigDir(env), "file-history");
}

/**
 * Encode absolute workspace cwd the same way Claude Code names `projects/` subdirs:
 * path separators (and most non-alphanumerics) become `-`.
 * e.g. `/Users/me/repo` → `-Users-me-repo`
 */
export function encodeClaudeProjectDirName(cwd: string): string {
  const absolute = path.resolve(cwd.trim() || ".");
  return absolute.replace(/[^a-zA-Z0-9]/g, "-");
}

/** Project dirs created for Eco worktrees / home project (safe to prune when orphaned). */
export function isEcoClaudeProjectDirName(dirName: string): boolean {
  return (
    dirName.includes("-eco-worktrees-") ||
    dirName.includes("--eco-worktrees-") ||
    dirName.includes("-eco-projects-home") ||
    dirName.includes("--eco-projects-home")
  );
}
