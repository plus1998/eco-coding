import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ResolvedModelRoute } from "@eco/model-router";
import {
  assertCodexRoleProvidersAvailable,
  buildCodexMainAgentProfileAppend,
  buildCodexSubagentFollowupPrompt,
  type CodexAppServerClient,
  CodexAppServerDriver,
  CodexCompactNotAvailable,
  type CodexContextSnapshotResolution,
  CodexEventAdapter,
  type CodexMcpServerForConfigSync,
  CodexResumeNotAvailable,
  CodexRollbackNotAvailable,
  type CodexSessionMode,
  type CodexThreadAttribution,
  type CodexThreadConfigOverrides,
  type CodexThreadResumeResult,
  type CodexThreadStatusKind,
  CodexTurnRouteRegistry,
  clearCodexSpawnPayloadQueueSync,
  compactCodexThreadAndWait,
  dequeueCodexSpawnPayloadMatchingSync,
  ensureCodexSkillsExtraRoots,
  type EcoAgentRuntimeConfig,
  type EcoProviderForCodexConfig,
  type CodexToolPolicy,
  type CodexExecutionConfirmationMode,
  DEFAULT_CODEX_TOOL_POLICY,
  applyCodexExecutionConfirmation,
  normalizeCodexToolPolicy,
  parseCodexGatewayModelAlias,
  isCodexThreadConfigApplied,
  withCodexSkillConfig,
  readCodexThreadStatus,
  requireCodexSubagentThreadId,
  resolveCodexHomeDir,
  resumeCodexThread,
  rollbackCodexThread,
  syncCodexConfigFromEcoProviders,
  syncProfileAgentsToCodexRoles,
} from "@eco/runtime";
import type { CodexModelCatalogEntryView } from "../shared/models";
import type { ThreadRunEventInput } from "../shared/thread-run-events";
import type { RuntimeRoute } from "./billing-resolver";
import {
  type CodexApprovalBridge,
  type CodexApprovalBridgeDeps,
  createCodexApprovalBridge,
} from "./codex-approval-bridge";
import { CodexModelCatalogService } from "./codex-model-catalog";
import {
  readElectronResourcesPath,
  resolvePackagedCodexExecutableCandidate,
} from "./packaged-runtime-executables";
import {
  CodexRuntimeLifecycle,
  ensureGlobalCodexRuntimeLifecycle,
  getGlobalCodexRuntimeLifecycle,
  stopGlobalCodexRuntimeLifecycle,
} from "./codex-runtime-lifecycle";
import type { CodexThreadMap } from "./codex-thread-map";
import { resolveCodexThreadAttribution } from "./codex-thread-map";
import { normalizeCodexThreadRunEventForProjection } from "./codex-thread-run-event-normalizer";
import { ensureGlobalEcoGateway } from "./eco-gateway-lifecycle";
import type { RequestAttemptResult } from "./request-retry";
import { buildDriverRoutesFromRuntime, type RuntimeConfigResolution } from "./thread-runtime-routes";

export type ThreadRuntimeProxyResult = RequestAttemptResult & Record<string, unknown>;

export interface CodexRuntimeAttempt {
  routes: ResolvedModelRoute[];
  /** ThreadRuntimeConfig planner modelId (upstream), for logging / diagnostics. */
  plannerRoute?: { modelId: string };
}

export interface RunThreadRequestWithRuntimeProxyInput {
  threadId: string;
  attachments?: unknown;
  resolveRuntimeConfig: () => RuntimeConfigResolution;
  resolveAgentRegistry?: () => EcoAgentRuntimeConfig | undefined;
  /** Composer execution-confirmation setting mapped onto Codex approvalPolicy. */
  resolveExecutionConfirmationMode?: () => CodexExecutionConfirmationMode;
  /** Codex subagents remain disabled until their product lifecycle is complete. */
  enableSubagents?: boolean;
  /** Thread-level subagent toggles (explore/coder/…). */
  resolveSubagentAvailability?: () => Partial<Record<string, boolean>> | undefined;
  /**
   * Global MCP pool with thread-level tool visibility applied.
   * Processes stay warm; unselected servers use a disabled tools sentinel.
   */
  resolveMcpServers?: () => readonly CodexMcpServerForConfigSync[];
  /** Composer-selected MCP names, intersected with each actor's Profile assignment. */
  resolveEnabledMcpServerKeys?: () => readonly string[];
  /** Exact per-thread Skill path visibility. */
  resolveSkillConfig?: () => readonly { path: string; enabled: boolean }[];
  /** Wait for thread-selected MCP servers to leave `starting` before the turn. */
  ensureMcpReady?: () => Promise<void>;
  /** Runs after the exact thread config is bound, before the driver starts the turn. */
  onPrepared?: (prepared: PreparedCodexRuntime) => void | Promise<void>;
  recordRouteFingerprint: (threadId: string, routes: readonly RuntimeRoute[]) => void;
  startRuntimeProxy?: unknown;
  onProxyReady?: (attempt: CodexRuntimeAttempt) => void | Promise<void>;
  run: (attempt: CodexRuntimeAttempt) => Promise<ThreadRuntimeProxyResult>;
}

export interface CodexRuntimeRunDeps {
  ecoDataDir: string;
  listProviders: () => readonly EcoProviderForCodexConfig[];
  threadMap: CodexThreadMap;
  resolveRunAttemptId?: (ecoThreadId: string) => string | undefined;
  appendThreadRunEvent: (event: ThreadRunEventInput) => void;
  isContextCompactionInFlight?: (ecoThreadId: string) => boolean;
  /**
   * Emit feed projection. Pass `{ streaming: true }` for delta events so the
   * scheduler throttles (~50ms) instead of debouncing (which suppresses all
   * intermediate updates while deltas keep arriving).
   */
  scheduleThreadRunProjectionUpdated: (
    threadId: string,
    options?: { streaming?: boolean },
  ) => void;
  /**
   * Bind a Codex user item id onto the latest local user-prompt run event.
   * Returns true when the local event was updated (caller should skip appending a duplicate).
   */
  bindLatestUserPromptToCodexItem?: (threadId: string, itemId: string) => boolean;
  /** Local prune after a successful app-server `thread/rollback`. */
  pruneThreadAfterCodexRollback?: (ecoThreadId: string, itemId: string) => void;
  /** Restore the exact local worktree checkpoint before local history is pruned. */
  restoreFilesAfterCodexRollback?: (ecoThreadId: string, itemId: string) => Promise<void>;
  /** Map Eco's persisted user-message UUID to its zero-based Codex turn ordinal. */
  resolveCodexRollbackTurnIndex?: (ecoThreadId: string, itemId: string) => number | undefined;
  /** @deprecated Prefer built-in `threadMap` attribution via `resolveCodexThreadAttribution`. */
  resolveCodexThreadAttribution?: (codexThreadId: string) => CodexThreadAttribution | undefined;
  /** Runs only after a child attribution record has been persisted successfully. */
  onCodexThreadAttributionRecorded?: (codexThreadId: string) => void;
  /** Runs only after the root Eco -> Codex thread mapping has been persisted successfully. */
  onCodexThreadMapped?: (codexThreadId: string) => void;
  onCodexContextUpdated?: (resolution: CodexContextSnapshotResolution) => void;
  onCodexPlanReady?: NonNullable<ConstructorParameters<typeof CodexEventAdapter>[0]["onPlanReady"]>;
  onStderr?: (message: string) => void;
}

