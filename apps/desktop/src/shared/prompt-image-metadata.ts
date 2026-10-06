import type { PromptImageAttachment } from "./ipc";

export const PROMPT_IMAGE_PREVIEWS_METADATA_KEY = "promptImagePreviews" as const;

export interface PromptImagePreview extends PromptImageAttachment {
  id: string;
}

export function readPromptImagePreviews(metadata: Record<string, unknown> | undefined): PromptImagePreview[] {
  const value = metadata?.[PROMPT_IMAGE_PREVIEWS_METADATA_KEY];
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index): PromptImagePreview[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    if (
      !(
        record.mediaType === "image/jpeg" ||
        record.mediaType === "image/png" ||
        record.mediaType === "image/gif" ||
        record.mediaType === "image/webp"
      ) ||
      typeof record.data !== "string" ||
      record.data.length === 0
    ) {
      return [];
    }
    const explicitId = typeof record.id === "string" ? record.id.trim() : "";
    const contentRef = typeof record.contentRef === "string" ? record.contentRef.trim() : "";
    const id = explicitId || (contentRef ? `prompt-image:${contentRef}` : `prompt-image:${index}`);
    return [{ ...record, id } as PromptImagePreview];
  });
}
