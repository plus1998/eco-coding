export interface SdkToolPermissionRequest {
  toolName: string;
  input: Record<string, unknown>;
  toolUseId: string;
  agentId?: string;
  agentType?: string;
  cwd?: string;
  blockedPath?: string;
  decisionReason?: string;
  signal: AbortSignal;
}

export type SdkToolPermissionDecision =
  | { behavior: "allow"; updatedInput?: Record<string, unknown> }
  | { behavior: "deny"; message: string; interrupt?: boolean };
