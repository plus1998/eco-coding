import type { PromptImageAttachment } from "../shared/ipc";

export const COMPOSER_MAX_IMAGES = 5;
export const COMPOSER_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const ALLOWED_MEDIA_TYPES = new Set<PromptImageAttachment["mediaType"]>([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

export interface ComposerImageAttachment {
  id: string;
  mediaType: PromptImageAttachment["mediaType"];
  path?: string;
  data?: string;
  previewUrl: string;
}

export function isAllowedImageMediaType(mediaType: string): mediaType is PromptImageAttachment["mediaType"] {
  return ALLOWED_MEDIA_TYPES.has(mediaType as PromptImageAttachment["mediaType"]);
}

export async function readImageFileAsAttachment(file: File): Promise<ComposerImageAttachment | null> {
  if (!file.type.startsWith("image/") || !isAllowedImageMediaType(file.type)) {
    return null;
  }
  if (file.size > COMPOSER_MAX_IMAGE_BYTES) {
    return null;
  }
  const buffer = await file.arrayBuffer();
  if (buffer.byteLength > COMPOSER_MAX_IMAGE_BYTES) {
    return null;
  }
  const data = arrayBufferToBase64(buffer);
  return {
    id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    mediaType: file.type,
    data,
    previewUrl: `data:${file.type};base64,${data}`,
  };
}

export function toPromptImageAttachments(
  attachments: readonly ComposerImageAttachment[],
): PromptImageAttachment[] {
  return attachments.map((attachment) => {
    const path = attachment.path?.trim();
    if (path) {
      return {
        mediaType: attachment.mediaType,
        path,
      };
    }
    const data = attachment.data?.trim();
    if (!data) {
      throw new Error("Composer image attachment is missing file data.");
    }
    return {
      mediaType: attachment.mediaType,
      data,
    };
  });
}

export function fromPromptImageAttachments(
  attachments: readonly PromptImageAttachment[],
): ComposerImageAttachment[] {
  return attachments.map((attachment, index) => {
    const data = attachment.data?.trim() ?? "";
    const path = attachment.path?.trim();
    return {
      id: `img_edit_${index}_${Math.random().toString(36).slice(2, 8)}`,
      mediaType: attachment.mediaType,
      ...(path ? { path } : {}),
      ...(data ? { data } : {}),
      previewUrl: data ? `data:${attachment.mediaType};base64,${data}` : "",
    };
  });
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]!);
  }
  return btoa(binary);
}