export interface PrepareCodexRuntimeInput {
  agentRegistry?: EcoAgentRuntimeConfig | undefined;
  executionConfirmationMode?: CodexExecutionConfirmationMode;
  enableSubagents?: boolean;
  /** Thread-level subagent toggles (explore/coder/…). */
  subagentAvailability?: Partial<Record<string, boolean>>;
  /** Provider ids required by the current thread routes; incomplete providers fail with a Settings hint. */
  requiredProviderIds?: readonly string[];
  /**
   * Global MCP pool for `config.toml` `[mcp_servers.*]` (settings-enabled servers).
   * Thread selection is applied via per-server `enabledTools` (warm process, hidden tools).
   * Empty = no globally enabled MCP.
   */
  mcpServers?: readonly CodexMcpServerForConfigSync[];
  /** Composer-selected MCP names for this thread. Omitted means all supplied servers. */
  threadEnabledMcpServerNames?: readonly string[];
  skillConfig?: readonly { path: string; enabled: boolean }[];
}

export interface PreparedCodexRuntime {
  profileAppend?: string;
  profileToolPolicy?: CodexToolPolicy;
  roleIds: readonly string[];
  roleToolPolicies: Readonly<Record<string, CodexToolPolicy>>;
  threadConfig: CodexThreadConfigOverrides;
  roleThreadConfigs: Readonly<Record<string, CodexThreadConfigOverrides>>;
}

/** Prepared configs are scoped by Eco thread; concurrent Profiles never share mutable state. */
const preparedRuntimeByThread = new Map<string, PreparedCodexRuntime>();
const controlPlaneAppliedConfigByClient = new WeakMap<object, Map<string, object>>();
/** Used only for Feed role labels when no thread attribution is available yet. */
let lastPreparedRoleIds: readonly string[] = [];
/** Serializes writes/reloads of the process-global CODEX_HOME config. */
let prepareRuntimeTail: Promise<void> = Promise.resolve();
/** Once installed, keep global hook support stable; each thread still enables/disables it explicitly. */
let globalMultiAgentSupportRequired = false;

export function bindPreparedCodexRuntimeToThread(
  ecoThreadId: string,
  prepared: PreparedCodexRuntime,
): void {
  const threadId = ecoThreadId.trim();
  if (!threadId) {
    throw new Error("Eco thread id is required when binding prepared Codex runtime config.");
  }
  preparedRuntimeByThread.set(threadId, prepared);
}

export function clearPreparedCodexRuntimeForThread(ecoThreadId: string): boolean {
  const threadId = ecoThreadId.trim();
  return threadId ? preparedRuntimeByThread.delete(threadId) : false;
}
/** Skip MCP reload when the prepared server set is unchanged (keeps warm connections). */
let lastPreparedMcpFingerprint = "";

const LOCAL_CODEX_CANDIDATES: readonly string[] = [];

let deps: CodexRuntimeRunDeps | undefined;
let eventAdapter: CodexEventAdapter | undefined;
let approvalBridge: CodexApprovalBridge | undefined;
let modelCatalogService: CodexModelCatalogService | undefined;
const turnRouteRegistry = new CodexTurnRouteRegistry();

export function configureCodexApprovalBridge(bridgeDeps: CodexApprovalBridgeDeps): void {
  approvalBridge = createCodexApprovalBridge(bridgeDeps);
}

export function getCodexApprovalBridge(): CodexApprovalBridge | undefined {
  return approvalBridge;
}

export function configureCodexRuntimeRun(config: CodexRuntimeRunDeps): void {
  deps = config;
  modelCatalogService = undefined;
  turnRouteRegistry.clearAll();
  preparedRuntimeByThread.clear();
  lastPreparedRoleIds = [];
  lastPreparedMcpFingerprint = "";
  globalMultiAgentSupportRequired = false;
  const resolveAttribution =
    config.resolveCodexThreadAttribution ??
    ((codexThreadId: string) => resolveCodexThreadAttribution(config.threadMap, codexThreadId));

  const codexHomeDir = resolveCodexHomeDir(config.ecoDataDir);
  // Clear crash leftovers once at process setup. Per-turn cleanup can erase a
  // concurrent thread's hook payload before its child attribution is recorded.
  clearCodexSpawnPayloadQueueSync(codexHomeDir);
  const resolveEcoThreadId = (codexThreadId: string): string => {
    const mapped = config.threadMap.getEcoThreadId(codexThreadId);
    if (mapped) {
      return mapped;
    }
    return resolveAttribution(codexThreadId)?.ecoThreadId ?? codexThreadId;
  };
  eventAdapter = new CodexEventAdapter({
    resolveEcoThreadId,
    turnRouteRegistry,
    ...(config.isContextCompactionInFlight && {
      shouldRecordContextCompaction: (codexThreadId: string) =>
        !config.isContextCompactionInFlight?.(resolveEcoThreadId(codexThreadId)),
    }),
    recordThreadRunEvent: (event) => {
      const projectionEvent = normalizeCodexThreadRunEventForProjection(event as ThreadRunEventInput);
      const itemId =
        typeof projectionEvent.metadata?.itemId === "string"
          ? projectionEvent.metadata.itemId.trim()
          : projectionEvent.streamKey?.trim();
      if (
        projectionEvent.role === "user" &&
        projectionEvent.metadata?.itemType === "userMessage" &&
        itemId &&
        config.bindLatestUserPromptToCodexItem?.(projectionEvent.threadId, itemId)
      ) {
        // Projection-only: local user prompt already carries the Codex item id / rewindTarget.
        config.scheduleThreadRunProjectionUpdated(projectionEvent.threadId, { streaming: false });
        return;
      }
      config.appendThreadRunEvent(
        bindCodexThreadRunEventAttempt(
          projectionEvent,
          config.resolveRunAttemptId?.(projectionEvent.threadId),
        ),
      );
      config.scheduleThreadRunProjectionUpdated(projectionEvent.threadId, {
        streaming: isCodexStreamingProjectionEvent(projectionEvent),
      });
    },
    resolveThreadAttribution: resolveAttribution,
    recordThreadAttribution: (codexThreadId, record) => {
      config.threadMap.setThreadAttribution(codexThreadId, record);
      config.onCodexThreadAttributionRecorded?.(codexThreadId);
      // Flush all pending: nested grandchildren may resolve only after an ancestor link lands.
      eventAdapter?.flushAllPendingEvents();
    },
    getThreadAttributionRecord: (codexThreadId) => config.threadMap.getThreadAttribution(codexThreadId),
    dequeueSpawnPayloadMatching: (input) => dequeueCodexSpawnPayloadMatchingSync(codexHomeDir, input),
    resolveProfileRoleIds: () => [
      ...new Set([
        ...lastPreparedRoleIds,
        ...[...preparedRuntimeByThread.values()].flatMap((prepared) => prepared.roleIds),
      ]),
    ],
    ...(config.onCodexContextUpdated && {
      onTokenUsageUpdated: config.onCodexContextUpdated,
    }),
    ...(config.onCodexPlanReady && { onPlanReady: config.onCodexPlanReady }),
  });
}

