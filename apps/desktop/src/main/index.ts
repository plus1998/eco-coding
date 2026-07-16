import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ResolvedModelRoute } from "@eco/model-router";
import {
  type AgentEvent,
  type CoreKind,
  composeCanUseToolHandlers,
  createAskUserQuestionHandler,
  defaultSubagentAvailability,
  type EcoAgentRuntimeConfig,
  type EcoPlanningContext,
  type EcoSdkResumeOptions,
  type EcoSdkSessionOptions,
  type EcoSubagentAttributionHooks,
  evaluateFilesystemReadConfirmation,
  evaluateFilesystemWriteConfirmation,
  isReadFilesystemTool,
  isWriteFilesystemTool,
  isCoreKind,
  normalizeSdkSubagentType,
  type PlanReadyPayload,
  readFilesystemPath,
  SDK_GENERAL_PURPOSE_AGENT_KEY,
  SDK_PLAN_AGENT_KEY,
  type SdkAskUserQuestionRequest,
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
import {
  type CommandRunner,
  createSessionPlan,
  GitWorktreeService,
  isDirectWorkspacePlan,
  type WorktreePlan,
} from "@eco/workspace";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  type NativeImage,
  nativeImage,
  nativeTheme,
  Notification,
  safeStorage,
  shell,
} from "electron";
import { ensureDesktopPath } from "./fix-desktop-path";
import { evaluateThreadToolConfirmation } from "./thread-bash-permission";
import {
  readElectronResourcesPath,
  resolvePackagedClaudeExecutableCandidate,
} from "./packaged-runtime-executables";

ensureDesktopPath();

import { buildAgentProfileArchive, parseAgentProfileArchiveBundle } from "../shared/agent-profile-archive";
import { buildAgentTemplateArchive, parseAgentTemplateArchive } from "../shared/agent-template-archive";
import {
  buildThreadApprovalNotificationContent,
  buildThreadCompletionNotificationContent,
} from "../shared/thread-completion-notification";
import { resolveUpstreamApiCompat, type UpstreamApiCompat } from "../shared/api-compat";
import {
  deriveBashApprovalRememberPrefix,
  formatBashApprovalDenyMessage,
  formatFilesystemApprovalDenyMessage,
} from "../shared/bash-approval-ui";
import { enrichBillingDisplaySource } from "../shared/billing-display-source";
import { listEnabledGlobalMcpServerKeys } from "../shared/composer-mcp";
import {
  PROMPT_IMAGE_PREVIEWS_METADATA_KEY,
  type PromptImagePreview,
} from "../shared/prompt-image-metadata";
import {
  BUILTIN_VISION_AGENT_ROLE,
  buildPromptWithVisionAnalysis,
  buildVisionAnalysisRequestBody,
  readVisionAnalysisResponse,
} from "../shared/prompt-image-vision";
import { buildEcoCompactHandoffPrompt } from "../shared/eco-compact-handoff";
import {
  type AgentRole,
  type AgentTemplate,
  type AgentTemplateExportRequest,
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
  IPC_CHANNELS,
  type IpcChannel,
  isBackgroundTerminalListRequest,
  isBackgroundTerminalOpenRequest,
  isBackgroundTerminalStartRequest,
  isBackgroundTerminalStopRequest,
  isBashReviewModeOnlyRuntimeConfigUpdate,
  isGitCommitRequest,
  isGitGenerateCommitMessageRequest,
  isGitListCommitsRequest,
  isGitPullRequest,
  isGitPushRequest,
  isKnownIpcChannel,
  isRunPackageScriptRequest,
  isSavePackageScriptArgsRequest,
  isTerminalInputRequest,
  isTerminalKillRequest,
  isTerminalListRequest,
  isTerminalResizeRequest,
  isTerminalSpawnRequest,
  isThreadRuntimeConfig,
  type ListUpstreamModelsRequest,
  type McpServerConfigInput,
  type ModelSettingsSnapshot,
  normalizeThreadRuntimeConfig,
  type OrchestrationProfile,
  type OrchestrationProfileExportRequest,
  type PlanApprovalRequest,
  type PromptImageAttachment,
  type ProviderConfigInput,
  type RouteManualSpec,
  type RouteProfileInput,
  type RuntimeAgentRole,
  type RuntimeRoleRouteConfig,
  resolveMainAgentSystemPromptPreset,
  resolveSessionMode,
  resolveThreadAgentProfile,
  resolveThreadRuntimeMcpServerKeys,
  runtimeRoleRoutesFromAgentProfile,
  SUBAGENT_ROLES,
  type TerminalListRequest,
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
  type ThreadRevertAppliedDiffResult,
  type ThreadRewindCheckpointRequest,
  type ThreadRewindCheckpointResult,
  type ThreadRollbackResult,
  type ThreadRunBashApprovalMetadata,
  type ThreadRunBashApprovalPhase,
  type ThreadRunEvent,
  type ThreadRunEventScope,
  type ThreadRunProjectionSnapshot,
  type ThreadRunToolMetadata,
  type ThreadRuntimeConfig,
  type ThreadRuntimeConfigInput,
  type ThreadSessionBootstrapResult,
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
  withAgentSessionMode,
} from "../shared/ipc";
import { buildCodexMcpServersForConfigSync, filterMcpSdkConfigByAssignedServers } from "../shared/mcp";
import { parseThreadApprovePlanPayload } from "../shared/plan-approval";
import {
  buildMainAgentModelKey,
  diffPromptCacheRuntimeSignatures,
  resolveMainAgentModelKey,
  resolvePromptCacheProfileLabel,
  resolvePromptCacheRuntimeSignature,
} from "../shared/prompt-cache-config";
import { computeRouteFingerprint, routesMatchFingerprint } from "../shared/route-fingerprint";
import { resolveImplicitSkillReadRoots } from "../shared/skill-paths";
import {
  buildRuntimeAgentSkillAssignments,
  type LinkAgentsSkillsRequest,
  listSdkReadyProjectSkills,
  resolveExplicitCodexSkillInputs,
  resolveSdkSessionSkillConfig,
  type SdkSessionSkillsScope,
  type SkillInfo,
  type SkillUninstallRequest,
  type SkillCatalogInstallRequest,
  type SkillCatalogSearchRequest,
} from "../shared/skills";
import {
  activityLinesBeforeRewindTarget,
  buildAgentPromptWithContext,
  continueStatusMessage,
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
  shouldBlockThreadFollowUpDrain,
  shouldDrainThreadFollowUps,
} from "../shared/thread-follow-up-drain";
import {
  buildWorktreeMergeSummary,
  formatWorktreeMergeThreadMessage,
  serializeWorktreeMergeMessage,
} from "../shared/worktree-merge";
import { ActiveRunBillingStateStore } from "./active-run-billing-state";
import { type ActiveRunRuntimeStateInput, ActiveRunRuntimeStateStore } from "./active-run-runtime-state";
import { activityStreamKey, resolveActivityAgentId } from "./activity-agent-id";
import { AgentLifecycleService } from "./agent-lifecycle-service";
import { type AgentOrchestrationStore, createAgentOrchestrationStore } from "./agent-orchestration-store";
import { mergeAgentRegistrySettings } from "./agent-registry-settings";
import {
  type AnthropicProxyRoute,
  type AnthropicProxyStartOptions,
  type AnthropicProxyUsageHandler,
  type AnthropicProxyUsageInfo,
  runtimeRouteToProxyRoute,
  startAnthropicModelProxy,
} from "./anthropic-proxy";
import { BackgroundTerminalTaskRegistry } from "./background-terminal-tasks";
import { resolveBashApprovalAgentId } from "./bash-approval-agent-id.js";
import {
  type BashApprovalResolution,
  cancelBashApprovalsForThread,
  getPendingBashApprovalByToolUseId,
  getPendingBashApprovalForThread,
  registerPendingBashApproval,
  resolvePendingBashApproval,
} from "./bash-approval-bridge";
import type { UsageBillingObservation } from "./billing-orchestration";
import {
  lookupRouteCapabilityHints,
  lookupRoutePricingHints,
  type RuntimeRoute,
  resolveRatesForRoute,
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
import { CenterServerDesktopClient } from "./center-server-client";
import {
  createCenterServerStore,
  createElectronSafeStorageCenterServerSecretCodec,
} from "./center-server-store";
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
import { ContextWindowMonitor, MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES } from "./context-window-monitor";
import { type ConversationStore, createConversationStore } from "./conversation-store";
import { ConversationStoreCodexThreadMap } from "./conversation-store-codex-thread-map";
import { type CodexThreadMap, resolveCodexThreadAttribution } from "./codex-thread-map";
import {
  CodexGatewayUsageDeduplicator,
  resolveCodexGatewayUsageBilling,
} from "./codex-gateway-usage-billing";
import { CodexGatewayUsagePendingBuffer } from "./codex-gateway-usage-pending";
import { CodexFileCheckpointStore } from "./codex-file-checkpoints";
import { applyCodexSubagentLifecycleEvent } from "./codex-subagent-lifecycle";
import {
  configureCodexApprovalBridge,
  configureCodexRuntimeRun,
  compactCodexThreadForEcoThread,
  createCodexRuntimeDriver,
  isCodexCliAvailable,
  registerResolvedCodexGatewayTurnRoute,
  rollbackCodexThreadForEcoThread,
  runThreadRequestWithRuntimeProxy as runCodexThreadRequest,
} from "./codex-runtime-run";
import { stopGlobalCodexRuntimeLifecycle } from "./codex-runtime-lifecycle";
import { configureEcoGatewayLifecycle, stopGlobalEcoGateway } from "./eco-gateway-lifecycle";
import { createEcoCompactService, type EcoCompactService } from "./eco-compact-service";
import { logEcoDiag, logEcoDiagThrottled, shortAgentId, shortThreadId } from "./eco-diag-log";
import { createElectronEventSink, DesktopEventCenter } from "./event-center";
import { GitAutoFetcher } from "./git-autofetch";
import {
  checkoutGitBranch,
  createGitBranch,
  discardWorkspaceChanges,
  getGitWorkingTreeStatus,
  getWorkspaceDiff,
  handleGitCommit,
  handleGitGenerateCommitMessage,
  handleGitListCommitModelOptions,
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
import { InteractiveTerminalManager } from "./interactive-terminal-manager";
import { checkMcpServerConnection } from "./mcp-checker";
import { prepareCodexMcpServersForRuntime, prepareMcpSdkConfigForRuntime } from "./mcp-runtime";
import { createMcpStore, type McpStore } from "./mcp-store";
import { ModelsDevPricingCache } from "./models-dev-pricing-cache";
import { PackageJsonWatcher } from "./package-json-watcher";
import {
  listPackageScripts,
  preparePackageScriptRun,
  runPreparedPackageScriptAsBackgroundTask,
} from "./package-scripts";
import { createPackageScriptArgsStore, type PackageScriptArgsStore } from "./package-script-args-store";
import {
  cancelPlanApprovalsForThread,
  getPendingPlanApprovalForThread,
  getPendingPlanApprovalWaitForThread,
  registerPendingPlanApproval,
  resolvePendingPlanApproval,
} from "./plan-approval-bridge";
import { formatPromptCacheBreakLog, resolveClaudeMdDigest } from "./prompt-cache-fingerprint";
import { createPromptCacheRunEventEmitter } from "./prompt-cache-run-events";
import { listProviderUpstreamModels, testProviderConnection, testRoleRoutes } from "./provider-models";
import { createProviderStore, type ProviderStore } from "./provider-store";
import { reconcileProxyAttributionContexts } from "./proxy-attribution-context-reconciliation";
import { ProxyBillingStampRegistry } from "./proxy-billing-stamp";
import {
  createProxyBridgeSettingsStore,
  isProxyBridgeSettingsSnapshot,
  normalizeProxyBridgeSettingsSnapshot,
  type ProxyBridgeSettingsStore,
  resolveUpstreamUserAgentOverride,
} from "./proxy-bridge-settings-store";
import { resolveProxyUsageBilling } from "./proxy-usage-billing";
import { formatUserFacingRequestError, type RequestAttemptResult } from "./request-retry";
import { resolveCommandExecutable, toSpawnEnv } from "./resolve-command-executable";
import { reconcileSdkAgentTerminalEvent } from "./sdk-agent-terminal-reconciliation";
import type { resolveSdkEventUsageBilling, SdkRunUsageBillingInput } from "./sdk-event-usage-billing";
import { resolveSdkRunBillingResolution } from "./sdk-run-billing-resolution";
import { prepareSdkRunContextAfterCompaction } from "./sdk-run-context-compaction";
import { consumeSdkRunEvents } from "./sdk-run-event-loop";
import { buildSdkRunInput, sdkRunPhaseFromMode } from "./sdk-run-input";
import {
  listSdkSessionActivityLines,
  listSdkSessionCompactionActivityLines,
  listSdkSubagentActivityLines,
} from "./sdk-session-activity.js";
import { sdkActivityLineId } from "./sdk-session-activity.js";
import { SdkStreamActivityBridge } from "./sdk-stream-activity";
import {
  resolveSdkStreamPartialBillingOrchestration,
  type SdkStreamPartialBillingRequest,
} from "./sdk-stream-partial-billing-orchestration";
import type { SdkRunHookContextExtras } from "./sdk-task-run-hooks";
import { dispatchSdkEventUsageBilling } from "./sdk-usage-billing-dispatch";
import { handleSdkUsageRecordedEvent } from "./sdk-usage-recorded-event-handler";
import {
  resolveSingleUsageBillingOrchestration,
  type SingleUsageBillingRequest,
} from "./single-usage-billing-orchestration";
import { listDiscoveredSkills } from "./skills-discovery";
import { linkAgentsSkillsToClaude } from "./skills-symlink";
import { uninstallDiscoveredSkill } from "./skills-uninstall";
import { installCatalogSkill, listSkillsLeaderboard, searchSkillsCatalog } from "./skills-catalog";
import {
  createProjectSkillsSettingsStore,
  type ProjectSkillsSettingsStore,
} from "./project-skills-settings-store";
import { createSubagentHandoffService, type SubagentHandoffService } from "./subagent-handoff-service.js";
import {
  clearThreadSubagentLaunchRegistry,
  getThreadSubagentLaunchRegistry,
} from "./subagent-launch-registry-store.js";
import { SubagentMetricsRegistry } from "./subagent-metrics-registry";
import { buildSubagentMetricsSummaries } from "./subagent-metrics-summary";
import { createSubagentSessionHooks } from "./subagent-session-hooks.js";
import { buildSubagentSessionTimings } from "./subagent-session-snapshots.js";
import { reconcileSubagentTerminalTranscript } from "./subagent-terminal-reconciliation.js";
import { resolveSubagentUsageAttribution } from "./subagent-usage-attribution";
import { normalizeTelemetryBillingRole } from "./telemetry-billing-role";
import { ThreadCacheHitMonitor } from "./thread-cache-hit-monitor";
import { requireThreadCore } from "./thread-core-routing";
import { ThreadRuntimeCoordinator } from "./thread-runtime-coordinator";
import { ThreadLiveRequestRegistry } from "./thread-live-request-registry.js";
import {
  flushThreadMetrics,
  persistThreadMetrics,
  restoreThreadMetricsFromStore,
} from "./thread-metrics-runtime";
import { resolveOrphanedThreadRecoveryAction } from "./thread-orphan-recovery";
import { resolveThreadPendingPlanDismissal } from "./thread-pending-plan-dismissal";
import { buildThreadPendingPlanView, buildThreadPlanLivePayload } from "./thread-pending-plan-view";
import { resolveThreadPlanApprovalRuntime } from "./thread-plan-approval-runtime";
import {
  applyThreadPlanReadyEffects,
  buildExecutionFailureRestorePendingPlan,
} from "./thread-plan-ready-effects";
import { ThreadPromptCacheEpisodeMonitor } from "./thread-prompt-cache-episode";
import { resolveThreadPromptCacheFingerprint, ThreadPromptCacheMonitor } from "./thread-prompt-cache-monitor";
import {
  clearRequestStartedPersisted,
  markRequestStartedPersisted,
  type RequestTerminalStage,
  requestTerminalLiveType,
  requestTerminalMessage,
} from "./thread-request-lifecycle.js";
import { runThreadRequestWithLifecycle } from "./thread-run-attempt";
import {
  type FinalizeThreadRunCleanupInput,
  finalizeThreadRunCleanup,
  shouldDeferRunCleanupFinish,
  shouldPreservePlanApprovalsOnRunCleanup,
} from "./thread-run-cleanup";
import {
  type ApplyThreadRunDecisionEffectsInput,
  applyThreadRunDecisionEffects,
} from "./thread-run-decision-effects";
import {
  buildSubagentLifecycleRunEvent,
  buildThreadRunEventFromLiveEvent,
  isMetricsOnlyThreadLiveEvent,
} from "./thread-run-event-normalizer";
import { ECO_PROXY_BILLING_HEADERS } from "./proxy-billing-stamp";
import {
  resolveAskRunOutcome,
  resolveAutonomousRunOutcome,
  resolveContinuationRunOutcome,
  resolveExecutionRunOutcome,
  resolvePlanningRunOutcome,
  runAttemptPhaseFromThreadMode,
} from "./thread-run-outcome";
import { buildThreadRunProjection } from "./thread-run-projection";
import {
  buildThreadRunProjectionDetail,
  parseThreadRunProjectionDetailRequest,
} from "./thread-run-projection-detail";
import {
  buildFeedProjectionSignature,
  filterFeedProjectionAfterSequence,
  maxFeedProjectionTimelineSequence,
  trimProjectionForFeed,
} from "./thread-run-projection-feed";
import { parseThreadRunProjectionGetRequest } from "./thread-run-projection-request";
import { runThreadRequestWithRuntimeProxy } from "./thread-runtime-proxy-attempt";
import {
  buildDriverRoutes,
  type RuntimeConfig,
  type RuntimeConfigResolution,
  resolveContextTokensByRole,
  resolveThreadRuntimeConfig,
  roleRoutesFromRuntime,
} from "./thread-runtime-routes";
import { createThreadSdkTaskRuntime } from "./thread-sdk-task-runtime";
import { buildThreadSessionBootstrap } from "./thread-session-bootstrap";
import { pendingThreadTitle, shouldReplaceAutoThreadTitle, summarizeThreadTitle } from "./thread-title";
import { loadThreadTodoList } from "./thread-todo-list-runtime";
import { ThreadUsageAccumulator } from "./thread-usage-accumulator";
import {
  buildThreadUsageSnapshotResult,
  type ThreadUsageSnapshotRuntimeServices,
} from "./thread-usage-snapshot-runtime";
import { emitToolOutputTruncated as emitToolOutputTruncatedEvent } from "./tool-output-run-events";
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
  type WorkflowSettingsStore,
} from "./workflow-settings-store";
import { prepareWorkspaceGit } from "./workspace-git-setup";
import { WorkspaceGitStatusPublisher } from "./workspace-git-status-publisher";
import { inspectWorkspace, resolveGitExecutable } from "./workspace-inspect";
import {
  approvedPlanRelativePath,
  claudePlanFileExists,
  isWorktreeGitCwdError,
  readApprovedPlanSnapshot,
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

function broadcastGitCommitMessageDelta(requestId: string, text: string): void {
  const payload = { requestId, text };
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send(IPC_CHANNELS.gitGenerateCommitMessageDelta, payload);
  });
}
function broadcastPackageScriptTerminalLaunch(payload: {
  workspacePath: string;
  sessionId: string;
  script: string;
  command: string[];
  taskId?: string;
}): void {
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send(IPC_CHANNELS.workspacePackageScriptTerminal, payload);
  });
}
let backgroundTerminalTaskRegistry: BackgroundTerminalTaskRegistry;
const interactiveTerminalManager = new InteractiveTerminalManager((event) => {
  backgroundTerminalTaskRegistry?.handleTerminalEvent(event);
  desktopEventCenter.publishTerminalEvent(event);
});
backgroundTerminalTaskRegistry = new BackgroundTerminalTaskRegistry(interactiveTerminalManager);
const packageJsonWatcher = new PackageJsonWatcher((workspacePath) => {
  desktopEventCenter.publishPackageJsonChanged(workspacePath);
});
const workspaceGitStatusPublisher = new WorkspaceGitStatusPublisher(runGitCommand, (summary) => {
  desktopEventCenter.publishGitStatusChanged(summary);
});
let gitAutoFetcher: GitAutoFetcher | undefined;
let activeGitOperations = 0;
const gitWorktrees = new GitWorktreeService(gitRunner);
let currentWorkspace: WorkspaceInfo | undefined;
let providerStore: ProviderStore;
let agentOrchestrationStore: AgentOrchestrationStore;
let mcpStore: McpStore;
let conversationStore: ConversationStore;
let codexThreadMap: CodexThreadMap;
let workflowSettingsStore: WorkflowSettingsStore;
let projectSkillsSettingsStore: ProjectSkillsSettingsStore;
let gitSettingsStore: GitSettingsStore;
let packageScriptArgsStore: PackageScriptArgsStore;
let proxyBridgeSettingsStore: ProxyBridgeSettingsStore;
let centerServerClient: CenterServerDesktopClient;

function emitCenterServerStatus(): void {
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send(IPC_CHANNELS.centerServerStatusChanged, centerServerClient.getSnapshot());
  });
}

function scheduleWorkspaceGitStatusPublish(workspacePath: string | undefined): void {
  if (!workspacePath?.trim()) {
    return;
  }
  workspaceGitStatusPublisher.schedule(workspacePath.trim());
}

function scheduleWorkspaceGitStatusPublishForThread(threadId: string): void {
  scheduleWorkspaceGitStatusPublish(conversationStore.getThread(threadId)?.workspacePath);
}

const activeRunRuntimeState = new ActiveRunRuntimeStateStore();
const activeRunBillingState = new ActiveRunBillingStateStore();
const threadLiveRequestRegistry = new ThreadLiveRequestRegistry();
const pendingCancelDisposition = new Map<string, WorktreeCancelDisposition>();
const pendingEscalatedFollowUpDrain = new Set<string>();
const threadUsageAccumulator = new ThreadUsageAccumulator();
const proxyBillingStampRegistry = new ProxyBillingStampRegistry();
const codexGatewayUsageDeduplicator = new CodexGatewayUsageDeduplicator();
const codexGatewayUsagePending = new CodexGatewayUsagePendingBuffer({
  onDrop: (drop) => {
    process.stderr.write(
      `[eco-codex] dropping pending gateway usage reason=${drop.reason} codexThread=${drop.codexThreadId} turn=${drop.turnId}\n`,
    );
  },
});
let agentLifecycle: AgentLifecycleService;
let usageLedgerCoordinator: UsageLedgerCoordinator;
let subagentMetricsRegistry: SubagentMetricsRegistry;
const persistMetricsTimers = new Map<string, ReturnType<typeof setTimeout>>();
const runProjectionEmitTimers = new Map<string, ReturnType<typeof setTimeout>>();
const lastFeedProjectionSignatures = new Map<string, string>();
const lastFeedProjectionTimelineSequences = new Map<string, number>();
const threadRunProjectionHistoryRevisions = new Map<string, number>();
const RUN_PROJECTION_EMIT_DEBOUNCE_MS = 500;
const RUN_PROJECTION_STREAMING_EMIT_MS = 250;
const sdkStreamBridge = new SdkStreamActivityBridge();
let pricingCache: ModelsDevPricingCache;
let pricingCatalogReady: Promise<void> = Promise.resolve();
let billingRuntimeEnvironment: BillingRuntimeEnvironment;
let contextMonitor: ContextWindowMonitor;
let threadPromptCacheMonitor: ThreadPromptCacheMonitor;
let threadPromptCacheEpisodeMonitor: ThreadPromptCacheEpisodeMonitor;
let promptCacheRunEventEmitter: ReturnType<typeof createPromptCacheRunEventEmitter>;
let threadCacheHitMonitor: ThreadCacheHitMonitor;
let contextScheduler: ContextSnapshotScheduler;
let contextLifecycle: ContextLifecycleService;
let compactionAuditService: CompactionAuditService;
let ecoCompactService: EcoCompactService;
let subagentHandoffService: SubagentHandoffService;
let codexFileCheckpointStore: CodexFileCheckpointStore;

