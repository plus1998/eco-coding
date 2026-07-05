import { type AgentEvent, createAgentEvent, type RuntimeAgentRole } from "../../shared/src";
import { tryParseSerializedAnthropicContentBlocks } from "./anthropic-content-normalize.js";
import { SDK_GENERAL_PURPOSE_AGENT_KEY, SDK_PLAN_AGENT_KEY } from "./subagent-availability.js";
import { normalizeSdkSubagentType } from "./subagent-resume.js";

export type EcoStreamBlockKind = "text" | "thinking" | "tool_use";

/** Mutable state for one SDK query session while partial messages stream. */
export interface SdkStreamContext {
  inToolBlock: boolean;
  activeBlockKind: EcoStreamBlockKind | null;
  currentToolUseId?: string;
  currentToolName?: string;
  currentToolInputJson: string;
  parentToolUseId: string | null;
  activeSubagentRole?: RuntimeAgentRole;
  /** Remembers each subagent's role so interleaved parallel streams keep correct roles. */
  subagentRoleByParentToolUseId: Map<string, RuntimeAgentRole>;
  /** Subagent instance ids registered from SubagentStart before stream parent_tool_use_id arrives. */
  registeredSubagentByParentToolUseId: Map<string, string>;
  /** Latest subagent instance id per role when parent_tool_use_id is not yet known. */
  registeredSubagentByRole: Map<RuntimeAgentRole, string>;
  activeBlockIndex?: number;
  emittedStreamBlockKeys: Set<string>;
  emittedToolUseIds: Set<string>;
  resolveSubagentAgentId?: (input: {
    role: RuntimeAgentRole;
    parentToolUseId?: string;
    sessionId: string;
  }) => string | undefined;
}

export function createSdkStreamContext(options?: {
  resolveSubagentAgentId?: SdkStreamContext["resolveSubagentAgentId"];
}): SdkStreamContext {
  return {
    inToolBlock: false,
    activeBlockKind: null,
    currentToolInputJson: "",
    parentToolUseId: null,
    subagentRoleByParentToolUseId: new Map(),
    registeredSubagentByParentToolUseId: new Map(),
    registeredSubagentByRole: new Map(),
    emittedStreamBlockKeys: new Set(),
    emittedToolUseIds: new Set(),
    ...(options?.resolveSubagentAgentId && { resolveSubagentAgentId: options.resolveSubagentAgentId }),
  };
}

/** Resolve parent tool id from stream context when the SDK message omits it. */
export function resolveParentToolUseIdFromStreamContext(
  streamCtx: SdkStreamContext | undefined,
  role?: RuntimeAgentRole,
): string | undefined {
  if (!streamCtx) {
    return undefined;
  }
  const direct = streamCtx.parentToolUseId?.trim();
  if (direct) {
    return direct;
  }
  const targetRole = role ?? streamCtx.activeSubagentRole;
  if (!targetRole) {
    return undefined;
  }
  const matches: string[] = [];
  for (const [parentId, subRole] of streamCtx.subagentRoleByParentToolUseId) {
    if (subRole === targetRole) {
      matches.push(parentId);
    }
  }
  return matches.length === 1 ? matches[0] : undefined;
}

/** Seed stream attribution from PreToolUse / SubagentStart before SDK stream carries parent_tool_use_id. */
export function registerSubagentOnStreamContext(
  streamCtx: SdkStreamContext,
  input: { role: RuntimeAgentRole; agentId?: string; parentToolUseId?: string },
): void {
  const agentId = input.agentId?.trim();
  const parentToolUseId = input.parentToolUseId?.trim();
  if (!agentId && !parentToolUseId) {
    return;
  }
  streamCtx.activeSubagentRole = input.role;
  if (agentId) {
    streamCtx.registeredSubagentByRole.set(input.role, agentId);
  }
  if (parentToolUseId) {
    streamCtx.subagentRoleByParentToolUseId.set(parentToolUseId, input.role);
    streamCtx.parentToolUseId = parentToolUseId;
    if (agentId) {
      streamCtx.registeredSubagentByParentToolUseId.set(parentToolUseId, agentId);
    }
  }
}

export function createAttributedAgentEvent(
  input: {
    id: string;
    threadId: string;
    sessionId: string;
    role: RuntimeAgentRole;
    type: AgentEvent["type"];
    payload: Record<string, unknown>;
    messageParentToolUseId?: string | null;
  },
  streamCtx?: SdkStreamContext,
): AgentEvent {
  const attributed = applySubagentUsageAttribution(
    {
      role: input.role,
      sessionId: input.sessionId,
      payload: input.payload,
      messageParentToolUseId: input.messageParentToolUseId,
    },
    streamCtx,
  );
  return createAgentEvent({
    id: input.id,
    threadId: input.threadId,
    agentId: attributed.agentId,
    role: input.role,
    type: input.type,
    payload: attributed.payload,
  });
}

