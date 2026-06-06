import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ParsedUsage,
  type EcoPlanningContext,
  type EcoSdkResumeOptions,
  type EcoSdkSessionOptions,
  type OtelActivityLine,
  type OtelUsageUpdate,
  type PlanReadyPayload,
  type SessionCapturedPayload,
  type AgentEvent,
} from "@eco/runtime";
import {
  ClaudeAgentSdkDriver,
  extractSdkRunFailure,
  type EcoHookContext,
  type SdkTodoUpdatedPayload,
} from "@eco/runtime/sdk";
import { defaultSubagentAvailability, isSubagentRole, type SubagentRunPhase } from "@eco/runtime";
import {
  createRedisSessionStore,
  createSqliteSessionStore,
  testRedisConnection,
  type SessionStore,
} from "@eco/persistence";
import type { ResolvedModelRoute } from "@eco/model-router";
import {
  createSessionPlan,
  GitWorktreeService,
  type CommandRunner,
  type WorktreePlan,
} from "@eco/workspace";
import { app, BrowserWindow, dialog, ipcMain, nativeImage, type NativeImage } from "electron";
import {
  AGENT_ROLES,
  type AgentRole,
  IPC_CHANNELS,
  isKnownIpcChannel,
  type McpServerConfigInput,
  type ListUpstreamModelsRequest,
  type TestProviderConnectionRequest,
  type TestRoleRoutesRequest,
  type ModelSettingsSnapshot,
  type ProviderConfigInput,
  type RoleRouteConfig,
  type ThreadRuntimeConfig,
  type ThreadRuntimeConfigInput,
  type ThreadUpdateRuntimeConfigRequest,
  isThreadRuntimeConfig,
  normalizeThreadRuntimeConfig,
  buildThreadRuntimeConfigFromDefaults,
  getRoutesForProfile,
  type RouteProfileInput,
  type ClarificationSubmitPayload,
  type CoderTodoItem,
  type ThreadActivityLine,
  type SessionSyncSettingsInput,
  type SessionSyncTestConnectionRequest,
  type ThreadContinueRequest,
  type ThreadContinueResult,
  type ThreadRetryRequest,
  type ThreadRetryResult,
  type ThreadLiveEvent,
  type ThreadBillingSnapshot,
  type ThreadModelUsageEntry,
  type ThreadPendingPlan,
  type ThreadRollbackResult,
  type WorktreeCancelDisposition,
  type ThreadStartRequest,
  type ThreadStatus,
  type PromptImageAttachment,
  type ThinkingEffort,
  type ThreadSummary,
  type ThreadUsageSnapshot,
  type ThreadUsageSnapshotResult,
  type ThreadContextSnapshot,
  type WorktreeApplyResult,
  type WorktreeStatusResult,
  type ThreadAppliedDiffResult,
  type ThreadRevertAppliedDiffResult,
  type ThreadRewindCheckpointRequest,
  type ThreadRewindCheckpointResult,
  type WorkspaceInfo,
} from "../shared/ipc";
import {
  buildWorktreeMergeSummary,
  formatWorktreeMergeThreadMessage,
  serializeWorktreeMergeMessage,
} from "../shared/worktree-merge";
import { resolveUpstreamApiCompat } from "../shared/api-compat";
import {
  extractCoderTasksFromActivity,
  mergeCoderTodoItems,
} from "./coder-tasks";
import { createSdkTaskTracker } from "./sdk-task-tracker";
import {
  REQUEST_AUTO_RETRY_INTERVAL_MS,
  formatUserFacingRequestError,
  runWithRequestAutoRetry,
  type RequestAttemptResult,
} from "./request-retry";
import { classifyThreadIntent } from "./thread-intent";
import { parseThreadApprovePlanPayload } from "../shared/plan-approval";
import {
  approvedPlanSnapshotExists,
  isWorktreeGitCwdError,
  readApprovedPlanSnapshot,
  resolveWorktreePathHint,
  writeApprovedPlanSnapshot,
} from "./worktree-lifecycle";
import {
  buildPlanExecutionFailureMessage,
  planExecutionFailurePrefix,
} from "../shared/thread-failure-message";
import {
  buildAgentPromptWithContext,
  continueStatusMessage,
  isContinuableThreadStatus,
  resolveThreadContinueAction,
  threadEnteredExecutionPhase,
  type ThreadContinueAction,
} from "../shared/thread-continuation";
import {
  computeRouteFingerprint,
  routesMatchFingerprint,
} from "../shared/route-fingerprint";
import {
  pendingThreadTitle,
  shouldReplaceAutoThreadTitle,
  summarizeThreadTitle,
  threadTitleFromPlannerPlan,
} from "./thread-title";
import { createConversationStore, type ConversationStore } from "./conversation-store";
import { createSessionSyncStore, type SessionSyncStore } from "./session-sync-store";
import {
  createModelAlias,
  estimateInputTokensFromAnthropicBody,
  startAnthropicModelProxy,
  type AnthropicProxyResolvedRoute,
  type AnthropicProxyStartOptions,
  type AnthropicProxyUsageHandler,
  type AnthropicProxyUsageInfo,
} from "./anthropic-proxy";
import type { UpstreamProxyCallBilling } from "./upstream-proxy-log";
import {
  lookupRouteCapabilityHints,
  lookupRoutePricingHints,
  resolveRuntimeRoutesFromSettings,
} from "./billing-resolver";
import {
  createBillingRuntimeEnvironment,
  resolveBillingRuntimeContext,
  type BillingRuntimeEnvironment,
} from "./billing-runtime-environment";
import {
  isSubagentBillingRole,
  type UsageBillingObservation,
} from "./billing-orchestration";
import {
  ActiveRunRuntimeStateStore,
  type ActiveRunRuntimeStateInput,
} from "./active-run-runtime-state";
import { ActiveRunBillingStateStore } from "./active-run-billing-state";
import { logContextSnapshot } from "./context-snapshot-log";
import { logEcoDiag, logEcoDiagThrottled, shortThreadId } from "./eco-diag-log";
import { ModelsDevPricingCache } from "./models-dev-pricing-cache";
import { ContextWindowMonitor } from "./context-window-monitor";
import { ContextSnapshotScheduler } from "./context-snapshot-scheduler";
import {
  createContextLifecycleService,
  type ContextLifecycleService,
} from "./context-lifecycle-service";
import {
  ThreadUsageAccumulator,
} from "./thread-usage-accumulator";
import {
  flushThreadMetrics,
  persistThreadMetrics,
  restoreThreadMetricsFromStore,
} from "./thread-metrics-runtime";
import { resolveOtelUsageBilling } from "./otel-usage-billing";
import { resolveProxyUsageBilling } from "./proxy-usage-billing";
import { normalizeTelemetryBillingRole } from "./telemetry-billing-role";
import {
  resolveSingleUsageBillingOrchestration,
  type SingleUsageBillingRequest,
} from "./single-usage-billing-orchestration";
import {
  type UsageBillingPricingRoute,
} from "./usage-billing-artifacts";
import {
  applySdkRunBillingEffects,
  applySdkStreamPartialBillingEffects,
  applySingleUsageBillingEffects,
  type UsageBillingUpdatedEvent,
} from "./usage-billing-effects";
import { createUsageContextService } from "./usage-context-effects";
import {
  createCompactionAuditService,
  type CompactionAuditService,
} from "./compaction-audit-service";
import type { RunAttemptPhase, RunAttemptStatus } from "./usage-ledger";
import { UsageLedgerCoordinator } from "./usage-ledger-coordinator";
import { AgentLifecycleService } from "./agent-lifecycle-service";
import {
  createSubagentSessionHooks,
  type PendingSubagentLaunch,
} from "./subagent-session-hooks.js";
import { SubagentMetricsRegistry } from "./subagent-metrics-registry";
import { resolveSubagentUsageAttribution } from "./subagent-usage-attribution";
import {
  resolveSdkEventUsageBilling,
  type SdkUsageBillingBundle,
} from "./sdk-event-usage-billing";
import { resolveSdkRunBillingResolution } from "./sdk-run-billing-resolution";
import {
  resolveSdkStreamPartialBillingOrchestration,
  type SdkStreamPartialBillingRequest,
} from "./sdk-stream-partial-billing-orchestration";
import { normalizeSubagentMissionKey } from "./subagent-session-resolve.js";
import { buildSubagentSessionTimings } from "./subagent-session-snapshots.js";
import { getUpstreamLogFilePath } from "./upstream-log";
import { createMcpStore, type McpStore } from "./mcp-store";
import { localOtelReceiver } from "./otel-receiver";
import { listDiscoveredSkills } from "./skills-discovery";
import { linkAgentsSkillsToClaude } from "./skills-symlink";
import {
  filterExplicitUserSkillNames,
  listSdkReadyProjectSkills,
  mergeSkillNames,
  type LinkAgentsSkillsRequest,
} from "../shared/skills";
import { listProviderUpstreamModels, testProviderConnection, testRoleRoutes } from "./provider-models";
import { SdkStreamActivityBridge } from "./sdk-stream-activity";
import { resolveActivityAgentId, resolveOtelActivityAgentId } from "./activity-agent-id";
import {
  createSubagentSettingsStore,
  isSubagentEnabledSettings,
  type SubagentSettingsStore,
} from "./subagent-settings-store";
import {
  createWorkflowSettingsStore,
  isWorkflowSettingsSnapshot,
  normalizeWorkflowSettingsSnapshot,
  orchestrationModeFromSnapshot,
  type WorkflowSettingsStore,
} from "./workflow-settings-store";
import {
  createProxyBridgeSettingsStore,
  isProxyBridgeSettingsSnapshot,
  normalizeProxyBridgeSettingsSnapshot,
  resolveUpstreamUserAgentOverride,
  type ProxyBridgeSettingsStore,
} from "./proxy-bridge-settings-store";
import { createProviderStore, type ProviderConfigSecret, type ProviderStore } from "./provider-store";
import { inspectWorkspace, resolveGitExecutable } from "./workspace-inspect";
import { prepareWorkspaceGit } from "./workspace-git-setup";
import {
  finalizeCancelledRun,
  parseThreadCancelRequest,
  takePendingCancelDisposition,
  type FinalizeCancelledRunDeps,
} from "./cancel-worktree";
import {
  buildAskUserQuestionUpdatedInput,
  buildIgnoredClarificationAnswers,
  cancelClarificationsForThread,
  formatClarificationAnswersSummary,
  getPendingClarificationByToolUseId,
  getPendingClarificationForThread,
  registerPendingClarification,
  submitClarification,
} from "./clarification-bridge";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.VITE_DEV_SERVER_URL !== undefined;

const packagingDir = path.join(__dirname, "../../packaging");

function loadAppIcon(): NativeImage | undefined {
  const candidates =
    process.platform === "win32"
      ? ["icon.ico", "icon.png"]
      : process.platform === "darwin"
        ? ["icon.icns", "icon.png"]
        : ["icon.png", "icon.ico"];
  for (const name of candidates) {
    const iconPath = path.join(packagingDir, name);
    if (!existsSync(iconPath)) {
      continue;
    }
    const image = nativeImage.createFromPath(iconPath);
    if (!image.isEmpty()) {
      return image;
    }
  }
  return undefined;
}

const appIcon = loadAppIcon();
const gitRunner: CommandRunner = {
  run: runGitCommand,
};
const gitWorktrees = new GitWorktreeService(gitRunner);
let currentWorkspace: WorkspaceInfo | undefined;
let providerStore: ProviderStore;
let mcpStore: McpStore;
let conversationStore: ConversationStore;
let subagentSettingsStore: SubagentSettingsStore;
let workflowSettingsStore: WorkflowSettingsStore;
let proxyBridgeSettingsStore: ProxyBridgeSettingsStore;
let sessionSyncStore: SessionSyncStore;
let sdkSessionStore: SessionStore | undefined;
let closeSdkSessionStore: (() => Promise<void>) | undefined;

const activeRunRuntimeState = new ActiveRunRuntimeStateStore();
const activeRunBillingState = new ActiveRunBillingStateStore();
const pendingCancelDisposition = new Map<string, WorktreeCancelDisposition>();
const threadUsageAccumulator = new ThreadUsageAccumulator();
let agentLifecycle: AgentLifecycleService;
let usageLedgerCoordinator: UsageLedgerCoordinator;
let subagentMetricsRegistry: SubagentMetricsRegistry;
const persistMetricsTimers = new Map<string, ReturnType<typeof setTimeout>>();
const sdkStreamBridge = new SdkStreamActivityBridge();
let pricingCache: ModelsDevPricingCache;
let pricingCatalogReady: Promise<void> = Promise.resolve();
let billingRuntimeEnvironment: BillingRuntimeEnvironment;
let contextMonitor: ContextWindowMonitor;
let contextScheduler: ContextSnapshotScheduler;
let contextLifecycle: ContextLifecycleService;
let compactionAuditService: CompactionAuditService;

type AgentEventLike = Pick<AgentEvent, "id" | "type" | "payload" | "role" | "agentId">;

function startActiveRun(threadId: string, run: ActiveRunRuntimeStateInput): void {
  activeRunRuntimeState.startRun(threadId, run);
  activeRunBillingState.startRun(threadId);
}

function finishActiveRun(threadId: string): void {
  activeRunRuntimeState.finishRun(threadId);
  activeRunBillingState.clearRun(threadId);
}

