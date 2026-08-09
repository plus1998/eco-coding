export const ECO_IMAGE_GENERATION_MCP_SERVER = "eco_image_generation";
export const ECO_IMAGE_GENERATION_TOOL = "create_image";
export const ECO_IMAGE_GENERATION_FULL_TOOL =
  `mcp__${ECO_IMAGE_GENERATION_MCP_SERVER}__${ECO_IMAGE_GENERATION_TOOL}`;
export const IMAGE_GENERATION_TASK_TAB_PREFIX = "image:";

export function imageGenerationTaskTabId(artifactId: string): string {
  return `${IMAGE_GENERATION_TASK_TAB_PREFIX}${artifactId}`;
}

export function parseImageGenerationTaskTabId(tabId: string): string | undefined {
  return tabId.startsWith(IMAGE_GENERATION_TASK_TAB_PREFIX)
    ? tabId.slice(IMAGE_GENERATION_TASK_TAB_PREFIX.length) || undefined
    : undefined;
}

export const IMAGE_GENERATION_PROVIDERS = ["openai", "gemini", "openai_compatible"] as const;
export type ImageGenerationProvider = (typeof IMAGE_GENERATION_PROVIDERS)[number];

export interface ImageGenerationProfileSnapshot {
  id: string;
  name: string;
  provider: ImageGenerationProvider;
  endpoint: string;
  model: string;
  hasApiKey: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ImageGenerationProfileSaveInput {
  id?: string;
  name: string;
  provider: ImageGenerationProvider;
  endpoint: string;
  model: string;
  apiKey?: string;
}

export interface ImageGenerationSettingsSnapshot {
  enabled: boolean;
  activeProfileId: string;
  profiles: ImageGenerationProfileSnapshot[];
  apiKeyEncryptionAvailable: boolean;
}

export interface ImageGenerationSettingsSaveInput {
  enabled: boolean;
}

export interface ImageGenerationToolInput {
  prompt: string;
  size?: string;
  aspect_ratio?: string;
  quality?: "auto" | "low" | "medium" | "high";
  count?: number;
  output_name?: string;
}

export type ImageGenerationArtifactStatus = "running" | "completed" | "failed";

export interface GeneratedImageFile {
  absolutePath: string;
  relativePath: string;
  mimeType: string;
  bytes: number;
}

export interface ImageGenerationArtifact {
  id: string;
  threadId: string;
  toolUseId?: string;
  status: ImageGenerationArtifactStatus;
  prompt: string;
  parameters: Omit<ImageGenerationToolInput, "prompt">;
  provider: ImageGenerationProvider;
  profileName: string;
  model: string;
  workspacePath: string;
  generationRoot: string;
  images: GeneratedImageFile[];
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ImageGenerationArtifactListRequest {
  threadId: string;
}

export interface ImageGenerationArtifactReadRequest {
  artifactId: string;
  imageIndex: number;
}

export interface ImageGenerationArtifactReadResult {
  dataBase64: string;
  mimeType: string;
  path: string;
}

export class ImageGenerationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly providerStatus?: number,
    readonly requestId?: string,
    readonly partialImages: GeneratedImageFile[] = [],
  ) {
    super(message);
    this.name = "ImageGenerationError";
  }
}

export function isImageGenerationProvider(value: unknown): value is ImageGenerationProvider {
  return typeof value === "string" && (IMAGE_GENERATION_PROVIDERS as readonly string[]).includes(value);
}

export function defaultImageGenerationEndpoint(provider: ImageGenerationProvider): string {
  if (provider === "gemini") return "https://generativelanguage.googleapis.com/v1beta";
  if (provider === "openai") return "https://api.openai.com/v1";
  return "";
}

export function defaultImageGenerationModel(provider: ImageGenerationProvider): string {
  if (provider === "gemini") return "gemini-2.5-flash-image";
  if (provider === "openai") return "gpt-image-1";
  return "";
}

export function buildImageGenerationPromptAppend(input: {
  provider: ImageGenerationProvider;
  profileName: string;
  model: string;
}): string {
  const providerParameters =
    input.provider === "gemini"
      ? "Gemini accepts size=1K|2K|4K, aspect_ratio, and count=1; quality is unsupported."
      : "OpenAI-style providers accept size, quality, and count=1..4; aspect_ratio is unsupported.";
  return [
    "Built-in image creation (Eco) is enabled for this conversation.",
    `Use only \`${ECO_IMAGE_GENERATION_FULL_TOOL}\`; do not use the built-in imagegen Skill or another image tool.`,
    `Active profile: ${input.profileName}; provider=${input.provider}; model=${input.model}.`,
    providerParameters,
    "Every invocation requires user approval. Never change provider, model, size, quality, count, or aspect ratio after an error unless the user decides.",
    "The tool returns absolute and workspace-relative file paths. Use those paths for subsequent file operations.",
  ].join("\n");
}

export function isEcoImageGenerationToolName(value: string | undefined): boolean {
  const name = value?.trim().toLowerCase() ?? "";
  return name.includes(ECO_IMAGE_GENERATION_MCP_SERVER) || name.endsWith(ECO_IMAGE_GENERATION_TOOL);
}
