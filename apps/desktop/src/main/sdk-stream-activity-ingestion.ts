import {
  type AgentEvent,
  normalizeSdkSubagentType,
  type RuntimeAgentRole,
  SDK_GENERAL_PURPOSE_AGENT_KEY,
  SDK_PLAN_AGENT_KEY,
} from "@eco/runtime";
import { repairActivityText } from "../shared/activity-text";
import type { AgentRole } from "../shared/ipc";
import { resolveActivityAgentId, shouldOmitAcpRootActivityAgentId } from "./activity-agent-id";
import type { AgentLifecycleService } from "./agent-lifecycle-service";
import type { ContextLifecycleService } from "./context-lifecycle-service";
import type { ConversationStore } from "./conversation-store";
import { reconcileSdkAgentTerminalEvent } from "./sdk-agent-terminal-reconciliation";
import { type SdkLocalStreamUpdate, SdkStreamActivityBridge } from "./sdk-stream-activity";
import { getThreadSubagentLaunchRegistry } from "./subagent-launch-registry-store";
import type { SubagentMetricsRegistry } from "./subagent-metrics-registry";
import {
  applyExactLogicalRequestLateBind,
  resolveLiveRequestIdForEvent,
  resolveSdkLateBindAttribution,
} from "./thread-live-request-coordinator";
import type { ThreadLiveRequestRegistry } from "./thread-live-request-registry";
import {
  createThreadRunEventLivePersister,
  type ThreadRunEventLivePersistExtras,
} from "./thread-run-event-live-persist";
import {
  buildSubagentLifecycleRunEvent,
  buildSubagentMissionAttributedRunEvent,
} from "./thread-run-event-normalizer";
import type { UsageLedgerCoordinator } from "./usage-ledger-coordinator";

type AgentEventLike = Pick<AgentEvent, "id" | "type" | "payload" | "role" | "agentId" | "timestamp">;

export type SubagentDelegationLinker = (input: {
  agentId: string;
  agentType: string;
  parentToolUseId: string;
  prompt?: string;
  todoId?: string;
}) => void;

export interface SdkStreamActivityIngestionDeps {
  store: ConversationStore;
  lifecycle: AgentLifecycleService;
  metricsRegistry: SubagentMetricsRegistry;
  usageLedger: Pick<UsageLedgerCoordinator, "settleProxyPendingForSubagentStart">;
  contextLifecycle: Pick<ContextLifecycleService, "handleSdkContextEvent">;
  liveRequestRegistry: ThreadLiveRequestRegistry;
  bridge?: SdkStreamActivityBridge;
  logDiagnostic?: (topic: string, fields: Record<string, unknown>) => void;
  emitRequestTerminalEvent: ThreadRunEventLivePersistDeps["emitRequestTerminalEvent"];
  onProjectionUpdated: (threadId: string, options?: { streaming?: boolean }) => void;
  onSubagentTimingUpdated?: (threadId: string) => void;
  onContextCompactionStatus?: (threadId: string, input: { stage: "started"; trigger: "auto" }) => void;
  onLocalStreamUpdate?: (update: SdkLocalStreamUpdate & { observedAt: string }) => void;
  onBrowserToolStarted?: (input: { threadId: string; payload: Record<string, unknown> }) => void;
  buildBashApprovalMetadata?: ThreadRunEventLivePersistDeps["buildBashApprovalMetadata"];
  createEventId?: ThreadRunEventLivePersistDeps["createEventId"];
  now?: () => string;
  /** Live main process: full emitThreadEvent (persist + renderer IPC). Replay omits this and uses persistThreadEvent only. */
  emitBridgeThreadEvent?: (
    threadId: string,
    type: string,
    message: string,
    role: RuntimeAgentRole | "system" | "thinking" | "tool" | "user",
    stream: boolean,
    extras?: ThreadRunEventLivePersistExtras,
  ) => void;
}

type ThreadRunEventLivePersistDeps = Parameters<typeof createThreadRunEventLivePersister>[0];

export interface SdkStreamActivityIngestion {
  ingest(threadId: string, event: AgentEventLike, options?: { observedAt?: string }): void;
  flush(threadId: string, options?: { observedAt?: string }): void;
  registerDelegationLinker(threadId: string, linker: SubagentDelegationLinker): void;
  clearDelegationLinker(threadId: string): void;
  persistThreadEvent(
    threadId: string,
    type: string,
    message: string,
    role: RuntimeAgentRole | "system" | "thinking" | "tool" | "user",
    stream: boolean,
    extras?: ThreadRunEventLivePersistExtras,
    options?: { observedAt?: string },
  ): void;
}

