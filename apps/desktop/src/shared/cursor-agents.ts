/**
 * Cursor ACP custom subagents live as Markdown files under `.cursor/agents/`
 * (plus Claude/Codex compatibility dirs). See https://cursor.com/docs/subagents
 *
 * Eco only discovers these for a read-only session roster. Cursor loads and runs them;
 * there is no ACP API to enable/disable or inject them per thread.
 */

export type CursorAgentSource = "user" | "project";
export type CursorAgentLayout = "cursor" | "claude" | "codex";

export const CURSOR_AGENTS_REL = ".cursor/agents" as const;
export const CLAUDE_AGENTS_REL = ".claude/agents" as const;
export const CODEX_AGENTS_REL = ".codex/agents" as const;

/** Lowest → highest precedence when names collide (Cursor docs). */
export const CURSOR_AGENT_ROOTS = [
  { rel: CODEX_AGENTS_REL, layout: "codex" as const },
  { rel: CLAUDE_AGENTS_REL, layout: "claude" as const },
  { rel: CURSOR_AGENTS_REL, layout: "cursor" as const },
] as const;

/** Built-in Cursor ACP `cursor/task` subagentType strings (excluding unspecified). */
export const CURSOR_BUILTIN_SUBAGENT_TYPES = [
  "explore",
  "shell",
  "browser_use",
  "computer_use",
  "video_review",
  "vm_setup_helper",
] as const;

export type CursorBuiltinSubagentType = (typeof CURSOR_BUILTIN_SUBAGENT_TYPES)[number];

export interface CursorAgentInfo {
  /** Identifier used in Task / `{ custom: name }` (frontmatter name or filename stem). */
  name: string;
  description: string;
  model?: string;
  readonly: boolean;
  isBackground: boolean;
  source: CursorAgentSource;
  layout: CursorAgentLayout;
  filePath: string;
}

export interface CursorAgentsListResult {
  workspacePath?: string;
  /** Deduped custom agents (project wins over user; .cursor over .claude/.codex). */
  agents: CursorAgentInfo[];
  /** Always-available Cursor built-ins for ACP `cursor/task`. */
  builtins: readonly CursorBuiltinSubagentType[];
  scannedAt: string;
}

export type CursorAgentFrontmatter = {
  name: string;
  description: string;
  model?: string;
  readonly: boolean;
  isBackground: boolean;
};

export function parseCursorAgentFrontmatter(content: string): CursorAgentFrontmatter {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    return { name: "", description: "", readonly: false, isBackground: false };
  }
  const block = match[1] ?? "";
  const name = readYamlScalar(block, "name");
  const description = readYamlString(block, "description");
  const model = readYamlScalar(block, "model") || undefined;
  return {
    name,
    description,
    ...(model ? { model } : {}),
    readonly: readYamlBoolean(block, "readonly") === true,
    isBackground: readYamlBoolean(block, "is_background") === true,
  };
}

/** Prefer frontmatter name; fall back to file stem (Cursor default). */
export function resolveCursorAgentName(frontmatterName: string, filePath: string): string {
  const fromFrontmatter = frontmatterName.trim();
  if (fromFrontmatter) {
    return fromFrontmatter;
  }
  const base = filePath.replace(/\\/g, "/").split("/").pop() ?? "";
  return base.replace(/\.md$/i, "").trim();
}

/**
 * Merge agents so higher-precedence entries win on `name` (case-insensitive).
 * Call with lowest-priority first.
 */
export function mergeCursorAgentsByPrecedence(
  entries: readonly CursorAgentInfo[],
): CursorAgentInfo[] {
  const byName = new Map<string, CursorAgentInfo>();
  for (const entry of entries) {
    const key = entry.name.trim().toLowerCase();
    if (!key) continue;
    byName.set(key, entry);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function readYamlScalar(block: string, key: string): string {
  const pattern = new RegExp(`^${key}:\\s*(.*)$`, "m");
  const match = block.match(pattern);
  if (!match) {
    return "";
  }
  let value = (match[1] ?? "").trim();
  if (value === "|" || value === ">" || value === "|-" || value === ">-") {
    return "";
  }
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return value;
}

function readYamlString(block: string, key: string): string {
  const lines = block.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const header = line.match(new RegExp(`^${key}:\\s*(.*)$`));
    if (!header) continue;
    const rest = (header[1] ?? "").trim();
    if (rest === "|" || rest === ">" || rest === "|-" || rest === ">-") {
      const rawBody: string[] = [];
      for (let j = i + 1; j < lines.length; j += 1) {
        const next = lines[j] ?? "";
        if (/^\S/.test(next)) {
          break;
        }
        rawBody.push(next);
      }
      const nonEmpty = rawBody.filter((line) => line.trim().length > 0);
      const indentMatch = nonEmpty[0]?.match(/^\s*/)?.[0] ?? "";
      const indent = indentMatch.length;
      return rawBody
        .map((line) => (indent > 0 && line.startsWith(indentMatch) ? line.slice(indent) : line.trimStart()))
        .join("\n")
        .trim();
    }
    if (
      (rest.startsWith('"') && rest.endsWith('"')) ||
      (rest.startsWith("'") && rest.endsWith("'"))
    ) {
      return rest.slice(1, -1);
    }
    return rest;
  }
  return "";
}

function readYamlBoolean(block: string, key: string): boolean | undefined {
  const raw = readYamlScalar(block, key).toLowerCase();
  if (!raw) return undefined;
  if (raw === "true" || raw === "yes" || raw === "1") return true;
  if (raw === "false" || raw === "no" || raw === "0") return false;
  return undefined;
}
