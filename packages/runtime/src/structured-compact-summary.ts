export const STRUCTURED_COMPACT_HEADINGS = [
  "任务目标",
  "已读/已改文件",
  "测试结果与错误",
  "已做决策",
  "未完成事项",
] as const;

export type StructuredCompactHeading = (typeof STRUCTURED_COMPACT_HEADINGS)[number];

export type StructuredCompactSections = Partial<Record<StructuredCompactHeading, string>>;

export function structuredCompactInstructionSuffix(context: "thread" | "subagent"): string {
  const subject = context === "subagent" ? "子代理输出" : "较早的用户消息";
  return [
    `请将以下编码对话中${subject}压缩为结构化摘要。`,
    "必须按以下二级标题逐段输出（无内容的段落写「无」）：",
    ...STRUCTURED_COMPACT_HEADINGS.map((heading) => `## ${heading}`),
    "使用与原任务相同的语言。只输出摘要正文，不要额外解释压缩过程。",
  ].join("\n");
}

export function formatStructuredCompactSections(sections: StructuredCompactSections): string {
  return STRUCTURED_COMPACT_HEADINGS.map((heading) => {
    const body = sections[heading]?.trim() || "无";
    return `## ${heading}\n${body}`;
  }).join("\n\n");
}

export function parseStructuredCompactSections(text: string): StructuredCompactSections {
  const sections: StructuredCompactSections = {};
  const normalized = text.trim();
  if (!normalized) {
    return sections;
  }

  let currentHeading: StructuredCompactHeading | undefined;
  const lines = normalized.split("\n");
  const bodyLines: string[] = [];

  const flush = () => {
    if (!currentHeading) {
      return;
    }
    const body = bodyLines.join("\n").trim();
    if (body && body !== "无") {
      sections[currentHeading] = body;
    }
    bodyLines.length = 0;
  };

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+?)\s*$/u);
    if (headingMatch?.[1]) {
      flush();
      const heading = headingMatch[1].trim() as StructuredCompactHeading;
      if ((STRUCTURED_COMPACT_HEADINGS as readonly string[]).includes(heading)) {
        currentHeading = heading;
        continue;
      }
      currentHeading = undefined;
      bodyLines.push(line);
      continue;
    }
    if (currentHeading) {
      bodyLines.push(line);
    }
  }
  flush();
  return sections;
}

export function buildStructuredCompactFallback(input: {
  taskGoal?: string;
  filePaths?: readonly string[];
  testResults?: readonly string[];
  decisions?: readonly string[];
  pending?: readonly string[];
  olderMessages?: readonly string[];
}): string {
  const filePaths = uniqueNonEmpty(input.filePaths ?? []);
  const testResults = uniqueNonEmpty(input.testResults ?? []);
  const decisions = uniqueNonEmpty(input.decisions ?? []);
  const pending = uniqueNonEmpty(input.pending ?? []);
  const olderBullets = (input.olderMessages ?? [])
    .map((message) => message.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(-6);

  return formatStructuredCompactSections({
    任务目标: input.taskGoal?.trim() || olderBullets[0] || "无",
    "已读/已改文件": filePaths.length > 0 ? filePaths.join("\n") : "无",
    "测试结果与错误": testResults.length > 0 ? testResults.join("\n") : "无",
    已做决策: decisions.length > 0 ? decisions.join("\n") : summarizeOlderMessages(olderBullets),
    未完成事项: pending.length > 0 ? pending.join("\n") : "无",
  });
}

function summarizeOlderMessages(messages: readonly string[]): string {
  if (messages.length === 0) {
    return "无";
  }
  return messages.map((message, index) => `${index + 1}. ${clampLine(message, 280)}`).join("\n");
}

function uniqueNonEmpty(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    output.push(trimmed);
  }
  return output;
}

function clampLine(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 1)}…`;
}