export function createSdkStreamActivityIngestion(
  deps: SdkStreamActivityIngestionDeps,
): SdkStreamActivityIngestion {
  const bridge = deps.bridge ?? new SdkStreamActivityBridge();
  const logDiagnostic = deps.logDiagnostic ?? (() => {});
  const delegationLinkers = new Map<string, SubagentDelegationLinker>();
  const now = deps.now ?? (() => new Date().toISOString());

  const persister = createThreadRunEventLivePersister({
    store: deps.store,
    lifecycle: deps.lifecycle,
    metricsRegistry: deps.metricsRegistry,
    liveRequestRegistry: deps.liveRequestRegistry,
    resolveCurrentRunAttemptId: (threadId) => {
      try {
        return deps.lifecycle.currentRunAttemptId(threadId) ?? deps.lifecycle.usageRunAttemptId(threadId);
      } catch {
        return undefined;
      }
    },
    resolveAgentIdByParentToolUseId: (threadId, parentToolUseId) => {
      const linked = deps.metricsRegistry.resolveAgentIdByParentToolUse(threadId, parentToolUseId);
      if (linked) {
        return linked;
      }
      const agent = deps.store
        .listAgentInstances(threadId)
        .find((row) => row.parentToolUseId?.trim() === parentToolUseId.trim());
      return agent?.agentId;
    },
    emitRequestTerminalEvent: deps.emitRequestTerminalEvent,
    onProjectionUpdated: deps.onProjectionUpdated,
    ...(deps.buildBashApprovalMetadata && { buildBashApprovalMetadata: deps.buildBashApprovalMetadata }),
    ...(deps.createEventId && { createEventId: deps.createEventId }),
    now,
  });

  const persistThreadEvent: SdkStreamActivityIngestion["persistThreadEvent"] = (
    threadId,
    type,
    message,
    role,
    stream,
    extras,
    options,
  ) => {
    const { text: normalizedMessage } = repairActivityText(message);
    const trimmed = normalizedMessage.trim();
    const isThreadStatusEvent = type.startsWith("thread.");
    const allowEmptyStream = stream && trimmed.length === 0;
    if (!trimmed && !allowEmptyStream && !isThreadStatusEvent) {
      return;
    }
    const displayMessage = trimmed || (isThreadStatusEvent ? "状态已更新" : "");
    persister.persistFromLiveEvent({
      threadId,
      type,
      displayMessage,
      role: String(role),
      stream,
      ...(options?.observedAt && { observedAt: options.observedAt }),
      ...(extras && { extras }),
    });
  };

  function tryResolveStreamSubagentDelegation(threadId: string, parentToolUseId: string): void {
    const linked =
      getThreadSubagentLaunchRegistry(threadId).resolveFromStreamParentToolUseId(parentToolUseId);
    if (!linked) {
      return;
    }
    delegationLinkers.get(threadId)?.({
      agentId: linked.agentId,
      agentType: linked.launch.role,
      parentToolUseId: linked.launch.parentToolUseId,
      prompt: linked.launch.prompt,
      ...(linked.launch.todoIdHint && { todoId: linked.launch.todoIdHint }),
    });
  }

  function maybeHandleAcpNestedSubagentLifecycle(
    threadId: string,
    event: AgentEventLike,
    observedAt: string,
  ): boolean {
    if (event.type !== "agent.started" && event.type !== "agent.completed") {
      return false;
    }
    if (!isRecord(event.payload) || event.payload.source !== "acp") {
      return false;
    }
    const agentId = event.agentId?.trim();
    const parentToolUseId =
      typeof event.payload.parentToolUseId === "string"
        ? event.payload.parentToolUseId.trim()
        : typeof event.payload.parent_tool_use_id === "string"
          ? event.payload.parent_tool_use_id.trim()
          : "";
    if (!agentId || !parentToolUseId) {
      return false;
    }
    const rawRole =
      typeof event.payload.subagent_type === "string"
        ? event.payload.subagent_type
        : typeof event.role === "string"
          ? event.role
          : "";
    const role =
      normalizeSdkSubagentType(rawRole) ??
      (rawRole === SDK_GENERAL_PURPOSE_AGENT_KEY || rawRole === SDK_PLAN_AGENT_KEY
        ? rawRole
        : SDK_GENERAL_PURPOSE_AGENT_KEY);
    const prompt =
      typeof event.payload.prompt === "string"
        ? event.payload.prompt.trim()
        : typeof event.payload.task === "string"
          ? event.payload.task.trim()
          : "";
    const runAttemptId = deps.lifecycle.usageRunAttemptId(threadId);
    const parentAgentId = deps.lifecycle.currentPlannerAgentId(threadId);

    if (event.type === "agent.started") {
      const existing = deps.store.listAgentInstances(threadId).find((row) => row.agentId === agentId);
      if (existing) {
        return true;
      }
      const lifecycleRecord = deps.lifecycle.startSubagent({
        threadId,
        agentId,
        role,
        parentToolUseId,
        ...(prompt && { missionKey: prompt.slice(0, 120) }),
      });
      deps.store.upsertSubagentSessionActive({
        threadId,
        role,
        agentId,
        phase: "execution",
        ...(prompt && { missionKey: prompt.slice(0, 120) }),
      });
      deps.metricsRegistry.onSubagentStart(threadId, {
        agentId,
        role,
        parentToolUseId,
      });
      deps.store.appendThreadRunEvent(
        buildSubagentLifecycleRunEvent({
          threadId,
          agentId,
          role,
          lifecycle: "started",
          observedAt,
          parentToolUseId,
          ...(runAttemptId && { runAttemptId }),
          ...(parentAgentId && { parentAgentId }),
          ...(lifecycleRecord?.runAttemptId && { runAttemptId: lifecycleRecord.runAttemptId }),
          ...(prompt && { delegationPrompt: prompt }),
        }),
      );
      if (prompt) {
        deps.store.appendThreadRunEvent(
          buildSubagentMissionAttributedRunEvent({
            threadId,
            agentId,
            role,
            prompt,
            observedAt,
            parentToolUseId,
            ...(runAttemptId && { runAttemptId }),
          }),
        );
      }
      deps.onProjectionUpdated(threadId, { streaming: true });
      deps.onSubagentTimingUpdated?.(threadId);
      return true;
    }

    const failed = event.payload.failed === true;
    if (failed) {
      deps.lifecycle.abandonSubagent({ threadId, agentId, role });
    } else {
      deps.lifecycle.stopSubagent({ threadId, agentId, role });
    }
    deps.metricsRegistry.onSubagentStop(threadId, { agentId, role });
    deps.store.markSubagentSessionStopped(threadId, agentId);
    deps.store.appendThreadRunEvent(
      buildSubagentLifecycleRunEvent({
        threadId,
        agentId,
        role,
        lifecycle: failed ? "abandoned" : "stopped",
        observedAt,
        parentToolUseId,
        ...(runAttemptId && { runAttemptId }),
        ...(parentAgentId && { parentAgentId }),
        ...(prompt && { delegationPrompt: prompt }),
      }),
    );
    deps.onProjectionUpdated(threadId, { streaming: false });
    deps.onSubagentTimingUpdated?.(threadId);
    return true;
  }

  function ingest(threadId: string, event: AgentEventLike, options?: { observedAt?: string }): void {
    const observedAt = options?.observedAt ?? readEventObservedAt(event, now());

    reconcileSdkAgentTerminalEvent(threadId, event, {
      resolveParentToolUseAgentId: (parentToolUseId) => {
        const linked = deps.metricsRegistry.resolveAgentIdByParentToolUse(threadId, parentToolUseId);
        if (linked) {
          return linked;
        }
        return deps.store
          .listAgentInstances(threadId)
          .find((row) => row.parentToolUseId?.trim() === parentToolUseId.trim())?.agentId;
      },
      linkParentToolUse: (parentToolUseId, agentId) => {
        deps.metricsRegistry.linkToolUseToAgent(threadId, parentToolUseId, agentId);
        deps.lifecycle.linkSubagentParentToolUse({ threadId, agentId, parentToolUseId });
      },
      settlePendingByParent: ({ agentId, role, parentToolUseId }) =>
        deps.usageLedger.settleProxyPendingForSubagentStart(threadId, {
          agentId,
          role,
          parentToolUseId,
        }),
      logDiagnostic,
    });

    if ((event.type === "tool.started" || event.type === "tool.completed") && isRecord(event.payload)) {
      if (event.type === "tool.started") {
        deps.onBrowserToolStarted?.({ threadId, payload: event.payload });
      }
      const toolName = typeof event.payload.tool_name === "string" ? event.payload.tool_name.trim() : "";
      const toolUseId = typeof event.payload.tool_use_id === "string" ? event.payload.tool_use_id : undefined;
      if (toolUseId && (toolName === "Task" || toolName === "Agent")) {
        if (event.type === "tool.started") {
          const rawRole =
            typeof event.payload.subagent_type === "string"
              ? event.payload.subagent_type
              : typeof event.payload.agent_type === "string"
                ? event.payload.agent_type
                : "";
          const role =
            normalizeSdkSubagentType(rawRole) ??
            (rawRole === SDK_GENERAL_PURPOSE_AGENT_KEY || rawRole === SDK_PLAN_AGENT_KEY
              ? rawRole
              : SDK_GENERAL_PURPOSE_AGENT_KEY);
          deps.metricsRegistry.noteTaskToolUse(threadId, toolUseId, role);
          deps.lifecycle.noteTaskToolUse(threadId, toolUseId, role);
        }
        tryResolveStreamSubagentDelegation(threadId, toolUseId);
      }
    }

    maybeHandleAcpNestedSubagentLifecycle(threadId, event, observedAt);
    deps.contextLifecycle.handleSdkContextEvent({
      threadId,
      eventId: event.id ?? `sdk_event:${event.type}`,
      payload: event.payload,
    });

    if (isSdkCompactionStatusEvent(event)) {
      deps.onContextCompactionStatus?.(threadId, { stage: "started", trigger: "auto" });
      return;
    }
    if (isSdkCompactionBoundaryEvent(event)) {
      return;
    }

    const sdkParentToolUseId = readSdkEventParentToolUseId(event);
    if (sdkParentToolUseId) {
      tryResolveStreamSubagentDelegation(threadId, sdkParentToolUseId);
    }

    const plannerSessionId =
      deps.store.getSdkSession(threadId)?.sessionId?.trim() ||
      deps.store.getThreadCoreSession(threadId)?.externalSessionId?.trim();
    const coreKind = deps.store.getThread(threadId)?.coreKind;
    const streamAttributedAgentId = readStreamAttributedAgentId(event.agentId, plannerSessionId);
    const resolvedActivityAgentId =
      resolveActivityAgentId(threadId, event, {
        ...(plannerSessionId && { plannerSessionId }),
        metricsRegistry: deps.metricsRegistry,
        ...(coreKind && { coreKind }),
      }) ?? streamAttributedAgentId;
    // ACP root turns stamp a per-run UUID that never becomes an Eco agent Card —
    // drop it so thread-run events stay `scope: main` and the Feed skeleton tracks them.
    // (`resolveActivityAgentId` already omits, but `?? streamAttributedAgentId` would reintroduce it.)
    const activityAgentId =
      shouldOmitAcpRootActivityAgentId({
        coreKind,
        eventAgentId: event.agentId,
        parentToolUseId: sdkParentToolUseId,
      })
        ? undefined
        : resolvedActivityAgentId;

    const logicalRequestId = readSdkEventLogicalRequestId(event);
    if (logicalRequestId) {
      const attribution = resolveSdkLateBindAttribution(
        threadId,
        {
          type: event.type,
          role: String(event.role),
          ...(event.agentId ? { agentId: event.agentId } : {}),
          payload: event.payload,
        },
        {
          ...(plannerSessionId ? { plannerSessionId } : {}),
          metricsRegistry: deps.metricsRegistry,
        },
      );
      if (attribution) {
        const lateBind = applyExactLogicalRequestLateBind(deps.liveRequestRegistry, deps.store, {
          threadId,
          logicalRequestId,
          agentId: attribution.agentId,
          role: attribution.role,
        });
        if (lateBind.ok && lateBind.emitTimelineActivity && lateBind.updated > 0) {
          deps.onProjectionUpdated(threadId);
        }
      }
    }

    bridge.handleEvent(
      threadId,
      event,
      (id, type, message, role, stream, agentId, extras) => {
        const mergedMetadata = {
          ...(extras?.metadata ?? {}),
          ...(sdkParentToolUseId && { parent_tool_use_id: sdkParentToolUseId }),
        };
        const hasMetadata = Object.keys(mergedMetadata).length > 0;
        const liveRequestId = resolveLiveRequestIdForEvent(deps.liveRequestRegistry, id, {
          type,
          role: String(role),
          stream,
          ...(agentId && { agentId }),
        });
        const bridgeExtras =
          agentId || extras || sdkParentToolUseId || liveRequestId
            ? {
                ...(agentId && { agentId }),
                ...(extras?.tool && { tool: extras.tool }),
                ...(hasMetadata && { metadata: mergedMetadata }),
                ...(liveRequestId && { requestId: liveRequestId }),
              }
            : undefined;
        if (deps.emitBridgeThreadEvent) {
          deps.emitBridgeThreadEvent(
            id,
            type,
            message,
            role as AgentRole | "system" | "thinking" | "tool" | "user",
            stream,
            bridgeExtras,
          );
          return;
        }
        persistThreadEvent(
          id,
          type,
          message,
          role as AgentRole | "system" | "thinking" | "tool" | "user",
          stream,
          bridgeExtras,
          { observedAt },
        );
      },
      undefined,
      {
        ...(activityAgentId && { activityAgentId }),
        ...(sdkParentToolUseId && { parentToolUseId: sdkParentToolUseId }),
        ...(deps.onLocalStreamUpdate
          ? {
              onLocalStreamUpdate: (update: SdkLocalStreamUpdate) =>
                deps.onLocalStreamUpdate!({ ...update, observedAt }),
            }
          : {}),
      },
    );
  }

  function flush(threadId: string, options?: { observedAt?: string }): void {
    const observedAt = options?.observedAt ?? now();
    bridge.flushPendingAndReset(threadId, (id, type, message, role, stream, agentId, extras) => {
      if (deps.emitBridgeThreadEvent) {
        deps.emitBridgeThreadEvent(
          id,
          type,
          message,
          role as AgentRole | "system" | "thinking" | "tool" | "user",
          stream,
          extras,
        );
        return;
      }
      persistThreadEvent(
        id,
        type,
        message,
        role as AgentRole | "system" | "thinking" | "tool" | "user",
        stream,
        extras,
        { observedAt },
      );
    });
  }

  return {
    ingest,
    flush,
    registerDelegationLinker: (threadId, linker) => {
      delegationLinkers.set(threadId, linker);
    },
    clearDelegationLinker: (threadId) => {
      delegationLinkers.delete(threadId);
    },
    persistThreadEvent,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSdkEventParentToolUseId(event: AgentEventLike): string | undefined {
  if (!isRecord(event.payload)) {
    return undefined;
  }
  const parentToolUseId = event.payload.parent_tool_use_id;
  return typeof parentToolUseId === "string" && parentToolUseId.trim() ? parentToolUseId.trim() : undefined;
}

function readSdkEventLogicalRequestId(event: AgentEventLike): string | undefined {
  if (!isRecord(event.payload)) {
    return undefined;
  }
  const fromPayload = event.payload.request_id ?? event.payload.logicalRequestId;
  return typeof fromPayload === "string" && fromPayload.trim() ? fromPayload.trim() : undefined;
}

function readStreamAttributedAgentId(
  agentId: string | undefined,
  plannerSessionId: string | undefined,
): string | undefined {
  const trimmed = agentId?.trim();
  if (!trimmed || trimmed === "unknown-session" || trimmed === plannerSessionId) {
    return undefined;
  }
  return trimmed;
}

function isSdkCompactionStatusEvent(event: AgentEventLike): boolean {
  return (
    isRecord(event.payload) &&
    event.payload.type === "system" &&
    event.payload.subtype === "status" &&
    event.payload.status === "compacting"
  );
}

function isSdkCompactionBoundaryEvent(event: AgentEventLike): boolean {
  return isRecord(event.payload) && event.payload.subtype === "compact_boundary";
}

function readEventObservedAt(event: AgentEventLike, fallback: string): string {
  if (typeof event.timestamp === "string" && event.timestamp.trim()) {
    return event.timestamp;
  }
  return fallback;
}