/** Attach subagent agent_id to usage events when desktop attribution resolver is wired. */
export function applySubagentUsageAttribution(
  input: {
    role: RuntimeAgentRole;
    sessionId: string;
    payload: Record<string, unknown>;
    /**
     * parent_tool_use_id carried by the SDK message itself. A string marks subagent usage;
     * null marks main-session usage and must never inherit a stale subagent stream context.
     * Omit only for legacy callers that have no message-level signal.
     */
    messageParentToolUseId?: string | null;
  },
  streamCtx?: SdkStreamContext,
): { agentId: string; payload: Record<string, unknown> } {
  const explicit = input.messageParentToolUseId;
  if (explicit === null) {
    return { agentId: input.sessionId, payload: input.payload };
  }
  const parentFromPayload =
    typeof input.payload.parent_tool_use_id === "string" ? input.payload.parent_tool_use_id.trim() : "";
  const attributionRole =
    explicit !== undefined ? input.role : (streamCtx?.activeSubagentRole ?? input.role);
  const parentToolUseId =
    (typeof explicit === "string" && explicit.trim()) ||
    parentFromPayload ||
    resolveParentToolUseIdFromStreamContext(streamCtx, attributionRole) ||
    undefined;

  const registeredAgentId =
    parentToolUseId && streamCtx?.registeredSubagentByParentToolUseId.get(parentToolUseId);
  if (registeredAgentId) {
    return {
      agentId: registeredAgentId,
      payload: {
        ...input.payload,
        ...(parentToolUseId && { parent_tool_use_id: parentToolUseId }),
      },
    };
  }

  const roleRegisteredAgentId = streamCtx?.registeredSubagentByRole.get(attributionRole);
  if (roleRegisteredAgentId) {
    return {
      agentId: roleRegisteredAgentId,
      payload: parentToolUseId
        ? { ...input.payload, parent_tool_use_id: parentToolUseId }
        : input.payload,
    };
  }

  const subagentAgentId = streamCtx?.resolveSubagentAgentId?.({
    role: attributionRole,
    sessionId: input.sessionId,
    ...(parentToolUseId && { parentToolUseId }),
  });
  if (!subagentAgentId) {
    // Keep parent_tool_use_id on the payload so downstream billing can still attribute the
    // usage to a subagent instance when runtime-side resolution is unavailable or ambiguous.
    return {
      agentId: input.sessionId,
      payload: parentToolUseId
        ? { ...input.payload, parent_tool_use_id: parentToolUseId }
        : input.payload,
    };
  }
  return {
    agentId: subagentAgentId,
    payload: {
      ...input.payload,
      subagentAgentId,
      ...(parentToolUseId && { parent_tool_use_id: parentToolUseId }),
    },
  };
}

export type EcoStreamPayload =
  | {
      type: "eco_stream";
      blockKind: "text" | "thinking";
      text?: string;
      streamPlaceholder?: boolean;
      streamFinalize?: boolean;
      stream_block_key?: string;
      parent_tool_use_id?: string | null;
      subagent_type?: string;
      agent_type?: string;
    }
  | {
      type: "tool_use";
      tool_name: string;
      tool_use_id?: string;
      input?: Record<string, unknown>;
      streaming?: boolean;
      input_complete?: boolean;
      parent_tool_use_id?: string | null;
      subagent_type?: string;
      agent_type?: string;
    };

export function slimStreamEventMessage(message: Record<string, unknown>): Record<string, unknown> {
  const parentToolUseId = typeof message.parent_tool_use_id === "string" ? message.parent_tool_use_id : null;
  const subagentType = typeof message.subagent_type === "string" ? message.subagent_type : undefined;
  const agentType = typeof message.agent_type === "string" ? message.agent_type : undefined;
  const event = isRecord(message.event) ? message.event : null;
  if (!event) {
    return {
      type: "stream_event",
      ...(parentToolUseId && { parent_tool_use_id: parentToolUseId }),
      ...(subagentType && { subagent_type: subagentType }),
      ...(agentType && { agent_type: agentType }),
    };
  }
  return {
    type: "stream_event",
    event: slimRawStreamEvent(event),
    ...(parentToolUseId && { parent_tool_use_id: parentToolUseId }),
    ...(subagentType && { subagent_type: subagentType }),
    ...(agentType && { agent_type: agentType }),
  };
}