async function createMainWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1080,
    minHeight: 720,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#212121",
    ...(appIcon ? { icon: appIcon } : {}),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    await window.loadURL(process.env.VITE_DEV_SERVER_URL as string);
  } else {
    await window.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(async () => {
  if (appIcon && process.platform === "darwin") {
    app.dock?.setIcon(appIcon);
  }
  const dbPath = path.join(app.getPath("userData"), "eco-coding.sqlite");
  providerStore = await createProviderStore(dbPath);
  mcpStore = await createMcpStore(dbPath);
  conversationStore = await createConversationStore(dbPath);
  subagentMetricsRegistry = new SubagentMetricsRegistry(conversationStore);
  usageLedgerCoordinator = new UsageLedgerCoordinator({
    store: conversationStore,
    metrics: subagentMetricsRegistry,
    logDiag: logEcoDiag,
    logDiagThrottled: logEcoDiagThrottled,
  });
  subagentSettingsStore = await createSubagentSettingsStore(dbPath);
  workflowSettingsStore = await createWorkflowSettingsStore(dbPath);
  proxyBridgeSettingsStore = await createProxyBridgeSettingsStore(dbPath);
  sessionSyncStore = await createSessionSyncStore(dbPath);
  agentLifecycle = new AgentLifecycleService(conversationStore);
  pricingCache = new ModelsDevPricingCache({
    cachePath: path.join(app.getPath("userData"), "models-dev-pricing.json"),
  });
  pricingCatalogReady = pricingCache.getCatalog().then(
    () => {},
    (error) => {
      process.stderr.write(`[eco] models.dev pricing cache init failed: ${errorMessage(error)}\n`);
    },
  );
  billingRuntimeEnvironment = createBillingRuntimeEnvironment({
    waitUntilReady: () => pricingCatalogReady,
    resolveRuntimeRoutes: resolveRuntimeRoutesForThread,
    lookupPricing: lookupUsageBillingPricing,
  });
  contextMonitor = new ContextWindowMonitor(pricingCache);
  contextScheduler = new ContextSnapshotScheduler({
    monitor: contextMonitor,
    isThreadRunning: (threadId) => activeRunRuntimeState.hasRun(threadId),
    getResume: (threadId, worktreePath) => resolveResumeOptions(threadId, worktreePath),
    isWorktreePathReady: async (worktreePath) => fileExists(worktreePath),
    withSdkDriver: (threadId, fn) => withThreadSdkDriver(threadId, fn),
    emitContext: emitThreadContextUpdated,
    emitActivity: (threadId, message) => {
      emitThreadEvent(threadId, "otel.activity", message, "system", false);
    },
    onCompactionBoundary: (threadId, input) => {
      recordCompactionLedgerBoundary(threadId, input.payload, input.sourceEventId);
    },
  });
  contextLifecycle = createContextLifecycleService({
    monitor: contextMonitor,
    emitLiveContext: (threadId) => contextScheduler.emitLiveFromMonitor(threadId),
    ensureHeadroom: ensureContextHeadroom,
    getThreadStatus: (threadId) => conversationStore.getThread(threadId)?.status,
    resolveThreadWorktreePath,
    applySdkContextUsageBreakdown: (threadId, payload) => {
      contextScheduler.applySdkContextUsageBreakdown(threadId, payload);
    },
    recordCompactionBoundary: (threadId, payload, sourceEventId) => {
      recordCompactionLedgerBoundary(threadId, payload, sourceEventId);
    },
  });
  compactionAuditService = createCompactionAuditService({
    listActivityLines: (threadId) => conversationStore.listActivityLines(threadId),
    getContextSnapshot: (threadId) => contextScheduler.getDisplaySnapshot(threadId),
    getSdkSession: (threadId) => conversationStore.getSdkSession(threadId),
    getPendingPlan: (threadId) => conversationStore.getPendingPlan(threadId),
    saveCompactionArchive: (threadId, input) => conversationStore.saveCompactionArchive(threadId, input),
    getRunAttemptId: (threadId) => agentLifecycle.usageRunAttemptId(threadId),
    getPlannerAgentId: (threadId) => agentLifecycle.usagePlannerAgentId(threadId),
    appendLedgerEvents: (events) => usageLedgerCoordinator.appendEvents(events),
    emitActivity: (threadId, message) => {
      emitThreadEvent(threadId, "otel.activity", message, "system", false);
    },
    markCompactInFlight: (threadId) => contextLifecycle.markCompactInFlight(threadId),
    writeError: (message) => process.stderr.write(message),
    nowIso: () => new Date().toISOString(),
    nowMs: () => Date.now(),
  });
  loadThreadMetricsFromStore();
  try {
    await rebuildSdkSessionStore(path.join(app.getPath("userData"), "eco-sessions.sqlite"));
  } catch (error) {
    process.stderr.write(
      `[eco] SessionStore init failed (${errorMessage(error)}), using local SQLite fallback\n`,
    );
    sdkSessionStore = await createSqliteSessionStore(path.join(app.getPath("userData"), "eco-sessions.sqlite"));
  }
  await localOtelReceiver.start({
    onActivity: emitOtelActivity,
    onUsage: emitOtelUsage,
  });
  backfillThreadRuntimeConfigs();
  recoverOrphanedRunningThreads();
  registerIpcHandlers();
  await createMainWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("will-quit", () => {
  flushAllThreadMetrics();
  void closeSdkSessionStore?.();
});

function buildDefaultThreadRuntimeConfig(): ThreadRuntimeConfig {
  return buildThreadRuntimeConfigFromDefaults({
    settings: providerStore.getSettings(),
    subagentDefaults: subagentSettingsStore.get(),
    workflowDefaults: workflowSettingsStore.get(),
  });
}

function ensureThreadRuntimeConfig(thread: ThreadSummary): ThreadSummary {
  if (thread.runtimeConfig) {
    return thread;
  }
  const config = buildDefaultThreadRuntimeConfig();
  conversationStore.saveThreadRuntimeConfig(thread.id, config);
  return { ...thread, runtimeConfig: config };
}

function hydrateThreads(threads: ThreadSummary[]): ThreadSummary[] {
  return threads.map(ensureThreadRuntimeConfig);
}

function backfillThreadRuntimeConfigs(): void {
  hydrateThreads(conversationStore.listThreads());
}

function parseThreadRuntimeConfigInput(value: unknown): ThreadRuntimeConfig {
  if (!isThreadRuntimeConfig(value)) {
    throw new Error("Invalid thread runtime configuration.");
  }
  return normalizeThreadRuntimeConfig(value);
}

function roleRoutesForThreadConfig(
  settings: ModelSettingsSnapshot,
  config: ThreadRuntimeConfig,
): RoleRouteConfig[] {
  const routes = getRoutesForProfile(settings, config.routeProfileId);
  if (!routes) {
    throw new Error(`找不到路由配置：${config.routeProfileId}`);
  }
  return routes;
}

function resolveRoleRoutesForThread(
  threadId: string,
  routeProfileIdOverride?: string,
): RoleRouteConfig[] {
  const settings = providerStore.getSettings();
  if (routeProfileIdOverride) {
    const routes = getRoutesForProfile(settings, routeProfileIdOverride);
    if (!routes) {
      throw new Error(`找不到路由配置：${routeProfileIdOverride}`);
    }
    return routes;
  }
  const thread = conversationStore.getThread(threadId);
  if (!thread) {
    throw new Error("Thread was not found.");
  }
  const config = ensureThreadRuntimeConfig(thread).runtimeConfig;
  if (!config) {
    throw new Error("Thread runtime configuration is missing.");
  }
  return roleRoutesForThreadConfig(settings, config);
}

function resolveRuntimeRoutesForThread(
  threadId: string,
): ReturnType<typeof resolveRuntimeRoutesFromSettings> {
  const settings = providerStore.getSettings();
  const providers = providerStore.listProvidersWithSecrets();
  const roleRoutes = resolveRoleRoutesForThread(threadId);
  return resolveRuntimeRoutesFromSettings(settings, providers, roleRoutes);
}

function threadOrchestrationMode(threadId: string): "autonomous" | "manual" {
  const thread = conversationStore.getThread(threadId);
  const config = thread ? ensureThreadRuntimeConfig(thread).runtimeConfig : undefined;
  return config?.orchestrationMode ?? workflowSettingsStore.get().orchestrationMode;
}

function threadUsesManualOrchestration(threadId: string): boolean {
  return threadOrchestrationMode(threadId) === "manual";
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.workspaceOpen, async () => {
    const result = await dialog.showOpenDialog({
      title: "Open project folder",
      properties: ["openDirectory"],
    });

    const selectedPath = result.filePaths[0];
    if (result.canceled || !selectedPath) {
      return { canceled: true };
    }

    currentWorkspace = await inspectWorkspace(selectedPath);
    return { canceled: false, workspace: currentWorkspace };
  });

  ipcMain.handle(IPC_CHANNELS.workspaceOpenPath, async (_event, workspacePath: unknown) => {
    if (typeof workspacePath !== "string" || !workspacePath.trim()) {
      throw new Error("Workspace path is required.");
    }
    const resolvedPath = path.resolve(workspacePath.trim());
    const stat = await fs.stat(resolvedPath);
    if (!stat.isDirectory()) {
      throw new Error("请选择文件夹，而不是文件。");
    }
    currentWorkspace = await inspectWorkspace(resolvedPath);
    return currentWorkspace;
  });

  ipcMain.handle(IPC_CHANNELS.workspaceGetCurrent, async () => currentWorkspace);

  ipcMain.handle(IPC_CHANNELS.workspaceInspect, async (_event, workspacePath: unknown) => {
    if (typeof workspacePath !== "string" || !workspacePath.trim()) {
      throw new Error("Workspace path is required.");
    }
    return inspectWorkspace(workspacePath.trim());
  });

  ipcMain.handle(IPC_CHANNELS.workspacePrepareGit, async (_event, payload: unknown) => {
    const workspacePath =
      payload && typeof payload === "object" && typeof (payload as { workspacePath?: unknown }).workspacePath === "string"
        ? (payload as { workspacePath: string }).workspacePath.trim()
        : "";
    if (!workspacePath) {
      throw new Error("Workspace path is required.");
    }
    const workspace = await prepareWorkspaceGit(workspacePath, gitRunner.run);
    currentWorkspace = workspace;
    return workspace;
  });

  ipcMain.handle(IPC_CHANNELS.threadList, async () => hydrateThreads(conversationStore.listThreads()));

  ipcMain.handle(IPC_CHANNELS.threadUpdateRuntimeConfig, async (_event, payload: unknown) => {
    if (
      !payload ||
      typeof payload !== "object" ||
      typeof (payload as ThreadUpdateRuntimeConfigRequest).threadId !== "string"
    ) {
      throw new Error("Thread id is required.");
    }
    const request = payload as ThreadUpdateRuntimeConfigRequest;
    const threadId = request.threadId.trim();
    if (!threadId) {
      throw new Error("Thread id is required.");
    }
    const thread = conversationStore.getThread(threadId);
    if (!thread) {
      throw new Error("Thread was not found.");
    }
    if (thread.status === "running" || thread.status === "queued") {
      throw new Error("请等待当前运行结束后再修改配置。");
    }
    const runtimeConfig = parseThreadRuntimeConfigInput(request.runtimeConfig);
    roleRoutesForThreadConfig(providerStore.getSettings(), runtimeConfig);
    conversationStore.saveThreadRuntimeConfig(threadId, runtimeConfig);
    noteSdkSessionRouteChange(threadId, roleRoutesForThreadConfig(providerStore.getSettings(), runtimeConfig));
    return { thread: ensureThreadRuntimeConfig(conversationStore.getThread(threadId) ?? thread) };
  });

  ipcMain.handle(IPC_CHANNELS.threadActivityList, async (_event, threadId: string) => {
    if (typeof threadId !== "string" || !threadId.trim()) {
      return [];
    }
    return conversationStore.listActivityLines(threadId);
  });

  ipcMain.handle(IPC_CHANNELS.threadSubagentSessionsList, async (_event, threadId: string) => {
    if (typeof threadId !== "string" || !threadId.trim()) {
      return [];
    }
    return buildSubagentSessionTimings(conversationStore.listSubagentSessions(threadId));
  });

  ipcMain.handle(IPC_CHANNELS.threadSubagentMetricsList, async (_event, threadId: string) => {
    if (typeof threadId !== "string" || !threadId.trim()) {
      return [];
    }
    return conversationStore.listSubagentMetrics(threadId).map((row) => ({
      agentId: row.agentId,
      role: row.role,
      status: row.status,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cacheReadTokens: row.cacheReadTokens,
      cacheCreationTokens: row.cacheCreationTokens,
      contextOccupied: row.contextOccupied,
      ...(row.contextLimit !== undefined && { contextLimit: row.contextLimit }),
      ecoCostUsd: row.ecoCostUsd,
      ...(row.modelId && { modelId: row.modelId }),
    }));
  });

  ipcMain.handle(IPC_CHANNELS.threadTodoList, async (_event, threadId: string) => {
    if (typeof threadId !== "string" || !threadId.trim()) {
      return [];
    }
    const stored = conversationStore.listCoderTodos(threadId);
    if (stored.length > 0) {
      return stored;
    }
    const activity = conversationStore.listActivityLines(threadId);
    const drafts = extractCoderTasksFromActivity(activity);
    if (drafts.length === 0) {
      return stored;
    }
    const todos = mergeCoderTodoItems(threadId, drafts, stored);
    conversationStore.replaceCoderTodos(threadId, todos);
    return todos;
  });

  ipcMain.handle(IPC_CHANNELS.modelSettingsGet, async () => providerStore.getSettings());

  ipcMain.handle(IPC_CHANNELS.modelProviderSave, async (_event, payload: ProviderConfigInput) => {
    const provider = providerStore.saveProvider(payload);
    emitSettingsUpdated();
    return provider;
  });

  ipcMain.handle(IPC_CHANNELS.modelProviderDelete, async (_event, providerId: unknown) => {
    if (typeof providerId !== "string" || !providerId.trim()) {
      throw new Error("Provider id is required.");
    }
    providerStore.deleteProvider(providerId.trim());
    emitSettingsUpdated();
    return { ok: true as const };
  });

  ipcMain.handle(IPC_CHANNELS.modelProviderListModels, async (_event, payload: ListUpstreamModelsRequest) => {
    if (!payload || typeof payload !== "object") {
      return { ok: false, error: "Invalid models list request." } as const;
    }
    return listProviderUpstreamModels(
      providerStore,
      payload,
      resolveUpstreamUserAgentOverride(proxyBridgeSettingsStore.get()),
    );
  });

  ipcMain.handle(IPC_CHANNELS.modelProviderTest, async (_event, payload: TestProviderConnectionRequest) => {
    if (!payload || typeof payload !== "object") {
      return { ok: false, error: "Invalid provider test request." } as const;
    }
    return testProviderConnection(
      providerStore,
      payload,
      fetch,
      resolveUpstreamUserAgentOverride(proxyBridgeSettingsStore.get()),
    );
  });

  ipcMain.handle(IPC_CHANNELS.modelRouteProfileTest, async (_event, payload: TestRoleRoutesRequest) => {
    if (!payload || typeof payload !== "object" || !Array.isArray(payload.routes)) {
      return { results: [], passed: 0, failed: 0 };
    }
    return testRoleRoutes(
      providerStore,
      payload,
      fetch,
      resolveUpstreamUserAgentOverride(proxyBridgeSettingsStore.get()),
    );
  });

  ipcMain.handle(IPC_CHANNELS.modelRouteProfileSave, async (_event, payload: RouteProfileInput) => {
    const profile = providerStore.saveRouteProfile(payload);
    emitSettingsUpdated();
    return profile;
  });

  ipcMain.handle(IPC_CHANNELS.modelRouteProfileDelete, async (_event, profileId: unknown) => {
    if (typeof profileId !== "string" || !profileId.trim()) {
      throw new Error("Route profile id is required.");
    }
    providerStore.deleteRouteProfile(profileId.trim());
    emitSettingsUpdated();
    return { ok: true as const };
  });

  ipcMain.handle(IPC_CHANNELS.billingModelsDevList, async () => {
    await pricingCatalogReady;
    return pricingCache.listModelOptions();
  });

  ipcMain.handle(IPC_CHANNELS.billingRefreshPricing, async () => {
    await pricingCache.refresh();
    return { ok: true as const, cachedAt: pricingCache.getCachedAt() };
  });

  ipcMain.handle(
    IPC_CHANNELS.billingRoutePricing,
    async (_event, routesOverride?: RoleRouteConfig[]) => {
    await pricingCatalogReady;
    return lookupRoutePricingHints(
      pricingCache,
      providerStore.getSettings(),
      providerStore.listProvidersWithSecrets(),
      routesOverride,
    );
  },
  );

  ipcMain.handle(
    IPC_CHANNELS.billingRouteCapabilities,
    async (_event, routesOverride?: RoleRouteConfig[]) => {
    await pricingCatalogReady;
    return lookupRouteCapabilityHints(
      pricingCache,
      providerStore.getSettings(),
      providerStore.listProvidersWithSecrets(),
      routesOverride,
    );
  },
  );

  ipcMain.handle(IPC_CHANNELS.mcpSettingsGet, async () => mcpStore.getSettings());

  ipcMain.handle(IPC_CHANNELS.mcpServerSave, async (_event, payload: McpServerConfigInput) => {
    const server = mcpStore.saveServer(payload);
    emitSettingsUpdated();
    return server;
  });

  ipcMain.handle(IPC_CHANNELS.skillsList, async (_event, workspacePath: unknown) => {
    const pathToScan =
      typeof workspacePath === "string" && workspacePath.trim()
        ? workspacePath.trim()
        : currentWorkspace?.path;
    return listDiscoveredSkills(pathToScan);
  });

  ipcMain.handle(IPC_CHANNELS.skillsLinkAgents, async (_event, payload: unknown) => {
    if (!isLinkAgentsSkillsRequest(payload)) {
      throw new Error("Invalid link agents skills request.");
    }
    const discovered = await listDiscoveredSkills(payload.workspacePath);
    const toLink = discovered.agentsOnlySkills.filter(
      (skill) => !payload.baseDir || skill.baseDir === payload.baseDir,
    );
    const linkResult = await linkAgentsSkillsToClaude(
      toLink,
      payload.baseDir ? { baseDir: payload.baseDir } : undefined,
    );
    return linkResult;
  });

  ipcMain.handle(IPC_CHANNELS.subagentSettingsGet, async () => subagentSettingsStore.get());

  ipcMain.handle(IPC_CHANNELS.subagentSettingsSave, async (_event, payload: unknown) => {
    if (!isSubagentEnabledSettings(payload)) {
      throw new Error("Invalid subagent settings.");
    }
    return subagentSettingsStore.save(payload);
  });

  ipcMain.handle(IPC_CHANNELS.workflowSettingsGet, async () => workflowSettingsStore.get());

  ipcMain.handle(IPC_CHANNELS.workflowSettingsSave, async (_event, payload: unknown) => {
    if (!isWorkflowSettingsSnapshot(payload)) {
      throw new Error("Invalid workflow settings.");
    }
    return workflowSettingsStore.save(normalizeWorkflowSettingsSnapshot(payload));
  });

  ipcMain.handle(IPC_CHANNELS.proxyBridgeSettingsGet, async () => proxyBridgeSettingsStore.get());

  ipcMain.handle(IPC_CHANNELS.proxyBridgeSettingsSave, async (_event, payload: unknown) => {
    if (!isProxyBridgeSettingsSnapshot(payload)) {
      throw new Error("Invalid proxy bridge settings.");
    }
    return proxyBridgeSettingsStore.save(normalizeProxyBridgeSettingsSnapshot(payload));
  });

  ipcMain.handle(IPC_CHANNELS.worktreeGetStatus, async (_event, threadId: unknown) => {
    if (typeof threadId !== "string" || !threadId.trim()) {
      throw new Error("Thread id is required.");
    }
    return getWorkspaceChangeStatus(threadId);
  });

  ipcMain.handle(IPC_CHANNELS.worktreeApply, async (_event, threadId: unknown) => {
    if (typeof threadId !== "string" || !threadId.trim()) {
      throw new Error("Thread id is required.");
    }
    return { ok: true, files: [], message: "变更已在项目目录中，无需合并。" } satisfies WorktreeApplyResult;
  });

  ipcMain.handle(IPC_CHANNELS.threadRewindCheckpoint, async (_event, payload: unknown) => {
    return rewindThreadToCheckpoint(payload);
  });

  ipcMain.handle(IPC_CHANNELS.threadListCheckpoints, async (_event, threadId: unknown) => {
    if (typeof threadId !== "string" || !threadId.trim()) {
      throw new Error("Thread id is required.");
    }
    return conversationStore.listFileCheckpoints(threadId.trim());
  });

  ipcMain.handle(IPC_CHANNELS.mcpServerDelete, async (_event, serverId: unknown) => {
    if (typeof serverId !== "string" || !serverId.trim()) {
      throw new Error("MCP server id is required.");
    }
    mcpStore.deleteServer(serverId);
    emitSettingsUpdated();
    return { ok: true };
  });

  ipcMain.handle(IPC_CHANNELS.sessionSyncSettingsGet, async () => sessionSyncStore.getSettings());

  ipcMain.handle(IPC_CHANNELS.sessionSyncSettingsSave, async (_event, payload: SessionSyncSettingsInput) => {
    const settings = sessionSyncStore.saveSettings(payload);
    await rebuildSdkSessionStore(path.join(app.getPath("userData"), "eco-sessions.sqlite"));
    emitSettingsUpdated();
    return settings;
  });

  ipcMain.handle(
    IPC_CHANNELS.sessionSyncTestConnection,
    async (_event, payload: SessionSyncTestConnectionRequest) => {
      if (!payload || typeof payload.redisUrl !== "string" || !payload.redisUrl.trim()) {
        return { ok: false, error: "Redis URL is required." };
      }
      const stored = sessionSyncStore.getSettingsWithSecrets();
      const password =
        payload.redisPassword && payload.redisPassword.length > 0
          ? payload.redisPassword
          : stored.redisPassword;
      return testRedisConnection({
        url: payload.redisUrl.trim(),
        ...(password ? { password } : {}),
      });
    },
  );

  ipcMain.handle(IPC_CHANNELS.threadStart, async (_event, payload: ThreadStartRequest) => {
    const prompt = payload.prompt.trim();
    const hasAttachments = Boolean(payload.attachments?.length);
    if (!prompt && !hasAttachments) {
      throw new Error("Task prompt is required.");
    }

    const workspace = await ensureWorkspace(payload.workspacePath);
    const threadRuntime = parseThreadRuntimeConfigInput(payload.runtimeConfig);
    const settings = providerStore.getSettings();
    const roleRoutes = roleRoutesForThreadConfig(settings, threadRuntime);
    const runtimeConfig = resolveRuntimeConfig(
      settings,
      providerStore.listProvidersWithSecrets(),
      roleRoutes,
    );
    const intent = classifyThreadIntent(prompt);
    const status: ThreadSummary["status"] = runtimeConfig.ok ? "running" : "blocked";
    const now = new Date().toISOString();
    const thread: ThreadSummary = {
      id: `thr_${Date.now()}`,
      title: pendingThreadTitle,
      prompt,
      workspacePath: workspace.path,
      status,
      createdAt: now,
      updatedAt: now,
      message: runtimeConfig.ok
        ? intent === "question"
          ? "正在回答…"
          : "正在启动 Claude Agent SDK…"
        : runtimeConfig.reason,
      runtimeConfig: threadRuntime,
    };

    conversationStore.saveThread(thread);
    recordUserPrompt(thread.id, prompt);
    emitThreadEvent(thread.id, status === "blocked" ? "thread.blocked" : "thread.started", thread.message);

    if (runtimeConfig.ok) {
      const attachments = payload.attachments;
      if (intent === "question") {
        void runQuestionThread(thread, workspace, runtimeConfig, prompt, undefined, undefined, attachments, roleRoutes);
      } else if (threadRuntime.orchestrationMode === "manual") {
        void runCodingThreadPlanning(thread, workspace, runtimeConfig, prompt, undefined, undefined, attachments, roleRoutes);
      } else {
        void runCodingThreadAutonomous(thread, workspace, runtimeConfig, prompt, undefined, undefined, attachments, roleRoutes);
      }
    }

    return { thread };
  });

  ipcMain.handle(IPC_CHANNELS.clarificationGetPending, async (_event, threadId: unknown) => {
    if (typeof threadId !== "string" || !threadId.trim()) {
      return undefined;
    }
    return getPendingClarificationForThread(threadId);
  });

  ipcMain.handle(IPC_CHANNELS.clarificationDismiss, async (_event, toolUseId: unknown) => {
    if (typeof toolUseId !== "string" || !toolUseId.trim()) {
      throw new Error("Tool use id is required.");
    }
    const request = getPendingClarificationByToolUseId(toolUseId);
    if (!request) {
      throw new Error("No pending clarification for this tool use.");
    }
    const ok = submitClarification(toolUseId, buildIgnoredClarificationAnswers(request));
    if (!ok) {
      throw new Error("Failed to dismiss clarification.");
    }
    return { ok: true as const };
  });

  ipcMain.handle(IPC_CHANNELS.clarificationSubmit, async (_event, payload: unknown) => {
    if (!isClarificationSubmitPayload(payload)) {
      throw new Error("Invalid clarification payload.");
    }
    if (!getPendingClarificationByToolUseId(payload.toolUseId)) {
      throw new Error("No pending clarification for this tool use.");
    }
    const ok = submitClarification(payload.toolUseId, {
      toolUseId: payload.toolUseId,
      selections: payload.selections,
    });
    if (!ok) {
      throw new Error("Failed to submit clarification.");
    }
    return { ok: true as const };
  });

  ipcMain.handle(IPC_CHANNELS.threadGetUsageSnapshot, async (_event, threadId: unknown) => {
    if (typeof threadId !== "string" || !threadId.trim()) {
      return {} satisfies ThreadUsageSnapshotResult;
    }
    const id = threadId.trim();
    const billing = threadUsageAccumulator.getSnapshot(id);
    const context = contextScheduler.getDisplaySnapshot(id);
    return {
      ...(billing && { billing }),
      ...(context && { context }),
    } satisfies ThreadUsageSnapshotResult;
  });

  ipcMain.handle(IPC_CHANNELS.threadGetPendingPlan, async (_event, threadId: unknown) => {
    if (typeof threadId !== "string" || !threadId.trim()) {
      return undefined;
    }
    const pending = conversationStore.getPendingPlan(threadId);
    if (!pending) {
      return undefined;
    }
    return {
      threadId: pending.threadId,
      userPrompt: pending.userPrompt,
      analysis: pending.analysis,
      plan: pending.plan,
      workspacePath: pending.workspacePath,
      worktreePath: pending.worktreePath,
    } satisfies ThreadPendingPlan;
  });

  ipcMain.handle(IPC_CHANNELS.threadApprovePlan, async (_event, payload: unknown) => {
    const { threadId } = parseThreadApprovePlanPayload(payload);
    const thread = conversationStore.getThread(threadId);
    if (!thread) {
      throw new Error("Thread was not found.");
    }
    if (thread.status !== "awaiting_plan") {
      throw new Error("This thread is not waiting for plan approval.");
    }
    if (activeRunRuntimeState.hasRun(threadId)) {
      throw new Error("Thread is already running.");
    }

    const pending = conversationStore.getPendingPlan(threadId);
    if (!pending) {
      throw new Error("找不到待批准的计划。");
    }

    if (!pending.plan.trim()) {
      throw new Error("计划内容不能为空。");
    }

    const roleRoutes = resolveRoleRoutesForThread(threadId);
    const runtimeConfig = resolveRuntimeConfig(
      providerStore.getSettings(),
      providerStore.listProvidersWithSecrets(),
      roleRoutes,
    );
    if (!runtimeConfig.ok) {
      throw new Error(runtimeConfig.reason);
    }

    updateThread(threadId, {
      status: "running",
      message: "正在按计划执行…",
    });
    if (threadUsesManualOrchestration(threadId)) {
      void runCodingThreadExecution(threadId, runtimeConfig, { routesOverride: roleRoutes });
    } else {
      void runCodingThreadAutonomousAfterApproval(threadId, runtimeConfig, { routesOverride: roleRoutes });
    }
    return { thread: ensureThreadRuntimeConfig(conversationStore.getThread(threadId) ?? thread) };
  });

  ipcMain.handle(IPC_CHANNELS.threadDismissPlan, async (_event, threadId: unknown) => {
    if (typeof threadId !== "string" || !threadId.trim()) {
      throw new Error("Thread id is required.");
    }
    await dismissPendingPlan(
      threadId,
      "已忽略计划。可在下方继续对话说明修改意见，Planner 将重新输出完整计划。",
    );
    return { thread: conversationStore.getThread(threadId) };
  });

  ipcMain.handle(IPC_CHANNELS.threadContinue, async (_event, payload: ThreadContinueRequest) => {
    const prompt = payload.prompt.trim();
    const hasAttachments = Boolean(payload.attachments?.length);
    if (!prompt && !hasAttachments) {
      throw new Error("Message is required.");
    }
    const thread = conversationStore.getThread(payload.threadId);
    if (!thread) {
      throw new Error("Thread was not found.");
    }
    if (thread.status === "running" || thread.status === "queued") {
      throw new Error("Wait for the current run to finish.");
    }

    const workspace = await ensureWorkspace(thread.workspacePath);
    const settings = providerStore.getSettings();
    if (payload.runtimeConfig) {
      const nextConfig = parseThreadRuntimeConfigInput(payload.runtimeConfig);
      roleRoutesForThreadConfig(settings, nextConfig);
      conversationStore.saveThreadRuntimeConfig(payload.threadId, nextConfig);
    }
    const roleRoutes = resolveRoleRoutesForThread(payload.threadId);
    noteSdkSessionRouteChange(payload.threadId, roleRoutes);

    const runtimeConfig = resolveRuntimeConfig(
      settings,
      providerStore.listProvidersWithSecrets(),
      roleRoutes,
    );
    if (!runtimeConfig.ok) {
      throw new Error(runtimeConfig.reason);
    }
    const runtime: RuntimeConfig = { routes: runtimeConfig.routes };

    const intent = classifyThreadIntent(prompt);
    const activityLines = conversationStore.listActivityLines(payload.threadId);
    const sdkSession = conversationStore.getSdkSession(payload.threadId);
    const hasPriorActivity = threadHasResumableCheckpoint(thread, activityLines);
    const cwd = normalizeSessionCwd(workspace.path, sdkSession?.cwd);
    const canResume = Boolean(sdkSession?.sessionId && existsSync(cwd) && cwd === workspace.path);
    const existingWorktreePlan = createSessionPlan(workspace.path, payload.threadId);

    const hasPendingPlan = Boolean(conversationStore.getPendingPlan(payload.threadId));
    const hasApprovedPlanOnDisk = await approvedPlanSnapshotExists(workspace.path, payload.threadId);
    const hasCoderTodos = conversationStore.listCoderTodos(payload.threadId).length > 0;
    const hasAppliedDiff = Boolean(conversationStore.getAppliedDiff(payload.threadId));
    const enteredExecutionPhase = threadEnteredExecutionPhase({
      threadStatus: thread.status,
      hasPendingPlan,
      hasApprovedPlanOnDisk,
      enteredExecutionPhase: false,
      hasCoderTodos,
      hasAppliedDiff,
      activityLines,
    });

    const continueAction = resolveThreadContinueAction({
      intent,
      followUp: prompt,
      canResume,
      usesManualOrchestration: threadUsesManualOrchestration(payload.threadId),
      hasPendingPlan,
      hasApprovedPlanOnDisk,
      enteredExecutionPhase,
      hasCoderTodos,
      hasAppliedDiff,
      threadStatus: thread.status,
      activityLines,
    });

    const agentPrompt =
      continueAction.kind === "resume_sdk" || continueAction.kind === "resume_execution"
        ? prompt
        : buildAgentPromptWithContext(thread.prompt, prompt, activityLines);
    const statusMessage = continueStatusMessage(continueAction, intent);

    updateThread(payload.threadId, {
      status: "running",
      message: statusMessage,
    });
    recordUserPrompt(payload.threadId, prompt);

    const updated: ThreadSummary = {
      ...thread,
      status: "running",
      message: statusMessage,
    };

    void dispatchThreadContinueAction({
      threadId: payload.threadId,
      action: continueAction,
      updated,
      workspace,
      runtimeConfig: runtime,
      agentPrompt,
      cwd,
      ...(existingWorktreePlan ? { existingWorktreePlan } : {}),
      ...(payload.attachments?.length ? { attachments: payload.attachments } : {}),
      roleRoutes,
    });

    return {
      thread: ensureThreadRuntimeConfig(conversationStore.getThread(payload.threadId) ?? updated),
    } satisfies ThreadContinueResult;
  });

  ipcMain.handle(IPC_CHANNELS.threadRetry, async (_event, payload: unknown) => {
    const request = parseThreadRetryRequest(payload);
    return retryThread(request);
  });

  ipcMain.handle(IPC_CHANNELS.threadCancel, async (_event, payload: unknown) => {
    const request = parseThreadCancelRequest(payload);
    if (!request) {
      return;
    }
    const { threadId, worktreeDisposition } = request;
    if (worktreeDisposition) {
      pendingCancelDisposition.set(threadId, worktreeDisposition);
    }
    if (activeRunRuntimeState.abortRun(threadId, "cancelled by user")) {
      updateThread(threadId, { status: "running", message: "正在停止…" });
      cancelClarificationsForThread(threadId, "cancelled by user");
      return;
    }
    const thread = conversationStore.getThread(threadId);
    if (thread?.status === "awaiting_plan") {
      await dismissPendingPlan(threadId, "已取消。");
      return;
    }
    if (thread?.status === "running" || thread?.status === "queued") {
      const pending = conversationStore.getPendingPlan(threadId);
      const workspacePath = pending?.workspacePath ?? thread.workspacePath;
      if (workspacePath) {
        const plan = resolveWorktreePlan(workspacePath, threadId, pending?.worktreePath);
        await handleRunCancelled(threadId, plan);
      } else {
        updateThread(threadId, { status: "idle", message: "已停止。" });
        emitThreadEvent(threadId, "thread.idle", "已停止。", "system");
      }
    }
  });

  ipcMain.handle(IPC_CHANNELS.threadRollbackTo, async (_event, threadId: unknown) => {
    if (typeof threadId !== "string" || !threadId.trim()) {
      throw new Error("Thread id is required.");
    }
    return rollbackWorkspaceToThread(threadId);
  });

  ipcMain.handle(IPC_CHANNELS.threadGetAppliedDiff, async (_event, threadId: unknown) => {
    if (typeof threadId !== "string" || !threadId.trim()) {
      throw new Error("Thread id is required.");
    }
    return getThreadAppliedDiff(threadId);
  });

  ipcMain.handle(IPC_CHANNELS.threadRevertAppliedDiff, async (_event, threadId: unknown) => {
    if (typeof threadId !== "string" || !threadId.trim()) {
      throw new Error("Thread id is required.");
    }
    return revertThreadAppliedDiff(threadId);
  });

  ipcMain.handle(IPC_CHANNELS.modelProfilesList, async () => providerStore.getSettings().providers);

  ipcMain.on("message", (event) => {
    if (!isKnownIpcChannel(event.type)) {
      event.preventDefault();
    }
  });
}

async function ensureWorkspace(workspacePath: string): Promise<WorkspaceInfo> {
  const resolvedPath = path.resolve(workspacePath);
  if (currentWorkspace?.path === resolvedPath) {
    return currentWorkspace;
  }

  const workspace = await inspectWorkspace(resolvedPath);
  currentWorkspace = workspace;
  return workspace;
}

interface ThreadWorktreeResolution {
  worktreePlan: WorktreePlan;
  cwd: string;
  isolated: boolean;
}

async function resolveThreadWorktree(
  workspace: WorkspaceInfo,
  threadId: string,
  existingWorktreePlan?: WorktreePlan,
): Promise<ThreadWorktreeResolution> {
  const worktreePlan = existingWorktreePlan ?? createSessionPlan(workspace.path, threadId);
  return { worktreePlan, cwd: workspace.path, isolated: false };
}

function isIsolatedWorktreePlan(_plan: Pick<WorktreePlan, "workspacePath" | "worktreePath">): boolean {
  return false;
}

function normalizeSessionCwd(workspacePath: string, sessionCwd?: string): string {
  const workspace = path.resolve(workspacePath);
  const cwd = sessionCwd?.trim();
  if (!cwd) {
    return workspace;
  }
  if (path.resolve(cwd) === workspace) {
    return workspace;
  }
  if (cwd.includes(`${path.sep}.eco${path.sep}worktrees${path.sep}`)) {
    return workspace;
  }
  return cwd;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function applyThreadTitleSummary(threadId: string, title: string | undefined): void {
  if (!title) {
    return;
  }
  const thread = conversationStore.getThread(threadId);
  if (!thread || thread.title === title || !shouldReplaceAutoThreadTitle(thread.title)) {
    return;
  }

  conversationStore.updateThreadTitle(threadId, title);
  emitThreadEvent(threadId, "thread.title_updated", "标题已更新", "system", false, { title });
}

function scheduleThreadTitleSummary(
  threadId: string,
  runtimeConfig: RuntimeConfig,
  context?: { plan?: string; analysis?: string },
): void {
  const thread = conversationStore.getThread(threadId);
  if (!thread || !shouldReplaceAutoThreadTitle(thread.title)) {
    return;
  }

  const prompt = thread.prompt;
  const planText = context?.plan?.trim();
  if (planText) {
    applyThreadTitleSummary(threadId, threadTitleFromPlannerPlan(planText, prompt));
    return;
  }

  void summarizeThreadTitle(runtimeConfig.routes, prompt, fetch, context)
    .then((title) => {
      applyThreadTitleSummary(threadId, title);
    })
    .catch((error) => {
      process.stderr.write(`[eco] title summary failed: ${errorMessage(error)}\n`);
    });
}

const THREAD_INTERRUPTED_CONTINUE_HINT =
  "可在下方继续对话、切换模型后重试，或点击「重试此次请求」。";

function markThreadInterrupted(threadId: string, reason: string): void {
  const summary = formatUserFacingRequestError(reason);
  const truncated = summary.length > 240 ? `${summary.slice(0, 237)}…` : summary;
  process.stderr.write(`[eco] thread blocked (${threadId}): ${truncated}\n`);
  updateThread(threadId, {
    status: "blocked",
    message: `${truncated} ${THREAD_INTERRUPTED_CONTINUE_HINT}`,
  });
  emitThreadEvent(threadId, "thread.blocked", truncated, "system");
}

function clearSdkSessionAfterResumeFailure(threadId: string, hadResume: boolean): void {
  if (!hadResume) {
    return;
  }
  conversationStore.clearSdkSession(threadId);
  emitThreadEvent(
    threadId,
    "thread.session_cleared",
    "原 session 无法接续，已改用对话摘要续聊。",
    "system",
  );
}

function threadHasResumableCheckpoint(
  thread: ThreadSummary,
  activityLines: readonly ThreadActivityLine[],
): boolean {
  if (conversationStore.getSdkSession(thread.id)?.sessionId) {
    return true;
  }
  if (thread.status === "idle" || thread.status === "blocked" || thread.status === "failed") {
    return activityLines.some((line) => line.role !== "tool");
  }
  return activityLines.some(
    (line) =>
      line.role === "system" &&
      (line.message.includes("已停止") ||
        line.message.includes("检查点") ||
        line.message.includes("自动重试") ||
        line.message.includes("上游不可用")),
  );
}

function runThreadRequestWithAutoRetry(
  threadId: string,
  phase: RunAttemptPhase,
  signal: AbortSignal | undefined,
  runOnce: () => Promise<RequestAttemptResult>,
): Promise<RequestAttemptResult> {
  let retryIndex = 0;
  const wrappedRunOnce = async (): Promise<RequestAttemptResult> => {
    const attempt = agentLifecycle.startRunAttempt({ threadId, phase, retryIndex });
    try {
      const result = await runOnce();
      const status = runAttemptStatusFromResult(result);
      usageLedgerCoordinator.queueInterruptedStreamSettlement(threadId, attempt.attemptId, status);
      agentLifecycle.finishRunAttempt(threadId, status);
      return result;
    } catch (error) {
      const status = signal?.aborted ? "cancelled" : "failed";
      usageLedgerCoordinator.queueInterruptedStreamSettlement(threadId, attempt.attemptId, status);
      agentLifecycle.finishRunAttempt(threadId, status);
      throw error;
    } finally {
      retryIndex += 1;
    }
  };
  return runWithRequestAutoRetry(wrappedRunOnce, {
    ...(signal && { signal }),
    onRetryScheduled: (retryIndex, maxRetries, reason) => {
      const short = reason.length > 240 ? `${reason.slice(0, 237)}…` : reason;
      const message = `【自动重试 ${retryIndex}/${maxRetries}】${short}`;
      emitThreadEvent(threadId, "thread.auto_retry", message, "system");
      updateThread(threadId, { status: "running", message });
    },
  });
}

function runAttemptStatusFromResult(result: RequestAttemptResult): Exclude<RunAttemptStatus, "running"> {
  if (result.ok) {
    return "completed";
  }
  return result.aborted ? "cancelled" : "failed";
}

function isRequestAttemptAborted(result: RequestAttemptResult): boolean {
  return !result.ok && result.aborted === true;
}

function runAttemptPhaseFromThreadMode(
  mode: "planning" | "execution" | "question",
): RunAttemptPhase {
  return mode;
}

async function runQuestionThread(
  thread: ThreadSummary,
  workspace: WorkspaceInfo,
  runtimeConfig: RuntimeConfig,
  prompt: string,
  worktreePath?: string,
  resume?: EcoSdkResumeOptions,
  attachments?: PromptImageAttachment[],
  routesOverride?: readonly RoleRouteConfig[],
): Promise<void> {
  const controller = new AbortController();
  const cwd = worktreePath?.trim() || workspace.path;
  startActiveRun(thread.id, { controller, worktreePlan: createSessionPlan(workspace.path, thread.id) });
  resetSubagentContextWindows(thread.id);

  try {
    const outcome = await runThreadRequestWithAutoRetry(thread.id, "question", controller.signal, async () => {
      const freshConfig = resolveRuntimeConfigFresh(routesOverride);
      if (!freshConfig.ok) {
        return { ok: false, reason: freshConfig.reason };
      }
      recordThreadRouteFingerprint(thread.id, freshConfig.routes);
      const attemptProxy = await startRuntimeProxy(freshConfig.routes, attachments, thread.id);
      process.stderr.write(
        `[eco] 模型代理: ${attemptProxy.baseUrl} · 上游日志: ${getUpstreamLogFilePath()}\n`,
      );
      updateThread(thread.id, {
        status: "running",
        message: `Local model router ready: ${attemptProxy.baseUrl}`,
      });
      const routes = buildDriverRoutes(attemptProxy.routes);
      const effectiveResume = resume ?? resolveResumeOptions(thread.id, cwd);
      if (effectiveResume) {
        await ensureContextHeadroom(thread.id, cwd, controller.signal, { ignoreRunningGuard: true });
      }
      try {
        const driver = createSdkDriver(thread.id, attemptProxy, undefined, "question");
        if (!driver.runQuestion) {
          throw new Error("Runtime driver does not support question answering.");
        }

        let sdkFailure: string | undefined;
        for await (const event of driver.runQuestion({
          threadId: thread.id,
          prompt,
          workspacePath: workspace.path,
          worktreePath: cwd,
          routes,
          signal: controller.signal,
          sdkSession: await buildSdkSessionOptions(thread.id, prompt),
          ...(effectiveResume ? { resume: effectiveResume } : {}),
        })) {
          if (event.type === "usage.recorded") {
            sdkFailure = extractSdkRunFailure(event.payload) ?? sdkFailure;
            onSdkUsageRecordedEvent(thread.id, event);
            continue;
          }
          captureSdkSessionFromEvent(thread.id, event, cwd);
          emitSdkStreamActivity(thread.id, event);
        }

        if (controller.signal.aborted) {
          return { ok: false, reason: "cancelled by user", aborted: true };
        }
        if (sdkFailure) {
          return { ok: false, reason: sdkFailure };
        }
        return { ok: true };
      } catch (error) {
        if (controller.signal.aborted) {
          return { ok: false, reason: "cancelled by user", aborted: true };
        }
        return { ok: false, reason: errorMessage(error) };
      } finally {
        await attemptProxy.close();
      }
    });

    if (isRequestAttemptAborted(outcome)) {
      cancelClarificationsForThread(thread.id, "cancelled by user");
      const plan = resolveWorktreePlan(workspace.path, thread.id, cwd);
      await handleRunCancelled(thread.id, plan);
      return;
    }
    if (!outcome.ok) {
      markThreadInterrupted(thread.id, outcome.reason);
      return;
    }

    updateThread(thread.id, { status: "completed", message: "回答完成。" });
    scheduleThreadTitleSummary(thread.id, runtimeConfig);
  } catch (error) {
    cancelClarificationsForThread(thread.id, errorMessage(error));
    markThreadInterrupted(thread.id, errorMessage(error));
  } finally {
    const worktreePath = resolveThreadWorktreePath(thread.id);
    cancelClarificationsForThread(thread.id, "run finished");
    sdkStreamBridge.resetThread(thread.id);
    await usageLedgerCoordinator.flushUsageUpdates(thread.id);
    finishActiveRun(thread.id);
    afterRunContextRefresh(thread.id, worktreePath);
    const currentThread = conversationStore.getThread(thread.id);
    if (currentThread?.status === "running") {
      updateThread(thread.id, {
        status: "idle",
        message: currentThread.message || "回答已结束。",
      });
    }
  }
}


async function completeCodingThreadRun(threadId: string, worktreePlan: WorktreePlan): Promise<void> {
  updateThread(threadId, { status: "completed", message: "执行完成，变更已写入项目目录。" });
  emitThreadEvent(threadId, "thread.completed", "执行完成。", "system");
  try {
    const { files, diff } = await gitWorktrees.collectWorktreeChanges(worktreePlan);
    if (files.length > 0) {
      conversationStore.saveAppliedDiff(threadId, worktreePlan.workspacePath, diff, files);
      const summary = buildWorktreeMergeSummary(diff, files);
      emitThreadEvent(threadId, "workspace.changes", serializeWorktreeMergeMessage(summary), "system");
    }
  } catch (error) {
    process.stderr.write(
      `[eco] workspace diff snapshot failed: ${errorMessage(error)}\n`,
    );
  }
}

async function runCodingThreadAutonomous(
  thread: ThreadSummary,
  workspace: WorkspaceInfo,
  runtimeConfig: RuntimeConfig,
  prompt: string,
  existingWorktreePlan?: WorktreePlan,
  resume?: EcoSdkResumeOptions,
  attachments?: PromptImageAttachment[],
  routesOverride?: readonly RoleRouteConfig[],
): Promise<void> {
  const controller = new AbortController();
  startActiveRun(thread.id, {
    controller,
    worktreePlan: existingWorktreePlan ?? createSessionPlan(workspace.path, thread.id),
  });
  resetSubagentContextWindows(thread.id);

  let worktreePlan = existingWorktreePlan ?? createSessionPlan(workspace.path, thread.id);

  try {
    const { worktreePlan: resolvedPlan, cwd, isolated } = await resolveThreadWorktree(
      workspace,
      thread.id,
      existingWorktreePlan,
    );
    worktreePlan = resolvedPlan;
    activeRunRuntimeState.setWorktreePlan(thread.id, worktreePlan);
    updateThread(thread.id, {
      message: `Working in project directory: ${workspace.path}`,
      status: "running",
    });

    const resumeOptsForRun = resume ?? resolveResumeOptions(thread.id, cwd);

    const runOutcome = await runThreadRequestWithAutoRetry(thread.id, "execution", controller.signal, async () => {
      const freshConfig = resolveRuntimeConfigFresh(routesOverride);
      if (!freshConfig.ok) {
        return { ok: false, reason: freshConfig.reason };
      }
      recordThreadRouteFingerprint(thread.id, freshConfig.routes);
      const attemptProxy = await startRuntimeProxy(freshConfig.routes, attachments, thread.id);
      process.stderr.write(
        `[eco] 模型代理: ${attemptProxy.baseUrl} · 上游日志: ${getUpstreamLogFilePath()}\n`,
      );
      updateThread(thread.id, {
        message: `Local model router ready: ${attemptProxy.baseUrl}`,
        status: "running",
      });
      const routes = buildDriverRoutes(attemptProxy.routes);
      const plannerRoute = attemptProxy.routes.find((route) => route.role === "planner");
      process.stderr.write(
        `[eco] SDK model=${plannerRoute?.modelId ?? "?"} (direct / claude_code preset)\n`,
      );

      const effectiveResume = resumeOptsForRun;
      if (effectiveResume) {
        await ensureContextHeadroom(thread.id, cwd, controller.signal, { ignoreRunningGuard: true });
      }

      try {
        const driver = createSdkDriver(thread.id, attemptProxy, undefined, "execution");
        let sdkFailure: string | undefined;

        let planCaptured = false;
        for await (const event of driver.run({
          threadId: thread.id,
          prompt,
          workspacePath: workspace.path,
          worktreePath: cwd,
          routes,
          signal: controller.signal,
          sdkSession: await buildSdkSessionOptions(thread.id, prompt),
          ...(effectiveResume ? { resume: effectiveResume } : {}),
        })) {
          if (event.type === "usage.recorded") {
            sdkFailure = extractSdkRunFailure(event.payload) ?? sdkFailure;
            onSdkUsageRecordedEvent(thread.id, event);
            continue;
          }
          captureSdkSessionFromEvent(thread.id, event, cwd);
          if (event.type === "plan.ready" && isPlanReadyPayload(event.payload)) {
            planCaptured = true;
            conversationStore.savePendingPlan({
              threadId: thread.id,
              userPrompt: event.payload.userPrompt,
              analysis: event.payload.analysis,
              plan: event.payload.plan,
              workspacePath: workspace.path,
              worktreePath: cwd,
              routesJson: JSON.stringify(routes),
            });
            emitThreadEvent(
              thread.id,
              "thread.awaiting_plan",
              "Agent 请求确认计划，请审批后继续。",
              "planner",
              false,
              {
                plan: {
                  userPrompt: event.payload.userPrompt,
                  analysis: event.payload.analysis,
                  plan: event.payload.plan,
                },
              },
            );
            scheduleThreadTitleSummary(thread.id, runtimeConfig, {
              plan: event.payload.plan,
              analysis: event.payload.analysis,
            });
          }
          emitSdkStreamActivity(thread.id, event);
        }

        if (controller.signal.aborted) {
          return { ok: false, reason: "cancelled by user", aborted: true };
        }
        if (sdkFailure) {
          return { ok: false, reason: sdkFailure };
        }
        return { ok: true, planCaptured };
      } catch (error) {
        if (controller.signal.aborted) {
          return { ok: false, reason: "cancelled by user", aborted: true };
        }
        return { ok: false, reason: errorMessage(error) };
      } finally {
        await attemptProxy.close();
      }
    });

    if (isRequestAttemptAborted(runOutcome)) {
      cancelClarificationsForThread(thread.id, "cancelled by user");
      await handleRunCancelled(thread.id, worktreePlan);
      return;
    }
    if (!runOutcome.ok) {
      cancelClarificationsForThread(thread.id, runOutcome.reason);
      clearSdkSessionAfterResumeFailure(thread.id, Boolean(resumeOptsForRun));
      markThreadInterrupted(thread.id, runOutcome.reason);
      return;
    }

    if (
      conversationStore.getPendingPlan(thread.id) ||
      (runOutcome.ok && "planCaptured" in runOutcome && runOutcome.planCaptured === true)
    ) {
      updateThread(thread.id, {
        status: "awaiting_plan",
        message: "等待你确认计划。",
      });
      return;
    }

    await completeCodingThreadRun(thread.id, worktreePlan);
    scheduleThreadTitleSummary(thread.id, runtimeConfig);
  } catch (error) {
    cancelClarificationsForThread(thread.id, errorMessage(error));
    markThreadInterrupted(thread.id, errorMessage(error));
  } finally {
    const worktreePath = resolveThreadWorktreePath(thread.id);
    cancelClarificationsForThread(thread.id, "run finished");
    sdkStreamBridge.resetThread(thread.id);
    await usageLedgerCoordinator.flushUsageUpdates(thread.id);
    finishActiveRun(thread.id);
    afterRunContextRefresh(thread.id, worktreePath);
    const currentThread = conversationStore.getThread(thread.id);
    if (currentThread?.status === "running") {
      updateThread(thread.id, {
        status: "idle",
        message: currentThread.message || "运行已结束。",
      });
    }
  }
}

async function runCodingThreadPlanning(
  thread: ThreadSummary,
  workspace: WorkspaceInfo,
  runtimeConfig: RuntimeConfig,
  prompt: string,
  existingWorktreePlan?: WorktreePlan,
  resume?: EcoSdkResumeOptions,
  attachments?: PromptImageAttachment[],
  routesOverride?: readonly RoleRouteConfig[],
): Promise<void> {
  const controller = new AbortController();
  startActiveRun(thread.id, {
    controller,
    worktreePlan: existingWorktreePlan ?? createSessionPlan(workspace.path, thread.id),
  });
  resetSubagentContextWindows(thread.id);

  try {
    const { worktreePlan, cwd, isolated } = await resolveThreadWorktree(
      workspace,
      thread.id,
      existingWorktreePlan,
    );
    activeRunRuntimeState.setWorktreePlan(thread.id, worktreePlan);
    updateThread(thread.id, {
      message: `Working in project directory: ${workspace.path}`,
      status: "running",
    });

    const resumeOptsForRun = resume ?? resolveResumeOptions(thread.id, cwd);

    const planningOutcome = await runThreadRequestWithAutoRetry(thread.id, "planning", controller.signal, async () => {
      const freshConfig = resolveRuntimeConfigFresh(routesOverride);
      if (!freshConfig.ok) {
        return { ok: false, reason: freshConfig.reason };
      }
      recordThreadRouteFingerprint(thread.id, freshConfig.routes);
      const attemptProxy = await startRuntimeProxy(freshConfig.routes, attachments, thread.id);
      process.stderr.write(
        `[eco] 模型代理: ${attemptProxy.baseUrl} · 上游日志: ${getUpstreamLogFilePath()}\n`,
      );
      updateThread(thread.id, {
        message: `Local model router ready: ${attemptProxy.baseUrl}`,
        status: "running",
      });
      const routes = buildDriverRoutes(attemptProxy.routes);
      const plannerRoute = attemptProxy.routes.find((route) => route.role === "planner");
      process.stderr.write(
        `[eco] SDK model=${plannerRoute?.modelId ?? "?"} (proxy ${attemptProxy.baseUrl}, alias ${plannerRoute?.aliasModelId ?? "?"})\n`,
      );

      const effectiveResume = resumeOptsForRun;
      if (effectiveResume) {
        await ensureContextHeadroom(thread.id, cwd, controller.signal, { ignoreRunningGuard: true });
      }

      try {
        const driver = createSdkDriver(thread.id, attemptProxy, undefined, "planning");

        let sdkFailure: string | undefined;
        let captured = false;

        for await (const event of driver.run({
          threadId: thread.id,
          prompt,
          workspacePath: workspace.path,
          worktreePath: cwd,
          routes,
          signal: controller.signal,
          sdkSession: await buildSdkSessionOptions(thread.id, prompt),
          ...(effectiveResume ? { resume: effectiveResume } : {}),
        })) {
          if (event.type === "usage.recorded") {
            sdkFailure = extractSdkRunFailure(event.payload) ?? sdkFailure;
            onSdkUsageRecordedEvent(thread.id, event);
            continue;
          }
          captureSdkSessionFromEvent(thread.id, event, cwd);
          if (event.type === "plan.ready" && isPlanReadyPayload(event.payload)) {
            captured = true;
            conversationStore.savePendingPlan({
              threadId: thread.id,
              userPrompt: event.payload.userPrompt,
              analysis: event.payload.analysis,
              plan: event.payload.plan,
              workspacePath: workspace.path,
              worktreePath: cwd,
              routesJson: JSON.stringify(routes),
            });
            emitThreadEvent(
              thread.id,
              "thread.awaiting_plan",
              "计划已生成，请确认是否执行。",
              "planner",
              false,
              {
                plan: {
                  userPrompt: event.payload.userPrompt,
                  analysis: event.payload.analysis,
                  plan: event.payload.plan,
                },
              },
            );
            scheduleThreadTitleSummary(thread.id, runtimeConfig, {
              plan: event.payload.plan,
              analysis: event.payload.analysis,
            });
          }

          emitSdkStreamActivity(thread.id, event);
        }

        if (controller.signal.aborted) {
          return { ok: false, reason: "cancelled by user", aborted: true };
        }
        if (sdkFailure) {
          return { ok: false, reason: sdkFailure };
        }
        return { ok: true };
      } catch (error) {
        if (controller.signal.aborted) {
          return { ok: false, reason: "cancelled by user", aborted: true };
        }
        return { ok: false, reason: errorMessage(error) };
      } finally {
        await attemptProxy.close();
      }
    });

    if (isRequestAttemptAborted(planningOutcome)) {
      cancelClarificationsForThread(thread.id, "cancelled by user");
      await handleRunCancelled(thread.id, worktreePlan);
      return;
    }
    if (!planningOutcome.ok) {
      cancelClarificationsForThread(thread.id, planningOutcome.reason);
      clearSdkSessionAfterResumeFailure(thread.id, Boolean(resumeOptsForRun));
      markThreadInterrupted(thread.id, planningOutcome.reason);
      return;
    }

    if (conversationStore.getPendingPlan(thread.id)) {
      updateThread(thread.id, {
        status: "awaiting_plan",
        message: "等待你确认计划。",
      });
    } else {
      updateThread(thread.id, {
        status: "idle",
        message: "计划阶段已结束。",
      });
    }
  } catch (error) {
    cancelClarificationsForThread(thread.id, errorMessage(error));
    markThreadInterrupted(thread.id, errorMessage(error));
  } finally {
    const worktreePath = resolveThreadWorktreePath(thread.id);
    cancelClarificationsForThread(thread.id, "run finished");
    sdkStreamBridge.resetThread(thread.id);
    await usageLedgerCoordinator.flushUsageUpdates(thread.id);
    finishActiveRun(thread.id);
    afterRunContextRefresh(thread.id, worktreePath);
    const currentThread = conversationStore.getThread(thread.id);
    if (currentThread?.status === "running") {
      updateThread(thread.id, {
        status: "idle",
        message: currentThread.message || "计划阶段已结束。",
      });
    }
  }
}

async function runCodingThreadAutonomousAfterApproval(
  threadId: string,
  runtimeConfig: RuntimeConfig,
  options?: {
    routesOverride?: readonly RoleRouteConfig[];
  },
): Promise<void> {
  const pending = conversationStore.getPendingPlan(threadId);
  const thread = conversationStore.getThread(threadId);
  if (!pending || !thread) {
    updateThread(threadId, { status: "failed", message: "执行失败：找不到待批准的计划。" });
    return;
  }

  const planning: EcoPlanningContext = {
    userPrompt: pending.userPrompt,
    analysis: pending.analysis,
    plan: pending.plan,
  };

  const workspace = await ensureWorkspace(pending.workspacePath);
  let worktreePlan = resolveWorktreePlan(pending.workspacePath, threadId, pending.worktreePath);
  const controller = new AbortController();
  startActiveRun(threadId, { controller, worktreePlan });
  resetSubagentContextWindows(threadId);

  const resolved = await resolveThreadWorktree(workspace, threadId, worktreePlan);
  worktreePlan = resolved.worktreePlan;
  const cwd = resolved.cwd;
    activeRunRuntimeState.setWorktreePlan(threadId, worktreePlan);

  try {
    await writeApprovedPlanSnapshot(pending.workspacePath, threadId, planning);
  } catch (error) {
    process.stderr.write(
      `[eco] failed to write approved plan snapshot: ${errorMessage(error)}\n`,
    );
  }

  try {
    conversationStore.clearPendingPlan(threadId);
    emitThreadEvent(threadId, "thread.plan_cleared", "计划已批准，继续同会话执行。", "system");

    const outcome = await runThreadRequestWithAutoRetry(threadId, "execution", controller.signal, async () => {
      const freshConfig = resolveRuntimeConfigFresh(options?.routesOverride);
      if (!freshConfig.ok) {
        return { ok: false, reason: freshConfig.reason };
      }
      recordThreadRouteFingerprint(threadId, freshConfig.routes);
      const attemptProxy = await startRuntimeProxy(freshConfig.routes, undefined, threadId);
      const routes = buildDriverRoutes(attemptProxy.routes);
      const resume = resolveResumeOptions(threadId, cwd);
      if (!resume) {
        return { ok: false, reason: "无法恢复 SDK 会话以继续执行。" };
      }
      await ensureContextHeadroom(threadId, cwd, controller.signal, { ignoreRunningGuard: true });
      try {
        const driver = createSdkDriver(threadId, attemptProxy, undefined, "execution");
        let sdkFailure: string | undefined;
        for await (const event of driver.runContinuation(
          {
            threadId,
            prompt: pending.userPrompt,
            workspacePath: pending.workspacePath,
            worktreePath: cwd,
            routes,
            signal: controller.signal,
            sdkSession: await buildSdkSessionOptions(threadId, pending.userPrompt),
            resume,
          },
          "execution",
          planning,
        )) {
          if (event.type === "usage.recorded") {
            sdkFailure = extractSdkRunFailure(event.payload) ?? sdkFailure;
            onSdkUsageRecordedEvent(threadId, event);
            continue;
          }
          captureSdkSessionFromEvent(threadId, event, cwd);
          emitSdkStreamActivity(threadId, event);
        }
        if (controller.signal.aborted) {
          return { ok: false, reason: "cancelled by user", aborted: true };
        }
        if (sdkFailure) {
          return { ok: false, reason: sdkFailure };
        }
        return { ok: true };
      } finally {
        await attemptProxy.close();
      }
    });

    if (isRequestAttemptAborted(outcome)) {
      cancelClarificationsForThread(threadId, "cancelled by user");
      await handleRunCancelled(threadId, worktreePlan);
      return;
    }
    if (!outcome.ok) {
      cancelClarificationsForThread(threadId, outcome.reason);
      markThreadInterrupted(threadId, outcome.reason);
      return;
    }

    await completeCodingThreadRun(threadId, worktreePlan);
    scheduleThreadTitleSummary(threadId, runtimeConfig);
  } catch (error) {
    cancelClarificationsForThread(threadId, errorMessage(error));
    markThreadInterrupted(threadId, errorMessage(error));
  } finally {
    cancelClarificationsForThread(threadId, "run finished");
    sdkStreamBridge.resetThread(threadId);
    await usageLedgerCoordinator.flushUsageUpdates(threadId);
    finishActiveRun(threadId);
    afterRunContextRefresh(threadId, cwd);
  }
}

async function runCodingThreadExecution(
  threadId: string,
  runtimeConfig: RuntimeConfig,
  options?: {
    planUserEdited?: boolean;
    routesOverride?: readonly RoleRouteConfig[];
    followUp?: string;
    attachments?: PromptImageAttachment[];
  },
): Promise<void> {
  const pending = conversationStore.getPendingPlan(threadId);
  const thread = conversationStore.getThread(threadId);
  if (!pending || !thread) {
    updateThread(threadId, { status: "failed", message: "执行失败：找不到待批准的计划。" });
    return;
  }

  const planning: EcoPlanningContext = {
    userPrompt: pending.userPrompt,
    analysis: pending.analysis,
    plan: pending.plan,
    ...(options?.planUserEdited ? { planUserEdited: true } : {}),
  };

  let worktreePlan = resolveWorktreePlan(pending.workspacePath, threadId, pending.worktreePath);
  const controller = new AbortController();
  startActiveRun(threadId, { controller, worktreePlan });
  resetSubagentContextWindows(threadId);

  const workspace = await ensureWorkspace(pending.workspacePath);
  const resolved = await resolveThreadWorktree(workspace, threadId, worktreePlan);
  worktreePlan = resolved.worktreePlan;
  const executionCwd = resolved.cwd;
    activeRunRuntimeState.setWorktreePlan(threadId, worktreePlan);

  try {
    await writeApprovedPlanSnapshot(pending.workspacePath, threadId, planning);
  } catch (error) {
    process.stderr.write(
      `[eco] failed to write approved plan snapshot: ${errorMessage(error)}\n`,
    );
  }

  const stopStatusRef = { current: "completed" as "completed" | "blocked" | "cancelled" };
  let stopTodosHandled = false;

  const todoTracker = createSdkTaskTracker(threadId, {
    listTodos: () => conversationStore.listCoderTodos(threadId),
    replaceTodos: (todos) => conversationStore.replaceCoderTodos(threadId, todos),
  }, emitTodoList);
  const taskHookHandlers = todoTracker.createHookHandlers(() => stopStatusRef.current);
  const executionPlan = {
    ...pending,
    routesJson: pending.routesJson || "[]",
  };

  try {
    conversationStore.clearPendingPlan(threadId);
    emitThreadEvent(threadId, "thread.plan_cleared", "计划已进入执行阶段。", "system");

    const executionOutcome = await runThreadRequestWithAutoRetry(threadId, "execution", controller.signal, async () => {
      const freshConfig = resolveRuntimeConfigFresh(options?.routesOverride);
      if (!freshConfig.ok) {
        return { ok: false, reason: freshConfig.reason };
      }
      recordThreadRouteFingerprint(threadId, freshConfig.routes);
      const attemptProxy = await startRuntimeProxy(
        freshConfig.routes,
        options?.attachments,
        threadId,
      );
      const attemptRoutes = buildDriverRoutes(attemptProxy.routes);
      executionPlan.routesJson = JSON.stringify(attemptRoutes);
      try {
        const driver = createSdkDriver(
          threadId,
          attemptProxy,
          {
            peekPendingCoderTodoId: taskHookHandlers.peekPendingCoderTodoId,
            taskTracker: {
              ...taskHookHandlers,
              onStop(status) {
                stopTodosHandled = true;
                taskHookHandlers.onStop(status);
              },
            },
            getStopTodoStatus: () => stopStatusRef.current,
          },
          "execution",
        );

        if (!driver.runExecution) {
          throw new Error("Runtime driver does not support execution phase.");
        }

        let sdkFailure: string | undefined;
        const resume = resolveResumeOptions(threadId, executionCwd);
        if (resume) {
          await ensureContextHeadroom(threadId, executionCwd, controller.signal, {
            ignoreRunningGuard: true,
          });
        }
        const followUp = options?.followUp?.trim();
        const runPrompt = followUp || pending.userPrompt;
        let executionPromptOverride: string | undefined;
        if (!resume && followUp && followUp !== pending.userPrompt.trim()) {
          const activityLines = conversationStore.listActivityLines(threadId);
          executionPromptOverride = buildAgentPromptWithContext(
            thread.prompt,
            followUp,
            activityLines,
          );
        }
        for await (const event of driver.runExecution(
          {
            threadId,
            prompt: runPrompt,
            workspacePath: pending.workspacePath,
            worktreePath: executionCwd,
            routes: attemptRoutes,
            signal: controller.signal,
            sdkSession: await buildSdkSessionOptions(threadId, runPrompt),
            ...(resume ? { resume } : {}),
            resumableSubagents: listResumableSubagentRefs(threadId, "execution"),
            ...(executionPromptOverride && { executionPromptOverride }),
          },
          planning,
        )) {
          if (event.type === "usage.recorded") {
            sdkFailure = extractSdkRunFailure(event.payload) ?? sdkFailure;
            onSdkUsageRecordedEvent(threadId, event);
            continue;
          }

          captureSdkSessionFromEvent(threadId, event, executionCwd);

          if (event.type === "todo.updated" && isSdkTodoProgressPayload(event.payload)) {
            todoTracker.handleTaskProgress(event.payload);
          }

          emitSdkStreamActivity(threadId, event);
        }

        if (controller.signal.aborted) {
          return { ok: false, reason: "cancelled by user", aborted: true };
        }
        if (sdkFailure) {
          return { ok: false, reason: sdkFailure };
        }
        return { ok: true };
      } catch (error) {
        if (controller.signal.aborted) {
          return { ok: false, reason: "cancelled by user", aborted: true };
        }
        return { ok: false, reason: errorMessage(error) };
      } finally {
        await attemptProxy.close();
      }
    });

    if (isRequestAttemptAborted(executionOutcome)) {
      stopStatusRef.current = "cancelled";
      if (!stopTodosHandled) {
        taskHookHandlers.onStop("cancelled");
      }
      cancelClarificationsForThread(threadId, "cancelled by user");
      await handleRunCancelled(threadId, worktreePlan);
      return;
    }

    if (!executionOutcome.ok) {
      stopStatusRef.current = "blocked";
      if (!stopTodosHandled) {
        taskHookHandlers.onStop("blocked");
      }
      await restoreAfterExecutionFailure(threadId, worktreePlan, executionOutcome.reason, executionPlan);
      return;
    }

    if (!stopTodosHandled) {
      taskHookHandlers.onStop("completed");
    }

    await completeCodingThreadRun(threadId, worktreePlan);
  } catch (error) {
    stopStatusRef.current = "blocked";
    if (!stopTodosHandled) {
      taskHookHandlers.onStop("blocked");
    }
    await restoreAfterExecutionFailure(threadId, worktreePlan, errorMessage(error), executionPlan);
  } finally {
    sdkStreamBridge.resetThread(threadId);
    await usageLedgerCoordinator.flushUsageUpdates(threadId);
    finishActiveRun(threadId);
    afterRunContextRefresh(threadId, worktreePlan.worktreePath);
    const thread = conversationStore.getThread(threadId);
    if (thread?.status === "running") {
      updateThread(threadId, {
        status: "idle",
        message: thread.message || "执行已结束。",
      });
    }
  }
}

function parseThreadRetryRequest(payload: unknown): ThreadRetryRequest {
  if (typeof payload === "string" && payload.trim()) {
    return { threadId: payload.trim() };
  }
  if (typeof payload === "object" && payload !== null && "threadId" in payload) {
    const raw = payload as ThreadRetryRequest;
    if (typeof raw.threadId === "string" && raw.threadId.trim()) {
      return {
        threadId: raw.threadId.trim(),
        ...(typeof raw.routeProfileId === "string" && raw.routeProfileId.trim()
          ? { routeProfileId: raw.routeProfileId.trim() }
          : {}),
      };
    }
  }
  throw new Error("Thread id is required.");
}

function roleRoutesFromRuntime(routes: readonly RuntimeRoute[]): RoleRouteConfig[] {
  return routes.map((route) => ({
    role: route.role,
    providerId: route.provider.id,
    modelId: route.modelId,
    apiCompat: route.apiCompat,
  }));
}

function noteSdkSessionRouteChange(
  threadId: string,
  roleRoutes: readonly RoleRouteConfig[],
): void {
  const stored = conversationStore.getRouteFingerprint(threadId);
  if (stored && !routesMatchFingerprint(roleRoutes, stored)) {
    emitThreadEvent(
      threadId,
      "thread.route_changed",
      "模型路由已变更，将尝试接续原 session；若失败会自动改用对话摘要。",
      "system",
    );
  }
}

function recordThreadRouteFingerprint(threadId: string, routes: readonly RuntimeRoute[]): void {
  conversationStore.saveRouteFingerprint(
    threadId,
    computeRouteFingerprint(roleRoutesFromRuntime(routes)),
  );
}

function resolveRuntimeConfigFresh(
  routesOverride?: readonly RoleRouteConfig[],
): RuntimeConfigResolution {
  return resolveRuntimeConfig(
    providerStore.getSettings(),
    providerStore.listProvidersWithSecrets(),
    routesOverride,
  );
}

async function retryThread(request: ThreadRetryRequest): Promise<ThreadRetryResult> {
  const threadId = request.threadId;
  const thread = conversationStore.getThread(threadId);
  if (!thread) {
    throw new Error("Thread was not found.");
  }
  if (activeRunRuntimeState.hasRun(threadId)) {
    throw new Error("请等待当前运行结束后再重试。");
  }
  if (thread.status === "running" || thread.status === "queued") {
    throw new Error("对话正在运行中。");
  }

  const settings = providerStore.getSettings();
  const routesOverride = resolveRoleRoutesForThread(threadId, request.routeProfileId);

  noteSdkSessionRouteChange(threadId, routesOverride);

  const runtimeConfig = resolveRuntimeConfigFresh(routesOverride);
  if (!runtimeConfig.ok) {
    throw new Error(runtimeConfig.reason);
  }

  const pending = conversationStore.getPendingPlan(threadId);
  const prompt = thread.prompt.trim();
  if (!prompt) {
    throw new Error("没有可重试的需求内容。");
  }

  const retryLabel = request.routeProfileId
    ? settings.routeProfiles.find((profile) => profile.id === request.routeProfileId)?.name ??
      "备用路由"
    : undefined;

  if (thread.status === "awaiting_plan" && pending) {
    updateThread(threadId, { status: "running", message: "正在重试执行…" });
    emitThreadEvent(
      threadId,
      "thread.retry",
      retryLabel ? `正在使用「${retryLabel}」重试执行计划…` : "正在重试执行计划…",
      "system",
    );
    void runCodingThreadExecution(
      threadId,
      runtimeConfig,
      routesOverride ? { routesOverride } : undefined,
    );
    return { thread: conversationStore.getThread(threadId) ?? thread };
  }

  if (thread.status !== "failed" && thread.status !== "blocked") {
    throw new Error("当前状态不支持重试，请发送新消息继续。");
  }

  const workspace = await ensureWorkspace(thread.workspacePath);
  const intent = classifyThreadIntent(prompt);
  const activityLines = conversationStore.listActivityLines(threadId);
  conversationStore.clearCoderTodos(threadId);
  const runningMessage = intent === "question" ? "正在重试回答…" : "正在重试分析并制定计划…";
  updateThread(threadId, {
    status: "running",
    message: runningMessage,
  });
  emitThreadEvent(
    threadId,
    "thread.retry",
    retryLabel ? `正在使用「${retryLabel}」${runningMessage}` : runningMessage,
    "system",
  );
  emitTodoList(threadId, []);

  const updated: ThreadSummary = {
    ...thread,
    status: "running",
    message: runningMessage,
  };
  const sdkSession = conversationStore.getSdkSession(threadId);
  const cwd = normalizeSessionCwd(workspace.path, sdkSession?.cwd);
  const existingWorktreePlan = createSessionPlan(workspace.path, threadId);
  const resume = resolveResumeOptions(threadId, cwd);
  const agentPrompt = resume
    ? prompt
    : buildAgentPromptWithContext(prompt, "请继续完成未完成的任务。", activityLines);
  if (intent === "question") {
    void runQuestionThread(
      updated,
      workspace,
      runtimeConfig,
      agentPrompt,
      cwd !== workspace.path ? cwd : undefined,
      resume,
      undefined,
      routesOverride,
    );
  } else if (threadUsesManualOrchestration(threadId)) {
    void runCodingThreadPlanning(
      updated,
      workspace,
      runtimeConfig,
      agentPrompt,
      existingWorktreePlan,
      resume,
      undefined,
      routesOverride,
    );
  } else {
    void runCodingThreadAutonomous(
      updated,
      workspace,
      runtimeConfig,
      agentPrompt,
      existingWorktreePlan,
      resume,
      undefined,
      routesOverride,
    );
  }
  return { thread: ensureThreadRuntimeConfig(conversationStore.getThread(threadId) ?? updated) };
}

/** After a crash, SQLite may still say running while no runtime run is active. */
function recoverOrphanedRunningThreads(): void {
  for (const thread of conversationStore.listThreads()) {
    if (!activeRunRuntimeState.hasRun(thread.id)) {
      settleRecoveredLifecycleRecords(thread.id, "failed");
    }
    if (thread.status !== "running" && thread.status !== "queued") {
      continue;
    }
    if (activeRunRuntimeState.hasRun(thread.id)) {
      continue;
    }
    updateThread(thread.id, {
      status: "idle",
      message: "应用已意外退出。可在本对话继续发送消息。",
    });
    emitThreadEvent(thread.id, "thread.idle", "已从异常退出恢复。", "system");
  }
}

function settleRecoveredLifecycleRecords(
  threadId: string,
  runStatus: Exclude<RunAttemptStatus, "running">,
): void {
  const result = agentLifecycle.settleRecoveredThread({
    threadId,
    attempts: conversationStore.listRunAttempts(threadId),
    agents: conversationStore.listAgentInstances(threadId),
    runStatus,
  });
  if (result.runAttemptsSettled === 0 && result.agentInstancesSettled === 0) {
    return;
  }
  for (const runAttemptId of result.settledRunAttemptIds) {
    if (runStatus === "failed" || runStatus === "cancelled") {
      usageLedgerCoordinator.settleInterruptedStreamPartials(threadId, runAttemptId, runStatus);
    }
  }
  logEcoDiag("agent_lifecycle.recovered", {
    threadId: shortThreadId(threadId),
    runStatus,
    runAttemptsSettled: result.runAttemptsSettled,
    agentInstancesSettled: result.agentInstancesSettled,
  });
}

async function restoreAfterExecutionFailure(
  threadId: string,
  worktreePlan: WorktreePlan,
  reason: string,
  pendingPlan?: ThreadPendingPlan & { routesJson: string },
): Promise<void> {
  try {
    await gitWorktrees.discardWorktreeChanges(worktreePlan);
    emitThreadEvent(threadId, "worktree.restored", "已回退隔离工作树中的未批准更改。", "system");
  } catch (error) {
    console.error("Failed to restore worktree after execution failure:", error);
  }

  if (pendingPlan) {
    conversationStore.savePendingPlan(pendingPlan);
  }

  const formattedReason = formatUserFacingRequestError(reason);
  const summary =
    formattedReason.length > 240 ? `${formattedReason.slice(0, 237)}…` : formattedReason;
  const failureMessage = buildPlanExecutionFailureMessage(summary);
  updateThread(threadId, {
    status: "awaiting_plan",
    message: failureMessage,
  });
  emitThreadEvent(threadId, "thread.execution_failed", summary, "system", false, {
    ...(pendingPlan && {
      plan: {
        userPrompt: pendingPlan.userPrompt,
        analysis: pendingPlan.analysis,
        plan: pendingPlan.plan,
      },
    }),
  });
}

async function dismissPendingPlan(threadId: string, message: string): Promise<void> {
  activeRunRuntimeState.abortRun(threadId, "dismissed by user");
  const pending = conversationStore.getPendingPlan(threadId);
  const thread = conversationStore.getThread(threadId);
  const workspacePath = pending?.workspacePath ?? thread?.workspacePath;
  const worktreePath = pending?.worktreePath;
  conversationStore.clearPendingPlan(threadId);
  if (workspacePath) {
    const plan = resolveWorktreePlan(workspacePath, threadId, worktreePath);
    if (isIsolatedWorktreePlan(plan)) {
      await handleRunCancelled(threadId, plan);
      return;
    }
  }
  updateThread(threadId, { status: "idle", message });
  emitThreadEvent(threadId, "thread.idle", message, "system");
}

function resolveWorktreePlan(workspacePath: string, threadId: string, _worktreePath?: string): WorktreePlan {
  return createSessionPlan(workspacePath, threadId);
}

function resolveWorktreeContextForThread(threadId: string): {
  workspacePath?: string;
  worktreePathHint?: string;
} {
  const thread = conversationStore.getThread(threadId);
  const pending = conversationStore.getPendingPlan(threadId);
  const workspacePath = pending?.workspacePath ?? thread?.workspacePath;
  if (!workspacePath) {
    return {};
  }
  const hintInput: Parameters<typeof resolveWorktreePathHint>[0] = {
    threadId,
    workspacePath,
  };
  const activePath = activeRunRuntimeState.worktreePlan(threadId)?.worktreePath;
  if (activePath?.trim()) {
    hintInput.activeWorktreePath = activePath.trim();
  }
  if (pending?.worktreePath?.trim()) {
    hintInput.pendingWorktreePath = pending.worktreePath.trim();
  }
  const sessionCwd = conversationStore.getSdkSession(threadId)?.cwd;
  if (sessionCwd?.trim()) {
    hintInput.sdkSessionCwd = sessionCwd.trim();
  }
  return {
    workspacePath,
    worktreePathHint: resolveWorktreePathHint(hintInput),
  };
}

async function rewindThreadToCheckpoint(payload: unknown): Promise<ThreadRewindCheckpointResult> {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid rewind request.");
  }
  const record = payload as ThreadRewindCheckpointRequest;
  const threadId = typeof record.threadId === "string" ? record.threadId.trim() : "";
  const userMessageId =
    typeof record.userMessageId === "string" ? record.userMessageId.trim() : "";
  if (!threadId || !userMessageId) {
    throw new Error("threadId and userMessageId are required.");
  }
  const thread = conversationStore.getThread(threadId);
  if (!thread?.workspacePath) {
    throw new Error("找不到该对话的工作区。");
  }
  const resume = resolveResumeOptions(threadId, thread.workspacePath);
  if (!resume?.resumeSessionId) {
    throw new Error("没有可恢复的 SDK 会话，无法回滚文件。");
  }
  await withThreadSdkDriver(threadId, async (driver) => {
    const routes = resolveRuntimeConfigFresh();
    if (!routes.ok) {
      throw new Error(routes.reason);
    }
    const proxy = await startRuntimeProxy(routes.routes, undefined, threadId);
    try {
      const built = buildDriverRoutes(proxy.routes);
      await driver.rewindSessionFiles(
        {
          threadId,
          prompt: "",
          workspacePath: thread.workspacePath,
          worktreePath: thread.workspacePath,
          routes: built,
          signal: AbortSignal.timeout(120_000),
          sdkSession: await buildSdkSessionOptions(threadId, ""),
          resume,
        },
        userMessageId,
      );
    } finally {
      await proxy.close();
    }
  });
  emitThreadEvent(threadId, "thread.files_rewound", `已回滚文件到检查点 ${userMessageId.slice(0, 8)}…`, "system");
  return { ok: true, message: "文件已回滚到所选检查点。" };
}

async function getWorkspaceChangeStatus(threadId: string): Promise<WorktreeStatusResult> {
  const thread = conversationStore.getThread(threadId);
  const workspacePath = thread?.workspacePath;
  if (!workspacePath) {
    return { exists: false, worktreePath: "", workspacePath: "", changedFiles: [] };
  }
  const plan = createSessionPlan(workspacePath, threadId);
  try {
    const changedFiles = await gitWorktrees.changedFiles(plan);
    return {
      exists: changedFiles.length > 0,
      worktreePath: workspacePath,
      workspacePath,
      changedFiles,
    };
  } catch (error) {
    console.error("Failed to read workspace change status:", error);
    return { exists: false, worktreePath: workspacePath, workspacePath, changedFiles: [] };
  }
}

async function applyWorktreeChanges(
  plan: WorktreePlan,
): Promise<{ files: string[]; diff: string; threadMessage: string; activityMessage: string }> {
  if (!(await fileExists(plan.worktreePath))) {
    throw new Error(`找不到隔离工作树：${plan.worktreePath}`);
  }

  const { files, diff } = await gitWorktrees.collectWorktreeChanges(plan);
  if (files.length === 0) {
    const emptyMessage = "执行完成，工作树内无相对基线的文件变更。";
    return { files: [], diff: "", threadMessage: emptyMessage, activityMessage: emptyMessage };
  }

  await gitWorktrees.applyWorktreeDiff(plan, diff, files);
  const summary = buildWorktreeMergeSummary(diff, files);
  return {
    files,
    diff,
    threadMessage: formatWorktreeMergeThreadMessage(files.length),
    activityMessage: serializeWorktreeMergeMessage(summary),
  };
}

async function applyWorktreeForThread(threadId: string): Promise<WorktreeApplyResult> {
  const status = await getWorkspaceChangeStatus(threadId);
  if (!status.exists) {
    throw new Error("该对话没有可合并的隔离工作树。");
  }

  const plan = resolveWorktreePlan(status.workspacePath, threadId, status.worktreePath);
  const { files, diff, threadMessage, activityMessage } = await applyWorktreeChanges(plan);
  conversationStore.saveAppliedDiff(threadId, plan.workspacePath, diff, files);
  await cleanupWorktreeForThread(threadId);
  updateThread(threadId, { status: "completed", message: threadMessage });
  emitThreadEvent(threadId, "worktree.applied", activityMessage, "system");
  return { ok: true, files, message: threadMessage };
}

async function rollbackWorkspaceToThread(threadId: string): Promise<ThreadRollbackResult> {
  const target = conversationStore.getAppliedDiff(threadId);
  if (!target) {
    throw new Error("该对话没有已应用到工作区的变更记录，无法作为回滚点。");
  }

  const laterDiffs = conversationStore.listAppliedDiffsAfter(target.workspacePath, target.appliedAt);
  if (laterDiffs.length === 0) {
    const message = "当前工作区已经处于该对话之后的状态。";
    updateThread(threadId, { status: "idle", message });
    return { ok: true, revertedThreads: 0, files: [], message };
  }

  const files = new Set<string>();
  for (const record of laterDiffs) {
    if (!record.diff.trim()) {
      conversationStore.markAppliedDiffRolledBack(record.threadId);
      continue;
    }
    const result = await runGitCommand(
      ["git", "apply", "-R", "--whitespace=nowarn", "-"],
      target.workspacePath,
      { stdin: record.diff },
    );
    if (result.exitCode !== 0) {
      throw new Error(`回滚 ${record.threadId} 失败：${result.stderr || result.stdout}`);
    }
    for (const file of record.files) {
      files.add(file);
    }
    conversationStore.markAppliedDiffRolledBack(record.threadId);
  }

  const changedFiles = [...files];
  const message =
    changedFiles.length > 0
      ? `已回滚 ${laterDiffs.length} 个后续对话的变更：${changedFiles.join(", ")}`
      : `已回滚 ${laterDiffs.length} 个后续对话的变更。`;
  updateThread(threadId, { status: "idle", message });
  return { ok: true, revertedThreads: laterDiffs.length, files: changedFiles, message };
}

async function getThreadAppliedDiff(threadId: string): Promise<ThreadAppliedDiffResult> {
  const record = conversationStore.getAppliedDiff(threadId);
  if (!record) {
    throw new Error("该对话没有已应用到工作区的变更记录。");
  }
  const stats = buildWorktreeMergeSummary(record.diff, record.files);
  return {
    diff: record.diff,
    files: record.files,
    fileStats: stats.files,
    totalAdditions: stats.totalAdditions,
    totalDeletions: stats.totalDeletions,
    ...(record.rolledBackAt && { rolledBackAt: record.rolledBackAt }),
  };
}

async function revertThreadAppliedDiff(threadId: string): Promise<ThreadRevertAppliedDiffResult> {
  const record = conversationStore.getAppliedDiff(threadId);
  if (!record) {
    throw new Error("该对话没有可撤销的已应用变更。");
  }
  if (record.rolledBackAt) {
    throw new Error("该对话的变更已撤销。");
  }
  if (!record.diff.trim()) {
    conversationStore.markAppliedDiffRolledBack(threadId);
    return { ok: true, files: record.files, message: "已撤销应用到工作区的变更。" };
  }

  const result = await runGitCommand(
    ["git", "apply", "-R", "--whitespace=nowarn", "-"],
    record.workspacePath,
    { stdin: record.diff },
  );
  if (result.exitCode !== 0) {
    throw new Error(`撤销失败：${result.stderr || result.stdout}`);
  }

  conversationStore.markAppliedDiffRolledBack(threadId);
  const message =
    record.files.length > 0
      ? `已撤销 ${record.files.length} 个文件的合并变更。`
      : "已撤销应用到工作区的变更。";
  updateThread(threadId, { status: "idle", message });
  emitThreadEvent(threadId, "worktree.reverted", message, "system");
  return { ok: true, files: record.files, message };
}

async function cleanupWorktreeForThread(threadId: string): Promise<void> {
  const { workspacePath, worktreePathHint } = resolveWorktreeContextForThread(threadId);
  if (!workspacePath || !worktreePathHint) {
    return;
  }
  const plan = resolveWorktreePlan(workspacePath, threadId, worktreePathHint);
  if (!isIsolatedWorktreePlan(plan)) {
    return;
  }
  await removeIsolatedWorktree(plan, threadId);
}

function createFinalizeCancelledRunDeps(): FinalizeCancelledRunDeps {
  return {
    updateThread: (threadId, patch) => updateThread(threadId, patch),
    emitThreadEvent: (threadId, type, message, role) =>
      emitThreadEvent(threadId, type, message, role),
  };
}

async function handleRunCancelled(threadId: string, worktreePlan: WorktreePlan): Promise<void> {
  const explicit = takePendingCancelDisposition(pendingCancelDisposition, threadId);
  await finalizeCancelledRun(threadId, worktreePlan, explicit, createFinalizeCancelledRunDeps());
}

function buildDriverRoutes(routes: readonly AnthropicProxyResolvedRoute[]): ResolvedModelRoute[] {
  return routes.map((route) => ({
    role: route.role,
    primary: {
      id: `${route.role}:${route.provider.id}`,
      provider: "custom",
      displayName: `${route.provider.name} / ${route.modelId}`,
      baseUrl: route.provider.baseUrl,
      // Role-specific alias lets the local proxy attribute shared upstream models to the right context window.
      modelId: route.aliasModelId,
      capabilities: ["messages_api", "streaming", "tool_use", "subagent_compatible"],
      enabled: route.provider.enabled,
    },
    fallbacks: [],
    ...(route.thinkingEffort && { thinkingEffort: route.thinkingEffort }),
  }));
}

function parseStoredRoutes(routesJson: string): ResolvedModelRoute[] {
  const parsed = JSON.parse(routesJson) as ResolvedModelRoute[];
  if (!Array.isArray(parsed)) {
    throw new Error("Stored route configuration is invalid.");
  }
  return parsed;
}

function listResumableSubagentRefs(
  threadId: string,
  phase: SubagentRunPhase,
): { role: string; agentId: string }[] {
  return conversationStore.listResumableSubagentSessions(threadId, phase).map((row) => ({
    role: row.role,
    agentId: row.agentId,
  }));
}

function buildSdkHookContextExtras(
  threadId: string,
  phase: SubagentRunPhase,
  extras?: Partial<EcoHookContext> & { peekPendingCoderTodoId?: () => string | undefined },
): Partial<EcoHookContext> {
  const pendingLaunches: PendingSubagentLaunch[] = [];
  const peekPendingCoderTodoId = extras?.peekPendingCoderTodoId;
  const subagentAttribution = {
    resolveAgentId: (input: { role: AgentRole; parentToolUseId?: string; sessionId: string }) =>
      subagentMetricsRegistry.resolveAgentId(threadId, {
        role: input.role,
        ...(input.parentToolUseId && { parentToolUseId: input.parentToolUseId }),
      }),
    onTaskToolUse: (toolUseId: string, input?: { role?: AgentRole }) => {
      subagentMetricsRegistry.noteTaskToolUse(threadId, toolUseId, input?.role);
      agentLifecycle.noteTaskToolUse(threadId, toolUseId, input?.role);
    },
  };
  const subagentSessions = createSubagentSessionHooks(conversationStore, threadId, phase, {
    lifecycle: agentLifecycle,
    metricsRegistry: subagentMetricsRegistry,
    onTimingChanged: () => emitSubagentTimingUpdated(threadId),
    ...(peekPendingCoderTodoId && { todoIdHint: peekPendingCoderTodoId }),
    consumePendingLaunch: (input) => {
      const roleIndex = pendingLaunches.findIndex((pending) => pending.role === input.role);
      if (roleIndex >= 0) {
        const [pending] = pendingLaunches.splice(roleIndex, 1);
        return pending;
      }
      return undefined;
    },
    onAgentToolCapture: (input) => {
      if (!isSubagentRole(input.role)) {
        return;
      }
      const missionKey = normalizeSubagentMissionKey(input.prompt);
      const todoId =
        input.todoIdHint ?? (peekPendingCoderTodoId ? peekPendingCoderTodoId() : undefined);
      pendingLaunches.push({
        role: input.role,
        ...(missionKey ? { missionKey } : {}),
        ...(todoId ? { todoId } : {}),
      });
    },
  });
  const { peekPendingCoderTodoId: _peek, ...rest } = extras ?? {};
  return { ...rest, subagentSessions, subagentAttribution };
}

async function withThreadSdkDriver(
  threadId: string,
  fn: (
    driver: ClaudeAgentSdkDriver,
    signal: AbortSignal,
    routes: readonly ResolvedModelRoute[],
  ) => Promise<void>,
  onContextProbe?: (phase: string, detail: Record<string, unknown>) => void,
): Promise<void> {
  const roleRoutes = resolveRoleRoutesForThread(threadId);
  const runtimeConfig = resolveRuntimeConfig(
    providerStore.getSettings(),
    providerStore.listProvidersWithSecrets(),
    roleRoutes,
  );
  if (!runtimeConfig.ok) {
    throw new Error(runtimeConfig.reason);
  }
  const attemptProxy = await startRuntimeProxy(runtimeConfig.routes, undefined, threadId, {
    emitRequestActivity: false,
  });
  const driverRoutes = buildDriverRoutes(attemptProxy.routes);
  try {
    const driver = createSdkDriver(threadId, attemptProxy, undefined, "execution", onContextProbe);
    const controller = new AbortController();
    await fn(driver, controller.signal, driverRoutes);
  } finally {
    await attemptProxy.close();
  }
}

function createSdkDriver(
  threadId: string,
  proxy: { apiKey: string; baseUrl: string },
  hookContextExtras?: Partial<EcoHookContext>,
  runPhase: SubagentRunPhase = "execution",
  onContextProbe?: (phase: string, detail: Record<string, unknown>) => void,
): ClaudeAgentSdkDriver {
  const endpoint = localOtelReceiver.getEndpoint();
  if (!endpoint) {
    throw new Error("Local OTel receiver is not ready.");
  }
  const storedThread = conversationStore.getThread(threadId);
  if (!storedThread) {
    throw new Error("Thread was not found.");
  }
  const threadConfig = ensureThreadRuntimeConfig(storedThread).runtimeConfig;
  const orchestrationMode =
    threadConfig?.orchestrationMode ?? workflowSettingsStore.get().orchestrationMode;
  return new ClaudeAgentSdkDriver({
    apiKey: proxy.apiKey,
    baseUrl: proxy.baseUrl,
    orchestration: orchestrationModeFromSnapshot({ orchestrationMode }),
    hookContext: {
      ...createThreadHookContext(threadId),
      ...buildSdkHookContextExtras(threadId, runPhase, hookContextExtras),
    },
    onContextProbe: onContextProbe
      ? (phase, detail) => {
          onContextProbe(phase, detail);
        }
      : (phase, detail) => {
          logContextSnapshot(phase, { threadId, ...detail });
        },
    otel: { endpoint, threadId },
    ...(sdkSessionStore ? { sessionStore: sdkSessionStore } : {}),
  });
}

async function rebuildSdkSessionStore(localDbPath: string): Promise<void> {
  if (closeSdkSessionStore) {
    await closeSdkSessionStore();
    closeSdkSessionStore = undefined;
  }

  const config = sessionSyncStore.getSettingsWithSecrets();
  if (config.redisEnabled && config.redisUrl.trim()) {
    const connection = await createRedisSessionStore({
      url: config.redisUrl.trim(),
      ...(config.redisPassword ? { password: config.redisPassword } : {}),
      keyPrefix: config.keyPrefix,
    });
    sdkSessionStore = connection.store;
    closeSdkSessionStore = connection.close;
    process.stderr.write(`[eco] SessionStore: Redis (${config.redisUrl.trim()})\n`);
    return;
  }

  sdkSessionStore = await createSqliteSessionStore(localDbPath);
  closeSdkSessionStore = undefined;
  process.stderr.write(`[eco] SessionStore: local SQLite (${localDbPath})\n`);
}

function isSessionCapturedPayload(payload: unknown): payload is SessionCapturedPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    typeof (payload as SessionCapturedPayload).sessionId === "string" &&
    typeof (payload as SessionCapturedPayload).cwd === "string"
  );
}