export function bindCodexThreadRunEventAttempt(
  event: ThreadRunEventInput,
  ecoRunAttemptId: string | undefined,
): ThreadRunEventInput {
  const { runAttemptId: codexTurnAsAttemptId, ...eventWithoutAttempt } = event;
  const turnId =
    typeof event.metadata?.turnId === "string"
      ? event.metadata.turnId.trim()
      : codexTurnAsAttemptId?.trim();
  const runAttemptId = ecoRunAttemptId?.trim();
  return {
    ...eventWithoutAttempt,
    ...(runAttemptId && { runAttemptId }),
    metadata: {
      ...(event.metadata ?? {}),
      ...(turnId && { turnId }),
    },
  };
}

export function requireCodexRouteForRole(
  routes: readonly ResolvedModelRoute[],
  roleId: string,
): ResolvedModelRoute {
  const normalizedRoleId = roleId.trim();
  const route = normalizedRoleId
    ? routes.find((candidate) => candidate.role === normalizedRoleId)
    : undefined;
  if (!route) {
    throw new Error(`Codex subagent resume is missing the exact route for role '${normalizedRoleId || "unknown"}'.`);
  }
  return route;
}

export function getCodexThreadId(ecoThreadId: string): string | undefined {
  return deps?.threadMap.getCodexThreadId(ecoThreadId);
}

/**
 * Resume a main Eco thread's Codex session via `thread/resume`.
 * Map missing → explicit error (never silently `thread/start`).
 */
export async function resumeCodexThreadForEcoThread(input: {
  ecoThreadId: string;
  cwd?: string;
  model?: string;
  modelProvider?: string;
}): Promise<CodexThreadResumeResult> {
  const runtimeDeps = requireDeps();
  const ecoThreadId = input.ecoThreadId.trim();
  if (!ecoThreadId) {
    throw new CodexResumeNotAvailable(
      "Codex resume is not available because the Eco thread id is missing.",
      {
        nextAction: "Retry resume from a Codex-backed thread that has a persisted Eco thread id.",
      },
    );
  }
  const codexThreadId = runtimeDeps.threadMap.getCodexThreadId(ecoThreadId);
  if (!codexThreadId) {
    throw new CodexResumeNotAvailable(
      "Codex resume is not available because this Eco thread has no Codex thread mapping.",
      {
        nextAction:
          "Run this thread through the Codex app-server once so Eco can persist its Codex thread id, then retry resume.",
      },
    );
  }
  const client = getGlobalCodexRuntimeLifecycle()?.getClient();
  if (!client) {
    throw new CodexResumeNotAvailable(
      "Codex resume is not available because the Codex app-server client is not running.",
      {
        nextAction:
          "Start a Codex-backed turn to bring the app-server online, then retry resume against the same thread.",
      },
    );
  }
  const prepared = preparedRuntimeByThread.get(ecoThreadId);
  if (!prepared) {
    throw new CodexResumeNotAvailable(
      "Codex resume cannot reapply this thread's runtime policy because no prepared config is bound.",
      {
        nextAction: "Prepare the Eco thread with its current Agent Profile and MCP selection, then retry resume.",
      },
    );
  }
  return resumeCodexThread(client, {
    threadId: codexThreadId,
    ...(input.cwd?.trim() && { cwd: input.cwd.trim() }),
    ...(input.model?.trim() && { model: input.model.trim() }),
    ...(input.modelProvider?.trim() && { modelProvider: input.modelProvider.trim() }),
    config: prepared.threadConfig,
  });
}

/**
 * Resume an interrupted subagent (Codex child thread) via `thread/resume`.
 * Requires `codex_thread_attribution` for agentId (= child codexThreadId).
 * Map missing → explicit error (never silently create a new child thread).
 */
export async function resumeCodexSubagentThread(input: {
  agentId: string;
  followupTask: string;
  cwd?: string;
  model?: string;
  modelProvider?: string;
}): Promise<{
  codexThreadId: string;
  followupPrompt: string;
  resume: CodexThreadResumeResult;
}> {
  const runtimeDeps = requireDeps();
  const codexThreadId = requireCodexSubagentThreadId(
    (id) => runtimeDeps.threadMap.getThreadAttribution(id),
    input.agentId,
  );
  const attribution = runtimeDeps.threadMap.getThreadAttribution(codexThreadId);
  const parentEcoThreadId = attribution?.parentThreadId
    ? runtimeDeps.threadMap.getEcoThreadId(attribution.parentThreadId)
    : undefined;
  const roleId = attribution?.agentRole?.trim();
  const roleThreadConfig =
    parentEcoThreadId && roleId
      ? preparedRuntimeByThread.get(parentEcoThreadId)?.roleThreadConfigs[roleId]
      : undefined;
  if (!roleThreadConfig) {
    throw new CodexResumeNotAvailable(
      `Codex subagent resume cannot reapply the MCP policy for role '${roleId || "unknown"}'.`,
      {
        nextAction:
          "Prepare the parent Eco thread with the same Agent Profile before resuming this subagent.",
      },
    );
  }
  const client = getGlobalCodexRuntimeLifecycle()?.getClient();
  if (!client) {
    throw new CodexResumeNotAvailable(
      "Codex subagent resume is not available because the Codex app-server client is not running.",
      {
        nextAction:
          "Start a Codex-backed turn to bring the app-server online, then retry subagent resume.",
      },
    );
  }
  const resume = await resumeCodexThread(client, {
    threadId: codexThreadId,
    ...(input.cwd?.trim() && { cwd: input.cwd.trim() }),
    ...(input.model?.trim() && { model: input.model.trim() }),
    ...(input.modelProvider?.trim() && { modelProvider: input.modelProvider.trim() }),
    config: roleThreadConfig,
  });
  return {
    codexThreadId,
    followupPrompt: buildCodexSubagentFollowupPrompt(codexThreadId, input.followupTask),
    resume,
  };
}

