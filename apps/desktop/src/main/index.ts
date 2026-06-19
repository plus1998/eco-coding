import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ResolvedModelRoute } from "@eco/model-router";
import { createRedisSessionStore, type SessionStore, testRedisConnection } from "@eco/persistence";
import {
  type AgentEvent,
  collectProfileAssignedMcpServers,
  defaultSubagentAvailability,
  type EcoAgentRuntimeConfig,
  type EcoPlanningContext,
  type EcoSdkResumeOptions,
  type EcoSdkSessionOptions,
  filesystemReadScopeAskReason,
  isDiscoveryFilesystemTool,
  isPathInsidePolicyScope,
  isReadFilesystemTool,
  isSubagentRole,
  normalizeSdkSubagentType,
  type OtelActivityLine,
  type OtelUsageUpdate,
  type ParsedUsage,
  type PlanReadyPayload,
  pathContainsGlobMeta,
  readFilesystemPath,
  resolveFilesystemScopeRoot,
  resolvePolicyPath,
  resolvePolicySearchBase,
  type SdkToolPermissionDecision,
  type SdkToolPermissionRequest,
  type SessionCapturedPayload,
  type SubagentRunPhase,
} from "@eco/runtime";
import {
  ClaudeAgentSdkDriver,
  deleteClaudeAgentSdkSession,
  type EcoHookContext,
  resolveResumeSessionAtBeforeUserMessage,
} from "@eco/runtime/sdk";
import { isRemoteCommandChannel } from "@eco/shared";
import { type CommandRunner, createSessionPlan, GitWorktreeService, type WorktreePlan } from "@eco/workspace";
import { app, BrowserWindow, dialog, ipcMain, type NativeImage, nativeImage, shell } from "electron";
import { ensureDesktopPath } from "./fix-desktop-path";
import { evaluateThreadBashPermission } from "./thread-bash-permission";

ensureDesktopPath();

import { buildAgentProfileArchive, parseAgentProfileArchiveBundle } from "../shared/agent-profile-archive";
import { buildAgentTemplateArchive, parseAgentTemplateArchive } from "../shared/agent-template-archive";
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
  type CandidateModelInput,
  type CandidateModelView,
  type CenterServerRegisterDesktopRequest,
  type CenterServerSettingsInput,
  type CenterServerSignInRequest,
  type CenterServerSignUpRequest,
  type CenterServerTestConnectionRequest,
  type ClarificationSubmitPayload,
  type CoderTodoItem,
  getAgentProfileById,
  IPC_CHANNELS,
  type IpcChannel,
  isBashReviewModeOnlyRuntimeConfigUpdate,
  isGitCommitRequest,
  isGitGenerateCommitMessageRequest,
  isGitListCommitsRequest,
  isGitPullRequest,
  isGitPushRequest,
  isKnownIpcChannel,
  isRunPackageScriptRequest,
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
  type RoleRouteConfig,
  type RouteManualSpec,
  type RouteProfileInput,
  type RuntimeAgentRole,
  type RuntimeRoleRouteConfig,
  resolveThreadAgentProfile,
  runtimeRoleRoutesFromAgentProfile,
  type SessionSyncSettingsInput,
  type SessionSyncTestConnectionRequest,
  type TestProviderConnectionRequest,
  type TestRoleRoutesRequest,
  type ThreadActivityLine,
  type ThreadActivityRewindTarget,
  type ThreadAppliedDiffResult,
  type ThreadBillingSnapshot,
  type ThreadCompactContextResult,
  type ThreadContextSnapshot,
  type ThreadContinueRequest,
  type ThreadContinueResult,
  type ThreadFollowUpCancelRequest,
  type ThreadFollowUpEnqueueRequest,
  type ThreadFollowUpEscalateRequest,
  type ThreadFollowUpMutationResult,
  type ThreadFollowUpRunPhase,
  type ThreadFollowUpUpdateRequest,
  type ThreadLiveEvent,
  type ThreadModelUsageEntry,
  type ThreadPendingFollowUp,
  type ThreadPendingPlan,
  type ThreadRetryRequest,
  type ThreadRetryResult,
  type ThreadRevertAppliedDiffResult,
  type ThreadRewindCheckpointRequest,
  type ThreadRewindCheckpointResult,
  type ThreadRollbackResult,
  type ThreadRunBashApprovalMetadata,
  type ThreadRunBashApprovalPhase,
  type ThreadRunProjectionSnapshot,
  type ThreadRunToolMetadata,
  type ThreadRuntimeConfig,
  type ThreadRuntimeConfigInput,
  type ThreadStartRequest,
  type ThreadStatus,
  type ThreadSummary,
  type ThreadUpdateRuntimeConfigRequest,
  type ThreadUsageLedgerEventView,
  type ThreadUsageSnapshot,
  type ThreadUsageSnapshotResult,
  type WorkspaceInfo,
  type WorktreeApplyResult,
  type WorktreeCancelDisposition,
  type WorktreeStatusResult,
  withPlanModeDisabled,
} from "../shared/ipc";
import { filterMcpSdkConfigByAssignedServers } from "../shared/mcp";
import { isExternalPackageScriptTarget } from "../shared/package-script-target";
import { parseThreadApprovePlanPayload } from "../shared/plan-approval";
import { computeRouteFingerprint, routesMatchFingerprint } from "../shared/route-fingerprint";
import {
  buildRuntimeAgentSkillAssignments,
  filterExplicitUserSkillNames,
  type LinkAgentsSkillsRequest,
  listSdkReadyProjectSkills,
  resolveImplicitSkillReadRoots,
  resolveSdkSessionSkillConfig,
  type SdkSessionSkillsScope,
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
  buildThreadFollowUpDisplayPrompt,
  buildThreadFollowUpDrainPrompt,
  collectThreadFollowUpAttachments,
  shouldDrainThreadFollowUps,
} from "../shared/thread-follow-up-drain";
import {
  buildWorktreeMergeSummary,
  formatWorktreeMergeThreadMessage,
  serializeWorktreeMergeMessage,
} from "../shared/worktree-merge";
import { ActiveRunBillingStateStore } from "./active-run-billing-state";
import { type ActiveRunRuntimeStateInput, ActiveRunRuntimeStateStore } from "./active-run-runtime-state";
import { resolveActivityAgentId, resolveOtelActivityAgentId } from "./activity-agent-id";
import { buildAgentAuditExportArchive } from "./agent-audit-export";
import { AgentLifecycleService } from "./agent-lifecycle-service";
import { type AgentOrchestrationStore, createAgentOrchestrationStore } from "./agent-orchestration-store";
import { buildAgentProfilePerformanceSnapshots } from "./agent-profile-performance";
import { mergeAgentRegistrySettings } from "./agent-registry-settings";
import {
  type AnthropicProxyStartOptions,
  type AnthropicProxyUsageHandler,
  type AnthropicProxyUsageInfo,
  estimateInputTokensFromAnthropicBody,
  startAnthropicModelProxy,
} from "./anthropic-proxy";
import {
  cancelBashApprovalsForThread,
  getPendingBashApprovalByToolUseId,
  getPendingBashApprovalForThread,
  registerPendingBashApproval,
  resolvePendingBashApproval,
} from "./bash-approval-bridge";
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
import { resolveBillingSnapshotSelectionOptions } from "./billing-snapshot-selection-policy";
import {
  type FinalizeCancelledRunDeps,
  finalizeCancelledRun,
  parseThreadCancelRequest,
  takePendingCancelDisposition,
} from "./cancel-worktree";
import { CenterServerDesktopClient } from "./center-server-client";
import { createCenterServerStore } from "./center-server-store";
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
import { createElectronEventSink, DesktopEventCenter } from "./event-center";
import {
  checkoutGitBranch,
  createGitBranch,
  discardWorkspaceChanges,
  getGitWorkingTreeStatus,
  getWorkspaceDiff,
  handleGitCommit,
  handleGitGenerateCommitMessage,
  handleGitPull,
  handleGitPush,
  listGitCommits,
} from "./git-service";
import {
  createGitSettingsStore,
  type GitSettingsStore,
  isGitSettingsSnapshot,
  normalizeGitSettingsSnapshot,
} from "./git-settings-store";
import { ensureHomeProject, getHomeProjectPath } from "./home-project-bootstrap";
import { createMcpStore, type McpStore } from "./mcp-store";
import { ModelsDevPricingCache } from "./models-dev-pricing-cache";
import { launchInExternalTerminal } from "./open-external-terminal";
import { localOtelReceiver } from "./otel-receiver";
import { resolveOtelUsageBilling } from "./otel-usage-billing";
import { PackageJsonWatcher } from "./package-json-watcher";
import { PackageScriptRunner } from "./package-script-runner";
import { listPackageScripts, preparePackageScriptRun } from "./package-scripts";
import { listProviderUpstreamModels, testProviderConnection, testRoleRoutes } from "./provider-models";
import { createProviderStore, type ProviderStore } from "./provider-store";
import { ProxyBillingStampRegistry } from "./proxy-billing-stamp";
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
import { resolveCommandExecutable, toSpawnEnv } from "./resolve-command-executable";
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
import {
  buildThreadRunEventFromLiveEvent,
  isMetricsOnlyThreadLiveEvent,
} from "./thread-run-event-normalizer";
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
import { pendingThreadTitle, shouldReplaceAutoThreadTitle, summarizeThreadTitle } from "./thread-title";
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
  claudePlanFileExists,
  isWorktreeGitCwdError,
  readClaudePlanFile,
  resolveWorktreePathHint,
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
const desktopEventCenter = new DesktopEventCenter();
desktopEventCenter.subscribe(
  createElectronEventSink((channel, payload) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      window.webContents.send(channel, payload);
    });
  }),
);
const packageScriptRunner = new PackageScriptRunner((event) => {
  desktopEventCenter.publishPackageScriptEvent(event);
});
const packageJsonWatcher = new PackageJsonWatcher((workspacePath) => {
  desktopEventCenter.publishPackageJsonChanged(workspacePath);
});
const gitWorktrees = new GitWorktreeService(gitRunner);
let currentWorkspace: WorkspaceInfo | undefined;
let providerStore: ProviderStore;
let agentOrchestrationStore: AgentOrchestrationStore;
let mcpStore: McpStore;
let conversationStore: ConversationStore;
let workflowSettingsStore: WorkflowSettingsStore;
let gitSettingsStore: GitSettingsStore;
let proxyBridgeSettingsStore: ProxyBridgeSettingsStore;
let sessionSyncStore: SessionSyncStore;
let centerServerClient: CenterServerDesktopClient;
let sdkSessionStore: SessionStore | undefined;
let closeSdkSessionStore: (() => Promise<void>) | undefined;

const activeRunRuntimeState = new ActiveRunRuntimeStateStore();
const activeRunBillingState = new ActiveRunBillingStateStore();
const pendingCancelDisposition = new Map<string, WorktreeCancelDisposition>();
const pendingEscalatedFollowUpDrain = new Set<string>();
const threadUsageAccumulator = new ThreadUsageAccumulator();
const proxyBillingStampRegistry = new ProxyBillingStampRegistry();
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
  proxyBillingStampRegistry.clearThread(threadId);
}

async function createMainWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1080,
    minHeight: 720,
    titleBarStyle: "hiddenInset",
    transparent: true,
    backgroundColor: "#00000000",
    ...(appIcon ? { icon: appIcon } : {}),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalHttpUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  if (isDev) {
    await window.loadURL(process.env.VITE_DEV_SERVER_URL as string);
  } else {
    await window.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

function isExternalHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
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
    onProxyAttributionSettled: (threadId) => {
      schedulePersistThreadMetrics(threadId);
      emitSubagentTimingUpdated(threadId);
    },
  });
  workflowSettingsStore = await createWorkflowSettingsStore(dbPath);
  gitSettingsStore = await createGitSettingsStore(dbPath);
  proxyBridgeSettingsStore = await createProxyBridgeSettingsStore(dbPath);
  sessionSyncStore = await createSessionSyncStore(dbPath);
  centerServerClient = new CenterServerDesktopClient({
    store: await createCenterServerStore(dbPath),
    eventCenter: desktopEventCenter,
    log: (message) => process.stderr.write(message),
  });
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
      `[eco] SessionStore init failed (${errorMessage(error)}), disabling SessionStore so file checkpointing remains available\n`,
    );
    sdkSessionStore = undefined;
    closeSdkSessionStore = undefined;
  }
  await localOtelReceiver.start({
    onActivity: emitOtelActivity,
    onUsage: emitOtelUsage,
  });
  backfillThreadRuntimeConfigs();
  recoverOrphanedRunningThreads();
  currentWorkspace = await ensureHomeProject();
  registerIpcHandlers();
  if (centerServerClient.getSnapshot().settings.enabled) {
    void centerServerClient.start().catch((error) => {
      process.stderr.write(`[eco] center server auto-connect failed: ${errorMessage(error)}\n`);
    });
  }
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
  centerServerClient?.dispose();
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
    source: "user",
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
    typeof profile.name === "string" && profile.name.trim() ? profile.name.trim() : "Imported Agent Profile";
  const id =
    !rawId || protectedId || existingIds.has(rawId)
      ? createUniqueImportedProfileId(`user.imported.${slugifyTemplateId(name) || "profile"}`, existingIds)
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

