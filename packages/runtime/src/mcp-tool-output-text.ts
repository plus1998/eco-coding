/**
 * Codex MCP tool items carry their result under several field names depending on the
 * server and protocol version — a flattened `aggregatedOutput` string, or the raw MCP
 * `result` / `content` parts. Readers that only need "the text the tool returned" share
 * this walk so a new field name is taught in one place.
 */
const RESULT_TEXT_KEYS = ["aggregatedOutput", "result", "output", "response", "content", "text"] as const;

export function readMcpToolOutputText(item: unknown): string | undefined {
  if (!isRecord(item)) {
    return undefined;
  }
  for (const key of RESULT_TEXT_KEYS) {
    const text = readTextValue(item[key]);
    if (text) {
      return text;
    }
  }
  return undefined;
}

/** A plain string, an MCP `content` parts array, or a `{ content | text }` wrapper. */
function readTextValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.trim() || undefined;
  }
  if (Array.isArray(value)) {
    return joinTextParts(value);
  }
  if (!isRecord(value)) {
    return undefined;
  }
  if (Array.isArray(value.content)) {
    const joined = joinTextParts(value.content);
    if (joined) return joined;
  }
  return typeof value.text === "string" ? value.text.trim() || undefined : undefined;
}

function joinTextParts(parts: readonly unknown[]): string | undefined {
  const joined = parts
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (isRecord(entry) && typeof entry.text === "string") return entry.text;
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
  return joined || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