/** Query app-server status for a mapped Eco thread (orphan recovery). */
export async function queryCodexThreadStatusForEcoThread(
  ecoThreadId: string,
): Promise<CodexThreadStatusKind | undefined> {
  const runtimeDeps = requireDeps();
  const codexThreadId = runtimeDeps.threadMap.getCodexThreadId(ecoThreadId.trim());
  if (!codexThreadId) {
    return undefined;
  }
  const client = getGlobalCodexRuntimeLifecycle()?.getClient();
  if (!client) {
    return undefined;
  }
  return readCodexThreadStatus(client, codexThreadId);
}

export async function rollbackCodexThreadForEcoThread(input: {
  ecoThreadId: string;
  targetItemId: string;
}): Promise<void> {
  const runtimeDeps = requireDeps();
  const ecoThreadId = input.ecoThreadId.trim();
  const targetItemId = input.targetItemId.trim();
  if (!ecoThreadId) {
    throw new CodexRollbackNotAvailable(
      "Codex rollback is not available because the Eco thread id is missing.",
      {
        nextAction: "Retry rewind from a Codex-backed thread that has a persisted Eco thread id.",
      },
    );
  }
  if (!targetItemId) {
    throw new CodexRollbackNotAvailable(
      "Codex rollback is not available because the target Codex item id is missing.",
      {
        nextAction:
          "Select a user message that has a persisted Codex item id, then retry rewind.",
      },
    );
  }
  const codexThreadId = runtimeDeps.threadMap.getCodexThreadId(ecoThreadId);
  if (!codexThreadId) {
    throw new CodexRollbackNotAvailable(
      "Codex rollback is not available because this Eco thread has no Codex thread mapping.",
      {
        nextAction:
          "Run this thread through the Codex app-server once so Eco can persist its Codex thread id, then retry rollback.",
      },
    );
  }

  const client = await ensureCodexControlPlaneClient();
  const status = await readCodexThreadStatus(client, codexThreadId);
  if (status === "notLoaded") {
    const prepared = preparedRuntimeByThread.get(ecoThreadId);
    if (!prepared) {
      throw new CodexRollbackNotAvailable(
        "Codex rollback cannot load the thread before its session configuration is prepared.",
        { nextAction: "Prepare the current Agent Profile and MCP selection, then retry rewind." },
      );
    }
    await resumeCodexThread(client, {
      threadId: codexThreadId,
      config: prepared.threadConfig,
    });
    const appliedByThread = controlPlaneAppliedConfigByClient.get(client) ?? new Map<string, object>();
    appliedByThread.set(codexThreadId, prepared.threadConfig);
    controlPlaneAppliedConfigByClient.set(client, appliedByThread);
  } else if (status !== "idle") {
    throw new CodexRollbackNotAvailable(
      `Codex rollback requires an idle thread; current status is ${status}.`,
      {
        nextAction: "Wait for the active turn to finish, then retry rewind.",
      },
    );
  }

  const targetTurnIndex = runtimeDeps.resolveCodexRollbackTurnIndex?.(ecoThreadId, targetItemId);
  await rollbackCodexThread(client, {
    threadId: codexThreadId,
    itemId: targetItemId,
    ...(targetTurnIndex !== undefined ? { targetTurnIndex } : {}),
  });

  if (!runtimeDeps.restoreFilesAfterCodexRollback) {
    throw new CodexRollbackNotAvailable(
      "Codex rollback succeeded but local file checkpoint restore is not configured.",
      { nextAction: "Configure the Codex file checkpoint store before using rewind." },
    );
  }
  await runtimeDeps.restoreFilesAfterCodexRollback(ecoThreadId, targetItemId);

  // Remote rollback succeeded — keep local run-event / activity / projection consistent.
  if (!runtimeDeps.pruneThreadAfterCodexRollback) {
    throw new CodexRollbackNotAvailable(
      "Codex rollback succeeded on app-server but local prune is not configured.",
      {
        nextAction:
          "Wire pruneThreadAfterCodexRollback during configureCodexRuntimeRun so local feed state matches the remote thread.",
      },
    );
  }
  runtimeDeps.pruneThreadAfterCodexRollback(ecoThreadId, targetItemId);
}

/**
 * Compact a main Eco thread's Codex session via `thread/compact/start`.
 * Map missing → explicit error (never silently eco-compact / SDK compact).
 */
export async function compactCodexThreadForEcoThread(input: {
  ecoThreadId: string;
  signal?: AbortSignal;
}): Promise<{ codexThreadId: string; turnId: string; itemId: string; postTokens: number }> {
  const runtimeDeps = requireDeps();
  const ecoThreadId = input.ecoThreadId.trim();
  if (!ecoThreadId) {
    throw new CodexCompactNotAvailable(
      "Codex compact is not available because the Eco thread id is missing.",
      {
        nextAction: "Retry compact from a Codex-backed thread that has a persisted Eco thread id.",
      },
    );
  }
  const codexThreadId = runtimeDeps.threadMap.getCodexThreadId(ecoThreadId);
  if (!codexThreadId) {
    throw new CodexCompactNotAvailable(
      "Codex compact is not available because this Eco thread has no Codex thread mapping.",
      {
        nextAction:
          "Run this thread through the Codex app-server once so Eco can persist its Codex thread id, then retry compact.",
      },
    );
  }

  await ensureGlobalEcoGateway();
  const client = await ensureCodexControlPlaneClient();
  const status = await readCodexThreadStatus(client, codexThreadId);
  if (status === "notLoaded") {
    await resumeCodexThread(client, { threadId: codexThreadId });
  } else if (status !== "idle") {
    throw new CodexCompactNotAvailable(
      `Codex compact requires an idle thread; current status is ${status}.`,
      {
        nextAction: "Wait for the active turn to finish or continue the thread once to recover its state, then retry compact.",
      },
    );
  }

  const result = await compactCodexThreadAndWait(
    client,
    { threadId: codexThreadId },
    input.signal ? { signal: input.signal } : {},
  );
  return {
    codexThreadId,
    turnId: result.turnId,
    itemId: result.itemId,
    postTokens: result.postTokens,
  };
}

export function resolveCodexExecutable(): string | undefined {
  const fromEnv = process.env.CODEX_EXECUTABLE?.trim();
  if (fromEnv && isRunnableCodexExecutable(fromEnv)) {
    return fromEnv;
  }

  const resourcesPath = readElectronResourcesPath();
  const packaged = resolvePackagedCodexExecutableCandidate({
    resourcesPath,
  });
  if (packaged && isRunnableCodexExecutable(packaged)) {
    return packaged;
  }
  if (resourcesPath && fs.existsSync(path.join(resourcesPath, "app.asar"))) {
    return undefined;
  }

  for (const candidate of getProjectCodexCandidates()) {
    if (isRunnableCodexExecutable(candidate)) {
      return candidate;
    }
  }

  for (const candidate of LOCAL_CODEX_CANDIDATES) {
    if (isRunnableCodexExecutable(candidate)) {
      return candidate;
    }
  }

  const fromPath = resolveCodexExecutableFromPath();
  if (fromPath && isRunnableCodexExecutable(fromPath)) {
    return fromPath;
  }

  return undefined;
}

