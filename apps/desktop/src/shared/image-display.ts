export const ECO_IMAGE_DISPLAY_MCP_SERVER = "eco_image_display";
export const ECO_IMAGE_DISPLAY_TOOL = "display_image";
export const ECO_IMAGE_DISPLAY_FULL_TOOL = `mcp__${ECO_IMAGE_DISPLAY_MCP_SERVER}__${ECO_IMAGE_DISPLAY_TOOL}`;

export type ImageDisplaySourceKind = "path" | "url" | "base64";

export type ImageDisplayArtifactStatus = "completed" | "failed";

export interface ImageDisplayArtifact {
  id: string;
  threadId: string;
  toolUseId?: string;
  status: ImageDisplayArtifactStatus;
  sourceKind: ImageDisplaySourceKind;
  title?: string;
  mimeType: string;
  filePath: string;
  sourceRef?: string;
  bytes: number;
  width?: number;
  height?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ImageDisplayArtifactReadRequest {
  artifactId: string;
}

export interface ImageDisplayArtifactReadResult {
  dataBase64: string;
  mimeType: string;
  path: string;
  fileName: string;
  bytes: number;
  width?: number;
  height?: number;
}

export interface ImageDisplayReadFailureResult {
  ok: false;
  code: ImageDisplayReadFailureCode;
}

export interface ImageDisplayReadSuccessResult extends ImageDisplayArtifactReadResult {
  ok: true;
}

export type ImageDisplayReadResult = ImageDisplayReadSuccessResult | ImageDisplayReadFailureResult;

export type ImageDisplayReadFailureCode =
  | "invalid_artifact"
  | "not_found"
  | "too_large"
  | "unsupported_type"
  | "read_failed";

export interface ImageDisplayToolInput {
  source: ImageDisplaySourceKind;
  path?: string;
  url?: string;
  data?: string;
  mimeType?: string;
  title?: string;
}
