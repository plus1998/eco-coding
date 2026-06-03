import fs from "node:fs/promises";
import path from "node:path";
import { createWorktreePlan } from "@eco/workspace";

export interface ApprovedPlanSnapshot {
  userPrompt: string;
  analysis: string;
  plan: string;
  planUserEdited?: boolean;
}

export function approvedPlanFilePath(workspacePath: string, threadId: string): string {
  const safeThreadId = threadId.replace(/[^a-zA-Z0-9._-]/g, "-");
  return path.join(workspacePath, ".eco", "approved-plans", `${safeThreadId}.md`);
}

export function approvedPlanRelativePath(threadId: string): string {
  const safeThreadId = threadId.replace(/[^a-zA-Z0-9._-]/g, "-");
  return `.eco/approved-plans/${safeThreadId}.md`;
}

export function formatApprovedPlanDocument(snapshot: ApprovedPlanSnapshot): string {
  const lines = [
    "# Eco approved plan",
    "",
    "## User request",
    snapshot.userPrompt.trim() || "(not captured)",
    "",
    "## Planning analysis",
    snapshot.analysis.trim() || "(no analysis captured)",
    "",
    "## Approved plan",
    snapshot.plan.trim() || "(no plan captured)",
  ];
  if (snapshot.planUserEdited) {
    lines.push("", "_User edited this plan in Eco before approval._");
  }
  return `${lines.join("\n")}\n`;
}

export async function writeApprovedPlanSnapshot(
  workspacePath: string,
  threadId: string,
  snapshot: ApprovedPlanSnapshot,
): Promise<string> {
  const filePath = approvedPlanFilePath(workspacePath, threadId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, formatApprovedPlanDocument(snapshot), "utf8");
  return filePath;
}

/** Git failed because the process cwd (worktree directory) no longer exists or is invalid. */
export function isWorktreeGitCwdError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /unable to read current working directory/i.test(message) ||
    /not a git repository/i.test(message) ||
    /fatal:.*does not exist/i.test(message)
  );
}

export function resolveWorktreePathHint(input: {
  threadId: string;
  workspacePath: string;
  activeWorktreePath?: string;
  pendingWorktreePath?: string;
  sdkSessionCwd?: string;
}): string {
  const defaultPath = createWorktreePlan(input.workspacePath, input.threadId).worktreePath;
  return (
    input.activeWorktreePath?.trim() ||
    input.pendingWorktreePath?.trim() ||
    input.sdkSessionCwd?.trim() ||
    defaultPath
  );
}
