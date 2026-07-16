export const BUILTIN_VISION_AGENT_ROLE = "vision" as const;

export interface VisionAnalysisRequestBody {
  model: string;
  max_tokens: number;
  stream: false;
  system: string;
  messages: Array<{
    role: "user";
    content: Array<{ type: "text"; text: string }>;
  }>;
}

const VISION_SYSTEM_PROMPT = `你是内置的看图子代理。你的上下文与主代理完全隔离。
只分析本轮提供的图片，并把与用户任务有关的可观察信息压缩成结构化报告。
不要执行编码任务，不要猜测看不清的内容，不要要求访问文件或工具。
使用用户消息的主要语言输出，格式固定为：
## 总览
## 逐图观察
## 与任务相关的细节
## 不确定项
没有不确定项时在最后一节写“无”。`;

export function buildVisionAnalysisRequestBody(input: {
  model: string;
  prompt: string;
  imageCount: number;
}): VisionAnalysisRequestBody {
  const task = input.prompt.trim() || "请分析这些图片并提取对后续任务有用的信息。";
  return {
    model: input.model,
    max_tokens: 1600,
    stream: false,
    system: VISION_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `用户任务：\n${task}\n\n本轮共有 ${input.imageCount} 张图片。请逐图分析。`,
          },
        ],
      },
    ],
  };
}

export function readVisionAnalysisResponse(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("看图子代理返回了无效响应。");
  }
  const content = (value as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    throw new Error("看图子代理响应缺少 content。");
  }
  const text = content
    .filter(
      (part): part is { type: "text"; text: string } =>
        Boolean(
          part &&
            typeof part === "object" &&
            !Array.isArray(part) &&
            (part as { type?: unknown }).type === "text" &&
            typeof (part as { text?: unknown }).text === "string",
        ),
    )
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n");
  if (!text) {
    throw new Error("看图子代理没有返回可用的文字报告。");
  }
  return text;
}

export function buildPromptWithVisionAnalysis(input: {
  prompt: string;
  report: string;
  imageCount: number;
}): string {
  const prompt = input.prompt.trim() || "请根据图片分析结果继续处理。";
  return `${prompt}\n\n<vision_analysis source="builtin-vision-subagent" image_count="${input.imageCount}">\n说明：原始图片仅提供给独立看图子代理，未加入当前主代理会话。\n${input.report.trim()}\n</vision_analysis>`;
}
