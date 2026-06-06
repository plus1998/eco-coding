import type { SdkToolPermissionDecision, SdkToolPermissionRequest } from "./claude-agent-sdk";
import type { SdkToolPermissionHandler } from "./ask-user-question";
import { normalizeAgentToolInputSubagentType } from "./subagent-resume.js";

export const REVIEWER_SCOPE_SECTION_TITLE = "## Changed files (this session)";

/** Block prepended to reviewer subagent prompts with the worktree delta file list. */
export function formatReviewerScopeAppend(changedFiles: readonly string[]): string {
  const paths = changedFiles.map((file) => file.trim()).filter(Boolean);
  const list =
    paths.length > 0
      ? paths.map((file) => `- ${file}`).join("\n")
      : "- (none — workspace matches HEAD; confirm coders finished before PASS)";

  return [
    REVIEWER_SCOPE_SECTION_TITLE,
    "Eco injected this list from the workspace (session diff vs HEAD).",
    "Review ONLY these paths. Do NOT diff against main/master or audit unrelated history.",
    "You may run `git diff HEAD -- <path>` for line context on these files only.",
    "",
    list,
  ].join("\n");
}

export function appendReviewerScopeToPrompt(
  prompt: string,
  changedFiles: readonly string[],
): string {
  const scopeBlock = formatReviewerScopeAppend(changedFiles);
  const trimmed = prompt.trim();
  return trimmed ? `${scopeBlock}\n\n${trimmed}` : scopeBlock;
}

/** Injects workspace changed-files into reviewer subagent delegation prompts. */
export function createReviewerScopeToolHandler(
  resolveChangedFiles: () => Promise<readonly string[]>,
): SdkToolPermissionHandler {
  return async (request): Promise<SdkToolPermissionDecision> => {
    if (request.toolName !== "Agent") {
      return { behavior: "allow", updatedInput: request.input };
    }

    const { input, role } = normalizeAgentToolInputSubagentType(request.input);
    if (role !== "reviewer") {
      return { behavior: "allow", updatedInput: request.input };
    }

    const changedFiles = await resolveChangedFiles();
    const prompt = typeof input.prompt === "string" ? input.prompt : "";

    return {
      behavior: "allow",
      updatedInput: {
        ...input,
        prompt: appendReviewerScopeToPrompt(prompt, changedFiles),
      },
    };
  };
}
