import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ResolvedModelRoute } from "@eco/model-router";
import {
  createRedisSessionStore,
  createSqliteSessionStore,
  type SessionStore,
  testRedisConnection,
} from "@eco/persistence";
import {
  type AgentEvent,
  defaultSubagentAvailability,
  type EcoPlanningContext,
  type EcoAgentRuntimeConfig,
  type EcoSdkResumeOptions,
  type EcoSdkSessionOptions,
  isSubagentRole,
  normalizeSdkSubagentType,
  type OtelActivityLine,
  type OtelUsageUpdate,
  type ParsedUsage,
  type PlanReadyPayload,
  type SessionCapturedPayload,
  type SdkToolPermissionDecision,
  type SdkToolPermissionRequest,
  type SubagentRunPhase,
} from "@eco/runtime";
import { ClaudeAgentSdkDriver, deleteClaudeAgentSdkSession, type EcoHookContext } from "@eco/runtime/sdk";
import {
  type CommandRunner,
  createSessionPlan,
  evaluateShellCommandText,
  GitWorktreeService,
  type WorktreePlan,
} from "@eco/workspace";
import { app, BrowserWindow, dialog, ipcMain, type NativeImage, nativeImage } from "electron";
import { enrichBillingDisplaySource } from "../shared/billing-display-source";
import {
  AGENT_ROLES,
  type AgentAuditExportRequest,
  type AgentRole,
  type AgentTemplate,
  type AgentTemplateExportRequest,
  type AgentTemplateVersionRestoreRequest,
  type BashApprovalRequest,
  type BashApprovalResolvePayload,
  buildThreadRuntimeConfigFromDefaults,
  type ClarificationSubmitPayload,
  type CoderTodoItem,
  getRoutesForProfile,
  IPC_CHANNELS,
  isKnownIpcChannel,
  isThreadRuntimeConfig,
  type ListUpstreamModelsRequest,
  type McpServerConfigInput,
  type ModelSettingsSnapshot,
  normalizeThreadRuntimeConfig,
  type OrchestrationProfile,
  type OrchestrationProfileExportRequest,
  type OrchestrationProfileVersionRestoreRequest,
  type PromptImageAttachment,
  type ProviderConfigInput,
  resolveThreadAgentProfile,
  runtimeRoleRoutesFromAgentProfile,
  type RoleRouteConfig,
  type RouteProfileInput,
  type RuntimeAgentRole,
  type RuntimeRoleRouteConfig,
  type SessionSyncSettingsInput,
  type SessionSyncTestConnectionRequest,
  type TestProviderConnectionRequest,
  type TestRoleRoutesRequest,
  type ThreadActivityLine,
  type ThreadAppliedDiffResult,
  type ThreadBillingSnapshot,
  type ThreadContextSnapshot,
  type ThreadContinueRequest,
  type ThreadContinueResult,
  type ThreadLiveEvent,
  type ThreadModelUsageEntry,
  type ThreadPendingPlan,
  type ThreadRetryRequest,
  type ThreadRetryResult,
  type ThreadRevertAppliedDiffResult,
  type ThreadRewindCheckpointRequest,
  type ThreadRewindCheckpointResult,
  type ThreadRollbackResult,
  type ThreadRunProjectionSnapshot,
  type ThreadRunToolMetadata,
  type ThreadRuntimeConfig,
  type ThreadRuntimeConfigInput,
  type ThreadStartRequest,
  type ThreadStatus,
  type ThreadSummary,
  type ThreadUpdateRuntimeConfigRequest,
  type ThreadUsageSnapshot,
  type ThreadUsageSnapshotResult,
  type WorkspaceInfo,
  type WorktreeApplyResult,
  type WorktreeCancelDisposition,
  type WorktreeStatusResult,
} from "../shared/ipc";
import { parseThreadApprovePlanPayload } from "../shared/plan-approval";
import { buildAgentProfileArchive, parseAgentProfileArchiveBundle } from "../shared/agent-profile-archive";
import { buildAgentTemplateArchive, parseAgentTemplateArchive } from "../shared/agent-template-archive";
import { computeRouteFingerprint, routesMatchFingerprint } from "../shared/route-fingerprint";
import {
  buildRuntimeAgentSkillAssignments,
  filterExplicitUserSkillNames,
  type LinkAgentsSkillsRequest,
  listSdkReadyProjectSkills,
  mergeSkillNames,
} from "../shared/skills";
import {
  buildAgentPromptWithContext,
  continueStatusMessage,
  isContinuableThreadStatus,
  resolveThreadContinueAction,
  type ThreadContinueAction,
  threadEnteredExecutionPhase,
} from "../shared/thread-continuation";
import {
  buildPlanExecutionFailureMessage,
  planExecutionFailurePrefix,
} from "../shared/thread-failure-message";
import {
  buildWorktreeMergeSummary,
  formatWorktreeMergeThreadMessage,
  serializeWorktreeMergeMessage,
} from "../shared/worktree-merge";
import { ActiveRunBillingStateStore } from "./active-run-billing-state";
import { type ActiveRunRuntimeStateInput, ActiveRunRuntimeStateStore } from "./active-run-runtime-state";
import { resolveActivityAgentId, resolveOtelActivityAgentId } from "./activity-agent-id";
import { AgentLifecycleService } from "./agent-lifecycle-service";
import { buildAgentAuditExportArchive } from "./agent-audit-export";
import { type AgentOrchestrationStore, createAgentOrchestrationStore } from "./agent-orchestration-store";
import { buildAgentProfilePerformanceSnapshots } from "./agent-profile-performance";
import { mergeAgentRegistrySettings } from "./agent-registry-settings";
import {
  cancelBashApprovalsForThread,
  getPendingBashApprovalByToolUseId,
  getPendingBashApprovalForThread,
  registerPendingBashApproval,
  resolvePendingBashApproval,
} from "./bash-approval-bridge";
import {
  type AnthropicProxyStartOptions,
  type AnthropicProxyUsageHandler,
  type AnthropicProxyUsageInfo,
  estimateInputTokensFromAnthropicBody,
  startAnthropicModelProxy,
} from "./anthropic-proxy";
import { isSubagentBillingRole, type UsageBillingObservation } from "./billing-orchestration";
import {
  lookupRouteCapabilityHints,
  lookupRoutePricingHints,
  type RuntimeRoute,
  resolveRuntimeRoutesFromSettings,
} from "./billing-resolver";
import {
  type BillingRuntimeEnvironment,
  createBillingRuntimeEnvironment,
  resolveBillingRuntimeContext,
} from "./billing-runtime-environment";
import {
  type FinalizeCancelledRunDeps,
  finalizeCancelledRun,
  parseThreadCancelRequest,
  takePendingCancelDisposition,
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
import { type CompactionAuditService, createCompactionAuditService } from "./compaction-audit-service";
import { type ContextLifecycleService, createContextLifecycleService } from "./context-lifecycle-service";
import { logContextSnapshot } from "./context-snapshot-log";
import { ContextSnapshotScheduler } from "./context-snapshot-scheduler";
import { ContextWindowMonitor } from "./context-window-monitor";
import { type ConversationStore, createConversationStore } from "./conversation-store";
import { logEcoDiag, logEcoDiagThrottled, shortAgentId, shortThreadId } from "./eco-diag-log";
import { createMcpStore, type McpStore } from "./mcp-store";
import { ModelsDevPricingCache } from "./models-dev-pricing-cache";
import { localOtelReceiver } from "./otel-receiver";
import { resolveOtelUsageBilling } from "./otel-usage-billing";
import { listProviderUpstreamModels, testProviderConnection, testRoleRoutes } from "./provider-models";
import { createProviderStore, type ProviderStore } from "./provider-store";
import {
  createProxyBridgeSettingsStore,
  isProxyBridgeSettingsSnapshot,
  normalizeProxyBridgeSettingsSnapshot,
  type ProxyBridgeSettingsStore,
  resolveUpstreamUserAgentOverride,
} from "./proxy-bridge-settings-store";
import { resolveProxyUsageBilling } from "./proxy-usage-billing";
import {
  formatUserFacingRequestError,
  REQUEST_AUTO_RETRY_INTERVAL_MS,
  type RequestAttemptResult,
} from "./request-retry";
import type { resolveSdkEventUsageBilling, SdkRunUsageBillingInput } from "./sdk-event-usage-billing";
import { resolveSdkRunBillingResolution } from "./sdk-run-billing-resolution";
import { consumeSdkRunEvents } from "./sdk-run-event-loop";
import { buildSdkRunInput, sdkRunPhaseFromMode } from "./sdk-run-input";
import { SdkStreamActivityBridge } from "./sdk-stream-activity";
import {
  resolveSdkStreamPartialBillingOrchestration,
  type SdkStreamPartialBillingRequest,
} from "./sdk-stream-partial-billing-orchestration";
import type { SdkRunHookContextExtras } from "./sdk-task-run-hooks";
import { dispatchSdkEventUsageBilling } from "./sdk-usage-billing-dispatch";
import { handleSdkUsageRecordedEvent } from "./sdk-usage-recorded-event-handler";
import { createSessionSyncStore, type SessionSyncStore } from "./session-sync-store";
import {
  resolveSingleUsageBillingOrchestration,
  type SingleUsageBillingRequest,
} from "./single-usage-billing-orchestration";
import { listDiscoveredSkills } from "./skills-discovery";
import { linkAgentsSkillsToClaude } from "./skills-symlink";
import { SubagentMetricsRegistry } from "./subagent-metrics-registry";
import { buildSubagentMetricsSummaries } from "./subagent-metrics-summary";
import { createSubagentSessionHooks, type PendingSubagentLaunch } from "./subagent-session-hooks.js";
import { normalizeSubagentMissionKey } from "./subagent-session-resolve.js";
import { buildSubagentSessionTimings } from "./subagent-session-snapshots.js";
import { resolveSubagentUsageAttribution } from "./subagent-usage-attribution";
import { normalizeTelemetryBillingRole } from "./telemetry-billing-role";
import { classifyThreadIntent } from "./thread-intent";
import {
  flushThreadMetrics,
  persistThreadMetrics,
  restoreThreadMetricsFromStore,
} from "./thread-metrics-runtime";
import { resolveThreadPendingPlanDismissal } from "./thread-pending-plan-dismissal";
import { buildThreadPendingPlanView } from "./thread-pending-plan-view";
import { resolveThreadPlanApprovalRuntime } from "./thread-plan-approval-runtime";
import { applyThreadPlanReadyEffects } from "./thread-plan-ready-effects";
import { runThreadRequestWithLifecycleAutoRetry } from "./thread-run-attempt";
import { type FinalizeThreadRunCleanupInput, finalizeThreadRunCleanup } from "./thread-run-cleanup";
import {
  type ApplyThreadRunDecisionEffectsInput,
  applyThreadRunDecisionEffects,
} from "./thread-run-decision-effects";
import { buildThreadRunEventFromLiveEvent } from "./thread-run-event-normalizer";
import {
  resolveAutonomousRunOutcome,
  resolveContinuationRunOutcome,
  resolveExecutionRunOutcome,
  resolvePlanningRunOutcome,
  resolveQuestionRunOutcome,
  runAttemptPhaseFromThreadMode,
} from "./thread-run-outcome";
import { buildThreadRunProjection } from "./thread-run-projection";
import { runThreadRequestWithRuntimeProxy } from "./thread-runtime-proxy-attempt";
import {
  buildDriverRoutes,
  buildDriverRoutesFromRuntime,
  type RuntimeConfig,
  type RuntimeConfigResolution,
  resolveThreadRuntimeConfig,
  roleRoutesFromRuntime,
} from "./thread-runtime-routes";
import { createThreadSdkTaskRuntime } from "./thread-sdk-task-runtime";
import {
  pendingThreadTitle,
  shouldReplaceAutoThreadTitle,
  summarizeThreadTitle,
  threadTitleFromPlannerPlan,
} from "./thread-title";
import { loadThreadTodoList } from "./thread-todo-list-runtime";
import { ThreadUsageAccumulator } from "./thread-usage-accumulator";
import { getUpstreamLogFilePath } from "./upstream-log";
import type { UpstreamProxyCallBilling } from "./upstream-proxy-log";
import type { UsageBillingPricingRoute } from "./usage-billing-artifacts";
import {
  applySdkRunBillingEffects,
  applySdkStreamPartialBillingEffects,
  applySingleUsageBillingEffects,
  type UsageBillingUpdatedEvent,
} from "./usage-billing-effects";
import { createUsageContextService } from "./usage-context-effects";
import type { RunAttemptPhase, RunAttemptStatus } from "./usage-ledger";
import { UsageLedgerCoordinator } from "./usage-ledger-coordinator";
import {
  createWorkflowSettingsStore,
  isWorkflowSettingsSnapshot,
  normalizeWorkflowSettingsSnapshot,
  orchestrationModeFromSnapshot,
  type WorkflowSettingsStore,
} from "./workflow-settings-store";
import { prepareWorkspaceGit } from "./workspace-git-setup";
import { inspectWorkspace, resolveGitExecutable } from "./workspace-inspect";
import {
  approvedPlanSnapshotExists,
  isWorktreeGitCwdError,
  readApprovedPlanSnapshot,
  resolveWorktreePathHint,
  writeApprovedPlanSnapshot,
} from "./worktree-lifecycle";

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
let agentOrchestrationStore: AgentOrchestrationStore;
let mcpStore: McpStore;
let conversationStore: ConversationStore;
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
const runProjectionEmitTimers = new Map<string, ReturnType<typeof setTimeout>>();
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
  agentOrchestrationStore = await createAgentOrchestrationStore(dbPath);
  mcpStore = await createMcpStore(dbPath);
  conversationStore = await createConversationStore(dbPath);
  subagentMetricsRegistry = new SubagentMetricsRegistry(conversationStore);
  usageLedgerCoordinator = new UsageLedgerCoordinator({
    store: conversationStore,
    metrics: subagentMetricsRegistry,
    logDiag: logEcoDiag,
    logDiagThrottled: logEcoDiagThrottled,
  });
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
    emitCompactionStatus: emitContextCompactionStatus,
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
    emitCompactionStatus: emitContextCompactionStatus,
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
    sdkSessionStore = await createSqliteSessionStore(
      path.join(app.getPath("userData"), "eco-sessions.sqlite"),
    );
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

function getModelSettingsSnapshot(): ModelSettingsSnapshot {
  return mergeAgentRegistrySettings(providerStore.getSettings(), agentOrchestrationStore);
}

function assertCanWriteAgentTemplateId(id: string): void {
  const templateId = id.trim();
  if (!templateId) {
    return;
  }
  const protectedIds = new Set(providerStore.getSettings().agentTemplates.map((template) => template.id));
  if (protectedIds.has(templateId)) {
    throw new Error("内置子代理模板不可直接修改，请先复制为用户模板。");
  }
}

function assertCanWriteOrchestrationProfileId(id: string): void {
  const profileId = id.trim();
  if (!profileId) {
    return;
  }
  const protectedIds = new Set(
    providerStore.getSettings().orchestrationProfiles.map((profile) => profile.id),
  );
  if (protectedIds.has(profileId)) {
    throw new Error("派生编排配置不可直接修改，请先复制为用户配置。");
  }
}

function prepareImportedAgentTemplate(template: AgentTemplate, existingIds: Set<string>): AgentTemplate {
  const now = new Date().toISOString();
  const protectedId =
    template.builtIn ||
    template.source === "built_in" ||
    (typeof template.id === "string" && template.id.trim().startsWith("builtin."));
  if (protectedId) {
    const domain = typeof template.domain === "string" ? template.domain : "custom";
    const name =
      typeof template.name === "string" && template.name.trim() ? template.name.trim() : "Imported Agent";
    const id = createUniqueImportedTemplateId(
      `user.imported.${slugifyTemplateId(name) || "agent"}`,
      existingIds,
    );
    existingIds.add(id);
    return {
      ...template,
      id,
      name,
      builtIn: false,
      source: "user",
      version: 1,
      updatedAt: now,
      domain,
    };
  }
  const id = typeof template.id === "string" ? template.id.trim() : "";
  if (id) {
    existingIds.add(id);
  }
  return {
    ...template,
    id,
    builtIn: false,
    source: template.source === "project" ? "project" : "user",
    updatedAt: now,
  };
}

function prepareImportedOrchestrationProfile(
  profile: OrchestrationProfile,
  existingIds: Set<string>,
): OrchestrationProfile {
  const now = new Date().toISOString();
  const rawId = typeof profile.id === "string" ? profile.id.trim() : "";
  const protectedId =
    profile.source === "built_in" ||
    profile.source === "derived" ||
    rawId.startsWith("builtin.") ||
    rawId.startsWith("derived.");
  const name =
    typeof profile.name === "string" && profile.name.trim()
      ? profile.name.trim()
      : "Imported Agent Profile";
  const id =
    !rawId || protectedId || existingIds.has(rawId)
      ? createUniqueImportedProfileId(
          `user.imported.${slugifyTemplateId(name) || "profile"}`,
          existingIds,
        )
      : rawId;
  existingIds.add(id);
  return {
    ...profile,
    id,
    name,
    source: profile.source === "project" && !protectedId ? "project" : "user",
    version: Math.max(1, typeof profile.version === "number" ? profile.version : 1),
    updatedAt: now,
  };
}

function collectExportableProfileTemplates(
  profiles: readonly OrchestrationProfile[],
  templates: readonly AgentTemplate[],
): AgentTemplate[] {
  const referencedTemplateIds = new Set(
    profiles.flatMap((profile) => profile.agents.map((agent) => agent.templateId.trim()).filter(Boolean)),
  );
  return templates.filter(
    (template) =>
      referencedTemplateIds.has(template.id) &&
      !template.builtIn &&
      template.source !== "built_in" &&
      template.source !== "derived",
  );
}

function rewriteProfileTemplateIds(
  profile: OrchestrationProfile,
  templateIdMap: ReadonlyMap<string, string>,
): OrchestrationProfile {
  if (templateIdMap.size === 0) {
    return profile;
  }
  return {
    ...profile,
    agents: profile.agents.map((agent) => ({
      ...agent,
      templateId: templateIdMap.get(agent.templateId) ?? agent.templateId,
    })),
  };
}

function createUniqueImportedTemplateId(baseId: string, existingIds: ReadonlySet<string>): string {
  let candidate = baseId;
  let suffix = 2;
  while (existingIds.has(candidate)) {
    candidate = `${baseId}_${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function createUniqueImportedProfileId(baseId: string, existingIds: ReadonlySet<string>): string {
  let candidate = baseId;
  let suffix = 2;
  while (existingIds.has(candidate)) {
    candidate = `${baseId}_${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function slugifyTemplateId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function buildDefaultThreadRuntimeConfig(): ThreadRuntimeConfig {
  return buildThreadRuntimeConfigFromDefaults({
    settings: getModelSettingsSnapshot(),
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
): RuntimeRoleRouteConfig[] {
  const profile = resolveThreadAgentProfile(settings, config);
  if (profile && config.agentProfileId?.trim()) {
    return runtimeRoleRoutesFromAgentProfile(profile);
  }
  const routes = config.routeProfileId ? getRoutesForProfile(settings, config.routeProfileId) : undefined;
  if (routes) {
    return routes;
  }
  if (profile) {
    return runtimeRoleRoutesFromAgentProfile(profile);
  }
  throw new Error(`找不到 Agent Profile：${config.agentProfileId ?? config.routeProfileId}`);
}

function runtimeValidationOptionsForThreadConfig(
  settings: ModelSettingsSnapshot,
  config: ThreadRuntimeConfig,
): { requireCompleteCodingRoutes?: boolean } {
  const profile = resolveThreadAgentProfile(settings, config);
  return { requireCompleteCodingRoutes: !profile || profile.preset === "coding" };
}

function resolveRuntimeConfigForThreadConfig(
  settings: ModelSettingsSnapshot,
  config: ThreadRuntimeConfig,
  roleRoutes?: readonly RuntimeRoleRouteConfig[],
): RuntimeConfigResolution {
  return resolveThreadRuntimeConfig(
    settings,
    providerStore.listProvidersWithSecrets(),
    roleRoutes ?? roleRoutesForThreadConfig(settings, config),
    runtimeValidationOptionsForThreadConfig(settings, config),
  );
}

function resolveRuntimeConfigForThreadId(
  threadId: string,
  routesOverride?: readonly RuntimeRoleRouteConfig[],
  optionsOverride?: { requireCompleteCodingRoutes?: boolean },
): RuntimeConfigResolution {
  const settings = getModelSettingsSnapshot();
  const thread = conversationStore.getThread(threadId);
  if (!thread) {
    throw new Error("Thread was not found.");
  }
  const config = ensureThreadRuntimeConfig(thread).runtimeConfig;
  if (!config) {
    throw new Error("Thread runtime configuration is missing.");
  }
  return resolveThreadRuntimeConfig(
    settings,
    providerStore.listProvidersWithSecrets(),
    routesOverride ?? roleRoutesForThreadConfig(settings, config),
    optionsOverride ?? runtimeValidationOptionsForThreadConfig(settings, config),
  );
}

function resolveRoleRoutesForThread(threadId: string, routeProfileIdOverride?: string): RuntimeRoleRouteConfig[] {
  const settings = getModelSettingsSnapshot();
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
  const settings = getModelSettingsSnapshot();
  const providers = providerStore.listProvidersWithSecrets();
  const roleRoutes = resolveRoleRoutesForThread(threadId);
  return resolveRuntimeRoutesFromSettings(settings, providers, roleRoutes);
}

function resolveAgentRuntimeConfigForThread(thread: ThreadSummary): EcoAgentRuntimeConfig | undefined {
  const runtimeConfig = ensureThreadRuntimeConfig(thread).runtimeConfig;
  if (!runtimeConfig) {
    return undefined;
  }
  const settings = getModelSettingsSnapshot();
  const profile = resolveThreadAgentProfile(settings, runtimeConfig);
  if (!profile) {
    return undefined;
  }
  return {
    templates: settings.agentTemplates,
    profile,
  };
}

function resolveAgentRuntimeConfigForThreadId(threadId: string): EcoAgentRuntimeConfig | undefined {
  const thread = conversationStore.getThread(threadId);
  return thread ? resolveAgentRuntimeConfigForThread(thread) : undefined;
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
      payload &&
      typeof payload === "object" &&
      typeof (payload as { workspacePath?: unknown }).workspacePath === "string"
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

  ipcMain.handle(IPC_CHANNELS.threadDelete, async (_event, payload: unknown) => {
    const threadId = typeof payload === "string" ? payload.trim() : "";
    if (!threadId) {
      throw new Error("Thread id is required.");
    }
    const thread = conversationStore.getThread(threadId);
    if (!thread) {
      return { ok: true as const };
    }
    if (thread.status === "running" || thread.status === "queued") {
      throw new Error("请先停止当前运行后再删除对话。");
    }

    await deleteThreadSdkSession(threadId);
    conversationStore.deleteThread(threadId);
    clearThreadRuntimeMemory(threadId);
    emitThreadEvent(threadId, "thread.deleted", "对话已删除。", "system", false);
    return { ok: true as const };
  });

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
    const settings = getModelSettingsSnapshot();
    const roleRoutes = roleRoutesForThreadConfig(settings, runtimeConfig);
    conversationStore.saveThreadRuntimeConfig(threadId, runtimeConfig);
    noteSdkSessionRouteChange(threadId, roleRoutes);
    return { thread: ensureThreadRuntimeConfig(conversationStore.getThread(threadId) ?? thread) };
  });

  ipcMain.handle(IPC_CHANNELS.threadActivityList, async (_event, threadId: string) => {
    if (typeof threadId !== "string" || !threadId.trim()) {
      return [];
    }
    return conversationStore.listActivityLines(threadId);
  });

  ipcMain.handle(IPC_CHANNELS.threadRunProjectionGet, async (_event, threadId: string) => {
    if (typeof threadId !== "string" || !threadId.trim()) {
      return undefined;
    }
    return buildCurrentThreadRunProjection(threadId.trim());
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
    return buildSubagentMetricsSummaries(usageLedgerCoordinator.listSubagentBillingEntries(threadId));
  });

  ipcMain.handle(IPC_CHANNELS.agentProfilePerformanceList, async () =>
    buildAgentProfilePerformanceSnapshots({
      threads: hydrateThreads(conversationStore.listThreads()),
      profiles: getModelSettingsSnapshot().orchestrationProfiles,
      getBillingSnapshot: (threadId) => usageLedgerCoordinator.projectBillingSnapshot(threadId),
    }),
  );

  ipcMain.handle(IPC_CHANNELS.agentAuditExport, async (_event, payload?: unknown) => {
    const request = payload && typeof payload === "object" ? (payload as AgentAuditExportRequest) : {};
    const requestedThreadIds = Array.isArray(request.threadIds)
      ? new Set(request.threadIds.map((id) => id.trim()).filter(Boolean))
      : undefined;
    const threads = hydrateThreads(conversationStore.listThreads()).filter((thread) =>
      requestedThreadIds ? requestedThreadIds.has(thread.id) : true,
    );
    if (threads.length === 0) {
      throw new Error("没有可导出的审计线程。");
    }
    const result = await dialog.showSaveDialog({
      title: "导出 Agent 审计日志",
      defaultPath: `eco-agent-audit-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) {
      return { ok: true as const, canceled: true, exportedThreads: 0 };
    }
    const settings = getModelSettingsSnapshot();
    const profilePerformance = buildAgentProfilePerformanceSnapshots({
      threads,
      profiles: settings.orchestrationProfiles,
      getBillingSnapshot: (threadId) => usageLedgerCoordinator.projectBillingSnapshot(threadId),
    });
    const archive = buildAgentAuditExportArchive({
      appVersion: app.getVersion(),
      threads,
      profiles: settings.orchestrationProfiles,
      agentTemplates: settings.agentTemplates,
      profilePerformance,
      getThreadBilling: (threadId) => usageLedgerCoordinator.projectBillingSnapshot(threadId),
      getThreadRunProjection: (threadId) => buildCurrentThreadRunProjection(threadId),
      listThreadActivity: (threadId) => conversationStore.listActivityLines(threadId),
      listRunAttempts: (threadId) => conversationStore.listRunAttempts(threadId),
      listAgentInstances: (threadId) => conversationStore.listAgentInstances(threadId),
      listUsageLedgerEvents: (threadId) => conversationStore.listUsageLedgerEvents(threadId),
    });
    await fs.writeFile(result.filePath, JSON.stringify(archive, null, 2), "utf8");
    return {
      ok: true as const,
      canceled: false,
      exportedThreads: threads.length,
      path: result.filePath,
    };
  });

  ipcMain.handle(IPC_CHANNELS.threadTodoList, async (_event, threadId: string) => {
    if (typeof threadId !== "string" || !threadId.trim()) {
      return [];
    }
    return loadThreadTodoList({
      threadId,
      services: {
        listTodos: (id) => conversationStore.listCoderTodos(id),
        listActivity: (id) => conversationStore.listActivityLines(id),
        replaceTodos: (id, todos) => conversationStore.replaceCoderTodos(id, todos),
      },
    });
  });

  ipcMain.handle(IPC_CHANNELS.modelSettingsGet, async () => getModelSettingsSnapshot());

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

  ipcMain.handle(IPC_CHANNELS.agentTemplateList, async () => getModelSettingsSnapshot().agentTemplates);

  ipcMain.handle(IPC_CHANNELS.agentTemplateSave, async (_event, payload: unknown) => {
    if (!payload || typeof payload !== "object") {
      throw new Error("子代理模板配置不能为空。");
    }
    const template = payload as AgentTemplate;
    if (typeof template.id !== "string") {
      throw new Error("子代理模板 id 不能为空。");
    }
    assertCanWriteAgentTemplateId(template.id);
    const saved = agentOrchestrationStore.saveAgentTemplate(template);
    emitSettingsUpdated();
    return saved;
  });

  ipcMain.handle(IPC_CHANNELS.agentTemplateDelete, async (_event, templateId: unknown) => {
    if (typeof templateId !== "string" || !templateId.trim()) {
      throw new Error("子代理模板 id 不能为空。");
    }
    assertCanWriteAgentTemplateId(templateId);
    agentOrchestrationStore.deleteAgentTemplate(templateId);
    emitSettingsUpdated();
    return { ok: true as const };
  });

  ipcMain.handle(IPC_CHANNELS.agentTemplateExport, async (_event, payload?: unknown) => {
    const request = payload && typeof payload === "object" ? (payload as AgentTemplateExportRequest) : {};
    const requestedIds = Array.isArray(request.templateIds)
      ? new Set(request.templateIds.map((id) => id.trim()).filter(Boolean))
      : undefined;
    const templates = getModelSettingsSnapshot().agentTemplates.filter((template) => {
      if (requestedIds) {
        return requestedIds.has(template.id);
      }
      return !template.builtIn && template.source !== "built_in" && template.source !== "derived";
    });
    if (templates.length === 0) {
      throw new Error("没有可导出的子代理模板。");
    }
    const result = await dialog.showSaveDialog({
      title: "导出子代理模板",
      defaultPath: `eco-agent-templates-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) {
      return { ok: true as const, canceled: true, exported: 0 };
    }
    await fs.writeFile(
      result.filePath,
      JSON.stringify(buildAgentTemplateArchive(templates), null, 2),
      "utf8",
    );
    return {
      ok: true as const,
      canceled: false,
      exported: templates.length,
      path: result.filePath,
    };
  });

  ipcMain.handle(IPC_CHANNELS.agentTemplateImport, async () => {
    const result = await dialog.showOpenDialog({
      title: "导入子代理模板",
      properties: ["openFile"],
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    const filePath = result.filePaths[0];
    if (result.canceled || !filePath) {
      return { ok: true as const, canceled: true, imported: 0, templates: [], errors: [] };
    }
    const content = await fs.readFile(filePath, "utf8");
    const parsedTemplates = parseAgentTemplateArchive(content);
    const existingIds = new Set(getModelSettingsSnapshot().agentTemplates.map((template) => template.id));
    const imported: AgentTemplate[] = [];
    const errors: string[] = [];
    for (const [index, template] of parsedTemplates.entries()) {
      try {
        const prepared = prepareImportedAgentTemplate(template, existingIds);
        imported.push(agentOrchestrationStore.saveAgentTemplate(prepared));
      } catch (caught) {
        errors.push(`模板 ${index + 1}: ${caught instanceof Error ? caught.message : String(caught)}`);
      }
    }
    if (imported.length > 0) {
      emitSettingsUpdated();
    }
    return {
      ok: true as const,
      canceled: false,
      imported: imported.length,
      templates: imported,
      errors,
    };
  });

  ipcMain.handle(IPC_CHANNELS.agentTemplateVersionsList, async (_event, templateId: unknown) => {
    if (typeof templateId !== "string" || !templateId.trim()) {
      throw new Error("子代理模板 id 不能为空。");
    }
    return agentOrchestrationStore.listAgentTemplateVersions(templateId);
  });

  ipcMain.handle(IPC_CHANNELS.agentTemplateVersionRestore, async (_event, payload: unknown) => {
    if (
      !payload ||
      typeof payload !== "object" ||
      typeof (payload as AgentTemplateVersionRestoreRequest).templateId !== "string" ||
      typeof (payload as AgentTemplateVersionRestoreRequest).version !== "number"
    ) {
      throw new Error("子代理模板版本恢复请求无效。");
    }
    const request = payload as AgentTemplateVersionRestoreRequest;
    assertCanWriteAgentTemplateId(request.templateId);
    const restored = agentOrchestrationStore.restoreAgentTemplateVersion(request.templateId, request.version);
    emitSettingsUpdated();
    return restored;
  });

  ipcMain.handle(
    IPC_CHANNELS.orchestrationProfileList,
    async () => getModelSettingsSnapshot().orchestrationProfiles,
  );

  ipcMain.handle(IPC_CHANNELS.orchestrationProfileSave, async (_event, payload: unknown) => {
    if (!payload || typeof payload !== "object") {
      throw new Error("编排配置不能为空。");
    }
    const profile = payload as OrchestrationProfile;
    if (typeof profile.id !== "string") {
      throw new Error("编排配置 id 不能为空。");
    }
    assertCanWriteOrchestrationProfileId(profile.id);
    const saved = agentOrchestrationStore.saveOrchestrationProfile(profile);
    emitSettingsUpdated();
    return saved;
  });

  ipcMain.handle(IPC_CHANNELS.orchestrationProfileDelete, async (_event, profileId: unknown) => {
    if (typeof profileId !== "string" || !profileId.trim()) {
      throw new Error("编排配置 id 不能为空。");
    }
    assertCanWriteOrchestrationProfileId(profileId);
    agentOrchestrationStore.deleteOrchestrationProfile(profileId);
    emitSettingsUpdated();
    return { ok: true as const };
  });

  ipcMain.handle(IPC_CHANNELS.orchestrationProfileExport, async (_event, payload?: unknown) => {
    const request =
      payload && typeof payload === "object" ? (payload as OrchestrationProfileExportRequest) : {};
    const requestedIds = Array.isArray(request.profileIds)
      ? new Set(request.profileIds.map((id) => id.trim()).filter(Boolean))
      : undefined;
    const settings = getModelSettingsSnapshot();
    const profiles = settings.orchestrationProfiles.filter((profile) => {
      if (requestedIds) {
        return requestedIds.has(profile.id);
      }
      return profile.source === "user" || profile.source === "project";
    });
    if (profiles.length === 0) {
      throw new Error("没有可导出的 Agent Profile。");
    }
    const templates = collectExportableProfileTemplates(profiles, settings.agentTemplates);
    const result = await dialog.showSaveDialog({
      title: "导出 Agent Profile",
      defaultPath: `eco-agent-profiles-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) {
      return { ok: true as const, canceled: true, exported: 0 };
    }
    await fs.writeFile(
      result.filePath,
      JSON.stringify(buildAgentProfileArchive(profiles, undefined, { templates }), null, 2),
      "utf8",
    );
    return {
      ok: true as const,
      canceled: false,
      exported: profiles.length,
      path: result.filePath,
    };
  });

  ipcMain.handle(IPC_CHANNELS.orchestrationProfileImport, async () => {
    const result = await dialog.showOpenDialog({
      title: "导入 Agent Profile",
      properties: ["openFile"],
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    const filePath = result.filePaths[0];
    if (result.canceled || !filePath) {
      return { ok: true as const, canceled: true, imported: 0, profiles: [], errors: [] };
    }
    const content = await fs.readFile(filePath, "utf8");
    const parsedBundle = parseAgentProfileArchiveBundle(content);
    const settings = getModelSettingsSnapshot();
    const existingTemplateIds = new Set(settings.agentTemplates.map((template) => template.id));
    const templateIdMap = new Map<string, string>();
    const errors: string[] = [];
    for (const [index, template] of parsedBundle.templates.entries()) {
      try {
        const prepared = prepareImportedAgentTemplate(template, existingTemplateIds);
        const saved = agentOrchestrationStore.saveAgentTemplate(prepared);
        templateIdMap.set(template.id, saved.id);
      } catch (caught) {
        errors.push(`模板 ${index + 1}: ${caught instanceof Error ? caught.message : String(caught)}`);
      }
    }
    const existingIds = new Set(settings.orchestrationProfiles.map((profile) => profile.id));
    const imported: OrchestrationProfile[] = [];
    for (const [index, profile] of parsedBundle.profiles.entries()) {
      try {
        const prepared = prepareImportedOrchestrationProfile(
          rewriteProfileTemplateIds(profile, templateIdMap),
          existingIds,
        );
        imported.push(agentOrchestrationStore.saveOrchestrationProfile(prepared));
      } catch (caught) {
        errors.push(`Profile ${index + 1}: ${caught instanceof Error ? caught.message : String(caught)}`);
      }
    }
    if (imported.length > 0 || templateIdMap.size > 0) {
      emitSettingsUpdated();
    }
    return {
      ok: true as const,
      canceled: false,
      imported: imported.length,
      profiles: imported,
      errors,
    };
  });

  ipcMain.handle(IPC_CHANNELS.orchestrationProfileVersionsList, async (_event, profileId: unknown) => {
    if (typeof profileId !== "string" || !profileId.trim()) {
      throw new Error("Agent Profile id 不能为空。");
    }
    assertCanWriteOrchestrationProfileId(profileId);
    return agentOrchestrationStore.listOrchestrationProfileVersions(profileId);
  });

  ipcMain.handle(IPC_CHANNELS.orchestrationProfileVersionRestore, async (_event, payload: unknown) => {
    if (
      !payload ||
      typeof payload !== "object" ||
      typeof (payload as OrchestrationProfileVersionRestoreRequest).profileId !== "string" ||
      typeof (payload as OrchestrationProfileVersionRestoreRequest).version !== "number"
    ) {
      throw new Error("Agent Profile 版本恢复请求无效。");
    }
    const request = payload as OrchestrationProfileVersionRestoreRequest;
    assertCanWriteOrchestrationProfileId(request.profileId);
    const restored = agentOrchestrationStore.restoreOrchestrationProfileVersion(
      request.profileId,
      request.version,
    );
    emitSettingsUpdated();
    return restored;
  });

  ipcMain.handle(IPC_CHANNELS.billingModelsDevList, async () => {
    await pricingCatalogReady;
    return pricingCache.listModelOptions();
  });

  ipcMain.handle(IPC_CHANNELS.billingRefreshPricing, async () => {
    await pricingCache.refresh();
    return { ok: true as const, cachedAt: pricingCache.getCachedAt() };
  });

  ipcMain.handle(IPC_CHANNELS.billingRoutePricing, async (_event, routesOverride?: RuntimeRoleRouteConfig[]) => {
    await pricingCatalogReady;
    return lookupRoutePricingHints(
      pricingCache,
      getModelSettingsSnapshot(),
      providerStore.listProvidersWithSecrets(),
      routesOverride,
    );
  });

  ipcMain.handle(
    IPC_CHANNELS.billingRouteCapabilities,
    async (_event, routesOverride?: RuntimeRoleRouteConfig[]) => {
      await pricingCatalogReady;
      return lookupRouteCapabilityHints(
        pricingCache,
        getModelSettingsSnapshot(),
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
    const settings = getModelSettingsSnapshot();
    const roleRoutes = roleRoutesForThreadConfig(settings, threadRuntime);
    const runtimeConfig = resolveRuntimeConfigForThreadConfig(settings, threadRuntime, roleRoutes);
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
        void runQuestionThread(
          thread,
          workspace,
          runtimeConfig,
          prompt,
          undefined,
          undefined,
          attachments,
          roleRoutes,
        );
      } else if (threadRuntime.orchestrationMode === "manual") {
        void runCodingThreadPlanning(
          thread,
          workspace,
          runtimeConfig,
          prompt,
          undefined,
          undefined,
          attachments,
          roleRoutes,
        );
      } else {
        void runCodingThreadAutonomous(
          thread,
          workspace,
          runtimeConfig,
          prompt,
          undefined,
          undefined,
          attachments,
          roleRoutes,
        );
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

  ipcMain.handle(IPC_CHANNELS.bashApprovalGetPending, async (_event, threadId: unknown) => {
    if (typeof threadId !== "string" || !threadId.trim()) {
      return undefined;
    }
    return getPendingBashApprovalForThread(threadId);
  });

  ipcMain.handle(IPC_CHANNELS.bashApprovalResolve, async (_event, payload: unknown) => {
    if (!isBashApprovalResolvePayload(payload)) {
      throw new Error("Invalid Bash approval payload.");
    }
    if (!getPendingBashApprovalByToolUseId(payload.toolUseId)) {
      throw new Error("No pending Bash approval for this tool use.");
    }
    const ok = resolvePendingBashApproval(payload.toolUseId, payload.decision);
    if (!ok) {
      throw new Error("Failed to resolve Bash approval.");
    }
    return { ok: true as const };
  });

  ipcMain.handle(IPC_CHANNELS.threadGetUsageSnapshot, async (_event, threadId: unknown) => {
    if (typeof threadId !== "string" || !threadId.trim()) {
      return {} satisfies ThreadUsageSnapshotResult;
    }
    const id = threadId.trim();
    const ledgerBilling = usageLedgerCoordinator.projectBillingSnapshot(id);
    const legacyBilling = threadUsageAccumulator.getSnapshot(id);
    const billingBase = ledgerBilling
      ? usageLedgerCoordinator.enrichBillingSnapshot(id, ledgerBilling)
      : legacyBilling;
    const billing = billingBase
      ? enrichBillingDisplaySource(billingBase, conversationStore.getThread(id)?.status)
      : undefined;
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
    return buildThreadPendingPlanView(conversationStore.getPendingPlan(threadId));
  });

  ipcMain.handle(IPC_CHANNELS.threadApprovePlan, async (_event, payload: unknown) => {
    const { threadId } = parseThreadApprovePlanPayload(payload);
    const approval = resolveThreadPlanApprovalRuntime(threadId, {
      getThread: (id) => conversationStore.getThread(id),
      hasActiveRun: (id) => activeRunRuntimeState.hasRun(id),
      getPendingPlan: (id) => conversationStore.getPendingPlan(id),
      resolveRoleRoutes: (id) => resolveRoleRoutesForThread(id),
      resolveRuntimeConfig: (routes) => resolveRuntimeConfigForThreadId(threadId, routes),
      usesManualOrchestration: (id) => threadUsesManualOrchestration(id),
    });

    updateThread(threadId, {
      status: "running",
      message: "正在按计划执行…",
    });
    if (approval.launchMode === "manual_execution") {
      void runCodingThreadExecution(threadId, approval.runtimeConfig, {
        routesOverride: approval.roleRoutes,
      });
    } else {
      void runCodingThreadAutonomousAfterApproval(threadId, approval.runtimeConfig, {
        routesOverride: approval.roleRoutes,
      });
    }
    return { thread: ensureThreadRuntimeConfig(conversationStore.getThread(threadId) ?? approval.thread) };
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
    const settings = getModelSettingsSnapshot();
    if (payload.runtimeConfig) {
      const nextConfig = parseThreadRuntimeConfigInput(payload.runtimeConfig);
      roleRoutesForThreadConfig(settings, nextConfig);
      conversationStore.saveThreadRuntimeConfig(payload.threadId, nextConfig);
    }
    const activeThread = ensureThreadRuntimeConfig(conversationStore.getThread(payload.threadId) ?? thread);
    const activeRuntimeConfig = activeThread.runtimeConfig;
    if (!activeRuntimeConfig) {
      throw new Error("Thread runtime configuration is missing.");
    }
    const roleRoutes = roleRoutesForThreadConfig(settings, activeRuntimeConfig);
    noteSdkSessionRouteChange(payload.threadId, roleRoutes);

    const runtimeConfig = resolveRuntimeConfigForThreadConfig(settings, activeRuntimeConfig, roleRoutes);
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
      cancelBashApprovalsForThread(threadId, "cancelled by user");
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

  ipcMain.handle(IPC_CHANNELS.modelProfilesList, async () => getModelSettingsSnapshot().providers);

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

function captureThreadPlanReady(input: {
  threadId: string;
  payload: PlanReadyPayload;
  workspacePath: string;
  worktreePath: string;
  routesJson: string;
  awaitingPlanMessage: string;
  runtimeConfig: RuntimeConfig;
}): true {
  const result = applyThreadPlanReadyEffects({
    threadId: input.threadId,
    payload: input.payload,
    workspacePath: input.workspacePath,
    worktreePath: input.worktreePath,
    routesJson: input.routesJson,
    awaitingPlanMessage: input.awaitingPlanMessage,
    effects: {
      savePendingPlan: (plan) => {
        conversationStore.savePendingPlan(plan);
      },
      emitAwaitingPlan: (event) => {
        emitThreadEvent(event.threadId, "thread.awaiting_plan", event.message, "planner", false, {
          plan: event.plan,
        });
      },
      scheduleTitleSummary: (threadId, context) => {
        scheduleThreadTitleSummary(threadId, input.runtimeConfig, context);
      },
    },
  });

  return result.planCaptured;
}

const THREAD_INTERRUPTED_CONTINUE_HINT = "可在下方继续对话、切换模型后重试，或点击「重试此次请求」。";

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
  emitThreadEvent(threadId, "thread.session_cleared", "原 session 无法接续，已改用对话摘要续聊。", "system");
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
  return runThreadRequestWithLifecycleAutoRetry({
    threadId,
    phase,
    runOnce,
    lifecycle: agentLifecycle,
    settlements: usageLedgerCoordinator,
    ...(signal && { signal }),
    onRetryScheduled: (retryIndex, maxRetries, reason) => {
      const short = reason.length > 240 ? `${reason.slice(0, 237)}…` : reason;
      const message = `【自动重试 ${retryIndex}/${maxRetries}】${short}`;
      emitThreadEvent(threadId, "thread.auto_retry", message, "system");
      updateThread(threadId, { status: "running", message });
    },
  });
}

async function finalizeMainThreadRunCleanup(input: FinalizeThreadRunCleanupInput): Promise<void> {
  await finalizeThreadRunCleanup(input, {
    cancelClarifications: cancelClarificationsForThread,
    cancelBashApprovals: cancelBashApprovalsForThread,
    resetSdkStream: (threadId) => sdkStreamBridge.resetThread(threadId),
    flushUsageUpdates: (threadId) => usageLedgerCoordinator.flushUsageUpdates(threadId),
    finishActiveRun,
    afterRunContextRefresh,
    getThread: (threadId) => conversationStore.getThread(threadId),
    updateThreadIdle: (threadId, message) => {
      updateThread(threadId, { status: "idle", message });
    },
  });
}

function applyMainThreadRunDecisionEffects(
  input: Omit<ApplyThreadRunDecisionEffectsInput, "effects">,
): Promise<boolean> {
  return applyThreadRunDecisionEffects({
    ...input,
    effects: {
      updateThread: (threadId, patch) => updateThread(threadId, patch),
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
  routesOverride?: readonly RuntimeRoleRouteConfig[],
): Promise<void> {
  const controller = new AbortController();
  const cwd = worktreePath?.trim() || workspace.path;
  startActiveRun(thread.id, { controller, worktreePlan: createSessionPlan(workspace.path, thread.id) });
  resetSubagentContextWindows(thread.id);

  try {
    const outcome = await runThreadRequestWithAutoRetry(
      thread.id,
      "question",
      controller.signal,
      async () => {
        return runThreadRequestWithRuntimeProxy({
          threadId: thread.id,
          attachments,
          resolveRuntimeConfig: () => resolveRuntimeConfigForThreadId(thread.id, routesOverride),
          recordRouteFingerprint: recordThreadRouteFingerprint,
          startRuntimeProxy,
          onProxyReady: ({ proxy }) => {
            process.stderr.write(
              `[eco] 模型代理: ${proxy.baseUrl} · 上游日志: ${getUpstreamLogFilePath()}\n`,
            );
            updateThread(thread.id, {
              status: "running",
              message: `Local model router ready: ${proxy.baseUrl}`,
            });
          },
          run: async ({ proxy: attemptProxy, routes }) => {
            const effectiveResume = resume ?? resolveResumeOptions(thread.id, cwd);
            if (effectiveResume) {
              await ensureContextHeadroom(thread.id, cwd, controller.signal, { ignoreRunningGuard: true });
            }
            try {
              const driver = createSdkDriver(thread.id, attemptProxy, undefined, "question");
              if (!driver.runQuestion) {
                throw new Error("Runtime driver does not support question answering.");
              }

              return await consumeSdkRunEvents({
                events: driver.runQuestion(
                  buildSdkRunInput({
                    threadId: thread.id,
                    prompt,
                    workspacePath: workspace.path,
                    worktreePath: cwd,
                    routes,
                    signal: controller.signal,
                    sdkSession: await buildSdkSessionOptions(thread.id, prompt),
                    agentRegistry: resolveAgentRuntimeConfigForThread(thread),
                    ...(effectiveResume ? { resume: effectiveResume } : {}),
                  }),
                ),
                threadId: thread.id,
                worktreePath: cwd,
                signal: controller.signal,
                onUsageRecorded: onSdkUsageRecordedEvent,
                captureSession: captureSdkSessionFromEvent,
                emitActivity: emitSdkStreamActivity,
              });
            } catch (error) {
              if (controller.signal.aborted) {
                return { ok: false, reason: "cancelled by user", aborted: true };
              }
              return { ok: false, reason: errorMessage(error) };
            }
          },
        });
      },
    );

    const decision = resolveQuestionRunOutcome(outcome);
    await applyMainThreadRunDecisionEffects({
      threadId: thread.id,
      decision,
      onCancelled: async (reason) => {
        cancelClarificationsForThread(thread.id, reason);
        const plan = resolveWorktreePlan(workspace.path, thread.id, cwd);
        await handleRunCancelled(thread.id, plan);
      },
      onFailed: (reason) => {
        markThreadInterrupted(thread.id, reason);
      },
      onCompleted: (message) => {
        updateThread(thread.id, { status: "completed", message: message ?? "回答完成。" });
        scheduleThreadTitleSummary(thread.id, runtimeConfig);
      },
    });
  } catch (error) {
    cancelClarificationsForThread(thread.id, errorMessage(error));
    markThreadInterrupted(thread.id, errorMessage(error));
  } finally {
    const worktreePath = resolveThreadWorktreePath(thread.id);
    await finalizeMainThreadRunCleanup({
      threadId: thread.id,
      worktreePath,
      cancelClarificationsReason: "run finished",
      idleFallbackMessage: "回答已结束。",
    });
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
    process.stderr.write(`[eco] workspace diff snapshot failed: ${errorMessage(error)}\n`);
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
  routesOverride?: readonly RuntimeRoleRouteConfig[],
): Promise<void> {
  const controller = new AbortController();
  startActiveRun(thread.id, {
    controller,
    worktreePlan: existingWorktreePlan ?? createSessionPlan(workspace.path, thread.id),
  });
  resetSubagentContextWindows(thread.id);

  let worktreePlan = existingWorktreePlan ?? createSessionPlan(workspace.path, thread.id);

  try {
    const {
      worktreePlan: resolvedPlan,
      cwd,
      isolated,
    } = await resolveThreadWorktree(workspace, thread.id, existingWorktreePlan);
    worktreePlan = resolvedPlan;
    activeRunRuntimeState.setWorktreePlan(thread.id, worktreePlan);
    updateThread(thread.id, {
      message: `Working in project directory: ${workspace.path}`,
      status: "running",
    });

    const resumeOptsForRun = resume ?? resolveResumeOptions(thread.id, cwd);

    const runOutcome = await runThreadRequestWithAutoRetry(
      thread.id,
      "execution",
      controller.signal,
      async () => {
        return runThreadRequestWithRuntimeProxy({
          threadId: thread.id,
          attachments,
          resolveRuntimeConfig: () => resolveRuntimeConfigForThreadId(thread.id, routesOverride),
          recordRouteFingerprint: recordThreadRouteFingerprint,
          startRuntimeProxy,
          onProxyReady: ({ proxy, plannerRoute }) => {
            process.stderr.write(
              `[eco] 模型代理: ${proxy.baseUrl} · 上游日志: ${getUpstreamLogFilePath()}\n`,
            );
            updateThread(thread.id, {
              message: `Local model router ready: ${proxy.baseUrl}`,
              status: "running",
            });
            process.stderr.write(
              `[eco] SDK model=${plannerRoute?.modelId ?? "?"} (direct / claude_code preset)\n`,
            );
          },
          run: async ({ proxy: attemptProxy, routes }) => {
            const effectiveResume = resumeOptsForRun;
            if (effectiveResume) {
              await ensureContextHeadroom(thread.id, cwd, controller.signal, { ignoreRunningGuard: true });
            }

            try {
              const driver = createSdkDriver(thread.id, attemptProxy, undefined, "execution");
              let planCaptured = false;
              const result = await consumeSdkRunEvents({
                events: driver.run(
                  buildSdkRunInput({
                    threadId: thread.id,
                    prompt,
                    workspacePath: workspace.path,
                    worktreePath: cwd,
                    routes,
                    signal: controller.signal,
                    sdkSession: await buildSdkSessionOptions(thread.id, prompt),
                    agentRegistry: resolveAgentRuntimeConfigForThread(thread),
                    ...(effectiveResume ? { resume: effectiveResume } : {}),
                  }),
                ),
                threadId: thread.id,
                worktreePath: cwd,
                signal: controller.signal,
                onUsageRecorded: onSdkUsageRecordedEvent,
                captureSession: captureSdkSessionFromEvent,
                emitActivity: emitSdkStreamActivity,
                onEvent: (event) => {
                  if (event.type === "plan.ready" && isPlanReadyPayload(event.payload)) {
                    planCaptured = captureThreadPlanReady({
                      threadId: thread.id,
                      workspacePath: workspace.path,
                      worktreePath: cwd,
                      routesJson: JSON.stringify(routes),
                      payload: event.payload,
                      awaitingPlanMessage: "Agent 请求确认计划，请审批后继续。",
                      runtimeConfig,
                    });
                  }
                },
              });
              if (!result.ok) {
                return result;
              }
              return { ok: true, planCaptured };
            } catch (error) {
              if (controller.signal.aborted) {
                return { ok: false, reason: "cancelled by user", aborted: true };
              }
              return { ok: false, reason: errorMessage(error) };
            }
          },
        });
      },
    );

    const runDecision = resolveAutonomousRunOutcome(runOutcome, {
      hasPendingPlan: Boolean(conversationStore.getPendingPlan(thread.id)),
      planCaptured: runOutcome.ok && "planCaptured" in runOutcome && runOutcome.planCaptured === true,
    });

    if (
      await applyMainThreadRunDecisionEffects({
        threadId: thread.id,
        decision: runDecision,
        onCancelled: async (reason) => {
          cancelClarificationsForThread(thread.id, reason);
          await handleRunCancelled(thread.id, worktreePlan);
        },
        onFailed: (reason) => {
          cancelClarificationsForThread(thread.id, reason);
          clearSdkSessionAfterResumeFailure(thread.id, Boolean(resumeOptsForRun));
          markThreadInterrupted(thread.id, reason);
        },
      })
    ) {
      return;
    }

    await completeCodingThreadRun(thread.id, worktreePlan);
    scheduleThreadTitleSummary(thread.id, runtimeConfig);
  } catch (error) {
    cancelClarificationsForThread(thread.id, errorMessage(error));
    markThreadInterrupted(thread.id, errorMessage(error));
  } finally {
    const worktreePath = resolveThreadWorktreePath(thread.id);
    await finalizeMainThreadRunCleanup({
      threadId: thread.id,
      worktreePath,
      cancelClarificationsReason: "run finished",
      idleFallbackMessage: "运行已结束。",
    });
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
  routesOverride?: readonly RuntimeRoleRouteConfig[],
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

    const planningOutcome = await runThreadRequestWithAutoRetry(
      thread.id,
      "planning",
      controller.signal,
      async () => {
        return runThreadRequestWithRuntimeProxy({
          threadId: thread.id,
          attachments,
          resolveRuntimeConfig: () => resolveRuntimeConfigForThreadId(thread.id, routesOverride),
          recordRouteFingerprint: recordThreadRouteFingerprint,
          startRuntimeProxy,
          onProxyReady: ({ proxy, plannerRoute }) => {
            process.stderr.write(
              `[eco] 模型代理: ${proxy.baseUrl} · 上游日志: ${getUpstreamLogFilePath()}\n`,
            );
            updateThread(thread.id, {
              message: `Local model router ready: ${proxy.baseUrl}`,
              status: "running",
            });
            process.stderr.write(
              `[eco] SDK model=${plannerRoute?.modelId ?? "?"} (proxy ${proxy.baseUrl}, alias ${plannerRoute?.aliasModelId ?? "?"})\n`,
            );
          },
          run: async ({ proxy: attemptProxy, routes }) => {
            const effectiveResume = resumeOptsForRun;
            if (effectiveResume) {
              await ensureContextHeadroom(thread.id, cwd, controller.signal, { ignoreRunningGuard: true });
            }

            try {
              const driver = createSdkDriver(thread.id, attemptProxy, undefined, "planning");

              return await consumeSdkRunEvents({
                events: driver.run(
                  buildSdkRunInput({
                    threadId: thread.id,
                    prompt,
                    workspacePath: workspace.path,
                    worktreePath: cwd,
                    routes,
                    signal: controller.signal,
                    sdkSession: await buildSdkSessionOptions(thread.id, prompt),
                    agentRegistry: resolveAgentRuntimeConfigForThread(thread),
                    ...(effectiveResume ? { resume: effectiveResume } : {}),
                  }),
                ),
                threadId: thread.id,
                worktreePath: cwd,
                signal: controller.signal,
                onUsageRecorded: onSdkUsageRecordedEvent,
                captureSession: captureSdkSessionFromEvent,
                emitActivity: emitSdkStreamActivity,
                onEvent: (event) => {
                  if (event.type === "plan.ready" && isPlanReadyPayload(event.payload)) {
                    captureThreadPlanReady({
                      threadId: thread.id,
                      workspacePath: workspace.path,
                      worktreePath: cwd,
                      routesJson: JSON.stringify(routes),
                      payload: event.payload,
                      awaitingPlanMessage: "计划已生成，请确认是否执行。",
                      runtimeConfig,
                    });
                  }
                },
              });
            } catch (error) {
              if (controller.signal.aborted) {
                return { ok: false, reason: "cancelled by user", aborted: true };
              }
              return { ok: false, reason: errorMessage(error) };
            }
          },
        });
      },
    );

    const planningDecision = resolvePlanningRunOutcome(planningOutcome, {
      hasPendingPlan: Boolean(conversationStore.getPendingPlan(thread.id)),
    });

    if (
      await applyMainThreadRunDecisionEffects({
        threadId: thread.id,
        decision: planningDecision,
        onCancelled: async (reason) => {
          cancelClarificationsForThread(thread.id, reason);
          await handleRunCancelled(thread.id, worktreePlan);
        },
        onFailed: (reason) => {
          cancelClarificationsForThread(thread.id, reason);
          clearSdkSessionAfterResumeFailure(thread.id, Boolean(resumeOptsForRun));
          markThreadInterrupted(thread.id, reason);
        },
      })
    ) {
      return;
    }
  } catch (error) {
    cancelClarificationsForThread(thread.id, errorMessage(error));
    markThreadInterrupted(thread.id, errorMessage(error));
  } finally {
    const worktreePath = resolveThreadWorktreePath(thread.id);
    await finalizeMainThreadRunCleanup({
      threadId: thread.id,
      worktreePath,
      cancelClarificationsReason: "run finished",
      idleFallbackMessage: "计划阶段已结束。",
    });
  }
}

async function runCodingThreadAutonomousAfterApproval(
  threadId: string,
  runtimeConfig: RuntimeConfig,
  options?: {
    routesOverride?: readonly RuntimeRoleRouteConfig[];
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
    process.stderr.write(`[eco] failed to write approved plan snapshot: ${errorMessage(error)}\n`);
  }

  try {
    conversationStore.clearPendingPlan(threadId);
    emitThreadEvent(threadId, "thread.plan_cleared", "计划已批准，继续同会话执行。", "system");

    const outcome = await runThreadRequestWithAutoRetry(
      threadId,
      "execution",
      controller.signal,
      async () => {
        return runThreadRequestWithRuntimeProxy({
          threadId,
          resolveRuntimeConfig: () => resolveRuntimeConfigForThreadId(threadId, options?.routesOverride),
          recordRouteFingerprint: recordThreadRouteFingerprint,
          startRuntimeProxy,
          run: async ({ proxy: attemptProxy, routes }) => {
            const resume = resolveResumeOptions(threadId, cwd);
            if (!resume) {
              return { ok: false, reason: "无法恢复 SDK 会话以继续执行。" };
            }
            await ensureContextHeadroom(threadId, cwd, controller.signal, { ignoreRunningGuard: true });
            const driver = createSdkDriver(threadId, attemptProxy, undefined, "execution");
            return await consumeSdkRunEvents({
              events: driver.runContinuation(
                buildSdkRunInput({
                  threadId,
                  prompt: pending.userPrompt,
                  workspacePath: pending.workspacePath,
                  worktreePath: cwd,
                  routes,
                  signal: controller.signal,
                  sdkSession: await buildSdkSessionOptions(threadId, pending.userPrompt),
                  agentRegistry: resolveAgentRuntimeConfigForThreadId(threadId),
                  resume,
                }),
                "execution",
                planning,
              ),
              threadId,
              worktreePath: cwd,
              signal: controller.signal,
              onUsageRecorded: onSdkUsageRecordedEvent,
              captureSession: captureSdkSessionFromEvent,
              emitActivity: emitSdkStreamActivity,
            });
          },
        });
      },
    );

    const decision = resolveExecutionRunOutcome(outcome);
    if (
      await applyMainThreadRunDecisionEffects({
        threadId,
        decision,
        onCancelled: async (reason) => {
          cancelClarificationsForThread(threadId, reason);
          await handleRunCancelled(threadId, worktreePlan);
        },
        onFailed: (reason) => {
          cancelClarificationsForThread(threadId, reason);
          markThreadInterrupted(threadId, reason);
        },
      })
    ) {
      return;
    }

    await completeCodingThreadRun(threadId, worktreePlan);
    scheduleThreadTitleSummary(threadId, runtimeConfig);
  } catch (error) {
    cancelClarificationsForThread(threadId, errorMessage(error));
    markThreadInterrupted(threadId, errorMessage(error));
  } finally {
    await finalizeMainThreadRunCleanup({
      threadId,
      worktreePath: cwd,
      cancelClarificationsReason: "run finished",
    });
  }
}

async function runCodingThreadExecution(
  threadId: string,
  runtimeConfig: RuntimeConfig,
  options?: {
    planUserEdited?: boolean;
    routesOverride?: readonly RuntimeRoleRouteConfig[];
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
    process.stderr.write(`[eco] failed to write approved plan snapshot: ${errorMessage(error)}\n`);
  }

  const taskRuntime = createThreadSdkTaskRuntime({
    threadId,
    store: {
      listTodos: (id) => conversationStore.listCoderTodos(id),
      replaceTodos: (id, todos) => conversationStore.replaceCoderTodos(id, todos),
    },
    emitTodoList,
  });
  const taskRunHooks = taskRuntime.taskRunHooks;
  const executionPlan = {
    ...pending,
    routesJson: pending.routesJson || "[]",
  };

  try {
    conversationStore.clearPendingPlan(threadId);
    emitThreadEvent(threadId, "thread.plan_cleared", "计划已进入执行阶段。", "system");

    const executionOutcome = await runThreadRequestWithAutoRetry(
      threadId,
      "execution",
      controller.signal,
      async () => {
        return runThreadRequestWithRuntimeProxy({
          threadId,
          attachments: options?.attachments,
          resolveRuntimeConfig: () => resolveRuntimeConfigForThreadId(threadId, options?.routesOverride),
          recordRouteFingerprint: recordThreadRouteFingerprint,
          startRuntimeProxy,
          run: async ({ proxy: attemptProxy, routes: attemptRoutes }) => {
            executionPlan.routesJson = JSON.stringify(attemptRoutes);
            try {
              const driver = createSdkDriver(
                threadId,
                attemptProxy,
                taskRunHooks.hookContextExtras,
                "execution",
              );

              if (!driver.runExecution) {
                throw new Error("Runtime driver does not support execution phase.");
              }

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
                executionPromptOverride = buildAgentPromptWithContext(thread.prompt, followUp, activityLines);
              }
              return await consumeSdkRunEvents({
                events: driver.runExecution(
                  buildSdkRunInput({
                    threadId,
                    prompt: runPrompt,
                    workspacePath: pending.workspacePath,
                    worktreePath: executionCwd,
                    routes: attemptRoutes,
                    signal: controller.signal,
                    sdkSession: await buildSdkSessionOptions(threadId, runPrompt),
                    agentRegistry: resolveAgentRuntimeConfigForThreadId(threadId),
                    ...(resume ? { resume } : {}),
                    resumableSubagents: listResumableSubagentRefs(threadId, "execution"),
                    ...(executionPromptOverride && { executionPromptOverride }),
                  }),
                  planning,
                ),
                threadId,
                worktreePath: executionCwd,
                signal: controller.signal,
                onUsageRecorded: onSdkUsageRecordedEvent,
                captureSession: captureSdkSessionFromEvent,
                emitActivity: emitSdkStreamActivity,
                onEvent: (event) => {
                  taskRuntime.handleEvent(event);
                },
              });
            } catch (error) {
              if (controller.signal.aborted) {
                return { ok: false, reason: "cancelled by user", aborted: true };
              }
              return { ok: false, reason: errorMessage(error) };
            }
          },
        });
      },
    );

    const executionDecision = resolveExecutionRunOutcome(executionOutcome);
    if (
      await applyMainThreadRunDecisionEffects({
        threadId,
        decision: executionDecision,
        onCancelled: async (reason) => {
          taskRunHooks.stopIfUnhandled("cancelled");
          cancelClarificationsForThread(threadId, reason);
          await handleRunCancelled(threadId, worktreePlan);
        },
        onFailed: async (reason) => {
          taskRunHooks.stopIfUnhandled("blocked");
          await restoreAfterExecutionFailure(threadId, worktreePlan, reason, executionPlan);
        },
      })
    ) {
      return;
    }

    taskRunHooks.stopIfUnhandled("completed");

    await completeCodingThreadRun(threadId, worktreePlan);
  } catch (error) {
    taskRunHooks.stopIfUnhandled("blocked");
    await restoreAfterExecutionFailure(threadId, worktreePlan, errorMessage(error), executionPlan);
  } finally {
    await finalizeMainThreadRunCleanup({
      threadId,
      worktreePath: worktreePlan.worktreePath,
      idleFallbackMessage: "执行已结束。",
    });
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

function noteSdkSessionRouteChange(threadId: string, roleRoutes: readonly RuntimeRoleRouteConfig[]): void {
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
  conversationStore.saveRouteFingerprint(threadId, computeRouteFingerprint(roleRoutesFromRuntime(routes)));
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

  const settings = getModelSettingsSnapshot();
  const routesOverride = resolveRoleRoutesForThread(threadId, request.routeProfileId);

  noteSdkSessionRouteChange(threadId, routesOverride);

  const runtimeConfig = resolveRuntimeConfigForThreadId(
    threadId,
    routesOverride,
    request.routeProfileId ? { requireCompleteCodingRoutes: true } : undefined,
  );
  if (!runtimeConfig.ok) {
    throw new Error(runtimeConfig.reason);
  }

  const pending = conversationStore.getPendingPlan(threadId);
  const prompt = thread.prompt.trim();
  if (!prompt) {
    throw new Error("没有可重试的需求内容。");
  }

  const retryLabel = request.routeProfileId
    ? (settings.routeProfiles.find((profile) => profile.id === request.routeProfileId)?.name ?? "备用路由")
    : undefined;

  if (thread.status === "awaiting_plan" && pending) {
    updateThread(threadId, { status: "running", message: "正在重试执行…" });
    emitThreadEvent(
      threadId,
      "thread.retry",
      retryLabel ? `正在使用「${retryLabel}」重试执行计划…` : "正在重试执行计划…",
      "system",
    );
    void runCodingThreadExecution(threadId, runtimeConfig, routesOverride ? { routesOverride } : undefined);
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
  const summary = formattedReason.length > 240 ? `${formattedReason.slice(0, 237)}…` : formattedReason;
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
  const dismissal = resolveThreadPendingPlanDismissal({
    threadId,
    message,
    pendingPlan: conversationStore.getPendingPlan(threadId),
    thread: conversationStore.getThread(threadId),
    resolveWorktreePlan,
    isIsolatedWorktreePlan,
  });
  conversationStore.clearPendingPlan(threadId);
  if (dismissal.kind === "cancel_worktree") {
    await handleRunCancelled(threadId, dismissal.worktreePlan);
    return;
  }
  updateThread(threadId, { status: "idle", message: dismissal.message });
  emitThreadEvent(threadId, "thread.idle", dismissal.message, "system");
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
  const userMessageId = typeof record.userMessageId === "string" ? record.userMessageId.trim() : "";
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
    const routes = resolveRuntimeConfigForThreadId(threadId);
    if (!routes.ok) {
      throw new Error(routes.reason);
    }
    const proxy = await startRuntimeProxy(routes.routes, undefined, threadId);
    try {
      const built = buildDriverRoutes(proxy.routes);
      await driver.rewindSessionFiles(
        buildSdkRunInput({
          threadId,
          prompt: "",
          workspacePath: thread.workspacePath,
          worktreePath: thread.workspacePath,
          routes: built,
          signal: AbortSignal.timeout(120_000),
          sdkSession: await buildSdkSessionOptions(threadId, ""),
          agentRegistry: resolveAgentRuntimeConfigForThreadId(threadId),
          resume,
        }),
        userMessageId,
      );
    } finally {
      await proxy.close();
    }
  });
  emitThreadEvent(
    threadId,
    "thread.files_rewound",
    `已回滚文件到检查点 ${userMessageId.slice(0, 8)}…`,
    "system",
  );
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
    emitThreadEvent: (threadId, type, message, role) => emitThreadEvent(threadId, type, message, role),
  };
}

async function handleRunCancelled(threadId: string, worktreePlan: WorktreePlan): Promise<void> {
  const explicit = takePendingCancelDisposition(pendingCancelDisposition, threadId);
  await finalizeCancelledRun(threadId, worktreePlan, explicit, createFinalizeCancelledRunDeps());
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
  extras?: SdkRunHookContextExtras,
): Partial<EcoHookContext> {
  const pendingLaunches: PendingSubagentLaunch[] = [];
  const peekPendingCoderTodoId = extras?.peekPendingCoderTodoId;
  const subagentAttribution = {
    resolveAgentId: (input: { role: RuntimeAgentRole; parentToolUseId?: string; sessionId: string }) =>
      subagentMetricsRegistry.resolveAgentId(threadId, {
        role: input.role,
        ...(input.parentToolUseId && { parentToolUseId: input.parentToolUseId }),
      }),
    onTaskToolUse: (toolUseId: string, input?: { role?: RuntimeAgentRole }) => {
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
      const missionKey = normalizeSubagentMissionKey(input.prompt);
      const todoId = input.todoIdHint ?? (peekPendingCoderTodoId ? peekPendingCoderTodoId() : undefined);
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
  const runtimeConfig = resolveRuntimeConfigForThreadId(threadId, roleRoutes);
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
  hookContextExtras?: SdkRunHookContextExtras,
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
  const orchestrationMode = threadConfig?.orchestrationMode ?? workflowSettingsStore.get().orchestrationMode;
  return new ClaudeAgentSdkDriver({
    apiKey: proxy.apiKey,
    baseUrl: proxy.baseUrl,
    orchestration: orchestrationModeFromSnapshot({ orchestrationMode }),
    hookContext: {
      ...createThreadHookContext(threadId),
      ...buildSdkHookContextExtras(threadId, runPhase, hookContextExtras),
    },
    toolPermissionHandler: createThreadToolPermissionHandler(threadId),
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

async function deleteThreadSdkSession(threadId: string): Promise<void> {
  const session = conversationStore.getSdkSession(threadId);
  if (!session?.sessionId) {
    return;
  }
  try {
    await deleteClaudeAgentSdkSession({
      sessionId: session.sessionId,
      dir: session.cwd,
      ...(sdkSessionStore ? { sessionStore: sdkSessionStore } : {}),
    });
  } catch (error) {
    if (isSdkSessionAlreadyMissing(error)) {
      process.stderr.write(
        `[eco] SDK session already missing while deleting ${threadId}: ${errorMessage(error)}\n`,
      );
      return;
    }
    throw error;
  }
}

function isSdkSessionAlreadyMissing(error: unknown): boolean {
  const detail = errorMessage(error);
  return /\b(not found|no session|missing session|ENOENT)\b/i.test(detail);
}

function clearThreadRuntimeMemory(threadId: string): void {
  activeRunBillingState.clearRun(threadId);
  threadUsageAccumulator.clear(threadId);
  contextScheduler.clearThread(threadId);
  subagentMetricsRegistry.clearThread(threadId);
  const timer = runProjectionEmitTimers.get(threadId);
  if (timer) {
    clearTimeout(timer);
    runProjectionEmitTimers.delete(threadId);
  }
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
    if (
      payload &&
      typeof payload === "object" &&
      typeof (payload as { userMessageId?: string }).userMessageId === "string"
    ) {
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
  const sessionCwd = workspacePath ? normalizeSessionCwd(workspacePath, session.cwd) : session.cwd.trim();
  const cwd = workspacePath
    ? normalizeSessionCwd(workspacePath, worktreePath || session.cwd)
    : worktreePath.trim();
  if (
    existsSync(sessionCwd) &&
    (!cwd || sessionCwd === cwd || path.resolve(sessionCwd) === path.resolve(cwd))
  ) {
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
  roleRoutes: readonly RuntimeRoleRouteConfig[];
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
    const ok = await ensurePendingPlanForExecution(threadId, workspace.path, worktreePath, "[]");
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
  routesOverride?: readonly RuntimeRoleRouteConfig[],
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
      const outcome = await runThreadRequestWithAutoRetry(
        thread.id,
        runAttemptPhaseFromThreadMode(mode),
        controller.signal,
        async () => {
          return runThreadRequestWithRuntimeProxy({
            threadId: thread.id,
            attachments,
            resolveRuntimeConfig: () => resolveRuntimeConfigForThreadId(thread.id, routesOverride),
            recordRouteFingerprint: recordThreadRouteFingerprint,
            startRuntimeProxy,
            run: async ({ proxy: attemptProxy, routes }) => {
              const driver = createSdkDriver(thread.id, attemptProxy, undefined, "execution");
              return await consumeSdkRunEvents({
                events: driver.runContinuation(
                  buildSdkRunInput({
                    threadId: thread.id,
                    prompt: followUp,
                    workspacePath: workspace.path,
                    worktreePath: cwd,
                    routes,
                    signal: controller.signal,
                    sdkSession: await buildSdkSessionOptions(thread.id, followUp),
                    agentRegistry: resolveAgentRuntimeConfigForThread(thread),
                    resume: resumeOpts,
                  }),
                  mode,
                  planningContext,
                ),
                threadId: thread.id,
                worktreePath: cwd,
                signal: controller.signal,
                onUsageRecorded: onSdkUsageRecordedEvent,
                captureSession: captureSdkSessionFromEvent,
                emitActivity: emitSdkStreamActivity,
              });
            },
          });
        },
      );
      const decision = resolveExecutionRunOutcome(outcome);
      if (
        await applyMainThreadRunDecisionEffects({
          threadId: thread.id,
          decision,
          onCancelled: async () => {
            await handleRunCancelled(thread.id, worktreePlan);
          },
          onFailed: (reason) => {
            markThreadInterrupted(thread.id, reason);
          },
        })
      ) {
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

  let planningPlanCaptured = false;
  let worktreePlan = existingWorktreePlan ?? createSessionPlan(workspace.path, thread.id);
  let cwd = workspace.path;
  const taskRuntime =
    mode === "execution"
      ? createThreadSdkTaskRuntime({
          threadId: thread.id,
          store: {
            listTodos: (id) => conversationStore.listCoderTodos(id),
            replaceTodos: (id, todos) => conversationStore.replaceCoderTodos(id, todos),
          },
          emitTodoList,
        })
      : undefined;
  const taskRunHooks = taskRuntime?.taskRunHooks;

  try {
    if (mode !== "question") {
      const resolved = await resolveThreadWorktree(workspace, thread.id, existingWorktreePlan);
      worktreePlan = resolved.worktreePlan;
      cwd = resolved.cwd;
      activeRunRuntimeState.setWorktreePlan(thread.id, worktreePlan);
    }

    const resumeOptsForContinuation = resolveResumeOptions(thread.id, cwd);

    const outcome = await runThreadRequestWithAutoRetry(
      thread.id,
      runAttemptPhaseFromThreadMode(mode),
      controller.signal,
      async () => {
        return runThreadRequestWithRuntimeProxy({
          threadId: thread.id,
          attachments,
          resolveRuntimeConfig: () => resolveRuntimeConfigForThreadId(thread.id, routesOverride),
          recordRouteFingerprint: recordThreadRouteFingerprint,
          startRuntimeProxy,
          run: async ({ proxy: attemptProxy, routes }) => {
            const resume = resumeOptsForContinuation;
            if (!resume) {
              return { ok: false, reason: "无法恢复 SDK 会话，请重新发送完整需求。" };
            }

            await ensureContextHeadroom(thread.id, cwd, controller.signal, { ignoreRunningGuard: true });

            try {
              const continuationPhase = sdkRunPhaseFromMode(mode);
              const driver = createSdkDriver(
                thread.id,
                attemptProxy,
                taskRunHooks?.hookContextExtras,
                continuationPhase,
              );
              const runInput = buildSdkRunInput({
                threadId: thread.id,
                prompt: followUp,
                workspacePath: workspace.path,
                worktreePath: cwd,
                routes,
                signal: controller.signal,
                sdkSession: await buildSdkSessionOptions(thread.id, followUp),
                agentRegistry: resolveAgentRuntimeConfigForThread(thread),
                resume,
                resumableSubagents: listResumableSubagentRefs(thread.id, continuationPhase),
              });

              let eventStream: AsyncIterable<AgentEvent>;
              if (mode === "question") {
                if (!driver.runQuestion) {
                  throw new Error("Runtime driver does not support question answering.");
                }
                eventStream = driver.runQuestion(runInput);
              } else {
                if (!driver.runContinuation) {
                  throw new Error("Runtime driver does not support session continuation.");
                }
                eventStream = driver.runContinuation(runInput, mode, planningContext);
              }

              return await consumeSdkRunEvents({
                events: eventStream,
                threadId: thread.id,
                worktreePath: cwd,
                signal: controller.signal,
                onUsageRecorded: onSdkUsageRecordedEvent,
                captureSession: captureSdkSessionFromEvent,
                emitActivity: emitSdkStreamActivity,
                onEvent: (event) => {
                  if (event.type === "plan.ready" && isPlanReadyPayload(event.payload)) {
                    planningPlanCaptured = captureThreadPlanReady({
                      threadId: thread.id,
                      workspacePath: workspace.path,
                      worktreePath: cwd,
                      routesJson: JSON.stringify(routes),
                      payload: event.payload,
                      awaitingPlanMessage: "计划已生成，请确认是否执行。",
                      runtimeConfig,
                    });
                  }
                  taskRuntime?.handleEvent(event);
                },
              });
            } catch (error) {
              if (controller.signal.aborted) {
                return { ok: false, reason: "cancelled by user", aborted: true };
              }
              return { ok: false, reason: errorMessage(error) };
            }
          },
        });
      },
    );

    const continuationDecision = resolveContinuationRunOutcome(outcome, {
      mode,
      planningPlanCaptured,
    });

    if (
      await applyMainThreadRunDecisionEffects({
        threadId: thread.id,
        decision: continuationDecision,
        onCancelled: async (reason) => {
          taskRunHooks?.stopIfUnhandled("cancelled");
          cancelClarificationsForThread(thread.id, reason);
          await handleRunCancelled(thread.id, worktreePlan);
        },
        onFailed: (reason) => {
          taskRunHooks?.stopIfUnhandled("blocked");
          clearSdkSessionAfterResumeFailure(thread.id, Boolean(resumeOptsForContinuation));
          markThreadInterrupted(thread.id, reason);
        },
        onCompleted: async (message) => {
          if (mode === "execution") {
            taskRunHooks?.stopIfUnhandled("completed");
            await completeCodingThreadRun(thread.id, worktreePlan);
            return;
          }
          if (mode === "question") {
            updateThread(thread.id, {
              status: "completed",
              message: message ?? "回答完成。",
            });
            scheduleThreadTitleSummary(thread.id, runtimeConfig);
            return;
          }
          updateThread(thread.id, { status: "idle", message: message ?? "续聊已结束。" });
        },
      })
    ) {
      return;
    }

    updateThread(thread.id, { status: "idle", message: "续聊已结束。" });
  } catch (error) {
    taskRunHooks?.stopIfUnhandled("blocked");
    markThreadInterrupted(thread.id, errorMessage(error));
  } finally {
    const worktreePath = resolveThreadWorktreePath(thread.id);
    await finalizeMainThreadRunCleanup({
      threadId: thread.id,
      worktreePath,
      cancelClarificationsReason: "run finished",
      idleFallbackMessage: "续聊已结束。",
    });
  }
}

/** OTel does not stream assistant text; SDK drives narrative, tool, and todo activity. */
function emitSdkStreamActivity(threadId: string, event: AgentEventLike): void {
  if (event.type === "tool.started" && isRecord(event.payload)) {
    const toolName = typeof event.payload.tool_name === "string" ? event.payload.tool_name.trim() : "";
    const toolUseId = typeof event.payload.tool_use_id === "string" ? event.payload.tool_use_id : undefined;
    if (toolUseId && (toolName === "Task" || toolName === "Agent")) {
      const rawRole =
        typeof event.payload.subagent_type === "string"
          ? event.payload.subagent_type
          : typeof event.payload.agent_type === "string"
            ? event.payload.agent_type
            : "";
      const role = normalizeSdkSubagentType(rawRole);
      subagentMetricsRegistry.noteTaskToolUse(threadId, toolUseId, role);
      agentLifecycle.noteTaskToolUse(threadId, toolUseId, role);
    }
  }
  applySdkContextSideEffects(threadId, event);
  if (isSdkCompactionStatusEvent(event)) {
    emitContextCompactionStatus(threadId, { stage: "started", trigger: "auto" });
    return;
  }
  if (isSdkCompactionBoundaryEvent(event)) {
    return;
  }
  const plannerSessionId = conversationStore.getSdkSession(threadId)?.sessionId;
  const activityAgentId = resolveActivityAgentId(threadId, event, {
    ...(plannerSessionId && { plannerSessionId }),
    metricsRegistry: subagentMetricsRegistry,
  });
  sdkStreamBridge.handleEvent(
    threadId,
    event,
    (id, type, message, role, stream, agentId, extras) => {
      emitThreadEvent(
        id,
        type,
        message,
        role as AgentRole | "system" | "thinking" | "tool" | "user",
        stream,
        agentId || extras
          ? {
              ...(agentId && { agentId }),
              ...(extras?.tool && { tool: extras.tool }),
              ...(extras?.metadata && { metadata: extras.metadata }),
            }
          : undefined,
      );
    },
    undefined,
    activityAgentId ? { activityAgentId } : undefined,
  );
}

function emitOtelActivity(line: OtelActivityLine): void {
  if (/^Compacting context/i.test(line.message)) {
    contextLifecycle.noteOtelCompaction(line.threadId);
    emitContextCompactionStatus(line.threadId, { stage: "started", trigger: "auto" });
    return;
  }
  if (sdkStreamBridge.shouldSuppressOtelToolLine(line.threadId, line)) {
    return;
  }
  const otelAgentId = resolveOtelActivityAgentId(line.threadId, line, {
    metricsRegistry: subagentMetricsRegistry,
  });
  const eventType = line.apiError ? "thread.api_error" : "otel.activity";
  emitThreadEvent(line.threadId, eventType, line.message, line.role, line.stream ?? false, {
    ...(otelAgentId && { agentId: otelAgentId }),
    ...(line.apiError && { apiError: line.apiError }),
    ...(line.toolName && {
      tool: {
        name: line.toolName,
        ...(line.toolDetail && { detail: line.toolDetail }),
        ...(line.toolUseId && { toolUseId: line.toolUseId }),
        ...(line.durationMs !== undefined && { durationMs: line.durationMs }),
        ...(line.toolStatus && { status: line.toolStatus }),
      },
    }),
  });
}

function noteUsageBillingObservation(threadId: string, observation: UsageBillingObservation): void {
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
  const threadStatus = conversationStore.getThread(event.threadId)?.status;
  const billing = enrichBillingDisplaySource(event.payload.billing, threadStatus);
  emitThreadEvent(event.threadId, "thread.usage_updated", event.badge, event.role, false, {
    ...event.payload,
    billing,
    totalCostUsd: billing.otelCostUsd,
  });
}

async function processUsageBilling(
  input: SingleUsageBillingRequest,
): Promise<UpstreamProxyCallBilling | null> {
  const billingRuntime = await resolveBillingRuntimeContext(billingRuntimeEnvironment, input.threadId);

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

/** Best-effort compaction before resume; failures must not block the main agent run. */
async function ensureContextHeadroom(
  threadId: string,
  worktreePath: string,
  signal: AbortSignal,
  options?: { ignoreRunningGuard?: boolean },
): Promise<void> {
  try {
    const roleRoutes = resolveRoleRoutesForThread(threadId);
    const runtimeConfig = resolveRuntimeConfigForThreadId(threadId, roleRoutes);
    if (!runtimeConfig.ok) {
      process.stderr.write(`[eco] context headroom skipped for ${threadId}: ${runtimeConfig.reason}\n`);
      return;
    }
    const routes = buildDriverRoutesFromRuntime(runtimeConfig.routes);
    await contextScheduler.ensureHeadroom(threadId, routes, worktreePath, signal, options);
  } catch (error) {
    const detail = errorMessage(error);
    process.stderr.write(`[eco] context headroom skipped for ${threadId}: ${detail}\n`);
    emitContextCompactionStatus(threadId, { stage: "failed", trigger: "auto", detail });
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
  persistThreadMetrics(
    {
      store: conversationStore,
      accumulator: threadUsageAccumulator,
      contextSnapshots: contextScheduler,
    },
    threadId,
  );
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

function onSdkUsageRecordedEvent(threadId: string, event: AgentEventLike & { id: string }): void {
  handleSdkUsageRecordedEvent({
    threadId,
    event,
    services: sdkUsageRecordedEventHandlerServices(),
  });
}

function applySdkContextSideEffects(threadId: string, event: AgentEventLike): boolean {
  return applySdkContextEventSideEffects({
    threadId,
    eventId: event.id,
    payload: event.payload,
  });
}

function applySdkContextEventSideEffects(input: {
  threadId: string;
  eventId: string;
  payload: unknown;
}): boolean {
  return contextLifecycle.handleSdkContextEvent(input);
}

function sdkUsageRecordedEventHandlerServices() {
  return {
    handleContextEvent: applySdkContextEventSideEffects,
    usageRunAttemptId: (threadId: string) => agentLifecycle.usageRunAttemptId(threadId),
    usagePlannerAgentId: (threadId: string) => agentLifecycle.usagePlannerAgentId(threadId),
    listObservedAuthoritativeUsage: (threadId: string) => activeRunBillingState.listObservations(threadId),
    resolver: subagentMetricsRegistry,
    dispatchUsageBilling: dispatchSdkEventUsageBilling,
    dispatchServices: sdkUsageBillingDispatchServices(),
  };
}

function sdkUsageBillingDispatchServices() {
  return {
    trackUsageUpdate: (threadId: string, task: Promise<void>) =>
      usageLedgerCoordinator.trackUsageUpdate(threadId, task),
    processUsageBilling,
    processSdkStreamPartialUsage,
    processSdkRunBilling,
    logResolution: logSdkUsageResolution,
    writeError: (message: string) => process.stderr.write(message),
  };
}

function logSdkUsageResolution(
  threadId: string,
  resolved: Extract<ReturnType<typeof resolveSdkEventUsageBilling>, { kind: "stream_partial" | "sdk_run" }>,
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

async function processSdkStreamPartialUsage(input: SdkStreamPartialBillingRequest): Promise<void> {
  const billingRuntime = await resolveBillingRuntimeContext(billingRuntimeEnvironment, input.threadId);
  const resolved = await resolveSdkStreamPartialBillingOrchestration({
    request: input,
    runtimeRoutes: billingRuntime.runtimeRoutes,
    lookupPricing: billingRuntime.lookupPricing,
  });

  await applySdkStreamPartialBillingEffects(usageBillingEffectsServices(), resolved.effectsInput);
}

async function processSdkRunBilling(input: SdkRunUsageBillingInput): Promise<void> {
  const billingRuntime = await resolveBillingRuntimeContext(billingRuntimeEnvironment, input.threadId);
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
    ...(input.workflowStep && { workflowStep: input.workflowStep }),
  });

  for (const observation of resolved.observations) {
    noteUsageBillingObservation(input.threadId, observation);
  }

  await applySdkRunBillingEffects(usageBillingEffectsServices(), resolved.effectsInput);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSdkCompactionStatusEvent(event: AgentEventLike): boolean {
  if (!isRecord(event.payload)) {
    return false;
  }
  return (
    event.payload.type === "system" &&
    event.payload.subtype === "status" &&
    event.payload.status === "compacting"
  );
}

function isSdkCompactionBoundaryEvent(event: AgentEventLike): boolean {
  return isRecord(event.payload) && event.payload.subtype === "compact_boundary";
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

async function buildSdkSessionOptions(threadId: string, prompt?: string): Promise<EcoSdkSessionOptions> {
  const mcp = mcpStore.buildSdkConfig();
  const thread = conversationStore.getThread(threadId);
  const hydrated = thread ? ensureThreadRuntimeConfig(thread) : undefined;
  const settings = getModelSettingsSnapshot();
  const profile = hydrated?.runtimeConfig
    ? resolveThreadAgentProfile(settings, hydrated.runtimeConfig)
    : undefined;
  const orchestrationMode =
    hydrated?.runtimeConfig?.orchestrationMode ?? workflowSettingsStore.get().orchestrationMode;
  const enabledSubagents =
    orchestrationMode === "autonomous"
      ? defaultSubagentAvailability()
      : (hydrated?.runtimeConfig?.subagentEnabled ?? defaultSubagentAvailability());
  const workspacePath =
    thread?.workspacePath ??
    (currentWorkspace?.path && currentWorkspace.path.trim() ? currentWorkspace.path : undefined);
  const discovered = await listDiscoveredSkills(workspacePath);
  const projectNames = listSdkReadyProjectSkills(discovered.projectSkills).map((skill) => skill.name);
  const explicitUser = filterExplicitUserSkillNames(prompt, discovered.userSkills);
  const profileMainSkills = profile?.mainAgent.skills ?? [];
  const merged = mergeSkillNames(projectNames, profileMainSkills, explicitUser);
  const agentSkills = buildRuntimeAgentSkillAssignments(merged, profile);
  return {
    settingSources: ["user", "project"],
    ...(merged.length > 0 ? { skills: merged } : {}),
    agentSkills,
    enabledSubagents,
    mcpServers: mcp.mcpServers,
    mcpAllowedTools: mcp.allowedTools,
  };
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
    if (sessionCwd && path.resolve(sessionCwd) === path.resolve(plan.worktreePath)) {
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

interface EmitThreadEventExtras {
  plan?: ThreadLiveEvent["plan"];
  clarification?: ThreadLiveEvent["clarification"];
  bashApproval?: ThreadLiveEvent["bashApproval"];
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
  tool?: ThreadRunToolMetadata;
  metadata?: Record<string, unknown>;
}

function emitThreadEvent(
  threadId: string,
  type: string,
  message: string,
  role: RuntimeAgentRole | "system" | "thinking" | "tool" | "user" = "system",
  stream = false,
  extras?: EmitThreadEventExtras,
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
    !extras?.bashApproval &&
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

  recordThreadRunEventFromLiveEvent({
    threadId,
    type,
    displayMessage,
    role: String(role),
    stream,
    ...(extras && { extras }),
    ...(persistedActivityLine && { persistedActivityLine }),
  });

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
  if (extras?.bashApproval) {
    payload.bashApproval = extras.bashApproval;
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

function emitContextCompactionStatus(
  threadId: string,
  input: {
    stage: "started" | "completed" | "failed";
    trigger?: "auto" | "manual";
    sessionId?: string;
    archiveId?: string;
    preTokens?: number;
    postTokens?: number;
    detail?: string;
  },
): void {
  if (!conversationStore.getThread(threadId)) {
    return;
  }
  const trigger = input.trigger ?? "auto";
  const message = formatContextCompactionMessage(input.stage, trigger, input.detail);
  const now = new Date().toISOString();
  const unique =
    input.archiveId ?? input.sessionId ?? `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const runAttemptId = resolveCurrentRunAttemptId(threadId);
  const metadata: Record<string, unknown> = {
    liveType: `context.compaction.${input.stage}`,
    compaction: {
      stage: input.stage,
      trigger,
      ...(input.sessionId && { sessionId: input.sessionId }),
      ...(input.archiveId && { archiveId: input.archiveId }),
      ...(input.preTokens !== undefined && { preTokens: input.preTokens }),
      ...(input.postTokens !== undefined && { postTokens: input.postTokens }),
      ...(input.detail && { detail: input.detail }),
    },
  };
  try {
    conversationStore.appendThreadRunEvent({
      id: `tre:${threadId}:context-compaction:${input.stage}:${unique}`,
      threadId,
      eventType: `context.compaction.${input.stage}`,
      scope: "main",
      streamState: "none",
      message,
      observedAt: now,
      ...(runAttemptId && { runAttemptId }),
      metadata,
    });
    scheduleThreadRunProjectionUpdated(threadId);
  } catch (error) {
    process.stderr.write(`[eco] context compaction status write failed: ${errorMessage(error)}\n`);
  }
}

function formatContextCompactionMessage(
  stage: "started" | "completed" | "failed",
  trigger: "auto" | "manual",
  detail?: string,
): string {
  if (stage === "failed") {
    return detail ? `上下文压缩失败：${detail}` : "上下文压缩失败";
  }
  if (stage === "started") {
    return trigger === "manual" ? "正在手动压缩上下文" : "正在自动压缩上下文";
  }
  return trigger === "manual" ? "上下文已手动压缩" : "上下文已自动压缩";
}

function recordThreadRunEventFromLiveEvent(input: {
  threadId: string;
  type: string;
  displayMessage: string;
  role: string;
  stream: boolean;
  extras?: EmitThreadEventExtras;
  persistedActivityLine?: ThreadActivityLine;
}): void {
  if (!conversationStore.getThread(input.threadId)) {
    return;
  }
  const liveEventId = `live_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const eventId = input.persistedActivityLine
    ? `${input.persistedActivityLine.id}:${liveEventId}`
    : liveEventId;
  const runAttemptId = resolveCurrentRunAttemptId(input.threadId);
  const event = buildThreadRunEventFromLiveEvent({
    threadId: input.threadId,
    eventId,
    liveType: input.type,
    message: input.displayMessage,
    role: input.role,
    stream: input.stream,
    observedAt: new Date().toISOString(),
    ...(runAttemptId && { runAttemptId }),
    ...(input.extras?.agentId?.trim() && { agentId: input.extras.agentId.trim() }),
    ...(input.persistedActivityLine && { streamKey: input.persistedActivityLine.id }),
    ...(input.extras?.apiError && { apiError: input.extras.apiError }),
    ...(input.extras?.tool && { tool: input.extras.tool }),
    ...(input.extras?.metadata && { metadata: input.extras.metadata }),
  });
  if (!event) {
    return;
  }
  try {
    conversationStore.appendThreadRunEvent(event);
    scheduleThreadRunProjectionUpdated(input.threadId);
  } catch (error) {
    process.stderr.write(`[eco] thread run event shadow write failed: ${errorMessage(error)}\n`);
  }
}

function resolveCurrentRunAttemptId(threadId: string): string | undefined {
  try {
    return agentLifecycle.currentRunAttemptId(threadId) ?? agentLifecycle.usageRunAttemptId(threadId);
  } catch {
    return undefined;
  }
}

function buildCurrentThreadRunProjection(threadId: string): ThreadRunProjectionSnapshot | undefined {
  const thread = conversationStore.getThread(threadId);
  if (!thread) {
    return undefined;
  }
  const legacyBilling = threadUsageAccumulator.getSnapshot(threadId);
  const ledgerBilling = usageLedgerCoordinator.projectBillingSnapshot(
    threadId,
    legacyBilling?.plannerModelLabel,
  );
  const billing =
    ledgerBilling ??
    (legacyBilling ? usageLedgerCoordinator.enrichBillingSnapshot(threadId, legacyBilling) : undefined);
  const context = contextScheduler.getDisplaySnapshot(threadId);
  const projection = buildThreadRunProjection({
    threadId,
    status: thread.status,
    message: thread.message,
    attempts: conversationStore.listRunAttempts(threadId),
    agents: conversationStore.listAgentInstances(threadId),
    events: conversationStore.listThreadRunEvents(threadId),
    ...(billing && { billing }),
    ...(context && { context }),
    subagentTimings: buildSubagentSessionTimings(conversationStore.listSubagentSessions(threadId)),
  });
  logThreadRunProjectionDiagnostics(projection);
  return projection;
}

function logThreadRunProjectionDiagnostics(projection: ThreadRunProjectionSnapshot): void {
  for (const diagnostic of projection.diagnostics) {
    const identity = diagnostic.eventId ?? diagnostic.agentId ?? diagnostic.requestId ?? "thread";
    logEcoDiagThrottled(
      `thread-run-projection:${projection.thread.threadId}:${diagnostic.code}:${identity}`,
      "thread_run_projection.diagnostic",
      {
        threadId: shortThreadId(projection.thread.threadId),
        code: diagnostic.code,
        ...(diagnostic.eventId && { eventId: shortProjectionId(diagnostic.eventId) }),
        ...(diagnostic.agentId && { agentId: shortAgentId(diagnostic.agentId) }),
        ...(diagnostic.requestId && { requestId: shortProjectionId(diagnostic.requestId) }),
        message: diagnostic.message,
      },
      5_000,
    );
  }
}

function shortProjectionId(id: string): string {
  return id.length > 24 ? id.slice(-24) : id;
}

function scheduleThreadRunProjectionUpdated(threadId: string): void {
  const existing = runProjectionEmitTimers.get(threadId);
  if (existing) {
    clearTimeout(existing);
  }
  const timer = setTimeout(() => {
    runProjectionEmitTimers.delete(threadId);
    emitThreadRunProjectionUpdated(threadId);
  }, 80);
  runProjectionEmitTimers.set(threadId, timer);
}

function emitThreadRunProjectionUpdated(threadId: string): void {
  const projection = buildCurrentThreadRunProjection(threadId);
  if (!projection) {
    return;
  }
  const payload: ThreadLiveEvent = {
    threadId,
    type: "thread.run_projection_updated",
    message: "运行投影已更新",
    role: "system",
    stream: false,
    projection,
  };
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

function createThreadToolPermissionHandler(
  threadId: string,
): (request: SdkToolPermissionRequest) => Promise<SdkToolPermissionDecision> {
  return async (request) => {
    if (request.toolName !== "Bash") {
      return { behavior: "allow", updatedInput: request.input };
    }

    const command = readBashCommandInput(request.input);
    if (!command) {
      return {
        behavior: "deny",
        message: "Bash command is missing; Eco could not present it for approval.",
        interrupt: false,
      };
    }

    const thread = conversationStore.getThread(threadId);
    if (!thread) {
      return {
        behavior: "deny",
        message: "Thread was not found; Eco could not request Bash approval.",
        interrupt: true,
      };
    }

    const worktreePlan = activeRunRuntimeState.worktreePlan(threadId);
    const cwd = request.cwd?.trim() || worktreePlan?.worktreePath || thread.sdkCwd || thread.workspacePath;
    const policy = evaluateShellCommandText({
      command,
      cwd,
      workspacePath: thread.workspacePath,
    });
    if (policy.action === "deny") {
      emitThreadEvent(threadId, "bash_approval.denied", `Bash 已拒绝：${policy.reason}`, "tool", false);
      return {
        behavior: "deny",
        message: policy.reason,
        interrupt: false,
      };
    }

    const description = readBashDescriptionInput(request.input);
    const approvalRequest: BashApprovalRequest = {
      toolUseId: request.toolUseId,
      threadId,
      command,
      cwd,
      reason:
        policy.action === "ask" ? policy.reason : "Eco requires user confirmation before running Bash.",
      riskLevel: policy.riskLevel,
      ...(request.agentId ? { agentId: request.agentId } : {}),
      ...(request.agentType ? { agentType: request.agentType } : {}),
      ...(description ? { description } : {}),
    };

    updateThread(threadId, { status: "running", message: "等待 Bash 执行确认…" });
    emitThreadEvent(threadId, "bash_approval.requested", `等待确认 Bash：${command}`, "tool", false, {
      bashApproval: approvalRequest,
    });

    const decision = await registerPendingBashApproval(threadId, approvalRequest);
    if (decision === "approved") {
      emitThreadEvent(threadId, "bash_approval.approved", `已允许本次 Bash：${command}`, "tool", false);
      updateThread(threadId, { status: "running", message: "Bash 已确认，继续执行…" });
      return { behavior: "allow", updatedInput: request.input };
    }

    emitThreadEvent(threadId, "bash_approval.rejected", `已拒绝 Bash：${command}`, "tool", false);
    updateThread(threadId, { status: "running", message: "Bash 已拒绝，等待 Agent 调整…" });
    return {
      behavior: "deny",
      message: "User denied this Bash command.",
      interrupt: false,
    };
  };
}

function readBashCommandInput(input: Record<string, unknown>): string | undefined {
  for (const key of ["command", "bash_command", "full_command"]) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function readBashDescriptionInput(input: Record<string, unknown>): string | undefined {
  const value = input.description;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
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

function isBashApprovalResolvePayload(value: unknown): value is BashApprovalResolvePayload {
  if (!value || typeof value !== "object") {
    return false;
  }
  const payload = value as BashApprovalResolvePayload;
  return (
    typeof payload.toolUseId === "string" &&
    payload.toolUseId.trim().length > 0 &&
    (payload.decision === "approved" || payload.decision === "denied")
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

const lastConnectionErrorEmitByThread = new Map<string, { at: number; message: string }>();

function emitUpstreamModelRequestActivity(threadId: string, role: RuntimeAgentRole): void {
  emitThreadEvent(threadId, "request.started", "Requesting model…", role, false);
}

function emitUpstreamConnectionErrorActivity(
  threadId: string,
  role: RuntimeAgentRole,
  error: string,
  statusCode?: number,
): void {
  const detail = formatUserFacingRequestError(error);
  const summary = statusCode ? `HTTP ${statusCode}` : detail;
  const message = summary === detail ? `【连接失败】${summary}` : `【连接失败】${summary}：${detail}`;
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
