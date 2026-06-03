import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeRequestBilling,
  computeSavings,
  formatUsageBadge,
  parseSdkUsageBilling,
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
  extractCompactPostTokens,
  extractSdkRunFailure,
  type EcoHookContext,
  type SdkTodoUpdatedPayload,
} from "@eco/runtime/sdk";
import {
  createRedisSessionStore,
  createSqliteSessionStore,
  testRedisConnection,
  type SessionStore,
} from "@eco/persistence";
import type { ResolvedModelRoute } from "@eco/model-router";
import {
  createWorktreePlan,
  GitWorktreeService,
  type CommandRunner,
  type WorktreePlan,
} from "@eco/workspace";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import {
  AGENT_ROLES,
  type AgentRole,
  type BillingUsageSource,
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
  type AgentSkillAssignments,
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
  type WorkspaceInfo,
} from "../shared/ipc";
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
  isWorktreeGitCwdError,
  resolveWorktreePathHint,
  writeApprovedPlanSnapshot,
} from "./worktree-lifecycle";
import {
  buildPlanExecutionFailureMessage,
  planExecutionFailurePrefix,
} from "../shared/thread-failure-message";
import { buildAgentPromptWithContext, isContinuableThreadStatus } from "../shared/thread-continuation";
import {
  computeRouteFingerprint,
  routesMatchFingerprint,
} from "../shared/route-fingerprint";
import {
  pendingThreadTitle,
  summarizeThreadTitleWithCoder,
  threadTitleFromPlannerPlan,
} from "./thread-title";
import { createConversationStore, type ConversationStore } from "./conversation-store";
import { createSessionSyncStore, type SessionSyncStore } from "./session-sync-store";
import {
  createModelAlias,
  startAnthropicModelProxy,
  type AnthropicProxyResolvedRoute,
  type AnthropicProxyStartOptions,
  type AnthropicProxyUsageHandler,
  type AnthropicProxyUsageInfo,
} from "./anthropic-proxy";
import type { UpstreamProxyCallBilling } from "./upstream-proxy-log";
import {
  buildPlannerModelLabel,
  lookupRouteCapabilityHints,
  lookupRoutePricingHints,
  resolveRatesForRoute,
  resolveRuntimeRoutesFromSettings,
  resolveUsageRoute,
} from "./billing-resolver";
import {
  buildAssistantUsageRequestKey,
  buildUsageSnapshotForRole,
  isSdkIncrementalStreamUsage,
  nextOtelRequestDedupId,
  shouldBillAssistantSubagentUsage,
  shouldUpdateContextFromUsageSource,
} from "./billing-orchestration";
import { ModelsDevPricingCache } from "./models-dev-pricing-cache";
import { ContextWindowMonitor } from "./context-window-monitor";
import { ContextSnapshotScheduler } from "./context-snapshot-scheduler";
import {
  buildUsageRequestKey,
  ThreadUsageAccumulator,
} from "./thread-usage-accumulator";
import { getUpstreamLogFilePath } from "./upstream-log";
import { createMcpStore, type McpStore } from "./mcp-store";
import { localOtelReceiver } from "./otel-receiver";
import { listDiscoveredSkills } from "./skills-discovery";
import { listProviderUpstreamModels, testProviderConnection, testRoleRoutes } from "./provider-models";
import { SdkStreamActivityBridge } from "./sdk-stream-activity";
import { createAgentSkillsStore, type AgentSkillsStore } from "./agent-skills-store";
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
import { workspaceSupportsWorktree } from "../shared/workspace-readiness";
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
const gitRunner: CommandRunner = {
  run: runGitCommand,
};
const gitWorktrees = new GitWorktreeService(gitRunner);
let currentWorkspace: WorkspaceInfo | undefined;
let providerStore: ProviderStore;
let mcpStore: McpStore;
let conversationStore: ConversationStore;
let agentSkillsStore: AgentSkillsStore;
let subagentSettingsStore: SubagentSettingsStore;
let workflowSettingsStore: WorkflowSettingsStore;
let proxyBridgeSettingsStore: ProxyBridgeSettingsStore;
let sessionSyncStore: SessionSyncStore;
let sdkSessionStore: SessionStore | undefined;
let closeSdkSessionStore: (() => Promise<void>) | undefined;

interface ActiveThreadRun {
  controller: AbortController;
  worktreePlan?: WorktreePlan;
  worktreeReady?: boolean;
  /** True once OTel api_request token usage was billed this run. */
  otelTokenBilled?: boolean;
  otelRequestSeq?: number;
  /** True once proxy-captured response usage was billed this run. */
  proxyTokenBilled?: boolean;
  proxyRequestSeq?: number;
  /** Roles whose context window has been captured by the proxy during this run. */
  proxyContextRolesSeen?: Set<AgentRole>;
}

const activeRuns = new Map<string, ActiveThreadRun>();
const pendingCancelDisposition = new Map<string, WorktreeCancelDisposition>();
const threadUsageAccumulator = new ThreadUsageAccumulator();
const persistMetricsTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingUsageUpdates = new Map<string, Set<Promise<void>>>();
const sdkStreamBridge = new SdkStreamActivityBridge();
let pricingCache: ModelsDevPricingCache;
let pricingCatalogReady: Promise<void> = Promise.resolve();
let contextMonitor: ContextWindowMonitor;
let contextScheduler: ContextSnapshotScheduler;

type AgentEventLike = Pick<AgentEvent, "type" | "payload" | "role" | "agentId">;