interface ThreadCoreStartRunInput {
  thread: ThreadSummary;
  workspace: WorkspaceInfo;
  runtimeConfig: RuntimeConfig;
  prompt: string;
  attachments?: PromptImageAttachment[];
  roleRoutes: readonly RuntimeRoleRouteConfig[];
}

const threadRuntimeCoordinator = new ThreadRuntimeCoordinator<
  ThreadCoreStartRunInput,
  StartThreadContinuationInput,
  string,
  void,
  ThreadContinueResult,
  void
>();

threadRuntimeCoordinator.register({
  kind: "claude",
  start: dispatchClaudeThreadStart,
  continue: startClaudeThreadContinuation,
  cancel: (threadId) => {
    cancelClarificationsForThread(threadId, "cancelled by user");
    cancelBashApprovalsForThread(threadId, "cancelled by user");
    cancelPlanApprovalsForThreadWithStoreCleanup(threadId, "cancelled by user");
  },
});
threadRuntimeCoordinator.register({
  kind: "codex",
  start: (input) => startCodexThreadRun({ ...input, continuation: false }),
  continue: startCodexThreadContinuation,
  cancel: (threadId) => {
    cancelClarificationsForThread(threadId, "cancelled by user");
    cancelBashApprovalsForThread(threadId, "cancelled by user");
    cancelPlanApprovalsForThreadWithStoreCleanup(threadId, "cancelled by user");
  },
});

type SubagentDelegationLinker = (input: {
  agentId: string;
  agentType: string;
  parentToolUseId: string;
  prompt: string;
  todoId?: string;
}) => void;
const subagentDelegationLinkersByThread = new Map<string, SubagentDelegationLinker>();

/** After bridge plan approval: end the planning SDK pass, then start execution. */
const endPlanningPassAfterPlanReady = new Set<string>();
const deferredPlanExecutionByThread = new Map<
  string,
  { runtimeConfig: RuntimeConfig; routesOverride?: readonly RuntimeRoleRouteConfig[] }
>();

type AgentEventLike = Pick<AgentEvent, "id" | "type" | "payload" | "role" | "agentId">;

function resolveRequestTerminalEventScope(input: { role: string; agentId?: string }): ThreadRunEventScope {
  if (input.agentId?.trim()) {
    return "agent";
  }
  return (SUBAGENT_ROLES as readonly string[]).includes(input.role) ? "agent" : "main";
}

function emitRequestTerminalEvent(
  threadId: string,
  input: {
    requestId: string;
    role: string;
    agentId?: string;
    stage: RequestTerminalStage;
    detail?: string;
  },
): void {
  const requestId = input.requestId.trim();
  if (!requestId) {
    return;
  }
  if (conversationStore.getThread(threadId)) {
    const eventType = requestTerminalLiveType(input.stage);
    const runAttemptId = resolveCurrentRunAttemptId(threadId);
    const observedAt = new Date().toISOString();
    const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const agentId = input.agentId?.trim();
    try {
      conversationStore.appendThreadRunEvent({
        id: `tre:${threadId}:${eventType}:${requestId}:${unique}`,
        threadId,
        eventType,
        scope: resolveRequestTerminalEventScope({
          role: input.role,
          ...(agentId && { agentId }),
        }),
        role: input.role,
        ...(agentId && { agentId }),
        requestId,
        streamState: "none",
        message: requestTerminalMessage(input.stage, input.detail),
        observedAt,
        ...(runAttemptId && { runAttemptId }),
        metadata: {
          liveType: eventType,
        },
      });
      scheduleThreadRunProjectionUpdated(threadId);
    } catch (error) {
      process.stderr.write(`[eco] request terminal event write failed: ${errorMessage(error)}\n`);
    }
  }
  threadLiveRequestRegistry.endRequest(threadId, requestId);
  clearRequestStartedPersisted(threadId, requestId);
}

function startActiveRun(threadId: string, run: ActiveRunRuntimeStateInput): void {
  clearRequestStartedPersisted(threadId);
  activeRunRuntimeState.startRun(threadId, run);
  activeRunBillingState.startRun(threadId);
}

