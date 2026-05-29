/** Shared activity text repair (main + renderer). */

const suspiciousPatterns = [
  /\b[A-Za-z]\s+[A-Z][a-z]+\s+[A-Z][a-z]+\b/,
  /\b(is|are|the|to|and)\s+[A-Z][a-z]{1,3}\s+[A-Z]/,
  /[a-z](there|have|been|will|this|that|with)[a-z]/i,
];

export function repairActivityText(text: string): { text: string; repaired: boolean; suspicious: boolean } {
  let output = text;
  let repaired = false;

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

export function logSuspiciousActivityLines(
  threadId: string,
  lines: Array<{ id: string; role: string; message: string }>,
): void {
  for (const line of lines) {
    const { text, repaired, suspicious } = repairActivityText(line.message);
    if (!suspicious && !repaired) {
      continue;
    }
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
}
