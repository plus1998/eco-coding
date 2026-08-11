/**
 * UI feed preview budget (chars). Model-visible history truncation uses
 * `codex-output-truncation` (Codex TruncationPolicy, ~10k tokens × 1.2), not this constant.
 */
export const MAX_BASH_OUTPUT_PREVIEW_CHARS = 8_000;

const OUTPUT_PREVIEW_OMISSION = "\n\n... (middle output omitted)\n\n";
const LEGACY_TOOL_OUTPUT_TRUNCATION_NOTICE = "…（输出已截断，完整内容未写入上下文；详见运行日志提示）";

export interface ToolOutputPreview {
  text: string;
  truncated: boolean;
}

export interface ToolOutputPreviewCapture {
  head: string;
  tail: string;
  totalChars: number;
}

export function createToolOutputPreview(
  output: string,
  maxChars: number = MAX_BASH_OUTPUT_PREVIEW_CHARS,
): ToolOutputPreview {
  const normalized = stripLegacyToolOutputTruncationNotice(output.trim());
  if (normalized.length <= maxChars) {
    return { text: normalized, truncated: false };
  }
  const { headChars, tailChars } = previewBudgets(maxChars);
  return {
    text: `${normalized.slice(0, headChars)}${OUTPUT_PREVIEW_OMISSION}${normalized.slice(-tailChars)}`,
    truncated: true,
  };
}

export function appendToolOutputPreviewCapture(
  capture: ToolOutputPreviewCapture | undefined,
  delta: string,
  maxChars: number = MAX_BASH_OUTPUT_PREVIEW_CHARS,
): ToolOutputPreviewCapture {
  const current = capture ?? { head: "", tail: "", totalChars: 0 };
  const totalChars = current.totalChars + delta.length;
  const { headChars, tailChars } = previewBudgets(maxChars);
  if (totalChars <= maxChars) {
    return {
      head: `${current.head}${current.tail}${delta}`,
      tail: "",
      totalChars,
    };
  }
  const previous = `${current.head}${current.tail}`;
  return {
    head:
      current.totalChars >= headChars
        ? current.head.slice(0, headChars)
        : `${previous}${delta}`.slice(0, headChars),
    tail: `${previous.slice(headChars)}${delta}`.slice(-tailChars),
    totalChars,
  };
}

export function materializeToolOutputPreviewCapture(
  capture: ToolOutputPreviewCapture | undefined,
): ToolOutputPreview | undefined {
  if (!capture || capture.totalChars === 0) {
    return undefined;
  }
  if (!capture.tail) {
    return { text: capture.head.trim(), truncated: false };
  }
  return {
    text: `${capture.head}${OUTPUT_PREVIEW_OMISSION}${capture.tail}`.trim(),
    truncated: true,
  };
}

export function stripLegacyToolOutputTruncationNotice(output: string): string {
  return output.replaceAll(LEGACY_TOOL_OUTPUT_TRUNCATION_NOTICE, "").trim();
}

function previewBudgets(maxChars: number): { headChars: number; tailChars: number } {
  const boundedMax = Math.max(OUTPUT_PREVIEW_OMISSION.length, Math.floor(maxChars));
  const contentChars = boundedMax - OUTPUT_PREVIEW_OMISSION.length;
  const headChars = Math.ceil(contentChars / 2);
  return { headChars, tailChars: contentChars - headChars };
}