function captureSdkSessionFromEvent(
  threadId: string,
  event: { type: string; payload: unknown },
  worktreePath: string,
): void {
  if (event.type === "file.checkpoint") {
    const payload = event.payload;
    if (payload && typeof payload === "object" && typeof (payload as { userMessageId?: string }).userMessageId === "string") {
      conversationStore.saveFileCheckpoint(threadId, (payload as { userMessageId: string }).userMessageId);
    }
    return;
  }
  if (event.type !== "session.captured") {
    return;
  }
  if (isSessionCapturedPayload(event.payload)) {
    conversationStore.saveSdkSession(threadId, event.payload.sessionId, worktreePath);
  }
}

function resolveResumeOptions(threadId: string, worktreePath: string): EcoSdkResumeOptions | undefined {
  const session = conversationStore.getSdkSession(threadId);
  if (!session?.sessionId) {
    return undefined;
  }
  const thread = conversationStore.getThread(threadId);
  const workspacePath = thread?.workspacePath;
  const sessionCwd = workspacePath
    ? normalizeSessionCwd(workspacePath, session.cwd)
    : session.cwd.trim();
  const cwd = workspacePath
    ? normalizeSessionCwd(workspacePath, worktreePath || session.cwd)
    : worktreePath.trim();
  if (existsSync(sessionCwd) && (!cwd || sessionCwd === cwd || path.resolve(sessionCwd) === path.resolve(cwd))) {
    return { resumeSessionId: session.sessionId };
  }
  return undefined;
}