function slimRawStreamEvent(event: Record<string, unknown>): Record<string, unknown> {
  const slim: Record<string, unknown> = { type: event.type };
  if (event.type === "content_block_delta" && isRecord(event.delta)) {
    slim.delta = event.delta;
  }
  if (event.type === "content_block_start" && isRecord(event.content_block)) {
    slim.content_block = event.content_block;
  }
  if (event.type === "message_delta" && isRecord(event.usage)) {
    slim.usage = event.usage;
  }
  if (event.type === "message_delta" && event.delta !== undefined) {
    slim.delta = event.delta;
  }
  return slim;
}

function readMessageSubagentRole(message: Record<string, unknown>): RuntimeAgentRole | undefined {
  const subagentType = typeof message.subagent_type === "string" ? message.subagent_type : undefined;
  const agentType = typeof message.agent_type === "string" ? message.agent_type : undefined;
  const subagentRole = subagentType ? normalizeSdkRuntimeAgentRole(subagentType) : undefined;
  const agentRole = agentType ? normalizeSdkRuntimeAgentRole(agentType) : undefined;
  return subagentRole ?? agentRole;
}

function normalizeSdkRuntimeAgentRole(type: string): RuntimeAgentRole | undefined {
  const trimmed = type.trim();
  if (trimmed === SDK_GENERAL_PURPOSE_AGENT_KEY || trimmed === SDK_PLAN_AGENT_KEY) {
    return trimmed;
  }
  return normalizeSdkSubagentType(trimmed);
}

function effectiveStreamRole(ctx: SdkStreamContext, fallback: RuntimeAgentRole): RuntimeAgentRole {
  return ctx.activeSubagentRole ?? fallback;
}

