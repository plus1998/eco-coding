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

function sectionBody(markdown: string, heading: string): string {
  const pattern = new RegExp(`## ${heading}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`, "i");
  const match = markdown.match(pattern);
  return match?.[1]?.trim() ?? "";
}

/** Parse `.eco/approved-plans/<thread>.md` written by {@link formatApprovedPlanDocument}. */
export function parseApprovedPlanDocument(text: string): ApprovedPlanSnapshot | undefined {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }
  const userPrompt = sectionBody(trimmed, "User request");
  const analysis = sectionBody(trimmed, "Planning analysis");
  const plan = sectionBody(trimmed, "Approved plan");
  if (!plan) {
    return undefined;
  }
  const planUserEdited = /edited this plan in Eco before approval/i.test(trimmed);
  return {
    userPrompt: userPrompt === "(not captured)" ? "" : userPrompt,
    analysis: analysis === "(no analysis captured)" ? "" : analysis,
    plan,
    ...(planUserEdited ? { planUserEdited: true } : {}),
  };
}

export async function readApprovedPlanSnapshot(
  workspacePath: string,
  threadId: string,
): Promise<ApprovedPlanSnapshot | undefined> {
  const filePath = approvedPlanFilePath(workspacePath, threadId);
  try {
    const text = await fs.readFile(filePath, "utf8");
    return parseApprovedPlanDocument(text);
  } catch {
    return undefined;
  }
}

export function resolveClaudePlanAbsolutePath(workspacePath: string, planFilePath: string): string {
  const trimmed = planFilePath.trim();
  if (!trimmed) {
    return "";
  }
  return path.isAbsolute(trimmed) ? trimmed : path.join(workspacePath, trimmed);
}

export async function claudePlanFileExists(workspacePath: string, planFilePath: string): Promise<boolean> {
  const absolute = resolveClaudePlanAbsolutePath(workspacePath, planFilePath);
  if (!absolute) {
    return false;
  }
  try {
    await fs.access(absolute);
    return true;
  } catch {
    return false;
  }
}

export async function readClaudePlanFile(
  workspacePath: string,
  planFilePath: string,
): Promise<string | undefined> {
  const absolute = resolveClaudePlanAbsolutePath(workspacePath, planFilePath);
  if (!absolute) {
    return undefined;
  }
  try {
    const text = await fs.readFile(absolute, "utf8");
    return text.trim() || undefined;
  } catch {
    return undefined;
  }
}

/** @deprecated Legacy `.eco/approved-plans/` snapshots; new threads use Claude `.claude/plans/`. */
export async function approvedPlanSnapshotExists(
  workspacePath: string,
  threadId: string,
): Promise<boolean> {
  try {
    await fs.access(approvedPlanFilePath(workspacePath, threadId));
    return true;
  } catch {
    return false;
  }
}

export async function deleteApprovedPlanSnapshotIfNewerThan(
  workspacePath: string,
  threadId: string,
  cutoffIso: string,
): Promise<boolean> {
  const cutoffMs = Date.parse(cutoffIso);
  if (!Number.isFinite(cutoffMs)) {
    return false;
  }
  const filePath = approvedPlanFilePath(workspacePath, threadId);
  try {
    const stat = await fs.stat(filePath);
    if (stat.mtimeMs < cutoffMs) {
      return false;
    }
    await fs.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Git failed because the process cwd (worktree directory) no longer exists or is invalid. */
export function isWorktreeGitCwdError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /unable to read current working directory/i.test(message) ||
    /not a git repository/i.test(message) ||
    /fatal:.*does not exist/i.test(message) ||
    /failed to list untracked files/i.test(message)
  );
}

export function resolveWorktreePathHint(input: {
  threadId: string;
  workspacePath: string;
  activeWorktreePath?: string;
  pendingWorktreePath?: string;
  sdkSessionCwd?: string;
  coreSessionCwd?: string;
}): string {
  const defaultPath = createWorktreePlan(input.workspacePath, input.threadId).worktreePath;
  return (
    input.activeWorktreePath?.trim() ||
    input.pendingWorktreePath?.trim() ||
    input.sdkSessionCwd?.trim() ||
    input.coreSessionCwd?.trim() ||
    defaultPath
  );
}