async function ensurePendingPlanForExecution(
  threadId: string,
  workspacePath: string,
  worktreePath: string,
  routesJson: string,
): Promise<boolean> {
  if (conversationStore.getPendingPlan(threadId)) {
    return true;
  }
  const snapshot = await readApprovedPlanSnapshot(workspacePath, threadId);
  if (!snapshot?.plan.trim()) {
    return false;
  }
  const thread = conversationStore.getThread(threadId);
  conversationStore.savePendingPlan({
    threadId,
    userPrompt: snapshot.userPrompt.trim() || thread?.prompt.trim() || "",
    analysis: snapshot.analysis,
    plan: snapshot.plan,
    workspacePath,
    worktreePath,
    routesJson,
  });
  return true;
}

async function resolvePlanningContextForThread(
  threadId: string,
  workspacePath: string,
): Promise<EcoPlanningContext | undefined> {
  const pending = conversationStore.getPendingPlan(threadId);
  if (pending) {
    return {
      userPrompt: pending.userPrompt,
      analysis: pending.analysis,
      plan: pending.plan,
    };
  }
  const snapshot = await readApprovedPlanSnapshot(workspacePath, threadId);
  if (!snapshot) {
    return undefined;
  }
  return {
    userPrompt: snapshot.userPrompt,
    analysis: snapshot.analysis,
    plan: snapshot.plan,
    ...(snapshot.planUserEdited ? { planUserEdited: true } : {}),
  };
}

