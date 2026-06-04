import type { SdkToolPermissionDecision, SdkToolPermissionRequest } from "./claude-agent-sdk";
import type { SdkToolPermissionHandler } from "./ask-user-question";

export const REVIEWER_SCOPE_SECTION_TITLE = "## Changed files (this session)";

/** Block prepended to Agent(reviewer) prompts with the worktree delta file list. */
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

function readAgentSubagentType(input: Record<string, unknown>): string | undefined {
  if (typeof input.subagent_type === "string" && input.subagent_type.trim()) {
    return input.subagent_type.trim();
  }
  if (typeof input.agent_type === "string" && input.agent_type.trim()) {
    return input.agent_type.trim();
  }
  return undefined;
}

/** Injects workspace changed-files into Agent(reviewer) delegation prompts. */
export function createReviewerScopeToolHandler(
  resolveChangedFiles: () => Promise<readonly string[]>,
): SdkToolPermissionHandler {
  return async (request): Promise<SdkToolPermissionDecision> => {
    if (request.toolName !== "Agent") {
      return { behavior: "allow", updatedInput: request.input };
    }

    if (readAgentSubagentType(request.input) !== "reviewer") {
      return { behavior: "allow", updatedInput: request.input };
    }

    const changedFiles = await resolveChangedFiles();
    const prompt = typeof request.input.prompt === "string" ? request.input.prompt : "";

    return {
      behavior: "allow",
      updatedInput: {
        ...request.input,
        prompt: appendReviewerScopeToPrompt(prompt, changedFiles),
      },
    };
  };
}
