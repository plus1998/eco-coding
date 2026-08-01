/** Format Codex `task_name` for UI: split `_`, capitalize each word's first letter. */
export function formatSubagentTaskNameLabel(taskName: string): string {
  const trimmed = taskName.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed
    .split("_")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function resolveSubagentActivityTitle(roleLabel: string, taskName?: string | null): string {
  const formatted = taskName ? formatSubagentTaskNameLabel(taskName) : "";
  return formatted ? `${roleLabel} ${formatted}` : roleLabel;
}

export function taskNameFromAgentPath(agentPath: string | undefined): string | undefined {
  if (!agentPath?.trim()) {
    return undefined;
  }
  const segments = agentPath
    .trim()
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  const last = segments[segments.length - 1];
  if (!last || last === "root") {
    return undefined;
  }
  return last;
}
