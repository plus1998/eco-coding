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

const VISION_SYSTEM_PROMPT = `You are the built-in vision subagent. Your context is fully isolated from the main agent.
Analyze only the images provided in this turn and compress observations relevant to the user's task into a structured report.
Do not perform coding tasks, guess at unclear content, or request access to files or tools.
Respond in the primary language of the user's message, using exactly this format:
## Overview
## Per-image observations
## Task-relevant details
## Uncertainties
Write "None" in the final section when there are no uncertainties.`;

export function buildVisionAnalysisRequestBody(input: {
  model: string;
  prompt: string;
  imageCount: number;
}): VisionAnalysisRequestBody {
  const task =
    input.prompt.trim() || "Analyze these images and extract information useful for the next task.";
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
            text: `User task:\n${task}\n\nThere are ${input.imageCount} image(s) in this turn. Analyze each image separately.`,
          },
        ],
      },
    ],
  };
}

export function readVisionAnalysisResponse(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The vision subagent returned an invalid response.");
  }
  const content = (value as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    throw new Error("The vision subagent response is missing content.");
  }
  const text = content
    .filter((part): part is { type: "text"; text: string } =>
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
    throw new Error("The vision subagent did not return a usable text report.");
  }
  return text;
}

export function buildPromptWithVisionAnalysis(input: {
  prompt: string;
  report: string;
  imageCount: number;
}): string {
  const prompt = input.prompt.trim() || "Continue based on the image analysis.";
  return `${prompt}\n\n<vision_analysis image_count="${input.imageCount}">\n${input.report.trim()}\n</vision_analysis>`;
}
