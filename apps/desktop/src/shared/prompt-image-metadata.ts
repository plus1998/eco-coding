import type { PromptImageAttachment } from "./ipc";

export const PROMPT_IMAGE_PREVIEWS_METADATA_KEY = "promptImagePreviews" as const;

export interface PromptImagePreview extends PromptImageAttachment {
  id: string;
}

export function readPromptImagePreviews(metadata: Record<string, unknown> | undefined): PromptImagePreview[] {
  const value = metadata?.[PROMPT_IMAGE_PREVIEWS_METADATA_KEY];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is PromptImagePreview => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const record = entry as Record<string, unknown>;
    return (
      typeof record.id === "string" &&
      record.id.length > 0 &&
      (record.mediaType === "image/jpeg" ||
        record.mediaType === "image/png" ||
        record.mediaType === "image/gif" ||
        record.mediaType === "image/webp") &&
      typeof record.data === "string" &&
      record.data.length > 0
    );
  });
}
