import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_CONTEXT_LIMIT } from "@eco/runtime";
import {
  createSubagentLaunchPreToolHook,
  createSubagentStartHook,
  createSubagentStopHook,
  normalizeAgentToolInputSubagentType,
  readAgentSubagentType,
  type AgentEvent,
  type EcoSubagentAttributionHooks,
} from "@eco/runtime";
import type {
  PreToolUseHookInput,
  SubagentStartHookInput,
  SubagentStopHookInput,
} from "@anthropic-ai/claude-agent-sdk";
import type { ThreadRunEvent, ThreadSummary } from "../shared/ipc";
import type { ThreadRunProjectionSnapshot } from "../shared/thread-run-projection";
import type { ContextMonitorSnapshot } from "./context-window-monitor";
import { AgentLifecycleService } from "./agent-lifecycle-service";
import { createContextLifecycleService } from "./context-lifecycle-service";
import { createConversationStore } from "./conversation-store";
import { createSdkStreamActivityIngestion } from "./sdk-stream-activity-ingestion";
import { createSubagentSessionHooks } from "./subagent-session-hooks";
import { clearThreadSubagentLaunchRegistry, getThreadSubagentLaunchRegistry } from "./subagent-launch-registry-store";
import { SubagentMetricsRegistry } from "./subagent-metrics-registry";
import { createThreadSdkTaskRuntime } from "./thread-sdk-task-runtime";
import { ThreadLiveRequestRegistry } from "./thread-live-request-registry";
import { UsageLedgerCoordinator } from "./usage-ledger-coordinator";
import { buildThreadRunProjection } from "./thread-run-projection";
import { trimProjectionForFeed } from "./thread-run-projection-feed";