async function dispatchThreadContinueAction(input: {
  threadId: string;
  action: ThreadContinueAction;
  updated: ThreadSummary;
  workspace: WorkspaceInfo;
  runtimeConfig: RuntimeConfig;
  agentPrompt: string;
  cwd: string;
  existingWorktreePlan?: WorktreePlan;
  attachments?: PromptImageAttachment[];
  roleRoutes: readonly RoleRouteConfig[];
}): Promise<void> {
  const {
    threadId,
    action,
    updated,
    workspace,
    runtimeConfig,
    agentPrompt,
    cwd,
    existingWorktreePlan,
    attachments,
    roleRoutes,
  } = input;

  if (action.kind === "resume_execution") {
    const worktreePath = existingWorktreePlan?.worktreePath ?? cwd;
    const ok = await ensurePendingPlanForExecution(
      threadId,
      workspace.path,
      worktreePath,
      "[]",
    );
    if (!ok) {
      markThreadInterrupted(threadId, "找不到可恢复的执行计划，请重新描述需求。");
      return;
    }
    void runCodingThreadExecution(threadId, runtimeConfig, {
      routesOverride: roleRoutes,
      followUp: agentPrompt,
      ...(attachments?.length ? { attachments } : {}),
    });
    return;
  }

  if (action.kind === "question") {
    void runQuestionThread(
      updated,
      workspace,
      runtimeConfig,
      agentPrompt,
      cwd !== workspace.path ? cwd : undefined,
      action.resume ? resolveResumeOptions(threadId, cwd) : undefined,
      attachments,
      roleRoutes,
    );
    return;
  }

  if (action.kind === "resume_sdk") {
    void (async () => {
      await ensureContextHeadroom(threadId, cwd, new AbortController().signal);
      const planningContext =
        action.phase === "execution"
          ? await resolvePlanningContextForThread(threadId, workspace.path)
          : undefined;
      if (threadOrchestrationMode(threadId) === "autonomous" && action.phase !== "question") {
        await runCodingThreadAutonomous(
          updated,
          workspace,
          runtimeConfig,
          agentPrompt,
          existingWorktreePlan,
          resolveResumeOptions(threadId, cwd),
          attachments,
          roleRoutes,
        );
        return;
      }
      await runThreadContinuation(
        updated,
        workspace,
        runtimeConfig,
        agentPrompt,
        action.phase,
        existingWorktreePlan,
        attachments,
        roleRoutes,
        planningContext,
      );
    })();
    return;
  }

  if (action.kind === "revise_plan" || action.kind === "fresh_plan") {
    if (action.kind === "fresh_plan") {
      conversationStore.clearSubagentSessions(threadId);
      subagentMetricsRegistry.clearThread(threadId);
    }
    if (threadUsesManualOrchestration(threadId)) {
      void runCodingThreadPlanning(
        updated,
        workspace,
        runtimeConfig,
        agentPrompt,
        existingWorktreePlan,
        undefined,
        attachments,
        roleRoutes,
      );
    } else {
      void runCodingThreadAutonomous(
        updated,
        workspace,
        runtimeConfig,
        agentPrompt,
        existingWorktreePlan,
        undefined,
        attachments,
        roleRoutes,
      );
    }
  }
}

