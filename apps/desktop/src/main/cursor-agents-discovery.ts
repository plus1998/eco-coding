import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  CURSOR_AGENT_ROOTS,
  CURSOR_BUILTIN_SUBAGENT_TYPES,
  mergeCursorAgentsByPrecedence,
  parseCursorAgentFrontmatter,
  resolveCursorAgentName,
  type CursorAgentInfo,
  type CursorAgentLayout,
  type CursorAgentsListResult,
  type CursorAgentSource,
} from "../shared/cursor-agents";

export async function listDiscoveredCursorAgents(
  workspacePath?: string,
  options: { homedir?: string } = {},
): Promise<CursorAgentsListResult> {
  const homedir = options.homedir ?? os.homedir();
  const ordered: CursorAgentInfo[] = [];

  for (const root of CURSOR_AGENT_ROOTS) {
    ordered.push(
      ...(await scanAgentsDirectory(path.join(homedir, root.rel), "user", root.layout)),
    );
  }

  if (workspacePath?.trim()) {
    const resolved = path.resolve(workspacePath.trim());
    for (const root of CURSOR_AGENT_ROOTS) {
      ordered.push(
        ...(await scanAgentsDirectory(path.join(resolved, root.rel), "project", root.layout)),
      );
    }
  }

  return {
    ...(workspacePath?.trim() ? { workspacePath: path.resolve(workspacePath.trim()) } : {}),
    agents: mergeCursorAgentsByPrecedence(ordered),
    builtins: CURSOR_BUILTIN_SUBAGENT_TYPES,
    scannedAt: new Date().toISOString(),
  };
}

async function scanAgentsDirectory(
  directory: string,
  source: CursorAgentSource,
  layout: CursorAgentLayout,
): Promise<CursorAgentInfo[]> {
  let entries: Awaited<ReturnType<typeof fs.readdir>>;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isNotFound(error)) {
      return [];
    }
    throw error;
  }

  const agents: CursorAgentInfo[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) {
      continue;
    }
    const filePath = path.join(directory, entry.name);
    let content: string;
    try {
      content = await fs.readFile(filePath, "utf8");
    } catch {
      continue;
    }
    const frontmatter = parseCursorAgentFrontmatter(content);
    const name = resolveCursorAgentName(frontmatter.name, filePath);
    if (!name) {
      continue;
    }
    agents.push({
      name,
      description: frontmatter.description,
      ...(frontmatter.model ? { model: frontmatter.model } : {}),
      readonly: frontmatter.readonly,
      isBackground: frontmatter.isBackground,
      source,
      layout,
      filePath,
    });
  }
  return agents;
}

function isNotFound(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT",
  );
}
