import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { PromptImageAttachment } from "../shared/ipc";

const STORE_DIR_NAME = "prompt-images";
const SPOOL_DIR_NAME = "spool";
const MESSAGES_DIR_NAME = "messages";
/** Matches mobile remote uploads; desktop renderer still caps picks at 5 MB. */
export const PROMPT_IMAGE_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;

const MEDIA_TYPE_EXTENSION: Record<PromptImageAttachment["mediaType"], string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

export class PromptImageFileStore {
  private readonly rootDir: string;

  constructor(userDataDir: string) {
    this.rootDir = path.join(userDataDir, STORE_DIR_NAME);
  }

  getRootDir(): string {
    return this.rootDir;
  }

  isManagedPath(candidate: string): boolean {
    const resolved = path.resolve(candidate.trim());
    const root = path.resolve(this.rootDir);
    if (resolved === root) {
      return true;
    }
    const relative = path.relative(root, resolved);
    return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
  }

  async stageComposerImage(input: {
    contextKey: string;
    imageId: string;
    mediaType: PromptImageAttachment["mediaType"];
    dataBase64: string;
  }): Promise<{ path: string }> {
    const data = decodeBase64(input.dataBase64);
    if (data.length > PROMPT_IMAGE_UPLOAD_MAX_BYTES) {
      throw new Error("Image attachment exceeds 20 MB.");
    }
    const targetPath = this.spoolFilePath(input.contextKey, input.imageId, input.mediaType);
    await this.writeFileAtomic(targetPath, data);
    await this.unlinkIfExists(this.partialSpoolFilePath(input.contextKey, input.imageId, input.mediaType));
    return { path: targetPath };
  }