export function mapStreamEventToEvents(
  message: Record<string, unknown>,
  threadId: string,
  sessionId: string,
  role: RuntimeAgentRole,
  uuid: string,
  ctx: SdkStreamContext,
): AgentEvent[] {
  const parentToolUseId = typeof message.parent_tool_use_id === "string" ? message.parent_tool_use_id : null;
  ctx.parentToolUseId = parentToolUseId;

  const messageRole = readMessageSubagentRole(message);
  if (parentToolUseId) {
    if (messageRole) {
      ctx.subagentRoleByParentToolUseId.set(parentToolUseId, messageRole);
    }
    const resolvedRole = messageRole ?? ctx.subagentRoleByParentToolUseId.get(parentToolUseId);
    if (resolvedRole) {
      ctx.activeSubagentRole = resolvedRole;
    } else {
      delete ctx.activeSubagentRole;
    }
  } else if (messageRole) {
    ctx.activeSubagentRole = messageRole;
  } else {
    // Messages with no subagent marker belong to the main session; clear subagent context
    // so interleaved main-agent output is not attributed to the last streaming subagent.
    delete ctx.activeSubagentRole;
  }
  const streamRole = effectiveStreamRole(ctx, role);

  const subagentType = typeof message.subagent_type === "string" ? message.subagent_type : undefined;
  const agentType = typeof message.agent_type === "string" ? message.agent_type : undefined;
  const event = isRecord(message.event) ? message.event : null;
  if (!event || typeof event.type !== "string") {
    return [];
  }

  const events: AgentEvent[] = [];
  const streamMeta = {
    ...(parentToolUseId && { parent_tool_use_id: parentToolUseId }),
    ...(subagentType && { subagent_type: subagentType }),
    ...(agentType && { agent_type: agentType }),
  };

  if (event.type === "content_block_start" && isRecord(event.content_block)) {
    const block = event.content_block;
    const blockType = block.type;
    const blockIndex = readStreamEventIndex(event);
    if (blockIndex !== undefined) {
      ctx.activeBlockIndex = blockIndex;
    } else {
      delete ctx.activeBlockIndex;
    }
    if (blockType === "tool_use" && typeof block.name === "string") {
      ctx.inToolBlock = true;
      ctx.activeBlockKind = "tool_use";
      ctx.currentToolName = block.name;
      if (typeof block.id === "string") {
        ctx.currentToolUseId = block.id;
      } else {
        delete ctx.currentToolUseId;
      }
      ctx.currentToolInputJson = "";
      if (ctx.currentToolUseId) {
        ctx.emittedToolUseIds.add(ctx.currentToolUseId);
      }
      events.push(
        createToolStartedEvent(threadId, sessionId, streamRole, uuid, {
          type: "tool_use",
          tool_name: block.name,
          ...(ctx.currentToolUseId && { tool_use_id: ctx.currentToolUseId }),
          streaming: true,
          ...streamMeta,
        }, ctx, parentToolUseId),
      );
      return events;
    }
    if (blockType === "thinking") {
      ctx.inToolBlock = false;
      ctx.activeBlockKind = "thinking";
      events.push(
        createStreamDeltaEvent(threadId, sessionId, streamRole, uuid, {
          type: "eco_stream",
          blockKind: "thinking",
          streamPlaceholder: true,
          ...streamBlockMetadata("thinking", event, ctx),
          ...streamMeta,
        }, ctx, parentToolUseId),
      );
      return events;
    }
    if (blockType === "text") {
      ctx.inToolBlock = false;
      ctx.activeBlockKind = "text";
      events.push(
        createStreamDeltaEvent(threadId, sessionId, streamRole, uuid, {
          type: "eco_stream",
          blockKind: "text",
          streamPlaceholder: true,
          ...streamBlockMetadata("text", event, ctx),
          ...streamMeta,
        }, ctx, parentToolUseId),
      );
      return events;
    }
    return events;
  }

  if (event.type === "content_block_delta" && isRecord(event.delta)) {
    const delta = event.delta;
    if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
      ctx.currentToolInputJson += delta.partial_json;
      return events;
    }
    if (ctx.inToolBlock && delta.type === "text_delta") {
      return events;
    }
    if (delta.type === "text_delta" && typeof delta.text === "string") {
      const text = delta.text;
      if (!text) {
        return events;
      }
      const embedded = tryParseSerializedAnthropicContentBlocks(text);
      if (embedded) {
        for (const [index, block] of embedded.entries()) {
          if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
            events.push(
              createStreamDeltaEvent(threadId, sessionId, streamRole, uuid, {
                type: "eco_stream",
                blockKind: "text",
                text: block.text,
                streamFinalize: true,
                stream_block_key: `embedded:text:${index}`,
                ...streamMeta,
              }, ctx, parentToolUseId),
            );
          } else if (
            block.type === "thinking" &&
            typeof block.thinking === "string" &&
            block.thinking.trim()
          ) {
            events.push(
              createStreamDeltaEvent(threadId, sessionId, streamRole, uuid, {
                type: "eco_stream",
                blockKind: "thinking",
                text: block.thinking,
                streamFinalize: true,
                stream_block_key: `embedded:thinking:${index}`,
                ...streamMeta,
              }, ctx, parentToolUseId),
            );
          } else if (block.type === "tool_use" && typeof block.name === "string") {
            const toolUseId = typeof block.id === "string" ? block.id : undefined;
            if (toolUseId && ctx.emittedToolUseIds.has(toolUseId)) {
              continue;
            }
            if (toolUseId) {
              ctx.emittedToolUseIds.add(toolUseId);
            }
            events.push(
              createToolStartedEvent(threadId, sessionId, streamRole, `${uuid}:embedded:${index}`, {
                type: "tool_use",
                tool_name: block.name,
                ...(toolUseId && { tool_use_id: toolUseId }),
                ...(isRecord(block.input) && { input: block.input }),
                ...streamMeta,
              }, ctx, parentToolUseId),
            );
          }
        }
        return events;
      }
      events.push(
        createStreamDeltaEvent(threadId, sessionId, streamRole, uuid, {
          type: "eco_stream",
          blockKind: "text",
          text,
          ...streamBlockMetadata("text", event, ctx),
          ...streamMeta,
        }, ctx, parentToolUseId),
      );
      return events;
    }
    if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
      const thinking = delta.thinking;
      if (!thinking) {
        return events;
      }
      events.push(
        createStreamDeltaEvent(threadId, sessionId, streamRole, uuid, {
          type: "eco_stream",
          blockKind: "thinking",
          text: thinking,
          ...streamBlockMetadata("thinking", event, ctx),
          ...streamMeta,
        }, ctx, parentToolUseId),
      );
      return events;
    }
    return events;
  }

  if (event.type === "content_block_stop") {
    if (ctx.inToolBlock) {
      const parsedInput = parseToolInputJson(ctx.currentToolInputJson);
      if (ctx.currentToolName) {
        events.push(
          createToolStartedEvent(threadId, sessionId, streamRole, uuid, {
            type: "tool_use",
            tool_name: ctx.currentToolName,
            ...(ctx.currentToolUseId && { tool_use_id: ctx.currentToolUseId }),
            ...(parsedInput && { input: parsedInput }),
            streaming: true,
            input_complete: true,
            ...streamMeta,
          }, ctx, parentToolUseId),
        );
      }
    } else if (ctx.activeBlockKind === "thinking") {
      events.push(
        createStreamDeltaEvent(threadId, sessionId, streamRole, uuid, {
          type: "eco_stream",
          blockKind: "thinking",
          streamFinalize: true,
          ...streamBlockMetadata("thinking", event, ctx),
          ...streamMeta,
        }, ctx, parentToolUseId),
      );
    } else if (ctx.activeBlockKind === "text") {
      events.push(
        createStreamDeltaEvent(threadId, sessionId, streamRole, uuid, {
          type: "eco_stream",
          blockKind: "text",
          streamFinalize: true,
          ...streamBlockMetadata("text", event, ctx),
          ...streamMeta,
        }, ctx, parentToolUseId),
      );
    }
    ctx.inToolBlock = false;
    ctx.activeBlockKind = null;
    delete ctx.activeBlockIndex;
    delete ctx.currentToolName;
    delete ctx.currentToolUseId;
    ctx.currentToolInputJson = "";
    return events;
  }

  if (event.type === "message_delta" && isRecord(event.usage)) {
    // A message carrying subagent_type but no parent id is still explicitly subagent usage;
    // only messages with neither marker are main-session usage (null short-circuits).
    const attributed = applySubagentUsageAttribution(
      {
        role: streamRole,
        sessionId,
        payload: { usage: event.usage },
        ...(parentToolUseId != null
          ? { messageParentToolUseId: parentToolUseId }
          : messageRole
            ? {}
            : { messageParentToolUseId: null }),
      },
      ctx,
    );
    events.push(
      createAgentEvent({
        id: `${uuid}:stream-usage`,
        threadId,
        agentId: attributed.agentId,
        role: streamRole,
        type: "usage.recorded",
        payload: attributed.payload,
      }),
    );
  }

  return events;
}

