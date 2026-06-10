import fs from "node:fs/promises";
import path from "node:path";
import { extractPlanningDeliverables } from "./phase-deliverable.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractAssistantTextFromTranscriptEntry(entry: Record<string, unknown>): string {
  const message = entry.message;
  if (!isRecord(message)) {
    return "";
  }
  const content = message.content;
  if (typeof content === "string" && content.trim()) {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const chunks: string[] = [];
  for (const block of content) {
    if (isRecord(block) && block.type === "text" && typeof block.text === "string" && block.text.trim()) {
      chunks.push(block.text.trim());
    }
  }
  return chunks.join("\n");
}

/** Normalize SDK-injected plan file paths to workspace-relative POSIX paths for prompts. */
export function toWorkspaceRelativePlanFile(planFilePath: string, workspacePath: string): string {
  const trimmed = planFilePath.trim();
  if (!trimmed) {
    return "";
  }
  const workspace = workspacePath.trim();
  const absolute = path.isAbsolute(trimmed) ? trimmed : path.resolve(workspace, trimmed);
  if (!workspace) {
    return trimmed.split(path.sep).join("/");
  }
  const relative = path.relative(workspace, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return trimmed.split(path.sep).join("/");
  }
  return relative.split(path.sep).join("/");
}

export function resolvePlanFileAbsolutePath(planFilePath: string, workspacePath: string): string {
  const trimmed = planFilePath.trim();
  if (!trimmed) {
    return "";
  }
  const workspace = workspacePath.trim();
  return path.isAbsolute(trimmed) ? trimmed : path.resolve(workspace || process.cwd(), trimmed);
}

export async function readPlanFileContent(
  workspacePath: string,
  planFilePath: string,
): Promise<string | undefined> {
  const absolute = resolvePlanFileAbsolutePath(planFilePath, workspacePath);
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

/** Read the newest markdown plan Claude Code wrote under `.claude/plans/`. */
export async function readLatestClaudePlanFile(
  workspacePath: string,
): Promise<{ content: string; planFilePath: string } | undefined> {
  const workspace = workspacePath.trim();
  if (!workspace) {
    return undefined;
  }
  const plansDir = path.join(workspace, ".claude", "plans");
  try {
    const entries = await fs.readdir(plansDir);
    let latest: { content: string; planFilePath: string; mtimeMs: number } | undefined;
    for (const entry of entries) {
      if (!entry.endsWith(".md")) {
        continue;
      }
      const absolute = path.join(plansDir, entry);
      const stat = await fs.stat(absolute);
      const content = (await fs.readFile(absolute, "utf8")).trim();
      if (!content) {
        continue;
      }
      if (!latest || stat.mtimeMs > latest.mtimeMs) {
        latest = {
          content,
          planFilePath: toWorkspaceRelativePlanFile(absolute, workspace),
          mtimeMs: stat.mtimeMs,
        };
      }
    }
    return latest ? { content: latest.content, planFilePath: latest.planFilePath } : undefined;
  } catch {
    return undefined;
  }
}

/** Parse SDK session transcript JSONL for the latest assistant plan markdown. */
export async function readPlanFromSdkTranscriptPath(
  transcriptPath: string,
): Promise<{ plan: string; analysis: string } | undefined> {
  const trimmed = transcriptPath.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const raw = await fs.readFile(trimmed, "utf8");
    const assistantParts: string[] = [];
    for (const line of raw.split("\n")) {
      const entryLine = line.trim();
      if (!entryLine) {
        continue;
      }
      try {
        const entry = JSON.parse(entryLine) as Record<string, unknown>;
        if (entry.type === "assistant" || entry.role === "assistant") {
          const text = extractAssistantTextFromTranscriptEntry(entry);
          if (text) {
            assistantParts.push(text);
          }
        }
      } catch {
        continue;
      }
    }
    const deliverables = extractPlanningDeliverables(assistantParts.join("\n\n"));
    return deliverables.plan.trim() ? deliverables : undefined;
  } catch {
    return undefined;
  }
}

export function readPlanFromPhaseTranscript(
  transcript: string,
): { plan: string; analysis: string } | undefined {
  const deliverables = extractPlanningDeliverables(transcript);
  return deliverables.plan.trim() ? deliverables : undefined;
}