async function runThreadContinuation(
  thread: ThreadSummary,
  workspace: WorkspaceInfo,
  runtimeConfig: RuntimeConfig,
  followUp: string,
  mode: "planning" | "execution" | "question",
  existingWorktreePlan?: WorktreePlan,
  attachments?: PromptImageAttachment[],
  routesOverride?: readonly RoleRouteConfig[],
  planningContext?: EcoPlanningContext,
): Promise<void> {
  if (threadOrchestrationMode(thread.id) === "autonomous" && mode !== "question") {
    const controller = new AbortController();
    startActiveRun(thread.id, {
      controller,
      worktreePlan: existingWorktreePlan ?? createSessionPlan(workspace.path, thread.id),
    });
    resetSubagentContextWindows(thread.id);
    let worktreePlan = existingWorktreePlan ?? createSessionPlan(workspace.path, thread.id);
    let cwd = workspace.path;
    try {
      const resolved = await resolveThreadWorktree(workspace, thread.id, existingWorktreePlan);
      worktreePlan = resolved.worktreePlan;
      cwd = resolved.cwd;
      activeRunRuntimeState.setWorktreePlan(thread.id, worktreePlan);
      const resumeOpts = resolveResumeOptions(thread.id, cwd);
      if (!resumeOpts) {
        markThreadInterrupted(thread.id, "无法恢复 SDK 会话，请重新发送完整需求。");
        return;
      }
      const outcome = await runThreadRequestWithAutoRetry(thread.id, runAttemptPhaseFromThreadMode(mode), controller.signal, async () => {
        const freshConfig = resolveRuntimeConfigFresh(routesOverride);
        if (!freshConfig.ok) {
          return { ok: false, reason: freshConfig.reason };
        }
        recordThreadRouteFingerprint(thread.id, freshConfig.routes);
        const attemptProxy = await startRuntimeProxy(freshConfig.routes, attachments, thread.id);
        const routes = buildDriverRoutes(attemptProxy.routes);
        try {
          const driver = createSdkDriver(thread.id, attemptProxy, undefined, "execution");
          let sdkFailure: string | undefined;
          for await (const event of driver.runContinuation(
            {
              threadId: thread.id,
              prompt: followUp,
              workspacePath: workspace.path,
              worktreePath: cwd,
              routes,
              signal: controller.signal,
              sdkSession: await buildSdkSessionOptions(thread.id, followUp),
              resume: resumeOpts,
            },
            mode,
            planningContext,
          )) {
            if (event.type === "usage.recorded") {
              sdkFailure = extractSdkRunFailure(event.payload) ?? sdkFailure;
              onSdkUsageRecordedEvent(thread.id, event);
              continue;
            }
            captureSdkSessionFromEvent(thread.id, event, cwd);
            emitSdkStreamActivity(thread.id, event);
          }
          if (controller.signal.aborted) {
            return { ok: false, reason: "cancelled by user", aborted: true };
          }
          if (sdkFailure) {
            return { ok: false, reason: sdkFailure };
          }
          return { ok: true };
        } finally {
          await attemptProxy.close();
        }
      });
      if (isRequestAttemptAborted(outcome)) {
        await handleRunCancelled(thread.id, worktreePlan);
        return;
      }
      if (!outcome.ok) {
        markThreadInterrupted(thread.id, outcome.reason);
        return;
      }
      await completeCodingThreadRun(thread.id, worktreePlan);
    } finally {
      finishActiveRun(thread.id);
      afterRunContextRefresh(thread.id, cwd);
    }
    return;
  }

  const controller = new AbortController();
  startActiveRun(thread.id, {
    controller,
    worktreePlan: existingWorktreePlan ?? createSessionPlan(workspace.path, thread.id),
  });
  resetSubagentContextWindows(thread.id);

  const stopStatusRef = { current: "completed" as "completed" | "blocked" | "cancelled" };
  let stopTodosHandled = false;
  let planningPlanCaptured = false;
  let worktreePlan = existingWorktreePlan ?? createSessionPlan(workspace.path, thread.id);
  let cwd = workspace.path;
  const todoTracker =
    mode === "execution"
      ? createSdkTaskTracker(
          thread.id,
          {
            listTodos: () => conversationStore.listCoderTodos(thread.id),
            replaceTodos: (todos) => conversationStore.replaceCoderTodos(thread.id, todos),
          },
          emitTodoList,
        )
      : undefined;
  const taskHookHandlers = todoTracker?.createHookHandlers(() => stopStatusRef.current);

  try {
    if (mode !== "question") {
      const resolved = await resolveThreadWorktree(workspace, thread.id, existingWorktreePlan);
      worktreePlan = resolved.worktreePlan;
      cwd = resolved.cwd;
      activeRunRuntimeState.setWorktreePlan(thread.id, worktreePlan);
    }

    const resumeOptsForContinuation = resolveResumeOptions(thread.id, cwd);

    const outcome = await runThreadRequestWithAutoRetry(thread.id, runAttemptPhaseFromThreadMode(mode), controller.signal, async () => {
      const freshConfig = resolveRuntimeConfigFresh(routesOverride);
      if (!freshConfig.ok) {
        return { ok: false, reason: freshConfig.reason };
      }
      recordThreadRouteFingerprint(thread.id, freshConfig.routes);
      const attemptProxy = await startRuntimeProxy(freshConfig.routes, attachments, thread.id);
      const routes = buildDriverRoutes(attemptProxy.routes);
      const resume = resumeOptsForContinuation;
      if (!resume) {
        return { ok: false, reason: "无法恢复 SDK 会话，请重新发送完整需求。" };
      }

      await ensureContextHeadroom(thread.id, cwd, controller.signal, { ignoreRunningGuard: true });

      try {
        const continuationPhase: SubagentRunPhase =
          mode === "question" ? "question" : mode === "planning" ? "planning" : "execution";
        const driver = createSdkDriver(
          thread.id,
          attemptProxy,
          {
            ...(taskHookHandlers
              ? {
                  peekPendingCoderTodoId: taskHookHandlers.peekPendingCoderTodoId,
                  taskTracker: {
                    ...taskHookHandlers,
                    onStop(status) {
                      stopTodosHandled = true;
                      taskHookHandlers.onStop(status);
                    },
                  },
                  getStopTodoStatus: () => stopStatusRef.current,
                }
              : {}),
          },
          continuationPhase,
        );
        if (!driver.runQuestion && mode === "question") {
          throw new Error("Runtime driver does not support question answering.");
        }
        if (!driver.runContinuation) {
          throw new Error("Runtime driver does not support session continuation.");
        }

        let sdkFailure: string | undefined;
        const runInput = {
          threadId: thread.id,
          prompt: followUp,
          workspacePath: workspace.path,
          worktreePath: cwd,
          routes,
          signal: controller.signal,
          sdkSession: await buildSdkSessionOptions(thread.id, followUp),
          resume,
          resumableSubagents: listResumableSubagentRefs(
            thread.id,
            continuationPhase,
          ),
        };

        const eventStream =
          mode === "question"
            ? driver.runQuestion!(runInput)
            : driver.runContinuation!(runInput, mode, planningContext);

        for await (const event of eventStream) {
          if (event.type === "usage.recorded") {
            sdkFailure = extractSdkRunFailure(event.payload) ?? sdkFailure;
            onSdkUsageRecordedEvent(thread.id, event);
            continue;
          }
          captureSdkSessionFromEvent(thread.id, event, cwd);
          if (event.type === "plan.ready" && isPlanReadyPayload(event.payload)) {
            planningPlanCaptured = true;
            conversationStore.savePendingPlan({
              threadId: thread.id,
              userPrompt: event.payload.userPrompt,
              analysis: event.payload.analysis,
              plan: event.payload.plan,
              workspacePath: workspace.path,
              worktreePath: cwd,
              routesJson: JSON.stringify(routes),
            });
            emitThreadEvent(
              thread.id,
              "thread.awaiting_plan",
              "计划已生成，请确认是否执行。",
              "planner",
              false,
              {
                plan: {
                  userPrompt: event.payload.userPrompt,
                  analysis: event.payload.analysis,
                  plan: event.payload.plan,
                },
              },
            );
            scheduleThreadTitleSummary(thread.id, runtimeConfig, {
              plan: event.payload.plan,
              analysis: event.payload.analysis,
            });
          }
          if (event.type === "todo.updated" && todoTracker && isSdkTodoProgressPayload(event.payload)) {
            todoTracker.handleTaskProgress(event.payload);
          }
          emitSdkStreamActivity(thread.id, event);
        }

        if (controller.signal.aborted) {
          return { ok: false, reason: "cancelled by user", aborted: true };
        }
        if (sdkFailure) {
          return { ok: false, reason: sdkFailure };
        }
        return { ok: true };
      } catch (error) {
        if (controller.signal.aborted) {
          return { ok: false, reason: "cancelled by user", aborted: true };
        }
        return { ok: false, reason: errorMessage(error) };
      } finally {
        await attemptProxy.close();
      }
    });

    if (isRequestAttemptAborted(outcome)) {
      stopStatusRef.current = "cancelled";
      taskHookHandlers?.onStop("cancelled");
      cancelClarificationsForThread(thread.id, "cancelled by user");
      await handleRunCancelled(thread.id, worktreePlan);
      return;
    }
    if (!outcome.ok) {
      stopStatusRef.current = "blocked";
      taskHookHandlers?.onStop("blocked");
      clearSdkSessionAfterResumeFailure(thread.id, Boolean(resumeOptsForContinuation));
      markThreadInterrupted(thread.id, outcome.reason);
      return;
    }

    if (mode === "execution") {
      taskHookHandlers?.onStop("completed");
      await completeCodingThreadRun(thread.id, worktreePlan);
      return;
    }

    if (mode === "question") {
      updateThread(thread.id, { status: "completed", message: "回答完成。" });
      scheduleThreadTitleSummary(thread.id, runtimeConfig);
      return;
    }

    if (mode === "planning") {
      if (planningPlanCaptured) {
        updateThread(thread.id, {
          status: "awaiting_plan",
          message: "等待你确认计划。",
        });
      } else {
        updateThread(thread.id, { status: "idle", message: "计划阶段已结束。" });
      }
      return;
    }

    updateThread(thread.id, { status: "idle", message: "续聊已结束。" });
  } catch (error) {
    stopStatusRef.current = "blocked";
    taskHookHandlers?.onStop("blocked");
    markThreadInterrupted(thread.id, errorMessage(error));
  } finally {
    const worktreePath = resolveThreadWorktreePath(thread.id);
    cancelClarificationsForThread(thread.id, "run finished");
    sdkStreamBridge.resetThread(thread.id);
    await usageLedgerCoordinator.flushUsageUpdates(thread.id);
    finishActiveRun(thread.id);
    afterRunContextRefresh(thread.id, worktreePath);
    const currentThread = conversationStore.getThread(thread.id);
    if (currentThread?.status === "running") {
      updateThread(thread.id, {
        status: "idle",
        message: currentThread.message || "续聊已结束。",
      });
    }
  }
}

