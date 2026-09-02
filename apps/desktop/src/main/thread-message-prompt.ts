import { ACP_IMAGE_ONLY_PROMPT } from "@eco/runtime";
import type { PromptImageAttachment } from "../shared/ipc";

export function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function resolveThreadMessagePrompt(
  prompt: unknown,
  attachments: readonly PromptImageAttachment[],
): string {
  return readOptionalString(prompt) || (attachments.length > 0 ? ACP_IMAGE_ONLY_PROMPT : "");
}