async function createMainWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1080,
    minHeight: 720,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#212121",
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
  const dbPath = path.join(app.getPath("userData"), "eco-coding.sqlite");
  providerStore = await createProviderStore(dbPath);
  mcpStore = await createMcpStore(dbPath);
  conversationStore = await createConversationStore(dbPath);
  agentSkillsStore = await createAgentSkillsStore(dbPath);
  subagentSettingsStore = await createSubagentSettingsStore(dbPath);
  workflowSettingsStore = await createWorkflowSettingsStore(dbPath);
  proxyBridgeSettingsStore = await createProxyBridgeSettingsStore(dbPath);
  sessionSyncStore = await createSessionSyncStore(dbPath);
  pricingCache = new ModelsDevPricingCache({
    cachePath: path.join(app.getPath("userData"), "models-dev-pricing.json"),
  });
  pricingCatalogReady = pricingCache.getCatalog().then(
    () => {},
    (error) => {
      process.stderr.write(`[eco] models.dev pricing cache init failed: ${errorMessage(error)}\n`);
    },
  );
  contextMonitor = new ContextWindowMonitor(pricingCache);
  contextScheduler = new ContextSnapshotScheduler({
    monitor: contextMonitor,
    isThreadRunning: (threadId) => activeRuns.has(threadId),
    getResume: (threadId, worktreePath) => resolveResumeOptions(threadId, worktreePath),
    isWorktreePathReady: async (worktreePath) => {
      if (!(await fileExists(worktreePath))) {
        return false;
      }
      return gitWorktrees.isInsideWorktree(worktreePath);
    },
    withSdkDriver: async (threadId, fn) => {
      const roleRoutes = resolveRoleRoutesForThread(threadId);
      const runtimeConfig = resolveRuntimeConfig(
        providerStore.getSettings(),
        providerStore.listProvidersWithSecrets(),
        roleRoutes,
      );
      if (!runtimeConfig.ok) {
        throw new Error(runtimeConfig.reason);
      }
      const attemptProxy = await startRuntimeProxy(runtimeConfig.routes, undefined, threadId);
      const driverRoutes = buildDriverRoutes(attemptProxy.routes);
      try {
        const driver = createSdkDriver(threadId, attemptProxy);
        const controller = new AbortController();
        await fn(driver, controller.signal, driverRoutes);
      } finally {
        await attemptProxy.close();
      }
    },
    emitContext: emitThreadContextUpdated,
    emitActivity: (threadId, message) => {
      emitThreadEvent(threadId, "otel.activity", message, "system", false);
    },
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

function threadUsesPlanOrchestration(threadId: string): boolean {
  const thread = conversationStore.getThread(threadId);
  const config = thread ? ensureThreadRuntimeConfig(thread).runtimeConfig : undefined;
  return config?.planModeEnabled ?? workflowSettingsStore.get().planModeEnabled;
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
    invalidateSdkSessionIfRoutesChanged(threadId, roleRoutesForThreadConfig(providerStore.getSettings(), runtimeConfig));
    return { thread: ensureThreadRuntimeConfig(conversationStore.getThread(threadId) ?? thread) };
  });

  ipcMain.handle(IPC_CHANNELS.threadActivityList, async (_event, threadId: string) => {
    if (typeof threadId !== "string" || !threadId.trim()) {
      return [];
    }
    return conversationStore.listActivityLines(threadId);
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

  ipcMain.handle(IPC_CHANNELS.agentSkillsGet, async () => agentSkillsStore.getAssignments());

  ipcMain.handle(IPC_CHANNELS.agentSkillsSave, async (_event, payload: unknown) => {
    if (!isAgentSkillAssignments(payload)) {
      throw new Error("Invalid agent skills assignments.");
    }
    const pathToScan = currentWorkspace?.path;
    const discovered = await listDiscoveredSkills(pathToScan);
    const allowed = new Set(
      [...discovered.userSkills, ...discovered.projectSkills].map((skill) => skill.name),
    );
    return agentSkillsStore.saveAssignments(payload, allowed);
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
    return getWorktreeStatus(threadId);
  });

  ipcMain.handle(IPC_CHANNELS.worktreeApply, async (_event, threadId: unknown) => {
    if (typeof threadId !== "string" || !threadId.trim()) {
      throw new Error("Thread id is required.");
    }
    return applyWorktreeForThread(threadId);
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
      } else if (threadRuntime.planModeEnabled) {
        void runCodingThreadPlanning(thread, workspace, runtimeConfig, prompt, undefined, undefined, attachments, roleRoutes);
      } else {
        void runCodingThreadSdkDefault(thread, workspace, runtimeConfig, prompt, undefined, undefined, attachments, roleRoutes);
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
    if (activeRuns.has(threadId)) {
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
    void runCodingThreadExecution(threadId, runtimeConfig, { routesOverride: roleRoutes });
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
    if (thread.status === "awaiting_plan") {
      await dismissPendingPlan(payload.threadId, "已忽略原计划。");
    }

    const workspace = await ensureWorkspace(thread.workspacePath);
    const settings = providerStore.getSettings();
    if (payload.runtimeConfig) {
      const nextConfig = parseThreadRuntimeConfigInput(payload.runtimeConfig);
      roleRoutesForThreadConfig(settings, nextConfig);
      conversationStore.saveThreadRuntimeConfig(payload.threadId, nextConfig);
    }
    const roleRoutes = resolveRoleRoutesForThread(payload.threadId);
    invalidateSdkSessionIfRoutesChanged(payload.threadId, roleRoutes);

    const runtimeConfig = resolveRuntimeConfig(
      settings,
      providerStore.listProvidersWithSecrets(),
      roleRoutes,
    );
    if (!runtimeConfig.ok) {
      throw new Error(runtimeConfig.reason);
    }

    const intent = classifyThreadIntent(prompt);
    const activityLines = conversationStore.listActivityLines(payload.threadId);
    const sdkSession = conversationStore.getSdkSession(payload.threadId);
    const defaultPlan = createWorktreePlan(workspace.path, payload.threadId);
    let cwd = workspace.path;
    if (sdkSession?.cwd) {
      cwd = sdkSession.cwd;
    } else if (
      workspaceSupportsWorktree(workspace) &&
      (await fileExists(defaultPlan.worktreePath))
    ) {
      cwd = defaultPlan.worktreePath;
    }
    const canResume = Boolean(sdkSession?.sessionId && sdkSession.cwd === cwd);
    const existingWorktreePlan =
      isIsolatedWorktreePlan({ workspacePath: workspace.path, worktreePath: cwd })
        ? resolveWorktreePlan(workspace.path, payload.threadId, cwd)
        : undefined;
    const continuePhase = canResume ? resolveContinuePhase(thread, intent) : undefined;
    const agentPrompt = canResume
      ? prompt
      : buildAgentPromptWithContext(thread.prompt, prompt, activityLines);
    const statusMessage =
      continuePhase === "question"
        ? "正在回答…"
        : continuePhase === "execution"
          ? "正在继续执行…"
          : "正在分析并制定计划…";

    updateThread(payload.threadId, {
      status: "running",
      message: intent === "question" && !canResume ? "正在回答…" : statusMessage,
    });
    recordUserPrompt(payload.threadId, prompt);

    const updated: ThreadSummary = {
      ...thread,
      status: "running",
      message: intent === "question" && !canResume ? "正在回答…" : statusMessage,
    };

    if (canResume && continuePhase) {
      void (async () => {
        const headroomController = new AbortController();
        await ensureContextHeadroom(payload.threadId, cwd, headroomController.signal);
        if (!threadUsesPlanOrchestration(payload.threadId) && continuePhase !== "question") {
          await runCodingThreadSdkDefault(
            updated,
            workspace,
            runtimeConfig,
            agentPrompt,
            existingWorktreePlan,
            resolveResumeOptions(payload.threadId, cwd),
            payload.attachments,
            roleRoutes,
          );
          return;
        }
        await runThreadContinuation(
          updated,
          workspace,
          runtimeConfig,
          agentPrompt,
          continuePhase,
          existingWorktreePlan,
          payload.attachments,
          roleRoutes,
        );
      })();
    } else if (intent === "question") {
      void runQuestionThread(
        updated,
        workspace,
        runtimeConfig,
        agentPrompt,
        cwd !== workspace.path ? cwd : undefined,
        undefined,
        payload.attachments,
        roleRoutes,
      );
    } else if (threadUsesPlanOrchestration(payload.threadId)) {
      void runCodingThreadPlanning(
        updated,
        workspace,
        runtimeConfig,
        agentPrompt,
        existingWorktreePlan,
        undefined,
        payload.attachments,
        roleRoutes,
      );
    } else {
      void runCodingThreadSdkDefault(
        updated,
        workspace,
        runtimeConfig,
        agentPrompt,
        existingWorktreePlan,
        undefined,
        payload.attachments,
        roleRoutes,
      );
    }
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
    const active = activeRuns.get(threadId);
    if (active) {
      updateThread(threadId, { status: "running", message: "正在停止…" });
      cancelClarificationsForThread(threadId, "cancelled by user");
      active.controller.abort("cancelled by user");
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
  const worktreePlan = existingWorktreePlan ?? createWorktreePlan(workspace.path, threadId);
  if (!workspaceSupportsWorktree(workspace)) {
    return { worktreePlan, cwd: workspace.path, isolated: false };
  }

  const worktreeExists = await fileExists(worktreePlan.worktreePath);
  if (!worktreeExists) {
    await fs.mkdir(path.dirname(worktreePlan.worktreePath), { recursive: true });
    await gitWorktrees.createWorktree(worktreePlan);
    return { worktreePlan, cwd: worktreePlan.worktreePath, isolated: true };
  }

  if (!(await gitWorktrees.isInsideWorktree(worktreePlan.worktreePath))) {
    await fs.rm(worktreePlan.worktreePath, { recursive: true, force: true });
    await fs.mkdir(path.dirname(worktreePlan.worktreePath), { recursive: true });
    await gitWorktrees.createWorktree(worktreePlan);
  }
  return { worktreePlan, cwd: worktreePlan.worktreePath, isolated: true };
}

function isIsolatedWorktreePlan(plan: Pick<WorktreePlan, "workspacePath" | "worktreePath">): boolean {
  return path.resolve(plan.worktreePath) !== path.resolve(plan.workspacePath);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function applyThreadTitleSummary(threadId: string, prompt: string, title: string | undefined): void {
  if (!title) {
    return;
  }
  const thread = conversationStore.getThread(threadId);
  if (!thread || thread.prompt !== prompt || thread.title === title) {
    return;
  }

  conversationStore.updateThreadTitle(threadId, title);
  emitThreadEvent(threadId, "thread.title_updated", "标题已更新", "system", false, { title });
}

function scheduleThreadTitleSummary(
  threadId: string,
  prompt: string,
  runtimeConfig: RuntimeConfig,
  context?: { plan?: string; analysis?: string },
): void {
  const planText = context?.plan?.trim();
  if (planText) {
    applyThreadTitleSummary(threadId, prompt, threadTitleFromPlannerPlan(planText, prompt));
    return;
  }

  void summarizeThreadTitleWithCoder(runtimeConfig.routes, prompt, fetch, context)
    .then((title) => {
      applyThreadTitleSummary(threadId, prompt, title);
    })
    .catch((error) => {
      process.stderr.write(`[eco] title summary failed: ${errorMessage(error)}\n`);
    });
}

function runThreadRequestWithAutoRetry(
  threadId: string,
  signal: AbortSignal | undefined,
  runOnce: () => Promise<RequestAttemptResult>,
): Promise<RequestAttemptResult> {
  return runWithRequestAutoRetry(runOnce, {
    signal,
    onRetryScheduled: (retryIndex, maxRetries, reason) => {
      const short = reason.length > 100 ? `${reason.slice(0, 97)}…` : reason;
      const message = `【自动重试 ${retryIndex}/${maxRetries}】${REQUEST_AUTO_RETRY_INTERVAL_MS / 1000} 秒后重试：${short}`;
      emitThreadEvent(threadId, "thread.auto_retry", message, "system");
      updateThread(threadId, { status: "running", message });
    },
  });
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
  activeRuns.set(thread.id, { controller, worktreePlan: createWorktreePlan(workspace.path, thread.id), worktreeReady: Boolean(worktreePath) });
  resetSubagentContextWindows(thread.id);

  try {
    const outcome = await runThreadRequestWithAutoRetry(thread.id, controller.signal, async () => {
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
      try {
        const driver = createSdkDriver(thread.id, attemptProxy);
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
          sdkSession: buildSdkSessionOptions(thread.id),
          ...(resume ? { resume } : {}),
        })) {
          if (event.type === "usage.recorded") {
            sdkFailure = extractSdkRunFailure(event.payload) ?? sdkFailure;
            recordSdkUsageFromEvent(thread.id, event);
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
        requestThreadContextRefresh(thread.id, true);
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

    if (outcome.aborted) {
      cancelClarificationsForThread(thread.id, "cancelled by user");
      const plan = resolveWorktreePlan(workspace.path, thread.id, cwd);
      await handleRunCancelled(thread.id, plan);
      return;
    }
    if (!outcome.ok) {
      updateThread(thread.id, { status: "failed", message: outcome.reason });
      return;
    }

    updateThread(thread.id, { status: "completed", message: "回答完成。" });
    scheduleThreadTitleSummary(thread.id, prompt, runtimeConfig);
  } catch (error) {
    cancelClarificationsForThread(thread.id, errorMessage(error));
    updateThread(thread.id, {
      status: "failed",
      message: errorMessage(error),
    });
  } finally {
    const worktreePath = resolveThreadWorktreePath(thread.id);
    cancelClarificationsForThread(thread.id, "run finished");
    sdkStreamBridge.resetThread(thread.id);
    await flushUsageUpdates(thread.id);
    activeRuns.delete(thread.id);
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
  if (isIsolatedWorktreePlan(worktreePlan)) {
    updateThread(threadId, {
      status: "idle",
      message: "代理执行完成，正在合并工作树更改…",
    });

    try {
      const { files, message, diff } = await applyWorktreeChanges(worktreePlan);
      conversationStore.saveAppliedDiff(threadId, worktreePlan.workspacePath, diff, files);
      updateThread(threadId, { status: "completed", message });
      emitThreadEvent(threadId, "worktree.applied", message, "system");
      process.stderr.write(`[eco] worktree apply ok (${files.length} files): ${files.join(", ")}\n`);
      await cleanupWorktreeForThread(threadId);
    } catch (applyError) {
      const detail = errorMessage(applyError);
      process.stderr.write(`[eco] worktree apply failed: ${detail}\n`);
      updateThread(threadId, {
        status: "completed",
        message: `执行已完成，但未能合并到工作区：${detail}。可点击「应用到工作区」重试，或手动处理 ${worktreePlan.worktreePath}。`,
      });
      emitThreadEvent(threadId, "worktree.apply_failed", detail, "system");
    }
    return;
  }

  updateThread(threadId, { status: "completed", message: "执行完成，变更已写入项目目录。" });
  emitThreadEvent(threadId, "thread.completed", "执行完成。", "system");
}

async function runCodingThreadSdkDefault(
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
  activeRuns.set(thread.id, {
    controller,
    worktreePlan: existingWorktreePlan ?? createWorktreePlan(workspace.path, thread.id),
    worktreeReady: false,
  });
  resetSubagentContextWindows(thread.id);

  let worktreePlan = existingWorktreePlan ?? createWorktreePlan(workspace.path, thread.id);

  try {
    const { worktreePlan: resolvedPlan, cwd, isolated } = await resolveThreadWorktree(
      workspace,
      thread.id,
      existingWorktreePlan,
    );
    worktreePlan = resolvedPlan;
    activeRuns.get(thread.id)!.worktreePlan = worktreePlan;
    activeRuns.get(thread.id)!.worktreeReady = true;
    updateThread(thread.id, {
      message: isolated
        ? `Isolated worktree ready: ${worktreePlan.worktreePath}`
        : `Working in project directory: ${workspace.path}`,
      status: "running",
    });

    const runOutcome = await runThreadRequestWithAutoRetry(thread.id, controller.signal, async () => {
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

      try {
        const driver = createSdkDriver(thread.id, attemptProxy);
        let sdkFailure: string | undefined;
        const effectiveResume = resume ?? resolveResumeOptions(thread.id, cwd);

        for await (const event of driver.run({
          threadId: thread.id,
          prompt,
          workspacePath: workspace.path,
          worktreePath: cwd,
          routes,
          signal: controller.signal,
          sdkSession: buildSdkSessionOptions(thread.id),
          ...(effectiveResume ? { resume: effectiveResume } : {}),
        })) {
          if (event.type === "usage.recorded") {
            sdkFailure = extractSdkRunFailure(event.payload) ?? sdkFailure;
            recordSdkUsageFromEvent(thread.id, event);
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

    if (runOutcome.aborted) {
      cancelClarificationsForThread(thread.id, "cancelled by user");
      await handleRunCancelled(thread.id, worktreePlan);
      return;
    }
    if (!runOutcome.ok) {
      cancelClarificationsForThread(thread.id, runOutcome.reason);
      updateThread(thread.id, {
        status: "failed",
        message: runOutcome.reason,
      });
      await cleanupWorktreeForThread(thread.id);
      return;
    }

    await completeCodingThreadRun(thread.id, worktreePlan);
    scheduleThreadTitleSummary(thread.id, prompt, runtimeConfig);
    requestThreadContextRefresh(thread.id, true);
  } catch (error) {
    cancelClarificationsForThread(thread.id, errorMessage(error));
    updateThread(thread.id, {
      status: "failed",
      message: errorMessage(error),
    });
    await cleanupWorktreeForThread(thread.id);
  } finally {
    const worktreePath = resolveThreadWorktreePath(thread.id);
    cancelClarificationsForThread(thread.id, "run finished");
    sdkStreamBridge.resetThread(thread.id);
    await flushUsageUpdates(thread.id);
    activeRuns.delete(thread.id);
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
  activeRuns.set(thread.id, {
    controller,
    worktreePlan: existingWorktreePlan ?? createWorktreePlan(workspace.path, thread.id),
    worktreeReady: false,
  });
  resetSubagentContextWindows(thread.id);

  try {
    const { worktreePlan, cwd, isolated } = await resolveThreadWorktree(
      workspace,
      thread.id,
      existingWorktreePlan,
    );
    activeRuns.get(thread.id)!.worktreePlan = worktreePlan;
    activeRuns.get(thread.id)!.worktreeReady = true;
    updateThread(thread.id, {
      message: isolated
        ? `Isolated worktree ready: ${worktreePlan.worktreePath}`
        : `Working in project directory: ${workspace.path}`,
      status: "running",
    });

    const planningOutcome = await runThreadRequestWithAutoRetry(thread.id, controller.signal, async () => {
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

      try {
        const driver = createSdkDriver(thread.id, attemptProxy);

        let sdkFailure: string | undefined;
        let captured = false;

        const effectiveResume = resume ?? resolveResumeOptions(thread.id, cwd);

        for await (const event of driver.run({
          threadId: thread.id,
          prompt,
          workspacePath: workspace.path,
          worktreePath: cwd,
          routes,
          signal: controller.signal,
          sdkSession: buildSdkSessionOptions(thread.id),
          ...(effectiveResume ? { resume: effectiveResume } : {}),
        })) {
          if (event.type === "usage.recorded") {
            sdkFailure = extractSdkRunFailure(event.payload) ?? sdkFailure;
            recordSdkUsageFromEvent(thread.id, event);
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
            scheduleThreadTitleSummary(thread.id, prompt, runtimeConfig, {
              plan: event.payload.plan,
              analysis: event.payload.analysis,
            });
          }

          if (event.type === "usage.recorded") {
            sdkFailure = extractSdkRunFailure(event.payload) ?? sdkFailure;
            recordSdkUsageFromEvent(thread.id, event);
            continue;
          }

          emitSdkStreamActivity(thread.id, event);
        }

        if (controller.signal.aborted) {
          return { ok: false, reason: "cancelled by user", aborted: true };
        }
        if (sdkFailure) {
          return { ok: false, reason: sdkFailure };
        }
        if (!captured) {
          return { ok: false, reason: "未能生成可执行的计划。" };
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

    if (planningOutcome.aborted) {
      cancelClarificationsForThread(thread.id, "cancelled by user");
      await handleRunCancelled(thread.id, worktreePlan);
      return;
    }
    if (!planningOutcome.ok) {
      cancelClarificationsForThread(thread.id, planningOutcome.reason);
      updateThread(thread.id, {
        status: "failed",
        message: planningOutcome.reason,
      });
      await cleanupWorktreeForThread(thread.id);
      return;
    }

    updateThread(thread.id, {
      status: "awaiting_plan",
      message: "等待你确认计划。",
    });
    requestThreadContextRefresh(thread.id, true);
  } catch (error) {
    cancelClarificationsForThread(thread.id, errorMessage(error));
    updateThread(thread.id, {
      status: "failed",
      message: errorMessage(error),
    });
    await cleanupWorktreeForThread(thread.id);
  } finally {
    const worktreePath = resolveThreadWorktreePath(thread.id);
    cancelClarificationsForThread(thread.id, "run finished");
    sdkStreamBridge.resetThread(thread.id);
    await flushUsageUpdates(thread.id);
    activeRuns.delete(thread.id);
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

async function runCodingThreadExecution(
  threadId: string,
  runtimeConfig: RuntimeConfig,
  options?: { planUserEdited?: boolean; routesOverride?: readonly RoleRouteConfig[] },
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
  activeRuns.set(threadId, { controller, worktreePlan, worktreeReady: false });
  resetSubagentContextWindows(threadId);

  const workspace = await ensureWorkspace(pending.workspacePath);
  let executionCwd = pending.worktreePath;
  if (workspaceSupportsWorktree(workspace) && isIsolatedWorktreePlan(worktreePlan)) {
    const resolved = await resolveThreadWorktree(workspace, threadId, worktreePlan);
    worktreePlan = resolved.worktreePlan;
    executionCwd = resolved.cwd;
    activeRuns.get(threadId)!.worktreePlan = worktreePlan;
    activeRuns.get(threadId)!.worktreeReady = resolved.isolated;
  } else {
    activeRuns.get(threadId)!.worktreeReady = true;
  }

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

    const executionOutcome = await runThreadRequestWithAutoRetry(threadId, controller.signal, async () => {
      const freshConfig = resolveRuntimeConfigFresh(options?.routesOverride);
      if (!freshConfig.ok) {
        return { ok: false, reason: freshConfig.reason };
      }
      recordThreadRouteFingerprint(threadId, freshConfig.routes);
      const attemptProxy = await startRuntimeProxy(freshConfig.routes, undefined, threadId);
      const attemptRoutes = buildDriverRoutes(attemptProxy.routes);
      executionPlan.routesJson = JSON.stringify(attemptRoutes);
      try {
        const driver = createSdkDriver(threadId, attemptProxy, {
          taskTracker: {
            ...taskHookHandlers,
            onStop(status) {
              stopTodosHandled = true;
              taskHookHandlers.onStop(status);
            },
          },
          getStopTodoStatus: () => stopStatusRef.current,
        });

        if (!driver.runExecution) {
          throw new Error("Runtime driver does not support execution phase.");
        }

        let sdkFailure: string | undefined;
        const resume = resolveResumeOptions(threadId, executionCwd);
        if (resume) {
          await ensureContextHeadroom(threadId, executionCwd, controller.signal);
        }
        for await (const event of driver.runExecution(
          {
            threadId,
            prompt: pending.userPrompt,
            workspacePath: pending.workspacePath,
            worktreePath: executionCwd,
            routes: attemptRoutes,
            signal: controller.signal,
            sdkSession: buildSdkSessionOptions(thread.id),
            ...(resume ? { resume } : {}),
          },
          planning,
        )) {
          if (event.type === "usage.recorded") {
            sdkFailure = extractSdkRunFailure(event.payload) ?? sdkFailure;
            recordSdkUsageFromEvent(threadId, event);
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

    if (executionOutcome.aborted) {
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

    if (isIsolatedWorktreePlan(worktreePlan)) {
      updateThread(threadId, {
        status: "idle",
        message: "代理执行完成，正在合并工作树更改…",
      });

      try {
        const { files, message, diff } = await applyWorktreeChanges(worktreePlan);
        conversationStore.saveAppliedDiff(threadId, worktreePlan.workspacePath, diff, files);
        updateThread(threadId, { status: "completed", message });
        emitThreadEvent(threadId, "worktree.applied", message, "system");
        process.stderr.write(`[eco] worktree apply ok (${files.length} files): ${files.join(", ")}\n`);
      } catch (applyError) {
        const detail = errorMessage(applyError);
        process.stderr.write(`[eco] worktree apply failed: ${detail}\n`);
        updateThread(threadId, {
          status: "completed",
          message: `执行已完成，但未能合并到工作区：${detail}。可点击「应用到工作区」重试，或手动处理 ${worktreePlan.worktreePath}。`,
        });
        emitThreadEvent(threadId, "worktree.apply_failed", detail, "system");
        return;
      }

      await cleanupWorktreeForThread(threadId);
    } else {
      updateThread(threadId, { status: "completed", message: "执行完成，变更已写入项目目录。" });
      emitThreadEvent(threadId, "thread.completed", "执行完成。", "system");
    }
  } catch (error) {
    stopStatusRef.current = "blocked";
    if (!stopTodosHandled) {
      taskHookHandlers.onStop("blocked");
    }
    await restoreAfterExecutionFailure(threadId, worktreePlan, errorMessage(error), executionPlan);
  } finally {
    sdkStreamBridge.resetThread(threadId);
    await flushUsageUpdates(threadId);
    activeRuns.delete(threadId);
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

function invalidateSdkSessionIfRoutesChanged(
  threadId: string,
  roleRoutes: readonly RoleRouteConfig[],
): void {
  const stored = conversationStore.getRouteFingerprint(threadId);
  if (stored && !routesMatchFingerprint(roleRoutes, stored)) {
    conversationStore.clearSdkSession(threadId);
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
  if (activeRuns.has(threadId)) {
    throw new Error("请等待当前运行结束后再重试。");
  }
  if (thread.status === "running" || thread.status === "queued") {
    throw new Error("对话正在运行中。");
  }

  const settings = providerStore.getSettings();
  const routesOverride = resolveRoleRoutesForThread(threadId, request.routeProfileId);

  invalidateSdkSessionIfRoutesChanged(threadId, routesOverride);

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
  const defaultPlan = createWorktreePlan(workspace.path, threadId);
  let cwd = workspace.path;
  if (sdkSession?.cwd) {
    cwd = sdkSession.cwd;
  } else if (workspaceSupportsWorktree(workspace) && (await fileExists(defaultPlan.worktreePath))) {
    cwd = defaultPlan.worktreePath;
  }
  const existingWorktreePlan =
    isIsolatedWorktreePlan({ workspacePath: workspace.path, worktreePath: cwd })
      ? resolveWorktreePlan(workspace.path, threadId, cwd)
      : undefined;
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
  } else if (threadUsesPlanOrchestration(threadId)) {
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
    void runCodingThreadSdkDefault(
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

/** After a crash, SQLite may still say running while activeRuns is empty. */
function recoverOrphanedRunningThreads(): void {
  for (const thread of conversationStore.listThreads()) {
    if (thread.status !== "running" && thread.status !== "queued") {
      continue;
    }
    if (activeRuns.has(thread.id)) {
      continue;
    }
    updateThread(thread.id, {
      status: "idle",
      message: "应用已意外退出。可在本对话继续发送消息；若右侧有改动可合并到工作区。",
    });
    emitThreadEvent(thread.id, "thread.idle", "已从异常退出恢复。", "system");
  }
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
  const active = activeRuns.get(threadId);
  if (active) {
    active.controller.abort("dismissed by user");
  }
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

function resolveWorktreePlan(
  workspacePath: string,
  threadId: string,
  worktreePath?: string,
): WorktreePlan {
  const plan = createWorktreePlan(workspacePath, threadId);
  if (worktreePath?.trim()) {
    return { ...plan, worktreePath: worktreePath.trim() };
  }
  return plan;
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
  const activePath = activeRuns.get(threadId)?.worktreePlan?.worktreePath;
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

async function getWorktreeStatus(threadId: string): Promise<WorktreeStatusResult> {
  const { workspacePath, worktreePathHint } = resolveWorktreeContextForThread(threadId);
  if (!workspacePath || !worktreePathHint) {
    return { exists: false, worktreePath: "", workspacePath: workspacePath ?? "", changedFiles: [] };
  }

  const plan = resolveWorktreePlan(workspacePath, threadId, worktreePathHint);
  if (!isIsolatedWorktreePlan(plan)) {
    return { exists: false, worktreePath: plan.worktreePath, workspacePath, changedFiles: [] };
  }
  const exists = await fileExists(plan.worktreePath);
  if (!exists) {
    return { exists: false, worktreePath: plan.worktreePath, workspacePath, changedFiles: [] };
  }
  if (!(await gitWorktrees.isInsideWorktree(plan.worktreePath))) {
    return { exists: false, worktreePath: plan.worktreePath, workspacePath, changedFiles: [] };
  }

  if (!existsSync(plan.worktreePath)) {
    return { exists: false, worktreePath: plan.worktreePath, workspacePath, changedFiles: [] };
  }

  try {
    if (!existsSync(plan.worktreePath)) {
      return { exists: false, worktreePath: plan.worktreePath, workspacePath, changedFiles: [] };
    }
    const changedFiles = await gitWorktrees.changedFiles(plan);
    return { exists: true, worktreePath: plan.worktreePath, workspacePath, changedFiles };
  } catch (error) {
    if (!isWorktreeGitCwdError(error)) {
      console.error("Failed to read worktree status:", error);
    } else {
      process.stderr.write(
        `[eco] worktree status skipped (${plan.worktreePath}): cwd no longer valid\n`,
      );
    }
    return { exists: false, worktreePath: plan.worktreePath, workspacePath, changedFiles: [] };
  }
}

async function applyWorktreeChanges(
  plan: WorktreePlan,
): Promise<{ files: string[]; message: string; diff: string }> {
  if (!(await fileExists(plan.worktreePath))) {
    throw new Error(`找不到隔离工作树：${plan.worktreePath}`);
  }

  const { files, diff } = await gitWorktrees.collectWorktreeChanges(plan);
  if (files.length === 0) {
    return { files: [], diff: "", message: "执行完成，工作树内无相对基线的文件变更。" };
  }

  await gitWorktrees.applyWorktreeDiff(plan, diff, files);
  return {
    files,
    diff,
    message: `已合并 ${files.length} 个文件的更改到工作区（未自动提交）：${files.join(", ")}`,
  };
}

async function applyWorktreeForThread(threadId: string): Promise<WorktreeApplyResult> {
  const status = await getWorktreeStatus(threadId);
  if (!status.exists) {
    throw new Error("该对话没有可合并的隔离工作树。");
  }

  const plan = resolveWorktreePlan(status.workspacePath, threadId, status.worktreePath);
  const { files, message, diff } = await applyWorktreeChanges(plan);
  conversationStore.saveAppliedDiff(threadId, plan.workspacePath, diff, files);
  await cleanupWorktreeForThread(threadId);
  updateThread(threadId, { status: "completed", message });
  emitThreadEvent(threadId, "worktree.applied", message, "system");
  return { ok: true, files, message };
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
    isIsolatedWorktreePlan,
    changedFiles: (plan) => gitWorktrees.changedFiles(plan),
    applyWorktreeChanges,
    saveAppliedDiff: (threadId, workspacePath, diff, files) =>
      conversationStore.saveAppliedDiff(threadId, workspacePath, diff, files),
    discardWorktreeChanges: (plan) => gitWorktrees.discardWorktreeChanges(plan),
    cleanupWorktreeForThread,
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

function createSdkDriver(
  threadId: string,
  proxy: { apiKey: string; baseUrl: string },
  hookContextExtras?: Partial<EcoHookContext>,
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
  const planModeEnabled =
    threadConfig?.planModeEnabled ?? workflowSettingsStore.get().planModeEnabled;
  return new ClaudeAgentSdkDriver({
    apiKey: proxy.apiKey,
    baseUrl: proxy.baseUrl,
    orchestration: orchestrationModeFromSnapshot({ planModeEnabled }),
    hookContext: {
      ...createThreadHookContext(threadId),
      ...hookContextExtras,
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
  if (
    !existsSync(worktreePath) ||
    !existsSync(session.cwd) ||
    session.cwd !== worktreePath
  ) {
    conversationStore.clearSdkSession(threadId);
    return undefined;
  }
  return { resumeSessionId: session.sessionId };
}

function resolveContinuePhase(
  thread: ThreadSummary,
  intent: "question" | "coding",
): "planning" | "execution" | "question" {
  if (intent === "question") {
    return "question";
  }
  if (conversationStore.getAppliedDiff(thread.id) || thread.status === "completed") {
    return "execution";
  }
  const activity = conversationStore.listActivityLines(thread.id);
  const executed = activity.some(
    (line) =>
      line.message.includes("子代理执行") ||
      line.message.includes("执行完成") ||
      line.message.includes("继续执行"),
  );
  if (executed) {
    return "execution";
  }
  return "planning";
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
): Promise<void> {
  if (!threadUsesPlanOrchestration(thread.id) && mode !== "question") {
    await runCodingThreadSdkDefault(
      thread,
      workspace,
      runtimeConfig,
      followUp,
      existingWorktreePlan,
      undefined,
      attachments,
      routesOverride,
    );
    return;
  }

  const controller = new AbortController();
  activeRuns.set(thread.id, {
    controller,
    worktreePlan: existingWorktreePlan ?? createWorktreePlan(workspace.path, thread.id),
    worktreeReady: false,
  });
  resetSubagentContextWindows(thread.id);

  const stopStatusRef = { current: "completed" as "completed" | "blocked" | "cancelled" };
  let stopTodosHandled = false;
  let planningPlanCaptured = false;
  let worktreePlan = existingWorktreePlan ?? createWorktreePlan(workspace.path, thread.id);
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
      activeRuns.get(thread.id)!.worktreePlan = worktreePlan;
      activeRuns.get(thread.id)!.worktreeReady = true;
    } else if (
      existingWorktreePlan &&
      isIsolatedWorktreePlan(existingWorktreePlan) &&
      (await fileExists(existingWorktreePlan.worktreePath))
    ) {
      worktreePlan = existingWorktreePlan;
      cwd = existingWorktreePlan.worktreePath;
      activeRuns.get(thread.id)!.worktreePlan = worktreePlan;
      activeRuns.get(thread.id)!.worktreeReady = true;
    } else {
      activeRuns.get(thread.id)!.worktreeReady = true;
    }

    const outcome = await runThreadRequestWithAutoRetry(thread.id, controller.signal, async () => {
      const freshConfig = resolveRuntimeConfigFresh();
      if (!freshConfig.ok) {
        return { ok: false, reason: freshConfig.reason };
      }
      recordThreadRouteFingerprint(thread.id, freshConfig.routes);
      const attemptProxy = await startRuntimeProxy(freshConfig.routes, attachments, thread.id);
      const routes = buildDriverRoutes(attemptProxy.routes);
      const resume = resolveResumeOptions(thread.id, cwd);
      if (!resume) {
        return { ok: false, reason: "无法恢复 SDK 会话，请重新发送完整需求。" };
      }

      await ensureContextHeadroom(thread.id, cwd, controller.signal);

      try {
        const driver = createSdkDriver(thread.id, attemptProxy, {
          ...(taskHookHandlers
            ? {
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
        });
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
          sdkSession: buildSdkSessionOptions(thread.id),
          resume,
        };

        const eventStream =
          mode === "question"
            ? driver.runQuestion!(runInput)
            : driver.runContinuation!(runInput, mode);

        for await (const event of eventStream) {
          if (event.type === "usage.recorded") {
            sdkFailure = extractSdkRunFailure(event.payload) ?? sdkFailure;
            recordSdkUsageFromEvent(thread.id, event);
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
            scheduleThreadTitleSummary(thread.id, followUp, runtimeConfig, {
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
        if (mode === "planning" && !planningPlanCaptured) {
          return { ok: false, reason: "未能生成可执行的计划。" };
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

    if (outcome.aborted) {
      stopStatusRef.current = "cancelled";
      taskHookHandlers?.onStop("cancelled");
      cancelClarificationsForThread(thread.id, "cancelled by user");
      await handleRunCancelled(thread.id, worktreePlan);
      return;
    }
    if (!outcome.ok) {
      stopStatusRef.current = "blocked";
      taskHookHandlers?.onStop("blocked");
      updateThread(thread.id, { status: "failed", message: outcome.reason });
      return;
    }

    if (mode === "execution") {
      taskHookHandlers?.onStop("completed");
      if (isIsolatedWorktreePlan(worktreePlan)) {
        updateThread(thread.id, {
          status: "idle",
          message: "代理执行完成，正在合并工作树更改…",
        });
        try {
          const { files, message, diff } = await applyWorktreeChanges(worktreePlan);
          conversationStore.saveAppliedDiff(thread.id, worktreePlan.workspacePath, diff, files);
          updateThread(thread.id, { status: "completed", message });
          emitThreadEvent(thread.id, "worktree.applied", message, "system");
          await cleanupWorktreeForThread(thread.id);
        } catch (applyError) {
          const detail = errorMessage(applyError);
          updateThread(thread.id, {
            status: "completed",
            message: `执行已完成，但未能合并到工作区：${detail}`,
          });
        }
      } else {
        updateThread(thread.id, { status: "completed", message: "执行完成，变更已写入项目目录。" });
        emitThreadEvent(thread.id, "thread.completed", "执行完成。", "system");
      }
      return;
    }

    if (mode === "question") {
      updateThread(thread.id, { status: "completed", message: "回答完成。" });
      scheduleThreadTitleSummary(thread.id, followUp, runtimeConfig);
      return;
    }

    if (mode === "planning") {
      if (planningPlanCaptured) {
        updateThread(thread.id, {
          status: "awaiting_plan",
          message: "等待你确认计划。",
        });
        requestThreadContextRefresh(thread.id, true);
      } else {
        updateThread(thread.id, { status: "idle", message: "计划阶段已结束。" });
      }
      return;
    }

    updateThread(thread.id, { status: "idle", message: "续聊已结束。" });
  } catch (error) {
    stopStatusRef.current = "blocked";
    taskHookHandlers?.onStop("blocked");
    updateThread(thread.id, { status: "failed", message: errorMessage(error) });
  } finally {
    const worktreePath = resolveThreadWorktreePath(thread.id);
    cancelClarificationsForThread(thread.id, "run finished");
    sdkStreamBridge.resetThread(thread.id);
    await flushUsageUpdates(thread.id);
    activeRuns.delete(thread.id);
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
  const worktreePath =
    activeRuns.get(threadId)?.worktreePlan?.worktreePath ??
    conversationStore.getSdkSession(threadId)?.cwd;
  handleSdkContextSideEffects(threadId, event, worktreePath);
  sdkStreamBridge.handleEvent(threadId, event, (id, type, message, role, stream) => {
    emitThreadEvent(id, type, message, role as AgentRole | "system" | "thinking" | "tool" | "user", stream);
  });
}

function emitOtelActivity(line: OtelActivityLine): void {
  if (/^Compacting context/i.test(line.message)) {
    contextMonitor.noteOtelCompaction(line.threadId);
  }
  if (line.role === "tool" && sdkStreamBridge.shouldSuppressOtelToolLine(line.threadId, line.message)) {
    return;
  }
  emitThreadEvent(line.threadId, "otel.activity", line.message, line.role, line.stream ?? false);
}

function trackUsageUpdate(threadId: string, promise: Promise<void>): void {
  let set = pendingUsageUpdates.get(threadId);
  if (!set) {
    set = new Set();
    pendingUsageUpdates.set(threadId, set);
  }

  const tracked = promise.finally(() => {
    const current = pendingUsageUpdates.get(threadId);
    current?.delete(tracked);
    if (current?.size === 0) {
      pendingUsageUpdates.delete(threadId);
    }
  });
  set.add(tracked);
  void tracked.catch(() => {});
}

async function flushUsageUpdates(threadId: string): Promise<void> {
  while (true) {
    const pending = pendingUsageUpdates.get(threadId);
    if (!pending || pending.size === 0) {
      return;
    }
    await Promise.allSettled([...pending]);
  }
}

function emitOtelUsage(usage: OtelUsageUpdate): void {
  const run = activeRuns.get(usage.threadId);
  const { seq, dedupId } = nextOtelRequestDedupId(run?.otelRequestSeq);
  if (run) {
    run.otelRequestSeq = seq;
  }

  const hasTokens =
    usage.inputTokens > 0 ||
    usage.outputTokens > 0 ||
    (usage.cacheReadTokens ?? 0) > 0 ||
    (usage.cacheCreationTokens ?? 0) > 0;

  if (hasTokens && run) {
    run.otelTokenBilled = true;
  }

  trackUsageUpdate(
    usage.threadId,
    processUsageBilling({
      threadId: usage.threadId,
      role: normalizeBillingRole(usage.role),
      source: "otel",
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens ?? 0,
      cacheCreationTokens: usage.cacheCreationTokens ?? 0,
      ...(usage.costUsd !== undefined && { otelCostUsd: usage.costUsd }),
      ...(usage.modelId && { modelId: usage.modelId }),
      otelDedupId: dedupId,
    })
      .then(() => undefined)
      .catch((error) => {
        process.stderr.write(`[eco] usage billing failed: ${errorMessage(error)}\n`);
      }),
  );
}

async function emitProxyUsage(
  info: AnthropicProxyUsageInfo & { threadId: string },
): Promise<UpstreamProxyCallBilling | null> {
  const run = activeRuns.get(info.threadId);
  const seq = (run?.proxyRequestSeq ?? 0) + 1;
  const updateContext = isProxyContextAuthoritative(info);
  if (run) {
    run.proxyRequestSeq = seq;
    run.proxyTokenBilled = true;
    if (updateContext && !run.proxyContextRolesSeen) {
      run.proxyContextRolesSeen = new Set();
    }
    if (updateContext) {
      run.proxyContextRolesSeen?.add(info.role);
    }
  }
  const requestKey = [
    "proxy",
    info.role,
    info.modelId,
    info.requestId ?? String(seq),
    info.usage.inputTokens,
    info.usage.outputTokens,
    info.usage.cacheReadTokens,
    info.usage.cacheCreationTokens,
  ].join(":");

  const billingTask = processUsageBilling({
    threadId: info.threadId,
    role: info.role,
    source: "proxy",
    inputTokens: info.usage.inputTokens,
    outputTokens: info.usage.outputTokens,
    cacheReadTokens: info.usage.cacheReadTokens,
    cacheCreationTokens: info.usage.cacheCreationTokens,
    modelId: info.modelId,
    requestKey,
    updateContext,
  });
  trackUsageUpdate(
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

function isProxyContextAuthoritative(info: AnthropicProxyUsageInfo): boolean {
  const requestedModel = info.requestedModel?.trim();
  if (!requestedModel) {
    return true;
  }
  if (requestedModel === createModelAlias(info.role, info.providerId, info.modelId)) {
    return true;
  }
  if (requestedModel !== info.modelId) {
    return false;
  }

  const runtimeConfig = resolveRuntimeConfig(
    providerStore.getSettings(),
    providerStore.listProvidersWithSecrets(),
  );
  if (!runtimeConfig.ok) {
    return false;
  }

  const sameUpstreamModelRoutes = runtimeConfig.routes.filter(
    (route) => route.provider.id === info.providerId && route.modelId === info.modelId,
  );
  return sameUpstreamModelRoutes.length === 1 && sameUpstreamModelRoutes[0]?.role === info.role;
}

function normalizeBillingRole(role: OtelUsageUpdate["role"]): AgentRole {
  if (role === "system" || role === "thinking" || role === "tool") {
    return "planner";
  }
  if (AGENT_ROLES.includes(role as AgentRole)) {
    return role as AgentRole;
  }
  return "planner";
}

async function processUsageBilling(input: {
  threadId: string;
  role: AgentRole;
  agentId?: string;
  source?: BillingUsageSource;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  otelCostUsd?: number;
  modelId?: string;
  messageId?: string;
  requestKey?: string;
  otelDedupId?: string;
  updateContext?: boolean;
}): Promise<UpstreamProxyCallBilling | null> {
  await pricingCatalogReady;

  const delta: ParsedUsage = {
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    cacheReadTokens: input.cacheReadTokens,
    cacheCreationTokens: input.cacheCreationTokens,
  };

  if (
    delta.inputTokens === 0 &&
    delta.outputTokens === 0 &&
    delta.cacheReadTokens === 0 &&
    delta.cacheCreationTokens === 0 &&
    input.otelCostUsd === undefined
  ) {
    return null;
  }

  const settings = providerStore.getSettings();
  const providers = providerStore.listProvidersWithSecrets();
  const runtimeRoutes = resolveRuntimeRoutesFromSettings(settings, providers);
  const usageRoute = resolveUsageRoute(input.role, input.modelId, runtimeRoutes);
  const plannerRoute = runtimeRoutes.find((route) => route.role === "planner");

  const actualLookup = usageRoute
    ? await pricingCache.lookupForRoute({
        baseUrl: usageRoute.provider.baseUrl,
        modelId: usageRoute.modelId,
        ...(usageRoute.modelsDevMapping && { mapping: usageRoute.modelsDevMapping }),
      })
    : null;
  const plannerLookup = plannerRoute
    ? await pricingCache.lookupForRoute({
        baseUrl: plannerRoute.provider.baseUrl,
        modelId: plannerRoute.modelId,
        ...(plannerRoute.modelsDevMapping && { mapping: plannerRoute.modelsDevMapping }),
      })
    : null;

  const requestKey =
    input.requestKey ??
    buildUsageRequestKey({
      role: input.role,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      cacheReadTokens: input.cacheReadTokens,
      cacheCreationTokens: input.cacheCreationTokens,
      ...(input.modelId && { modelId: input.modelId }),
      ...(input.otelDedupId && { dedupId: input.otelDedupId }),
    });

  const plannerModelLabel = buildPlannerModelLabel(
    plannerRoute,
    plannerLookup?.displayName ?? plannerRoute?.modelId,
  );

  const resolvedModelId = usageRoute?.modelId ?? input.modelId;
  const billingRole = usageRoute?.role ?? input.role;

  const monitorModelId = usageRoute?.modelId ?? plannerRoute?.modelId ?? resolvedModelId;
  const monitorBaseUrl = usageRoute?.provider.baseUrl ?? plannerRoute?.provider.baseUrl;
  const monitorRole = billingRole;
  const monitorRoute = resolveUsageRoute(monitorRole, resolvedModelId, runtimeRoutes);
  const monitorModelForRole = monitorRoute?.modelId ?? monitorModelId;
  const monitorBaseForRole = monitorRoute?.provider.baseUrl ?? monitorBaseUrl;
  const updateContext = input.updateContext ?? shouldUpdateContextFromUsageSource(input.source);
  if (updateContext && monitorModelForRole && monitorBaseForRole) {
    await contextMonitor.updateFromUsage(input.threadId, delta, {
      role: monitorRole,
      ...(input.agentId && { agentId: input.agentId }),
      modelId: monitorModelForRole,
      providerBaseUrl: monitorBaseForRole,
      ...(monitorRoute?.modelsDevMapping && { modelsDevMapping: monitorRoute.modelsDevMapping }),
      ...(monitorRoute?.manualSpec && { manualSpec: monitorRoute.manualSpec }),
      ...(input.messageId && { messageId: input.messageId }),
    });
  }

  const monitorSnap = contextMonitor.getSnapshot(input.threadId);

  const actualRates = resolveRatesForRoute(actualLookup, usageRoute?.manualSpec);
  const plannerRates = resolveRatesForRoute(plannerLookup, plannerRoute?.manualSpec);
  const requestBilling = computeRequestBilling(delta, actualRates, plannerRates);
  const { savedUsd } = computeSavings(
    requestBilling.plannerTokenCostUsd,
    requestBilling.ecoCostUsd,
  );
  const requestBillingLog: UpstreamProxyCallBilling = {
    ecoCostUsd: requestBilling.ecoCostUsd,
    plannerTokenCostUsd: requestBilling.plannerTokenCostUsd,
    savedUsd,
    otelCostUsd: input.otelCostUsd ?? 0,
  };

  const billing = threadUsageAccumulator.recordUsage({
    threadId: input.threadId,
    role: billingRole,
    source: input.source ?? "otel",
    delta,
    ...(input.otelCostUsd !== undefined && { otelCostUsd: input.otelCostUsd }),
    actualRates,
    plannerRates,
    ...(resolvedModelId && { modelId: resolvedModelId }),
    requestKey,
    ...(plannerModelLabel && { plannerModelLabel }),
  });

  const parsed = {
    inputTokens: delta.inputTokens,
    outputTokens: delta.outputTokens,
    cacheReadTokens: delta.cacheReadTokens,
    cacheCreationTokens: delta.cacheCreationTokens,
    ...(input.modelId && { modelId: input.modelId }),
  };

  const snapshot = buildUsageSnapshotForRole({
    usage: parsed,
    role: billingRole,
    ...(monitorSnap && { monitorSnap }),
    ...(parsed.modelId && { modelId: parsed.modelId }),
    fallbackContext: updateContext ? "estimate" : "none",
  });

  emitThreadEvent(input.threadId, "thread.usage_updated", formatUsageBadge(parsed), billingRole, false, {
    usage: snapshot,
    totalCostUsd: billing.otelCostUsd,
    billing,
    ...(parsed.modelId && { modelId: parsed.modelId }),
  });

  schedulePersistThreadMetrics(input.threadId);
  contextScheduler.emitLiveFromMonitor(input.threadId);
  const worktreePath = resolveThreadWorktreePath(input.threadId);
  if (worktreePath && !activeRuns.has(input.threadId)) {
    contextScheduler.scheduleBreakdownRefresh(
      input.threadId,
      buildDriverRoutesFromRuntime(runtimeRoutes),
      worktreePath,
    );
  }

  return requestBillingLog;
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

async function ensureContextHeadroom(
  threadId: string,
  worktreePath: string,
  signal: AbortSignal,
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
  const routes = buildDriverRoutesFromRuntime(runtimeConfig.routes);
  await contextScheduler.ensureHeadroom(threadId, routes, worktreePath, signal);
}

function resolveThreadWorktreePath(threadId: string): string | undefined {
  const { workspacePath, worktreePathHint } = resolveWorktreeContextForThread(threadId);
  if (!workspacePath || !worktreePathHint || !existsSync(worktreePathHint)) {
    return undefined;
  }
  return worktreePathHint;
}

/** Call after activeRuns.delete so /context breakdown is not blocked as "still running". */
function afterRunContextRefresh(threadId: string, worktreePath?: string): void {
  contextScheduler.emitLiveFromMonitor(threadId);
  const path = worktreePath ?? resolveThreadWorktreePath(threadId);
  if (path) {
    scheduleContextBreakdownRefresh(threadId, path, true);
  }
}

function resetSubagentContextWindows(threadId: string): void {
  contextScheduler.clearSubagentState(threadId);
  const snapshot = contextMonitor.clearSubagentRoles(threadId);
  if (snapshot) {
    contextScheduler.emitLiveFromMonitor(threadId);
    schedulePersistThreadMetrics(threadId);
  }
}

function requestThreadContextRefresh(threadId: string, immediate = true): void {
  contextScheduler.emitLiveFromMonitor(threadId);
  const worktreePath = resolveThreadWorktreePath(threadId);
  if (!worktreePath) {
    return;
  }
  scheduleContextBreakdownRefresh(threadId, worktreePath, immediate);
}

function scheduleContextBreakdownRefresh(
  threadId: string,
  worktreePath: string,
  immediate = false,
): void {
  let roleRoutes: RoleRouteConfig[];
  try {
    roleRoutes = resolveRoleRoutesForThread(threadId);
  } catch (error) {
    process.stderr.write(
      `[eco] context breakdown skipped for ${threadId}: ${errorMessage(error)}\n`,
    );
    return;
  }

  const runtimeConfig = resolveRuntimeConfig(
    providerStore.getSettings(),
    providerStore.listProvidersWithSecrets(),
    roleRoutes,
  );
  if (!runtimeConfig.ok) {
    process.stderr.write(
      `[eco] context breakdown skipped for ${threadId}: ${runtimeConfig.reason}\n`,
    );
    return;
  }
  contextScheduler.scheduleBreakdownRefresh(
    threadId,
    buildDriverRoutesFromRuntime(runtimeConfig.routes),
    worktreePath,
    immediate,
  );
}

function emitThreadContextUpdated(threadId: string, context: ThreadContextSnapshot): void {
  emitThreadEvent(threadId, "thread.context_updated", "上下文已更新", "system", false, { context });
  schedulePersistThreadMetrics(threadId);
}

function loadThreadMetricsFromStore(): void {
  for (const record of conversationStore.listThreadMetrics()) {
    if (record.accumulator) {
      threadUsageAccumulator.restoreState(record.threadId, record.accumulator);
    }
    if (record.context) {
      contextScheduler.restoreSnapshot(record.threadId, record.context);
    }
  }
}

function persistThreadMetricsNow(threadId: string): void {
  const accumulator = threadUsageAccumulator.serializeState(threadId);
  const context = contextScheduler.getDisplaySnapshot(threadId);
  conversationStore.saveThreadMetrics(threadId, {
    ...(accumulator && { accumulator }),
    ...(context && { context }),
  });
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

  const threadIds = new Set<string>();
  for (const record of conversationStore.listThreadMetrics()) {
    threadIds.add(record.threadId);
  }
  for (const thread of conversationStore.listThreads()) {
    threadIds.add(thread.id);
  }
  for (const threadId of threadIds) {
    if (threadUsageAccumulator.serializeState(threadId) || contextScheduler.getDisplaySnapshot(threadId)) {
      persistThreadMetricsNow(threadId);
    }
  }
}

function handleSdkContextSideEffects(
  threadId: string,
  event: AgentEventLike,
  worktreePath?: string,
): void {
  if (!isRecord(event.payload)) {
    return;
  }
  const payload = event.payload;
  if (payload.subtype === "compact_boundary") {
    const postTokens = extractCompactPostTokens(payload);
    contextMonitor.markCompactCompleted(threadId, postTokens);
    contextScheduler.emitLiveFromMonitor(threadId);
    if (worktreePath) {
      scheduleContextBreakdownRefresh(threadId, worktreePath, true);
    }
    return;
  }
  if (payload.type === "system" && payload.subtype === "status" && payload.status === "compacting") {
    contextMonitor.noteOtelCompaction(threadId);
  }
}

function recordSdkUsageFromEvent(threadId: string, event: AgentEventLike & { id: string }): void {
  const bundle = parseSdkUsageBilling(event.payload);
  if (!bundle) {
    return;
  }

  const messageId =
    isRecord(event.payload) && typeof event.payload.messageId === "string"
      ? event.payload.messageId
      : undefined;
  const billingRole = normalizeBillingRole(event.role as OtelUsageUpdate["role"]);
  const run = activeRuns.get(threadId);

  if (!bundle.authoritative) {
    const modelId =
      isRecord(event.payload) && typeof event.payload.model === "string"
        ? event.payload.model
        : bundle.models[0]?.modelId;
    if (shouldUseSdkContextFallback(billingRole, run)) {
      trackUsageUpdate(
        threadId,
        updateContextFromSdkFallback(
          threadId,
          billingRole,
          bundle.contextUsage,
          messageId,
          modelId,
          event.agentId,
        ).catch((error) => {
          process.stderr.write(`[eco] SDK context fallback failed: ${errorMessage(error)}\n`);
        }),
      );
    }

    if (
      messageId &&
      shouldBillAssistantSubagentUsage({
        role: billingRole,
        messageId,
        otelTokenBilled: run?.otelTokenBilled,
      })
    ) {
      trackUsageUpdate(
        threadId,
        processUsageBilling({
          threadId,
          role: billingRole,
          agentId: event.agentId,
          source: "sdk",
          inputTokens: bundle.contextUsage.inputTokens,
          outputTokens: bundle.contextUsage.outputTokens,
          cacheReadTokens: bundle.contextUsage.cacheReadTokens,
          cacheCreationTokens: bundle.contextUsage.cacheCreationTokens,
          ...(modelId && { modelId }),
          messageId,
          requestKey: buildAssistantUsageRequestKey(messageId),
        })
          .then(() => undefined)
          .catch((error) => {
            process.stderr.write(`[eco] assistant usage billing failed: ${errorMessage(error)}\n`);
          }),
      );
    }
    return;
  }

  if (isSdkIncrementalStreamUsage(bundle.authoritative, event.payload)) {
    const modelId =
      isRecord(event.payload) && typeof event.payload.model === "string"
        ? event.payload.model
        : bundle.models[0]?.modelId;
    if (shouldUseSdkContextFallback(billingRole, run)) {
      trackUsageUpdate(
        threadId,
        updateContextFromSdkFallback(
          threadId,
          billingRole,
          bundle.contextUsage,
          undefined,
          modelId,
          event.agentId,
        ).catch((error) => {
          process.stderr.write(`[eco] SDK stream context fallback failed: ${errorMessage(error)}\n`);
        }),
      );
    }
    return;
  }

  trackUsageUpdate(
    threadId,
    processSdkRunBilling({
      threadId,
      role: billingRole,
      requestKey: `sdk-result:${event.id}`,
      bundle,
    }).catch((error) => {
      process.stderr.write(`[eco] SDK run billing failed: ${errorMessage(error)}\n`);
    }),
  );
}

function shouldUseSdkContextFallback(role: AgentRole, run: ActiveThreadRun | undefined): boolean {
  return run?.proxyContextRolesSeen?.has(role) !== true;
}

async function updateContextFromSdkFallback(
  threadId: string,
  role: AgentRole,
  usage: ParsedUsage,
  messageId?: string,
  modelId?: string,
  agentId?: string,
): Promise<void> {
  await pricingCatalogReady;
  const settings = providerStore.getSettings();
  const providers = providerStore.listProvidersWithSecrets();
  const runtimeRoutes = resolveRuntimeRoutesFromSettings(settings, providers);
  const usageRoute = resolveUsageRoute(role, modelId, runtimeRoutes);
  if (!usageRoute) {
    return;
  }

  await contextMonitor.updateFromUsage(threadId, usage, {
    role,
    ...(agentId && { agentId }),
    modelId: usageRoute.modelId,
    providerBaseUrl: usageRoute.provider.baseUrl,
    ...(usageRoute.modelsDevMapping && { modelsDevMapping: usageRoute.modelsDevMapping }),
    ...(messageId && { messageId }),
  });
  contextScheduler.emitLiveFromMonitor(threadId);
}

async function processSdkRunBilling(input: {
  threadId: string;
  role: AgentRole;
  requestKey: string;
  bundle: NonNullable<ReturnType<typeof parseSdkUsageBilling>>;
}): Promise<void> {
  await pricingCatalogReady;

  const settings = providerStore.getSettings();
  const providers = providerStore.listProvidersWithSecrets();
  const runtimeRoutes = resolveRuntimeRoutesFromSettings(settings, providers);
  const plannerRoute = runtimeRoutes.find((route) => route.role === "planner");
  const plannerLookup = plannerRoute
    ? await pricingCache.lookupForRoute({
        baseUrl: plannerRoute.provider.baseUrl,
        modelId: plannerRoute.modelId,
        ...(plannerRoute.modelsDevMapping && { mapping: plannerRoute.modelsDevMapping }),
      })
    : null;
  const plannerRates = resolveRatesForRoute(plannerLookup, plannerRoute?.manualSpec);
  const plannerModelLabel = buildPlannerModelLabel(
    plannerRoute,
    plannerLookup?.displayName ?? plannerRoute?.modelId,
  );

  const models = await Promise.all(
    input.bundle.models.map(async (entry) => {
      const usageRoute = resolveUsageRoute(input.role, entry.modelId, runtimeRoutes);
      const billingRole = usageRoute?.role ?? input.role;
      const actualLookup = usageRoute
        ? await pricingCache.lookupForRoute({
            baseUrl: usageRoute.provider.baseUrl,
            modelId: usageRoute.modelId,
            ...(usageRoute.modelsDevMapping && { mapping: usageRoute.modelsDevMapping }),
          })
        : null;
      return {
        role: billingRole,
        modelId: usageRoute?.modelId ?? entry.modelId,
        usage: entry.usage,
        actualRates: resolveRatesForRoute(actualLookup, usageRoute?.manualSpec),
        plannerRates,
        ...(entry.sdkCostUsd !== undefined && { sdkCostUsd: entry.sdkCostUsd }),
      };
    }),
  );

  // SDK result modelUsage is a billing aggregate; context windows are updated only from per-session usage.
  const billing = threadUsageAccumulator.recordRunUsage({
    threadId: input.threadId,
    role: input.role,
    source: "sdk",
    requestKey: input.requestKey,
    models,
    ...(input.bundle.totalCostUsd !== undefined && { otelCostUsd: input.bundle.totalCostUsd }),
    ...(plannerModelLabel && { plannerModelLabel }),
  });

  const monitorSnap = contextMonitor.getSnapshot(input.threadId);
  const contextUsage = input.bundle.contextUsage;
  const snapshot = buildUsageSnapshotForRole({
    usage: contextUsage,
    role: input.role,
    ...(monitorSnap && { monitorSnap }),
    fallbackContext: "none",
  });

  emitThreadEvent(
    input.threadId,
    "thread.usage_updated",
    formatUsageBadge(contextUsage),
    input.role,
    false,
    { usage: snapshot, totalCostUsd: billing.otelCostUsd, billing },
  );

  schedulePersistThreadMetrics(input.threadId);
  contextScheduler.emitLiveFromMonitor(input.threadId);
  const worktreePath = resolveThreadWorktreePath(input.threadId);
  if (worktreePath && !activeRuns.has(input.threadId)) {
    contextScheduler.scheduleBreakdownRefresh(
      input.threadId,
      buildDriverRoutesFromRuntime(runtimeRoutes),
      worktreePath,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildSdkSessionOptions(threadId: string): EcoSdkSessionOptions {
  const mcp = mcpStore.buildSdkConfig();
  const assignments = agentSkillsStore.getAssignments();
  const thread = conversationStore.getThread(threadId);
  const hydrated = thread ? ensureThreadRuntimeConfig(thread) : undefined;
  const enabledSubagents = hydrated?.runtimeConfig?.subagentEnabled ?? subagentSettingsStore.get();
  return {
    settingSources: ["user", "project"],
    skills: assignments.planner,
    agentSkills: assignments,
    enabledSubagents,
    mcpServers: mcp.mcpServers,
    mcpAllowedTools: mcp.allowedTools,
  };
}

function isAgentSkillAssignments(value: unknown): value is AgentSkillAssignments {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return AGENT_ROLES.every((role) => {
    const skills = record[role];
    return Array.isArray(skills) && skills.every((entry) => typeof entry === "string");
  });
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
  },
): void {
  const trimmed = message.trim();
  const isThreadStatusEvent = type.startsWith("thread.");
  const isUsageEvent = type === "thread.usage_updated";
  const isContextEvent = type === "thread.context_updated";
  const allowEmptyStream = stream && trimmed.length === 0;
  if (
    !trimmed &&
    !allowEmptyStream &&
    !extras?.plan &&
    !extras?.clarification &&
    !isThreadStatusEvent &&
    !isUsageEvent &&
    !isContextEvent
  ) {
    return;
  }

  const displayMessage = trimmed || (isThreadStatusEvent ? "状态已更新" : "");

  const persistActivityLine =
    (!isThreadStatusEvent || type === "thread.auto_retry" || type === "thread.retry") &&
    !isUsageEvent &&
    !isContextEvent &&
    type !== "thread.todos_updated" &&
    type !== "thread.title_updated";

  if (
    conversationStore.getThread(threadId) &&
    (displayMessage || allowEmptyStream) &&
    !extras?.todoList &&
    !extras?.title &&
    persistActivityLine
  ) {
    conversationStore.appendActivityLine(threadId, {
      role: String(role),
      message: displayMessage,
      stream,
    });
  }

  const payload: ThreadLiveEvent = {
    threadId,
    type,
    message: displayMessage || (extras?.plan ? "计划已就绪" : "状态已更新"),
    role,
    stream,
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

  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send(IPC_CHANNELS.threadEventsSubscribe, payload);
  });
}

function recordUserPrompt(threadId: string, prompt: string): void {
  emitThreadEvent(threadId, "thread.user_prompt", prompt, "user");
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
      const run = activeRuns.get(threadId);
      if (!run?.worktreePlan) {
        return [];
      }
      try {
        return await gitWorktrees.changedFiles(run.worktreePlan);
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

function emitUpstreamModelRequestActivity(threadId: string, role: AgentRole): void {
  emitThreadEvent(threadId, "otel.activity", "Requesting model…", role, false);
}

function emitUpstreamConnectionErrorActivity(threadId: string, role: AgentRole, error: string): void {
  const detail = formatUserFacingRequestError(error);
  emitThreadEvent(threadId, "otel.activity", `【连接失败】${detail}`, role, false);
}

function startRuntimeProxy(
  routes: RuntimeRoute[],
  attachments?: PromptImageAttachment[],
  threadId?: string,
): Promise<Awaited<ReturnType<typeof startAnthropicModelProxy>>> {
  const upstreamUserAgent = resolveUpstreamUserAgentOverride(proxyBridgeSettingsStore.get());
  const options: AnthropicProxyStartOptions = {
    ...(upstreamUserAgent && { upstreamUserAgent }),
    ...(attachments && attachments.length > 0 && { pendingImages: attachments }),
    ...(threadId && {
      onMessagesRequest: ({ role }) => {
        emitUpstreamModelRequestActivity(threadId, role);
      },
      onUpstreamConnectionError: ({ role, error }) => {
        emitUpstreamConnectionErrorActivity(threadId, role, error);
      },
      onUsage: ((info) => emitProxyUsage({ ...info, threadId })) satisfies AnthropicProxyUsageHandler,
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