/** OTel does not stream assistant text; SDK drives narrative, tool, and todo activity. */
function emitSdkStreamActivity(threadId: string, event: AgentEventLike): void {
  if (event.type === "tool.started" && isRecord(event.payload)) {
    const toolName =
      typeof event.payload.tool_name === "string" ? event.payload.tool_name.trim() : "";
    const toolUseId =
      typeof event.payload.tool_use_id === "string" ? event.payload.tool_use_id : undefined;
    if (toolUseId && (toolName === "Task" || toolName === "Agent")) {
      const rawRole =
        typeof event.payload.subagent_type === "string"
          ? event.payload.subagent_type
          : typeof event.payload.agent_type === "string"
            ? event.payload.agent_type
            : "";
      const role = isSubagentRole(rawRole) ? rawRole : undefined;
      subagentMetricsRegistry.noteTaskToolUse(threadId, toolUseId, role);
      agentLifecycle.noteTaskToolUse(threadId, toolUseId, role);
    }
  }
  handleSdkContextSideEffects(threadId, event);
  const plannerSessionId = conversationStore.getSdkSession(threadId)?.sessionId;
  const activityAgentId = resolveActivityAgentId(threadId, event, {
    ...(plannerSessionId && { plannerSessionId }),
    metricsRegistry: subagentMetricsRegistry,
  });
  sdkStreamBridge.handleEvent(
    threadId,
    event,
    (id, type, message, role, stream, agentId) => {
      emitThreadEvent(
        id,
        type,
        message,
        role as AgentRole | "system" | "thinking" | "tool" | "user",
        stream,
        agentId ? { agentId } : undefined,
      );
    },
    undefined,
    activityAgentId ? { activityAgentId } : undefined,
  );
}

function emitOtelActivity(line: OtelActivityLine): void {
  if (/^Compacting context/i.test(line.message)) {
    contextLifecycle.noteOtelCompaction(line.threadId);
  }
  if (line.role === "tool" && sdkStreamBridge.shouldSuppressOtelToolLine(line.threadId, line.message)) {
    return;
  }
  const otelAgentId = resolveOtelActivityAgentId(line.threadId, line, {
    metricsRegistry: subagentMetricsRegistry,
  });
  const eventType = line.apiError ? "thread.api_error" : "otel.activity";
  emitThreadEvent(
    line.threadId,
    eventType,
    line.message,
    line.role,
    line.stream ?? false,
    {
      ...(otelAgentId && { agentId: otelAgentId }),
      ...(line.apiError && { apiError: line.apiError }),
    },
  );
}

function noteUsageBillingObservation(
  threadId: string,
  observation: UsageBillingObservation,
): void {
  activeRunBillingState.appendObservation(threadId, observation);
}

function emitOtelUsage(usage: OtelUsageUpdate): void {
  const runAttemptId = agentLifecycle.usageRunAttemptId(usage.threadId);
  const plannerAgentId = agentLifecycle.usagePlannerAgentId(usage.threadId);
  const currentRequestSeq = activeRunBillingState.otelRequestSeq(usage.threadId);
  const resolved = resolveOtelUsageBilling({
    usage,
    ...(currentRequestSeq !== undefined && { currentRequestSeq }),
    ...(runAttemptId && { runAttemptId }),
    ...(plannerAgentId && { plannerAgentId }),
  });
  activeRunBillingState.recordOtelRequest(usage.threadId, {
    nextRequestSeq: resolved.nextRequestSeq,
  });

  if (resolved.observation) {
    noteUsageBillingObservation(usage.threadId, resolved.observation);
  }

  usageLedgerCoordinator.trackUsageUpdate(
    usage.threadId,
    processUsageBilling(resolved.billingInput)
      .then(() => undefined)
      .catch((error) => {
        process.stderr.write(`[eco] usage billing failed: ${errorMessage(error)}\n`);
      }),
  );
}

async function emitProxyUsage(
  info: AnthropicProxyUsageInfo & { threadId: string },
): Promise<UpstreamProxyCallBilling | null> {
  const runAttemptId = agentLifecycle.usageRunAttemptId(info.threadId);
  const plannerAgentId = agentLifecycle.usagePlannerAgentId(info.threadId);
  const currentRequestSeq = activeRunBillingState.proxyRequestSeq(info.threadId);
  const resolved = resolveProxyUsageBilling({
    info,
    ...(currentRequestSeq !== undefined && { currentRequestSeq }),
    ...(runAttemptId && { runAttemptId }),
    ...(plannerAgentId && { plannerAgentId }),
    resolver: subagentMetricsRegistry,
  });
  activeRunBillingState.recordProxyRequest(info.threadId, {
    nextRequestSeq: resolved.nextRequestSeq,
    contextRole: resolved.contextRole,
    contextOccupied: resolved.contextOccupied,
  });

  noteUsageBillingObservation(info.threadId, resolved.observation);
  const billingTask = processUsageBilling(resolved.billingInput);
  usageLedgerCoordinator.trackUsageUpdate(
    info.threadId,
    billingTask.then(
      () => undefined,
      (error) => {
        process.stderr.write(`[eco] proxy usage billing failed: ${errorMessage(error)}\n`);
      },
    ),
  );
  try {
    return await billingTask;
  } catch (error) {
    process.stderr.write(`[eco] proxy usage billing failed: ${errorMessage(error)}\n`);
    return null;
  }
}

function lookupUsageBillingPricing(route: UsageBillingPricingRoute) {
  return pricingCache.lookupForRoute({
    baseUrl: route.provider.baseUrl,
    modelId: route.modelId,
    ...(route.modelsDevMapping && { mapping: route.modelsDevMapping }),
  });
}

function usageBillingEffectsServices() {
  return {
    context: createUsageContextService({
      monitor: contextMonitor,
      emitLiveContext: (threadId: string) => contextScheduler.emitLiveFromMonitor(threadId),
    }),
    usageLedger: usageLedgerCoordinator,
    accumulator: threadUsageAccumulator,
    subagentMetrics: subagentMetricsRegistry,
    emitUsageUpdated: (event: UsageBillingUpdatedEvent) => {
      emitUsageUpdatedFromBillingEffects(event);
    },
    schedulePersistThreadMetrics,
  };
}

function emitUsageUpdatedFromBillingEffects(event: UsageBillingUpdatedEvent): void {
  emitThreadEvent(event.threadId, "thread.usage_updated", event.badge, event.role, false, event.payload);
}

async function processUsageBilling(
  input: SingleUsageBillingRequest,
): Promise<UpstreamProxyCallBilling | null> {
  const billingRuntime = await resolveBillingRuntimeContext(
    billingRuntimeEnvironment,
    input.threadId,
  );

  const resolved = await resolveSingleUsageBillingOrchestration({
    request: input,
    runtimeRoutes: billingRuntime.runtimeRoutes,
    lookupPricing: billingRuntime.lookupPricing,
  });
  if (!resolved) {
    return null;
  }

  await applySingleUsageBillingEffects(usageBillingEffectsServices(), resolved.effectsInput);
  return resolved.requestBillingLog;
}

function buildDriverRoutesFromRuntime(routes: ReturnType<typeof resolveRuntimeRoutesFromSettings>): ResolvedModelRoute[] {
  return routes.map((route) => ({
    role: route.role,
    primary: {
      id: `${route.role}:${route.provider.id}`,
      provider: "custom",
      displayName: `${route.provider.name} / ${route.modelId}`,
      baseUrl: route.provider.baseUrl,
      modelId: route.modelId,
      capabilities: ["messages_api", "streaming", "tool_use", "subagent_compatible"],
      enabled: route.provider.enabled,
    },
    fallbacks: [],
    ...(route.thinkingEffort && { thinkingEffort: route.thinkingEffort }),
  }));
}

/** Best-effort compaction before resume; failures must not block the main agent run. */
async function ensureContextHeadroom(
  threadId: string,
  worktreePath: string,
  signal: AbortSignal,
  options?: { ignoreRunningGuard?: boolean },
): Promise<void> {
  try {
    const roleRoutes = resolveRoleRoutesForThread(threadId);
    const runtimeConfig = resolveRuntimeConfig(
      providerStore.getSettings(),
      providerStore.listProvidersWithSecrets(),
      roleRoutes,
    );
    if (!runtimeConfig.ok) {
      process.stderr.write(
        `[eco] context headroom skipped for ${threadId}: ${runtimeConfig.reason}\n`,
      );
      return;
    }
    const routes = buildDriverRoutesFromRuntime(runtimeConfig.routes);
    await contextScheduler.ensureHeadroom(threadId, routes, worktreePath, signal, options);
  } catch (error) {
    const detail = errorMessage(error);
    process.stderr.write(`[eco] context headroom skipped for ${threadId}: ${detail}\n`);
    emitThreadEvent(
      threadId,
      "otel.activity",
      `上下文压缩已跳过：${detail}`,
      "system",
      false,
    );
  }
}

function resolveThreadWorktreePath(threadId: string): string | undefined {
  const { workspacePath, worktreePathHint } = resolveWorktreeContextForThread(threadId);
  if (!workspacePath || !worktreePathHint || !existsSync(worktreePathHint)) {
    return undefined;
  }
  return worktreePathHint;
}

/** Call after finishActiveRun to refresh the context meter from monitor state. */
function afterRunContextRefresh(threadId: string, worktreePath?: string): void {
  contextLifecycle.afterRunRefresh(threadId, worktreePath);
}

function resetSubagentContextWindows(threadId: string): void {
  contextScheduler.clearSubagentState(threadId);
  contextScheduler.emitLiveFromMonitor(threadId);
}

function emitThreadContextUpdated(threadId: string, context: ThreadContextSnapshot): void {
  emitThreadEvent(threadId, "thread.context_updated", "", "system", false, { context });
  schedulePersistThreadMetrics(threadId);
}

function loadThreadMetricsFromStore(): void {
  restoreThreadMetricsFromStore({
    store: conversationStore,
    accumulator: threadUsageAccumulator,
    contextSnapshots: contextScheduler,
    subagentMetrics: subagentMetricsRegistry,
    contextMonitor,
  });
}

function persistThreadMetricsNow(threadId: string): void {
  persistThreadMetrics({
    store: conversationStore,
    accumulator: threadUsageAccumulator,
    contextSnapshots: contextScheduler,
  }, threadId);
}

function threadMetricsPersistenceServices() {
  return {
    store: conversationStore,
    accumulator: threadUsageAccumulator,
    contextSnapshots: contextScheduler,
  };
}

function schedulePersistThreadMetrics(threadId: string): void {
  const existing = persistMetricsTimers.get(threadId);
  if (existing) {
    clearTimeout(existing);
  }
  persistMetricsTimers.set(
    threadId,
    setTimeout(() => {
      persistMetricsTimers.delete(threadId);
      persistThreadMetricsNow(threadId);
    }, 400),
  );
}

function flushAllThreadMetrics(): void {
  for (const timer of persistMetricsTimers.values()) {
    clearTimeout(timer);
  }
  persistMetricsTimers.clear();

  flushThreadMetrics(threadMetricsPersistenceServices());
}

function handleSdkContextSideEffects(threadId: string, event: AgentEventLike): boolean {
  return contextLifecycle.handleSdkContextEvent({
    threadId,
    eventId: event.id,
    payload: event.payload,
  });
}

function onSdkUsageRecordedEvent(threadId: string, event: AgentEventLike & { id: string }): void {
  if (handleSdkContextSideEffects(threadId, event)) {
    return;
  }
  recordSdkUsageFromEvent(threadId, event);
}

function recordSdkUsageFromEvent(threadId: string, event: AgentEventLike & { id: string }): void {
  const runAttemptId = agentLifecycle.usageRunAttemptId(threadId);
  const plannerAgentId = agentLifecycle.usagePlannerAgentId(threadId);
  const observedAuthoritativeUsage = activeRunBillingState.listObservations(threadId);
  const resolved = resolveSdkEventUsageBilling({
    threadId,
    event,
    resolver: subagentMetricsRegistry,
    ...(runAttemptId && { runAttemptId }),
    ...(plannerAgentId && { plannerAgentId }),
    ...(observedAuthoritativeUsage && { observedAuthoritativeUsage }),
  });

  if (resolved.kind === "none" || resolved.kind === "assistant_ignored") {
    return;
  }

  if (resolved.kind === "assistant_subagent") {
    usageLedgerCoordinator.trackUsageUpdate(
      threadId,
      processUsageBilling(resolved.billingInput)
        .then(() => undefined)
        .catch((error) => {
          process.stderr.write(`[eco] SDK assistant subagent billing failed: ${errorMessage(error)}\n`);
        }),
    );
    return;
  }

  logSdkUsageResolution(threadId, resolved);

  if (resolved.kind === "stream_partial") {
    usageLedgerCoordinator.trackUsageUpdate(
      threadId,
      processSdkStreamPartialUsage(resolved.streamInput).catch((error) => {
        process.stderr.write(`[eco] SDK stream partial usage failed: ${errorMessage(error)}\n`);
      }),
    );
    return;
  }

  usageLedgerCoordinator.trackUsageUpdate(
    threadId,
    processSdkRunBilling(resolved.runInput).catch((error) => {
      process.stderr.write(`[eco] SDK run billing failed: ${errorMessage(error)}\n`);
    }),
  );
}

function logSdkUsageResolution(
  threadId: string,
  resolved: Extract<
    ReturnType<typeof resolveSdkEventUsageBilling>,
    { kind: "stream_partial" | "sdk_run" }
  >,
): void {
  if (resolved.kind === "sdk_run" && resolved.missDiagnostic) {
    logEcoDiag("sdk.usage_miss", {
      threadId: shortThreadId(threadId),
      role: resolved.missDiagnostic.role,
      eventId: resolved.missDiagnostic.eventId.slice(-12),
      parentToolUseId: resolved.missDiagnostic.parentToolUseId?.slice(-12),
      explicitSubagentId: resolved.missDiagnostic.explicitSubagentId?.slice(-12) ?? null,
    });
  }

  const diagnostic = resolved.diagnostic;
  logEcoDiagThrottled(
    diagnostic.throttleKey,
    "sdk.usage",
    {
      threadId: shortThreadId(threadId),
      role: diagnostic.role,
      subagentAgentId: diagnostic.subagentAgentId?.slice(-12) ?? null,
      explicit: diagnostic.explicit,
      parentToolUseId: diagnostic.parentToolUseId?.slice(-12) ?? null,
      stream: diagnostic.stream,
      inputTokens: diagnostic.inputTokens,
      outputTokens: diagnostic.outputTokens,
    },
    500,
  );
}

