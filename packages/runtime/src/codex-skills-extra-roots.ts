import path from "node:path";
import type { CodexAppServerClient } from "./codex-app-server-client.js";

export const CODEX_SKILLS_EXTRA_ROOTS_SET_METHOD = "skills/extraRoots/set";

export interface CodexSkillsExtraRootsSetParams {
  extraRoots: string[];
}

export function buildCodexSkillsExtraRootsSetParams(
  extraRoots: readonly string[],
): CodexSkillsExtraRootsSetParams {
  const normalized = new Set<string>();
  for (const [index, root] of extraRoots.entries()) {
    if (typeof root !== "string" || !root.trim()) {
      throw new Error(`Codex skills extraRoots[${index}] must be a non-empty absolute path.`);
    }
    if (!path.isAbsolute(root.trim())) {
      throw new Error(`Codex skills extraRoots[${index}] must be an absolute path.`);
    }
    normalized.add(path.resolve(root.trim()));
  }
  return { extraRoots: [...normalized] };
}

export async function setCodexSkillsExtraRoots(
  client: Pick<CodexAppServerClient, "request">,
  extraRoots: readonly string[],
): Promise<void> {
  const response = await client.request<unknown>(
    CODEX_SKILLS_EXTRA_ROOTS_SET_METHOD,
    buildCodexSkillsExtraRootsSetParams(extraRoots),
  );
  if (
    typeof response !== "object" ||
    response === null ||
    Array.isArray(response) ||
    Object.keys(response).length > 0
  ) {
    throw new Error("Codex skills/extraRoots/set response must be an empty object.");
  }
}
