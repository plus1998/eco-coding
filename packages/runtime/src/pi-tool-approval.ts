import type { SdkToolPermissionHandler } from "./ask-user-question";
import type { SdkToolPermissionDecision, SdkToolPermissionRequest } from "./claude-agent-sdk";

export interface PiToolCallEventLike {
  type: "tool_call";
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
}

export interface PiToolCallEventResult {
  block?: boolean;
  reason?: string;
  terminate?: boolean;
}

export interface EcoPiToolApprovalExtensionApi {
  on(
    event: "tool_call",
    handler: (
      event: PiToolCallEventLike,
      ctx: { cwd?: string; signal?: AbortSignal },
    ) => Promise<PiToolCallEventResult | void | undefined>,
  ): void;
}

export interface CreateEcoPiToolApprovalInput {
  onToolPermission: SdkToolPermissionHandler;
  cwd?: string;
  agentId?: string;
  agentType?: string;
  fallbackSignal?: AbortSignal;
}

export const PI_TOOL_APPROVAL_EXTENSION_NAME = "eco-pi-approval" as const;
export const PI_TOOL_APPROVAL_HANDLER_MISSING =
  "Eco tool permission handler is not armed for this PI session.";
export const PI_TOOL_APPROVAL_HANDLER_FAILED =
  "Eco tool permission check failed; tool call blocked.";

/** Map PI builtin lowercase names to Claude SDK PascalCase for the Eco handler only. */
const PI_BUILTIN_TOOL_NAME_TO_SDK: Readonly<Record<string, string>> = {
  bash: "Bash",
  read: "Read",
  write: "Write",
  edit: "Edit",
};

export function mapPiToolNameToSdkToolName(toolName: string): string {
  return PI_BUILTIN_TOOL_NAME_TO_SDK[toolName] ?? toolName;
}

function isAbortRejection(
  error: unknown,
  signals: { ctx?: AbortSignal; request: AbortSignal },
): boolean {
  if (signals.ctx?.aborted || signals.request.aborted) {
    return true;
  }
  if (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError") {
    return true;
  }
  return error instanceof Error && error.name === "AbortError";
}

export function mapSdkPermissionDecisionToPiToolCallResult(
  decision: SdkToolPermissionDecision,
  event: { input: Record<string, unknown> },
): PiToolCallEventResult | undefined {
  if (decision.behavior === "allow") {
    if (decision.updatedInput) {
      Object.assign(event.input, decision.updatedInput);
    }
    return undefined;
  }
  return {
    block: true,
    reason: decision.message,
    ...(decision.interrupt === true ? { terminate: true } : {}),
  };
}

export async function applyPiToolCallPermission(
  event: PiToolCallEventLike,
  ctx: { cwd?: string; signal?: AbortSignal },
  input: CreateEcoPiToolApprovalInput,
): Promise<PiToolCallEventResult | undefined> {
  const request: SdkToolPermissionRequest = {
    toolName: mapPiToolNameToSdkToolName(event.toolName),
    input: event.input,
    toolUseId: event.toolCallId,
    signal: ctx.signal ?? input.fallbackSignal ?? new AbortController().signal,
  };
  const cwd = ctx.cwd ?? input.cwd;
  if (cwd !== undefined) {
    request.cwd = cwd;
  }
  if (input.agentId !== undefined) {
    request.agentId = input.agentId;
  }
  if (input.agentType !== undefined) {
    request.agentType = input.agentType;
  }

  try {
    const decision = await input.onToolPermission(request);
    return mapSdkPermissionDecisionToPiToolCallResult(decision, event);
  } catch (error) {
    if (
      isAbortRejection(error, {
        ...(ctx.signal ? { ctx: ctx.signal } : {}),
        request: request.signal,
      })
    ) {
      throw error;
    }
    return { block: true, reason: PI_TOOL_APPROVAL_HANDLER_FAILED };
  }
}

export function createEcoPiToolApprovalExtensionFactory(
  input: CreateEcoPiToolApprovalInput,
): (pi: EcoPiToolApprovalExtensionApi) => void {
  return (pi) => {
    pi.on("tool_call", (event, ctx) => applyPiToolCallPermission(event, ctx, input));
  };
}