async function processSdkStreamPartialUsage(
  input: SdkStreamPartialBillingRequest,
): Promise<void> {
  const billingRuntime = await resolveBillingRuntimeContext(
    billingRuntimeEnvironment,
    input.threadId,
  );
  const resolved = await resolveSdkStreamPartialBillingOrchestration({
    request: input,
    runtimeRoutes: billingRuntime.runtimeRoutes,
    lookupPricing: billingRuntime.lookupPricing,
  });

  await applySdkStreamPartialBillingEffects(usageBillingEffectsServices(), resolved.effectsInput);
}

async function processSdkRunBilling(input: {
  threadId: string;
  role: AgentRole;
  requestKey: string;
  bundle: SdkUsageBillingBundle;
  usagePayload?: unknown;
  runAttemptId?: string;
  plannerAgentId?: string;
  subagentAgentId?: string;
  parentToolUseId?: string;
}): Promise<void> {
  const billingRuntime = await resolveBillingRuntimeContext(
    billingRuntimeEnvironment,
    input.threadId,
  );
  const resolved = await resolveSdkRunBillingResolution({
    threadId: input.threadId,
    role: input.role,
    requestKey: input.requestKey,
    bundle: input.bundle,
    runtimeRoutes: billingRuntime.runtimeRoutes,
    lookupPricing: billingRuntime.lookupPricing,
    resolver: subagentMetricsRegistry,
    ...(input.usagePayload !== undefined && { usagePayload: input.usagePayload }),
    ...(input.runAttemptId && { runAttemptId: input.runAttemptId }),
    ...(input.plannerAgentId && { plannerAgentId: input.plannerAgentId }),
    ...(input.subagentAgentId && { subagentAgentId: input.subagentAgentId }),
    ...(input.parentToolUseId && { parentToolUseId: input.parentToolUseId }),
  });

  for (const observation of resolved.observations) {
    noteUsageBillingObservation(input.threadId, observation);
  }

  await applySdkRunBillingEffects(usageBillingEffectsServices(), resolved.effectsInput);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLinkAgentsSkillsRequest(value: unknown): value is LinkAgentsSkillsRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as LinkAgentsSkillsRequest).workspacePath === "string" &&
    ((value as LinkAgentsSkillsRequest).baseDir === undefined ||
      typeof (value as LinkAgentsSkillsRequest).baseDir === "string")
  );
}

async function buildSdkSessionOptions(
  threadId: string,
  prompt?: string,
): Promise<EcoSdkSessionOptions> {
  const mcp = mcpStore.buildSdkConfig();
  const thread = conversationStore.getThread(threadId);
  const hydrated = thread ? ensureThreadRuntimeConfig(thread) : undefined;
  const orchestrationMode =
    hydrated?.runtimeConfig?.orchestrationMode ?? workflowSettingsStore.get().orchestrationMode;
  const enabledSubagents =
    orchestrationMode === "autonomous"
      ? defaultSubagentAvailability()
      : (hydrated?.runtimeConfig?.subagentEnabled ?? subagentSettingsStore.get());
  const workspacePath =
    thread?.workspacePath ??
    (currentWorkspace?.path && currentWorkspace.path.trim() ? currentWorkspace.path : undefined);
  const discovered = await listDiscoveredSkills(workspacePath);
  const projectNames = listSdkReadyProjectSkills(discovered.projectSkills).map((skill) => skill.name);
  const explicitUser = filterExplicitUserSkillNames(prompt, discovered.userSkills);
  const merged = mergeSkillNames(projectNames, explicitUser);
  const agentSkills = Object.fromEntries(AGENT_ROLES.map((role) => [role, merged])) as Partial<
    Record<AgentRole, string[]>
  >;
  return {
    settingSources: ["user", "project"],
    ...(merged.length > 0 ? { skills: merged } : {}),
    agentSkills,
    enabledSubagents,
    mcpServers: mcp.mcpServers,
    mcpAllowedTools: mcp.allowedTools,
  };
}

function isSdkTodoProgressPayload(payload: unknown): payload is SdkTodoUpdatedPayload {
  return typeof payload === "object" && payload !== null && "sdkKind" in payload;
}

function isPlanReadyPayload(payload: unknown): payload is PlanReadyPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "userPrompt" in payload &&
    "analysis" in payload &&
    "plan" in payload &&
    typeof (payload as PlanReadyPayload).plan === "string"
  );
}

async function removeIsolatedWorktree(plan: WorktreePlan, threadId: string): Promise<void> {
  const session = conversationStore.getSdkSession(threadId);
  const sessionCwd = session?.cwd;
  try {
    await gitWorktrees.removeWorktree(plan);
    emitThreadEvent(threadId, "worktree.removed", "已清理隔离工作树。", "system");
  } catch (error) {
    console.error("Failed to remove worktree:", error);
  } finally {
    if (
      sessionCwd &&
      path.resolve(sessionCwd) === path.resolve(plan.worktreePath)
    ) {
      conversationStore.clearSdkSession(threadId);
    }
  }
}

async function runGitCommand(
  command: string[],
  cwd: string,
  options?: { stdin?: string },
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = execFile(
      command[0] === "git" ? resolveGitExecutable() : (command[0] ?? resolveGitExecutable()),
      command.slice(1),
      { cwd, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const failed = error as NodeJS.ErrnoException & { code?: number };
          resolve({
            exitCode: typeof failed.code === "number" ? failed.code : 1,
            stdout: String(stdout ?? ""),
            stderr: String(stderr ?? errorMessage(error)),
          });
          return;
        }
        resolve({ exitCode: 0, stdout: String(stdout), stderr: String(stderr) });
      },
    );
    if (options?.stdin !== undefined) {
      child.stdin?.end(options.stdin);
    } else {
      child.stdin?.end();
    }
  });
}

function normalizeThreadMessage(status: ThreadStatus, message: string): string {
  if (status === "failed") {
    return formatUserFacingRequestError(message);
  }
  if (message.startsWith(planExecutionFailurePrefix)) {
    const detail = message.slice(planExecutionFailurePrefix.length);
    return buildPlanExecutionFailureMessage(formatUserFacingRequestError(detail));
  }
  return message;
}

function updateThread(threadId: string, patch: Pick<ThreadSummary, "message" | "status">): void {
  if (!conversationStore.getThread(threadId)) {
    return;
  }

  const message = normalizeThreadMessage(patch.status, patch.message);
  conversationStore.updateThread(threadId, { ...patch, message });
  emitThreadEvent(threadId, `thread.${patch.status}`, message, "system");
}

function emitTodoList(threadId: string, todoList: CoderTodoItem[]): void {
  emitThreadEvent(threadId, "thread.todos_updated", "TODO 已更新", "system", false, {
    todoList,
  });
}

function emitSubagentTimingUpdated(threadId: string): void {
  emitThreadEvent(threadId, "thread.subagent_timing_updated", "", "system", false, {
    subagentSessions: buildSubagentSessionTimings(conversationStore.listSubagentSessions(threadId)),
  });
}

function emitThreadEvent(
  threadId: string,
  type: string,
  message: string,
  role: AgentRole | "system" | "thinking" | "tool" | "user" = "system",
  stream = false,
  extras?: {
    plan?: ThreadLiveEvent["plan"];
    clarification?: ThreadLiveEvent["clarification"];
    todoList?: ThreadLiveEvent["todoList"];
    title?: ThreadLiveEvent["title"];
    usage?: ThreadUsageSnapshot;
    modelId?: string;
    totalCostUsd?: number;
    modelUsage?: Record<string, ThreadModelUsageEntry>;
    billing?: ThreadBillingSnapshot;
    context?: ThreadContextSnapshot;
    agentId?: string;
    subagentSessions?: ThreadLiveEvent["subagentSessions"];
    apiError?: ThreadLiveEvent["apiError"];
  },
): void {
  const trimmed = message.trim();
  const isThreadStatusEvent = type.startsWith("thread.");
  const isUsageEvent = type === "thread.usage_updated";
  const isContextEvent = type === "thread.context_updated";
  const isSubagentTimingEvent = type === "thread.subagent_timing_updated";
  const allowEmptyStream = stream && trimmed.length === 0;
  if (
    !trimmed &&
    !allowEmptyStream &&
    !extras?.plan &&
    !extras?.clarification &&
    !extras?.subagentSessions?.length &&
    !isThreadStatusEvent &&
    !isUsageEvent &&
    !isContextEvent &&
    !isSubagentTimingEvent
  ) {
    return;
  }

  const displayMessage = trimmed || (isThreadStatusEvent ? "状态已更新" : "");

  const persistActivityLine =
    (!isThreadStatusEvent ||
      type === "thread.auto_retry" ||
      type === "thread.retry" ||
      type === "thread.user_prompt" ||
      type === "thread.api_error") &&
    !isUsageEvent &&
    !isContextEvent &&
    type !== "thread.todos_updated" &&
    type !== "thread.title_updated" &&
    type !== "thread.subagent_timing_updated";

  let persistedActivityLine: ThreadActivityLine | undefined;
  if (
    conversationStore.getThread(threadId) &&
    (displayMessage || allowEmptyStream) &&
    !extras?.todoList &&
    !extras?.title &&
    persistActivityLine
  ) {
    persistedActivityLine = conversationStore.appendActivityLine(threadId, {
      role: String(role),
      message: displayMessage,
      stream,
      ...(extras?.agentId?.trim() && { agentId: extras.agentId.trim() }),
      ...(extras?.apiError && { apiError: extras.apiError }),
    });
  }

  const payload: ThreadLiveEvent = {
    threadId,
    type,
    message: displayMessage || (extras?.plan ? "计划已就绪" : "状态已更新"),
    role,
    stream,
    ...(persistedActivityLine && { activityLine: persistedActivityLine }),
    ...(extras?.apiError && { apiError: extras.apiError }),
  };
  if (extras?.plan) {
    payload.plan = extras.plan;
  }
  if (extras?.clarification) {
    payload.clarification = extras.clarification;
  }
  if (extras?.todoList) {
    payload.todoList = extras.todoList;
  }
  if (extras?.title) {
    payload.title = extras.title;
  }
  if (extras?.usage) {
    payload.usage = extras.usage;
  }
  if (extras?.modelId) {
    payload.modelId = extras.modelId;
  }
  if (extras?.totalCostUsd !== undefined) {
    payload.totalCostUsd = extras.totalCostUsd;
  }
  if (extras?.modelUsage) {
    payload.modelUsage = extras.modelUsage;
  }
  if (extras?.billing) {
    payload.billing = extras.billing;
  }
  if (extras?.context) {
    payload.context = extras.context;
  }
  if (extras?.subagentSessions) {
    payload.subagentSessions = extras.subagentSessions;
  }

  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send(IPC_CHANNELS.threadEventsSubscribe, payload);
  });
}

function recordUserPrompt(threadId: string, prompt: string): void {
  emitThreadEvent(threadId, "thread.user_prompt", prompt, "user");
}

function archiveThreadContextBeforeCompaction(
  threadId: string,
  trigger: "auto" | "manual",
  sessionId?: string,
): void {
  compactionAuditService.archiveBeforeCompaction(threadId, {
    trigger,
    ...(sessionId && { sessionId }),
  });
}

function recordCompactionLedgerBoundary(
  threadId: string,
  payload: Record<string, unknown>,
  sourceEventId?: string,
): void {
  compactionAuditService.recordBoundary(threadId, payload, sourceEventId);
}

function createThreadHookContext(threadId: string): EcoHookContext {
  return {
    askUserQuestion: async (parsed) => {
      updateThread(threadId, { status: "running", message: "等待你的回答…" });
      const clarificationRequest: ThreadLiveEvent["clarification"] = {
        toolUseId: parsed.toolUseId,
        threadId,
        questions: parsed.questions,
      };
      emitThreadEvent(threadId, "clarification.requested", "Planner 需要你回答几个问题。", "planner", false, {
        clarification: clarificationRequest,
      });
      const answers = await registerPendingClarification(threadId, parsed.toolUseId, parsed);
      updateThread(threadId, { status: "running", message: "正在分析并制定计划…" });
      emitThreadEvent(
        threadId,
        "clarification.answered",
        formatClarificationAnswersSummary(
          { toolUseId: parsed.toolUseId, threadId, questions: parsed.questions },
          answers,
        ),
        "planner",
        false,
      );
      return buildAskUserQuestionUpdatedInput(
        { toolUseId: parsed.toolUseId, threadId, questions: parsed.questions },
        answers,
        parsed.rawInput,
      );
    },
    resolveChangedFiles: async () => {
      const worktreePlan = activeRunRuntimeState.worktreePlan(threadId);
      if (!worktreePlan) {
        return [];
      }
      try {
        return await gitWorktrees.changedFiles(worktreePlan);
      } catch (error) {
        console.error("Failed to list worktree files for reviewer scope:", error);
        return [];
      }
    },
    onNotification: ({ message, notificationType }) => {
      if (notificationType === "permission_prompt") {
        updateThread(threadId, { status: "running", message: "等待工具权限确认…" });
        return;
      }
      if (notificationType === "idle_prompt") {
        updateThread(threadId, { status: "running", message: message.trim() || "Agent 等待输入…" });
      }
    },
    onPreCompact: async (input) => {
      archiveThreadContextBeforeCompaction(threadId, input.trigger, input.sessionId);
    },
  };
}

function isClarificationSubmitPayload(value: unknown): value is ClarificationSubmitPayload {
  if (!value || typeof value !== "object") {
    return false;
  }
  const payload = value as ClarificationSubmitPayload;
  return (
    typeof payload.toolUseId === "string" &&
    payload.toolUseId.trim().length > 0 &&
    Array.isArray(payload.selections)
  );
}

function emitSettingsUpdated(): void {
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send(IPC_CHANNELS.threadEventsSubscribe, {
      threadId: "settings",
      type: "settings.updated",
      message: "Model provider settings saved.",
    });
  });
}

interface RuntimeRoute {
  role: AgentRole;
  provider: ProviderConfigSecret;
  modelId: string;
  apiCompat: import("../shared/api-compat").UpstreamApiCompat;
  thinkingEffort?: ThinkingEffort;
}

interface RuntimeConfig {
  routes: RuntimeRoute[];
}

type RuntimeConfigResolution = { ok: true; routes: RuntimeRoute[] } | { ok: false; reason: string };

const lastConnectionErrorEmitByThread = new Map<string, { at: number; message: string }>();

function emitUpstreamModelRequestActivity(threadId: string, role: AgentRole): void {
  emitThreadEvent(threadId, "otel.activity", "Requesting model…", role, false);
}

function emitUpstreamConnectionErrorActivity(
  threadId: string,
  role: AgentRole,
  error: string,
  statusCode?: number,
): void {
  const detail = formatUserFacingRequestError(error);
  const summary = statusCode ? `HTTP ${statusCode}` : detail;
  const message =
    summary === detail
      ? `【连接失败】${summary}`
      : `【连接失败】${summary}：${detail}`;
  const now = Date.now();
  const last = lastConnectionErrorEmitByThread.get(threadId);
  if (last && last.message === message && now - last.at < 4000) {
    return;
  }
  lastConnectionErrorEmitByThread.set(threadId, { at: now, message });
  emitThreadEvent(threadId, "otel.activity", message, role, false);
}

function startRuntimeProxy(
  routes: RuntimeRoute[],
  attachments?: PromptImageAttachment[],
  threadId?: string,
  proxyThreadOptions?: { emitRequestActivity?: boolean },
): Promise<Awaited<ReturnType<typeof startAnthropicModelProxy>>> {
  const upstreamUserAgent = resolveUpstreamUserAgentOverride(proxyBridgeSettingsStore.get());
  const emitRequestActivity = proxyThreadOptions?.emitRequestActivity !== false;
  const options: AnthropicProxyStartOptions = {
    ...(upstreamUserAgent && { upstreamUserAgent }),
    ...(attachments && attachments.length > 0 && { pendingImages: attachments }),
    ...(threadId && {
      ...(emitRequestActivity && {
        onMessagesRequest: ({ role }) => {
          emitUpstreamModelRequestActivity(threadId, role);
        },
      }),
      onUpstreamConnectionError: ({ role, error, statusCode }) => {
        emitUpstreamConnectionErrorActivity(threadId, role, error, statusCode);
      },
      onUsage: ((info) => emitProxyUsage({ ...info, threadId })) satisfies AnthropicProxyUsageHandler,
      resolveCountTokensInput: ({ role, body }) => {
        const fromProxy = activeRunBillingState.proxyContextOccupied(threadId, role);
        if (typeof fromProxy === "number" && fromProxy > 0) {
          logEcoDiagThrottled(`count-tokens:${threadId}`, "count_tokens.stub", {
            threadId: shortThreadId(threadId),
            role,
            source: "proxy_role",
            tokens: fromProxy,
          });
          return fromProxy;
        }
        const monitorSnap = contextMonitor.getSnapshot(threadId);
        const roleSnap = monitorSnap?.roles.find((entry) => entry.role === role);
        const fromMonitorRole = roleSnap?.occupied;
        if (typeof fromMonitorRole === "number" && fromMonitorRole > 0) {
          logEcoDiagThrottled(`count-tokens:${threadId}`, "count_tokens.stub", {
            threadId: shortThreadId(threadId),
            role,
            source: "monitor_role",
            tokens: fromMonitorRole,
            displayRole: monitorSnap?.displayRole,
          });
          return fromMonitorRole;
        }
        const fromMonitorTop = monitorSnap?.occupied;
        if (typeof fromMonitorTop === "number" && fromMonitorTop > 0) {
          logEcoDiagThrottled(`count-tokens:${threadId}`, "count_tokens.stub", {
            threadId: shortThreadId(threadId),
            role,
            source: "monitor_display",
            tokens: fromMonitorTop,
            displayRole: monitorSnap?.displayRole,
          });
          return fromMonitorTop;
        }
        const estimated = estimateInputTokensFromAnthropicBody(body);
        logEcoDiagThrottled(`count-tokens:${threadId}`, "count_tokens.stub", {
          threadId: shortThreadId(threadId),
          role,
          source: "body_estimate",
          tokens: estimated,
        });
        return estimated;
      },
    }),
  };
  return startAnthropicModelProxy(routes, options);
}

function resolveRuntimeConfig(
  settings: ModelSettingsSnapshot,
  providersWithSecrets: ProviderConfigSecret[],
  routesOverride?: readonly RoleRouteConfig[],
): RuntimeConfigResolution {
  const providersById = new Map(providersWithSecrets.map((provider) => [provider.id, provider]));
  const activeRoutes = routesOverride ?? [];
  const routes = activeRoutes.map((route): RuntimeRoute | undefined => {
    const provider = providersById.get(route.providerId);
    if (!provider) return undefined;
    return {
      role: route.role,
      provider,
      modelId: route.modelId,
      apiCompat: resolveUpstreamApiCompat(route.apiCompat, provider.apiCompat),
      ...(route.thinkingEffort && { thinkingEffort: route.thinkingEffort }),
      ...(route.modelsDevMapping && { modelsDevMapping: route.modelsDevMapping }),
    };
  });

  const missingRoute = activeRoutes.find((route) => !providersById.has(route.providerId));
  if (missingRoute) {
    return { ok: false, reason: `Route ${missingRoute.role} references a missing provider.` };
  }

  for (const role of AGENT_ROLES) {
    const route = routes.find((candidate): candidate is RuntimeRoute => candidate?.role === role);
    if (!route) {
      return { ok: false, reason: `Configure a ${role} route before starting a coding thread.` };
    }
    if (!route.modelId.trim()) {
      return { ok: false, reason: `Model id is required for ${role}.` };
    }
    if (!route.provider.enabled) {
      return { ok: false, reason: `Provider "${route.provider.name}" for ${role} is disabled.` };
    }
  }

  return {
    ok: true,
    routes: routes.filter((route): route is RuntimeRoute => Boolean(route)),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