export function isCodexCliAvailable(): boolean {
  return resolveCodexExecutable() !== undefined;
}

export async function listCodexModels(): Promise<CodexModelCatalogEntryView[]> {
  return getCodexModelCatalogService().list();
}

/**
 * Starts the shared app-server with the same approval and event handlers used by turns.
 * Control-plane callers must use this entry point instead of creating an under-configured global lifecycle.
 */
export async function ensureCodexControlPlaneClient(): Promise<CodexAppServerClient> {
  const runtimeDeps = requireDeps();
  const codexExecutable = resolveCodexExecutable();
  if (!codexExecutable) {
    throw new Error(
      "Codex CLI not found or not runnable. Install workspace dependencies or set CODEX_EXECUTABLE before using Codex control-plane APIs.",
    );
  }
  const client = await startSharedCodexRuntimeLifecycle(runtimeDeps, codexExecutable);
  if (!client.isInitialized) {
    throw new Error("Codex app-server client is not initialized after lifecycle start.");
  }
  return client;
}

export function clearCodexModelCatalogCache(): void {
  modelCatalogService?.clear();
}

export function prepareCodexRuntime(
  input: PrepareCodexRuntimeInput = {},
): Promise<PreparedCodexRuntime> {
  const run = prepareRuntimeTail.then(() => prepareCodexRuntimeUnlocked(input));
  prepareRuntimeTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function prepareCodexRuntimeUnlocked(
  input: PrepareCodexRuntimeInput,
): Promise<PreparedCodexRuntime> {
  const runtimeDeps = requireDeps();
  const codexExecutable = resolveCodexExecutable();
  if (!codexExecutable) {
    throw new Error(
      "Codex CLI not found or not runnable. Run workspace dependency install so `node_modules/.bin/codex` exists, set CODEX_EXECUTABLE to a working Codex CLI, or build from openai/codex (see docs/codex-integration-tasks.md §5.2).",
    );
  }

  const codexHomeDir = resolveCodexHomeDir(runtimeDeps.ecoDataDir);
  const providers = [...runtimeDeps.listProviders()];
  const mcpServers = input.mcpServers ?? [];
  const registryAppend = input.agentRegistry
    ? buildCodexMainAgentProfileAppend(input.agentRegistry.profile, input.agentRegistry.templates, {
        ...(input.subagentAvailability
          ? { subagentAvailability: input.subagentAvailability }
          : {}),
      })
    : undefined;
  const profileAppend = registryAppend?.trim() || undefined;
  const registryToolPolicy = input.agentRegistry
    ? normalizeCodexToolPolicy(input.agentRegistry.profile.mainAgent.tools, { allowSpawnDefault: true })
    : undefined;
  const profileToolPolicy = input.executionConfirmationMode
    ? applyCodexExecutionConfirmation(
        registryToolPolicy ?? DEFAULT_CODEX_TOOL_POLICY,
        input.executionConfirmationMode,
        input.agentRegistry?.profile.mainAgent.tools.coreOverrides?.codex?.approvalPolicy ===
          "untrusted"
          ? { minimumApprovalPolicy: "untrusted" }
          : {},
      )
    : registryToolPolicy;
  const roleSync = input.agentRegistry && input.enableSubagents !== false
    ? await syncProfileAgentsToCodexRoles({
        codexHomeDir,
        profile: input.agentRegistry.profile,
        templates: input.agentRegistry.templates,
        mcpServers,
        ...(input.threadEnabledMcpServerNames
          ? { threadEnabledMcpServers: input.threadEnabledMcpServerNames }
          : {}),
        ...(input.subagentAvailability
          ? { subagentAvailability: input.subagentAvailability }
          : {}),
      })
    : undefined;

  if (roleSync && roleSync.roles.length > 0) {
    assertCodexRoleProvidersAvailable(roleSync.roles, providers);
    globalMultiAgentSupportRequired = true;
  }
  lastPreparedRoleIds = roleSync?.roleIds ?? [];
  const baseThreadConfig = roleSync?.threadConfig ?? buildDenyAllMcpThreadConfig(mcpServers);
  const prepared: PreparedCodexRuntime = {
    ...(profileAppend ? { profileAppend } : {}),
    ...(profileToolPolicy ? { profileToolPolicy } : {}),
    roleIds: roleSync?.roleIds ?? [],
    roleToolPolicies: Object.fromEntries(
      (roleSync?.roles ?? []).map((role) => [role.roleId, role.toolPolicy]),
    ),
    threadConfig: withCodexSkillConfig(baseThreadConfig, input.skillConfig ?? []),
    roleThreadConfigs: Object.fromEntries(
      Object.entries(roleSync?.roleThreadConfigs ?? {}).map(([role, config]) => [
        role,
        withCodexSkillConfig(config, input.skillConfig ?? []),
      ]),
    ),
  };

  runtimeDeps.onStderr?.(
    `[eco-codex] multi-agent roles=${roleSync?.roleIds.join(",") || "(none)"} profileAppendChars=${profileAppend?.length ?? 0}`,
  );

  // Push ProviderStore models into in-process eco-gateway before Codex calls /v1/responses.
  const roleProviderIds = roleSync?.roles.map((role) => role.providerId) ?? [];
  const requiredProviderIds = [
    ...new Set([...(input.requiredProviderIds ?? []), ...roleProviderIds].map((id) => id.trim()).filter(Boolean)),
  ];
  const gatewayProviders = await ensureGlobalEcoGateway({
    ...(requiredProviderIds.length > 0 ? { requiredProviderIds } : {}),
  });
  runtimeDeps.onStderr?.(
    `[eco-gateway] ready providers=${gatewayProviders.map((p) => `${p.id}[${p.models.join("|")}]`).join(", ")}`,
  );

  const configSync = await syncCodexConfigFromEcoProviders({
    ecoDataDir: runtimeDeps.ecoDataDir,
    providers,
    mcpServers,
    ...(globalMultiAgentSupportRequired ? { enableMultiAgent: true } : {}),
    ...(roleSync ? { agentRoles: roleSync.agentRoles } : {}),
  });

  const configToml = fs.readFileSync(configSync.configPath, "utf8");
  if (roleSync && roleSync.agentRoles.length > 0) {
    const hasStableMultiAgent =
      configToml.includes("[features]") &&
      configToml.includes("multi_agent = true") &&
      configToml.includes("hooks = true") &&
      configToml.includes("[agents]") &&
      configToml.includes("max_threads = 16") &&
      configToml.includes("max_depth = 1");
    if (!hasStableMultiAgent) {
      throw new Error(
        `Codex config sync failed: stable multi-agent [features]/[agents] settings were not written to ${configSync.configPath} despite agent roles.`,
      );
    }
    for (const role of roleSync.roles) {
      if (configToml.includes(`[agents.${role.roleId}]`)) {
        throw new Error(
          `Codex config sync failed: mutable global [agents.${role.roleId}] leaked into ${configSync.configPath}.`,
        );
      }
      if (!fs.existsSync(role.rolePath)) {
        throw new Error(`Codex role sync failed: missing immutable role file ${role.rolePath}.`);
      }
      const threadRole = prepared.threadConfig.agents?.[role.roleId];
      if (
        !threadRole ||
        typeof threadRole !== "object" ||
        (threadRole as { config_file?: unknown }).config_file !== role.rolePath
      ) {
        throw new Error(
          `Codex thread config failed: role '${role.roleId}' is not bound to ${role.rolePath}.`,
        );
      }
    }
  }

  for (const server of mcpServers) {
    if (!configToml.includes(`[mcp_servers.${server.name}]`)) {
      throw new Error(
        `Codex MCP sync failed: missing [mcp_servers.${server.name}] in ${configSync.configPath}.`,
      );
    }
  }
  if (mcpServers.length === 0 && configToml.includes("[mcp_servers.")) {
    throw new Error(
      `Codex MCP sync failed: config.toml still contains [mcp_servers.*] after clearing MCP selection (${configSync.configPath}).`,
    );
  }

  runtimeDeps.onStderr?.(
    `[eco-codex] config ${configSync.configPath} gateway=${configSync.gatewayBaseUrl} providers=${configSync.providerSlugs.join(",")} mcp=${configSync.mcpServerNames.join(",") || "(none)"}`,
  );

  const client = await startSharedCodexRuntimeLifecycle(runtimeDeps, codexExecutable);

  if (!client.isInitialized) {
    throw new Error("Codex app-server client is not initialized after lifecycle start.");
  }
  clearCodexModelCatalogCache();
  const mcpFingerprint = fingerprintPreparedMcpServers(mcpServers);
  const shouldReloadMcp = mcpFingerprint !== lastPreparedMcpFingerprint;
  if (!shouldReloadMcp) {
    runtimeDeps.onStderr?.(
      `[eco-codex] mcp unchanged servers=${configSync.mcpServerNames.join(",") || "(none)"} (skip reload)\n`,
    );
    return prepared;
  }
  try {
    await client.request("config/mcpServer/reload", {});
    lastPreparedMcpFingerprint = mcpFingerprint;
  } catch (error) {
    lastPreparedMcpFingerprint = "";
    throw error;
  }
  runtimeDeps.onStderr?.(
    `[eco-codex] mcp reload servers=${configSync.mcpServerNames.join(",") || "(none)"}`,
  );
  return prepared;
}

function resolveCodexUserSkillExtraRoots(): string[] {
  const root = path.join(os.homedir(), ".codex", "skills");
  return fs.existsSync(root) ? [root] : [];
}

function buildDenyAllMcpThreadConfig(
  servers: readonly CodexMcpServerForConfigSync[],
): CodexThreadConfigOverrides {
  return {
    features: {
      multi_agent: false,
      hooks: false,
    },
    mcp_servers: Object.fromEntries(
      servers.map((server) => [server.name.trim(), { enabled: false }]).filter(([name]) => Boolean(name)),
    ),
  };
}

async function startSharedCodexRuntimeLifecycle(
  runtimeDeps: CodexRuntimeRunDeps,
  codexExecutable: string,
): Promise<CodexAppServerClient> {
  const client = await ensureGlobalCodexRuntimeLifecycle({
    ecoDataDir: runtimeDeps.ecoDataDir,
    codexExecutable,
    clientOptions: {
      onServerRequest: (method, params) => approvalBridge?.handleServerRequest(method, params),
    },
    onNotification: (method, params) => {
      eventAdapter?.dispatch(method, params);
      approvalBridge?.handleNotification(method, params);
    },
    onStderr: (chunk) => {
      runtimeDeps.onStderr?.(`[codex app-server] ${chunk}`);
    },
  });
  await ensureCodexSkillsExtraRoots(client, resolveCodexUserSkillExtraRoots());
  return client;
}

function fingerprintPreparedMcpServers(servers: readonly CodexMcpServerForConfigSync[]): string {
  return JSON.stringify(
    servers.map((server) => ({
      name: server.name,
      transport: server.transport,
      command: server.command,
      args: server.args,
      env: server.env,
      url: server.url,
      httpHeaders: server.httpHeaders,
      enabledTools: server.enabledTools,
      startupTimeoutSec: server.startupTimeoutSec,
    })),
  );
}

/** Live MCP status from Codex app-server (requires lifecycle already started). */
export async function listCodexMcpServerStatus(): Promise<unknown> {
  const client = getGlobalCodexRuntimeLifecycle()?.getClient();
  if (!client?.isInitialized) {
    return { data: [] };
  }
  return client.request("mcpServerStatus/list", {});
}

export async function runThreadRequestWithRuntimeProxy(
  input: RunThreadRequestWithRuntimeProxyInput,
): Promise<ThreadRuntimeProxyResult> {
  const freshConfig = input.resolveRuntimeConfig();
  if (!freshConfig.ok) {
    return { ok: false, reason: freshConfig.reason };
  }

  input.recordRouteFingerprint(input.threadId, freshConfig.routes);

  const requiredProviderIds = [
    ...new Set(
      freshConfig.routes
        .map((route) => route.provider.id.trim())
        .filter((providerId) => providerId.length > 0),
    ),
  ];

  try {
    const previousPrepared = preparedRuntimeByThread.get(input.threadId);
    const mcpServers = input.resolveMcpServers?.() ?? [];
    const threadEnabledMcpServerNames = input.resolveEnabledMcpServerKeys?.() ?? [];
    const skillConfig = input.resolveSkillConfig?.() ?? [];
    const subagentAvailability = input.resolveSubagentAvailability?.();
    const prepared = await prepareCodexRuntime({
      agentRegistry: input.resolveAgentRegistry?.(),
      ...(input.resolveExecutionConfirmationMode
        ? { executionConfirmationMode: input.resolveExecutionConfirmationMode() }
        : {}),
      ...(input.enableSubagents === false ? { enableSubagents: false } : {}),
      ...(subagentAvailability ? { subagentAvailability } : {}),
      requiredProviderIds,
      mcpServers,
      threadEnabledMcpServerNames,
      skillConfig,
    });
    // Wait for readiness AFTER prepare: reload (when it runs) restarts MCP processes.
    await input.ensureMcpReady?.();
    const currentClient = getGlobalCodexRuntimeLifecycle()?.getClient();
    const codexThreadId = requireDeps().threadMap.getCodexThreadId(input.threadId);
    const configChanged =
      previousPrepared &&
      JSON.stringify(previousPrepared.threadConfig) !== JSON.stringify(prepared.threadConfig);
    const configNotApplied =
      currentClient &&
      codexThreadId &&
      !isCodexThreadConfigApplied(currentClient, codexThreadId, prepared.threadConfig);
    if (configChanged || configNotApplied) {
      await coldReloadIdleCodexThreadForConfigChange(input.threadId);
    }
    // Commit only after the whole admission succeeds. A failed readiness check
    // must not replace the last known-good policy for this Eco thread.
    bindPreparedCodexRuntimeToThread(input.threadId, prepared);
    await input.onPrepared?.(prepared);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }

  const routes = buildDriverRoutesFromRuntime(freshConfig.routes);
  const plannerRoute = freshConfig.routes.find((route) => route.role === "planner");
  const attempt: CodexRuntimeAttempt = {
    routes,
    ...(plannerRoute && { plannerRoute: { modelId: plannerRoute.modelId } }),
  };

  await input.onProxyReady?.(attempt);
  return input.run(attempt);
}

async function coldReloadIdleCodexThreadForConfigChange(ecoThreadId: string): Promise<void> {
  const runtimeDeps = requireDeps();
  const codexThreadId = runtimeDeps.threadMap.getCodexThreadId(ecoThreadId.trim());
  const lifecycle = getGlobalCodexRuntimeLifecycle();
  const client = lifecycle?.getClient();
  if (!codexThreadId || !client) {
    return;
  }

  const targetStatus = await readCodexThreadStatus(client, codexThreadId);
  if (targetStatus === "notLoaded") {
    return;
  }
  if (targetStatus !== "idle" && targetStatus !== "systemError") {
    throw new CodexResumeNotAvailable(
      `Codex cannot reload changed session config while thread '${codexThreadId}' is ${targetStatus}.`,
      { nextAction: "Wait for the active Codex turn to finish, then retry the message." },
    );
  }

  const loaded = await client.request<{ data?: unknown }>("thread/loaded/list", {});
  const loadedThreadIds = Array.isArray(loaded.data)
    ? loaded.data.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
  for (const loadedThreadId of loadedThreadIds) {
    if (loadedThreadId === codexThreadId) {
      continue;
    }
    const status = await readCodexThreadStatus(client, loadedThreadId);
    if (status === "active") {
      throw new CodexResumeNotAvailable(
        `Codex cannot reload changed session config while another thread '${loadedThreadId}' is active.`,
        { nextAction: "Wait for the other Codex turn to finish, then retry the message." },
      );
    }
  }

  runtimeDeps.onStderr?.(
    `[eco-codex] cold reload app-server for changed thread config ecoThread=${ecoThreadId} codexThread=${codexThreadId}`,
  );
  await stopGlobalCodexRuntimeLifecycle();
  const codexExecutable = resolveCodexExecutable();
  if (!codexExecutable) {
    throw new Error("Codex CLI is unavailable after stopping app-server for session config reload.");
  }
  await startSharedCodexRuntimeLifecycle(runtimeDeps, codexExecutable);
  clearCodexModelCatalogCache();
}

export function createCodexRuntimeDriver(
  threadId: string,
  sessionMode: CodexSessionMode,
  options?: {
    profileAppend?: string;
    profileToolPolicy?: CodexToolPolicy;
    existingCodexThreadId?: string;
    threadConfig?: Record<string, unknown>;
    threadConfigAlreadyApplied?: boolean;
  },
): CodexAppServerDriver {
  const runtimeDeps = requireDeps();
  const client = getGlobalCodexRuntimeLifecycle()?.getClient();
  if (!client) {
    throw new Error("Codex app-server client is not running. prepareCodexRuntime() must complete first.");
  }

  const prepared = preparedRuntimeByThread.get(threadId);
  const profileAppend = options?.profileAppend ?? prepared?.profileAppend;
  const profileToolPolicy = options?.profileToolPolicy ?? prepared?.profileToolPolicy;
  const existingCodexThreadId =
    options?.existingCodexThreadId?.trim() || runtimeDeps.threadMap.getCodexThreadId(threadId);
  const preparedThreadConfig = options?.threadConfig ?? prepared?.threadConfig;
  const controlPlaneConfigApplied = Boolean(
    existingCodexThreadId &&
      preparedThreadConfig &&
      controlPlaneAppliedConfigByClient.get(client)?.get(existingCodexThreadId) === preparedThreadConfig
  );
  if (controlPlaneConfigApplied && existingCodexThreadId) {
    controlPlaneAppliedConfigByClient.get(client)?.delete(existingCodexThreadId);
  }
  // Feed + approval notifications are owned by the global lifecycle handler in
  // prepareCodexRuntime. Drivers must not register another dispatch path — each
  // extra handler appends the same incremental delta again (N× stutter).
  return new CodexAppServerDriver({
    client,
    turnRouteRegistry,
    sessionMode,
    ...(existingCodexThreadId ? { existingCodexThreadId } : {}),
    ...(options?.threadConfigAlreadyApplied || controlPlaneConfigApplied
      ? { threadConfigAlreadyApplied: true }
      : {}),
    ...(profileAppend ? { profileAppend } : {}),
    ...(profileToolPolicy ? { profileToolPolicy } : {}),
    ...(preparedThreadConfig
      ? { threadConfig: preparedThreadConfig }
        : {}),
    onThreadMapped: (ecoThreadId, codexThreadId) => {
      // Subagent resume passes parent eco id + child Codex id — never remap parent → child.
      const isSubagentCodexThread = Boolean(
        runtimeDeps.threadMap.getThreadAttribution(codexThreadId)?.parentThreadId?.trim(),
      );
      if (!isSubagentCodexThread) {
        runtimeDeps.threadMap.setMapping(ecoThreadId, codexThreadId);
        runtimeDeps.onCodexThreadMapped?.(codexThreadId);
      }
      // Child events may have been buffered while only the parent Codex link was known.
      eventAdapter?.flushAllPendingEvents();
    },
  });
}

export function clearCodexTurnRoutesForEcoThread(ecoThreadId: string): number {
  const codexThreadId = deps?.threadMap.getCodexThreadId(ecoThreadId.trim());
  return codexThreadId ? turnRouteRegistry.clearThread(codexThreadId) : 0;
}

export function clearAllCodexTurnRoutes(): void {
  turnRouteRegistry.clearAll();
}

export function registerCodexGatewayTurnRoute(
  input: {
    codexThreadId: string;
    turnId: string;
    requestKind: "turn" | "prewarm" | "compaction";
    requestedModel: string;
    providerId: string;
    upstreamModelId: string;
  },
  registry: CodexTurnRouteRegistry = turnRouteRegistry,
): boolean {
  if (input.requestKind !== "turn") {
    return false;
  }
  const alias = parseCodexGatewayModelAlias(input.requestedModel);
  if (
    !alias ||
    alias.providerId !== input.providerId.trim() ||
    alias.upstreamModelId !== input.upstreamModelId.trim()
  ) {
    return false;
  }
  registry.register(input.codexThreadId, input.turnId, {
    aliasModelId: input.requestedModel.trim(),
    providerId: alias.providerId,
    upstreamModelId: alias.upstreamModelId,
    ...(alias.apiCompat && { apiCompat: alias.apiCompat }),
  });
  return true;
}

export type CodexGatewayTurnRouteRegistrationResult =
  | { status: "registered" }
  | { status: "skipped"; reason: "billing_rejected" | "non_turn_request" }
  | { status: "rejected"; reason: "invalid_exact_route" }
  | { status: "conflict"; error: unknown };

/** Register only usage events that already passed exact attribution and pricing-route resolution. */
export function registerResolvedCodexGatewayTurnRoute(
  input: {
    billingResult:
      | { status: "rejected" }
      | {
          status: "resolved";
          codexThreadId: string;
          turnId: string;
          requestKind: "turn" | "prewarm" | "compaction";
        };
    requestedModel: string;
    providerId: string;
    upstreamModelId: string;
  },
  registry: CodexTurnRouteRegistry = turnRouteRegistry,
): CodexGatewayTurnRouteRegistrationResult {
  if (input.billingResult.status !== "resolved") {
    return { status: "skipped", reason: "billing_rejected" };
  }
  if (input.billingResult.requestKind !== "turn") {
    return { status: "skipped", reason: "non_turn_request" };
  }
  try {
    const registered = registerCodexGatewayTurnRoute(
      {
        codexThreadId: input.billingResult.codexThreadId,
        turnId: input.billingResult.turnId,
        requestKind: input.billingResult.requestKind,
        requestedModel: input.requestedModel,
        providerId: input.providerId,
        upstreamModelId: input.upstreamModelId,
      },
      registry,
    );
    return registered
      ? { status: "registered" }
      : { status: "rejected", reason: "invalid_exact_route" };
  } catch (error) {
    return { status: "conflict", error };
  }
}

/**
 * Driver for an interrupted subagent: requires attribution map, then
 * `thread/resume` + `turn/start` with followup_task prompt (never thread/start).
 */
export function createCodexSubagentResumeDriver(input: {
  /** Parent Eco thread id (Feed / billing attribution). */
  parentEcoThreadId: string;
  /** Subagent agentId (= Codex child thread id). */
  agentId: string;
  sessionMode?: CodexSessionMode;
  profileAppend?: string;
}): { driver: CodexAppServerDriver; followupPromptFor: (task: string) => string; codexThreadId: string } {
  const runtimeDeps = requireDeps();
  const codexThreadId = requireCodexSubagentThreadId(
    (id) => runtimeDeps.threadMap.getThreadAttribution(id),
    input.agentId,
  );
  const attribution = runtimeDeps.threadMap.getThreadAttribution(codexThreadId);
  const roleId = attribution?.agentRole?.trim();
  const roleThreadConfig = roleId
    ? preparedRuntimeByThread.get(input.parentEcoThreadId)?.roleThreadConfigs[roleId]
    : undefined;
  const roleToolPolicy = roleId
    ? preparedRuntimeByThread.get(input.parentEcoThreadId)?.roleToolPolicies[roleId]
    : undefined;
  if (!roleId || !roleThreadConfig || !roleToolPolicy) {
    throw new CodexResumeNotAvailable(
      `Codex subagent resume cannot reapply the MCP policy for role '${roleId || "unknown"}'.`,
      {
        nextAction:
          "Prepare the parent Eco thread with the same Agent Profile before resuming this subagent.",
      },
    );
  }
  const driver = createCodexRuntimeDriver(input.parentEcoThreadId, input.sessionMode ?? "agent", {
    existingCodexThreadId: codexThreadId,
    threadConfig: roleThreadConfig,
    threadConfigAlreadyApplied: true,
    profileToolPolicy: roleToolPolicy,
    ...(input.profileAppend ? { profileAppend: input.profileAppend } : {}),
  });
  return {
    driver,
    codexThreadId,
    followupPromptFor: (task: string) => buildCodexSubagentFollowupPrompt(codexThreadId, task),
  };
}

function requireDeps(): CodexRuntimeRunDeps {
  if (!deps) {
    throw new Error("Codex runtime is not configured. Call configureCodexRuntimeRun() during app startup.");
  }
  return deps;
}

function getCodexModelCatalogService(): CodexModelCatalogService {
  if (modelCatalogService) {
    return modelCatalogService;
  }
  const runtimeDeps = requireDeps();

  modelCatalogService = new CodexModelCatalogService({
    getLiveClient: () => getGlobalCodexRuntimeLifecycle()?.getClient(),
    createTemporaryLifecycle: () => {
      const codexExecutable = resolveCodexExecutable();
      if (!codexExecutable) {
        throw new Error(
          "Codex model catalog is unavailable because the Codex CLI executable could not be resolved.",
        );
      }
      return new CodexRuntimeLifecycle({
        ecoDataDir: runtimeDeps.ecoDataDir,
        codexExecutable,
        onStderr: (chunk) => runtimeDeps.onStderr?.(`[codex model/list] ${chunk}`),
      });
    },
  });
  return modelCatalogService;
}

/** User-visible messages and tool lifecycle events publish immediately. */
export function isCodexStreamingProjectionEvent(event: ThreadRunEventInput): boolean {
  return event.eventType === "thinking.delta";
}

function getProjectCodexCandidates(): string[] {
  const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const workspaceRoot = path.resolve(appRoot, "../..");
  const cwdWorkspaceRoot = path.resolve(process.cwd(), "../..");
  const binName = process.platform === "win32" ? "codex.cmd" : "codex";
  return uniquePaths([
    path.join(process.cwd(), "node_modules", ".bin", binName),
    path.join(appRoot, "node_modules", ".bin", binName),
    path.join(workspaceRoot, "node_modules", ".bin", binName),
    path.join(cwdWorkspaceRoot, "node_modules", ".bin", binName),
  ]);
}

function resolveCodexExecutableFromPath(): string | undefined {
  const command = process.platform === "win32" ? "where" : "which";
  try {
    const resolved = execFileSync(command, ["codex"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    return resolved;
  } catch {
    return undefined;
  }
}

function isRunnableCodexExecutable(filePath: string): boolean {
  if (!isExecutableFile(filePath)) {
    return false;
  }
  try {
    execFileSync(filePath, ["--version"], {
      stdio: "ignore",
      timeout: 5_000,
      shell: process.platform === "win32",
    });
    return true;
  } catch {
    return false;
  }
}

function isExecutableFile(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

function uniquePaths(paths: readonly string[]): string[] {
  return [...new Set(paths)];
}