function parseThreadActivityRewindTarget(value: unknown): ThreadActivityRewindTarget | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "object") {
    throw new Error("Invalid rewind target.");
  }
  const target = value as Partial<ThreadActivityRewindTarget>;
  const activityLineId = typeof target.activityLineId === "string" ? target.activityLineId.trim() : "";
  const userMessageId = typeof target.userMessageId === "string" ? target.userMessageId.trim() : "";
  if (!activityLineId || !userMessageId) {
    throw new Error("Invalid rewind target.");
  }
  return { activityLineId, userMessageId };
}

function roleRoutesForThreadConfig(
  settings: ModelSettingsSnapshot,
  config: ThreadRuntimeConfig,
): RuntimeRoleRouteConfig[] {
  const profile = resolveThreadAgentProfile(settings, config);
  if (!profile) {
    throw new Error(`找不到 Agent Profile：${config.agentProfileId ?? config.routeProfileId}`);
  }
  return resolveCandidateModelDefaults(runtimeRoleRoutesFromAgentProfile(profile));
}

function resolveCandidateModelDefaults(routes: readonly RuntimeRoleRouteConfig[]): RuntimeRoleRouteConfig[] {
  return routes.map((route) => {
    if (!route.candidateModelId) {
      return route;
    }
    const candidate = providerStore
      .listCandidateModels(route.providerId)
      .find((entry) => entry.id === route.candidateModelId);
    if (!candidate) {
      return route;
    }
    const manualSpec = mergeRouteManualSpec(candidate.manualSpec, route.manualSpec);
    return {
      ...route,
      modelId: candidate.modelId || route.modelId,
      ...(route.modelsDevMapping
        ? { modelsDevMapping: route.modelsDevMapping }
        : candidate.modelsDevMapping
          ? { modelsDevMapping: candidate.modelsDevMapping }
          : {}),
      ...(manualSpec ? { manualSpec } : {}),
    };
  });
}

function mergeRouteManualSpec(
  candidateSpec: RouteManualSpec | undefined,
  profileSpec: RouteManualSpec | undefined,
): RouteManualSpec | undefined {
  if (!candidateSpec && !profileSpec) {
    return undefined;
  }
  return {
    ...(candidateSpec ?? {}),
    ...(profileSpec ?? {}),
  };
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
    resolveCandidateModelDefaults(roleRoutes ?? roleRoutesForThreadConfig(settings, config)),
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
    resolveCandidateModelDefaults(routesOverride ?? roleRoutesForThreadConfig(settings, config)),
    optionsOverride ?? runtimeValidationOptionsForThreadConfig(settings, config),
  );
}