function finishActiveRun(threadId: string): void {
  for (const active of threadLiveRequestRegistry.listActive(threadId)) {
    emitRequestTerminalEvent(threadId, {
      requestId: active.requestId,
      role: active.role,
      ...(active.agentId && { agentId: active.agentId }),
      stage: "cancelled",
    });
  }
  activeRunRuntimeState.finishRun(threadId);
  activeRunBillingState.clearRun(threadId);
  clearRequestStartedPersisted(threadId);
  threadLiveRequestRegistry.clearThread(threadId);
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
    ...(process.platform === "darwin"
      ? {
          vibrancy: "under-window" as const,
          visualEffectState: "followWindow" as const,
        }
      : {}),
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
  codexFileCheckpointStore = new CodexFileCheckpointStore(
    path.join(app.getPath("userData"), "codex-file-checkpoints"),
  );
  subagentMetricsRegistry = new SubagentMetricsRegistry(conversationStore);
  usageLedgerCoordinator = new UsageLedgerCoordinator({
    store: conversationStore,
    metrics: subagentMetricsRegistry,
    logDiag: logEcoDiag,
    logDiagThrottled: logEcoDiagThrottled,
    onProxyAttributionSettled: async (threadId, settlements) => {
      await reconcileProxyAttributionContexts(
        {
          context: createUsageContextService({
            monitor: contextMonitor,
            emitLiveContext: (targetThreadId: string) => contextScheduler.emitLiveFromMonitor(targetThreadId),
          }),
          subagentMetrics: subagentMetricsRegistry,
          schedulePersistThreadMetrics,
          logDiag: logEcoDiag,
        },
        threadId,
        settlements,
      );
      emitSubagentTimingUpdated(threadId);
    },
  });
  workflowSettingsStore = await createWorkflowSettingsStore(dbPath);
  projectSkillsSettingsStore = await createProjectSkillsSettingsStore(dbPath);
  gitSettingsStore = await createGitSettingsStore(dbPath);
  packageScriptArgsStore = createPackageScriptArgsStore(
    path.join(app.getPath("userData"), "package-script-args.json"),
  );
  proxyBridgeSettingsStore = await createProxyBridgeSettingsStore(dbPath);
  const centerServerSecretCodec = createElectronSafeStorageCenterServerSecretCodec(safeStorage);
  centerServerClient = new CenterServerDesktopClient({
    store: await createCenterServerStore(dbPath, {
      ...(centerServerSecretCodec ? { secretCodec: centerServerSecretCodec } : {}),
    }),
    eventCenter: desktopEventCenter,
    log: (message) => process.stderr.write(message),
    onStatusChange: emitCenterServerStatus,
  });
  agentLifecycle = new AgentLifecycleService(conversationStore);
  codexThreadMap = new ConversationStoreCodexThreadMap(conversationStore);
  configureEcoGatewayLifecycle({
    ecoDataDir: app.getPath("userData"),
    listProviders: () => {
      const routeModels = new Map<string, string[]>();
      for (const profile of providerStore.listRouteProfiles()) {
        for (const route of profile.routes) {
          const models = routeModels.get(route.providerId) ?? [];
          models.push(route.modelId);
          routeModels.set(route.providerId, models);
        }
      }
      return providerStore.listProvidersWithSecrets().map((provider) => ({
        id: provider.id,
        name: provider.name,
        enabled: provider.enabled,
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        apiCompat: provider.apiCompat,
        defaultModel: provider.defaultModel,
        modelIds: [
          ...providerStore.listCandidateModels(provider.id).map((model) => model.modelId),
          ...(routeModels.get(provider.id) ?? []),
        ],
      }));
    },
    onUsage: handleCodexGatewayUsage,
    onStderr: (chunk) => process.stderr.write(chunk.endsWith("\n") ? chunk : `${chunk}\n`),
  });
  configureCodexRuntimeRun({
    ecoDataDir: app.getPath("userData"),
    listProviders: () =>
      providerStore.listProviders().map((provider) => ({
        id: provider.id,
        name: provider.name,
        enabled: provider.enabled,
        apiCompat: provider.apiCompat,
      })),
    threadMap: codexThreadMap,
    resolveRunAttemptId: (threadId) => agentLifecycle.currentRunAttemptId(threadId),
    appendThreadRunEvent: (event) => {
      if (!conversationStore.getThread(event.threadId)) {
        throw new Error(`Refusing Codex event for unknown thread ${event.threadId}.`);
      }
      const persisted = conversationStore.appendThreadRunEvent(event);
      applyCodexSubagentLifecycleEvent(persisted, {
        getAgentStatus: (threadId, agentId) =>
          conversationStore
            .listAgentInstances(threadId)
            .find((candidate) => candidate.agentId === agentId)?.status,
        resolvePhase: (threadId) => {
          const mode = conversationStore.getThread(threadId)?.runtimeConfig?.sessionMode;
          return mode === "plan" ? "planning" : mode === "ask" ? "ask" : "execution";
        },
        startSession: (input) => conversationStore.upsertSubagentSessionActive(input),
        stopSession: (threadId, agentId) =>
          conversationStore.markSubagentSessionStopped(threadId, agentId),
        startMetrics: (threadId, input) =>
          subagentMetricsRegistry.onSubagentStart(threadId, input),
        stopMetrics: (threadId, input) =>
          subagentMetricsRegistry.onSubagentStop(threadId, input),
        startAgent: (input) => {
          agentLifecycle.startSubagent(input);
        },
        stopAgent: (input) => agentLifecycle.stopSubagent(input),
        abandonAgent: (input) => agentLifecycle.abandonSubagent(input),
      });
    },
    bindLatestUserPromptToCodexItem: (threadId, itemId) => {
      const bound = conversationStore.bindLatestUserRunEventToSdkMessage(threadId, itemId);
      if (!bound) return false;
      void codexFileCheckpointStore.bindPending(threadId, itemId).catch((error) => {
        process.stderr.write(`[eco-codex] file checkpoint bind failed: ${errorMessage(error)}\n`);
      });
      return true;
    },
    restoreFilesAfterCodexRollback: async (threadId, itemId) => {
      const worktreePath = resolveThreadWorktreePath(threadId);
      if (!worktreePath) throw new Error("Codex rewind has no persisted worktree path.");
      await codexFileCheckpointStore.restore(threadId, itemId, worktreePath);
    },
    resolveCodexRollbackTurnIndex: (threadId, itemId) => {
      const index = conversationStore
        .listFileCheckpoints(threadId)
        .findIndex((checkpoint) => checkpoint.userMessageId === itemId);
      return index >= 0 ? index : undefined;
    },
    pruneThreadAfterCodexRollback: (threadId, itemId) => {
      conversationStore.rewindThreadToActivityLine(threadId, sdkActivityLineId(itemId));
      scheduleThreadRunProjectionUpdated(threadId, { streaming: false });
    },
    scheduleThreadRunProjectionUpdated,
    onCodexThreadMapped: flushPendingCodexGatewayUsage,
    onCodexThreadAttributionRecorded: flushPendingCodexGatewayUsage,
    onCodexContextUpdated: (resolution) => {
      void contextMonitor
        .updateOccupied(
          resolution.ecoThreadId,
          resolution.billingRole,
          resolution.contextOccupied,
          { limit: resolution.context.limit },
        )
        .then(() => contextScheduler.emitLiveFromMonitor(resolution.ecoThreadId))
        .catch((error) => {
          process.stderr.write(
            `[eco-codex] context update failed thread=${resolution.ecoThreadId}: ${errorMessage(error)}\n`,
          );
        });
    },
    onCodexPlanReady: ({ ecoThreadId, plan, planFilePath }) => {
      const thread = conversationStore.getThread(ecoThreadId);
      const worktreePath = resolveThreadWorktreePath(ecoThreadId);
      const runtime = resolveRuntimeConfigForThreadId(ecoThreadId);
      if (!thread) {
        markThreadInterrupted(ecoThreadId, "Codex Plan completed for an unknown Eco thread.");
        return;
      }
      if (!worktreePath) {
        markThreadInterrupted(
          ecoThreadId,
          "Codex Plan completed without a persisted worktree path.",
        );
        return;
      }
      if (!runtime.ok) {
        markThreadInterrupted(ecoThreadId, runtime.reason);
        return;
      }
      const activityLines = conversationStore.listActivityLines(ecoThreadId);
      const latestUserPrompt = [...activityLines]
        .reverse()
        .find((line) => line.role === "user" && line.message.trim())
        ?.message.trim();
      captureThreadPlanReady({
        threadId: ecoThreadId,
        workspacePath: thread.workspacePath,
        worktreePath,
        routesJson: JSON.stringify(runtime.routes),
        payload: {
          userPrompt: latestUserPrompt || thread.prompt,
          analysis: "",
          plan,
          ...(planFilePath ? { planFilePath } : {}),
        },
        awaitingPlanMessage: "计划已生成，请确认是否执行。",
      });
      updateThread(ecoThreadId, {
        status: "awaiting_plan",
        message: "计划已生成，请确认是否执行。",
      });
    },
    onStderr: (message) => process.stderr.write(`${message}\n`),
  });
  configureCodexApprovalBridge({
    resolveEcoThreadId: (codexThreadId) => codexThreadMap.getEcoThreadId(codexThreadId) ?? codexThreadId,
    getThread: (threadId) => {
      const thread = conversationStore.getThread(threadId);
      return thread ? { prompt: thread.prompt, workspacePath: thread.workspacePath } : undefined;
    },
    getWorktreePath: (threadId) => activeRunRuntimeState.worktreePlan(threadId)?.worktreePath,
    getPlannerAgentId: (threadId) => agentLifecycle.usagePlannerAgentId(threadId),
    getRoutesJson: (threadId) => JSON.stringify(resolveRoleRoutesForThread(threadId)),
    savePendingPlan: (plan) => conversationStore.savePendingPlan(plan),
    emitThreadLive: (event) => desktopEventCenter.publishThreadLiveEvent(event),
    updateThreadStatus: (threadId, patch) =>
      updateThread(threadId, {
        status: patch.status as ThreadSummary["status"],
        message: patch.message,
      }),
  });
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
  threadPromptCacheMonitor = new ThreadPromptCacheMonitor();
  threadPromptCacheEpisodeMonitor = new ThreadPromptCacheEpisodeMonitor();
  promptCacheRunEventEmitter = createPromptCacheRunEventEmitter(
    {
      getThread: (threadId) => conversationStore.getThread(threadId),
      appendThreadRunEvent: (event) => conversationStore.appendThreadRunEvent(event),
      scheduleProjectionUpdated: (threadId) => scheduleThreadRunProjectionUpdated(threadId),
      emitThreadEvent: (threadId, type, message) => emitThreadEvent(threadId, type, message, "system"),
      resolveCurrentRunAttemptId: (threadId) => resolveCurrentRunAttemptId(threadId),
      writeStderr: (message) => process.stderr.write(message),
    },
    threadPromptCacheEpisodeMonitor,
  );
  threadCacheHitMonitor = new ThreadCacheHitMonitor();
  const resolveProxyRoutesForThread = (threadId: string) => {
    const roleRoutes = resolveRoleRoutesForThread(threadId);
    const runtimeConfig = resolveRuntimeConfigForThreadId(threadId, roleRoutes);
    if (!runtimeConfig.ok) {
      throw new Error(runtimeConfig.reason);
    }
    return runtimeConfig.routes;
  };
  ecoCompactService = createEcoCompactService({
    listActivityLines: (threadId) => listThreadCompactionActivityFromSdkSession(threadId),
    getThreadPrompt: (threadId) => conversationStore.getThread(threadId)?.prompt,
    getLatestCompactSummary: (threadId) => conversationStore.getLatestCompactSummary(threadId),
    commitCompactHandoff: (threadId, input) =>
      conversationStore.commitCompactHandoffAndClearSession(threadId, input),
    resolveProxyRoutes: resolveProxyRoutesForThread,
  });
  subagentHandoffService = createSubagentHandoffService({
    listSubagentActivityLines: (threadId, agentId) => listSubagentActivityFromSdkSession(threadId, agentId),
    resolveProxyRoutes: resolveProxyRoutesForThread,
  });
  contextScheduler = new ContextSnapshotScheduler({
    monitor: contextMonitor,
    isThreadRunning: (threadId) => activeRunRuntimeState.hasRun(threadId),
    getResume: (threadId, worktreePath) => resolveResumeOptions(threadId, worktreePath),
    isWorktreePathReady: async (worktreePath) => fileExists(worktreePath),
    emitContext: emitThreadContextUpdated,
    emitCompactionStatus: emitContextCompactionStatus,
    runEcoCompact: (threadId, input) => ecoCompactService.runEcoCompact(threadId, input),
    archiveBeforeCompaction: archiveThreadContextBeforeCompaction,
    recordEcoCompactionBoundary: (threadId, input) => {
      recordCompactionLedgerBoundary(
        threadId,
        {
          subtype: "compact_boundary",
          compact_metadata: {
            post_tokens: input.postTokens,
            trigger: input.trigger,
            source: "eco",
          },
        },
        `${threadId}:eco-compact:${Date.now()}`,
      );
    },
    recordEcoCompactionFailure: (threadId, input) => {
      compactionAuditService.recordFailure(threadId, input);
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
    onPostRunCompactionError: (threadId, error) => {
      process.stderr.write(
        `[eco] post-run context compaction failed (${threadId}): ${errorMessage(error)}\n`,
      );
    },
  });
  compactionAuditService = createCompactionAuditService({
    listActivityLines: (threadId) => listThreadCompactionActivityFromSdkSession(threadId),
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
  backfillThreadRuntimeConfigs();
  recoverOrphanedRunningThreads();
  currentWorkspace = await ensureHomeProject();
  initializeGitAutoFetcher();
  registerIpcHandlers();
  if (centerServerClient.getSnapshot().settings.enabled) {
    void centerServerClient.start();
  }
  await createMainWindow();

  app.on("browser-window-focus", () => {
    gitAutoFetcher?.setWindowFocused(true);
  });
  app.on("browser-window-blur", () => {
    gitAutoFetcher?.setWindowFocused(false);
  });

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
  codexGatewayUsagePending.dispose();
  codexGatewayUsageDeduplicator.clear();
  gitAutoFetcher?.dispose();
  centerServerClient?.dispose();
  void stopGlobalCodexRuntimeLifecycle();
  void stopGlobalEcoGateway();
});

function getModelSettingsSnapshot(): ModelSettingsSnapshot {
  return {
    ...mergeAgentRegistrySettings(providerStore.getSettings(), agentOrchestrationStore),
    mcpSettings: mcpStore.getSettings(),
  };
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
    mcpServers: mcpStore.listServers(),
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

function buildThreadUsageSnapshotServices(): ThreadUsageSnapshotRuntimeServices {
  return {
    getLegacyBilling: (threadId) => threadUsageAccumulator.getSnapshot(threadId),
    resolveBillingSnapshot: (threadId, legacyBilling, options) =>
      usageLedgerCoordinator.resolveBillingSnapshot(threadId, legacyBilling, options),
    enrichBillingSnapshot: (threadId, billing) =>
      usageLedgerCoordinator.enrichBillingSnapshot(threadId, billing),
    projectBillingSnapshot: (threadId, plannerModelLabel) =>
      usageLedgerCoordinator.projectBillingSnapshot(threadId, plannerModelLabel),
    getThreadStatus: (threadId) => conversationStore.getThread(threadId)?.status,
    getDisplayContextSnapshot: (threadId) => contextScheduler.getDisplaySnapshot(threadId),
  };
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
  return resolveCandidateModelDefaults(
    runtimeRoleRoutesFromAgentProfile(profile, config.mainAgentModelOverride),
  );
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

function resolveRoleRoutesForThread(threadId: string): RuntimeRoleRouteConfig[] {
  const settings = getModelSettingsSnapshot();
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
  const routes = resolveRuntimeRoutesFromSettings(settings, providers, roleRoutes);
  const plannerRoute = routes.find((route) => route.role === "planner");
  if (!plannerRoute || routes.some((route) => route.role === BUILTIN_VISION_AGENT_ROLE)) {
    return routes;
  }
  return [
    ...routes,
    {
      ...plannerRoute,
      role: BUILTIN_VISION_AGENT_ROLE,
      manualSpec: {
        ...plannerRoute.manualSpec,
        maxOutputTokens: 1600,
      },
    },
  ];
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
  const systemPromptPreset = resolveMainAgentSystemPromptPreset(profile, runtimeConfig);
  return {
    templates: settings.agentTemplates,
    profile:
      systemPromptPreset === profile.mainAgent.systemPromptPreset
        ? profile
        : {
            ...profile,
            mainAgent: { ...profile.mainAgent, systemPromptPreset },
          },
  };
}

function resolveAgentRuntimeConfigForThreadId(threadId: string): EcoAgentRuntimeConfig | undefined {
  const thread = conversationStore.getThread(threadId);
  return thread ? resolveAgentRuntimeConfigForThread(thread) : undefined;
}

function threadSessionMode(threadId: string): import("../shared/session-mode").SessionMode {
  const thread = conversationStore.getThread(threadId);
  const config = thread ? ensureThreadRuntimeConfig(thread).runtimeConfig : undefined;
  if (config) {
    return resolveSessionMode(config);
  }
  return resolveSessionMode(workflowSettingsStore.get());
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
  const next = withAgentSessionMode(config, "agent");
  if (next === config) {
    return config;
  }
  conversationStore.saveThreadRuntimeConfig(threadId, next);
  return next;
}

function commitThreadPlanApprovalToAgentMode(threadId: string, reason: string): void {
  const runtimeConfig = disableThreadPlanMode(threadId);
  if (!runtimeConfig || resolveSessionMode(runtimeConfig) !== "agent") {
    return;
  }
  emitThreadEvent(threadId, "thread.runtime_config_updated", "", "system", false, {
    runtimeConfig,
  });
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

type AppThemeSource = "dark" | "light" | "system";

function normalizeAppThemeSource(value: unknown): AppThemeSource {
  return value === "dark" || value === "light" || value === "system" ? value : "system";
}

function showDesktopNotification(content: { title: string; body: string }): void {
  const notification = new Notification({
    title: content.title,
    body: content.body,
    ...(appIcon ? { icon: appIcon } : {}),
  });
  notification.on("click", () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) {
      return;
    }
    if (window.isMinimized()) {
      window.restore();
    }
    window.show();
    window.focus();
  });
  notification.show();
}

function registerIpcHandlers(): void {
  registerDesktopCommand(IPC_CHANNELS.coreAvailabilityGet, async () => {
    const codexAvailable = isCodexCliAvailable();
    return {
      claude: { available: true as const },
      codex: {
        available: codexAvailable,
        ...(!codexAvailable && {
          reason: "未找到可执行的 Codex CLI。请安装工作区依赖或设置 CODEX_EXECUTABLE。",
        }),
      },
    };
  });

  registerDesktopCommand(IPC_CHANNELS.appSetThemeSource, async (payload: unknown) => {
    const themeSource = normalizeAppThemeSource(payload);
    nativeTheme.themeSource = themeSource;
    return { themeSource };
  });

  registerDesktopCommand(IPC_CHANNELS.appShowThreadCompletionNotification, async (payload: unknown) => {
    if (!Notification.isSupported()) {
      return { shown: false, reason: "unsupported" } as const;
    }
    if (typeof payload !== "string" || !payload.trim()) {
      return { shown: false, reason: "thread_not_found" } as const;
    }
    const thread = conversationStore.getThread(payload);
    if (!thread) {
      return { shown: false, reason: "thread_not_found" } as const;
    }
    if (thread.status !== "completed") {
      return { shown: false, reason: "thread_not_completed" } as const;
    }
    const content = buildThreadCompletionNotificationContent(
      thread,
      await listThreadActivityFromSdkSession(thread.id),
    );
    if (!content) {
      return { shown: false, reason: "notification_content_unavailable" } as const;
    }

    showDesktopNotification(content);
    return { shown: true } as const;
  });

  registerDesktopCommand(IPC_CHANNELS.appShowThreadApprovalNotification, async (payload: unknown) => {
    if (!Notification.isSupported()) {
      return { shown: false, reason: "unsupported" } as const;
    }
    if (
      !isRecord(payload) ||
      typeof payload.threadId !== "string" ||
      (payload.kind !== "plan" && payload.kind !== "bash")
    ) {
      return { shown: false, reason: "invalid_request" } as const;
    }
    const thread = conversationStore.getThread(payload.threadId);
    if (!thread) {
      return { shown: false, reason: "thread_not_found" } as const;
    }
    const kind = payload.kind;
    const approval =
      kind === "plan"
        ? getPendingPlanApprovalForThread(thread.id)
        : kind === "bash"
          ? getPendingBashApprovalForThread(thread.id)
          : undefined;
    if (!approval) {
      return { shown: false, reason: "approval_not_pending" } as const;
    }
    const content = buildThreadApprovalNotificationContent(thread, kind, approval);
    if (!content) {
      return { shown: false, reason: "notification_content_unavailable" } as const;
    }

    showDesktopNotification(content);
    return { shown: true } as const;
  });

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
    syncGitAutoFetcherWorkspace();
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
    syncGitAutoFetcherWorkspace();
    return currentWorkspace;
  });

  registerDesktopCommand(IPC_CHANNELS.workspaceGetCurrent, async () => currentWorkspace);

  registerDesktopCommand(IPC_CHANNELS.workspaceGetHomePath, async () => getHomeProjectPath());

  registerDesktopCommand(IPC_CHANNELS.workspaceGetUserHomePath, async () => os.homedir());

  registerDesktopCommand(IPC_CHANNELS.workspaceListDirectories, async (directoryPath: unknown) => {
    if (typeof directoryPath !== "string" || !directoryPath.trim()) {
      throw new Error("Directory path is required.");
    }
    const resolvedPath = path.resolve(directoryPath.trim());
    const stat = await fs.stat(resolvedPath);
    if (!stat.isDirectory()) {
      throw new Error("请选择文件夹，而不是文件。");
    }
    const entries = await fs.readdir(resolvedPath, { withFileTypes: true });
    const directories = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({ name: entry.name, path: path.join(resolvedPath, entry.name) }))
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
    const parentPath = path.dirname(resolvedPath);
    return {
      path: resolvedPath,
      ...(parentPath !== resolvedPath ? { parentPath } : {}),
      directories,
    };
  });

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
    const trimmed = workspacePath.trim();
    const listing = await listPackageScripts(trimmed);
    const scriptArgs = await packageScriptArgsStore.getWorkspaceArgs(trimmed);
    return { ...listing, scriptArgs };
  });

  registerDesktopCommand(IPC_CHANNELS.workspaceSavePackageScriptArgs, async (payload: unknown) => {
    if (!isSavePackageScriptArgsRequest(payload)) {
      throw new Error("Invalid save package script args request.");
    }
    const scriptArgs = await packageScriptArgsStore.saveScriptArgs(
      payload.workspacePath,
      payload.script,
      payload.args,
    );
    return { workspacePath: path.resolve(payload.workspacePath), scriptArgs };
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
    const launched = runPreparedPackageScriptAsBackgroundTask(backgroundTerminalTaskRegistry, prepared, {
      ...(payload.threadId?.trim() && { threadId: payload.threadId.trim() }),
    });
    const result = {
      script: launched.script,
      command: launched.command,
      sessionId: launched.sessionId,
      taskId: launched.taskId,
    };
    broadcastPackageScriptTerminalLaunch({
      workspacePath: prepared.workspacePath,
      ...result,
    });
    return result;
  });

  registerDesktopCommand(IPC_CHANNELS.backgroundTerminalList, async (payload: unknown) => {
    if (payload !== undefined && !isBackgroundTerminalListRequest(payload)) {
      throw new Error("Invalid background terminal list request.");
    }
    return backgroundTerminalTaskRegistry.list(payload ?? {});
  });

  registerDesktopCommand(IPC_CHANNELS.backgroundTerminalStart, async (payload: unknown) => {
    if (!isBackgroundTerminalStartRequest(payload)) {
      throw new Error("Invalid background terminal start request.");
    }
    const task = backgroundTerminalTaskRegistry.start(payload);
    desktopEventCenter.publishTerminalEvent({
      type: "started",
      sessionId: task.sessionId,
      workspacePath: task.workspacePath,
    });
    return task;
  });

  registerDesktopCommand(IPC_CHANNELS.backgroundTerminalOpen, async (payload: unknown) => {
    if (!isBackgroundTerminalOpenRequest(payload)) {
      throw new Error("Invalid background terminal open request.");
    }
    const task = backgroundTerminalTaskRegistry.get(payload.taskId);
    if (!task) {
      throw new Error(`Background terminal task not found: ${payload.taskId}`);
    }
    return task;
  });

  registerDesktopCommand(IPC_CHANNELS.backgroundTerminalStop, async (payload: unknown) => {
    if (!isBackgroundTerminalStopRequest(payload)) {
      throw new Error("Invalid background terminal stop request.");
    }
    return backgroundTerminalTaskRegistry.stop(payload.taskId);
  });

  registerDesktopCommand(IPC_CHANNELS.terminalList, async (payload: unknown) => {
    if (payload !== undefined && !isTerminalListRequest(payload)) {
      throw new Error("Invalid terminal list request.");
    }
    const request = (payload ?? {}) as TerminalListRequest;
    return interactiveTerminalManager.list(request.workspacePath);
  });

  registerDesktopCommand(IPC_CHANNELS.terminalSpawn, async (payload: unknown) => {
    if (!isTerminalSpawnRequest(payload)) {
      throw new Error("Invalid terminal spawn request.");
    }
    const workspacePath = payload.workspacePath.trim();
    if (!workspacePath) {
      throw new Error("Workspace path is required.");
    }
    const cols = payload.cols;
    const rows = payload.rows;
    const size =
      typeof cols === "number" &&
      typeof rows === "number" &&
      Number.isFinite(cols) &&
      Number.isFinite(rows) &&
      cols > 0 &&
      rows > 0
        ? { cols: Math.floor(cols), rows: Math.floor(rows) }
        : undefined;
    return interactiveTerminalManager.spawn(workspacePath, size);
  });

  registerDesktopCommand(IPC_CHANNELS.terminalInput, async (payload: unknown) => {
    if (!isTerminalInputRequest(payload)) {
      throw new Error("Invalid terminal input request.");
    }
    interactiveTerminalManager.write(payload.sessionId, payload.data);
  });

  registerDesktopCommand(IPC_CHANNELS.terminalResize, async (payload: unknown) => {
    if (!isTerminalResizeRequest(payload)) {
      throw new Error("Invalid terminal resize request.");
    }
    interactiveTerminalManager.resize(payload.sessionId, payload.cols, payload.rows);
  });

  registerDesktopCommand(IPC_CHANNELS.terminalKill, async (payload: unknown) => {
    if (!isTerminalKillRequest(payload)) {
      throw new Error("Invalid terminal kill request.");
    }
    return { killed: interactiveTerminalManager.kill(payload.sessionId) };
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
    syncGitAutoFetcherWorkspace();
    return workspace;
  });

  registerDesktopCommand(IPC_CHANNELS.threadList, async () =>
    hydrateThreads(conversationStore.listThreads()),
  );

  registerDesktopCommand(IPC_CHANNELS.threadGet, async (threadId: unknown) => {
    const id = typeof threadId === "string" ? threadId.trim() : "";
    if (!id) {
      return undefined;
    }
    const thread = conversationStore.getThread(id);
    return thread ? ensureThreadRuntimeConfig(thread) : undefined;
  });

  registerDesktopCommand(IPC_CHANNELS.threadSessionBootstrap, async (threadId: unknown) => {
    const id = typeof threadId === "string" ? threadId.trim() : "";
    return buildThreadSessionBootstrap(id, {
      getThread: (targetId) => {
        const thread = conversationStore.getThread(targetId);
        return thread ? ensureThreadRuntimeConfig(thread) : undefined;
      },
      listFollowUps: (targetId) => conversationStore.listThreadFollowUps(targetId),
      getPendingPlan: (targetId) => conversationStore.getPendingPlan(targetId),
      getPendingBashApproval: (targetId) => getPendingBashApprovalForThread(targetId),
      getPendingClarification: (targetId) => getPendingClarificationForThread(targetId),
      listSubagentSessionTimings: (targetId) =>
        buildSubagentSessionTimings(conversationStore.listSubagentSessions(targetId)),
      usageSnapshotServices: buildThreadUsageSnapshotServices(),
    }) satisfies ThreadSessionBootstrapResult;
  });

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
    threadRunProjectionHistoryRevisions.delete(threadId);
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
    const configChanged =
      !existing ||
      JSON.stringify(normalizeThreadRuntimeConfig(existing)) !==
        JSON.stringify(normalizeThreadRuntimeConfig(runtimeConfig));
    conversationStore.saveThreadRuntimeConfig(threadId, runtimeConfig);
    if (!existing || !isBashReviewModeOnlyRuntimeConfigUpdate(existing, runtimeConfig)) {
      noteSdkSessionRouteChange(threadId, roleRoutes);
    }
    const updatedThread = ensureThreadRuntimeConfig(conversationStore.getThread(threadId) ?? thread);
    if (configChanged && existing) {
      const availableMcpServerKeys = listEnabledGlobalMcpServerKeys(mcpStore.listServers());
      const driftKinds = diffPromptCacheRuntimeSignatures(
        resolvePromptCacheRuntimeSignature({
          runtimeConfig: existing,
          settings,
          availableMcpServerKeys,
        }),
        resolvePromptCacheRuntimeSignature({
          runtimeConfig,
          settings,
          availableMcpServerKeys,
        }),
      );
      if (driftKinds.length > 0) {
        const profileLabel = driftKinds.includes("profile")
          ? resolvePromptCacheProfileLabel(settings, runtimeConfig)
          : undefined;
        promptCacheRunEventEmitter.emitConfigDrift(threadId, driftKinds, {
          ...(profileLabel && { profileLabel }),
        });
      }
    }
    if (configChanged) {
      emitThreadEvent(threadId, "thread.runtime_config_updated", "", "system", false, {
        runtimeConfig,
      });
    }
    return { thread: updatedThread };
  });

  registerDesktopCommand(IPC_CHANNELS.threadActivityList, async (threadId: string) => {
    if (typeof threadId !== "string" || !threadId.trim()) {
      return [];
    }
    return listThreadActivityFromSdkSession(threadId);
  });

  registerDesktopCommand(IPC_CHANNELS.threadRunProjectionGet, async (payload: unknown, modeArg?: unknown) => {
    const request = parseThreadRunProjectionGetRequest(payload, modeArg);
    if (!request.threadId) {
      return undefined;
    }
    const projection = buildCurrentThreadRunProjection(request.threadId);
    if (!projection) {
      return undefined;
    }
    if (request.mode !== "feed") {
      return projection;
    }
    return filterFeedProjectionAfterSequence(trimProjectionForFeed(projection), request.afterSequence);
  });

  registerDesktopCommand(IPC_CHANNELS.threadRunProjectionDetailGet, async (payload: unknown) => {
    const request = parseThreadRunProjectionDetailRequest(payload);
    if (!request) {
      return undefined;
    }
    const projection = buildCurrentThreadRunProjection(request.threadId);
    if (!projection) {
      return undefined;
    }
    return buildThreadRunProjectionDetail(projection, request);
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

  registerDesktopCommand(IPC_CHANNELS.threadTodoList, async (threadId: string) => {
    if (typeof threadId !== "string" || !threadId.trim()) {
      return [];
    }
    return loadThreadTodoList({
      threadId,
      services: {
        listTodos: (id) => conversationStore.listCoderTodos(id),
        listActivity: (id) => listThreadActivityFromSdkSession(id),
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

  registerDesktopCommand(IPC_CHANNELS.mcpServerCheck, async (payload: McpServerConfigInput) => {
    return checkMcpServerConnection(payload);
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

  registerDesktopCommand(IPC_CHANNELS.skillsUninstall, async (payload: unknown) => {
    if (!isSkillUninstallRequest(payload)) {
      throw new Error("Invalid Skill uninstall request.");
    }
    const discovered = await listDiscoveredSkills();
    const requestedDirectory = path.resolve(payload.directory.trim());
    const skill = discovered.userSkills.find(
      (candidate) => path.resolve(candidate.directory) === requestedDirectory,
    );
    if (!skill) {
      throw new Error("Skill is not present in a supported user Skills directory.");
    }
    return uninstallDiscoveredSkill(skill);
  });

  registerDesktopCommand(IPC_CHANNELS.skillsCatalogSearch, async (payload: unknown) => {
    if (!isSkillCatalogSearchRequest(payload)) {
      throw new Error("Invalid Skills catalog search request.");
    }
    return searchSkillsCatalog(payload.query, {
      ...(payload.limit !== undefined ? { limit: payload.limit } : {}),
    });
  });

  registerDesktopCommand(IPC_CHANNELS.skillsCatalogLeaderboard, async (payload: unknown) => {
    if (typeof payload !== "number" || !Number.isInteger(payload)) {
      throw new Error("Invalid Skills catalog leaderboard limit.");
    }
    return listSkillsLeaderboard({ limit: payload });
  });

  registerDesktopCommand(IPC_CHANNELS.skillsCatalogInstall, async (payload: unknown) => {
    if (!isSkillCatalogInstallRequest(payload)) {
      throw new Error("Invalid Skills catalog install request.");
    }
    return installCatalogSkill(payload);
  });

  registerDesktopCommand(IPC_CHANNELS.projectSkillsSettingsGet, async (payload: unknown) => {
    if (typeof payload !== "string" || !payload.trim()) {
      throw new Error("Invalid project Skills settings workspace path.");
    }
    return projectSkillsSettingsStore.get(payload);
  });

  registerDesktopCommand(IPC_CHANNELS.projectSkillsSettingsSave, async (payload: unknown) => {
    if (!isRecord(payload) || typeof payload.workspacePath !== "string" || !isRecord(payload.enabledByPath)) {
      throw new Error("Invalid project Skills settings.");
    }
    return projectSkillsSettingsStore.save({
      workspacePath: payload.workspacePath,
      enabledByPath: Object.fromEntries(
        Object.entries(payload.enabledByPath).filter(
          (entry): entry is [string, boolean] => typeof entry[1] === "boolean",
        ),
      ),
    });
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
    const saved = gitSettingsStore.save(normalizeGitSettingsSnapshot(payload));
    applyGitAutoFetcherSettings();
    return saved;
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
    const result = await discardWorkspaceChanges(
      record.workspacePath.trim(),
      filePath ? { path: filePath } : {},
      runGitCommand,
    );
    scheduleWorkspaceGitStatusPublish(record.workspacePath);
    return result;
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
    scheduleWorkspaceGitStatusPublish(record.workspacePath);
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
    scheduleWorkspaceGitStatusPublish(record.workspacePath);
    return getGitWorkingTreeStatus(record.workspacePath, runGitCommand);
  });

  registerDesktopCommand(IPC_CHANNELS.gitGenerateCommitMessage, async (payload: unknown) => {
    if (!isGitGenerateCommitMessageRequest(payload)) {
      throw new Error("Invalid git generate commit message request.");
    }
    const requestId = payload.requestId?.trim();
    return handleGitGenerateCommitMessage(payload, {
      providerStore,
      agentOrchestrationStore,
      gitSettingsStore,
      pricingCache,
      run: runGitCommand,
      ...(requestId && {
        onCommitMessageDelta: (text) => {
          broadcastGitCommitMessageDelta(requestId, text);
        },
      }),
    });
  });

  registerDesktopCommand(IPC_CHANNELS.gitListCommitModelOptions, async (payload: unknown) => {
    if (!payload || typeof payload !== "object") {
      throw new Error("Invalid git list commit model options request.");
    }
    const record = payload as Record<string, unknown>;
    if (typeof record.profileId !== "string" || !record.profileId.trim()) {
      throw new Error("Invalid git list commit model options request.");
    }
    return handleGitListCommitModelOptions(
      { profileId: record.profileId.trim() },
      {
        providerStore,
        agentOrchestrationStore,
        gitSettingsStore,
        pricingCache,
      },
    );
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
      syncGitAutoFetcherWorkspace();
    }
    scheduleWorkspaceGitStatusPublish(payload.workspacePath);
    return result;
  });

  registerDesktopCommand(IPC_CHANNELS.gitPush, async (payload: unknown) => {
    if (!isGitPushRequest(payload)) {
      throw new Error("Invalid git push request.");
    }
    const result = await handleGitPush(payload, runGitCommand);
    scheduleWorkspaceGitStatusPublish(payload.workspacePath);
    return result;
  });

  registerDesktopCommand(IPC_CHANNELS.gitPull, async (payload: unknown) => {
    if (!isGitPullRequest(payload)) {
      throw new Error("Invalid git pull request.");
    }
    const result = await handleGitPull(payload, runGitCommand);
    if (currentWorkspace?.path === payload.workspacePath.trim()) {
      currentWorkspace = await inspectWorkspace(payload.workspacePath.trim());
      syncGitAutoFetcherWorkspace();
    }
    scheduleWorkspaceGitStatusPublish(payload.workspacePath);
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

  registerDesktopCommand(IPC_CHANNELS.centerServerSettingsGet, async () => centerServerClient.getSnapshot());

  registerDesktopCommand(
    IPC_CHANNELS.centerServerSettingsSave,
    async (payload: CenterServerSettingsInput) => {
      const snapshot = await centerServerClient.saveSettings(payload);
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

  registerDesktopCommand(IPC_CHANNELS.centerServerListBindings, async () =>
    centerServerClient.listBindings(),
  );

  registerDesktopCommand(IPC_CHANNELS.centerServerListPresence, async () =>
    centerServerClient.listPresence(),
  );

  registerDesktopCommand(IPC_CHANNELS.centerServerRevokeBinding, async (bindingId: string) =>
    centerServerClient.revokeBinding(bindingId),
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
    IPC_CHANNELS.centerServerRemoveConnection,
    async (options?: { forceLocal?: boolean }) => {
      const snapshot = await centerServerClient.removeConnection(options);
      emitSettingsUpdated();
      return snapshot;
    },
  );

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
    const coreKind = payload.coreKind ?? "claude";
    if (!isCoreKind(coreKind)) {
      throw new Error(`Unsupported Core: ${String(payload.coreKind)}`);
    }
    if (coreKind === "codex" && !isCodexCliAvailable()) {
      throw new Error("Codex Core 不可用：未找到可执行的 Codex CLI。请安装工作区依赖或设置 CODEX_EXECUTABLE。");
    }

    const workspace = await ensureWorkspace(payload.workspacePath);
    const threadRuntime = parseThreadRuntimeConfigInput(payload.runtimeConfig);
    if (coreKind === "codex") {
      assertCodexRuntimeConfigSupported(threadRuntime);
    }
    const settings = getModelSettingsSnapshot();
    const roleRoutes = roleRoutesForThreadConfig(settings, threadRuntime);
    const runtimeConfig = resolveRuntimeConfigForThreadConfig(settings, threadRuntime, roleRoutes);
    const sessionMode = resolveSessionMode(threadRuntime);
    const routeAsk = sessionMode === "ask";
    const routePlan = sessionMode === "plan";
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
      coreKind,
      coreLockedAt: now,
      message: runtimeConfig.ok
        ? routeAsk
          ? "正在回答…"
          : routePlan
            ? "正在分析并制定计划…"
            : coreKind === "codex"
              ? "正在启动 Codex…"
              : "正在启动 Claude Agent SDK…"
        : runtimeConfig.reason,
      runtimeConfig: threadRuntime,
    };

    conversationStore.saveThread(thread);
    recordUserPrompt(thread.id, prompt, payload.attachments);
    emitThreadEvent(thread.id, status === "blocked" ? "thread.blocked" : "thread.started", thread.message);

    if (runtimeConfig.ok) {
      scheduleThreadTitleSummary(thread.id, runtimeConfig);
      void threadRuntimeCoordinator.start(coreKind, {
        thread,
        workspace,
        runtimeConfig,
        prompt,
        ...(payload.attachments?.length ? { attachments: payload.attachments } : {}),
        roleRoutes,
      });
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
    desktopEventCenter.publishThreadLiveEvent({
      threadId: request.threadId,
      type: "clarification.answered",
      message: "状态已更新",
      role: "tool",
      stream: false,
    });
    return { ok: true as const };
  });

  registerDesktopCommand(IPC_CHANNELS.clarificationSubmit, async (payload: unknown) => {
    if (!isClarificationSubmitPayload(payload)) {
      throw new Error("Invalid clarification payload.");
    }
    const request = getPendingClarificationByToolUseId(payload.toolUseId);
    if (!request) {
      throw new Error("No pending clarification for this tool use.");
    }
    const ok = submitClarification(payload.toolUseId, {
      toolUseId: payload.toolUseId,
      selections: payload.selections,
    });
    if (!ok) {
      throw new Error("Failed to submit clarification.");
    }
    desktopEventCenter.publishThreadLiveEvent({
      threadId: request.threadId,
      type: "clarification.answered",
      message: "状态已更新",
      role: "tool",
      stream: false,
    });
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
    const pendingApproval = getPendingBashApprovalByToolUseId(payload.toolUseId);
    if (!pendingApproval) {
      throw new Error("No pending Bash approval for this tool use.");
    }
    const ok = resolvePendingBashApproval(payload.toolUseId, {
      decision: payload.decision,
      ...(payload.feedback?.trim() ? { feedback: payload.feedback.trim() } : {}),
    });
    if (!ok) {
      throw new Error("Failed to resolve Bash approval.");
    }
    desktopEventCenter.publishThreadLiveEvent({
      threadId: pendingApproval.threadId,
      type: "bash_approval.resolved",
      message: "状态已更新",
      role: "tool",
      stream: false,
      bashApproval: pendingApproval,
    });
    return { ok: true as const };
  });

  registerDesktopCommand(IPC_CHANNELS.threadGetUsageSnapshot, async (threadId: unknown) => {
    if (typeof threadId !== "string" || !threadId.trim()) {
      return {} satisfies ThreadUsageSnapshotResult;
    }
    return buildThreadUsageSnapshotResult(threadId.trim(), buildThreadUsageSnapshotServices());
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

  registerDesktopCommand(IPC_CHANNELS.threadGetApprovedPlan, async (threadId: unknown) => {
    if (typeof threadId !== "string" || !threadId.trim()) {
      return undefined;
    }
    return buildThreadApprovedPlanView(threadId.trim());
  });

  registerDesktopCommand(IPC_CHANNELS.threadApprovePlan, async (payload: unknown) => {
    const request = parseThreadApprovePlanPayload(payload);
    const { threadId } = request;
    const approvalThread = conversationStore.getThread(threadId);
    if (!approvalThread) {
      throw new Error("Thread was not found.");
    }
    requireThreadCore(approvalThread, "claude", "approve a Claude plan");
    const pendingBridge = getPendingPlanApprovalForThread(threadId);
    const pendingRuntimeConfig = request.runtimeConfig
      ? parseThreadRuntimeConfigInput(request.runtimeConfig)
      : undefined;
    if (pendingRuntimeConfig) {
      roleRoutesForThreadConfig(getModelSettingsSnapshot(), pendingRuntimeConfig);
    }

    const approval = resolveThreadPlanApprovalRuntime(threadId, {
      getThread: (id) => conversationStore.getThread(id),
      hasActiveRun: (id) => activeRunRuntimeState.hasRun(id),
      getPendingPlan: (id) => conversationStore.getPendingPlan(id),
      getPendingPlanApproval: (id) => getPendingPlanApprovalForThread(id),
      resolveRoleRoutes: (id) =>
        pendingRuntimeConfig
          ? roleRoutesForThreadConfig(getModelSettingsSnapshot(), pendingRuntimeConfig)
          : resolveRoleRoutesForThread(id),
      resolveRuntimeConfig: (routes) => resolveRuntimeConfigForThreadId(threadId, routes),
    });

    if (pendingRuntimeConfig) {
      conversationStore.saveThreadRuntimeConfig(threadId, pendingRuntimeConfig);
    }

    if (pendingBridge) {
      commitThreadPlanApprovalToAgentMode(threadId, "bridge_plan_approved");
      if (!resolvePendingPlanApproval(pendingBridge.toolUseId, "approved")) {
        throw new Error("No pending plan approval is active for this thread.");
      }
      endPlanningPassAfterPlanReady.add(threadId);
      deferredPlanExecutionByThread.set(threadId, {
        runtimeConfig: approval.runtimeConfig,
        ...(approval.roleRoutes ? { routesOverride: approval.roleRoutes } : {}),
      });
      return { thread: ensureThreadRuntimeConfig(conversationStore.getThread(threadId) ?? approval.thread) };
    }

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
    const pendingBridge = getPendingPlanApprovalForThread(threadId);
    if (pendingBridge) {
      resolvePendingPlanApproval(pendingBridge.toolUseId, "denied");
      return { thread: conversationStore.getThread(threadId) };
    }
    await dismissPendingPlan(threadId, "计划忽略");
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

  registerDesktopCommand(IPC_CHANNELS.threadCancel, async (payload: unknown) => {
    const request = parseThreadCancelRequest(payload);
    if (!request) {
      return;
    }
    const { threadId, worktreeDisposition } = request;
    const owner = conversationStore.getThread(threadId)?.coreKind;
    if (owner) {
      await threadRuntimeCoordinator.cancel(owner, threadId);
    }
    if (worktreeDisposition) {
      pendingCancelDisposition.set(threadId, worktreeDisposition);
    }
    if (activeRunRuntimeState.abortRun(threadId, "cancelled by user")) {
      updateThread(threadId, { status: "running", message: "正在停止…" });
      cancelClarificationsForThread(threadId, "cancelled by user");
      cancelBashApprovalsForThread(threadId, "cancelled by user");
      cancelPlanApprovalsForThreadWithStoreCleanup(threadId, "cancelled by user");
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
  syncGitAutoFetcherWorkspace();
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

function emitThreadTitleDelta(threadId: string, preview: string): void {
  const thread = conversationStore.getThread(threadId);
  if (!thread || !shouldReplaceAutoThreadTitle(thread.title)) {
    return;
  }
  emitThreadEvent(threadId, "thread.title_delta", "", "system", false, { title: preview });
}

function applyThreadTitleSummary(threadId: string, title: string): void {
  const thread = conversationStore.getThread(threadId);
  if (!thread || thread.title === title || !shouldReplaceAutoThreadTitle(thread.title)) {
    return;
  }

  conversationStore.updateThreadTitle(threadId, title);
  emitThreadEvent(threadId, "thread.title_updated", "标题已更新", "system", false, { title });
}

function emitThreadTitleFailure(threadId: string): void {
  const thread = conversationStore.getThread(threadId);
  if (!thread || !shouldReplaceAutoThreadTitle(thread.title)) {
    return;
  }
  emitThreadEvent(threadId, "thread.title_failed", "会话标题生成失败", "system", false);
}

function scheduleThreadTitleSummary(threadId: string, runtimeConfig: RuntimeConfig): void {
  const thread = conversationStore.getThread(threadId);
  if (!thread || !shouldReplaceAutoThreadTitle(thread.title)) {
    return;
  }

  const prompt = thread.prompt;
  let lastEmittedPreview = "";
  void summarizeThreadTitle(runtimeConfig.routes, prompt, fetch, (preview) => {
    if (preview === lastEmittedPreview) {
      return;
    }
    lastEmittedPreview = preview;
    emitThreadTitleDelta(threadId, preview);
  })
    .then((title) => {
      if (title) {
        applyThreadTitleSummary(threadId, title);
        return;
      }
      emitThreadTitleFailure(threadId);
    })
    .catch((error) => {
      process.stderr.write(`[eco] title summary failed: ${errorMessage(error)}\n`);
      emitThreadTitleFailure(threadId);
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
        emitThreadEvent(event.threadId, "thread.awaiting_plan", event.message, "planner", false, {
          plan: event.plan,
        });
      },
    },
  });

  return result.planCaptured;
}

function markThreadInterrupted(threadId: string, reason: string): void {
  const summary = formatUserFacingRequestError(reason);
  const truncated = summary.length > 240 ? `${summary.slice(0, 237)}…` : summary;
  process.stderr.write(`[eco] thread blocked (${threadId}): ${truncated}\n`);
  patchThreadSummary(threadId, {
    status: "blocked",
    message: truncated,
  });
  emitThreadEvent(threadId, "thread.blocked", truncated, "system", false, {
    metadata: { activityOrigin: "eco.thread_blocked" },
  });
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
    (line) => line.role === "system" && (line.message.includes("已停止") || line.message.includes("检查点")),
  );
}

function runThreadRequestOnce(
  threadId: string,
  phase: RunAttemptPhase,
  signal: AbortSignal | undefined,
  runOnce: () => Promise<RequestAttemptResult>,
): Promise<RequestAttemptResult> {
  return runThreadRequestWithLifecycle({
    threadId,
    phase,
    runOnce,
    lifecycle: agentLifecycle,
    settlements: usageLedgerCoordinator,
    ...(signal && { signal }),
  });
}

function cancelPlanApprovalsForThreadWithStoreCleanup(threadId: string, reason: string): void {
  if (cancelPlanApprovalsForThread(threadId, reason)) {
    conversationStore.clearPendingPlan(threadId);
  }
}

const deferredRunCleanupByThread = new Map<string, FinalizeThreadRunCleanupInput>();

async function awaitThreadRunUserGates(threadId: string): Promise<void> {
  const planWait = getPendingPlanApprovalWaitForThread(threadId);
  if (planWait) {
    await planWait.catch(() => {});
  }
}

async function retryDeferredRunCleanupIfNeeded(threadId: string): Promise<void> {
  const deferred = deferredRunCleanupByThread.get(threadId);
  if (!deferred) {
    return;
  }
  if (
    shouldDeferRunCleanupFinish({
      hasPendingBridgeApproval: Boolean(getPendingPlanApprovalForThread(threadId)),
      hasPendingClarification: Boolean(getPendingClarificationForThread(threadId)),
    })
  ) {
    return;
  }
  deferredRunCleanupByThread.delete(threadId);
  await finalizeMainThreadRunCleanup(deferred);
}

async function finalizeMainThreadRunCleanup(input: FinalizeThreadRunCleanupInput): Promise<void> {
  await awaitThreadRunUserGates(input.threadId);
  if (
    shouldDeferRunCleanupFinish({
      hasPendingBridgeApproval: Boolean(getPendingPlanApprovalForThread(input.threadId)),
      hasPendingClarification: Boolean(getPendingClarificationForThread(input.threadId)),
    })
  ) {
    deferredRunCleanupByThread.set(input.threadId, input);
    return;
  }
  deferredRunCleanupByThread.delete(input.threadId);
  await finalizeThreadRunCleanup(input, {
    cancelClarifications: cancelClarificationsForThread,
    cancelBashApprovals: cancelBashApprovalsForThread,
    cancelPlanApprovals: cancelPlanApprovalsForThreadWithStoreCleanup,
    shouldPreservePlanApprovals: (threadId) => {
      const threadStatus = conversationStore.getThread(threadId)?.status;
      return shouldPreservePlanApprovalsOnRunCleanup({
        hasPendingBridgeApproval: Boolean(getPendingPlanApprovalForThread(threadId)),
        ...(threadStatus && { threadStatus }),
        hasStoredPendingPlan: Boolean(conversationStore.getPendingPlan(threadId)),
      });
    },
    shouldPreserveClarifications: (threadId) => Boolean(getPendingClarificationForThread(threadId)),
    shouldDeferRunCleanupFinish: (threadId) =>
      shouldDeferRunCleanupFinish({
        hasPendingBridgeApproval: Boolean(getPendingPlanApprovalForThread(threadId)),
        hasPendingClarification: Boolean(getPendingClarificationForThread(threadId)),
      }),
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
  if (
    shouldBlockThreadFollowUpDrain({
      hasPendingBridgeApproval: Boolean(getPendingPlanApprovalForThread(threadId)),
      hasPendingClarification: Boolean(getPendingClarificationForThread(threadId)),
      ...(thread?.status && { threadStatus: thread.status }),
      hasStoredPendingPlan: Boolean(conversationStore.getPendingPlan(threadId)),
    })
  ) {
    return;
  }
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

function dispatchClaudeThreadStart(input: ThreadCoreStartRunInput): void {
  requireThreadCore(input.thread, "claude", "start a Claude thread");
  const sessionMode = resolveSessionMode(input.thread.runtimeConfig);
  if (sessionMode === "ask") {
    void runAskThread(
      input.thread,
      input.workspace,
      input.runtimeConfig,
      input.prompt,
      undefined,
      undefined,
      input.attachments,
      input.roleRoutes,
    );
    return;
  }
  if (sessionMode === "plan") {
    void runPlanThread(
      input.thread,
      input.workspace,
      input.runtimeConfig,
      input.prompt,
      undefined,
      undefined,
      input.attachments,
      input.roleRoutes,
    );
    return;
  }
  void runCodingThreadAutonomous(
    input.thread,
    input.workspace,
    input.runtimeConfig,
    input.prompt,
    undefined,
    undefined,
    input.attachments,
    input.roleRoutes,
  );
}

async function startCodexThreadContinuation(
  input: StartThreadContinuationInput,
): Promise<ThreadContinueResult> {
  const prompt = input.prompt.trim();
  if (!prompt && !input.attachments?.length) {
    throw new Error("Message is required.");
  }
  const thread = conversationStore.getThread(input.threadId);
  if (!thread) {
    throw new Error("Thread was not found.");
  }
  requireThreadCore(thread, "codex", "continue with Codex");
  if (thread.status === "running" || thread.status === "queued") {
    throw new Error("Wait for the current run to finish.");
  }
  const binding = conversationStore.getThreadCoreSession(thread.id);
  if (binding?.coreKind !== "codex" || !binding.externalSessionId.trim()) {
    throw new Error("Codex thread binding is missing; continuing would create a different conversation.");
  }
  const settings = getModelSettingsSnapshot();
  if (input.runtimeConfigInput) {
    const next = parseThreadRuntimeConfigInput(input.runtimeConfigInput);
    roleRoutesForThreadConfig(settings, next);
    conversationStore.saveThreadRuntimeConfig(thread.id, next);
  }
  const activeThread = ensureThreadRuntimeConfig(conversationStore.getThread(thread.id) ?? thread);
  const threadConfig = activeThread.runtimeConfig;
  if (!threadConfig) {
    throw new Error("Thread runtime configuration is missing.");
  }
  assertCodexRuntimeConfigSupported(threadConfig);
  const roleRoutes = roleRoutesForThreadConfig(settings, threadConfig);
  const runtime = resolveRuntimeConfigForThreadConfig(settings, threadConfig, roleRoutes);
  if (!runtime.ok) {
    throw new Error(runtime.reason);
  }

  updateThread(thread.id, { status: "running", message: "" });
  if (!input.rewindTarget) {
    recordUserPrompt(thread.id, input.displayPrompt?.trim() || prompt, input.attachments);
  }
  const updated = ensureThreadRuntimeConfig(conversationStore.getThread(thread.id) ?? activeThread);
  void startCodexThreadRun({
    thread: updated,
    workspace: await ensureWorkspace(thread.workspacePath),
    runtimeConfig: { routes: runtime.routes },
    prompt,
    ...(input.attachments?.length ? { attachments: input.attachments } : {}),
    roleRoutes,
    continuation: true,
    ...(input.rewindTarget ? { rewindTarget: input.rewindTarget } : {}),
    ...(input.displayPrompt?.trim() ? { displayPrompt: input.displayPrompt.trim() } : {}),
  });
  return { thread: updated };
}

async function startCodexThreadRun(
  input: ThreadCoreStartRunInput & {
    continuation: boolean;
    rewindTarget?: ThreadActivityRewindTarget;
    displayPrompt?: string;
  },
): Promise<void> {
  requireThreadCore(input.thread, "codex", input.continuation ? "continue with Codex" : "start Codex");
  const mode = resolveSessionMode(input.thread.runtimeConfig);
  const controller = new AbortController();
  startActiveRun(input.thread.id, {
    controller,
    worktreePlan: createSessionPlan(input.workspace.path, input.thread.id),
  });

  let worktreePlan = createSessionPlan(input.workspace.path, input.thread.id);
  let cwd = input.workspace.path;
  try {
    if (mode !== "ask") {
      const resolved = await resolveThreadWorktree(input.workspace, input.thread.id);
      worktreePlan = resolved.worktreePlan;
      cwd = resolved.cwd;
      activeRunRuntimeState.setWorktreePlan(input.thread.id, worktreePlan);
    }

    const codexSkills = await resolveCodexThreadSkills(input.thread.id, cwd);
    const outcome = await runThreadRequestOnce(
      input.thread.id,
      runAttemptPhaseFromThreadMode(mode === "plan" ? "planning" : mode === "ask" ? "ask" : "execution"),
      controller.signal,
      async () => {
        const mainPrompt = await resolvePromptImagesForMainContext({
          threadId: input.thread.id,
          prompt: input.prompt,
          ...(input.attachments?.length ? { attachments: input.attachments } : {}),
          ...(input.roleRoutes ? { routesOverride: input.roleRoutes } : {}),
          signal: controller.signal,
        });
        return runCodexThreadRequest({
          threadId: input.thread.id,
          resolveRuntimeConfig: () => resolveRuntimeConfigForThreadId(input.thread.id, input.roleRoutes),
          resolveAgentRegistry: () => resolveAgentRuntimeConfigForThreadId(input.thread.id),
          resolveExecutionConfirmationMode: () =>
            ensureThreadRuntimeConfig(
              conversationStore.getThread(input.thread.id) ?? input.thread,
            ).runtimeConfig?.bashReviewMode ?? "always",
          resolveSubagentAvailability: () =>
            ensureThreadRuntimeConfig(
              conversationStore.getThread(input.thread.id) ?? input.thread,
            ).runtimeConfig?.subagentEnabled,
          resolveMcpServers: () => {
            const allEnabled = listEnabledGlobalMcpServerKeys(mcpStore.listServers());
            return prepareCodexMcpServersForRuntime(
              buildCodexMcpServersForConfigSync(mcpStore.listServers(), allEnabled),
            );
          },
          resolveEnabledMcpServerKeys: () => resolveCodexThreadMcpServerKeys(input.thread.id),
          resolveSkillConfig: () =>
            codexSkills.map(({ skill, enabled }) => ({ path: skill.skillFilePath, enabled })),
          onPrepared: async () => {
            if (input.rewindTarget) {
              await rollbackCodexThreadForEcoThread({
                ecoThreadId: input.thread.id,
                targetItemId: input.rewindTarget.userMessageId,
              });
              recordUserPrompt(
                input.thread.id,
                input.displayPrompt?.trim() || input.prompt,
                input.attachments,
              );
            }
            await codexFileCheckpointStore.capturePending(input.thread.id, cwd);
          },
          recordRouteFingerprint: recordThreadRouteFingerprint,
          onProxyReady: ({ plannerRoute }) => {
            updateThread(input.thread.id, {
              status: "running",
              message: `Codex 已连接 · ${plannerRoute?.modelId ?? "model unknown"}`,
            });
          },
          run: async ({ routes }) => {
            const driver = createCodexRuntimeDriver(input.thread.id, mode);
            try {
              const agentRegistry = resolveAgentRuntimeConfigForThreadId(input.thread.id);
              const runInput = {
                threadId: input.thread.id,
                prompt: mainPrompt,
                workspacePath: input.workspace.path,
                worktreePath: cwd,
                routes,
                signal: controller.signal,
                codexSession: {
                  ...(await buildCodexSessionOptions(input.thread.id, mainPrompt, cwd)),
                },
                ...(agentRegistry ? { agentRegistry } : {}),
              };
              const events = input.continuation && driver.runContinuation
                ? driver.runContinuation(
                    runInput,
                    mode === "plan" ? "planning" : mode === "ask" ? "ask" : "execution",
                  )
                : mode === "plan" && driver.runPlan
                  ? driver.runPlan(runInput)
                  : mode === "ask" && driver.runAsk
                    ? driver.runAsk(runInput)
                    : driver.run(runInput);
              for await (const event of events) {
                if (event.type === "agent.started" || event.type === "agent.completed") {
                  process.stderr.write(`[eco-codex] ${event.type} thread=${input.thread.id}\n`);
                }
              }
              return controller.signal.aborted
                ? { ok: false, reason: "cancelled by user", aborted: true }
                : { ok: true };
            } catch (error) {
              return controller.signal.aborted
                ? { ok: false, reason: "cancelled by user", aborted: true }
                : { ok: false, reason: errorMessage(error) };
            } finally {
              driver.dispose();
            }
          },
        });
      },
    );

    if (!outcome.ok) {
      if (outcome.aborted) {
        await handleRunCancelled(input.thread.id, worktreePlan);
      } else {
        markThreadInterrupted(input.thread.id, outcome.reason);
      }
      return;
    }

    if (mode === "agent") {
      await completeCodingThreadRun(input.thread.id, worktreePlan);
    } else if (mode === "ask") {
      updateThread(input.thread.id, { status: "completed", message: "回答完成。" });
    } else if (conversationStore.getThread(input.thread.id)?.status !== "awaiting_plan") {
      updateThread(input.thread.id, { status: "idle", message: "计划会话已结束。" });
    }
  } catch (error) {
    markThreadInterrupted(input.thread.id, errorMessage(error));
  } finally {
    await finalizeMainThreadRunCleanup({
      threadId: input.thread.id,
      worktreePath: cwd,
      idleFallbackMessage: "Codex 运行已结束。",
    });
  }
}

function assertCodexRuntimeConfigSupported(_runtimeConfig: ThreadRuntimeConfig): void {
  // Codex-specific admission is performed by prepareCodexRuntime so errors identify the exact server/profile.
}

function resolveCodexThreadMcpServerKeys(threadId: string): string[] {
  const thread = conversationStore.getThread(threadId);
  const hydrated = thread ? ensureThreadRuntimeConfig(thread) : undefined;
  return resolveThreadRuntimeMcpServerKeys({
    ...(hydrated?.runtimeConfig ? { runtimeConfig: hydrated.runtimeConfig } : {}),
    settings: getModelSettingsSnapshot(),
    availableMcpServerKeys: listEnabledGlobalMcpServerKeys(mcpStore.listServers()),
  });
}

async function resolveCodexThreadSkills(
  threadId: string,
  workspacePath: string,
): Promise<Array<{ skill: SkillInfo; enabled: boolean }>> {
  const thread = conversationStore.getThread(threadId);
  const settings = thread ? ensureThreadRuntimeConfig(thread).runtimeConfig?.skillsEnabled : undefined;
  const discovered = await listDiscoveredSkills(workspacePath);
  return [...discovered.userSkills, ...discovered.projectSkills]
    .filter(
      (skill) =>
        (skill.layout === "agents" || skill.layout === "codex") &&
        !/[/\\]\.codex[/\\]skills[/\\]\.system[/\\]/.test(skill.skillFilePath),
    )
    .map((skill) => ({
      skill,
      enabled: settings?.[skill.settingsKey ?? skill.skillFilePath] ?? skill.source === "project",
    }));
}

async function buildCodexSessionOptions(threadId: string, prompt: string, workspacePathOverride?: string) {
  const thread = conversationStore.getThread(threadId);
  const workspacePath = workspacePathOverride ?? thread?.workspacePath ?? currentWorkspace?.path;
  if (!workspacePath) return {};
  const resolved = await resolveCodexThreadSkills(threadId, workspacePath);
  const skillInputs = resolveExplicitCodexSkillInputs(
    prompt,
    resolved.filter((entry) => entry.enabled).map((entry) => entry.skill),
  );
  return skillInputs.length > 0 ? { skillInputs } : {};
}

async function runAskThread(
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
    const outcome = await runThreadRequestOnce(thread.id, "ask", controller.signal, async () => {
      const mainPrompt = await resolvePromptImagesForMainContext({
        threadId: thread.id,
        prompt,
        ...(attachments?.length ? { attachments } : {}),
        ...(routesOverride ? { routesOverride } : {}),
        signal: controller.signal,
      });
      return runThreadRequestWithRuntimeProxy({
        threadId: thread.id,
        resolveRuntimeConfig: () => resolveRuntimeConfigForThreadId(thread.id, routesOverride),
        recordRouteFingerprint: recordThreadRouteFingerprint,
        startRuntimeProxy,
        onProxyReady: ({ proxy }) => {
          process.stderr.write(`[eco] 模型代理: ${proxy.baseUrl} · 上游日志: ${getUpstreamLogFilePath()}\n`);
          updateThread(thread.id, {
            status: "running",
            message: `Local model router ready: ${proxy.baseUrl}`,
          });
        },
        run: async ({ proxy: attemptProxy, routes }) => {
          const prepared = await prepareSdkRunAfterContextCompaction({
            threadId: thread.id,
            prompt: mainPrompt,
            worktreePath: cwd,
            resume: resume ?? resolveResumeOptions(thread.id, cwd),
            signal: controller.signal,
          });
          try {
            const driver = createSdkDriver(thread.id, attemptProxy, undefined, "ask");
            if (!driver.runAsk) {
              throw new Error("Runtime driver does not support ask mode.");
            }

            return await consumeSdkRunEvents({
              events: driver.runAsk(
                buildSdkRunInput({
                  threadId: thread.id,
                  prompt: prepared.prompt,
                  workspacePath: workspace.path,
                  worktreePath: cwd,
                  routes,
                  signal: controller.signal,
                  sdkSession: await buildSdkSessionOptions(thread.id, prepared.prompt),
                  agentRegistry: resolveAgentRuntimeConfigForThread(thread),
                  ...(prepared.resume ? { resume: prepared.resume } : {}),
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
    });

    const decision = resolveAskRunOutcome(outcome);
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

async function runPlanThread(
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

  let worktreePlan = createSessionPlan(workspace.path, thread.id);
  let planningPlanCaptured = false;

  try {
    const { worktreePlan: resolvedPlan, cwd: resolvedCwd } = await resolveThreadWorktree(
      workspace,
      thread.id,
      worktreePlan,
    );
    worktreePlan = resolvedPlan;
    const effectiveCwd = worktreePath?.trim() || resolvedCwd;
    activeRunRuntimeState.setWorktreePlan(thread.id, worktreePlan);

    const outcome = await runThreadRequestOnce(thread.id, "planning", controller.signal, async () => {
      const mainPrompt = await resolvePromptImagesForMainContext({
        threadId: thread.id,
        prompt,
        ...(attachments?.length ? { attachments } : {}),
        ...(routesOverride ? { routesOverride } : {}),
        signal: controller.signal,
      });
      return runThreadRequestWithRuntimeProxy({
        threadId: thread.id,
        resolveRuntimeConfig: () => resolveRuntimeConfigForThreadId(thread.id, routesOverride),
        recordRouteFingerprint: recordThreadRouteFingerprint,
        startRuntimeProxy,
        onProxyReady: ({ proxy }) => {
          process.stderr.write(`[eco] 模型代理: ${proxy.baseUrl} · 上游日志: ${getUpstreamLogFilePath()}\n`);
          updateThread(thread.id, {
            status: "running",
            message: `Local model router ready: ${proxy.baseUrl}`,
          });
        },
        run: async ({ proxy: attemptProxy, routes }) => {
          const prepared = await prepareSdkRunAfterContextCompaction({
            threadId: thread.id,
            prompt: mainPrompt,
            worktreePath: effectiveCwd,
            resume: resume ?? resolveResumeOptions(thread.id, effectiveCwd),
            signal: controller.signal,
          });
          try {
            const driver = createSdkDriver(thread.id, attemptProxy, undefined, "planning");
            if (!driver.runPlan) {
              throw new Error("Runtime driver does not support plan mode.");
            }

            const result = await consumeSdkRunEvents({
              events: driver.runPlan(
                buildSdkRunInput({
                  threadId: thread.id,
                  prompt: prepared.prompt,
                  workspacePath: workspace.path,
                  worktreePath: effectiveCwd,
                  routes,
                  signal: controller.signal,
                  sdkSession: await buildSdkSessionOptions(thread.id, prepared.prompt, {
                    skillsScope: "planning",
                  }),
                  agentRegistry: resolveAgentRuntimeConfigForThread(thread),
                  ...(prepared.resume ? { resume: prepared.resume } : {}),
                }),
              ),
              threadId: thread.id,
              worktreePath: effectiveCwd,
              signal: controller.signal,
              onUsageRecorded: onSdkUsageRecordedEvent,
              captureSession: captureSdkSessionFromEvent,
              emitActivity: emitSdkStreamActivity,
              onEvent: (event) => {
                if (event.type === "plan.ready" && isPlanReadyPayload(event.payload)) {
                  planningPlanCaptured = captureThreadPlanReady({
                    threadId: thread.id,
                    workspacePath: workspace.path,
                    worktreePath: effectiveCwd,
                    routesJson: JSON.stringify(routes),
                    payload: event.payload,
                    awaitingPlanMessage: "Agent 请求确认计划，请审批后继续。",
                  });
                  if (endPlanningPassAfterPlanReady.delete(thread.id)) {
                    controller.abort();
                  }
                }
              },
            });
            if (!result.ok) {
              return result;
            }
            return { ok: true, planningPlanCaptured };
          } catch (error) {
            if (controller.signal.aborted) {
              return { ok: false, reason: "cancelled by user", aborted: true };
            }
            return { ok: false, reason: errorMessage(error) };
          }
        },
      });
    });

    const hasPendingPlan = planningPlanCaptured || Boolean(conversationStore.getPendingPlan(thread.id));
    const decision = resolvePlanningRunOutcome(outcome, { hasPendingPlan });
    await applyMainThreadRunDecisionEffects({
      threadId: thread.id,
      decision,
      onCancelled: async (reason) => {
        cancelClarificationsForThread(thread.id, reason);
        await handleRunCancelled(thread.id, worktreePlan);
      },
      onFailed: (reason) => {
        markThreadInterrupted(thread.id, reason);
      },
    });
  } catch (error) {
    cancelClarificationsForThread(thread.id, errorMessage(error));
    markThreadInterrupted(thread.id, errorMessage(error));
  } finally {
    const worktreePathResolved = resolveThreadWorktreePath(thread.id);
    const deferredExecution = deferredPlanExecutionByThread.get(thread.id);
    if (deferredExecution) {
      deferredPlanExecutionByThread.delete(thread.id);
      endPlanningPassAfterPlanReady.delete(thread.id);
    }
    await finalizeMainThreadRunCleanup({
      threadId: thread.id,
      worktreePath: worktreePathResolved,
      cancelClarificationsReason: "run finished",
      ...(deferredExecution ? {} : { idleFallbackMessage: "计划阶段已结束。" }),
    });
    if (deferredExecution) {
      updateThread(thread.id, {
        status: "running",
        message: "正在按计划执行…",
      });
      void runCodingThreadExecution(thread.id, deferredExecution.runtimeConfig, {
        ...(deferredExecution.routesOverride ? { routesOverride: deferredExecution.routesOverride } : {}),
      });
    }
  }
}

async function completeCodingThreadRun(threadId: string, worktreePlan: WorktreePlan): Promise<void> {
  updateThread(threadId, { status: "completed", message: "执行完成，变更已写入项目目录。" });
  if (isDirectWorkspacePlan(worktreePlan)) {
    return;
  }

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

    const runOutcome = await runThreadRequestOnce(thread.id, "execution", controller.signal, async () => {
      const mainPrompt = await resolvePromptImagesForMainContext({
        threadId: thread.id,
        prompt,
        ...(attachments?.length ? { attachments } : {}),
        ...(routesOverride ? { routesOverride } : {}),
        signal: controller.signal,
      });
      return runThreadRequestWithRuntimeProxy({
        threadId: thread.id,
        resolveRuntimeConfig: () => resolveRuntimeConfigForThreadId(thread.id, routesOverride),
        recordRouteFingerprint: recordThreadRouteFingerprint,
        startRuntimeProxy,
        onProxyReady: ({ proxy, plannerRoute }) => {
          process.stderr.write(`[eco] 模型代理: ${proxy.baseUrl} · 上游日志: ${getUpstreamLogFilePath()}\n`);
          updateThread(thread.id, {
            message: `Local model router ready: ${proxy.baseUrl}`,
            status: "running",
          });
          process.stderr.write(
            `[eco] SDK model=${plannerRoute?.modelId ?? "?"} (direct / claude_code preset)\n`,
          );
        },
        run: async ({ proxy: attemptProxy, routes }) => {
          const prepared = await prepareSdkRunAfterContextCompaction({
            threadId: thread.id,
            prompt: mainPrompt,
            worktreePath: cwd,
            resume: resumeOptsForRun,
            signal: controller.signal,
          });

          try {
            const driver = createSdkDriver(
              thread.id,
              attemptProxy,
              taskRunHooks.hookContextExtras,
              "execution",
            );
            const result = await consumeSdkRunEvents({
              events: driver.run(
                buildSdkRunInput({
                  threadId: thread.id,
                  prompt: prepared.prompt,
                  workspacePath: workspace.path,
                  worktreePath: cwd,
                  routes,
                  signal: controller.signal,
                  sdkSession: await buildSdkSessionOptions(thread.id, prepared.prompt),
                  agentRegistry: resolveAgentRuntimeConfigForThread(thread),
                  ...(prepared.resume ? { resume: prepared.resume } : {}),
                }),
              ),
              threadId: thread.id,
              worktreePath: cwd,
              signal: controller.signal,
              onUsageRecorded: onSdkUsageRecordedEvent,
              captureSession: captureSdkSessionFromEvent,
              emitActivity: emitSdkStreamActivity,
              onEvent: (event) => {
                taskRuntime.handleEvent(event);
              },
            });
            if (!result.ok) {
              return result;
            }
            return { ok: true };
          } catch (error) {
            if (controller.signal.aborted) {
              return { ok: false, reason: "cancelled by user", aborted: true };
            }
            return { ok: false, reason: errorMessage(error) };
          }
        },
      });
    });

    const runDecision = resolveAutonomousRunOutcome(runOutcome, {
      hasPendingPlan: Boolean(conversationStore.getPendingPlan(thread.id)),
      planCaptured: false,
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

  commitThreadPlanApprovalToAgentMode(threadId, "execution_started");

  const planning: EcoPlanningContext = {
    userPrompt: pending.userPrompt,
    analysis: pending.analysis,
    plan: pending.plan,
    ...(pending.planFilePath ? { planFilePath: pending.planFilePath } : {}),
    ...(options?.planUserEdited ? { planUserEdited: true } : {}),
    ...(pending.deferredExitPlanToolUseId
      ? { deferredExitPlanToolUseId: pending.deferredExitPlanToolUseId }
      : {}),
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
  const executionPlan = buildExecutionFailureRestorePendingPlan(pending);

  try {
    conversationStore.clearPendingPlan(threadId);
    emitThreadEvent(threadId, "thread.plan_cleared", "计划已进入执行阶段。", "system");

    const executionOutcome = await runThreadRequestOnce(
      threadId,
      "execution",
      controller.signal,
      async () => {
        const followUp = options?.followUp?.trim();
        const runPrompt = followUp || pending.userPrompt;
        const mainPrompt = await resolvePromptImagesForMainContext({
          threadId,
          prompt: runPrompt,
          ...(options?.attachments?.length ? { attachments: options.attachments } : {}),
          ...(options?.routesOverride ? { routesOverride: options.routesOverride } : {}),
          signal: controller.signal,
        });
        return runThreadRequestWithRuntimeProxy({
          threadId,
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

              if (!driver.runContinuation) {
                throw new Error("Runtime driver does not support session continuation.");
              }

              const prepared = await prepareSdkRunAfterContextCompaction({
                threadId,
                prompt: mainPrompt,
                worktreePath: executionCwd,
                resume: options?.resume ?? resolveResumeOptions(threadId, executionCwd),
                signal: controller.signal,
              });
              const continuationPlanning = prepared.resume
                ? planning
                : {
                    userPrompt: planning.userPrompt,
                    analysis: planning.analysis,
                    plan: planning.plan,
                    ...(planning.planFilePath ? { planFilePath: planning.planFilePath } : {}),
                    ...(planning.planUserEdited ? { planUserEdited: true } : {}),
                  };
              return await consumeSdkRunEvents({
                events: driver.runContinuation(
                  buildSdkRunInput({
                    threadId,
                    prompt: prepared.prompt,
                    workspacePath: pending.workspacePath,
                    worktreePath: executionCwd,
                    routes: attemptRoutes,
                    signal: controller.signal,
                    sdkSession: await buildSdkSessionOptions(threadId, prepared.prompt),
                    agentRegistry: resolveAgentRuntimeConfigForThreadId(threadId),
                    ...(prepared.resume ? { resume: prepared.resume } : {}),
                    ...(prepared.resume && {
                      resumableSubagents: listResumableSubagentRefs(threadId, "execution"),
                    }),
                  }),
                  "execution",
                  continuationPlanning,
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
  const thread = conversationStore.getThread(input.threadId);
  if (!thread) {
    throw new Error("Thread was not found.");
  }
  if (!thread.coreKind) {
    throw new Error(`Thread ${thread.id} has unknown Core ownership.`);
  }
  return threadRuntimeCoordinator.continue(thread.coreKind, input);
}

async function startClaudeThreadContinuation(input: StartThreadContinuationInput): Promise<ThreadContinueResult> {
  const prompt = input.prompt.trim();
  const hasAttachments = Boolean(input.attachments?.length);
  if (!prompt && !hasAttachments) {
    throw new Error("Message is required.");
  }
  const thread = conversationStore.getThread(input.threadId);
  if (!thread) {
    throw new Error("Thread was not found.");
  }
  requireThreadCore(thread, "claude", "continue with Claude");
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
  const sessionMode = threadSessionMode(input.threadId);
  const activityLines = input.rewindTarget
    ? activityLinesBeforeRewindTarget(
        await listThreadActivityFromSdkSession(input.threadId),
        input.rewindTarget,
      )
    : await listThreadActivityFromSdkSession(input.threadId);
  const compactHandoff = conversationStore.getCompactHandoff(input.threadId);
  const sdkSession = conversationStore.getSdkSession(input.threadId);
  const cwd = normalizeSessionCwd(workspace.path, sdkSession?.cwd);
  const canResume = compactHandoff
    ? false
    : Boolean(
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
    sessionMode,
    followUp: prompt,
    canResume,
    hasPendingPlan,
    hasApprovedPlanOnDisk,
    enteredExecutionPhase,
    hasCoderTodos,
    hasAppliedDiff,
    threadStatus: effectiveThread.status,
    activityLines,
  });

  const agentPrompt = compactHandoff
    ? buildEcoCompactHandoffPrompt(effectiveThread.prompt, prompt, compactHandoff)
    : continueAction.kind === "resume_sdk" || continueAction.kind === "resume_execution"
      ? prompt
      : buildAgentPromptWithContext(effectiveThread.prompt, prompt, activityLines);
  const statusMessage = continueStatusMessage(continueAction);

  updateThread(input.threadId, {
    status: "running",
    message: statusMessage,
  });
  recordUserPrompt(input.threadId, input.displayPrompt?.trim() || prompt, input.attachments);
  if (input.rewindTarget) {
    // Publish the new history revision only after its replacement prompt exists.
    // An empty rewind projection can otherwise race the renderer refresh and make
    // a live continuation look as though it was never submitted.
    emitThreadRunProjectionUpdated(input.threadId);
  }

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
  return Boolean(
    getPendingClarificationForThread(threadId) ||
      getPendingBashApprovalForThread(threadId) ||
      getPendingPlanApprovalForThread(threadId),
  );
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
    logEcoDiagThrottled(
      `sdk-session-route-change:${threadId}`,
      "sdk_session.route_changed",
      {
        threadId: shortThreadId(threadId),
        message: "SDK session route fingerprint changed; resume fallback remains internal.",
      },
      30_000,
    );
  }
}

function recordThreadRouteFingerprint(threadId: string, routes: readonly RuntimeRoute[]): void {
  conversationStore.saveRouteFingerprint(threadId, computeRouteFingerprint(roleRoutesFromRuntime(routes)));
}

/** After a crash, SQLite may still say running while no runtime run is active. */
function recoverOrphanedRunningThreads(): void {
  for (const thread of conversationStore.listThreads()) {
    if (!activeRunRuntimeState.hasRun(thread.id)) {
      settleRecoveredLifecycleRecords(thread.id, "failed");
    }
  }
  for (const thread of conversationStore.listThreads()) {
    if (activeRunRuntimeState.hasRun(thread.id)) {
      continue;
    }
    const pendingPlan = conversationStore.getPendingPlan(thread.id);
    const recoveryAction = resolveOrphanedThreadRecoveryAction({
      status: thread.status,
      hasActiveRun: false,
      hasPendingPlan: Boolean(pendingPlan),
    });
    if (recoveryAction === "awaiting_plan") {
      restoreThreadAwaitingPlanAfterRecovery(thread.id);
      continue;
    }
    if (recoveryAction !== "idle") {
      continue;
    }
    updateThread(thread.id, {
      status: "idle",
      message: "应用已意外退出。可在本对话继续发送消息。",
    });
    emitThreadEvent(thread.id, "thread.idle", "已从异常退出恢复。", "system");
  }
}

function restoreThreadAwaitingPlanAfterRecovery(threadId: string): void {
  const pendingPlan = conversationStore.getPendingPlan(threadId);
  if (!pendingPlan) {
    return;
  }
  updateThread(threadId, {
    status: "awaiting_plan",
    message: "计划已生成，请确认是否执行。",
  });
  emitThreadEvent(threadId, "thread.awaiting_plan", "已从异常退出恢复，待批准计划。", "system", false, {
    plan: {
      userPrompt: pendingPlan.userPrompt,
      analysis: pendingPlan.analysis,
      plan: pendingPlan.plan,
    },
  });
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
  if (!isDirectWorkspacePlan(worktreePlan)) {
    try {
      await gitWorktrees.discardWorktreeChanges(worktreePlan);
      emitThreadEvent(threadId, "worktree.restored", "已回退隔离工作树中的未批准更改。", "system");
    } catch (error) {
      console.error("Failed to restore worktree after execution failure:", error);
    }
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
    await handleRunCancelled(threadId, dismissal.worktreePlan, message);
    return;
  }
  updateThread(threadId, { status: "idle", message: dismissal.message });
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
  const coreSessionCwd = conversationStore.getThreadCoreSession(threadId)?.cwd;
  if (coreSessionCwd?.trim()) {
    hintInput.coreSessionCwd = coreSessionCwd.trim();
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
  requireThreadCore(thread, "claude", "rewind a Claude session");
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
  if (isDirectWorkspacePlan(plan)) {
    return { exists: false, worktreePath: workspacePath, workspacePath, changedFiles: [] };
  }

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
  if (isDirectWorkspacePlan(plan)) {
    throw new Error("该对话没有可合并的隔离工作树。");
  }

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

async function listThreadActivityFromSdkSession(threadId: string): Promise<ThreadActivityLine[]> {
  return listSdkSessionActivityLines(threadId, {
    getSdkSession: (id) => conversationStore.getSdkSession(id),
    writeError: (message) => process.stderr.write(message),
  });
}

async function listThreadCompactionActivityFromSdkSession(threadId: string): Promise<ThreadActivityLine[]> {
  return listSdkSessionCompactionActivityLines(threadId, {
    getSdkSession: (id) => conversationStore.getSdkSession(id),
    writeError: (message) => process.stderr.write(message),
  });
}

async function listSubagentActivityFromSdkSession(
  threadId: string,
  agentId: string,
): Promise<ThreadActivityLine[]> {
  return listSdkSubagentActivityLines(threadId, agentId, {
    getSdkSession: (id) => conversationStore.getSdkSession(id),
    writeError: (message) => process.stderr.write(message),
  });
}

async function handleRunCancelled(
  threadId: string,
  worktreePlan: WorktreePlan,
  message?: string,
): Promise<void> {
  const explicit = takePendingCancelDisposition(pendingCancelDisposition, threadId);
  await finalizeCancelledRun(
    threadId,
    worktreePlan,
    explicit,
    createFinalizeCancelledRunDeps(),
    message,
  );
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
  const peekPendingCoderTodoId = extras?.peekPendingCoderTodoId;
  const subagentAttribution: EcoSubagentAttributionHooks = {
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
  const subagentLaunchRegistry = getThreadSubagentLaunchRegistry(threadId);
  const subagentSessions = createSubagentSessionHooks(conversationStore, threadId, phase, {
    lifecycle: agentLifecycle,
    metricsRegistry: subagentMetricsRegistry,
    attribution: subagentAttribution,
    onTimingChanged: () => emitSubagentTimingUpdated(threadId),
    onProxyAttributionSettled: ({ agentId, role, parentToolUseId }) => {
      usageLedgerCoordinator.settleProxyPendingForSubagentStart(threadId, {
        agentId,
        role,
        ...(parentToolUseId && { parentToolUseId }),
      });
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
    onTerminalReconciliation: async ({ agentId, role, agentTranscriptPath, transcriptPath }) => {
      const agentRecord = conversationStore
        .listAgentInstances(threadId)
        .find((record) => record.agentId === agentId);
      const result = await reconcileSubagentTerminalTranscript({
        threadId,
        agentId,
        role,
        ...(agentTranscriptPath && { agentTranscriptPath }),
        ...(agentRecord?.parentToolUseId && { parentToolUseId: agentRecord.parentToolUseId }),
        bindMessageIdentity: (binding) => usageLedgerCoordinator.bindProxyMessageIdentity(threadId, binding),
        attributeFeedEvents: (messageIds, exactAgentId) =>
          conversationStore.attributeThreadRunEventsBySdkMessageIds(
            threadId,
            messageIds,
            exactAgentId,
            (conflict) =>
              logEcoDiag("subagent.feed_identity_rebound", {
                threadId: shortThreadId(threadId),
                agentId: exactAgentId,
                role,
                resolution: "exact_sdk_message_id",
                ...conflict,
              }),
          ),
        logDiagnostic: logEcoDiag,
      });
      if (result.attributedFeedEventCount > 0) {
        scheduleThreadRunProjectionUpdated(threadId);
      }
      if (!agentTranscriptPath && transcriptPath) {
        logEcoDiag("subagent.terminal_reconciliation_main_transcript_only", {
          threadId: shortThreadId(threadId),
          agentId,
          role,
          transcriptPath,
        });
      }
    },
    ...(peekPendingCoderTodoId && { todoIdHint: peekPendingCoderTodoId }),
    contextMonitor,
    handoffService: subagentHandoffService,
  });
  if (subagentSessions.onDelegationLinked) {
    subagentDelegationLinkersByThread.set(
      threadId,
      subagentSessions.onDelegationLinked.bind(subagentSessions),
    );
  }
  const { peekPendingCoderTodoId: _peek, ...rest } = extras ?? {};
  return { ...rest, subagentSessions, subagentAttribution, subagentLaunchRegistry };
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
  const thread = conversationStore.getThread(threadId);
  if (!thread) {
    throw new Error("Thread was not found.");
  }
  requireThreadCore(thread, "claude", "create a Claude SDK driver");
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
  const storedThread = conversationStore.getThread(threadId);
  if (!storedThread) {
    throw new Error("Thread was not found.");
  }
  const threadConfig = ensureThreadRuntimeConfig(storedThread).runtimeConfig;
  const packagedClaudeExecutable = app.isPackaged
    ? resolvePackagedClaudeExecutableCandidate({ resourcesPath: readElectronResourcesPath() })
    : undefined;
  if (app.isPackaged && (!packagedClaudeExecutable || !existsSync(packagedClaudeExecutable))) {
    throw new Error("Packaged Claude Code executable is missing from app.asar.unpacked.");
  }
  return new ClaudeAgentSdkDriver({
    apiKey: proxy.apiKey,
    baseUrl: proxy.baseUrl,
    ...(packagedClaudeExecutable && existsSync(packagedClaudeExecutable)
      ? { pathToClaudeCodeExecutable: packagedClaudeExecutable }
      : {}),
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
    onContextProbe: (phase, detail) => {
      onContextProbe?.(phase, detail);
      logContextSnapshot(phase, { threadId, ...detail });
      logEcoDiag(`sdk.${normalizeDiagTopicSegment(phase)}`, {
        threadId: shortThreadId(threadId),
        phase,
        ...summarizeSdkProbeForDiag(phase, detail),
      });
    },
  });
}

function normalizeDiagTopicSegment(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "probe"
  );
}

function summarizeSdkProbeForDiag(phase: string, detail: Record<string, unknown>): Record<string, unknown> {
  if (phase === "getContextUsage" && isRecord(detail.usage)) {
    return {
      timing: detail.timing,
      usage: summarizeSdkContextUsageForDiag(detail.usage),
    };
  }
  if (phase === "getContextUsage_error") {
    return { timing: detail.timing, error: detail.error };
  }
  if (phase === "query_start") {
    const { threadId: _threadId, ...rest } = detail;
    return rest;
  }
  if (phase === "query_result") {
    return detail;
  }
  if (phase === "interrupt" || phase === "interrupt_error") {
    return detail;
  }
  return { keys: Object.keys(detail).sort() };
}

function summarizeSdkContextUsageForDiag(usage: Record<string, unknown>): Record<string, unknown> {
  const modelUsage = isRecord(usage.modelUsage) ? usage.modelUsage : undefined;
  const breakdown = usage.breakdown;
  return {
    keys: Object.keys(usage).sort(),
    totalTokens: readNumberForDiag(usage.totalTokens),
    maxTokens: readNumberForDiag(usage.maxTokens),
    inputTokens: readNumberForDiag(usage.input_tokens ?? usage.inputTokens),
    outputTokens: readNumberForDiag(usage.output_tokens ?? usage.outputTokens),
    cacheReadTokens: readNumberForDiag(
      usage.cache_read_input_tokens ?? usage.cacheReadInputTokens ?? usage.cache_read_tokens,
    ),
    cacheCreationTokens: readNumberForDiag(
      usage.cache_creation_input_tokens ?? usage.cacheCreationInputTokens ?? usage.cache_creation_tokens,
    ),
    ...(modelUsage && {
      modelUsageCount: Object.keys(modelUsage).length,
      modelUsageModels: Object.keys(modelUsage).slice(0, 12),
    }),
    ...(Array.isArray(breakdown) && { breakdownRows: breakdown.length }),
    ...(isRecord(breakdown) && { breakdownKeys: Object.keys(breakdown).slice(0, 20) }),
    jsonBytes: Buffer.byteLength(JSON.stringify(usage), "utf8"),
  };
}

function readNumberForDiag(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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
  threadPromptCacheMonitor.clearThread(threadId);
  threadPromptCacheEpisodeMonitor.clearThread(threadId);
  threadCacheHitMonitor.clearThread(threadId);
  subagentMetricsRegistry.clearThread(threadId);
  usageLedgerCoordinator.clearProxyAttributionState(threadId);
  clearThreadSubagentLaunchRegistry(threadId);
  subagentDelegationLinkersByThread.delete(threadId);
  const timer = runProjectionEmitTimers.get(threadId);
  if (timer) {
    clearTimeout(timer);
    runProjectionEmitTimers.delete(threadId);
  }
  lastFeedProjectionSignatures.delete(threadId);
  lastFeedProjectionTimelineSequences.delete(threadId);
}

function bumpThreadRunProjectionHistoryRevision(threadId: string): number {
  const next = (threadRunProjectionHistoryRevisions.get(threadId) ?? 0) + 1;
  threadRunProjectionHistoryRevisions.set(threadId, next);
  return next;
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

  conversationStore.rewindThreadToActivityLine(input.threadId, storedTarget.activityLineId);
  bumpThreadRunProjectionHistoryRevision(input.threadId);
  conversationStore.clearThreadClaudePlanFilePath(input.threadId);
  if (!resumeSessionAt) {
    conversationStore.updateThreadPrompt(input.threadId, input.prompt);
  }
  if (!resumeSessionAt) {
    conversationStore.clearSdkSession(input.threadId);
  }
  clearThreadRuntimeMemory(input.threadId);
  emitTodoList(input.threadId, []);
  emitSubagentTimingUpdated(input.threadId);

  if (!resumeSessionAt) {
    return undefined;
  }
  return {
    resumeSessionId: session.sessionId,
    resumeSessionAt,
    forkSession: true,
  };
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
      const bound = conversationStore.bindLatestUserRunEventToSdkMessage(
        threadId,
        (payload as { userMessageId: string }).userMessageId,
      );
      if (bound) {
        scheduleThreadRunProjectionUpdated(threadId);
      }
    }
    return;
  }
  if (event.type !== "session.captured") {
    return;
  }
  if (isSessionCapturedPayload(event.payload)) {
    conversationStore.captureSdkSessionAndConsumeCompactHandoff(
      threadId,
      event.payload.sessionId,
      worktreePath,
    );
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

async function buildThreadApprovedPlanView(threadId: string): Promise<ThreadPendingPlan | undefined> {
  const id = threadId.trim();
  if (!id || conversationStore.getPendingPlan(id)) {
    return undefined;
  }

  const thread = conversationStore.getThread(id);
  if (!thread) {
    return undefined;
  }

  const worktreePath = createSessionPlan(thread.workspacePath, id).worktreePath;
  const planFilePath = conversationStore.getThreadClaudePlanFilePath(id);
  if (planFilePath) {
    const planText = await readClaudePlanFile(thread.workspacePath, planFilePath);
    if (planText) {
      return {
        threadId: id,
        userPrompt: thread.prompt.trim(),
        analysis: "",
        plan: planText,
        workspacePath: thread.workspacePath,
        worktreePath,
        planFilePath,
      };
    }
  }

  const legacySnapshot = await readApprovedPlanSnapshot(thread.workspacePath, id);
  if (!legacySnapshot) {
    return undefined;
  }
  return {
    threadId: id,
    userPrompt: legacySnapshot.userPrompt || thread.prompt.trim(),
    analysis: legacySnapshot.analysis,
    plan: legacySnapshot.plan,
    workspacePath: thread.workspacePath,
    worktreePath,
    planFilePath: approvedPlanRelativePath(id),
  };
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
      ...(pending.deferredExitPlanToolUseId
        ? { deferredExitPlanToolUseId: pending.deferredExitPlanToolUseId }
        : {}),
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

  if (action.kind === "resume_sdk" && action.phase === "ask") {
    const resume =
      action.resume !== false ? (resumeOverride ?? resolveResumeOptions(threadId, cwd)) : undefined;
    if (resume) {
      void runThreadContinuation(
        updated,
        workspace,
        runtimeConfig,
        agentPrompt,
        "ask",
        existingWorktreePlan,
        attachments,
        roleRoutes,
        undefined,
        resume,
      );
    } else {
      void runAskThread(
        updated,
        workspace,
        runtimeConfig,
        agentPrompt,
        cwd !== workspace.path ? cwd : undefined,
        undefined,
        attachments,
        roleRoutes,
      );
    }
    return;
  }

  if (action.kind === "resume_sdk") {
    void (async () => {
      const planningContext =
        action.phase === "execution"
          ? await resolvePlanningContextForThread(threadId, workspace.path)
          : undefined;
      if (action.phase === "execution") {
        conversationStore.clearPendingPlan(threadId);
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
    conversationStore.clearPendingPlan(threadId);
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
    void runPlanThread(
      updated,
      workspace,
      runtimeConfig,
      agentPrompt,
      existingWorktreePlan?.worktreePath,
      resumeOverride,
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
  mode: "planning" | "execution" | "ask",
  existingWorktreePlan?: WorktreePlan,
  attachments?: PromptImageAttachment[],
  routesOverride?: readonly RuntimeRoleRouteConfig[],
  planningContext?: EcoPlanningContext,
  resumeOverride?: EcoSdkResumeOptions,
): Promise<void> {
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
    if (mode !== "ask") {
      const resolved = await resolveThreadWorktree(workspace, thread.id, existingWorktreePlan);
      worktreePlan = resolved.worktreePlan;
      cwd = resolved.cwd;
      activeRunRuntimeState.setWorktreePlan(thread.id, worktreePlan);
    }

    const resumeOptsForContinuation = resumeOverride ?? resolveResumeOptions(thread.id, cwd);

    const outcome = await runThreadRequestOnce(
      thread.id,
      runAttemptPhaseFromThreadMode(mode),
      controller.signal,
      async () => {
        const mainPrompt = await resolvePromptImagesForMainContext({
          threadId: thread.id,
          prompt: followUp,
          ...(attachments?.length ? { attachments } : {}),
          ...(routesOverride ? { routesOverride } : {}),
          signal: controller.signal,
        });
        return runThreadRequestWithRuntimeProxy({
          threadId: thread.id,
          resolveRuntimeConfig: () => resolveRuntimeConfigForThreadId(thread.id, routesOverride),
          recordRouteFingerprint: recordThreadRouteFingerprint,
          startRuntimeProxy,
          run: async ({ proxy: attemptProxy, routes }) => {
            const resume = resumeOptsForContinuation;
            if (!resume) {
              return { ok: false, reason: "无法恢复 SDK 会话，请重新发送完整需求。" };
            }
            const prepared = await prepareSdkRunAfterContextCompaction({
              threadId: thread.id,
              prompt: mainPrompt,
              worktreePath: cwd,
              resume,
              signal: controller.signal,
            });

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
                prompt: prepared.prompt,
                workspacePath: workspace.path,
                worktreePath: cwd,
                routes,
                signal: controller.signal,
                sdkSession: await buildSdkSessionOptions(thread.id, prepared.prompt, {
                  skillsScope: mode === "planning" ? "planning" : "default",
                }),
                agentRegistry: resolveAgentRuntimeConfigForThread(thread),
                ...(prepared.resume ? { resume: prepared.resume } : {}),
                ...(prepared.resume && {
                  resumableSubagents: listResumableSubagentRefs(thread.id, continuationPhase),
                }),
              });

              let eventStream: AsyncIterable<AgentEvent>;
              if (!driver.runContinuation) {
                throw new Error("Runtime driver does not support session continuation.");
              }
              eventStream = driver.runContinuation(runInput, mode, planningContext);

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
          if (mode === "ask") {
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

/** SDK drives narrative, tool, todo, and billing activity. */
function tryResolveStreamSubagentDelegation(threadId: string, parentToolUseId: string): void {
  const linked = getThreadSubagentLaunchRegistry(threadId).resolveFromStreamParentToolUseId(parentToolUseId);
  if (!linked) {
    return;
  }
  subagentDelegationLinkersByThread.get(threadId)?.({
    agentId: linked.agentId,
    agentType: linked.launch.role,
    parentToolUseId: linked.launch.parentToolUseId,
    prompt: linked.launch.prompt,
    ...(linked.launch.todoIdHint && { todoId: linked.launch.todoIdHint }),
  });
}

/** SDK drives narrative, tool, todo, and billing activity. */
function emitSdkStreamActivity(threadId: string, event: AgentEventLike): void {
  reconcileSdkAgentTerminalEvent(threadId, event, {
    resolveParentToolUseAgentId: (parentToolUseId) =>
      resolveAgentIdByParentToolUseId(threadId, parentToolUseId),
    linkParentToolUse: (parentToolUseId, agentId) => {
      subagentMetricsRegistry.linkToolUseToAgent(threadId, parentToolUseId, agentId);
      agentLifecycle.linkSubagentParentToolUse({ threadId, agentId, parentToolUseId });
    },
    settlePendingByParent: ({ agentId, role, parentToolUseId }) =>
      usageLedgerCoordinator.settleProxyPendingForSubagentStart(threadId, {
        agentId,
        role,
        parentToolUseId,
      }),
    logDiagnostic: logEcoDiag,
  });
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
      const role =
        normalizeSdkSubagentType(rawRole) ??
        (rawRole === SDK_GENERAL_PURPOSE_AGENT_KEY || rawRole === SDK_PLAN_AGENT_KEY ? rawRole : undefined);
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
  const sdkParentToolUseId = readSdkEventParentToolUseId(event);
  if (sdkParentToolUseId) {
    tryResolveStreamSubagentDelegation(threadId, sdkParentToolUseId);
  }
  const plannerSessionId = conversationStore.getSdkSession(threadId)?.sessionId?.trim();
  const streamAttributedAgentId = readStreamAttributedAgentId(event.agentId, plannerSessionId);
  const activityAgentId =
    resolveActivityAgentId(threadId, event, {
      ...(plannerSessionId && { plannerSessionId }),
      metricsRegistry: subagentMetricsRegistry,
    }) ?? streamAttributedAgentId;
  sdkStreamBridge.handleEvent(
    threadId,
    event,
    (id, type, message, role, stream, agentId, extras) => {
      const mergedMetadata = {
        ...(extras?.metadata ?? {}),
        ...(sdkParentToolUseId && { parent_tool_use_id: sdkParentToolUseId }),
      };
      const hasMetadata = Object.keys(mergedMetadata).length > 0;
      const liveRequestId = resolveLiveRequestId(threadId, {
        type,
        role: String(role),
        stream,
        ...(agentId && { agentId }),
      });
      emitThreadEvent(
        id,
        type,
        message,
        role as AgentRole | "system" | "thinking" | "tool" | "user",
        stream,
        agentId || extras || sdkParentToolUseId || liveRequestId
          ? {
              ...(agentId && { agentId }),
              ...(extras?.tool && { tool: extras.tool }),
              ...(hasMetadata && { metadata: mergedMetadata }),
              ...(liveRequestId && { requestId: liveRequestId }),
            }
          : undefined,
      );
      if (
        type === "tool.completed" &&
        extras?.tool?.outputTruncated &&
        extras.tool.outputOriginalChars !== undefined &&
        extras.tool.outputKeptChars !== undefined
      ) {
        emitToolOutputTruncatedEvent(
          {
            getThread: (id) => conversationStore.getThread(id),
            appendThreadRunEvent: (event) => conversationStore.appendThreadRunEvent(event),
            scheduleProjectionUpdated: (id) => scheduleThreadRunProjectionUpdated(id),
            emitThreadEvent: (id, type, message) => emitThreadEvent(id, type, message, "system"),
            resolveCurrentRunAttemptId: (id) => resolveCurrentRunAttemptId(id),
            writeStderr: (message) => process.stderr.write(message),
          },
          id,
          {
            toolName: extras.tool.name,
            originalChars: extras.tool.outputOriginalChars,
            keptChars: extras.tool.outputKeptChars,
            ...(extras.tool.toolUseId && { toolUseId: extras.tool.toolUseId }),
          },
        );
      }
    },
    undefined,
    activityAgentId || sdkParentToolUseId
      ? {
          ...(activityAgentId && { activityAgentId }),
          ...(sdkParentToolUseId && { parentToolUseId: sdkParentToolUseId }),
        }
      : undefined,
  );
}

function noteUsageBillingObservation(threadId: string, observation: UsageBillingObservation): void {
  activeRunBillingState.appendObservation(threadId, observation);
}

async function handleCodexGatewayUsage(event: import("@eco/gateway").GatewayUsageEvent): Promise<void> {
  const resolved = resolveCodexGatewayUsageBilling({
    event,
    resolveThreadAttribution: (codexThreadId) =>
      resolveCodexThreadAttribution(codexThreadMap, codexThreadId),
    resolveParentCodexThreadId: (codexThreadId) =>
      codexThreadMap.getThreadAttribution(codexThreadId)?.parentThreadId,
    resolveRuntimeRoutes: resolveRuntimeRoutesForThread,
    runAttemptId: (threadId) => agentLifecycle.usageRunAttemptId(threadId),
    plannerAgentId: (threadId) => agentLifecycle.usagePlannerAgentId(threadId),
  });

  if (resolved.status === "rejected") {
    if (resolved.reason === "thread_attribution_not_found" && event.codexTurnMetadata) {
      const queued = codexGatewayUsagePending.enqueue(event);
      if (queued.status === "queued") {
        logEcoDiag("codex.gateway_usage_pending", {
          codexThreadId: queued.entry.codexThreadId,
          turnId: queued.entry.turnId,
          pendingCount: queued.pendingCount,
        });
        return;
      }
    }
    throw new Error(
      `Codex Gateway usage rejected: ${resolved.reason}` +
        (resolved.codexThreadId ? ` (thread=${resolved.codexThreadId})` : ""),
    );
  }

  const routeRegistration = registerResolvedCodexGatewayTurnRoute({
    billingResult: resolved,
    requestedModel: event.requestedModel,
    providerId: event.providerId,
    upstreamModelId: event.upstreamModelId,
  });
  if (routeRegistration.status === "rejected" || routeRegistration.status === "conflict") {
    throw new Error(
      routeRegistration.status === "conflict"
        ? `Codex Gateway route conflict: ${errorMessage(routeRegistration.error)}`
        : `Codex Gateway route rejected: ${routeRegistration.reason}`,
    );
  }

  const deduplication = codexGatewayUsageDeduplicator.observe({
    requestKey: resolved.requestKey,
    usage: resolved.usage,
    ...(event.providerRequestId && { providerRequestId: event.providerRequestId }),
    ...(event.usage.totalCostUsd !== undefined && {
      sourceReportedCostUsd: event.usage.totalCostUsd,
    }),
  });
  if (deduplication.status === "duplicate") {
    return;
  }
  if (deduplication.status === "conflict") {
    throw new Error(`Codex Gateway usage conflict for request ${resolved.requestKey}.`);
  }

  noteUsageBillingObservation(resolved.threadId, resolved.observation);
  logEcoDiag("codex.gateway_usage", {
    threadId: shortThreadId(resolved.threadId),
    codexThreadId: resolved.codexThreadId,
    turnId: resolved.turnId,
    requestKind: resolved.requestKind,
    role: resolved.billingRole,
    modelId: resolved.usage.modelId ?? null,
    inputTokens: resolved.usage.inputTokens,
    outputTokens: resolved.usage.outputTokens,
    cacheReadTokens: resolved.usage.cacheReadTokens,
    cacheCreationTokens: resolved.usage.cacheCreationTokens,
  });
  const billingTask = processUsageBilling(resolved.billingInput).then(
    () => undefined,
    (error) => {
      codexGatewayUsageDeduplicator.forget(resolved.requestKey);
      throw error;
    },
  );
  usageLedgerCoordinator.trackUsageUpdate(resolved.threadId, billingTask);
  await billingTask;
}

function flushPendingCodexGatewayUsage(codexThreadId: string): void {
  for (const pending of codexGatewayUsagePending.drain(codexThreadId)) {
    void handleCodexGatewayUsage(pending.event).catch((error) => {
      process.stderr.write(
        `[eco-codex] pending gateway usage failed codexThread=${codexThreadId}: ${errorMessage(error)}\n`,
      );
    });
  }
}

function resolveProxyUsageApiCompat(
  threadId: string,
  role: RuntimeAgentRole,
  apiCompat?: UpstreamApiCompat,
): UpstreamApiCompat {
  if (apiCompat) {
    return apiCompat;
  }
  try {
    const roleRoutes = resolveRoleRoutesForThread(threadId);
    const route = roleRoutes.find((entry) => entry.role === role);
    if (!route) {
      return "anthropic";
    }
    const provider = providerStore.listProvidersWithSecrets().find((entry) => entry.id === route.providerId);
    return resolveUpstreamApiCompat(route.apiCompat, provider?.apiCompat);
  } catch {
    return "anthropic";
  }
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
    info: {
      ...info,
      apiCompat: resolveProxyUsageApiCompat(info.threadId, info.role, info.apiCompat),
    },
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
  logEcoDiag("proxy.usage", {
    threadId: shortThreadId(info.threadId),
    role: info.role,
    contextRole: resolved.contextRole,
    requestSeq: currentRequestSeq ?? null,
    providerId: info.providerId,
    provider: info.providerName,
    apiCompat: info.apiCompat,
    modelId: info.modelId,
    aliasModelId: info.aliasModelId ?? null,
    requestedModel: info.requestedModel ?? null,
    inputTokens: info.usage.inputTokens,
    outputTokens: info.usage.outputTokens,
    cacheReadTokens: info.usage.cacheReadTokens,
    cacheCreationTokens: info.usage.cacheCreationTokens,
    contextOccupied: resolved.contextOccupied,
    stampedAgentId: stampedAgentId ? shortAgentId(stampedAgentId) : null,
    stampedBillingRole: stampedBillingRole ?? null,
    stampedParentToolUseId: stampedParentToolUseId?.slice(-12) ?? null,
    runAttemptId: runAttemptId?.slice(-12) ?? null,
  });
  if (info.requestId?.trim()) {
    emitRequestTerminalEvent(info.threadId, {
      requestId: info.requestId,
      role: info.role,
      ...(info.stampedAgentId && { agentId: info.stampedAgentId }),
      stage: "completed",
    });
  }

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
    totalCostUsd: billing.sourceReportedCostUsd,
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
  maybeEmitPromptCacheHitDrop(input);
  return resolved.requestBillingLog;
}

function maybeEmitPromptCacheHitDrop(input: SingleUsageBillingRequest): void {
  if (input.reconciliationOnly || input.role !== "planner") {
    return;
  }
  const detection = threadCacheHitMonitor.observePlannerUsage(input.threadId, {
    inputTokens: input.inputTokens,
    cacheReadTokens: input.cacheReadTokens,
    cacheCreationTokens: input.cacheCreationTokens,
  });
  if (!detection) {
    return;
  }
  process.stderr.write(
    `[eco] prompt cache hit dropped thread=${input.threadId} ${Math.round(detection.previousRatio * 100)}%→${Math.round(detection.currentRatio * 100)}% cache_read_loss=${detection.cacheReadLossTokens}/${detection.currentPromptTokens}\n`,
  );
  promptCacheRunEventEmitter.emitHitDropped(input.threadId, detection, {
    ...(input.requestKey && { requestKey: input.requestKey }),
    ...(input.runAttemptId && { runAttemptId: input.runAttemptId }),
  });
}

async function prepareSdkRunAfterContextCompaction(input: {
  threadId: string;
  prompt: string;
  worktreePath: string;
  resume?: EcoSdkResumeOptions | undefined;
  signal: AbortSignal;
}) {
  return prepareSdkRunContextAfterCompaction(input, {
    ensureHeadroom: ensureContextHeadroom,
    getCompactHandoff: (threadId) => conversationStore.getCompactHandoff(threadId),
    getThreadPrompt: (threadId) => conversationStore.getThread(threadId)?.prompt,
  });
}

/** Compact before resuming a near-limit SDK session. Failures block reuse of the old session. */
async function ensureContextHeadroom(
  threadId: string,
  worktreePath: string,
  signal: AbortSignal,
  options?: { ignoreRunningGuard?: boolean },
): Promise<boolean> {
  return contextScheduler.ensureHeadroom(threadId, worktreePath, signal, options);
}

async function compactThreadContextManual(threadId: string): Promise<ThreadCompactContextResult> {
  const thread = conversationStore.getThread(threadId);
  if (!thread) {
    return { ok: false, message: "找不到该对话。" };
  }
  if (thread.coreKind === "codex") {
    if (thread.status === "running" || thread.status === "queued") {
      return { ok: false, message: "线程正在运行，请结束后再压缩上下文。" };
    }
    try {
      const compacted = await compactCodexThreadForEcoThread({ ecoThreadId: threadId });
      await contextMonitor.updateOccupied(threadId, "planner", compacted.postTokens);
      contextScheduler.emitLiveFromMonitor(threadId);
      return { ok: true, message: `Codex 上下文已压缩至 ${compacted.postTokens} tokens` };
    } catch (error) {
      return { ok: false, message: errorMessage(error) };
    } finally {
      const hasActiveCodexRun = conversationStore
        .listThreads()
        .some((candidate) => candidate.coreKind === "codex" && activeRunRuntimeState.hasRun(candidate.id));
      if (!hasActiveCodexRun) {
        await stopGlobalCodexRuntimeLifecycle();
      }
    }
  }
  requireThreadCore(thread, "claude", "compact a Claude session");
  const worktreePath = resolveThreadWorktreePath(threadId);
  if (!worktreePath) {
    return { ok: false, message: "工作区未就绪，无法压缩上下文。" };
  }

  const sdkSession = conversationStore.getSdkSession(threadId);
  if (!sdkSession?.sessionId) {
    return { ok: false, message: "尚无会话，无法压缩上下文。" };
  }

  process.stderr.write(
    `[eco] context compaction requested thread=${threadId} trigger=manual session=${sdkSession.sessionId}\n`,
  );

  const result = await contextScheduler.compactManual(threadId, worktreePath, new AbortController().signal);
  if (!result.ok) {
    return { ok: false, message: formatManualCompactFailureMessage(result.reason) };
  }
  return { ok: true, message: "上下文已手动压缩" };
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
async function afterRunContextRefresh(threadId: string, worktreePath?: string): Promise<void> {
  await contextLifecycle.afterRunRefresh(threadId, worktreePath);
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
    noteAssistantMessageIdentity: (input: {
      threadId: string;
      messageId: string;
      agentId: string;
      role: RuntimeAgentRole;
      parentToolUseId?: string;
    }) => {
      usageLedgerCoordinator.bindProxyMessageIdentity(input.threadId, {
        messageId: input.messageId,
        agentId: input.agentId,
        role: input.role,
        ...(input.parentToolUseId && { parentToolUseId: input.parentToolUseId }),
      });
    },
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
      cacheReadTokens: diagnostic.cacheReadTokens,
      cacheCreationTokens: diagnostic.cacheCreationTokens,
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

function isSkillUninstallRequest(value: unknown): value is SkillUninstallRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as SkillUninstallRequest).directory === "string" &&
    Boolean((value as SkillUninstallRequest).directory.trim())
  );
}

function isSkillCatalogSearchRequest(value: unknown): value is SkillCatalogSearchRequest {
  return (
    isRecord(value) &&
    typeof value.query === "string" &&
    value.query.trim().length >= 2 &&
    (value.limit === undefined || (typeof value.limit === "number" && Number.isInteger(value.limit)))
  );
}

function isSkillCatalogInstallRequest(value: unknown): value is SkillCatalogInstallRequest {
  return (
    isRecord(value) &&
    typeof value.source === "string" &&
    typeof value.skillId === "string" &&
    (value.layout === "agents" || value.layout === "codex" || value.layout === "claude")
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
  const availableMcpServerKeys = listEnabledGlobalMcpServerKeys(mcpStore.listServers());
  const enabledMcpServers = resolveThreadRuntimeMcpServerKeys({
    ...(hydrated?.runtimeConfig ? { runtimeConfig: hydrated.runtimeConfig } : {}),
    settings,
    availableMcpServerKeys,
  });
  const filteredMcp = filterMcpSdkConfigByAssignedServers(mcp, enabledMcpServers);
  const runtimeMcp = prepareMcpSdkConfigForRuntime(filteredMcp);
  const enabledSubagents = hydrated?.runtimeConfig?.subagentEnabled ?? defaultSubagentAvailability();
  const workspacePath =
    thread?.workspacePath ??
    (currentWorkspace?.path && currentWorkspace.path.trim() ? currentWorkspace.path : undefined);
  const discovered = await listDiscoveredSkills(workspacePath);
  const skillsEnabled = hydrated?.runtimeConfig?.skillsEnabled;
  const enabledProjectSkills = listSdkReadyProjectSkills(discovered.projectSkills).filter(
    (skill) => skillsEnabled?.[skill.settingsKey ?? skill.skillFilePath] ?? true,
  );
  const enabledUserSkills = discovered.userSkills.filter(
    (skill) =>
      skill.sdkReady &&
      (skillsEnabled?.[skill.settingsKey ?? skill.skillFilePath] ?? false),
  );
  const projectNames = enabledProjectSkills.map((skill) => skill.name);
  const enabledUserNames = enabledUserSkills.map((skill) => skill.name);
  const implicitReadAllowRoots = resolveImplicitSkillReadRoots(os.homedir(), workspacePath, [
    ...enabledProjectSkills,
    ...enabledUserSkills,
  ]);
  const skillConfig = resolveSdkSessionSkillConfig(options?.skillsScope ?? "default", {
    projectNames,
    explicitUser: enabledUserNames,
  });
  const profile = hydrated?.runtimeConfig
    ? resolveThreadAgentProfile(settings, hydrated.runtimeConfig)
    : undefined;
  const mainAgentModelKey = hydrated?.runtimeConfig
    ? resolveMainAgentModelKey(settings, hydrated.runtimeConfig)
    : buildMainAgentModelKey(undefined);
  const agentSkills = buildRuntimeAgentSkillAssignments(skillConfig.skills, profile);
  await auditThreadPromptCacheBeforeSdkSession({
    threadId,
    profileId:
      profile?.id?.trim() ||
      hydrated?.runtimeConfig?.agentProfileId?.trim() ||
      hydrated?.runtimeConfig?.routeProfileId?.trim() ||
      "unknown",
    mainAgentModelKey,
    mcpServerKeys: enabledMcpServers,
    ...(workspacePath ? { workspacePath } : {}),
    includeUserClaudeMd: skillConfig.settingSources.includes("user"),
  });
  return {
    settingSources: skillConfig.settingSources,
    ...(skillConfig.skills.length > 0 ? { skills: skillConfig.skills } : {}),
    ...(implicitReadAllowRoots.length > 0 ? { implicitReadAllowRoots } : {}),
    agentSkills,
    enabledSubagents,
    ...(enabledMcpServers.length > 0 ? { runtimeMcpServers: enabledMcpServers } : {}),
    ...(Object.keys(runtimeMcp.mcpServers).length > 0 ? { mcpServers: runtimeMcp.mcpServers } : {}),
    ...(runtimeMcp.allowedTools.length > 0 ? { mcpAllowedTools: runtimeMcp.allowedTools } : {}),
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
    (candidate.planFilePath === undefined || typeof candidate.planFilePath === "string") &&
    (candidate.deferredExitPlanToolUseId === undefined ||
      typeof candidate.deferredExitPlanToolUseId === "string")
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

function initializeGitAutoFetcher(): void {
  gitAutoFetcher = new GitAutoFetcher({
    run: runGitCommand,
    isGitBusy: () => activeGitOperations > 0,
    onFetched: (workspacePath) => {
      desktopEventCenter.publishGitRemoteFetched(workspacePath);
    },
  });
  applyGitAutoFetcherSettings();
  syncGitAutoFetcherWorkspace();
}

function applyGitAutoFetcherSettings(): void {
  if (!gitAutoFetcher) {
    return;
  }
  const settings = gitSettingsStore.get();
  gitAutoFetcher.configure({
    enabled: settings.autofetch !== false,
    periodSeconds: settings.autofetchPeriod ?? 180,
  });
}

function syncGitAutoFetcherWorkspace(): void {
  if (!gitAutoFetcher) {
    return;
  }
  const workspacePath =
    currentWorkspace?.isGitRepository && currentWorkspace.path.trim()
      ? currentWorkspace.path.trim()
      : undefined;
  gitAutoFetcher.setWorkspace(workspacePath);
}

async function runGitCommand(
  command: string[],
  cwd: string,
  options?: { stdin?: string },
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  activeGitOperations += 1;
  try {
    return await new Promise((resolve) => {
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
  } finally {
    activeGitOperations -= 1;
  }
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
  const pendingPlan =
    patch.status === "awaiting_plan" ? conversationStore.getPendingPlan(threadId) : undefined;
  emitThreadEvent(
    threadId,
    `thread.${patch.status}`,
    message,
    "system",
    false,
    pendingPlan ? { plan: buildThreadPlanLivePayload(pendingPlan) } : undefined,
  );
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
  planApproval?: ThreadLiveEvent["planApproval"];
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
  requestId?: string;
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
    !extras?.planApproval &&
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

  const persistActivityLine = shouldPersistThreadActivityLine(type);
  const activityAgentId = extras?.agentId?.trim() || extras?.bashApproval?.agentId?.trim();

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
      ...(activityAgentId && { agentId: activityAgentId }),
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

  if (type.startsWith("plan_approval.")) {
    const thread = conversationStore.getThread(threadId);
    if (thread) {
      patchThreadSummary(threadId, {
        message: displayMessage,
        status: type === "plan_approval.requested" ? "awaiting_plan" : thread.status,
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
  if (extras?.planApproval) {
    payload.planApproval = extras.planApproval;
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
  if (extras?.tool) {
    payload.tool = extras.tool;
  }

  if (type === "workspace.changes" || type === "thread.completed" || type === "thread.idle") {
    scheduleWorkspaceGitStatusPublishForThread(threadId);
  }

  desktopEventCenter.publishThreadLiveEvent(payload);
  return persistedActivityLine;
}

function emitContextCompactionStatus(
  threadId: string,
  input: {
    stage: "started" | "completed" | "failed" | "suspended";
    trigger?: "auto" | "manual";
    sessionId?: string;
    archiveId?: string;
    preTokens?: number;
    postTokens?: number;
    detail?: string;
    consecutiveFailures?: number;
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
      ...(input.consecutiveFailures !== undefined && { consecutiveFailures: input.consecutiveFailures }),
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
  stage: "started" | "completed" | "failed" | "suspended",
  trigger: "auto" | "manual",
  detail?: string,
): string {
  if (stage === "suspended") {
    return `自动上下文压缩已暂停（连续失败 ${MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES} 次）。请手动压缩或开启新会话。`;
  }
  if (stage === "failed") {
    return detail ? `上下文压缩失败：${detail}` : "上下文压缩失败";
  }
  if (stage === "started") {
    return trigger === "manual" ? "正在手动压缩上下文" : "正在自动压缩上下文";
  }
  return trigger === "manual" ? "上下文已手动压缩" : "上下文已自动压缩";
}

async function auditThreadPromptCacheBeforeSdkSession(input: {
  threadId: string;
  profileId: string;
  mainAgentModelKey: string;
  mcpServerKeys: readonly string[];
  workspacePath?: string;
  includeUserClaudeMd: boolean;
}): Promise<void> {
  if (!conversationStore.getThread(input.threadId)) {
    return;
  }
  const fingerprint = await resolveThreadPromptCacheFingerprint({
    profileId: input.profileId,
    mainAgentModelKey: input.mainAgentModelKey,
    mcpServerKeys: input.mcpServerKeys,
    ...(input.workspacePath ? { workspacePath: input.workspacePath } : {}),
    userHomeDir: os.homedir(),
    includeUserClaudeMd: input.includeUserClaudeMd,
    resolveClaudeMdDigest: resolveClaudeMdDigest,
  });
  const reasons = threadPromptCacheMonitor.observe(input.threadId, fingerprint);
  if (reasons.length === 0) {
    return;
  }
  const settings = getModelSettingsSnapshot();
  const thread = conversationStore.getThread(input.threadId);
  const profileLabel =
    reasons.includes("profile_changed") && thread?.runtimeConfig
      ? resolvePromptCacheProfileLabel(settings, thread.runtimeConfig)
      : undefined;
  process.stderr.write(
    `[eco] prompt cache invalidated thread=${input.threadId} reasons=${formatPromptCacheBreakLog(reasons)}\n`,
  );
  promptCacheRunEventEmitter.emitInvalidated(input.threadId, reasons, {
    ...(profileLabel && { profileLabel }),
  });
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
  const parentToolUseId = readLiveEventParentToolUseId(input.extras);
  let agentId = input.extras?.agentId?.trim() || input.extras?.bashApproval?.agentId?.trim();
  if (!agentId && parentToolUseId) {
    agentId = resolveAgentIdByParentToolUseId(input.threadId, parentToolUseId);
  }
  const requestId =
    input.extras?.requestId?.trim() ||
    resolveLiveRequestId(input.threadId, {
      type: input.type,
      role: input.role,
      stream: input.stream,
      ...(agentId && { agentId }),
    });
  const streamKey = resolveLiveEventStreamKey({
    threadId: input.threadId,
    type: input.type,
    role: input.role,
    stream: input.stream,
    ...(agentId && { agentId }),
    ...(parentToolUseId && { parentToolUseId }),
    ...(input.persistedActivityLine && { persistedActivityLine: input.persistedActivityLine }),
    ...(input.extras && { extras: input.extras }),
  });
  const event = buildThreadRunEventFromLiveEvent({
    threadId: input.threadId,
    eventId,
    liveType: input.type,
    message: input.displayMessage,
    role: input.role,
    stream: input.stream,
    observedAt: new Date().toISOString(),
    ...(runAttemptId && { runAttemptId }),
    ...(agentId && { agentId }),
    ...(parentToolUseId && { parentToolUseId }),
    ...(requestId && { requestId }),
    ...(streamKey && { streamKey }),
    ...(input.extras?.apiError && { apiError: input.extras.apiError }),
    ...(input.extras?.tool && { tool: input.extras.tool }),
    ...(input.extras?.metadata && { metadata: input.extras.metadata }),
    ...(bashApproval && { bashApproval }),
  });
  if (!event) {
    return;
  }
  if (event.eventType === "request.started" && event.requestId) {
    if (!markRequestStartedPersisted(input.threadId, event.requestId)) {
      return;
    }
  }
  if (event.eventType === "request.retry_scheduled") {
    const active = threadLiveRequestRegistry.resolve(input.threadId, {
      role: input.role,
      ...(agentId && { agentId }),
    });
    if (active) {
      emitRequestTerminalEvent(input.threadId, {
        requestId: active,
        role: input.role,
        ...(agentId && { agentId }),
        stage: "cancelled",
      });
    }
  }
  try {
    conversationStore.appendThreadRunEvent(event);
    if ((event.eventType === "message.final" || event.eventType === "thinking.final") && event.requestId) {
      emitRequestTerminalEvent(input.threadId, {
        requestId: event.requestId,
        role: input.role,
        ...(agentId && { agentId }),
        stage: "completed",
      });
    } else if (event.eventType === "api.error" && event.requestId) {
      const detail = event.message.trim();
      emitRequestTerminalEvent(input.threadId, {
        requestId: event.requestId,
        role: input.role,
        ...(agentId && { agentId }),
        stage: "failed",
        ...(detail && { detail }),
      });
    }
    const projectionStreaming = input.stream ? true : input.type === "message.delta" ? false : undefined;
    scheduleThreadRunProjectionUpdated(
      input.threadId,
      ...(projectionStreaming !== undefined ? [{ streaming: projectionStreaming }] : []),
    );
    if (input.extras?.tool?.fileChange) {
      scheduleWorkspaceGitStatusPublishForThread(input.threadId);
    }
  } catch (error) {
    process.stderr.write(`[eco] thread run event shadow write failed: ${errorMessage(error)}\n`);
  }
}

function resolveLiveEventStreamKey(input: {
  threadId: string;
  type: string;
  role: string;
  stream: boolean;
  agentId?: string;
  parentToolUseId?: string;
  persistedActivityLine?: ThreadActivityLine;
  extras?: EmitThreadEventExtras;
}): string | undefined {
  if (input.persistedActivityLine) {
    return input.persistedActivityLine.id;
  }
  const toolUseId = input.extras?.tool?.toolUseId?.trim();
  if (toolUseId) {
    return `tool:${toolUseId}`;
  }
  if (input.stream || input.type === "message.delta" || input.type === "thinking.delta") {
    return activityStreamKey(
      input.threadId,
      input.agentId,
      input.role,
      input.parentToolUseId,
      readLiveEventSdkStreamBlockKey(input.extras),
    );
  }
  return undefined;
}

function shouldPersistThreadActivityLine(_type: string): boolean {
  return false;
}

function resolveLiveRequestId(
  threadId: string,
  input: { type: string; role: string; stream: boolean; agentId?: string },
): string | undefined {
  if (
    !input.type.startsWith("request.") &&
    input.type !== "thread.api_error" &&
    !input.stream &&
    input.type !== "message.delta" &&
    input.type !== "thinking.delta" &&
    input.type !== "thinking.final"
  ) {
    return undefined;
  }
  const scope = {
    role: input.role,
    ...(input.agentId && { agentId: input.agentId }),
  };
  const existing = threadLiveRequestRegistry.resolve(threadId, scope);
  if (existing) {
    return existing;
  }
  if (input.role === "thinking") {
    const plannerRequestId = threadLiveRequestRegistry.resolve(threadId, {
      role: "planner",
      ...(input.agentId && { agentId: input.agentId }),
    });
    if (plannerRequestId) {
      return plannerRequestId;
    }
  }
  if (input.type === "request.started") {
    return threadLiveRequestRegistry.resolveOrBeginRequest(threadId, scope).requestId;
  }
  return undefined;
}

function readLiveEventParentToolUseId(extras?: EmitThreadEventExtras): string | undefined {
  const fromMetadata = extras?.metadata?.parent_tool_use_id ?? extras?.metadata?.parentToolUseId;
  if (typeof fromMetadata === "string" && fromMetadata.trim()) {
    return fromMetadata.trim();
  }
  return undefined;
}

function readLiveEventSdkStreamBlockKey(extras?: EmitThreadEventExtras): string | undefined {
  const fromMetadata = extras?.metadata?.sdkStreamBlockKey ?? extras?.metadata?.stream_block_key;
  if (typeof fromMetadata === "string" && fromMetadata.trim()) {
    return fromMetadata.trim();
  }
  return undefined;
}

function resolveAgentIdByParentToolUseId(threadId: string, parentToolUseId: string): string | undefined {
  const linked = subagentMetricsRegistry.resolveAgentIdByParentToolUse(threadId, parentToolUseId);
  if (linked) {
    return linked;
  }
  const agent = conversationStore
    .listAgentInstances(threadId)
    .find((row) => row.parentToolUseId?.trim() === parentToolUseId.trim());
  return agent?.agentId;
}

function readSdkEventParentToolUseId(event: AgentEventLike): string | undefined {
  const payload = event.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }
  const parentToolUseId = (payload as { parent_tool_use_id?: unknown }).parent_tool_use_id;
  return typeof parentToolUseId === "string" && parentToolUseId.trim() ? parentToolUseId.trim() : undefined;
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

function normalizeThreadFollowUpRunPhase(value: unknown): ThreadFollowUpRunPhase | undefined {
  if (value === "question") {
    return "ask";
  }
  if (value === "planning" || value === "execution" || value === "ask" || value === "continuation") {
    return value;
  }
  return undefined;
}

function resolveRunAttemptPhase(threadId: string, attemptId: string): ThreadFollowUpRunPhase | undefined {
  const phase = conversationStore
    .listRunAttempts(threadId)
    .find((attempt) => attempt.attemptId === attemptId)?.phase;
  return normalizeThreadFollowUpRunPhase(phase);
}

function isThreadFollowUpRunPhase(value: unknown): value is ThreadFollowUpRunPhase {
  return normalizeThreadFollowUpRunPhase(value) !== undefined;
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
  projection.historyRevision = threadRunProjectionHistoryRevisions.get(threadId) ?? 0;
  logThreadRunProjectionDiagnostics(projection);
  return projection;
}

function logThreadRunProjectionDiagnostics(projection: ThreadRunProjectionSnapshot): void {
  const openSpanDiagnostics = projection.diagnostics.filter(
    (diagnostic) => diagnostic.code === "request_span_left_open",
  );
  if (openSpanDiagnostics.length > 0) {
    const sample = openSpanDiagnostics[0];
    logEcoDiagThrottled(
      `thread-run-projection:${projection.thread.threadId}:request_span_left_open`,
      "thread_run_projection.diagnostic",
      {
        threadId: shortThreadId(projection.thread.threadId),
        code: "request_span_left_open",
        count: openSpanDiagnostics.length,
        ...(sample?.requestId && { sampleRequestId: shortProjectionId(sample.requestId) }),
        message: `Request spans left open after terminal thread status ${projection.thread.status}.`,
      },
      5_000,
    );
  }
  for (const diagnostic of projection.diagnostics) {
    if (diagnostic.code === "request_span_left_open") {
      continue;
    }
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

function scheduleThreadRunProjectionUpdated(threadId: string, options?: { streaming?: boolean }): void {
  const existing = runProjectionEmitTimers.get(threadId);
  if (options?.streaming) {
    if (existing) {
      return;
    }
    const timer = setTimeout(() => {
      runProjectionEmitTimers.delete(threadId);
      emitThreadRunProjectionUpdated(threadId);
    }, RUN_PROJECTION_STREAMING_EMIT_MS);
    runProjectionEmitTimers.set(threadId, timer);
    return;
  }

  if (existing) {
    clearTimeout(existing);
    runProjectionEmitTimers.delete(threadId);
  }
  if (options?.streaming === false) {
    emitThreadRunProjectionUpdated(threadId);
    return;
  }
  const timer = setTimeout(() => {
    runProjectionEmitTimers.delete(threadId);
    emitThreadRunProjectionUpdated(threadId);
  }, RUN_PROJECTION_EMIT_DEBOUNCE_MS);
  runProjectionEmitTimers.set(threadId, timer);
}

function emitThreadRunProjectionUpdated(threadId: string): void {
  const projection = buildCurrentThreadRunProjection(threadId);
  if (!projection) {
    return;
  }
  const feedProjection = trimProjectionForFeed(projection);
  const signature = buildFeedProjectionSignature(feedProjection);
  if (lastFeedProjectionSignatures.get(threadId) === signature) {
    return;
  }
  lastFeedProjectionSignatures.set(threadId, signature);
  const previousMaxSequence = lastFeedProjectionTimelineSequences.get(threadId);
  const currentMaxSequence = maxFeedProjectionTimelineSequence(feedProjection);
  const payloadProjection = filterFeedProjectionAfterSequence(feedProjection, previousMaxSequence);
  if (currentMaxSequence !== undefined) {
    lastFeedProjectionTimelineSequences.set(threadId, currentMaxSequence);
  }
  const payload: ThreadLiveEvent = {
    threadId,
    type: "thread.run_projection_updated",
    message: "运行投影已更新",
    role: "system",
    stream: false,
    projection: payloadProjection,
  };
  desktopEventCenter.publishThreadLiveEvent(payload);
}

function recordUserPrompt(
  threadId: string,
  prompt: string,
  attachments?: readonly PromptImageAttachment[],
): ThreadActivityLine | undefined {
  const previews = createPromptImagePreviews(attachments ?? []);
  return emitThreadEvent(threadId, "thread.user_prompt", prompt, "user", false, {
    ...(previews.length > 0 && {
      metadata: { [PROMPT_IMAGE_PREVIEWS_METADATA_KEY]: previews },
    }),
  });
}

function createPromptImagePreviews(
  attachments: readonly PromptImageAttachment[],
): PromptImagePreview[] {
  const previews: PromptImagePreview[] = [];
  for (const attachment of attachments) {
    const image = nativeImage.createFromBuffer(Buffer.from(attachment.data, "base64"));
    if (image.isEmpty()) {
      process.stderr.write("[eco] unable to decode a prompt image preview\n");
      continue;
    }
    const size = image.getSize();
    const longestEdge = Math.max(size.width, size.height);
    const scale = longestEdge > 512 ? 512 / longestEdge : 1;
    const preview =
      scale < 1
        ? image.resize({
            width: Math.max(1, Math.round(size.width * scale)),
            height: Math.max(1, Math.round(size.height * scale)),
            quality: "good",
          })
        : image;
    const bytes = preview.toJPEG(80);
    if (bytes.length === 0) {
      process.stderr.write("[eco] unable to encode a prompt image preview\n");
      continue;
    }
    previews.push({
      id: `prompt_image_${randomUUID()}`,
      mediaType: "image/jpeg",
      data: bytes.toString("base64"),
    });
  }
  return previews;
}

async function resolvePromptImagesForMainContext(input: {
  threadId: string;
  prompt: string;
  attachments?: readonly PromptImageAttachment[];
  routesOverride?: readonly RuntimeRoleRouteConfig[];
  signal?: AbortSignal;
}): Promise<string> {
  const attachments = input.attachments ?? [];
  if (attachments.length === 0) {
    return input.prompt;
  }

  const runtime = resolveRuntimeConfigForThreadId(input.threadId, input.routesOverride);
  if (!runtime.ok) {
    throw new Error(runtime.reason);
  }
  const sourceRoute = runtime.routes.find((route) => route.role === "planner") ?? runtime.routes[0];
  if (!sourceRoute) {
    throw new Error("看图子代理缺少可用的模型路由。");
  }
  if (sourceRoute.manualSpec?.supportsImageInput === false) {
    throw new Error(`主 Agent 模型 ${sourceRoute.modelId} 已明确配置为不支持图片输入。`);
  }

  const agentId = `vision:${input.threadId}:${randomUUID()}`;
  const runAttemptId = agentLifecycle.currentRunAttemptId(input.threadId);
  const parentAgentId = agentLifecycle.currentPlannerAgentId(input.threadId);
  const phase = resolveBuiltInVisionSubagentPhase(input.threadId);
  const startedAt = new Date().toISOString();
  const visionRoute: RuntimeRoute = {
    ...sourceRoute,
    role: BUILTIN_VISION_AGENT_ROLE,
    manualSpec: {
      ...sourceRoute.manualSpec,
      maxOutputTokens: 1600,
    },
  };

  conversationStore.upsertSubagentSessionActive({
    threadId: input.threadId,
    role: BUILTIN_VISION_AGENT_ROLE,
    agentId,
    phase,
    missionKey: `prompt-images:${attachments.length}`,
  });
  subagentMetricsRegistry.onSubagentStart(input.threadId, {
    agentId,
    role: BUILTIN_VISION_AGENT_ROLE,
  });
  agentLifecycle.startSubagent({
    threadId: input.threadId,
    agentId,
    role: BUILTIN_VISION_AGENT_ROLE,
    missionKey: `prompt-images:${attachments.length}`,
  });
  proxyBillingStampRegistry.register(input.threadId, {
    agentId,
    role: BUILTIN_VISION_AGENT_ROLE,
    ...(runAttemptId && { runAttemptId }),
  });
  conversationStore.appendThreadRunEvent(
    buildSubagentLifecycleRunEvent({
      threadId: input.threadId,
      agentId,
      role: BUILTIN_VISION_AGENT_ROLE,
      lifecycle: "started",
      observedAt: startedAt,
      ...(runAttemptId && { runAttemptId }),
      ...(parentAgentId && { parentAgentId }),
      missionKey: `prompt-images:${attachments.length}`,
      delegationPrompt: `分析本轮 ${attachments.length} 张图片，只返回结构化视觉报告。`,
    }),
  );
  scheduleThreadRunProjectionUpdated(input.threadId, { streaming: false });
  emitSubagentTimingUpdated(input.threadId);

  let report: string | undefined;
  let failure: unknown;
  let proxy: Awaited<ReturnType<typeof startRuntimeProxy>> | undefined;
  try {
    proxy = await startRuntimeProxy([visionRoute], [...attachments], input.threadId);
    const route = proxy.routes[0];
    if (!route) {
      throw new Error("看图子代理没有生成可调用的模型别名。");
    }
    const response = await fetch(`${proxy.baseUrl.replace(/\/$/, "")}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key": proxy.apiKey,
        [ECO_PROXY_BILLING_HEADERS.agentId]: agentId,
        [ECO_PROXY_BILLING_HEADERS.billingRole]: BUILTIN_VISION_AGENT_ROLE,
        ...(runAttemptId ? { [ECO_PROXY_BILLING_HEADERS.runAttemptId]: runAttemptId } : {}),
      },
      body: JSON.stringify(
        buildVisionAnalysisRequestBody({
          model: route.aliasModelId,
          prompt: input.prompt,
          imageCount: attachments.length,
        }),
      ),
      ...(input.signal && { signal: input.signal }),
    });
    const payload = (await response.json()) as unknown;
    if (!response.ok) {
      throw new Error(`看图子代理请求失败（HTTP ${response.status}）：${readVisionError(payload)}`);
    }
    report = readVisionAnalysisResponse(payload);
    conversationStore.appendThreadRunEvent({
      id: `tre:${input.threadId}:agent:${agentId}:vision-report`,
      threadId: input.threadId,
      eventType: "message.final",
      scope: "agent",
      streamState: "finalized",
      role: BUILTIN_VISION_AGENT_ROLE,
      agentId,
      message: report,
      observedAt: new Date().toISOString(),
      ...(runAttemptId && { runAttemptId }),
      metadata: {
        visionAnalysis: true,
        imageCount: attachments.length,
        originalImagesInMainContext: false,
      },
    });
    return buildPromptWithVisionAnalysis({
      prompt: input.prompt,
      report,
      imageCount: attachments.length,
    });
  } catch (error) {
    failure = error;
    throw new Error(`图片理解失败：${errorMessage(error)}`);
  } finally {
    await proxy?.close().catch(() => {});
    proxyBillingStampRegistry.unregister(input.threadId, agentId);
    const terminalAt = new Date().toISOString();
    const lifecycle = failure ? "abandoned" : "stopped";
    conversationStore.appendThreadRunEvent(
      buildSubagentLifecycleRunEvent({
        threadId: input.threadId,
        agentId,
        role: BUILTIN_VISION_AGENT_ROLE,
        lifecycle,
        observedAt: terminalAt,
        ...(runAttemptId && { runAttemptId }),
        ...(parentAgentId && { parentAgentId }),
        missionKey: `prompt-images:${attachments.length}`,
        ...(report && { delegationSummary: `已完成 ${attachments.length} 张图片的结构化分析。` }),
      }),
    );
    conversationStore.markSubagentSessionStopped(input.threadId, agentId);
    subagentMetricsRegistry.onSubagentStop(input.threadId, {
      agentId,
      role: BUILTIN_VISION_AGENT_ROLE,
    });
    if (failure) {
      agentLifecycle.abandonSubagent({
        threadId: input.threadId,
        agentId,
        role: BUILTIN_VISION_AGENT_ROLE,
      });
    } else {
      agentLifecycle.stopSubagent({
        threadId: input.threadId,
        agentId,
        role: BUILTIN_VISION_AGENT_ROLE,
      });
    }
    scheduleThreadRunProjectionUpdated(input.threadId, { streaming: false });
    emitSubagentTimingUpdated(input.threadId);
  }
}

function resolveBuiltInVisionSubagentPhase(threadId: string): SubagentRunPhase {
  const mode = conversationStore.getThread(threadId)?.runtimeConfig?.sessionMode;
  return mode === "plan" ? "planning" : mode === "ask" ? "ask" : "execution";
}

function readVisionError(value: unknown): string {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const error = (value as { error?: unknown }).error;
    if (typeof error === "string" && error.trim()) {
      return error.trim();
    }
    if (error && typeof error === "object" && !Array.isArray(error)) {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) {
        return message.trim();
      }
    }
  }
  return "上游未返回错误详情。";
}

function archiveThreadContextBeforeCompaction(
  threadId: string,
  trigger: "auto" | "manual",
  sessionId?: string,
): Promise<void> {
  return compactionAuditService.archiveBeforeCompaction(threadId, {
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

async function handleThreadAskUserQuestion(
  threadId: string,
  parsed: SdkAskUserQuestionRequest & { toolUseId: string },
): Promise<Record<string, unknown>> {
  patchThreadSummary(threadId, { status: "running", message: "等待你的回答…" });
  const clarificationRequest: ThreadLiveEvent["clarification"] = {
    toolUseId: parsed.toolUseId,
    threadId,
    questions: parsed.questions,
  };
  const answersPromise = registerPendingClarification(threadId, parsed.toolUseId, parsed);
  emitThreadEvent(threadId, "clarification.requested", "Planner 需要你回答几个问题。", "planner", false, {
    clarification: clarificationRequest,
  });
  const answers = await answersPromise;
  patchThreadSummary(threadId, { status: "running", message: "正在分析并制定计划…" });
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
  void retryDeferredRunCleanupIfNeeded(threadId);
  return buildAskUserQuestionUpdatedInput(
    { toolUseId: parsed.toolUseId, threadId, questions: parsed.questions },
    answers,
    parsed.rawInput,
  );
}

function createThreadHookContext(threadId: string): EcoHookContext {
  return {
    awaitPlanApproval: async (request) => {
      const thread = conversationStore.getThread(threadId);
      if (!thread) {
        throw new Error("Thread was not found.");
      }
      const worktreePlan = activeRunRuntimeState.worktreePlan(threadId);
      const worktreePath = worktreePlan?.worktreePath ?? thread.workspacePath;
      const roleRoutes = resolveRoleRoutesForThread(threadId);
      const analysis = [
        "Claude official Plan Mode submitted this plan via ExitPlanMode.",
        request.planFilePath ? `Plan file: ${request.planFilePath}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      const planPayload = {
        userPrompt: thread.prompt,
        analysis,
        plan: request.plan,
        ...(request.planFilePath ? { planFilePath: request.planFilePath } : {}),
      };
      applyThreadPlanReadyEffects({
        threadId,
        payload: planPayload,
        workspacePath: thread.workspacePath,
        worktreePath,
        routesJson: JSON.stringify(roleRoutes),
        awaitingPlanMessage: "计划已生成，请确认是否执行。",
        effects: {
          savePendingPlan: (plan) => {
            conversationStore.savePendingPlan(plan);
          },
          emitAwaitingPlan: () => {
            // Bridge path keeps the thread running until the user approves.
          },
        },
      });
      const approvalRequest: PlanApprovalRequest = {
        toolUseId: request.toolUseId,
        threadId,
        ...planPayload,
      };
      updateThread(threadId, { status: "awaiting_plan", message: "计划已提交，等待你确认。" });
      emitThreadEvent(threadId, "plan_approval.requested", "计划已提交，等待你确认。", "planner", false, {
        plan: planPayload,
        planApproval: approvalRequest,
      });
      const decision = await registerPendingPlanApproval(threadId, approvalRequest);
      if (decision === "approved") {
        emitThreadEvent(threadId, "plan_approval.approved", "已批准计划。", "user", false, {
          planApproval: approvalRequest,
        });
        void retryDeferredRunCleanupIfNeeded(threadId);
        return "approved";
      }
      conversationStore.clearPendingPlan(threadId);
      emitThreadEvent(threadId, "plan_approval.denied", "计划忽略", "user", false, {
        planApproval: approvalRequest,
      });
      void retryDeferredRunCleanupIfNeeded(threadId);
      return "denied";
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
      await archiveThreadContextBeforeCompaction(threadId, input.trigger, input.sessionId);
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
    ...(request.description?.trim() && { description: request.description.trim() }),
  };
}

function toolMetadataFromBashApprovalRequest(
  request: BashApprovalRequest,
  liveType: string,
): ThreadRunToolMetadata {
  const toolName = request.filesystemTool ?? "Bash";
  const detail = request.filesystemPath ?? request.command;
  const phase = resolveBashApprovalPhase(liveType);
  const status: ThreadRunToolMetadata["status"] =
    phase === "rejected" || phase === "denied" ? "failed" : "started";
  return {
    name: toolName,
    detail: detail.trim() || request.command,
    toolUseId: request.toolUseId,
    ...(request.description?.trim() && { description: request.description.trim() }),
    status,
  };
}

function bashApprovalEventExtras(request: BashApprovalRequest, liveType: string): EmitThreadEventExtras {
  return {
    bashApproval: request,
    tool: toolMetadataFromBashApprovalRequest(request, liveType),
    agentId: request.agentId.trim(),
  };
}

function resolveThreadBashApprovalAgentId(
  threadId: string,
  request: Pick<SdkToolPermissionRequest, "agentId" | "agentType">,
): string | undefined {
  return resolveBashApprovalAgentId(threadId, request, {
    plannerAgentId: agentLifecycle.usagePlannerAgentId(threadId),
    roleForAgentId: (tid, agentId) => subagentMetricsRegistry.roleForAgentId(tid, agentId),
    resolveSubagentId: (tid, input) => subagentMetricsRegistry.resolveAgentId(tid, input),
  });
}

function createThreadToolPermissionHandler(
  threadId: string,
  runPhase: SubagentRunPhase = "execution",
): (request: SdkToolPermissionRequest) => Promise<SdkToolPermissionDecision> {
  const bashAndFilesystemHandler = createThreadBashAndFilesystemToolPermissionHandler(threadId, runPhase);
  return composeCanUseToolHandlers(
    createAskUserQuestionHandler((parsed) => handleThreadAskUserQuestion(threadId, parsed)),
    bashAndFilesystemHandler,
  );
}

function createThreadBashAndFilesystemToolPermissionHandler(
  threadId: string,
  runPhase: SubagentRunPhase = "execution",
): (request: SdkToolPermissionRequest) => Promise<SdkToolPermissionDecision> {
  return async (request) => {
    if (isReadFilesystemTool(request.toolName) || isWriteFilesystemTool(request.toolName)) {
      const thread = conversationStore.getThread(threadId);
      if (!thread) {
        return {
          behavior: "deny",
          message: "Thread was not found; Eco could not request filesystem approval.",
          interrupt: true,
        };
      }

      const worktreePlan = activeRunRuntimeState.worktreePlan(threadId);
      const cwd = request.cwd?.trim() || worktreePlan?.worktreePath || thread.sdkCwd || thread.workspacePath;
      const runtimeConfig = ensureThreadRuntimeConfig(thread).runtimeConfig;
      const confirmationMode = runtimeConfig?.bashReviewMode ?? "always";
      const filesystemApproval = resolveFilesystemApprovalRequest({
        toolName: request.toolName,
        input: request.input,
        cwd: cwd ?? thread.workspacePath ?? ".",
        workspacePath: thread.workspacePath,
        confirmationMode,
        ...(request.decisionReason ? { fallbackReason: request.decisionReason } : {}),
      });
      if (!filesystemApproval) {
        return { behavior: "allow", updatedInput: request.input };
      }
      if (filesystemApproval.action === "deny") {
        return {
          behavior: "deny",
          message: filesystemApproval.reason,
          interrupt: false,
        };
      }
      const filesystemPath = filesystemApproval.filesystemPath;
      const approvalAgentId = resolveThreadBashApprovalAgentId(threadId, request);
      if (!approvalAgentId) {
        return {
          behavior: "deny",
          message: "Eco could not attribute this filesystem approval to an agent instance.",
          interrupt: false,
        };
      }

      const approvalRequest: BashApprovalRequest = {
        toolUseId: request.toolUseId,
        threadId,
        command: `${request.toolName} ${filesystemPath}`,
        cwd,
        reason: filesystemApproval.reason,
        riskScore: filesystemApproval.riskScore ?? 40,
        riskLevel: filesystemApproval.riskLevel ?? "medium",
        agentId: approvalAgentId,
        filesystemTool: request.toolName,
        filesystemPath,
        ...(request.agentType ? { agentType: request.agentType } : {}),
        description: filesystemApproval.userMessage,
      };

      emitThreadEvent(
        threadId,
        "bash_approval.requested",
        `等待确认 ${request.toolName}：${filesystemPath}`,
        "tool",
        false,
        bashApprovalEventExtras(approvalRequest, "bash_approval.requested"),
      );

      const resolution = await registerPendingBashApproval(threadId, approvalRequest);
      if (isBashApprovalGranted(resolution)) {
        emitThreadEvent(
          threadId,
          "bash_approval.approved",
          `已允许本次 ${request.toolName}：${filesystemPath}`,
          "tool",
          false,
          bashApprovalEventExtras(approvalRequest, "bash_approval.approved"),
        );
        return { behavior: "allow", updatedInput: request.input };
      }

      emitThreadEvent(
        threadId,
        "bash_approval.rejected",
        `已拒绝 ${request.toolName}：${filesystemPath}`,
        "tool",
        false,
        bashApprovalEventExtras(approvalRequest, "bash_approval.rejected"),
      );
      return {
        behavior: "deny",
        message: formatFilesystemApprovalDenyMessage(request.toolName, resolution.feedback),
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
    const confirmation = evaluateThreadToolConfirmation({
      command,
      cwd,
      workspacePath: thread.workspacePath,
      confirmationMode: runtimeConfig?.bashReviewMode ?? "always",
      phaseAllowsExecution: runPhase !== "planning" && runPhase !== "ask",
      sessionBashRememberPrefixes: activeRunRuntimeState.bashRememberPrefixes(threadId),
      ...(agentRegistry ? { agentRegistry } : {}),
      ...(request.agentId ? { agentId: request.agentId } : {}),
      ...(request.agentType ? { agentType: request.agentType } : {}),
    });
    if (confirmation.action === "deny") {
      const approvalAgentId = resolveThreadBashApprovalAgentId(threadId, request);
      if (!approvalAgentId) {
        return {
          behavior: "deny",
          message: "Eco could not attribute this Bash denial to an agent instance.",
          interrupt: false,
        };
      }
      const deniedApproval: BashApprovalRequest = {
        toolUseId: request.toolUseId,
        threadId,
        command,
        cwd: cwd ?? thread.workspacePath ?? ".",
        reason: confirmation.reason,
        riskScore: confirmation.riskScore ?? 100,
        riskLevel: confirmation.riskLevel ?? "critical",
        agentId: approvalAgentId,
        ...(request.agentType ? { agentType: request.agentType } : {}),
      };
      emitThreadEvent(
        threadId,
        "bash_approval.denied",
        `已拒绝：${confirmation.userMessage}`,
        "tool",
        false,
        {
          ...bashApprovalEventExtras(deniedApproval, "bash_approval.denied"),
        },
      );
      return {
        behavior: "deny",
        message: confirmation.reason,
        interrupt: false,
      };
    }
    if (confirmation.action === "allow") {
      const description = readBashDescriptionInput(request.input);
      emitThreadEvent(threadId, "tool.started", `Tool: Bash · ${description ?? command}`, "tool", false, {
        ...(request.agentId ? { agentId: request.agentId } : {}),
        tool: {
          name: "Bash",
          detail: command,
          toolUseId: request.toolUseId,
          ...(description ? { description } : {}),
          status: "started",
        },
      });
      return { behavior: "allow", updatedInput: request.input };
    }

    const description = readBashDescriptionInput(request.input);
    const approvalAgentId = resolveThreadBashApprovalAgentId(threadId, request);
    if (!approvalAgentId) {
      return {
        behavior: "deny",
        message: "Eco could not attribute this Bash approval to an agent instance.",
        interrupt: false,
      };
    }
    const approvalRequest: BashApprovalRequest = {
      toolUseId: request.toolUseId,
      threadId,
      command,
      cwd,
      reason: confirmation.reason,
      riskScore: confirmation.riskScore ?? 50,
      riskLevel: confirmation.riskLevel ?? "medium",
      agentId: approvalAgentId,
      ...(request.agentType ? { agentType: request.agentType } : {}),
      ...(description ? { description } : { description: confirmation.userMessage }),
    };

    emitThreadEvent(threadId, "bash_approval.requested", `等待确认 Bash：${command}`, "tool", false, {
      ...bashApprovalEventExtras(approvalRequest, "bash_approval.requested"),
    });

    const resolution = await registerPendingBashApproval(threadId, approvalRequest);
    if (isBashApprovalGranted(threadId, command, resolution)) {
      emitThreadEvent(threadId, "bash_approval.approved", `已允许本次 Bash：${command}`, "tool", false, {
        ...bashApprovalEventExtras(approvalRequest, "bash_approval.approved"),
      });
      return { behavior: "allow", updatedInput: request.input };
    }

    emitThreadEvent(threadId, "bash_approval.rejected", `已拒绝 Bash：${command}`, "tool", false, {
      ...bashApprovalEventExtras(approvalRequest, "bash_approval.rejected"),
    });
    return {
      behavior: "deny",
      message: formatBashApprovalDenyMessage(resolution.feedback),
      interrupt: false,
    };
  };
}

function resolveFilesystemApprovalRequest(input: {
  toolName: string;
  input: Record<string, unknown>;
  cwd: string;
  workspacePath: string;
  confirmationMode: import("@eco/runtime").ExecutionConfirmationMode;
  fallbackReason?: string;
}):
  | {
      action: "ask";
      filesystemPath: string;
      reason: string;
      userMessage: string;
      riskScore?: number;
      riskLevel?: import("@eco/shared").ApprovalRiskLevel;
    }
  | { action: "deny"; reason: string; userMessage: string }
  | undefined {
  const evaluateConfirmation = isWriteFilesystemTool(input.toolName)
    ? evaluateFilesystemWriteConfirmation
    : evaluateFilesystemReadConfirmation;
  const decision = evaluateConfirmation({
    toolName: input.toolName,
    toolInput: input.input,
    cwd: input.cwd,
    workspacePath: input.workspacePath,
    confirmationMode: input.confirmationMode,
    ...(input.fallbackReason ? { fallbackReason: input.fallbackReason } : {}),
  });
  if (!decision || decision.action === "allow") {
    return undefined;
  }
  if (decision.action === "deny") {
    return { action: "deny", reason: decision.reason, userMessage: decision.userMessage };
  }
  const filesystemPath = readFilesystemPath(input.input, input.toolName) ?? ".";
  return {
    action: "ask",
    filesystemPath,
    reason: decision.reason,
    userMessage: decision.userMessage,
    ...(decision.riskScore !== undefined && { riskScore: decision.riskScore }),
    ...(decision.riskLevel && { riskLevel: decision.riskLevel }),
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
    (payload.decision === "approved" ||
      payload.decision === "approved_remember_prefix" ||
      payload.decision === "denied") &&
    (payload.feedback === undefined || typeof payload.feedback === "string")
  );
}

function isBashApprovalGranted(
  threadId: string,
  command: string,
  resolution: BashApprovalResolution,
): boolean;
function isBashApprovalGranted(resolution: BashApprovalResolution): boolean;
function isBashApprovalGranted(
  threadIdOrResolution: string | BashApprovalResolution,
  command?: string,
  resolution?: BashApprovalResolution,
): boolean {
  const resolved = typeof threadIdOrResolution === "string" ? resolution : threadIdOrResolution;
  if (!resolved) {
    return false;
  }
  if (resolved.decision === "approved") {
    return true;
  }
  if (resolved.decision === "approved_remember_prefix") {
    if (typeof threadIdOrResolution === "string" && command) {
      activeRunRuntimeState.rememberBashPrefix(
        threadIdOrResolution,
        deriveBashApprovalRememberPrefix(command),
      );
    }
    return true;
  }
  return false;
}

function emitSettingsUpdated(): void {
  desktopEventCenter.publishSettingsUpdated({
    threadId: "settings",
    type: "settings.updated",
    message: "Model provider settings saved.",
  });
}

const lastConnectionErrorEmitByThread = new Map<string, { at: number; message: string }>();

function resolveProxyRequestScope(
  threadId: string,
  role: RuntimeAgentRole,
): { role: RuntimeAgentRole; agentId?: string } {
  const stamp = proxyBillingStampRegistry.resolveForRoute(threadId, role);
  return {
    role,
    ...(stamp?.agentId && { agentId: stamp.agentId }),
  };
}

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
  emitThreadEvent(threadId, "thread.api_error", message, role, false, {
    apiError: {
      message: detail,
      ...(statusCode !== undefined && { statusCode }),
    },
    metadata: { activityOrigin: "proxy.connection_error" },
  });
}

function adoptLiveProviderRequestId(
  threadId: string,
  scope: { role: string; agentId?: string },
  providerRequestId: string,
): void {
  const adopted = threadLiveRequestRegistry.adoptProviderRequestId(threadId, scope, providerRequestId);
  if (!adopted.replacedRequestId) {
    return;
  }
  const updated = conversationStore.rekeyThreadRunRequestId(
    threadId,
    adopted.replacedRequestId,
    adopted.requestId,
  );
  if (updated > 0) {
    scheduleThreadRunProjectionUpdated(threadId);
  }
}

function startRuntimeProxy(
  routes: RuntimeRoute[],
  attachments?: PromptImageAttachment[],
  threadId?: string,
  proxyThreadOptions?: { emitRequestActivity?: boolean },
): Promise<Awaited<ReturnType<typeof startAnthropicModelProxy>>> {
  return (async () => {
    const contextByRole = await resolveContextTokensByRole(routes, pricingCache);
    const upstreamUserAgent = resolveUpstreamUserAgentOverride(proxyBridgeSettingsStore.get());
    // SDK already emits request.started via system status "requesting"; proxy hook is opt-in only.
    const emitRequestActivity = proxyThreadOptions?.emitRequestActivity === true;
    const options: AnthropicProxyStartOptions = {
      ...(threadId && { threadId }),
      ...(upstreamUserAgent && { upstreamUserAgent }),
      ...(attachments && attachments.length > 0 && { pendingImages: attachments }),
      ...(threadId && {
        onMessagesRequest: ({ role }) => {
          threadLiveRequestRegistry.resolveOrBeginRequest(threadId, resolveProxyRequestScope(threadId, role));
          if (emitRequestActivity) {
            emitUpstreamModelRequestActivity(threadId, role);
          }
        },
        onUpstreamRequestId: ({ role, requestId }) => {
          adoptLiveProviderRequestId(threadId, resolveProxyRequestScope(threadId, role), requestId);
        },
        onUpstreamConnectionError: ({ role, error, statusCode }) => {
          emitUpstreamConnectionErrorActivity(threadId, role, error, statusCode);
        },
        onUsage: ((info) => emitProxyUsage({ ...info, threadId })) satisfies AnthropicProxyUsageHandler,
      }),
    };
    return startAnthropicModelProxy(
      routes.map((route): AnthropicProxyRoute => {
        const proxyRoute = runtimeRouteToProxyRoute(route);
        const contextTokens = contextByRole[route.role];
        if (contextTokens === undefined) {
          return proxyRoute;
        }
        return { ...proxyRoute, contextTokens };
      }),
      options,
    );
  })();
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
        const rates = resolveRatesForRoute(pricingLookup, manual);
        if (rates) {
          view.resolvedInputPerM = rates.input;
          view.resolvedOutputPerM = rates.output;
          if (rates.cacheRead !== undefined) view.resolvedCacheReadPerM = rates.cacheRead;
          if (rates.cacheWrite !== undefined) view.resolvedCacheWritePerM = rates.cacheWrite;
        }
        if (pricingLookup.displayName !== undefined) view.modelsDevLabel = pricingLookup.displayName;
      } else {
        const rates = resolveRatesForRoute(null, manual);
        if (rates) {
          view.resolvedInputPerM = rates.input;
          view.resolvedOutputPerM = rates.output;
          if (rates.cacheRead !== undefined) view.resolvedCacheReadPerM = rates.cacheRead;
          if (rates.cacheWrite !== undefined) view.resolvedCacheWritePerM = rates.cacheWrite;
        }
      }
      return view;
    }),
  );
}
