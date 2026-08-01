/** Shared activity text repair (main + renderer). */

const suspiciousPatterns = [
  /\b[A-Za-z]\s+[A-Z][a-z]+\s+[A-Z][a-z]+\b/,
  /\b(is|are|the|to|and)\s+[A-Z][a-z]{1,3}\s+[A-Z]/,
  /[a-z](there|have|been|will|this|that|with)[a-z]/i,
];

// OpenAI web citations are private-use rich-text tokens, not Markdown.
const inlineWebCitation = /\uE200cite(?:\uE202[^\uE201]+)+\uE201/g;

const ROLES_SKIP_SUSPICIOUS_LOG = new Set(["thinking", "system"]);

const loggedSuspiciousActivityKeys = new Set<string>();

export function repairActivityText(text: string): { text: string; repaired: boolean; suspicious: boolean } {
  let output = text;
  let repaired = false;

  const withoutInlineCitations = output.replace(inlineWebCitation, "");
  if (withoutInlineCitations !== output) {
    output = withoutInlineCitations;
    repaired = true;
  }

  const normalized = output.replace(/\u200b/g, "").replace(/\r\n/g, "\n");
  if (normalized !== output) {
    output = normalized;
    repaired = true;
  }

  const collapsed = output.replace(/[ \t]{2,}/g, " ");
  if (collapsed !== output) {
    output = collapsed;
    repaired = true;
  }

  const suspicious = suspiciousPatterns.some((pattern) => pattern.test(output.slice(0, 2000)));
  return { text: output, repaired, suspicious };
}

/** Log at most once per activity line; skips internal roles like thinking. */
export function logSuspiciousActivityLine(
  threadId: string,
  line: { id: string; role: string; message: string },
): void {
  if (ROLES_SKIP_SUSPICIOUS_LOG.has(line.role)) {
    return;
  }

  const key = `${threadId}:${line.id}`;
  if (loggedSuspiciousActivityKeys.has(key)) {
    return;
  }

  const { text, repaired, suspicious } = repairActivityText(line.message);
  if (!suspicious && !repaired) {
    return;
  }

  loggedSuspiciousActivityKeys.add(key);
  console.warn("[eco][activity-text]", {
    threadId,
    lineId: line.id,
    role: line.role,
    repaired,
    suspicious,
    preview: text.slice(0, 240),
    originalPreview: line.message.slice(0, 240),
  });
}

/** @deprecated Prefer logSuspiciousActivityLine on append; listing must not re-log. */
export function logSuspiciousActivityLines(
  threadId: string,
  lines: Array<{ id: string; role: string; message: string }>,
): void {
  for (const line of lines) {
    logSuspiciousActivityLine(threadId, line);
  }
}

/** Test-only: reset dedupe cache. */
export function resetSuspiciousActivityLogCache(): void {
  loggedSuspiciousActivityKeys.clear();
}