export interface SdkAgentEventsReplayResult {
  threadId: string;
  persistedEvents: ThreadRunEvent[];
  /** Feed skeleton for sidebar / main feed RPC (`mode: feed`). */
  projection: ThreadRunProjectionSnapshot;
  /** Full projection for detail RPC (subagent drawer, turn expand). */
  fullProjection: ThreadRunProjectionSnapshot;
  feedTimelineIds: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readEventObservedAt(event: Pick<AgentEvent, "timestamp">, previous: string): string {
  if (typeof event.timestamp === "string" && event.timestamp.trim()) {
    const trimmed = event.timestamp.trim();
    if (trimmed.localeCompare(previous) > 0) {
      return trimmed;
    }
  }
  const nextMs = Date.parse(previous) + 1;
  return Number.isFinite(nextMs) ? new Date(nextMs).toISOString() : previous;
}

function isPiChildSessionCapture(event: AgentEvent, parentAgentId: string): string | undefined {
  if (event.type !== "session.captured" || !isRecord(event.payload)) {
    return undefined;
  }
  const sessionId =
    (typeof event.payload.sessionId === "string" && event.payload.sessionId.trim()) ||
    event.agentId?.trim() ||
    "";
  if (!sessionId || sessionId === parentAgentId) {
    return undefined;
  }
  const bindingId = typeof event.payload.bindingId === "string" ? event.payload.bindingId : "";
  if (bindingId.includes("_child")) {
    return sessionId;
  }
  return undefined;
}

interface SubagentTaskLink {
  taskId: string;
  agentType: string;
}

interface ReplaySubagentTiming {
  startedAt: string;
  endedAt?: string;
  parentToolUseId?: string;
}

function patchProjectionSubagentTimings(
  projection: ThreadRunProjectionSnapshot,
  timings: ReadonlyMap<string, ReplaySubagentTiming>,
): ThreadRunProjectionSnapshot {
  if (timings.size === 0) {
    return projection;
  }
  return {
    ...projection,
    agents: projection.agents.map((agent) => {
      const timing = timings.get(agent.agentId);
      if (!timing) {
        return agent;
      }
      const durationMs =
        timing.endedAt && timing.startedAt
          ? Math.max(0, Date.parse(timing.endedAt) - Date.parse(timing.startedAt))
          : agent.durationMs;
      return {
        ...agent,
        startedAt: timing.startedAt,
        durationMs,
        ...(timing.endedAt ? { endedAt: timing.endedAt } : {}),
        ...(timing.parentToolUseId ? { parentToolUseId: timing.parentToolUseId } : {}),
      };
    }),
  };
}

/** Recorded client-round fixtures omit task_started; pair task ids before stream ingest. */
function buildSubagentTaskLinksFromAgentEvents(events: readonly AgentEvent[]): Map<string, SubagentTaskLink> {
  const agentTypeByParentToolUseId = new Map<string, string>();
  for (const event of events) {
    if (event.type !== "tool.started" || !isRecord(event.payload) || event.payload.input_complete !== true) {
      continue;
    }
    const toolName = typeof event.payload.tool_name === "string" ? event.payload.tool_name.trim() : "";
    if (toolName !== "Task" && toolName !== "Agent") {
      continue;
    }
    const parentToolUseId =
      typeof event.payload.tool_use_id === "string" ? event.payload.tool_use_id.trim() : "";
    if (!parentToolUseId) {
      continue;
    }
    const rawToolInput = isRecord(event.payload.input) ? event.payload.input : {};
    const { input: toolInput } = normalizeAgentToolInputSubagentType(rawToolInput);
    const agentType =
      readAgentSubagentType(toolInput) ||
      (typeof event.payload.subagent_type === "string" && event.payload.subagent_type.trim()) ||
      "";
    if (agentType) {
      agentTypeByParentToolUseId.set(parentToolUseId, agentType);
    }
  }

  const links = new Map<string, SubagentTaskLink>();
  for (const event of events) {
    if (event.type === "todo.updated" && isRecord(event.payload) && event.payload.sdkKind === "task_started") {
      const taskId = typeof event.payload.task_id === "string" ? event.payload.task_id.trim() : "";
      const parentToolUseId =
        (typeof event.payload.parent_tool_use_id === "string" && event.payload.parent_tool_use_id.trim()) ||
        (typeof event.payload.tool_use_id === "string" && event.payload.tool_use_id.trim()) ||
        "";
      const agentType =
        (typeof event.payload.subagent_type === "string" && event.payload.subagent_type.trim()) ||
        (parentToolUseId ? agentTypeByParentToolUseId.get(parentToolUseId) : undefined) ||
        event.role;
      if (taskId && parentToolUseId && agentType) {
        links.set(parentToolUseId, { taskId, agentType });
      }
      continue;
    }
    if (event.type !== "todo.updated" || !isRecord(event.payload) || event.payload.sdkKind !== "task_notification") {
      continue;
    }
    const taskId = typeof event.payload.task_id === "string" ? event.payload.task_id.trim() : "";
    const parentToolUseId =
      (typeof event.payload.parent_tool_use_id === "string" && event.payload.parent_tool_use_id.trim()) ||
      (typeof event.payload.tool_use_id === "string" && event.payload.tool_use_id.trim()) ||
      "";
    if (!taskId || !parentToolUseId || links.has(parentToolUseId)) {
      continue;
    }
    const agentType =
      (typeof event.payload.subagent_type === "string" && event.payload.subagent_type.trim()) ||
      agentTypeByParentToolUseId.get(parentToolUseId) ||
      "";
    if (!agentType) {
      continue;
    }
    links.set(parentToolUseId, { taskId, agentType });
  }

  for (const event of events) {
    if (event.type !== "agent.completed" || !isRecord(event.payload) || event.payload.type !== "agent_output") {
      continue;
    }
    const taskId =
      (typeof event.payload.agentId === "string" && event.payload.agentId.trim()) || event.agentId?.trim() || "";
    const parentToolUseId =
      typeof event.payload.tool_use_id === "string" ? event.payload.tool_use_id.trim() : "";
    const agentType =
      (typeof event.payload.subagent_type === "string" && event.payload.subagent_type.trim()) ||
      (typeof event.payload.agentType === "string" && event.payload.agentType.trim()) ||
      event.role;
    if (!taskId || !parentToolUseId || links.has(parentToolUseId) || !agentType) {
      continue;
    }
    links.set(parentToolUseId, { taskId, agentType });
  }

  // PI fixtures spawn an isolated child session right after Agent tool without todo.updated.
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    if (event.type !== "tool.started" || !isRecord(event.payload) || event.payload.input_complete !== true) {
      continue;
    }
    const toolName = typeof event.payload.tool_name === "string" ? event.payload.tool_name.trim() : "";
    if (toolName !== "Task" && toolName !== "Agent") {
      continue;
    }
    const parentToolUseId =
      typeof event.payload.tool_use_id === "string" ? event.payload.tool_use_id.trim() : "";
    if (!parentToolUseId || links.has(parentToolUseId)) {
      continue;
    }
    const agentType = agentTypeByParentToolUseId.get(parentToolUseId);
    if (!agentType) {
      continue;
    }
    const parentAgentId = event.agentId?.trim() ?? "";
    for (let nextIndex = index + 1; nextIndex < events.length; nextIndex += 1) {
      const next = events[nextIndex]!;
      if (next.type === "tool.started" && isRecord(next.payload) && next.payload.input_complete === true) {
        const nextToolName =
          typeof next.payload.tool_name === "string" ? next.payload.tool_name.trim() : "";
        if (nextToolName === "Task" || nextToolName === "Agent") {
          break;
        }
      }
      const childSessionId = isPiChildSessionCapture(next, parentAgentId);
      if (childSessionId) {
        links.set(parentToolUseId, { taskId: childSessionId, agentType });
        break;
      }
      if (next.type === "agent.started") {
        const sessionId = next.agentId?.trim() ?? "";
        if (sessionId && sessionId !== parentAgentId) {
          links.set(parentToolUseId, { taskId: sessionId, agentType });
          break;
        }
      }
    }
  }