function readStreamEventIndex(event: Record<string, unknown>): number | undefined {
  const index = event.index;
  if (typeof index === "number" && Number.isInteger(index) && index >= 0) {
    return index;
  }
  return undefined;
}

function streamBlockMetadata(
  kind: "text" | "thinking",
  event: Record<string, unknown>,
  ctx: SdkStreamContext,
): { stream_block_key?: string } {
  const index = readStreamEventIndex(event) ?? ctx.activeBlockIndex;
  if (index === undefined) {
    return {};
  }
  const key = `${kind}:${index}`;
  ctx.emittedStreamBlockKeys.add(key);
  return { stream_block_key: key };
}

function createStreamDeltaEvent(
  threadId: string,
  sessionId: string,
  role: RuntimeAgentRole,
  uuid: string,
  payload: EcoStreamPayload & { type: "eco_stream" },
  streamCtx: SdkStreamContext,
  messageParentToolUseId?: string | null,
): AgentEvent {
  return createAttributedAgentEvent(
    {
      id: `${uuid}:stream`,
      threadId,
      sessionId,
      role,
      type: "message.delta",
      payload: payload as Record<string, unknown>,
      messageParentToolUseId,
    },
    streamCtx,
  );
}

function createToolStartedEvent(
  threadId: string,
  sessionId: string,
  role: RuntimeAgentRole,
  uuid: string,
  payload: EcoStreamPayload & { type: "tool_use" },
  streamCtx: SdkStreamContext,
  messageParentToolUseId?: string | null,
): AgentEvent {
  const toolUseId = payload.tool_use_id;
  return createAttributedAgentEvent(
    {
      id: `${uuid}:tool:${toolUseId ?? payload.tool_name}`,
      threadId,
      sessionId,
      role,
      type: "tool.started",
      payload: payload as Record<string, unknown>,
      messageParentToolUseId,
    },
    streamCtx,
  );
}

export function isEcoStreamPayload(payload: unknown): payload is EcoStreamPayload {
  if (!isRecord(payload)) {
    return false;
  }
  if (payload.type === "eco_stream") {
    return payload.blockKind === "text" || payload.blockKind === "thinking";
  }
  if (payload.type === "tool_use") {
    return typeof payload.tool_name === "string";
  }
  return false;
}

export function isEcoStreamPlaceholder(payload: unknown): boolean {
  return isRecord(payload) && payload.type === "eco_stream" && payload.streamPlaceholder === true;
}

export function isEcoStreamFinalize(payload: unknown): boolean {
  return isRecord(payload) && payload.type === "eco_stream" && payload.streamFinalize === true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseToolInputJson(raw: string): Record<string, unknown> | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}