  async beginComposerImageUpload(input: {
    contextKey: string;
    imageId: string;
    mediaType: PromptImageAttachment["mediaType"];
    totalBytes: number;
  }): Promise<{ path: string; receivedBytes: number; complete: boolean }> {
    const totalBytes = Math.floor(input.totalBytes);
    if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
      throw new Error("Image upload totalBytes must be a positive integer.");
    }
    if (totalBytes > PROMPT_IMAGE_UPLOAD_MAX_BYTES) {
      throw new Error("Image attachment exceeds 20 MB.");
    }
    const targetPath = this.spoolFilePath(input.contextKey, input.imageId, input.mediaType);
    const partialPath = this.partialSpoolFilePath(input.contextKey, input.imageId, input.mediaType);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });

    const existingFinal = await this.safeStatSize(targetPath);
    if (existingFinal === totalBytes) {
      await this.unlinkIfExists(partialPath);
      return { path: targetPath, receivedBytes: totalBytes, complete: true };
    }
    if (existingFinal !== undefined) {
      await this.unlinkIfExists(targetPath);
    }

    const existingPartial = await this.safeStatSize(partialPath);
    if (existingPartial !== undefined) {
      if (existingPartial > totalBytes) {
        await this.unlinkIfExists(partialPath);
        await fs.writeFile(partialPath, Buffer.alloc(0));
        return { path: targetPath, receivedBytes: 0, complete: false };
      }
      return { path: targetPath, receivedBytes: existingPartial, complete: false };
    }

    await fs.writeFile(partialPath, Buffer.alloc(0));
    return { path: targetPath, receivedBytes: 0, complete: false };
  }

  async writeComposerImageChunk(input: {
    contextKey: string;
    imageId: string;
    mediaType: PromptImageAttachment["mediaType"];
    offset: number;
    dataBase64: string;
  }): Promise<{ receivedBytes: number }> {
    const offset = Math.floor(input.offset);
    if (!Number.isFinite(offset) || offset < 0) {
      throw new Error("Image upload offset must be a non-negative integer.");
    }
    const chunk = decodeBase64(input.dataBase64);
    if (chunk.length === 0) {
      throw new Error("Image upload chunk is empty.");
    }
    const targetPath = this.spoolFilePath(input.contextKey, input.imageId, input.mediaType);
    const partialPath = this.partialSpoolFilePath(input.contextKey, input.imageId, input.mediaType);
    const finalSize = await this.safeStatSize(targetPath);
    if (finalSize !== undefined) {
      return { receivedBytes: finalSize };
    }
    const current = (await this.safeStatSize(partialPath)) ?? 0;
    if (offset !== current) {
      throw new Error(`Image upload offset mismatch: expected ${current}, got ${offset}.`);
    }
    if (current + chunk.length > PROMPT_IMAGE_UPLOAD_MAX_BYTES) {
      throw new Error("Image attachment exceeds 20 MB.");
    }
    await fs.mkdir(path.dirname(partialPath), { recursive: true });
    await fs.appendFile(partialPath, chunk);
    return { receivedBytes: current + chunk.length };
  }

  async finishComposerImageUpload(input: {
    contextKey: string;
    imageId: string;
    mediaType: PromptImageAttachment["mediaType"];
    totalBytes: number;
  }): Promise<{ path: string }> {
    const totalBytes = Math.floor(input.totalBytes);
    if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
      throw new Error("Image upload totalBytes must be a positive integer.");
    }
    const targetPath = this.spoolFilePath(input.contextKey, input.imageId, input.mediaType);
    const partialPath = this.partialSpoolFilePath(input.contextKey, input.imageId, input.mediaType);
    const finalSize = await this.safeStatSize(targetPath);
    if (finalSize === totalBytes) {
      await this.unlinkIfExists(partialPath);
      return { path: targetPath };
    }
    const partialSize = await this.safeStatSize(partialPath);
    if (partialSize !== totalBytes) {
      throw new Error(
        `Image upload incomplete: expected ${totalBytes} bytes, got ${partialSize ?? 0}.`,
      );
    }
    await fs.rename(partialPath, targetPath);
    return { path: targetPath };
  }

  async releasePaths(paths: readonly string[]): Promise<void> {
    for (const rawPath of paths) {
      const filePath = rawPath.trim();
      if (!filePath || !this.isManagedPath(filePath)) {
        continue;
      }
      await this.unlinkIfExists(filePath);
      await this.unlinkIfExists(`${filePath}.partial`);
    }
  }

  async deleteSpoolContext(contextKey: string): Promise<void> {
    const directory = this.spoolContextDir(contextKey);
    await this.removeDirectoryIfExists(directory);
  }

  async deleteThreadMessages(threadId: string): Promise<void> {
    const directory = path.join(this.rootDir, MESSAGES_DIR_NAME, sanitizeSegment(threadId));
    await this.removeDirectoryIfExists(directory);
  }

  async deleteMessageActivity(threadId: string, activityLineId: string): Promise<void> {
    const directory = path.join(
      this.rootDir,
      MESSAGES_DIR_NAME,
      sanitizeSegment(threadId),
      sanitizeSegment(activityLineId),
    );
    await this.removeDirectoryIfExists(directory);
  }

  async persistMessageAttachments(
    threadId: string,
    activityLineId: string,
    attachments: readonly PromptImageAttachment[],
  ): Promise<PromptImageAttachment[]> {
    const persisted: PromptImageAttachment[] = [];
    for (const [index, attachment] of attachments.entries()) {
      const mediaType = attachment.mediaType;
      const imageId = `img_${index}_${randomUUID()}`;
      const targetPath = this.messageFilePath(threadId, activityLineId, imageId, mediaType);
      const sourcePath = attachment.path?.trim();
      if (sourcePath && this.isManagedPath(sourcePath)) {
        try {
          await this.moveOrCopy(sourcePath, targetPath);
          persisted.push({ mediaType, path: targetPath });
          continue;
        } catch (error) {
          // Composer draft cleanup may race-delete spool files after the renderer
          // already captured path-only attachments; fall back to inline data when present.
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            throw error;
          }
        }
      }
      const data = attachment.data?.trim();
      if (!data) {
        throw new Error("Prompt image attachment is missing both path and data.");
      }
      await this.writeFileAtomic(targetPath, decodeBase64(data));
      persisted.push({ mediaType, path: targetPath });
    }
    return persisted;
  }

  async readAttachmentData(attachment: PromptImageAttachment): Promise<string> {
    const inline = attachment.data?.trim();
    if (inline) {
      return inline;
    }
    const filePath = attachment.path?.trim();
    if (!filePath || !this.isManagedPath(filePath)) {
      throw new Error("Prompt image attachment is missing readable data.");
    }
    const buffer = await fs.readFile(filePath);
    return buffer.toString("base64");
  }

  async resolveAttachmentsForRuntime(
    attachments: readonly PromptImageAttachment[],
  ): Promise<Array<PromptImageAttachment & { data: string }>> {
    const resolved: Array<PromptImageAttachment & { data: string }> = [];
    for (const attachment of attachments) {
      resolved.push({
        mediaType: attachment.mediaType,
        data: await this.readAttachmentData(attachment),
        ...(attachment.path ? { path: attachment.path } : {}),
      });
    }
    return resolved;
  }

  collectAttachmentPaths(attachments: readonly PromptImageAttachment[] | undefined): string[] {
    if (!attachments?.length) {
      return [];
    }
    return attachments
      .map((attachment) => attachment.path?.trim() ?? "")
      .filter((filePath) => filePath.length > 0 && this.isManagedPath(filePath));
  }

  private spoolContextDir(contextKey: string): string {
    return path.join(this.rootDir, SPOOL_DIR_NAME, sanitizeSegment(contextKey));
  }

  private spoolFilePath(
    contextKey: string,
    imageId: string,
    mediaType: PromptImageAttachment["mediaType"],
  ): string {
    return path.join(
      this.spoolContextDir(contextKey),
      `${sanitizeSegment(imageId)}.${MEDIA_TYPE_EXTENSION[mediaType]}`,
    );
  }

  private partialSpoolFilePath(
    contextKey: string,
    imageId: string,
    mediaType: PromptImageAttachment["mediaType"],
  ): string {
    return `${this.spoolFilePath(contextKey, imageId, mediaType)}.partial`;
  }

  private async safeStatSize(filePath: string): Promise<number | undefined> {
    try {
      const stat = await fs.stat(filePath);
      return stat.isFile() ? stat.size : undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  }

  private messageFilePath(
    threadId: string,
    activityLineId: string,
    imageId: string,
    mediaType: PromptImageAttachment["mediaType"],
  ): string {
    return path.join(
      this.rootDir,
      MESSAGES_DIR_NAME,
      sanitizeSegment(threadId),
      sanitizeSegment(activityLineId),
      `${sanitizeSegment(imageId)}.${MEDIA_TYPE_EXTENSION[mediaType]}`,
    );
  }

  private async writeFileAtomic(filePath: string, data: Buffer): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${randomUUID()}.tmp`;
    await fs.writeFile(tempPath, data, { flag: "wx" });
    await fs.rename(tempPath, filePath);
  }

  private async moveOrCopy(sourcePath: string, targetPath: string): Promise<void> {
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    try {
      await fs.rename(sourcePath, targetPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EXDEV") {
        throw error;
      }
      const data = await fs.readFile(sourcePath);
      await this.writeFileAtomic(targetPath, data);
      await this.unlinkIfExists(sourcePath);
    }
  }

  private async unlinkIfExists(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  private async removeDirectoryIfExists(directory: string): Promise<void> {
    try {
      await fs.rm(directory, { recursive: true, force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }
}

export function isPromptImageAttachmentRecord(value: unknown): value is PromptImageAttachment {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (
    record.mediaType !== "image/jpeg" &&
    record.mediaType !== "image/png" &&
    record.mediaType !== "image/gif" &&
    record.mediaType !== "image/webp"
  ) {
    return false;
  }
  const data = typeof record.data === "string" ? record.data.trim() : "";
  const filePath = typeof record.path === "string" ? record.path.trim() : "";
  return data.length > 0 || filePath.length > 0;
}

function sanitizeSegment(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Prompt image storage key is required.");
  }
  return trimmed.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 180);
}

function decodeBase64(value: string): Buffer {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Prompt image data is required.");
  }
  return Buffer.from(trimmed, "base64");
}