  return links;
}

export async function replaySdkAgentEventsThroughLivePipeline(input: {
  threadId: string;
  title: string;
  prompt: string;
  workspacePath?: string;
  agentEvents: AgentEvent[];
  runAttemptId?: string;
  keepDatabase?: boolean;
}): Promise<SdkAgentEventsReplayResult> {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "eco-sdk-live-replay-"));
  const dbPath = path.join(tempDir, "eco-coding.sqlite");
  const store = await createConversationStore(dbPath);
  const lifecycle = new AgentLifecycleService(store);
  const metricsRegistry = new SubagentMetricsRegistry(store);
  const liveRequestRegistry = new ThreadLiveRequestRegistry();
  const usageLedger = new UsageLedgerCoordinator({ store, metrics: metricsRegistry });
  const noopContextSnapshot = (): ContextMonitorSnapshot => ({
    occupied: 0,
    limit: DEFAULT_CONTEXT_LIMIT,
    ratio: 0,
    occupancyPct: 0,
    limitsResolved: false,
    roles: [],
    instances: [],
  });
  const contextLifecycle = createContextLifecycleService({
    monitor: {
      markCompactCompleted: () => noopContextSnapshot(),
      noteCompactionObserved: () => {},
    },
    emitLiveContext: () => {},
    applySdkContextUsageBreakdown: () => {},
    recordCompactionBoundary: () => {},
  });

  const threadId = input.threadId;
  const baseMs = Date.parse("2026-01-01T00:00:00.000Z");
  const userObservedAt = new Date(baseMs).toISOString();

  const thread: ThreadSummary = {
    id: threadId,
    title: input.title,
    prompt: input.prompt.split("\n")[0] ?? input.title,
    workspacePath: input.workspacePath ?? "/tmp/gateway-client-round",
    status: "idle",
    message: "ok",
    createdAt: userObservedAt,
    updatedAt: userObservedAt,
  };
  store.saveThread(thread);

  lifecycle.startRunAttempt({
    threadId,
    phase: "execution",
    retryIndex: 0,
  });

  const subagentAttribution: EcoSubagentAttributionHooks = {
    resolveAgentId: (attributionInput) =>
      metricsRegistry.resolveAgentId(threadId, {
        role: attributionInput.role,
        ...(attributionInput.parentToolUseId && { parentToolUseId: attributionInput.parentToolUseId }),
      }),
    onTaskToolUse: (toolUseId, attributionRole) => {
      metricsRegistry.noteTaskToolUse(threadId, toolUseId, attributionRole?.role);
      lifecycle.noteTaskToolUse(threadId, toolUseId, attributionRole?.role);
    },
  };

  const subagentSessions = createSubagentSessionHooks(store, threadId, "execution", {
    lifecycle,
    metricsRegistry,
    attribution: subagentAttribution,
    onProxyAttributionSettled: ({ agentId, role, parentToolUseId }) => {
      usageLedger.settleProxyPendingForSubagentStart(threadId, {
        agentId,
        role,
        ...(parentToolUseId && { parentToolUseId }),
      });
    },
  });

  const taskRuntime = createThreadSdkTaskRuntime({
    threadId,
    store: {
      listTodos: (id) => store.listCoderTodos(id),
      replaceTodos: (id, todos) => store.replaceCoderTodos(id, todos),
    },
    emitTodoList: () => {},
  });

  const launchRegistry = getThreadSubagentLaunchRegistry(threadId);
  const launchPreToolHook = createSubagentLaunchPreToolHook({
    registry: launchRegistry,
    attribution: subagentAttribution,
  });
  const taskTracker = taskRuntime.taskRunHooks.hookContextExtras.taskTracker!;
  const subagentStartHook = createSubagentStartHook({
    taskTracker,
    subagentSessions,
    subagentLaunchRegistry: launchRegistry,
    attribution: subagentAttribution,
  });
  const subagentStopHook = createSubagentStopHook({
    taskTracker,
    subagentSessions,
  });

  let eventSeq = 0;

  const ingestion = createSdkStreamActivityIngestion({
    store,
    lifecycle,
    metricsRegistry,
    usageLedger,
    contextLifecycle,
    liveRequestRegistry,
    emitRequestTerminalEvent: () => {},
    onProjectionUpdated: () => {},
    createEventId: () => `replay_${++eventSeq}`,
  });

  if (subagentSessions.onDelegationLinked) {
    const linker = subagentSessions.onDelegationLinked.bind(subagentSessions);
    ingestion.registerDelegationLinker(threadId, (input) => {
      linker({ ...input, prompt: input.prompt ?? "" });
    });
  }

  const hookOptions = { signal: new AbortController().signal };

  ingestion.persistThreadEvent(threadId, "thread.user_prompt", input.prompt, "user", false, undefined, {
    observedAt: userObservedAt,
  });

  const subagentTaskLinks = buildSubagentTaskLinksFromAgentEvents(input.agentEvents);
  const syntheticSubagentStarts = new Set<string>();
  const syntheticSubagentStops = new Set<string>();
  const subagentReplayTimings = new Map<string, ReplaySubagentTiming>();

  let observedAt = userObservedAt;

  for (let index = 0; index < input.agentEvents.length; index += 1) {
    const event = input.agentEvents[index]!;
    observedAt = readEventObservedAt(event, observedAt);

    if (event.type === "tool.started" && isRecord(event.payload) && event.payload.input_complete === true) {
      const toolName = typeof event.payload.tool_name === "string" ? event.payload.tool_name.trim() : "";
      if (toolName === "Task" || toolName === "Agent") {
        const toolUseId =
          typeof event.payload.tool_use_id === "string" ? event.payload.tool_use_id.trim() : "";
        const rawToolInput = isRecord(event.payload.input) ? event.payload.input : {};
        const { input: toolInput } = normalizeAgentToolInputSubagentType(rawToolInput);
        await launchPreToolHook(
          {
            hook_event_name: "PreToolUse",
            tool_name: toolName,
            tool_input: toolInput,
            tool_use_id: toolUseId,
          } as PreToolUseHookInput,
          toolUseId,
          hookOptions,
        );
        const taskLink = subagentTaskLinks.get(toolUseId);
        if (taskLink && !syntheticSubagentStarts.has(toolUseId)) {
          syntheticSubagentStarts.add(toolUseId);
          subagentReplayTimings.set(taskLink.taskId, {
            startedAt: observedAt,
            parentToolUseId: toolUseId,
          });
          await subagentStartHook(
            {
              hook_event_name: "SubagentStart",
              agent_id: taskLink.taskId,
              agent_type: taskLink.agentType,
            } as SubagentStartHookInput,
            toolUseId,
            hookOptions,
          );
        }
      }
    }

    if (event.type === "todo.updated" && isRecord(event.payload) && event.payload.sdkKind === "task_started") {
      const taskId = typeof event.payload.task_id === "string" ? event.payload.task_id.trim() : "";
      const agentType =
        (typeof event.payload.subagent_type === "string" && event.payload.subagent_type) || event.role;
      if (taskId) {
        const existingTiming = subagentReplayTimings.get(taskId);
        subagentReplayTimings.set(taskId, {
          ...existingTiming,
          startedAt: observedAt,
        });
        await subagentStartHook(
          {
            hook_event_name: "SubagentStart",
            agent_id: taskId,
            agent_type: agentType,
          } as SubagentStartHookInput,
          "",
          hookOptions,
        );
      }
    }

    if (event.type === "todo.updated" && isRecord(event.payload) && event.payload.sdkKind === "task_notification") {
      const status = event.payload.status;
      const taskId = typeof event.payload.task_id === "string" ? event.payload.task_id.trim() : "";
      const agentType =
        (typeof event.payload.subagent_type === "string" && event.payload.subagent_type) || event.role;
      if (status === "completed" && taskId) {
        await subagentStopHook(
          {
            hook_event_name: "SubagentStop",
            agent_id: taskId,
            agent_type: agentType,
          } as SubagentStopHookInput,
          undefined,
          hookOptions,
        );
      }
    }

    if (event.type === "agent.completed" && isRecord(event.payload) && event.payload.type === "agent_output") {
      const agentId =
        (typeof event.payload.agentId === "string" && event.payload.agentId.trim()) || event.agentId?.trim() || "";
      const agentType =
        (typeof event.payload.subagent_type === "string" && event.payload.subagent_type) || event.role;
      if (agentId) {
        await subagentStopHook(
          {
            hook_event_name: "SubagentStop",
            agent_id: agentId,
            agent_type: agentType,
          } as SubagentStopHookInput,
          undefined,
          hookOptions,
        );
      }
    }

    if (event.type === "agent.settled" || event.type === "agent.loop_ended") {
      const childSessionId = event.agentId?.trim() ?? "";
      if (childSessionId && !syntheticSubagentStops.has(childSessionId)) {
        for (const link of subagentTaskLinks.values()) {
          if (link.taskId !== childSessionId) {
            continue;
          }
          syntheticSubagentStops.add(childSessionId);
          const existingTiming = subagentReplayTimings.get(childSessionId);
          subagentReplayTimings.set(childSessionId, {
            startedAt: existingTiming?.startedAt ?? observedAt,
            endedAt: observedAt,
            ...(existingTiming?.parentToolUseId
              ? { parentToolUseId: existingTiming.parentToolUseId }
              : {}),
          });
          await subagentStopHook(
            {
              hook_event_name: "SubagentStop",
              agent_id: childSessionId,
              agent_type: link.agentType,
            } as SubagentStopHookInput,
            undefined,
            hookOptions,
          );
          break;
        }
      }
    }

    taskRuntime.handleEvent(event);
    ingestion.ingest(threadId, event, { observedAt });
  }

  ingestion.flush(threadId, {
    observedAt: new Date(Date.parse(observedAt) + 1).toISOString(),
  });

  lifecycle.finishRunAttempt(threadId, "completed");
  ingestion.clearDelegationLinker(threadId);
  clearThreadSubagentLaunchRegistry(threadId);

  const persistedEvents = store.listThreadRunEventsForProjection(threadId);
  const runAttempts = store.listRunAttempts(threadId);

  const fullProjection = patchProjectionSubagentTimings(
    buildThreadRunProjection({
      threadId,
      status: "idle",
      attempts: runAttempts,
      agents: store.listAgentInstances(threadId),
      events: persistedEvents,
      historyComplete: true,
    }),
    subagentReplayTimings,
  );

  const projection = trimProjectionForFeed(fullProjection);

  const feedTimelineIds = projection.timeline.map((item) => item.id);

  if (!input.keepDatabase) {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }

  return {
    threadId,
    persistedEvents,
    projection,
    fullProjection,
    feedTimelineIds,
  };
}