function resolveRoleRoutesForThread(
  threadId: string,
  agentProfileIdOverride?: string,
): RuntimeRoleRouteConfig[] {
  const settings = getModelSettingsSnapshot();
  if (agentProfileIdOverride) {
    const profile = getAgentProfileById(settings, agentProfileIdOverride);
    if (!profile) {
      throw new Error(`找不到 Agent Profile：${agentProfileIdOverride}`);
    }
    return resolveCandidateModelDefaults(runtimeRoleRoutesFromAgentProfile(profile));
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

function threadPlanModeEnabled(threadId: string): boolean {
  const thread = conversationStore.getThread(threadId);
  const config = thread ? ensureThreadRuntimeConfig(thread).runtimeConfig : undefined;
  return config?.planModeEnabled ?? workflowSettingsStore.get().planModeEnabled;
}

function disableThreadPlanMode(threadId: string): ThreadRuntimeConfig | undefined {
  const thread = conversationStore.getThread(threadId);
  if (!thread) {
    return undefined;
  }
  const config = ensureThreadRuntimeConfig(thread).runtimeConfig;
  if (!config) {
    return undefined;
  }
  const next = withPlanModeDisabled(config);
  if (next === config) {
    return config;
  }
  conversationStore.saveThreadRuntimeConfig(threadId, next);
  return next;
}

/** @deprecated Use threadPlanModeEnabled. */
function threadUsesManualOrchestration(threadId: string): boolean {
  return threadPlanModeEnabled(threadId);
}

function registerDesktopCommand<Args extends unknown[], Result>(
  channel: IpcChannel,
  handler: (...args: Args) => Result | Promise<Result>,
): void {
  if (isRemoteCommandChannel(channel)) {
    desktopEventCenter.registerCommand(channel, (args) => handler(...(args as Args)));
  }
  ipcMain.handle(channel, async (_event, ...args: unknown[]) => handler(...(args as Args)));
}

function registerIpcHandlers(): void {
  registerDesktopCommand(IPC_CHANNELS.workspaceOpen, async () => {
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

  registerDesktopCommand(IPC_CHANNELS.workspaceOpenPath, async (workspacePath: unknown) => {
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

  registerDesktopCommand(IPC_CHANNELS.workspaceGetCurrent, async () => currentWorkspace);

  registerDesktopCommand(IPC_CHANNELS.workspaceGetHomePath, async () => getHomeProjectPath());

  registerDesktopCommand(IPC_CHANNELS.workspaceInspect, async (workspacePath: unknown) => {
    if (typeof workspacePath !== "string" || !workspacePath.trim()) {
      throw new Error("Workspace path is required.");
    }
    return inspectWorkspace(workspacePath.trim());
  });

  registerDesktopCommand(IPC_CHANNELS.workspaceListPackageScripts, async (workspacePath: unknown) => {
    if (typeof workspacePath !== "string" || !workspacePath.trim()) {
      throw new Error("Workspace path is required.");
    }
    return listPackageScripts(workspacePath.trim());
  });

  registerDesktopCommand(IPC_CHANNELS.workspaceWatchPackageJson, async (workspacePath: unknown) => {
    if (typeof workspacePath !== "string" || !workspacePath.trim()) {
      throw new Error("Workspace path is required.");
    }
    packageJsonWatcher.watch(workspacePath.trim());
    return { ok: true as const };
  });

  registerDesktopCommand(IPC_CHANNELS.workspaceStartPackageScript, async (payload: unknown) => {
    if (!isRunPackageScriptRequest(payload)) {
      throw new Error("Invalid start package script request.");
    }
    const prepared = await preparePackageScriptRun(payload);
    const target = payload.target ?? "embedded";
    if (isExternalPackageScriptTarget(target)) {
      ensureDesktopPath();
      const spawnEnv = toSpawnEnv();
      const executableName = prepared.command[0];
      if (!executableName) {
        throw new Error("Missing executable.");
      }
      const resolvedCommand = [resolveCommandExecutable(executableName), ...prepared.command.slice(1)];
      const pathValue = spawnEnv.PATH ?? "";
      const { launcherName } = launchInExternalTerminal(target, {
        command: resolvedCommand,
        cwd: prepared.workspacePath,
        pathValue,
      });
      return {
        script: prepared.script,
        command: resolvedCommand,
        target,
        externalLauncherName: launcherName,
      };
    }
    return packageScriptRunner.start(prepared.command, prepared.workspacePath, prepared.script);
  });

  registerDesktopCommand(IPC_CHANNELS.workspaceStopPackageScript, async (runId: unknown) => {
    if (typeof runId !== "string" || !runId.trim()) {
      throw new Error("Run id is required.");
    }
    return { stopped: packageScriptRunner.stop(runId.trim()) };
  });

  registerDesktopCommand(IPC_CHANNELS.workspacePrepareGit, async (payload: unknown) => {
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

  registerDesktopCommand(IPC_CHANNELS.threadList, async () =>
    hydrateThreads(conversationStore.listThreads()),
  );

  registerDesktopCommand(IPC_CHANNELS.threadDelete, async (payload: unknown) => {
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

  registerDesktopCommand(IPC_CHANNELS.threadUpdateRuntimeConfig, async (payload: unknown) => {
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
    const incoming = parseThreadRuntimeConfigInput(request.runtimeConfig);
    const existing = ensureThreadRuntimeConfig(thread).runtimeConfig;
    let runtimeConfig = incoming;
    if (thread.status === "running" || thread.status === "queued") {
      if (!existing || !isBashReviewModeOnlyRuntimeConfigUpdate(existing, incoming)) {
        throw new Error("请等待当前运行结束后再修改配置。");
      }
      runtimeConfig = { ...existing, bashReviewMode: incoming.bashReviewMode };
    }
    const settings = getModelSettingsSnapshot();
    const roleRoutes = roleRoutesForThreadConfig(settings, runtimeConfig);
    conversationStore.saveThreadRuntimeConfig(threadId, runtimeConfig);
    if (!existing || !isBashReviewModeOnlyRuntimeConfigUpdate(existing, runtimeConfig)) {
      noteSdkSessionRouteChange(threadId, roleRoutes);
    }
    return { thread: ensureThreadRuntimeConfig(conversationStore.getThread(threadId) ?? thread) };
  });

  registerDesktopCommand(IPC_CHANNELS.threadActivityList, async (threadId: string) => {
    if (typeof threadId !== "string" || !threadId.trim()) {
      return [];
    }
    return conversationStore.listActivityLines(threadId);
  });

  registerDesktopCommand(IPC_CHANNELS.threadRunProjectionGet, async (threadId: string) => {
    if (typeof threadId !== "string" || !threadId.trim()) {
      return undefined;
    }
    return buildCurrentThreadRunProjection(threadId.trim());
  });

  registerDesktopCommand(IPC_CHANNELS.threadSubagentSessionsList, async (threadId: string) => {
    if (typeof threadId !== "string" || !threadId.trim()) {
      return [];
    }
    return buildSubagentSessionTimings(conversationStore.listSubagentSessions(threadId));
  });

  registerDesktopCommand(IPC_CHANNELS.threadSubagentMetricsList, async (threadId: string) => {
    if (typeof threadId !== "string" || !threadId.trim()) {
      return [];
    }
    return buildSubagentMetricsSummaries(usageLedgerCoordinator.listSubagentBillingEntries(threadId));
  });

  registerDesktopCommand(IPC_CHANNELS.agentProfilePerformanceList, async () =>
    buildAgentProfilePerformanceSnapshots({
      threads: hydrateThreads(conversationStore.listThreads()),
      profiles: getModelSettingsSnapshot().orchestrationProfiles,
      getBillingSnapshot: (threadId) => usageLedgerCoordinator.projectBillingSnapshot(threadId),
    }),
  );

  registerDesktopCommand(IPC_CHANNELS.agentAuditExport, async (payload?: unknown) => {
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

  registerDesktopCommand(IPC_CHANNELS.threadTodoList, async (threadId: string) => {
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

  registerDesktopCommand(IPC_CHANNELS.modelSettingsGet, async () => getModelSettingsSnapshot());

  registerDesktopCommand(IPC_CHANNELS.modelProviderSave, async (payload: ProviderConfigInput) => {
    const provider = providerStore.saveProvider(payload);
    emitSettingsUpdated();
    return provider;
  });

  registerDesktopCommand(IPC_CHANNELS.modelProviderDelete, async (providerId: unknown) => {
    if (typeof providerId !== "string" || !providerId.trim()) {
      throw new Error("Provider id is required.");
    }
    providerStore.deleteProvider(providerId.trim());
    emitSettingsUpdated();
    return { ok: true as const };
  });

  registerDesktopCommand(IPC_CHANNELS.modelProviderListModels, async (payload: ListUpstreamModelsRequest) => {
    if (!payload || typeof payload !== "object") {
      return { ok: false, error: "Invalid models list request." } as const;
    }
    return listProviderUpstreamModels(
      providerStore,
      payload,
      resolveUpstreamUserAgentOverride(proxyBridgeSettingsStore.get()),
    );
  });

  registerDesktopCommand(IPC_CHANNELS.modelProviderTest, async (payload: TestProviderConnectionRequest) => {
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

  registerDesktopCommand(IPC_CHANNELS.modelRouteProfileTest, async (payload: TestRoleRoutesRequest) => {
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

  registerDesktopCommand(IPC_CHANNELS.modelRouteProfileSave, async (payload: RouteProfileInput) => {
    const profile = providerStore.saveRouteProfile(payload);
    emitSettingsUpdated();
    return profile;
  });

  registerDesktopCommand(IPC_CHANNELS.modelRouteProfileDelete, async (profileId: unknown) => {
    if (typeof profileId !== "string" || !profileId.trim()) {
      throw new Error("Route profile id is required.");
    }
    providerStore.deleteRouteProfile(profileId.trim());
    emitSettingsUpdated();
    return { ok: true as const };
  });

  // ─── Candidate Models ─────────────────────────────────────────────────────────

  registerDesktopCommand(IPC_CHANNELS.candidateModelList, async (providerId: unknown) => {
    if (typeof providerId !== "string" || !providerId.trim()) {
      throw new Error("Provider id is required.");
    }
    const trimmedProviderId = providerId.trim();
    const candidates = providerStore.listCandidateModels(trimmedProviderId);
    const provider = providerStore.listProviders().find((p) => p.id === trimmedProviderId);
    const baseUrl = provider?.baseUrl ?? "";
    return resolveCandidateModels(pricingCache, candidates, baseUrl);
  });

  registerDesktopCommand(IPC_CHANNELS.candidateModelSave, async (payload: unknown) => {
    if (!payload || typeof payload !== "object") {
      throw new Error("Invalid candidate model input.");
    }
    const result = providerStore.saveCandidateModel(payload as CandidateModelInput);
    emitSettingsUpdated();
    return result;
  });

  registerDesktopCommand(IPC_CHANNELS.candidateModelDelete, async (id: unknown) => {
    if (typeof id !== "string" || !id.trim()) {
      throw new Error("Candidate model id is required.");
    }
    providerStore.deleteCandidateModel(id.trim());
    emitSettingsUpdated();
    return { ok: true as const };
  });

  registerDesktopCommand(
    IPC_CHANNELS.candidateModelReorder,
    async (providerId: unknown, orderedIds: unknown) => {
      if (typeof providerId !== "string" || !providerId.trim()) {
        throw new Error("Provider id is required.");
      }
      if (!Array.isArray(orderedIds) || !orderedIds.every((id) => typeof id === "string")) {
        throw new Error("Ordered ids must be a string array.");
      }
      providerStore.reorderCandidateModels(providerId.trim(), orderedIds as string[]);
      emitSettingsUpdated();
      return { ok: true as const };
    },
  );

  registerDesktopCommand(
    IPC_CHANNELS.candidateModelBulkImport,
    async (providerId: unknown, modelIds: unknown) => {
      if (typeof providerId !== "string" || !providerId.trim()) {
        throw new Error("Provider id is required.");
      }
      if (!Array.isArray(modelIds) || !modelIds.every((id) => typeof id === "string")) {
        throw new Error("Model ids must be a string array.");
      }
      const results = providerStore.bulkImportCandidateModels(providerId.trim(), modelIds as string[]);
      emitSettingsUpdated();
      return results;
    },
  );

  registerDesktopCommand(
    IPC_CHANNELS.agentTemplateList,
    async () => getModelSettingsSnapshot().agentTemplates,
  );

  registerDesktopCommand(IPC_CHANNELS.agentTemplateSave, async (payload: unknown) => {
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

  registerDesktopCommand(IPC_CHANNELS.agentTemplateDelete, async (templateId: unknown) => {
    if (typeof templateId !== "string" || !templateId.trim()) {
      throw new Error("子代理模板 id 不能为空。");
    }
    assertCanWriteAgentTemplateId(templateId);
    agentOrchestrationStore.deleteAgentTemplate(templateId);
    emitSettingsUpdated();
    return { ok: true as const };
  });

  registerDesktopCommand(IPC_CHANNELS.agentTemplateExport, async (payload?: unknown) => {
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

  registerDesktopCommand(IPC_CHANNELS.agentTemplateImport, async () => {
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

  registerDesktopCommand(IPC_CHANNELS.agentTemplateVersionsList, async (templateId: unknown) => {
    if (typeof templateId !== "string" || !templateId.trim()) {
      throw new Error("子代理模板 id 不能为空。");
    }
    return agentOrchestrationStore.listAgentTemplateVersions(templateId);
  });

  registerDesktopCommand(IPC_CHANNELS.agentTemplateVersionRestore, async (payload: unknown) => {
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

  registerDesktopCommand(
    IPC_CHANNELS.orchestrationProfileList,
    async () => getModelSettingsSnapshot().orchestrationProfiles,
  );

  registerDesktopCommand(IPC_CHANNELS.orchestrationProfileSave, async (payload: unknown) => {
    if (!payload || typeof payload !== "object") {
      throw new Error("编排配置不能为空。");
    }
    const profile = payload as OrchestrationProfile;
    if (typeof profile.id !== "string") {
      throw new Error("编排配置 id 不能为空。");
    }
    const saved = agentOrchestrationStore.saveOrchestrationProfile(profile);
    emitSettingsUpdated();
    return saved;
  });

  registerDesktopCommand(IPC_CHANNELS.orchestrationProfileDelete, async (profileId: unknown) => {
    if (typeof profileId !== "string" || !profileId.trim()) {
      throw new Error("编排配置 id 不能为空。");
    }
    agentOrchestrationStore.deleteOrchestrationProfile(profileId);
    emitSettingsUpdated();
    return { ok: true as const };
  });

  registerDesktopCommand(IPC_CHANNELS.orchestrationProfileExport, async (payload?: unknown) => {
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

  registerDesktopCommand(IPC_CHANNELS.orchestrationProfileImport, async () => {
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

  registerDesktopCommand(IPC_CHANNELS.orchestrationProfileVersionsList, async (profileId: unknown) => {
    if (typeof profileId !== "string" || !profileId.trim()) {
      throw new Error("Agent Profile id 不能为空。");
    }
    return agentOrchestrationStore.listOrchestrationProfileVersions(profileId);
  });

  registerDesktopCommand(IPC_CHANNELS.orchestrationProfileVersionRestore, async (payload: unknown) => {
    if (
      !payload ||
      typeof payload !== "object" ||
      typeof (payload as OrchestrationProfileVersionRestoreRequest).profileId !== "string" ||
      typeof (payload as OrchestrationProfileVersionRestoreRequest).version !== "number"
    ) {
      throw new Error("Agent Profile 版本恢复请求无效。");
    }
    const request = payload as OrchestrationProfileVersionRestoreRequest;
    const restored = agentOrchestrationStore.restoreOrchestrationProfileVersion(
      request.profileId,
      request.version,
    );
    emitSettingsUpdated();
    return restored;
  });

  registerDesktopCommand(IPC_CHANNELS.billingModelsDevList, async () => {
    await pricingCatalogReady;
    return pricingCache.listModelOptions();
  });

  registerDesktopCommand(IPC_CHANNELS.billingRefreshPricing, async () => {
    await pricingCache.refresh();
    return { ok: true as const, cachedAt: pricingCache.getCachedAt() };
  });

  registerDesktopCommand(
    IPC_CHANNELS.billingRoutePricing,
    async (routesOverride?: RuntimeRoleRouteConfig[]) => {
      await pricingCatalogReady;
      return lookupRoutePricingHints(
        pricingCache,
        getModelSettingsSnapshot(),
        providerStore.listProvidersWithSecrets(),
        routesOverride ? resolveCandidateModelDefaults(routesOverride) : routesOverride,
      );
    },
  );

  registerDesktopCommand(
    IPC_CHANNELS.billingRouteCapabilities,
    async (routesOverride?: RuntimeRoleRouteConfig[]) => {
      await pricingCatalogReady;
      return lookupRouteCapabilityHints(
        pricingCache,
        getModelSettingsSnapshot(),
        providerStore.listProvidersWithSecrets(),
        routesOverride ? resolveCandidateModelDefaults(routesOverride) : routesOverride,
      );
    },
  );

  registerDesktopCommand(IPC_CHANNELS.mcpSettingsGet, async () => mcpStore.getSettings());

  registerDesktopCommand(IPC_CHANNELS.mcpServerSave, async (payload: McpServerConfigInput) => {
    const server = mcpStore.saveServer(payload);
    emitSettingsUpdated();
    return server;
  });

  registerDesktopCommand(IPC_CHANNELS.skillsList, async (workspacePath: unknown) => {
    const pathToScan =
      typeof workspacePath === "string" && workspacePath.trim()
        ? workspacePath.trim()
        : currentWorkspace?.path;
    return listDiscoveredSkills(pathToScan);
  });

  registerDesktopCommand(IPC_CHANNELS.skillsLinkAgents, async (payload: unknown) => {
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

  registerDesktopCommand(IPC_CHANNELS.workflowSettingsGet, async () => workflowSettingsStore.get());

  registerDesktopCommand(IPC_CHANNELS.workflowSettingsSave, async (payload: unknown) => {
    if (!isWorkflowSettingsSnapshot(payload)) {
      throw new Error("Invalid workflow settings.");
    }
    return workflowSettingsStore.save(normalizeWorkflowSettingsSnapshot(payload));
  });

  registerDesktopCommand(IPC_CHANNELS.gitSettingsGet, async () => gitSettingsStore.get());

  registerDesktopCommand(IPC_CHANNELS.gitSettingsSave, async (payload: unknown) => {
    if (!isGitSettingsSnapshot(payload)) {
      throw new Error("Invalid git settings.");
    }
    return gitSettingsStore.save(normalizeGitSettingsSnapshot(payload));
  });

  registerDesktopCommand(IPC_CHANNELS.gitGetStatus, async (workspacePath: unknown) => {
    if (typeof workspacePath !== "string" || !workspacePath.trim()) {
      throw new Error("Workspace path is required.");
    }
    return getGitWorkingTreeStatus(workspacePath.trim(), runGitCommand);
  });

  registerDesktopCommand(IPC_CHANNELS.gitGetWorkspaceDiff, async (workspacePath: unknown) => {
    if (typeof workspacePath !== "string" || !workspacePath.trim()) {
      throw new Error("Workspace path is required.");
    }
    return getWorkspaceDiff(workspacePath.trim(), runGitCommand);
  });

  registerDesktopCommand(IPC_CHANNELS.gitDiscardWorkspaceChanges, async (payload: unknown) => {
    if (!payload || typeof payload !== "object") {
      throw new Error("Invalid git discard workspace changes request.");
    }
    const record = payload as Record<string, unknown>;
    if (typeof record.workspacePath !== "string" || !record.workspacePath.trim()) {
      throw new Error("Invalid git discard workspace changes request.");
    }
    const filePath = typeof record.path === "string" ? record.path.trim() : undefined;
    return discardWorkspaceChanges(
      record.workspacePath.trim(),
      filePath ? { path: filePath } : {},
      runGitCommand,
    );
  });

  registerDesktopCommand(IPC_CHANNELS.gitListCommits, async (payload: unknown) => {
    if (!isGitListCommitsRequest(payload)) {
      throw new Error("Invalid git list commits request.");
    }
    return listGitCommits(
      payload.workspacePath.trim(),
      { skip: payload.skip, limit: payload.limit },
      runGitCommand,
    );
  });

  registerDesktopCommand(IPC_CHANNELS.gitCheckoutBranch, async (payload: unknown) => {
    if (!payload || typeof payload !== "object") {
      throw new Error("Invalid git checkout request.");
    }
    const record = payload as Record<string, unknown>;
    if (typeof record.workspacePath !== "string" || typeof record.branch !== "string") {
      throw new Error("Invalid git checkout request.");
    }
    await checkoutGitBranch(record.workspacePath, record.branch, runGitCommand);
    return getGitWorkingTreeStatus(record.workspacePath, runGitCommand);
  });

  registerDesktopCommand(IPC_CHANNELS.gitCreateBranch, async (payload: unknown) => {
    if (!payload || typeof payload !== "object") {
      throw new Error("Invalid git create branch request.");
    }
    const record = payload as Record<string, unknown>;
    if (typeof record.workspacePath !== "string" || typeof record.branch !== "string") {
      throw new Error("Invalid git create branch request.");
    }
    await createGitBranch(record.workspacePath, record.branch, runGitCommand);
    return getGitWorkingTreeStatus(record.workspacePath, runGitCommand);
  });

  registerDesktopCommand(IPC_CHANNELS.gitGenerateCommitMessage, async (payload: unknown) => {
    if (!isGitGenerateCommitMessageRequest(payload)) {
      throw new Error("Invalid git generate commit message request.");
    }
    return handleGitGenerateCommitMessage(payload, {
      providerStore,
      agentOrchestrationStore,
      gitSettingsStore,
      pricingCache,
      run: runGitCommand,
    });
  });

  registerDesktopCommand(IPC_CHANNELS.gitCommit, async (payload: unknown) => {
    if (!isGitCommitRequest(payload)) {
      throw new Error("Invalid git commit request.");
    }
    const result = await handleGitCommit(payload, {
      providerStore,
      agentOrchestrationStore,
      gitSettingsStore,
      pricingCache,
      run: runGitCommand,
    });
    if (currentWorkspace?.path === payload.workspacePath.trim()) {
      currentWorkspace = await inspectWorkspace(payload.workspacePath.trim());
    }
    return result;
  });

  registerDesktopCommand(IPC_CHANNELS.gitPush, async (payload: unknown) => {
    if (!isGitPushRequest(payload)) {
      throw new Error("Invalid git push request.");
    }
    return handleGitPush(payload, runGitCommand);
  });

  registerDesktopCommand(IPC_CHANNELS.gitPull, async (payload: unknown) => {
    if (!isGitPullRequest(payload)) {
      throw new Error("Invalid git pull request.");
    }
    const result = await handleGitPull(payload, runGitCommand);
    if (currentWorkspace?.path === payload.workspacePath.trim()) {
      currentWorkspace = await inspectWorkspace(payload.workspacePath.trim());
    }
    return result;
  });

  registerDesktopCommand(IPC_CHANNELS.proxyBridgeSettingsGet, async () => proxyBridgeSettingsStore.get());

  registerDesktopCommand(IPC_CHANNELS.proxyBridgeSettingsSave, async (payload: unknown) => {
    if (!isProxyBridgeSettingsSnapshot(payload)) {
      throw new Error("Invalid proxy bridge settings.");
    }
    return proxyBridgeSettingsStore.save(normalizeProxyBridgeSettingsSnapshot(payload));
  });

  registerDesktopCommand(IPC_CHANNELS.worktreeGetStatus, async (threadId: unknown) => {
    if (typeof threadId !== "string" || !threadId.trim()) {
      throw new Error("Thread id is required.");
    }
    return getWorkspaceChangeStatus(threadId);
  });

  registerDesktopCommand(IPC_CHANNELS.worktreeApply, async (threadId: unknown) => {
    if (typeof threadId !== "string" || !threadId.trim()) {
      throw new Error("Thread id is required.");
    }
    return { ok: true, files: [], message: "变更已在项目目录中，无需合并。" } satisfies WorktreeApplyResult;
  });

  registerDesktopCommand(IPC_CHANNELS.threadRewindCheckpoint, async (payload: unknown) => {
    return rewindThreadToCheckpoint(payload);
  });

  registerDesktopCommand(IPC_CHANNELS.threadCompactContext, async (threadId: unknown) => {
    if (typeof threadId !== "string" || !threadId.trim()) {
      throw new Error("Thread id is required.");
    }
    return compactThreadContextManual(threadId.trim());
  });

  registerDesktopCommand(IPC_CHANNELS.threadListCheckpoints, async (threadId: unknown) => {
    if (typeof threadId !== "string" || !threadId.trim()) {
      throw new Error("Thread id is required.");
    }
    return conversationStore.listFileCheckpoints(threadId.trim());
  });

  registerDesktopCommand(IPC_CHANNELS.mcpServerDelete, async (serverId: unknown) => {
    if (typeof serverId !== "string" || !serverId.trim()) {
      throw new Error("MCP server id is required.");
    }
    mcpStore.deleteServer(serverId);
    emitSettingsUpdated();
    return { ok: true };
  });

  registerDesktopCommand(IPC_CHANNELS.sessionSyncSettingsGet, async () => sessionSyncStore.getSettings());

  registerDesktopCommand(IPC_CHANNELS.sessionSyncSettingsSave, async (payload: SessionSyncSettingsInput) => {
    const settings = sessionSyncStore.saveSettings(payload);
    await rebuildSdkSessionStore(path.join(app.getPath("userData"), "eco-sessions.sqlite"));
    emitSettingsUpdated();
    return settings;
  });

  registerDesktopCommand(
    IPC_CHANNELS.sessionSyncTestConnection,
    async (payload: SessionSyncTestConnectionRequest) => {
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

  registerDesktopCommand(IPC_CHANNELS.centerServerSettingsGet, async () => centerServerClient.getSnapshot());

  registerDesktopCommand(
    IPC_CHANNELS.centerServerSettingsSave,
    async (payload: CenterServerSettingsInput) => {
      const snapshot = centerServerClient.saveSettings(payload);
      emitSettingsUpdated();
      return snapshot;
    },
  );

  registerDesktopCommand(
    IPC_CHANNELS.centerServerRegisterDesktop,
    async (payload: CenterServerRegisterDesktopRequest) => {
      const result = await centerServerClient.registerDesktop(payload);
      emitSettingsUpdated();
      return result;
    },
  );

  registerDesktopCommand(IPC_CHANNELS.centerServerSignUp, async (payload: CenterServerSignUpRequest) => {
    const result = await centerServerClient.signUpAndRegisterDesktop(payload);
    emitSettingsUpdated();
    return result;
  });

  registerDesktopCommand(IPC_CHANNELS.centerServerSignIn, async (payload: CenterServerSignInRequest) => {
    const result = await centerServerClient.signInAndRegisterDesktop(payload);
    emitSettingsUpdated();
    return result;
  });

  registerDesktopCommand(IPC_CHANNELS.centerServerCreatePairing, async () =>
    centerServerClient.createPairing(),
  );

  registerDesktopCommand(IPC_CHANNELS.centerServerConnect, async () => {
    await centerServerClient.start();
    const snapshot = centerServerClient.getSnapshot();
    emitSettingsUpdated();
    return snapshot;
  });

  registerDesktopCommand(IPC_CHANNELS.centerServerDisconnect, async () => {
    centerServerClient.stop();
    const snapshot = centerServerClient.getSnapshot();
    emitSettingsUpdated();
    return snapshot;
  });

  registerDesktopCommand(
    IPC_CHANNELS.centerServerTestConnection,
    async (payload: CenterServerTestConnectionRequest) => centerServerClient.testConnection(payload),
  );

  registerDesktopCommand(IPC_CHANNELS.threadStart, async (payload: ThreadStartRequest) => {
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
      scheduleThreadTitleSummary(thread.id, runtimeConfig);
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
      } else if (threadRuntime.planModeEnabled) {
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

  registerDesktopCommand(IPC_CHANNELS.clarificationGetPending, async (threadId: unknown) => {
    if (typeof threadId !== "string" || !threadId.trim()) {
      return undefined;
    }
    return getPendingClarificationForThread(threadId);
  });

  registerDesktopCommand(IPC_CHANNELS.clarificationDismiss, async (toolUseId: unknown) => {
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

  registerDesktopCommand(IPC_CHANNELS.clarificationSubmit, async (payload: unknown) => {
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

  registerDesktopCommand(IPC_CHANNELS.bashApprovalGetPending, async (threadId: unknown) => {
    if (typeof threadId !== "string" || !threadId.trim()) {
      return undefined;
    }
    return getPendingBashApprovalForThread(threadId);
  });

  registerDesktopCommand(IPC_CHANNELS.bashApprovalResolve, async (payload: unknown) => {
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

  registerDesktopCommand(IPC_CHANNELS.threadGetUsageSnapshot, async (threadId: unknown) => {
    if (typeof threadId !== "string" || !threadId.trim()) {
      return {} satisfies ThreadUsageSnapshotResult;
    }
    const id = threadId.trim();
    const legacyBilling = threadUsageAccumulator.getSnapshot(id);
    const selectionOptions = resolveBillingSnapshotSelectionOptions({
      ...(legacyBilling?.plannerModelLabel && { plannerModelLabel: legacyBilling.plannerModelLabel }),
    });
    let billingBase: ThreadBillingSnapshot | undefined;
    if (legacyBilling) {
      const billingSelection = usageLedgerCoordinator.resolveBillingSnapshot(
        id,
        legacyBilling,
        selectionOptions,
      );
      billingBase = usageLedgerCoordinator.enrichBillingSnapshot(id, billingSelection.snapshot);
    } else {
      const ledgerBilling = usageLedgerCoordinator.projectBillingSnapshot(id);
      billingBase = ledgerBilling
        ? usageLedgerCoordinator.enrichBillingSnapshot(id, ledgerBilling)
        : undefined;
    }
    const billing = billingBase
      ? enrichBillingDisplaySource(billingBase, conversationStore.getThread(id)?.status)
      : undefined;
    const context = contextScheduler.getDisplaySnapshot(id);
    return {
      ...(billing && { billing }),
      ...(context && { context }),
    } satisfies ThreadUsageSnapshotResult;
  });

  registerDesktopCommand(IPC_CHANNELS.threadUsageLedgerEventsList, async (threadId: unknown) => {
    if (typeof threadId !== "string" || !threadId.trim()) {
      return [] as ThreadUsageLedgerEventView[];
    }
    return usageLedgerCoordinator.listUsageLedgerEventViews(threadId.trim());
  });

  registerDesktopCommand(IPC_CHANNELS.threadGetPendingPlan, async (threadId: unknown) => {
    if (typeof threadId !== "string" || !threadId.trim()) {
      return undefined;
    }
    return buildThreadPendingPlanView(conversationStore.getPendingPlan(threadId));
  });

  registerDesktopCommand(IPC_CHANNELS.threadApprovePlan, async (payload: unknown) => {
    const { threadId } = parseThreadApprovePlanPayload(payload);
    const approval = resolveThreadPlanApprovalRuntime(threadId, {
      getThread: (id) => conversationStore.getThread(id),
      hasActiveRun: (id) => activeRunRuntimeState.hasRun(id),
      getPendingPlan: (id) => conversationStore.getPendingPlan(id),
      resolveRoleRoutes: (id) => resolveRoleRoutesForThread(id),
      resolveRuntimeConfig: (routes) => resolveRuntimeConfigForThreadId(threadId, routes),
    });

    updateThread(threadId, {
      status: "running",
      message: "正在按计划执行…",
    });
    void runCodingThreadExecution(threadId, approval.runtimeConfig, {
      routesOverride: approval.roleRoutes,
    });
    return { thread: ensureThreadRuntimeConfig(conversationStore.getThread(threadId) ?? approval.thread) };
  });

  registerDesktopCommand(IPC_CHANNELS.threadDismissPlan, async (threadId: unknown) => {
    if (typeof threadId !== "string" || !threadId.trim()) {
      throw new Error("Thread id is required.");
    }
    await dismissPendingPlan(
      threadId,
      "已忽略计划。可在下方继续对话说明修改意见，Planner 将重新输出完整计划。",
    );
    return { thread: conversationStore.getThread(threadId) };
  });

  registerDesktopCommand(IPC_CHANNELS.threadContinue, async (payload: ThreadContinueRequest) => {
    const rewindTarget = parseThreadActivityRewindTarget(payload.rewindTarget);
    return startThreadContinuation({
      threadId: payload.threadId,
      prompt: payload.prompt,
      ...(payload.runtimeConfig ? { runtimeConfigInput: payload.runtimeConfig } : {}),
      ...(payload.attachments?.length ? { attachments: payload.attachments } : {}),
      ...(rewindTarget ? { rewindTarget } : {}),
    });
  });

  registerDesktopCommand(IPC_CHANNELS.threadFollowUpEnqueue, async (payload: unknown) => {
    const request = parseThreadFollowUpEnqueueRequest(payload);
    const thread = conversationStore.getThread(request.threadId);
    if (!thread) {
      throw new Error("Thread was not found.");
    }
    if (!threadAcceptsLiveFollowUp(thread.id, thread.status)) {
      throw new Error("Thread is not accepting queued follow-up messages.");
    }
    if (contextMonitor.isCompactInFlight(thread.id)) {
      throw new Error("上下文正在压缩中，请稍候。");
    }
    const metadata = resolveThreadFollowUpEnqueueMetadata(thread.id);
    const followUp = conversationStore.enqueueThreadFollowUp({
      threadId: thread.id,
      prompt: request.prompt,
      ...(request.attachments?.length ? { attachments: request.attachments } : {}),
      ...(request.priority ? { priority: request.priority } : {}),
      deliveryMode: request.priority === "escalated" ? "interrupt_resume" : "queued",
      ...metadata,
    });
    emitThreadFollowUpEvent(followUp, "thread.follow_up.queued", formatFollowUpQueuedMessage(followUp));
    return buildThreadFollowUpMutationResult(followUp);
  });

  registerDesktopCommand(IPC_CHANNELS.threadFollowUpEscalate, async (payload: unknown) => {
    const request = parseThreadFollowUpEscalateRequest(payload);
    const thread = conversationStore.getThread(request.threadId);
    if (!thread) {
      throw new Error("Thread was not found.");
    }
    if (!threadAcceptsLiveFollowUp(thread.id, thread.status)) {
      throw new Error("Thread is not accepting queued follow-up messages.");
    }
    if (contextMonitor.isCompactInFlight(thread.id)) {
      throw new Error("上下文正在压缩中，请稍候。");
    }
    const base = request.followUpId
      ? conversationStore.escalateThreadFollowUp(thread.id, request.followUpId)
      : conversationStore.enqueueThreadFollowUp({
          threadId: thread.id,
          prompt: request.prompt ?? "",
          ...(request.attachments?.length ? { attachments: request.attachments } : {}),
          priority: "escalated",
          deliveryMode: "interrupt_resume",
          ...resolveThreadFollowUpEnqueueMetadata(thread.id),
        });
    if (!base) {
      throw new Error("Pending follow-up was not found or cannot be escalated.");
    }
    const followUp = request.followUpId
      ? base
      : (conversationStore.escalateThreadFollowUp(thread.id, base.id) ?? base);
    emitThreadFollowUpEvent(followUp, "thread.follow_up.escalated", "");
    const current = await requestEscalatedFollowUpInterrupt(thread, followUp);
    return buildThreadFollowUpMutationResult(current);
  });

  registerDesktopCommand(IPC_CHANNELS.threadFollowUpList, async (threadId: unknown) => {
    const id = typeof threadId === "string" ? threadId.trim() : "";
    if (!id) {
      return { followUps: [] };
    }
    return { followUps: conversationStore.listThreadFollowUps(id) };
  });

  registerDesktopCommand(IPC_CHANNELS.threadFollowUpCancel, async (payload: unknown) => {
    const request = parseThreadFollowUpCancelRequest(payload);
    const followUp = conversationStore.cancelThreadFollowUp(request.threadId, request.followUpId);
    if (!followUp) {
      throw new Error("Pending follow-up was not found or cannot be cancelled.");
    }
    emitThreadFollowUpEvent(followUp, "thread.follow_up.cancelled", "已取消排队的后续消息。");
    return buildThreadFollowUpMutationResult(followUp);
  });

  registerDesktopCommand(IPC_CHANNELS.threadFollowUpUpdate, async (payload: unknown) => {
    const request = parseThreadFollowUpUpdateRequest(payload);
    const thread = conversationStore.getThread(request.threadId);
    if (!thread) {
      throw new Error("Thread was not found.");
    }
    if (!threadAcceptsLiveFollowUp(thread.id, thread.status)) {
      throw new Error("Thread is not accepting queued follow-up messages.");
    }
    if (contextMonitor.isCompactInFlight(thread.id)) {
      throw new Error("上下文正在压缩中，请稍候。");
    }
    const followUp = conversationStore.updateThreadFollowUp(request.threadId, request.followUpId, {
      prompt: request.prompt,
      ...(request.attachments?.length ? { attachments: request.attachments } : {}),
    });
    if (!followUp) {
      throw new Error("Pending follow-up was not found or cannot be updated.");
    }
    emitThreadFollowUpEvent(followUp, "thread.follow_up.updated", "");
    return buildThreadFollowUpMutationResult(followUp);
  });

  registerDesktopCommand(IPC_CHANNELS.threadRetry, async (payload: unknown) => {
    const request = parseThreadRetryRequest(payload);
    return retryThread(request);
  });

  registerDesktopCommand(IPC_CHANNELS.threadCancel, async (payload: unknown) => {
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
      }
    }
  });

  registerDesktopCommand(IPC_CHANNELS.threadRollbackTo, async (threadId: unknown) => {
    if (typeof threadId !== "string" || !threadId.trim()) {
      throw new Error("Thread id is required.");
    }
    return rollbackWorkspaceToThread(threadId);
  });

  registerDesktopCommand(IPC_CHANNELS.threadGetAppliedDiff, async (threadId: unknown) => {
    if (typeof threadId !== "string" || !threadId.trim()) {
      throw new Error("Thread id is required.");
    }
    return getThreadAppliedDiff(threadId);
  });

  registerDesktopCommand(IPC_CHANNELS.threadRevertAppliedDiff, async (threadId: unknown) => {
    if (typeof threadId !== "string" || !threadId.trim()) {
      throw new Error("Thread id is required.");
    }
    return revertThreadAppliedDiff(threadId);
  });

  registerDesktopCommand(IPC_CHANNELS.modelProfilesList, async () => getModelSettingsSnapshot().providers);

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

function scheduleThreadTitleSummary(threadId: string, runtimeConfig: RuntimeConfig): void {
  const thread = conversationStore.getThread(threadId);
  if (!thread || !shouldReplaceAutoThreadTitle(thread.title)) {
    return;
  }

  const prompt = thread.prompt;
  void summarizeThreadTitle(runtimeConfig.routes, prompt, fetch)
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
        const runtimeConfig = disableThreadPlanMode(input.threadId);
        emitThreadEvent(event.threadId, "thread.awaiting_plan", event.message, "planner", false, {
          plan: event.plan,
          ...(runtimeConfig ? { runtimeConfig } : {}),
        });
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
  try {
    await drainQueuedThreadFollowUpsAfterRun(input.threadId);
  } catch (error) {
    process.stderr.write(
      `[eco] failed to drain queued follow-ups (${input.threadId}): ${errorMessage(error)}\n`,
    );
  }
}

async function requestEscalatedFollowUpInterrupt(
  thread: ThreadSummary,
  followUp: ThreadPendingFollowUp,
): Promise<ThreadPendingFollowUp> {
  if (activeRunRuntimeState.abortRun(thread.id, "follow-up escalated")) {
    pendingEscalatedFollowUpDrain.add(thread.id);
    updateThread(thread.id, {
      status: "running",
      message: "正在停止当前步骤，随后处理最新后续消息。",
    });
    cancelClarificationsForThread(thread.id, "follow-up escalated");
    cancelBashApprovalsForThread(thread.id, "follow-up escalated");
    emitThreadEvent(
      thread.id,
      "thread.follow_up.interrupting",
      "正在停止当前步骤，随后处理最新后续消息。",
      "system",
      false,
      { followUp },
    );
    return followUp;
  }

  if (shouldDrainThreadFollowUps(thread.status)) {
    void drainQueuedThreadFollowUpsAfterRun(thread.id);
    return followUp;
  }

  const reason = "当前对话没有可中断的 active run，无法立即处理后续消息。";
  const failed =
    conversationStore.updateThreadFollowUpStatus(thread.id, followUp.id, {
      status: "failed",
      error: reason,
    }) ?? followUp;
  emitThreadEvent(thread.id, "thread.follow_up.failed", `后续消息处理失败：${reason}`, "system", false, {
    followUp: failed,
  });
  return failed;
}

async function drainQueuedThreadFollowUpsAfterRun(threadId: string): Promise<void> {
  if (activeRunRuntimeState.hasRun(threadId)) {
    return;
  }
  const thread = conversationStore.getThread(threadId);
  const forceEscalatedDrain = pendingEscalatedFollowUpDrain.delete(threadId);
  if (!thread || (!forceEscalatedDrain && !shouldDrainThreadFollowUps(thread.status))) {
    return;
  }
  const queued = conversationStore.listThreadFollowUps(threadId, { statuses: ["queued"] });
  const claimPriority = queued.some((followUp) => followUp.priority === "escalated")
    ? "escalated"
    : undefined;
  const claimed = conversationStore.claimQueuedThreadFollowUps(threadId, {
    deliveryMode: "resume",
    deliveryBoundary: forceEscalatedDrain ? "forced_interrupt" : "safe_boundary",
    ...(claimPriority ? { priority: claimPriority } : {}),
  });
  if (claimed.length === 0) {
    return;
  }

  const prompt = buildThreadFollowUpDrainPrompt(claimed);
  const displayPrompt = buildThreadFollowUpDisplayPrompt(claimed);
  const attachments = collectThreadFollowUpAttachments(claimed);
  try {
    if (!prompt && attachments.length === 0) {
      throw new Error("排队的后续消息缺少可发送内容。");
    }
    await startThreadContinuation({
      threadId,
      prompt,
      displayPrompt,
      ...(attachments.length > 0 ? { attachments } : {}),
      requireResumeForInterrupted:
        forceEscalatedDrain || thread.status === "failed" || thread.status === "blocked",
    });
    for (const followUp of claimed) {
      const applied =
        conversationStore.updateThreadFollowUpStatus(threadId, followUp.id, { status: "applied" }) ??
        followUp;
      emitThreadEvent(threadId, "thread.follow_up.applied", "已开始处理排队的后续消息。", "system", false, {
        followUp: applied,
      });
    }
  } catch (error) {
    const reason = errorMessage(error);
    for (const followUp of claimed) {
      const failed =
        conversationStore.updateThreadFollowUpStatus(threadId, followUp.id, {
          status: "failed",
          error: reason,
        }) ?? followUp;
      emitThreadEvent(
        threadId,
        "thread.follow_up.failed",
        `后续消息处理失败：${formatFollowUpDrainError(reason)}`,
        "system",
        false,
        { followUp: failed },
      );
    }
  }
}

function formatFollowUpDrainError(reason: string): string {
  const formatted = formatUserFacingRequestError(reason);
  return formatted.length > 180 ? `${formatted.slice(0, 177)}…` : formatted;
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
  const taskRuntime = createThreadSdkTaskRuntime({
    threadId: thread.id,
    store: {
      listTodos: (id) => conversationStore.listCoderTodos(id),
      replaceTodos: (id, todos) => conversationStore.replaceCoderTodos(id, todos),
    },
    emitTodoList,
  });
  const taskRunHooks = taskRuntime.taskRunHooks;

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
              const driver = createSdkDriver(
                thread.id,
                attemptProxy,
                taskRunHooks.hookContextExtras,
                "execution",
              );
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
                    });
                  }
                  taskRuntime.handleEvent(event);
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
          taskRunHooks.stopIfUnhandled("cancelled");
          cancelClarificationsForThread(thread.id, reason);
          await handleRunCancelled(thread.id, worktreePlan);
        },
        onFailed: (reason) => {
          taskRunHooks.stopIfUnhandled("blocked");
          cancelClarificationsForThread(thread.id, reason);
          clearSdkSessionAfterResumeFailure(thread.id, Boolean(resumeOptsForRun));
          markThreadInterrupted(thread.id, reason);
        },
      })
    ) {
      return;
    }

    taskRunHooks.stopIfUnhandled("completed");
    await completeCodingThreadRun(thread.id, worktreePlan);
  } catch (error) {
    taskRunHooks.stopIfUnhandled("blocked");
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
                    sdkSession: await buildSdkSessionOptions(thread.id, prompt, { skillsScope: "planning" }),
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

async function runCodingThreadExecution(
  threadId: string,
  runtimeConfig: RuntimeConfig,
  options?: {
    planUserEdited?: boolean;
    routesOverride?: readonly RuntimeRoleRouteConfig[];
    followUp?: string;
    attachments?: PromptImageAttachment[];
    resume?: EcoSdkResumeOptions;
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
    ...(pending.planFilePath ? { planFilePath: pending.planFilePath } : {}),
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

  if (pending.planFilePath) {
    conversationStore.setThreadClaudePlanFilePath(threadId, pending.planFilePath);
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

              const resume = options?.resume ?? resolveResumeOptions(threadId, executionCwd);
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

interface StartThreadContinuationInput {
  threadId: string;
  prompt: string;
  displayPrompt?: string;
  runtimeConfigInput?: ThreadRuntimeConfigInput;
  attachments?: PromptImageAttachment[];
  rewindTarget?: ThreadActivityRewindTarget;
  requireResumeForInterrupted?: boolean;
}

async function startThreadContinuation(input: StartThreadContinuationInput): Promise<ThreadContinueResult> {
  const prompt = input.prompt.trim();
  const hasAttachments = Boolean(input.attachments?.length);
  if (!prompt && !hasAttachments) {
    throw new Error("Message is required.");
  }
  const thread = conversationStore.getThread(input.threadId);
  if (!thread) {
    throw new Error("Thread was not found.");
  }
  if (thread.status === "running" || thread.status === "queued") {
    throw new Error("Wait for the current run to finish.");
  }
  if (contextMonitor.isCompactInFlight(input.threadId)) {
    throw new Error("上下文正在压缩中，请稍候。");
  }

  const workspace = await ensureWorkspace(thread.workspacePath);
  const settings = getModelSettingsSnapshot();
  if (input.runtimeConfigInput) {
    const nextConfig = parseThreadRuntimeConfigInput(input.runtimeConfigInput);
    roleRoutesForThreadConfig(settings, nextConfig);
    conversationStore.saveThreadRuntimeConfig(input.threadId, nextConfig);
  }
  const activeThread = ensureThreadRuntimeConfig(conversationStore.getThread(input.threadId) ?? thread);
  const activeRuntimeConfig = activeThread.runtimeConfig;
  if (!activeRuntimeConfig) {
    throw new Error("Thread runtime configuration is missing.");
  }
  const roleRoutes = roleRoutesForThreadConfig(settings, activeRuntimeConfig);
  noteSdkSessionRouteChange(input.threadId, roleRoutes);

  const runtimeConfig = resolveRuntimeConfigForThreadConfig(settings, activeRuntimeConfig, roleRoutes);
  if (!runtimeConfig.ok) {
    throw new Error(runtimeConfig.reason);
  }
  const runtime: RuntimeConfig = { routes: runtimeConfig.routes };

  const rewindResume = input.rewindTarget
    ? await prepareThreadRewindForContinue({
        threadId: input.threadId,
        prompt,
        workspace,
        target: input.rewindTarget,
      })
    : undefined;
  const effectiveThread = ensureThreadRuntimeConfig(
    conversationStore.getThread(input.threadId) ?? activeThread,
  );
  const intent = classifyThreadIntent(prompt);
  const activityLines = conversationStore.listActivityLines(input.threadId);
  const sdkSession = conversationStore.getSdkSession(input.threadId);
  const cwd = normalizeSessionCwd(workspace.path, sdkSession?.cwd);
  const canResume = Boolean(
    rewindResume?.resumeSessionId || (sdkSession?.sessionId && existsSync(cwd) && cwd === workspace.path),
  );
  if (
    input.requireResumeForInterrupted &&
    (effectiveThread.status === "failed" || effectiveThread.status === "blocked") &&
    !canResume
  ) {
    throw new Error("当前对话没有可恢复的 SDK 会话，无法自动处理排队的后续消息。");
  }
  const existingWorktreePlan = createSessionPlan(workspace.path, input.threadId);

  const hasPendingPlan = Boolean(conversationStore.getPendingPlan(input.threadId));
  const claudePlanPath = conversationStore.getThreadClaudePlanFilePath(input.threadId);
  const hasApprovedPlanOnDisk = claudePlanPath
    ? await claudePlanFileExists(workspace.path, claudePlanPath)
    : false;
  const hasCoderTodos = conversationStore.listCoderTodos(input.threadId).length > 0;
  const hasAppliedDiff = Boolean(conversationStore.getAppliedDiff(input.threadId));
  const enteredExecutionPhase = threadEnteredExecutionPhase({
    threadStatus: effectiveThread.status,
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
    planModeEnabled: threadPlanModeEnabled(input.threadId),
    hasPendingPlan,
    hasApprovedPlanOnDisk,
    enteredExecutionPhase,
    hasCoderTodos,
    hasAppliedDiff,
    threadStatus: effectiveThread.status,
    activityLines,
  });

  const agentPrompt =
    continueAction.kind === "resume_sdk" || continueAction.kind === "resume_execution"
      ? prompt
      : buildAgentPromptWithContext(effectiveThread.prompt, prompt, activityLines);
  const statusMessage = continueStatusMessage(continueAction, intent);

  updateThread(input.threadId, {
    status: "running",
    message: statusMessage,
  });
  recordUserPrompt(input.threadId, input.displayPrompt?.trim() || prompt);

  const updated: ThreadSummary = {
    ...effectiveThread,
    status: "running",
    message: statusMessage,
  };

  void dispatchThreadContinueAction({
    threadId: input.threadId,
    action: continueAction,
    updated,
    workspace,
    runtimeConfig: runtime,
    agentPrompt,
    cwd,
    existingWorktreePlan,
    ...(input.attachments?.length ? { attachments: input.attachments } : {}),
    roleRoutes,
    ...(rewindResume && { resumeOverride: rewindResume }),
  });

  return {
    thread: ensureThreadRuntimeConfig(conversationStore.getThread(input.threadId) ?? updated),
  } satisfies ThreadContinueResult;
}

function parseThreadRetryRequest(payload: unknown): ThreadRetryRequest {
  if (typeof payload === "string" && payload.trim()) {
    return { threadId: payload.trim() };
  }
  if (typeof payload === "object" && payload !== null && "threadId" in payload) {
    const raw = payload as ThreadRetryRequest;
    if (typeof raw.threadId === "string" && raw.threadId.trim()) {
      const agentProfileId =
        (typeof raw.agentProfileId === "string" && raw.agentProfileId.trim()) ||
        (typeof raw.routeProfileId === "string" && raw.routeProfileId.trim()) ||
        undefined;
      return {
        threadId: raw.threadId.trim(),
        ...(agentProfileId ? { agentProfileId } : {}),
      };
    }
  }
  throw new Error("Thread id is required.");
}

function parseThreadFollowUpEnqueueRequest(payload: unknown): ThreadFollowUpEnqueueRequest {
  if (!isRecord(payload)) {
    throw new Error("Invalid follow-up payload.");
  }
  const threadId = readRequiredString(payload.threadId, "Thread id is required.");
  const attachments = parsePromptImageAttachments(payload.attachments);
  const prompt =
    readOptionalString(payload.prompt) || (attachments.length > 0 ? "请查看并分析我附上的图片。" : "");
  if (!prompt && attachments.length === 0) {
    throw new Error("Follow-up message is required.");
  }
  const priority = payload.priority === "escalated" ? "escalated" : "normal";
  return {
    threadId,
    prompt,
    ...(attachments.length > 0 ? { attachments } : {}),
    priority,
  };
}

function parseThreadFollowUpEscalateRequest(payload: unknown): ThreadFollowUpEscalateRequest {
  if (!isRecord(payload)) {
    throw new Error("Invalid follow-up escalation payload.");
  }
  const threadId = readRequiredString(payload.threadId, "Thread id is required.");
  const followUpId = readOptionalString(payload.followUpId);
  const attachments = parsePromptImageAttachments(payload.attachments);
  const prompt =
    readOptionalString(payload.prompt) || (attachments.length > 0 ? "请查看并分析我附上的图片。" : "");
  if (!followUpId && !prompt && attachments.length === 0) {
    throw new Error("Follow-up id or message is required.");
  }
  return {
    threadId,
    ...(followUpId ? { followUpId } : {}),
    ...(prompt ? { prompt } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
  };
}

function parseThreadFollowUpCancelRequest(payload: unknown): ThreadFollowUpCancelRequest {
  if (!isRecord(payload)) {
    throw new Error("Invalid follow-up cancel payload.");
  }
  return {
    threadId: readRequiredString(payload.threadId, "Thread id is required."),
    followUpId: readRequiredString(payload.followUpId, "Follow-up id is required."),
  };
}

function parseThreadFollowUpUpdateRequest(payload: unknown): ThreadFollowUpUpdateRequest {
  if (!isRecord(payload)) {
    throw new Error("Invalid follow-up update payload.");
  }
  const threadId = readRequiredString(payload.threadId, "Thread id is required.");
  const followUpId = readRequiredString(payload.followUpId, "Follow-up id is required.");
  const attachments = parsePromptImageAttachments(payload.attachments);
  const prompt =
    readOptionalString(payload.prompt) || (attachments.length > 0 ? "请查看并分析我附上的图片。" : "");
  if (!prompt && attachments.length === 0) {
    throw new Error("Follow-up message is required.");
  }
  return {
    threadId,
    followUpId,
    prompt,
    ...(attachments.length > 0 ? { attachments } : {}),
  };
}

function readRequiredString(value: unknown, message: string): string {
  const text = readOptionalString(value);
  if (!text) {
    throw new Error(message);
  }
  return text;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parsePromptImageAttachments(value: unknown): PromptImageAttachment[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const attachments: PromptImageAttachment[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      throw new Error("Invalid image attachment.");
    }
    if (!isPromptImageMediaType(entry.mediaType)) {
      throw new Error("Unsupported image attachment media type.");
    }
    const data = readRequiredString(entry.data, "Image attachment data is required.");
    attachments.push({ mediaType: entry.mediaType, data });
  }
  return attachments;
}

function isPromptImageMediaType(value: unknown): value is PromptImageAttachment["mediaType"] {
  return value === "image/jpeg" || value === "image/png" || value === "image/gif" || value === "image/webp";
}

function threadAcceptsLiveFollowUp(threadId: string, status: ThreadStatus): boolean {
  if (status === "running" || status === "queued" || status === "awaiting_plan") {
    return true;
  }
  return Boolean(getPendingClarificationForThread(threadId) || getPendingBashApprovalForThread(threadId));
}

function buildThreadFollowUpMutationResult(followUp: ThreadPendingFollowUp): ThreadFollowUpMutationResult {
  return {
    followUp,
    followUps: conversationStore.listThreadFollowUps(followUp.threadId),
  };
}

function emitThreadFollowUpEvent(followUp: ThreadPendingFollowUp, type: string, message: string): void {
  emitThreadEvent(followUp.threadId, type, message, "user", false, { followUp });
}

function formatFollowUpQueuedMessage(followUp: ThreadPendingFollowUp): string {
  if (followUp.priority === "escalated") {
    return "已记录后续消息，并标记为需要立即处理。";
  }
  return "";
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
  const routesOverride = resolveRoleRoutesForThread(threadId, request.agentProfileId);

  noteSdkSessionRouteChange(threadId, routesOverride);

  const runtimeConfig = resolveRuntimeConfigForThreadId(
    threadId,
    routesOverride,
    request.agentProfileId ? { requireCompleteCodingRoutes: true } : undefined,
  );
  if (!runtimeConfig.ok) {
    throw new Error(runtimeConfig.reason);
  }

  const pending = conversationStore.getPendingPlan(threadId);
  const prompt = thread.prompt.trim();
  if (!prompt) {
    throw new Error("没有可重试的需求内容。");
  }

  const retryLabel = request.agentProfileId
    ? (getAgentProfileById(settings, request.agentProfileId)?.name ?? "备用 Profile")
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
  } else if (threadPlanModeEnabled(threadId)) {
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
    onProxyAttributionSettled: ({ agentId, role }) => {
      usageLedgerCoordinator.settleProxyPendingForSubagentStart(threadId, { agentId, role });
    },
    onSubagentBillingStamp: ({ agentId, role, parentToolUseId, runAttemptId }) => {
      proxyBillingStampRegistry.register(threadId, {
        agentId,
        role,
        ...(parentToolUseId && { parentToolUseId }),
        ...(runAttemptId && { runAttemptId }),
      });
    },
    onSubagentBillingStampClear: ({ agentId }) => {
      proxyBillingStampRegistry.unregister(threadId, agentId);
    },
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
  const planModeEnabled = threadConfig?.planModeEnabled ?? workflowSettingsStore.get().planModeEnabled;
  return new ClaudeAgentSdkDriver({
    apiKey: proxy.apiKey,
    baseUrl: proxy.baseUrl,
    orchestration: orchestrationModeFromSnapshot({ planModeEnabled }),
    hookContext: {
      ...createThreadHookContext(threadId),
      ...buildSdkHookContextExtras(threadId, runPhase, hookContextExtras),
      resolveBashReviewMode: () => {
        const current = conversationStore.getThread(threadId);
        if (!current) {
          return "always";
        }
        return ensureThreadRuntimeConfig(current).runtimeConfig?.bashReviewMode ?? "always";
      },
      workspacePath: storedThread.workspacePath,
    },
    toolPermissionHandler: createThreadToolPermissionHandler(threadId, runPhase),
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

async function prepareThreadRewindForContinue(input: {
  threadId: string;
  prompt: string;
  workspace: WorkspaceInfo;
  target: ThreadActivityRewindTarget;
}): Promise<EcoSdkResumeOptions | undefined> {
  const storedTarget = conversationStore.getActivityRewindTarget(input.threadId, input.target.activityLineId);
  if (!storedTarget || storedTarget.userMessageId !== input.target.userMessageId) {
    throw new Error("该节点缺少 SDK 检查点，无法安全回滚。");
  }
  if (sdkSessionStore) {
    throw new Error("当前启用了 SessionStore/Redis 会话同步，SDK 文件检查点不可用，暂不支持回到节点。");
  }

  const session = conversationStore.getSdkSession(input.threadId);
  if (!session?.sessionId) {
    throw new Error("没有可恢复的 SDK 会话，无法回到该节点。");
  }
  const sessionCwd = normalizeSessionCwd(input.workspace.path, session.cwd);
  if (!existsSync(sessionCwd)) {
    throw new Error("SDK 会话工作目录不存在，无法回到该节点。");
  }

  const resumeSessionAt = await resolveResumeSessionAtBeforeUserMessage({
    sessionId: session.sessionId,
    userMessageId: storedTarget.userMessageId,
    dir: sessionCwd,
  });

  await withThreadSdkDriver(input.threadId, async (driver, _signal, routes) => {
    if (!driver.rewindSessionFiles) {
      throw new Error("Runtime driver does not support file checkpoint rewind.");
    }
    await driver.rewindSessionFiles(
      buildSdkRunInput({
        threadId: input.threadId,
        prompt: "",
        workspacePath: input.workspace.path,
        worktreePath: sessionCwd,
        routes: [...routes],
        signal: AbortSignal.timeout(120_000),
        sdkSession: await buildSdkSessionOptions(input.threadId, ""),
        agentRegistry: resolveAgentRuntimeConfigForThreadId(input.threadId),
        resume: { resumeSessionId: session.sessionId },
      }),
      storedTarget.userMessageId,
    );
  });

  const rewindSummary = conversationStore.rewindThreadToActivityLine(
    input.threadId,
    storedTarget.activityLineId,
  );
  conversationStore.clearThreadClaudePlanFilePath(input.threadId);
  const remainingActivity = conversationStore.listActivityLines(input.threadId);
  if (!remainingActivity.some((line) => line.role === "user")) {
    conversationStore.updateThreadPrompt(input.threadId, input.prompt);
  }
  if (!resumeSessionAt) {
    conversationStore.clearSdkSession(input.threadId);
  }
  clearThreadRuntimeMemory(input.threadId);
  emitTodoList(input.threadId, []);
  emitSubagentTimingUpdated(input.threadId);
  emitThreadRunProjectionUpdated(input.threadId);

  if (!resumeSessionAt) {
    return undefined;
  }
  return {
    resumeSessionId: session.sessionId,
    resumeSessionAt,
    forkSession: true,
  };
}

async function rebuildSdkSessionStore(_localDbPath: string): Promise<void> {
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

  sdkSessionStore = undefined;
  closeSdkSessionStore = undefined;
  process.stderr.write(`[eco] SessionStore: disabled (SDK file checkpointing enabled)\n`);
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
      conversationStore.bindLatestUserActivityToSdkMessage(
        threadId,
        (payload as { userMessageId: string }).userMessageId,
      );
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
  const planFilePath = conversationStore.getThreadClaudePlanFilePath(threadId);
  if (!planFilePath) {
    return false;
  }
  const planText = await readClaudePlanFile(workspacePath, planFilePath);
  if (!planText) {
    return false;
  }
  const thread = conversationStore.getThread(threadId);
  conversationStore.savePendingPlan({
    threadId,
    userPrompt: thread?.prompt.trim() || "",
    analysis: "",
    plan: planText,
    workspacePath,
    worktreePath,
    routesJson,
    planFilePath,
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
      ...(pending.planFilePath ? { planFilePath: pending.planFilePath } : {}),
    };
  }
  const planFilePath = conversationStore.getThreadClaudePlanFilePath(threadId);
  if (!planFilePath) {
    return undefined;
  }
  const planText = await readClaudePlanFile(workspacePath, planFilePath);
  if (!planText) {
    return undefined;
  }
  const thread = conversationStore.getThread(threadId);
  return {
    userPrompt: thread?.prompt.trim() || "",
    analysis: "",
    plan: planText,
    planFilePath,
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
  resumeOverride?: EcoSdkResumeOptions;
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
    resumeOverride,
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
      ...(resumeOverride && { resume: resumeOverride }),
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
      action.resume ? (resumeOverride ?? resolveResumeOptions(threadId, cwd)) : undefined,
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
      if (!threadPlanModeEnabled(threadId) && action.phase !== "question") {
        await runCodingThreadAutonomous(
          updated,
          workspace,
          runtimeConfig,
          agentPrompt,
          existingWorktreePlan,
          resumeOverride ?? resolveResumeOptions(threadId, cwd),
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
        resumeOverride,
      );
    })();
    return;
  }

  if (action.kind === "fresh_autonomous") {
    conversationStore.clearSubagentSessions(threadId);
    subagentMetricsRegistry.clearThread(threadId);
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
    return;
  }

  if (action.kind === "revise_plan" || action.kind === "fresh_plan") {
    if (action.kind === "fresh_plan") {
      conversationStore.clearSubagentSessions(threadId);
      subagentMetricsRegistry.clearThread(threadId);
    }
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
  resumeOverride?: EcoSdkResumeOptions,
): Promise<void> {
  if (!threadPlanModeEnabled(thread.id) && mode !== "question") {
    const controller = new AbortController();
    startActiveRun(thread.id, {
      controller,
      worktreePlan: existingWorktreePlan ?? createSessionPlan(workspace.path, thread.id),
    });
    resetSubagentContextWindows(thread.id);
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
      const resolved = await resolveThreadWorktree(workspace, thread.id, existingWorktreePlan);
      worktreePlan = resolved.worktreePlan;
      cwd = resolved.cwd;
      activeRunRuntimeState.setWorktreePlan(thread.id, worktreePlan);
      const resumeOpts = resumeOverride ?? resolveResumeOptions(thread.id, cwd);
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
              const driver = createSdkDriver(
                thread.id,
                attemptProxy,
                taskRunHooks?.hookContextExtras,
                "execution",
              );
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
                onEvent: (event) => {
                  taskRuntime?.handleEvent(event);
                },
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
            taskRunHooks?.stopIfUnhandled("cancelled");
            await handleRunCancelled(thread.id, worktreePlan);
          },
          onFailed: (reason) => {
            taskRunHooks?.stopIfUnhandled("blocked");
            markThreadInterrupted(thread.id, reason);
          },
        })
      ) {
        return;
      }
      taskRunHooks?.stopIfUnhandled("completed");
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

    const resumeOptsForContinuation = resumeOverride ?? resolveResumeOptions(thread.id, cwd);

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
                sdkSession: await buildSdkSessionOptions(thread.id, followUp, {
                  skillsScope: mode === "planning" ? "planning" : "default",
                }),
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
  const registryStamp = proxyBillingStampRegistry.resolveForRoute(info.threadId, info.role);
  const stampedAgentId = info.stampedAgentId ?? registryStamp?.agentId;
  const stampedBillingRole = info.stampedBillingRole ?? registryStamp?.billingRole;
  const stampedParentToolUseId = info.stampedParentToolUseId ?? registryStamp?.parentToolUseId;
  const resolved = resolveProxyUsageBilling({
    info,
    ...(currentRequestSeq !== undefined && { currentRequestSeq }),
    ...(runAttemptId && { runAttemptId }),
    ...(plannerAgentId && { plannerAgentId }),
    resolver: subagentMetricsRegistry,
    ...(stampedAgentId ? { stampedAgentId } : {}),
    ...(stampedBillingRole ? { stampedBillingRole } : {}),
    ...(stampedParentToolUseId ? { stampedParentToolUseId } : {}),
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

async function compactThreadContextManual(threadId: string): Promise<ThreadCompactContextResult> {
  const worktreePath = resolveThreadWorktreePath(threadId);
  if (!worktreePath) {
    return { ok: false, message: "工作区未就绪，无法压缩上下文。" };
  }

  const sdkSession = conversationStore.getSdkSession(threadId);
  if (!sdkSession?.sessionId) {
    return { ok: false, message: "尚无会话，无法压缩上下文。" };
  }

  if (!contextMonitor.beginCompactIfIdle(threadId)) {
    return { ok: false, message: "上下文正在压缩中，请稍候。" };
  }

  try {
    archiveThreadContextBeforeCompaction(threadId, "manual", sdkSession.sessionId);

    const roleRoutes = resolveRoleRoutesForThread(threadId);
    const runtimeConfig = resolveRuntimeConfigForThreadId(threadId, roleRoutes);
    if (!runtimeConfig.ok) {
      contextMonitor.clearCompactInFlight(threadId);
      return { ok: false, message: runtimeConfig.reason };
    }

    const routes = buildDriverRoutesFromRuntime(runtimeConfig.routes);
    const result = await contextScheduler.compactManual(
      threadId,
      routes,
      worktreePath,
      new AbortController().signal,
    );
    if (!result.ok) {
      contextMonitor.clearCompactInFlight(threadId);
      return { ok: false, message: formatManualCompactFailureMessage(result.reason) };
    }
    return { ok: true, message: "上下文已手动压缩" };
  } catch (error) {
    contextMonitor.clearCompactInFlight(threadId);
    throw error;
  }
}

function formatManualCompactFailureMessage(reason: string): string {
  switch (reason) {
    case "thread_running":
      return "线程正在运行，请结束后再压缩上下文。";
    case "compact_in_flight":
      return "上下文正在压缩中，请稍候。";
    case "worktree_not_ready":
      return "工作区未就绪，无法压缩上下文。";
    case "no_session":
      return "尚无会话，无法压缩上下文。";
    default:
      return reason ? `上下文压缩失败：${reason}` : "上下文压缩失败";
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

async function buildSdkSessionOptions(
  threadId: string,
  prompt?: string,
  options?: { skillsScope?: SdkSessionSkillsScope },
): Promise<EcoSdkSessionOptions> {
  const mcp = mcpStore.buildSdkConfig();
  const thread = conversationStore.getThread(threadId);
  const hydrated = thread ? ensureThreadRuntimeConfig(thread) : undefined;
  const settings = getModelSettingsSnapshot();
  const profile = hydrated?.runtimeConfig
    ? resolveThreadAgentProfile(settings, hydrated.runtimeConfig)
    : undefined;
  const assignedMcpServers = profile
    ? collectProfileAssignedMcpServers(profile, settings.agentTemplates)
    : [];
  const filteredMcp = filterMcpSdkConfigByAssignedServers(mcp, assignedMcpServers);
  const enabledSubagents = hydrated?.runtimeConfig?.subagentEnabled ?? defaultSubagentAvailability();
  const workspacePath =
    thread?.workspacePath ??
    (currentWorkspace?.path && currentWorkspace.path.trim() ? currentWorkspace.path : undefined);
  const discovered = await listDiscoveredSkills(workspacePath);
  const projectNames = listSdkReadyProjectSkills(discovered.projectSkills).map((skill) => skill.name);
  const explicitUser = filterExplicitUserSkillNames(prompt, discovered.userSkills);
  const explicitUserNames = new Set(explicitUser);
  const explicitUserSkills = discovered.userSkills.filter(
    (skill) => skill.sdkReady && explicitUserNames.has(skill.name),
  );
  const projectReadRootSkills = discovered.projectSkills.filter((skill) => skill.sdkReady);
  const implicitReadAllowRoots = resolveImplicitSkillReadRoots(os.homedir(), workspacePath, [
    ...projectReadRootSkills,
    ...explicitUserSkills,
  ]);
  const skillConfig = resolveSdkSessionSkillConfig(options?.skillsScope ?? "default", {
    projectNames,
    explicitUser,
  });
  const agentSkills = buildRuntimeAgentSkillAssignments(skillConfig.skills, profile);
  return {
    settingSources: skillConfig.settingSources,
    ...(skillConfig.skills.length > 0 ? { skills: skillConfig.skills } : {}),
    ...(implicitReadAllowRoots.length > 0 ? { implicitReadAllowRoots } : {}),
    agentSkills,
    enabledSubagents,
    ...(Object.keys(filteredMcp.mcpServers).length > 0 ? { mcpServers: filteredMcp.mcpServers } : {}),
    ...(filteredMcp.allowedTools.length > 0 ? { mcpAllowedTools: filteredMcp.allowedTools } : {}),
  };
}

function isPlanReadyPayload(payload: unknown): payload is PlanReadyPayload {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }
  const candidate = payload as PlanReadyPayload;
  return (
    typeof candidate.userPrompt === "string" &&
    typeof candidate.analysis === "string" &&
    typeof candidate.plan === "string" &&
    (candidate.planFilePath === undefined || typeof candidate.planFilePath === "string")
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

function patchThreadSummary(threadId: string, patch: Pick<ThreadSummary, "message" | "status">): void {
  if (!conversationStore.getThread(threadId)) {
    return;
  }

  const message = normalizeThreadMessage(patch.status, patch.message);
  conversationStore.updateThread(threadId, { ...patch, message });
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
  followUp?: ThreadLiveEvent["followUp"];
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
  runtimeConfig?: ThreadRuntimeConfig;
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
): ThreadActivityLine | undefined {
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
    !extras?.followUp &&
    !extras?.subagentSessions?.length &&
    !isThreadStatusEvent &&
    !isUsageEvent &&
    !isContextEvent &&
    !isSubagentTimingEvent
  ) {
    return undefined;
  }

  const isSilentFollowUpEvent = type.startsWith("thread.follow_up.");
  const displayMessage = isSilentFollowUpEvent ? "" : trimmed || (isThreadStatusEvent ? "状态已更新" : "");

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

  if (!isMetricsOnlyThreadLiveEvent(type)) {
    recordThreadRunEventFromLiveEvent({
      threadId,
      type,
      displayMessage,
      role: String(role),
      stream,
      ...(extras && { extras }),
      ...(persistedActivityLine && { persistedActivityLine }),
    });
  }

  if (type.startsWith("bash_approval.")) {
    const thread = conversationStore.getThread(threadId);
    if (thread) {
      patchThreadSummary(threadId, {
        message: displayMessage,
        status: type === "bash_approval.requested" ? "running" : thread.status,
      });
    }
  }

  const payload: ThreadLiveEvent = {
    threadId,
    type,
    message: isSilentFollowUpEvent ? "" : displayMessage || (extras?.plan ? "计划已就绪" : "状态已更新"),
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
  if (extras?.followUp) {
    payload.followUp = extras.followUp;
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
  if (extras?.runtimeConfig) {
    payload.runtimeConfig = extras.runtimeConfig;
  }

  desktopEventCenter.publishThreadLiveEvent(payload);
  return persistedActivityLine;
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
  const bashApproval =
    input.extras?.bashApproval &&
    buildBashApprovalRunMetadataFromRequest(input.type, input.extras.bashApproval);
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
    ...(bashApproval && { bashApproval }),
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

function resolveThreadFollowUpEnqueueMetadata(threadId: string): {
  sourceRunAttemptId?: string;
  queuedDuringPhase?: ThreadFollowUpRunPhase;
} {
  const sourceRunAttemptId = resolveCurrentRunAttemptId(threadId);
  const phase = sourceRunAttemptId ? resolveRunAttemptPhase(threadId, sourceRunAttemptId) : undefined;
  return {
    ...(sourceRunAttemptId ? { sourceRunAttemptId } : {}),
    ...(phase ? { queuedDuringPhase: phase } : {}),
  };
}

function resolveRunAttemptPhase(threadId: string, attemptId: string): ThreadFollowUpRunPhase | undefined {
  const phase = conversationStore
    .listRunAttempts(threadId)
    .find((attempt) => attempt.attemptId === attemptId)?.phase;
  return isThreadFollowUpRunPhase(phase) ? phase : undefined;
}

function isThreadFollowUpRunPhase(value: unknown): value is ThreadFollowUpRunPhase {
  return value === "planning" || value === "execution" || value === "question" || value === "continuation";
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
  desktopEventCenter.publishThreadLiveEvent(payload);
}

function recordUserPrompt(threadId: string, prompt: string): ThreadActivityLine | undefined {
  return emitThreadEvent(threadId, "thread.user_prompt", prompt, "user");
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

function resolveBashApprovalPhase(liveType: string): ThreadRunBashApprovalPhase | undefined {
  if (liveType === "bash_approval.requested") {
    return "requested";
  }
  if (liveType === "bash_approval.approved") {
    return "approved";
  }
  if (liveType === "bash_approval.rejected") {
    return "rejected";
  }
  if (liveType === "bash_approval.denied") {
    return "denied";
  }
  return undefined;
}

function buildBashApprovalRunMetadataFromRequest(
  liveType: string,
  request: BashApprovalRequest,
): ThreadRunBashApprovalMetadata | undefined {
  const phase = resolveBashApprovalPhase(liveType);
  if (!phase) {
    return undefined;
  }
  const toolName = request.filesystemTool ?? "Bash";
  const detail = request.filesystemPath ?? request.command;
  return {
    toolUseId: request.toolUseId,
    phase,
    toolName,
    ...(detail.trim() && { detail: detail.trim() }),
  };
}

function createThreadToolPermissionHandler(
  threadId: string,
  runPhase: SubagentRunPhase = "execution",
): (request: SdkToolPermissionRequest) => Promise<SdkToolPermissionDecision> {
  return async (request) => {
    if (isReadFilesystemTool(request.toolName)) {
      const thread = conversationStore.getThread(threadId);
      if (!thread) {
        return {
          behavior: "deny",
          message: "Thread was not found; Eco could not request filesystem read approval.",
          interrupt: true,
        };
      }

      const worktreePlan = activeRunRuntimeState.worktreePlan(threadId);
      const cwd = request.cwd?.trim() || worktreePlan?.worktreePath || thread.sdkCwd || thread.workspacePath;
      const readApproval = resolveFilesystemReadApprovalRequest({
        toolName: request.toolName,
        input: request.input,
        cwd: cwd ?? thread.workspacePath ?? ".",
        workspacePath: thread.workspacePath,
        ...(request.decisionReason ? { fallbackReason: request.decisionReason } : {}),
      });
      if (!readApproval) {
        return { behavior: "allow", updatedInput: request.input };
      }
      const filesystemPath = readApproval.filesystemPath;

      const approvalRequest: BashApprovalRequest = {
        toolUseId: request.toolUseId,
        threadId,
        command: `${request.toolName} ${filesystemPath}`,
        cwd,
        reason: readApproval.reason,
        riskScore: 40,
        riskLevel: "medium",
        filesystemTool: request.toolName,
        filesystemPath,
        ...(request.agentId ? { agentId: request.agentId } : {}),
        ...(request.agentType ? { agentType: request.agentType } : {}),
        description: `允许在工作区外执行 ${request.toolName}？`,
      };

      emitThreadEvent(
        threadId,
        "bash_approval.requested",
        `等待确认 ${request.toolName}：${filesystemPath}`,
        "tool",
        false,
        { bashApproval: approvalRequest },
      );

      const decision = await registerPendingBashApproval(threadId, approvalRequest);
      if (decision === "approved") {
        emitThreadEvent(
          threadId,
          "bash_approval.approved",
          `已允许本次 ${request.toolName}：${filesystemPath}`,
          "tool",
          false,
          { bashApproval: approvalRequest },
        );
        return { behavior: "allow", updatedInput: request.input };
      }

      emitThreadEvent(
        threadId,
        "bash_approval.rejected",
        `已拒绝 ${request.toolName}：${filesystemPath}`,
        "tool",
        false,
        { bashApproval: approvalRequest },
      );
      return {
        behavior: "deny",
        message: `User denied this ${request.toolName} call.`,
        interrupt: false,
      };
    }

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
    const runtimeConfig = ensureThreadRuntimeConfig(thread).runtimeConfig;
    const agentRegistry = resolveAgentRuntimeConfigForThread(thread);
    const policy = evaluateThreadBashPermission({
      command,
      cwd,
      workspacePath: thread.workspacePath,
      bashReviewMode: runtimeConfig?.bashReviewMode ?? "always",
      phaseAllowsBash: runPhase !== "planning" && runPhase !== "question",
      ...(agentRegistry ? { agentRegistry } : {}),
      ...(request.agentId ? { agentId: request.agentId } : {}),
      ...(request.agentType ? { agentType: request.agentType } : {}),
    });
    if (policy.action === "deny") {
      const deniedApproval: BashApprovalRequest = {
        toolUseId: request.toolUseId,
        threadId,
        command,
        cwd: cwd ?? thread.workspacePath ?? ".",
        reason: policy.reason,
        riskScore: policy.riskScore,
        riskLevel: policy.riskLevel,
        ...(request.agentId ? { agentId: request.agentId } : {}),
        ...(request.agentType ? { agentType: request.agentType } : {}),
      };
      emitThreadEvent(threadId, "bash_approval.denied", `Bash 已拒绝：${policy.reason}`, "tool", false, {
        bashApproval: deniedApproval,
      });
      return {
        behavior: "deny",
        message: policy.reason,
        interrupt: false,
      };
    }
    if (policy.action === "allow") {
      return { behavior: "allow", updatedInput: request.input };
    }

    const description = readBashDescriptionInput(request.input);
    const approvalRequest: BashApprovalRequest = {
      toolUseId: request.toolUseId,
      threadId,
      command,
      cwd,
      reason: policy.reason,
      riskScore: policy.riskScore,
      riskLevel: policy.riskLevel,
      ...(request.agentId ? { agentId: request.agentId } : {}),
      ...(request.agentType ? { agentType: request.agentType } : {}),
      ...(description ? { description } : {}),
    };

    emitThreadEvent(threadId, "bash_approval.requested", `等待确认 Bash：${command}`, "tool", false, {
      bashApproval: approvalRequest,
    });

    const decision = await registerPendingBashApproval(threadId, approvalRequest);
    if (decision === "approved") {
      emitThreadEvent(threadId, "bash_approval.approved", `已允许本次 Bash：${command}`, "tool", false, {
        bashApproval: approvalRequest,
      });
      return { behavior: "allow", updatedInput: request.input };
    }

    emitThreadEvent(threadId, "bash_approval.rejected", `已拒绝 Bash：${command}`, "tool", false, {
      bashApproval: approvalRequest,
    });
    return {
      behavior: "deny",
      message: "User denied this Bash command.",
      interrupt: false,
    };
  };
}

function resolveFilesystemReadApprovalRequest(input: {
  toolName: string;
  input: Record<string, unknown>;
  cwd: string;
  workspacePath: string;
  fallbackReason?: string;
}): { filesystemPath: string; reason: string } | undefined {
  const scopeRoot = resolveFilesystemScopeRoot(input.workspacePath, input.cwd);
  const filesystemPath = readFilesystemPath(input.input, input.toolName) ?? ".";
  if (filesystemPath === ".") {
    const cwdInsideScope = isPathInsidePolicyScope(resolvePolicyPath(".", input.cwd), scopeRoot);
    if (isDiscoveryFilesystemTool(input.toolName) && !cwdInsideScope) {
      return {
        filesystemPath,
        reason:
          input.fallbackReason ?? filesystemReadScopeAskReason(input.toolName, filesystemPath, scopeRoot),
      };
    }
    return undefined;
  }

  const candidatePath =
    isDiscoveryFilesystemTool(input.toolName) && pathContainsGlobMeta(filesystemPath)
      ? resolvePolicySearchBase(filesystemPath, input.cwd)
      : resolvePolicyPath(filesystemPath, input.cwd);
  if (isPathInsidePolicyScope(candidatePath, scopeRoot)) {
    return undefined;
  }

  return {
    filesystemPath,
    reason: input.fallbackReason ?? filesystemReadScopeAskReason(input.toolName, filesystemPath, scopeRoot),
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
  desktopEventCenter.publishSettingsUpdated({
    threadId: "settings",
    type: "settings.updated",
    message: "Model provider settings saved.",
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
  // SDK already emits request.started via system status "requesting"; proxy hook is opt-in only.
  const emitRequestActivity = proxyThreadOptions?.emitRequestActivity === true;
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

async function resolveCandidateModels(
  pricingCache: ModelsDevPricingCache,
  candidates: CandidateModelView[],
  baseUrl: string,
): Promise<CandidateModelView[]> {
  return Promise.all(
    candidates.map(async (candidate) => {
      const lookupInput = {
        baseUrl,
        modelId: candidate.modelId,
        ...(candidate.modelsDevMapping && { mapping: candidate.modelsDevMapping }),
      };
      const [pricingLookup, limitsLookup, capabilitiesLookup] = await Promise.all([
        pricingCache.lookupForRoute(lookupInput),
        pricingCache.lookupLimitsForRoute(lookupInput),
        pricingCache.lookupCapabilitiesForRoute(lookupInput),
      ]);
      const view: CandidateModelView = { ...candidate };
      const manual = candidate.manualSpec;
      if (limitsLookup) {
        view.resolvedContextTokens = manual?.contextTokens ?? limitsLookup.limits.contextTokens;
        const maxOut = manual?.maxOutputTokens ?? limitsLookup.limits.maxOutputTokens;
        if (maxOut !== undefined) view.resolvedMaxOutputTokens = maxOut;
      } else {
        if (manual?.contextTokens !== undefined) view.resolvedContextTokens = manual.contextTokens;
        if (manual?.maxOutputTokens !== undefined) view.resolvedMaxOutputTokens = manual.maxOutputTokens;
      }
      if (capabilitiesLookup) {
        view.resolvedSupportsImageInput =
          manual?.supportsImageInput ?? capabilitiesLookup.capabilities.supportsImageInput;
        view.resolvedSupportsReasoning =
          manual?.supportsReasoning ?? capabilitiesLookup.capabilities.supportsReasoning;
      } else {
        if (manual?.supportsImageInput !== undefined)
          view.resolvedSupportsImageInput = manual.supportsImageInput;
        if (manual?.supportsReasoning !== undefined)
          view.resolvedSupportsReasoning = manual.supportsReasoning;
      }
      if (pricingLookup) {
        view.resolvedInputPerM = manual?.inputPerM ?? pricingLookup.rates.input;
        view.resolvedOutputPerM = manual?.outputPerM ?? pricingLookup.rates.output;
        if (pricingLookup.rates.cacheRead !== undefined) {
          view.resolvedCacheReadPerM = manual?.cacheReadPerM ?? pricingLookup.rates.cacheRead;
        } else if (manual?.cacheReadPerM !== undefined) {
          view.resolvedCacheReadPerM = manual.cacheReadPerM;
        }
        if (pricingLookup.rates.cacheWrite !== undefined) {
          view.resolvedCacheWritePerM = manual?.cacheWritePerM ?? pricingLookup.rates.cacheWrite;
        } else if (manual?.cacheWritePerM !== undefined) {
          view.resolvedCacheWritePerM = manual.cacheWritePerM;
        }
        if (pricingLookup.displayName !== undefined) view.modelsDevLabel = pricingLookup.displayName;
      } else {
        if (manual?.inputPerM !== undefined) view.resolvedInputPerM = manual.inputPerM;
        if (manual?.outputPerM !== undefined) view.resolvedOutputPerM = manual.outputPerM;
        if (manual?.cacheReadPerM !== undefined) view.resolvedCacheReadPerM = manual.cacheReadPerM;
        if (manual?.cacheWritePerM !== undefined) view.resolvedCacheWritePerM = manual.cacheWritePerM;
      }
      return view;
    }),
  );
}
