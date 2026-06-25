export const DEFAULT_MAX_TOOL_OUTPUT_CHARS = 8_000;

export const TOOL_OUTPUT_TRUNCATION_NOTICE =
  "\n\n…（输出已截断，完整内容未写入上下文；详见运行日志提示）";

export interface ToolOutputLimitResult {
  text: string;
  truncated: boolean;
  originalChars: number;
  keptChars: number;
}

export function limitToolOutputForContext(
  output: string,
  maxChars: number = DEFAULT_MAX_TOOL_OUTPUT_CHARS,
): ToolOutputLimitResult {
  const trimmed = output.trim();
  const originalChars = trimmed.length;
  if (originalChars <= maxChars) {
    return {
      text: trimmed,
      truncated: false,
      originalChars,
      keptChars: originalChars,
    };
  }
  const suffixBudget = TOOL_OUTPUT_TRUNCATION_NOTICE.length;
  const keptChars = Math.max(0, maxChars - suffixBudget);
  return {
    text: `${trimmed.slice(0, keptChars)}${TOOL_OUTPUT_TRUNCATION_NOTICE}`,
    truncated: true,
    originalChars,
    keptChars,
  };
}

export function formatToolOutputTruncationMessage(input: {
  toolName: string;
  originalChars: number;
  keptChars: number;
}): string {
  const tool = input.toolName.trim() || "Tool";
  return `${tool} 输出已截断（${input.originalChars.toLocaleString("en-US")} → ${input.keptChars.toLocaleString("en-US")} 字符），以降低上下文占用`;
}
