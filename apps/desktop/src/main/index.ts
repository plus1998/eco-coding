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
  composeCanUseToolHandlers,
  createAskUserQuestionHandler,
  defaultSubagentAvailability,
  type EcoAgentRuntimeConfig,
  type CodexGatewayCatalogRoute,
  type EcoPlanningContext,
  type EcoSdkResumeOptions,
  type EcoSdkSessionOptions,
  type EcoSubagentAttributionHooks,
  evaluateFilesystemReadConfirmation,
  evaluateFilesystemWriteConfirmation,
  isCoreKind,
  isReadFilesystemTool,
  isWriteFilesystemTool,
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
  type BrowserWindowConstructorOptions,
  dialog,
  ipcMain,
  Menu,
  net,
  type NativeImage,
  Notification,
  nativeImage,
  nativeTheme,
  safeStorage,
  session,
  shell,
} from "electron";
import { ensureDesktopPath } from "./fix-desktop-path";
import { buildApplicationMenuTemplate } from "./native-menu";
import {
  readElectronResourcesPath,
  resolvePackagedClaudeExecutableCandidate,
} from "./packaged-runtime-executables";
import { evaluateThreadToolConfirmation } from "./thread-bash-permission";
import {
  resolveWindowsBackdropVersion,
  resolveWindowsBackgroundMaterial,
} from "./windows-background-material";

 ensureDesktopPath();

import { buildAgentTemplateArchive, parseAgentTemplateArchive } from "../shared/agent-template-archive";
import { resolveUpstreamApiCompat, type UpstreamApiCompat } from "../shared/api-compat";
import { expectedIpcErrorKey, translateCatalog } from "../shared/i18n-catalogs";
import {
  type AppLocale,
  type AppLocalePreference,
  normalizeLocalePreference,
  resolveAppLocale,
} from "../shared/locale";
import {
  deriveBashApprovalRememberPrefix,
  formatBashApprovalDenyMessage,
  formatFilesystemApprovalDenyMessage,
} from "../shared/bash-approval-ui";
import { enrichBillingDisplaySource } from "../shared/billing-display-source";
import { listEnabledGlobalMcpServerKeys } from "../shared/composer-mcp";
import { buildEcoCompactHandoffPrompt } from "../shared/eco-compact-handoff";
import {
  type AgentRole,
  type AgentTemplate,
  type AgentTemplateExportRequest,
  type BashApprovalRequest,
  type BashApprovalResolvePayload,
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
  isGitFetchRequest,
  isGitGenerateCommitMessageRequest,
  isGitListCommitsRequest,
  parseGitListCommitModelOptionsRequest,
  isGitPullRequest,
  isGitPushRequest,
  isKnownIpcChannel,
  isRunPackageScriptRequest,
  isSavePackageScriptArgsRequest,
  isStorageCleanupRequest,
  isTerminalInputRequest,
  isTerminalKillRequest,
  isTerminalListRequest,
  isTerminalResizeRequest,
  isTerminalSpawnRequest,
  isThreadRuntimeConfig,
  type ListUpstreamModelsRequest,
  type MainAgentConfigResource,
  type MainAgentPromptResource,
  type OrchestrationSelection,
  type SubagentOrchestrationResource,
  type McpServerConfigInput,
  type ModelSettingsSnapshot,
  normalizeThreadRuntimeConfig,
  type PlanApprovalRequest,
  type PromptImageAttachment,
  type ProviderConfigInput,
  type RouteManualSpec,
  type RouteProfileInput,
  type RuntimeAgentRole,
  type RuntimeRoleRouteConfig,
  resolveMainAgentSystemPromptPreset,
  resolveSessionMode,
  resolveThreadOrchestrationSnapshot,
  resolveThreadRuntimeMcpServerKeys,
  runtimeRoleRoutesFromOrchestrationSnapshot,
  hasCompleteOrchestrationSelection,
  materializeThreadOrchestrationSnapshot,
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
  type ThreadFollowUpEditingRequest,
  type ThreadFollowUpEnqueueRequest,
  type ThreadFollowUpEscalateRequest,
  type ThreadFollowUpMutationResult,
  type ThreadFollowUpReorderRequest,
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
  buildOrchestrationRuntimeKey,
  buildMainAgentModelKey,
  diffPromptCacheRuntimeSignatures,
  resolveMainAgentModelKey,
  resolvePromptCacheOrchestrationLabel,
  resolvePromptCacheRuntimeSignature,
} from "../shared/prompt-cache-config";
import { PROMPT_IMAGE_PREVIEWS_METADATA_KEY, type PromptImagePreview } from "../shared/prompt-image-metadata";
import {
  BUILTIN_VISION_AGENT_ROLE,
  buildPromptWithVisionAnalysis,
  buildVisionAnalysisRequestBody,
  readVisionAnalysisResponse,
} from "../shared/prompt-image-vision";
import { computeRouteFingerprint, routesMatchFingerprint } from "../shared/route-fingerprint";
import { resolveImplicitSkillReadRoots } from "../shared/skill-paths";
import {
  buildRuntimeAgentSkillAssignments,
  type LinkAgentsSkillsRequest,
  listSdkReadyProjectSkills,
  resolveExplicitCodexSkillInputs,
  resolveSdkSessionSkillConfig,
  type SdkSessionSkillsScope,
  type SkillCatalogInstallRequest,
  type SkillCatalogSearchRequest,
  type SkillInfo,
  type SkillUninstallRequest,
} from "../shared/skills";
import {
  buildThreadApprovalNotificationContent,
  buildThreadClarificationNotificationContent,
  activityLinesFromThreadRunEvents,
  buildThreadCompletionNotificationContentFromSources,
} from "../shared/thread-completion-notification";
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
import { FEED_PROJECTION_MAX_SOURCE_EVENTS } from "../shared/thread-run-projection-limits";
import {
  projectThreadRunToolMetadata,
  projectThreadRunToolMetadataForFeed,
} from "../shared/thread-run-tool-projection";
import {
  buildThreadFollowUpDisplayPrompt,
  buildThreadFollowUpDrainPrompt,
  collectThreadFollowUpAttachments,
  shouldBlockThreadFollowUpDrain,
  shouldDrainThreadFollowUps,
} from "../shared/thread-follow-up-drain";
import {
  isOrchestrationSelection,
  orchestrationConfigFromSnapshot,
} from "../shared/agent-orchestration";
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
import { collectProviderDeleteReferences } from "./provider-deletion";
import {
  type AnthropicProxyRoute,
  type AnthropicProxyStartOptions,
  type AnthropicProxyUsageHandler,
  type AnthropicProxyUsageInfo,
  resolveClaudeBridgeRoute,
  runtimeRouteToProxyRoute,
  startAnthropicModelProxy,
} from "./anthropic-proxy";
import { BackgroundTerminalTaskRegistry } from "./background-terminal-tasks";
import { resolveBashApprovalAgentId } from "./bash-approval-agent-id.js";
import {
  type BashApprovalResolution,
  buildResolvedBashApprovalThreadPatch,
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
  buildClarificationToolMetadata,
  buildIgnoredClarificationAnswers,
  cancelClarificationsForThread,
  formatClarificationAnswersSummary,
  getPendingClarificationByToolUseId,
  getPendingClarificationForThread,
  registerPendingClarification,
  submitClarification,
} from "./clarification-bridge";
import { CodexFileCheckpointStore } from "./codex-file-checkpoints";
import { runStorageCleanup } from "./storage-cleanup";
import { buildStorageUsageSnapshot } from "./storage-inventory";
import {
  CodexGatewayUsageDeduplicator,
  resolveCodexGatewayUsageBilling,
} from "./codex-gateway-usage-billing";
import { CodexGatewayUsagePendingBuffer } from "./codex-gateway-usage-pending";
import { classifyGatewayUsageEvent } from "./gateway-usage-dispatch";
import { getGlobalCodexRuntimeLifecycle, stopGlobalCodexRuntimeLifecycle } from "./codex-runtime-lifecycle";
import {
  assertCodexSkillsConfigReloadAllowed,
  compactCodexThreadForEcoThread,
  configureCodexApprovalBridge,
  configureCodexRuntimeRun,
  createCodexRuntimeDriver,
  getCodexTurnRouteRegistry,
  isCodexCliAvailable,
  registerResolvedCodexGatewayTurnRoute,
  forkCodexThreadForEcoThread,
  runThreadRequestWithRuntimeProxy as runCodexThreadRequest,
  scheduleCodexGlobalRuntimeRefresh,
} from "./codex-runtime-run";
import { applyCodexSubagentLifecycleEvent } from "./codex-subagent-lifecycle";
import { CodexSubagentRuntimeLimitController } from "./codex-subagent-runtime-limit";
import { type CodexThreadMap, resolveCodexThreadAttribution } from "./codex-thread-map";
import { type CompactionAuditService, createCompactionAuditService } from "./compaction-audit-service";
import { type ContextLifecycleService, createContextLifecycleService } from "./context-lifecycle-service";
import { logContextSnapshot } from "./context-snapshot-log";
import { ContextSnapshotScheduler } from "./context-snapshot-scheduler";
import { ContextWindowMonitor, MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES } from "./context-window-monitor";
import { repairActivityText } from "../shared/activity-text";
import { type ConversationStore, createConversationStore } from "./conversation-store";
import { ConversationStoreCodexThreadMap } from "./conversation-store-codex-thread-map";
import { presentDesktopWindow } from "./desktop-single-instance";
import { DesktopNotificationRetainer } from "./desktop-notification-retainer";
import { createEcoCompactService, type EcoCompactService } from "./eco-compact-service";
import { resolveOrchestrationGuardrails } from "./orchestration-run-budget";
import { SubagentConcurrencyGate } from "./subagent-concurrency-gate";
import { logEcoDiag, logEcoDiagThrottled, shortAgentId, shortThreadId } from "./eco-diag-log";
import { configureEcoGatewayLifecycle, ensureGlobalEcoGateway, stopGlobalEcoGateway } from "./eco-gateway-lifecycle";
import { createElectronEventSink, DesktopEventCenter } from "./event-center";
import { GitAutoFetcher } from "./git-autofetch";
import {
  checkoutGitBranch,
  createGitBranch,
  discardWorkspaceChanges,
  fetchFromOrigin,
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
import { transcribeAsr } from "./asr-client";
import { createAsrSettingsStore, type AsrSecretCodec, type AsrSettingsStore } from "./asr-settings-store";
import {
  createPersonalizationSettingsStore,
  type PersonalizationSettingsStore,
  isPersonalizationSettingsSnapshot,
  normalizePersonalizationSettingsSnapshot,
} from "./personalization-settings-store";
import {
  createBrowserSettingsStore,
  type BrowserSettingsStore,
  isBrowserSettingsSnapshot,
  normalizeBrowserSettingsSnapshot,
} from "./browser-settings-store";
import {
  createNotificationSettingsStore,
  type NotificationSettingsStore,
  isNotificationSettingsSnapshot,
  normalizeNotificationSettingsSnapshot,
} from "./notification-settings-store";
import { preferenceAllowsDesktopNotification } from "../shared/notification-settings";
import { appendBrowserPrompt, BrowserHost, isSessionEcoBrowserEnabled } from "./browser-host";
import {
  ECO_AGENT_BROWSER_MCP_SERVER,
  ECO_AGENT_BROWSER_SKILL_NAME,
  extractUrlFromBrowserOpenToolPayload,
  isEcoAgentBrowserOpenToolName,
  requiresBrowserOpenApproval,
  resolveToolNameFromActivityPayload,
  type BrowserCloseRequest,
  type BrowserFocusRequest,
  type BrowserNavigateRequest,
  type BrowserOpenRequest,
  type BrowserSetBoundsRequest,
  type BrowserSetUiScopeRequest,
  type BrowserSetVisibleRequest,
  type BrowserViewState,
} from "../shared/browser";
import {
  buildEcoAgentBrowserCodexSkillInfo,
  ensureClaudeUserEcoAgentBrowserSkill,
  removeClaudeUserEcoAgentBrowserSkill,
  resolveEcoAgentBrowserSkillFileForCodex,
} from "./eco-agent-browser-skill";
import { ensureHomeProject, getHomeProjectPath } from "./home-project-bootstrap";
import { InteractiveTerminalManager } from "./interactive-terminal-manager";
import { listWorkspaceEntries, readWorkspaceFile, writeWorkspaceFile } from "./workspace-file-browser";
import { checkMcpServerConnection } from "./mcp-checker";
import { prepareCodexMcpServersForRuntime, prepareMcpSdkConfigForRuntime } from "./mcp-runtime";
import { createMcpStore, type McpStore } from "./mcp-store";
import { ModelsDevPricingCache } from "./models-dev-pricing-cache";
import { PackageJsonWatcher } from "./package-json-watcher";
import { createPackageScriptArgsStore, type PackageScriptArgsStore } from "./package-script-args-store";
import {
  listPackageScripts,
  preparePackageScriptRun,
  runPreparedPackageScriptAsBackgroundTask,
} from "./package-scripts";
import {
  cancelPlanApprovalsForThread,
  getPendingPlanApprovalForThread,
  getPendingPlanApprovalWaitForThread,
  registerPendingPlanApproval,
  resolvePendingPlanApproval,
} from "./plan-approval-bridge";
import { createProjectMcpSettingsStore, type ProjectMcpSettingsStore } from "./project-mcp-settings-store";
import {
  createProjectOrchestrationSettingsStore,
  type ProjectOrchestrationSettingsStore,
} from "./project-orchestration-settings-store";
import {
  createProjectSkillsSettingsStore,
  type ProjectSkillsSettingsStore,
} from "./project-skills-settings-store";
import { formatPromptCacheBreakLog, resolveClaudeMdDigest } from "./prompt-cache-fingerprint";
import { createPromptCacheRunEventEmitter } from "./prompt-cache-run-events";
import { listProviderUpstreamModels, testProviderConnection, testRoleRoutes } from "./provider-models";
import { createProviderStore, type ProviderStore } from "./provider-store";
import { reconcileProxyAttributionContexts } from "./proxy-attribution-context-reconciliation";
import { ECO_PROXY_BILLING_HEADERS, ProxyBillingStampRegistry } from "./proxy-billing-stamp";
import {
  createProxyBridgeSettingsStore,
  isProxyBridgeSettingsSnapshot,
  normalizeProxyBridgeSettingsSnapshot,
  type ProxyBridgeSettingsStore,
  resolveUpstreamUserAgentOverride,
} from "./proxy-bridge-settings-store";
import { resolveProxyUsageBilling } from "./proxy-usage-billing";
import { formatUserFacingRequestError, type RequestAttemptResult } from "./request-retry";
import { reconcileSdkAgentTerminalEvent } from "./sdk-agent-terminal-reconciliation";
import type { resolveSdkEventUsageBilling, SdkRunUsageBillingInput } from "./sdk-event-usage-billing";
import { resolveSdkRunBillingResolution } from "./sdk-run-billing-resolution";
import { prepareSdkRunContextAfterCompaction } from "./sdk-run-context-compaction";
import { consumeSdkRunEvents } from "./sdk-run-event-loop";
import { buildSdkRunInput, type BuildSdkRunInput, sdkRunPhaseFromMode } from "./sdk-run-input";
import {
  listSdkSessionActivityLines,
  listSdkSessionCompactionActivityLines,
  listSdkSubagentActivityLines,
  sdkActivityLineId,
} from "./sdk-session-activity.js";
import { type SdkLocalStreamUpdate, SdkStreamActivityBridge } from "./sdk-stream-activity";
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
import { installCatalogSkill, listSkillsLeaderboard, searchSkillsCatalog } from "./skills-catalog";
import { listDiscoveredSkills } from "./skills-discovery";
import { linkAgentsSkillsToClaude } from "./skills-symlink";
import { uninstallDiscoveredSkill } from "./skills-uninstall";
import {
  clearThreadSubagentLaunchRegistry,
  getThreadSubagentLaunchRegistry,
} from "./subagent-launch-registry-store.js";
import { SubagentMetricsRegistry } from "./subagent-metrics-registry";
import { buildSubagentMetricsSummaries } from "./subagent-metrics-summary";
import { createSubagentSessionHooks } from "./subagent-session-hooks.js";
import { buildSubagentSessionTimings } from "./subagent-session-snapshots.js";
import { reconcileSubagentTerminalTranscript } from "./subagent-terminal-reconciliation.js";
import { ThreadCacheHitMonitor } from "./thread-cache-hit-monitor";
import { requireThreadCore } from "./thread-core-routing";
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
import {
  resolveAskRunOutcome,
  resolveAutonomousRunOutcome,
  resolveContinuationRunOutcome,
  resolveExecutionRunOutcome,
  resolvePlanSessionRunOutcome,
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
  filterFeedProjectionForClient,
  maxFeedProjectionTimelineSequence,
  trimProjectionForFeed,
} from "./thread-run-projection-feed";
import { parseThreadRunProjectionGetRequest } from "./thread-run-projection-request";
import { ThreadRuntimeCoordinator } from "./thread-runtime-coordinator";
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
import {
  canRegenerateThreadTitle,
  resolveFailedThreadTitle,
  resolvePendingThreadTitle,
  shouldReplaceAutoThreadTitle,
  summarizeThreadTitle,
} from "./thread-title";
import { resolveAuxiliaryModelRoute } from "./auxiliary-model-route";
import { resolveVisionModelRoute } from "./vision-model-route";
import {
  buildThreadApprovalEnvelope,
  reviewEcoApproval,
  type EcoApprovalReviewResult,
} from "./eco-approval-reviewer";
import { loadThreadTodoList } from "./thread-todo-list-runtime";
import { ThreadUsageAccumulator } from "./thread-usage-accumulator";
import {
  buildThreadUsageSnapshotResult,
  type ThreadUsageSnapshotRuntimeServices,
} from "./thread-usage-snapshot-runtime";
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
  readApprovedPlanSnapshot,
  readClaudePlanFile,
  resolveWorktreePathHint,
  writeApprovedPlanSnapshot,
  type ApprovedPlanSnapshot,
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

// The shared SQLite store and fixed-port gateway require a single main-process writer.
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

let desktopInitializationComplete = false;

app.on("second-instance", () => {
  const existingWindow = BrowserWindow.getAllWindows()[0];
  if (presentDesktopWindow(existingWindow) || !desktopInitializationComplete) {
    return;
  }
  void createMainWindow()
    .then((window) => {
      presentDesktopWindow(window);
    })
    .catch((error) => {
      process.stderr.write(`[eco] failed to reopen primary window: ${errorMessage(error)}\n`);
    });
});
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
function broadcastLocalThreadStreamUpdate(payload: ThreadLiveEvent): void {
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send(IPC_CHANNELS.threadEventsSubscribe, payload);
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
let projectMcpSettingsStore: ProjectMcpSettingsStore;
let projectOrchestrationSettingsStore: ProjectOrchestrationSettingsStore;
let projectSkillsSettingsStore: ProjectSkillsSettingsStore;
let gitSettingsStore: GitSettingsStore;
let personalizationSettingsStore: PersonalizationSettingsStore;
let browserSettingsStore: BrowserSettingsStore;
let notificationSettingsStore: NotificationSettingsStore;
let browserHost: BrowserHost | undefined;

function requireBrowserHost(): BrowserHost {
  if (!browserHost) {
    throw new Error("BrowserHost is not initialized.");
  }
  return browserHost;
}
let asrSettingsStore: AsrSettingsStore;
let packageScriptArgsStore: PackageScriptArgsStore;
let proxyBridgeSettingsStore: ProxyBridgeSettingsStore;
let centerServerClient: CenterServerDesktopClient;
let pendingThreadOpenId: string | undefined;
const desktopNotificationRetainer = new DesktopNotificationRetainer<Notification>();

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
const orchestrationGuardrails = resolveOrchestrationGuardrails();
const codexSubagentRuntimeLimit = new CodexSubagentRuntimeLimitController({
  maxRuntimeMs: orchestrationGuardrails.maxSubagentRuntimeMs,
  interruptTurn: async ({ agentId, turnId }) => {
    const client = getGlobalCodexRuntimeLifecycle()?.getClient();
    if (!client?.isInitialized) {
      throw new Error(`Codex app-server is unavailable; cannot interrupt child ${agentId} turn ${turnId}.`);
    }
    await client.request("turn/interrupt", { threadId: agentId, turnId });
  },
  onTimeout: ({ threadId, agentId, maxRuntimeMs }) => {
    const message = `Codex 子代理 ${agentId} 已运行 ${Math.round(maxRuntimeMs / 60_000)} 分钟，已单独停止。`;
    emitThreadEvent(threadId, "thread.subagent_runtime_limit", message, "system");
    logEcoDiag("codex.subagent_runtime_limit", {
      threadId: shortThreadId(threadId),
      agentId: shortAgentId(agentId),
      maxRuntimeMs,
    });
  },
  onInterruptError: ({ threadId, agentId, turnId, error }) => {
    const detail = errorMessage(error);
    const message = `Codex 子代理 ${agentId} 已超时，但停止失败：${detail}`;
    emitThreadEvent(threadId, "thread.subagent_runtime_limit_error", message, "system");
    process.stderr.write(
      `[eco-codex] timed-out subagent interrupt failed thread=${threadId} agent=${agentId} turn=${turnId}: ${detail}\n`,
    );
  },
});
const subagentConcurrencyGates = new Map<string, SubagentConcurrencyGate>();
const threadLiveRequestRegistry = new ThreadLiveRequestRegistry();
const pendingCancelDisposition = new Map<string, WorktreeCancelDisposition>();
const pendingEscalatedFollowUpDrain = new Set<string>();
const threadFollowUpDrainInFlight = new Set<string>();
const titleGeneratingThreadIds = new Set<string>();
const editingThreadFollowUpByThread = new Map<string, string>();
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
  getThreadSubagentConcurrencyGate(threadId).clear();
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
  subagentConcurrencyGates.get(threadId)?.clear();
  subagentConcurrencyGates.delete(threadId);
  clearRequestStartedPersisted(threadId);
  threadLiveRequestRegistry.clearThread(threadId);
  proxyBillingStampRegistry.clearThread(threadId);
}

function getThreadSubagentConcurrencyGate(threadId: string): SubagentConcurrencyGate {
  let gate = subagentConcurrencyGates.get(threadId);
  if (!gate) {
    gate = new SubagentConcurrencyGate({
      maxConcurrentSubagents: orchestrationGuardrails.maxConcurrentSubagents,
      readActiveSubagentCount: () => agentLifecycle.activeSubagentCount(threadId),
    });
    subagentConcurrencyGates.set(threadId, gate);
  }
  return gate;
}

const WINDOWS_TITLE_BAR_OVERLAY_HEIGHT = 40;

const WINDOW_CHROME_BY_THEME = {
  dark: {
    backgroundColor: "#212121",
    overlay: {
      color: "#212121",
      symbolColor: "#c8c8c8",
      height: WINDOWS_TITLE_BAR_OVERLAY_HEIGHT,
    },
  },
  light: {
    backgroundColor: "#ffffff",
    overlay: {
      color: "#ffffff",
      symbolColor: "#1a1a1a",
      height: WINDOWS_TITLE_BAR_OVERLAY_HEIGHT,
    },
  },
} as const;

const WINDOW_CONVERSATION_OVERLAY_COLOR_BY_THEME = {
  dark: "#171717",
  light: "#ffffff",
} as const;

const windowsUseConversationTitlebar = new WeakMap<BrowserWindow, boolean>();

function usesWindowControlsOverlay(): boolean {
  return process.platform === "win32" || process.platform === "linux";
}

function resolveWindowsMaterial(): "mica" | undefined {
  return resolveWindowsBackgroundMaterial(os.release());
}

function resolveWindowChromeTheme(): keyof typeof WINDOW_CHROME_BY_THEME {
  return nativeTheme.shouldUseDarkColors ? "dark" : "light";
}

function applyWindowControlsOverlay(window: BrowserWindow): void {
  if (!usesWindowControlsOverlay() || window.isDestroyed()) {
    return;
  }
  const chrome = WINDOW_CHROME_BY_THEME[resolveWindowChromeTheme()];
  const theme = resolveWindowChromeTheme();
  const overlayColor = windowsUseConversationTitlebar.get(window)
    ? WINDOW_CONVERSATION_OVERLAY_COLOR_BY_THEME[theme]
    : chrome.overlay.color;

  if (process.platform === "win32") {
    const isWindows10 = resolveWindowsBackdropVersion(os.release()) === "win10";
    // Mica is rendered by DWM behind the window's system background. Do not use
    // Electron's transparent-window mode: it disables native Win32 interactions
    // in combination with the Window Controls Overlay.
    window.setBackgroundColor(isWindows10 ? chrome.backgroundColor : "#00000000");
    const material = resolveWindowsMaterial();
    if (material) {
      window.setBackgroundMaterial(material);
    }
  }

  window.setTitleBarOverlay({ ...chrome.overlay, color: overlayColor });
}

function syncWindowControlsOverlays(): void {
  if (!usesWindowControlsOverlay()) {
    return;
  }
  for (const window of BrowserWindow.getAllWindows()) {
    applyWindowControlsOverlay(window);
  }
}

function setWindowControlsOverlayMode(mode: "landing" | "conversation"): void {
  if (!usesWindowControlsOverlay()) {
    return;
  }
  for (const window of BrowserWindow.getAllWindows()) {
    windowsUseConversationTitlebar.set(window, mode === "conversation");
    applyWindowControlsOverlay(window);
  }
}

async function createMainWindow(): Promise<BrowserWindow> {
  const isMac = process.platform === "darwin";
  const windowControlsOverlay = usesWindowControlsOverlay();
  const isWindows = process.platform === "win32";
  const windowsChrome = WINDOW_CHROME_BY_THEME[resolveWindowChromeTheme()];
  const windowsMaterial = isWindows ? resolveWindowsMaterial() : undefined;
  const windowsBackdropVersion = isWindows ? resolveWindowsBackdropVersion(os.release()) : undefined;
  const windowOptions: BrowserWindowConstructorOptions = {
    width: 1320,
    height: 860,
    minWidth: 480,
    minHeight: 600,
    // macOS: frameless + traffic lights inset.
    // Windows and Linux: hidden title bar + native Window Controls Overlay.
    ...(isMac
      ? {
          titleBarStyle: "hiddenInset" as const,
          transparent: true,
          backgroundColor: "#00000000",
          vibrancy: "under-window" as const,
          visualEffectState: "followWindow" as const,
        }
      : windowControlsOverlay
        ? {
            // Mica is a DWM backdrop, not a transparent Electron window.
            // Retaining the native frame preserves Win32 resize and caption
            // behavior while the renderer remains visually transparent.
            transparent: false,
            resizable: true,
            maximizable: true,
            titleBarStyle: "hidden" as const,
            titleBarOverlay: windowsChrome.overlay,
            ...(windowsMaterial ? { backgroundMaterial: windowsMaterial } : {}),
            backgroundColor:
              windowsBackdropVersion === "win10" ? windowsChrome.backgroundColor : "#00000000",
            // Keep accelerators; avoid a classic menu strip stacked under WCO.
            autoHideMenuBar: true,
          }
        : {
            backgroundColor: "#212121",
            autoHideMenuBar: true,
          }),
    ...(appIcon ? { icon: appIcon } : {}),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      ...(windowsBackdropVersion
        ? { additionalArguments: [`--eco-windows-backdrop=${windowsBackdropVersion}`] }
        : {}),
    },
  };
  const window = new BrowserWindow(windowOptions);

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
  return window;
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
  if (!hasSingleInstanceLock) {
    return;
  }
  if (appIcon && process.platform === "darwin") {
    app.dock?.setIcon(appIcon);
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      buildApplicationMenuTemplate(app.name, process.platform, (command, browserWindow) => {
        if (browserWindow instanceof BrowserWindow) {
          browserWindow.webContents.send(IPC_CHANNELS.appMenuCommand, command);
        }
      }),
    ),
  );
  const isLocalAudioPermission = (webContents: Electron.WebContents, permission: string, mediaTypes?: string[]) => {
    let localRenderer = false;
    try {
      const url = new URL(webContents.getURL());
      localRenderer = url.protocol === "file:" || url.hostname === "127.0.0.1" || url.hostname === "localhost";
    } catch {
      localRenderer = false;
    }
    return permission === "media" && localRenderer && Boolean(mediaTypes?.includes("audio")) && !mediaTypes?.includes("video");
  };
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const mediaTypes = (details as { mediaTypes?: string[] }).mediaTypes;
    callback(isLocalAudioPermission(webContents, permission, mediaTypes));
  });
  session.defaultSession.setPermissionCheckHandler((webContents, permission, _requestingOrigin, details) => {
    if (!webContents) return false;
    const mediaType = (details as { mediaType?: string }).mediaType;
    return isLocalAudioPermission(webContents, permission, mediaType ? [mediaType] : undefined);
  });
  const dbPath = path.join(app.getPath("userData"), "eco-coding.sqlite");
  providerStore = await createProviderStore(dbPath);
  agentOrchestrationStore = await createAgentOrchestrationStore(dbPath);
  mcpStore = await createMcpStore(dbPath);
  conversationStore = await createConversationStore(dbPath);
  const compactedLegacyStreamEvents = conversationStore.compactLegacyThreadRunStreamEvents();
  if (compactedLegacyStreamEvents > 0) {
    logEcoDiag("thread_run_events.legacy_streams_compacted", {
      removed: compactedLegacyStreamEvents,
    });
  }
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
  projectMcpSettingsStore = await createProjectMcpSettingsStore(dbPath);
  projectOrchestrationSettingsStore = await createProjectOrchestrationSettingsStore(dbPath);
  projectSkillsSettingsStore = await createProjectSkillsSettingsStore(dbPath);
  gitSettingsStore = await createGitSettingsStore(dbPath);
  personalizationSettingsStore = await createPersonalizationSettingsStore(dbPath);
  browserSettingsStore = await createBrowserSettingsStore(dbPath);
  notificationSettingsStore = await createNotificationSettingsStore(dbPath);
  browserHost = new BrowserHost({
    getMainWindow: () => BrowserWindow.getAllWindows().find((w) => !w.isDestroyed()),
    getSettings: () => browserSettingsStore,
    broadcast: (state: BrowserViewState) => {
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send(IPC_CHANNELS.browserStateChanged, state);
        }
      });
    },
    resolveWorkspacePath: (threadId) => conversationStore.getThread(threadId)?.workspacePath,
  });
  const asrSecretCodec: AsrSecretCodec = {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (value) => `safe-v1:${safeStorage.encryptString(value).toString("base64")}`,
    decrypt: (value) => {
      if (!value.startsWith("safe-v1:")) {
        throw new Error("ASR API key 存储格式无效。");
      }
      return safeStorage.decryptString(Buffer.from(value.slice("safe-v1:".length), "base64"));
    },
  };
  asrSettingsStore = await createAsrSettingsStore(dbPath, asrSecretCodec);
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
      return providerStore.listProvidersWithSecrets().map((provider) => {
        const candidates = providerStore.listCandidateModels(provider.id);
        return {
          id: provider.id,
          name: provider.name,
          enabled: provider.enabled,
          baseUrl: provider.baseUrl,
          requestPath: provider.requestPath,
          version: provider.version,
          apiKey: provider.apiKey,
          apiCompat: provider.apiCompat,
          defaultModel: provider.defaultModel,
          models: candidates.map((model) => ({
            modelId: model.modelId,
            ...(model.manualSpec?.maxOutputTokens !== undefined
              ? { maxOutputTokens: model.manualSpec.maxOutputTokens }
              : {}),
          })),
          modelIds: routeModels.get(provider.id) ?? [],
        };
      });
    },
    getUpstreamUserAgent: () =>
      resolveUpstreamUserAgentOverride(proxyBridgeSettingsStore.get()),
    getUpstreamProxyUrl: () => {
      const raw = proxyBridgeSettingsStore.get().upstreamProxyUrl?.trim();
      return raw || undefined;
    },
    getTurnRouteRegistry: () => getCodexTurnRouteRegistry(),
    prepareClaudeMessages: async ({ path, body, model }) => {
      const { prepareClaudeBridgeMessagesRequest } = await import("./anthropic-proxy");
      return prepareClaudeBridgeMessagesRequest({
        path,
        body,
        requestedModel: model,
      });
    },
    resolveMessagesRoute: ({ model, headers }) => {
      const resolved = resolveClaudeBridgeRoute(model, headers);
      if (!resolved) return undefined;
      return {
        providerId: resolved.providerId,
        upstreamModelId: resolved.upstreamModelId,
        upstreamKind: resolved.upstreamKind,
      };
    },
    getGlobalMaxOutputTokens: () => workflowSettingsStore.get().maxOutputLimitTokens,
    onUsage: async (event) => {
      const dispatch = classifyGatewayUsageEvent(event);
      if (dispatch.kind === "claude_messages") {
        const { emitClaudeGatewayUsageIfSession } = await import("./anthropic-proxy");
        const handled = await emitClaudeGatewayUsageIfSession({
          providerId: event.providerId,
          requestedModel: event.requestedModel,
          upstreamModelId: event.upstreamModelId,
          usage: event.usage,
          ...(event.providerRequestId ? { requestId: event.providerRequestId } : {}),
        });
        if (!handled) {
          // Title/approval/aux or closed session — do not fall into Codex turn billing.
          logEcoDiag("messages.usage_unattributed", {
            providerId: event.providerId,
            requestedModel: event.requestedModel,
            upstreamModelId: event.upstreamModelId,
            sourceEventId: event.sourceEventId,
            reason: "no_active_claude_session_or_route",
          });
          process.stderr.write(
            `[eco] messages usage not billed: no active Claude session route ` +
              `provider=${event.providerId} model=${event.upstreamModelId || event.requestedModel}\n`,
          );
        }
        return;
      }
      if (dispatch.kind === "unbillable") {
        logEcoDiag("gateway.usage_unbillable", {
          source: event.source,
          reason: dispatch.reason,
          providerId: event.providerId,
          requestedModel: event.requestedModel,
          sourceEventId: event.sourceEventId,
        });
        process.stderr.write(
          `[eco] ${event.source} usage will not be billed: ${dispatch.reason} ` +
            `provider=${event.providerId} model=${event.upstreamModelId || event.requestedModel}\n`,
        );
        return;
      }
      await handleCodexGatewayUsage(event);
    },
    onStderr: (chunk) => process.stderr.write(chunk.endsWith("\n") ? chunk : `${chunk}\n`),
  });
  configureCodexRuntimeRun({
    ecoDataDir: app.getPath("userData"),
    getGlobalUserRules: () => personalizationSettingsStore.get().globalRules,
    getGlobalContextWindowLimit: () =>
      workflowSettingsStore.get().contextWindowLimitTokens,
    enrichCatalogRoutes: async (routes) => {
      const providers = providerStore.listProviders();
      const byId = new Map(providers.map((provider) => [provider.id, provider]));
      const enriched: CodexGatewayCatalogRoute[] = [];
      for (const route of routes) {
        if (
          typeof route.manualSpec?.contextTokens === "number" &&
          route.manualSpec.contextTokens > 0
        ) {
          enriched.push(route);
          continue;
        }
        const provider = byId.get(route.providerId);
        if (!provider) {
          enriched.push(route);
          continue;
        }
        const candidate = providerStore
          .listCandidateModels(provider.id)
          .find((model) => model.modelId === route.modelId);
        const manualContext = candidate?.manualSpec?.contextTokens;
        const mapping = candidate?.modelsDevMapping;
        let contextTokens: number | undefined =
          typeof manualContext === "number" && manualContext > 0 ? manualContext : undefined;
        if (contextTokens === undefined) {
          const lookup = await pricingCache.lookupLimitsForRoute({
            baseUrl: provider.baseUrl,
            modelId: route.modelId,
            ...(mapping && { mapping }),
          });
          if (lookup?.limits.contextTokens && lookup.limits.contextTokens > 0) {
            contextTokens = lookup.limits.contextTokens;
          }
        }
        if (contextTokens === undefined) {
          enriched.push(route);
          continue;
        }
        enriched.push({
          ...route,
          manualSpec: {
            ...(route.manualSpec ?? {}),
            contextTokens,
          },
        });
      }
      return enriched;
    },
    listProviders: () =>
      providerStore.listProviders().map((provider) => ({
        id: provider.id,
        name: provider.name,
        enabled: provider.enabled,
        apiCompat: provider.apiCompat,
        defaultModel: provider.defaultModel,
        models: providerStore.listCandidateModels(provider.id).map((model) => ({
          modelId: model.modelId,
          ...(model.displayName ? { displayName: model.displayName } : {}),
          ...(model.manualSpec
            ? {
                manualSpec: {
                  ...(model.manualSpec.contextTokens !== undefined
                    ? { contextTokens: model.manualSpec.contextTokens }
                    : {}),
                  ...(model.manualSpec.supportsImageInput !== undefined
                    ? { supportsImageInput: model.manualSpec.supportsImageInput }
                    : {}),
                },
              }
            : {}),
        })),
      })),
    listCatalogRouteConfigs: () => {
      const routes: {
        providerId: string;
        modelId: string;
        apiCompat: UpstreamApiCompat;
        displayName?: string;
        manualSpec?: { contextTokens?: number; supportsImageInput?: boolean };
      }[] = [];
      for (const profile of providerStore.listRouteProfiles()) {
        for (const route of profile.routes) {
          const provider = providerStore.listProviders().find((p) => p.id === route.providerId);
          if (!provider || !route.modelId.trim()) {
            continue;
          }
          routes.push({
            providerId: route.providerId,
            modelId: route.modelId,
            apiCompat: route.apiCompat ?? provider.apiCompat,
            displayName: `${provider.name} / ${route.modelId}`,
            ...(route.manualSpec
              ? {
                  manualSpec: {
                    ...(route.manualSpec.contextTokens !== undefined
                      ? { contextTokens: route.manualSpec.contextTokens }
                      : {}),
                    ...(route.manualSpec.supportsImageInput !== undefined
                      ? { supportsImageInput: route.manualSpec.supportsImageInput }
                      : {}),
                  },
                }
              : {}),
          });
        }
      }
      return routes;
    },
    listCatalogOrchestrationAgents: () => listCodexCatalogRoutesFromSettings(),
    listCatalogThreadRoutes: () => listCodexCatalogRoutesFromThreadSnapshots(),
    listGlobalMcpServers: () => {
      const allEnabled = listEnabledGlobalMcpServerKeys(mcpStore.listServers());
      return prepareCodexMcpServersForRuntime(
        buildCodexMcpServersForConfigSync(mcpStore.listServers(), allEnabled),
      );
    },
    threadMap: codexThreadMap,
    resolveRunAttemptId: (threadId) => agentLifecycle.currentRunAttemptId(threadId),
    appendThreadRunEvent: (event) => {
      if (!conversationStore.getThread(event.threadId)) {
        throw new Error(`Refusing Codex event for unknown thread ${event.threadId}.`);
      }
      maybeRevealBrowserFromThreadRunEvent(event);
      const persisted = conversationStore.appendThreadRunEvent(event);
      if (persisted.eventType === "run.attempt.started" && isRecord(persisted.metadata)) {
        const codexThreadId =
          typeof persisted.metadata.codexThreadId === "string" ? persisted.metadata.codexThreadId.trim() : "";
        const turnId = typeof persisted.metadata.turnId === "string" ? persisted.metadata.turnId.trim() : "";
        const attribution = codexThreadId
          ? resolveCodexThreadAttribution(codexThreadMap, codexThreadId)
          : undefined;
        if (codexThreadId && turnId && attribution?.isSubagentThread) {
          codexSubagentRuntimeLimit.start({
            threadId: persisted.threadId,
            agentId: codexThreadId,
            turnId,
          });
        }
      } else if (
        (persisted.eventType === "agent.stopped" || persisted.eventType === "agent.abandoned") &&
        persisted.agentId
      ) {
        codexSubagentRuntimeLimit.stop(persisted.agentId);
      }
      applyCodexSubagentLifecycleEvent(persisted, {
        getAgentState: (threadId, agentId) => {
          const agent = conversationStore
            .listAgentInstances(threadId)
            .find((candidate) => candidate.agentId === agentId);
          return agent
            ? {
                status: agent.status,
                ...(agent.parentToolUseId && { parentToolUseId: agent.parentToolUseId }),
              }
            : undefined;
        },
        resolvePhase: (threadId) => {
          const mode = conversationStore.getThread(threadId)?.runtimeConfig?.sessionMode;
          return mode === "plan" ? "planning" : mode === "ask" ? "ask" : "execution";
        },
        startSession: (input) => conversationStore.upsertSubagentSessionActive(input),
        stopSession: (threadId, agentId) => conversationStore.markSubagentSessionStopped(threadId, agentId),
        startMetrics: (threadId, input) => subagentMetricsRegistry.onSubagentStart(threadId, input),
        stopMetrics: (threadId, input) => subagentMetricsRegistry.onSubagentStop(threadId, input),
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
    restoreFilesAfterCodexFork: async (threadId, itemId) => {
      const worktreePath = resolveThreadWorktreePath(threadId);
      if (!worktreePath) throw new Error("Codex rewind has no persisted worktree path.");
      await codexFileCheckpointStore.restore(threadId, itemId, worktreePath);
    },
    resolveCodexForkTurnIndex: (threadId, itemId) => {
      const index = conversationStore
        .listFileCheckpoints(threadId)
        .findIndex((checkpoint) => checkpoint.userMessageId === itemId);
      return index >= 0 ? index : undefined;
    },
    pruneThreadAfterCodexFork: (threadId, itemId) => {
      conversationStore.rewindThreadToActivityLine(threadId, sdkActivityLineId(itemId));
      resetThreadRuntimeAfterHistoryRewrite(threadId);
      scheduleThreadRunProjectionUpdated(threadId, { streaming: false });
    },
    scheduleThreadRunProjectionUpdated,
    onCodexThreadMapped: flushPendingCodexGatewayUsage,
    onCodexThreadAttributionRecorded: flushPendingCodexGatewayUsage,
    onCodexContextUpdated: (resolution) => {
      void contextMonitor
        .updateOccupied(resolution.ecoThreadId, resolution.billingRole, resolution.contextOccupied, {
          limit: resolution.context.limit,
        })
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
        markThreadInterrupted(ecoThreadId, "Codex Plan completed without a persisted worktree path.");
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
    getApprovalMode: (threadId) => {
      const thread = conversationStore.getThread(threadId);
      return thread
        ? ensureThreadRuntimeConfig(thread).runtimeConfig?.bashReviewMode ?? "always"
        : "always";
    },
    getBrowserOpenApprovalMode: () => browserSettingsStore.get().openApprovalMode,
    reviewApproval: (threadId, request, tool) =>
      reviewThreadToolApproval(threadId, request, tool, "codex"),
    getRoutesJson: (threadId) => JSON.stringify(resolveRoleRoutesForThread(threadId)),
    savePendingPlan: (plan) => conversationStore.savePendingPlan(plan),
    emitThreadLive: (event) => {
      if (event.type.startsWith("clarification.")) {
        const clarificationToolUseId = event.clarification?.toolUseId?.trim() || event.tool?.toolUseId?.trim();
        emitThreadEvent(
          event.threadId,
          event.type,
          event.message,
          event.role ?? "system",
          event.stream ?? false,
          {
            ...(event.clarification ? { clarification: event.clarification } : {}),
            ...(event.tool
              ? { tool: event.tool }
              : clarificationToolUseId
                ? {
                    tool: buildClarificationToolMetadata(
                      clarificationToolUseId,
                      event.type === "clarification.answered" ? "completed" : "started",
                    ),
                  }
                : {}),
          },
        );
        return;
      }
      desktopEventCenter.publishThreadLiveEvent(event);
    },
    updateThreadStatus: (threadId, patch) =>
      updateThread(threadId, {
        status: patch.status as ThreadSummary["status"],
        message: patch.message,
      }),
  });
  pricingCache = new ModelsDevPricingCache({
    cachePath: path.join(app.getPath("userData"), "models-dev-pricing.json"),
    // Chromium net stack honors OS system proxy (Clash / PAC / etc.); Node fetch does not.
    fetchImpl: net.fetch.bind(net) as typeof fetch,
  });
  pricingCatalogReady = pricingCache.getCatalog().then(() => {
    const loadError = pricingCache.getLastLoadError();
    if (loadError) {
      process.stderr.write(`[eco] models.dev pricing cache unavailable: ${loadError}\n`);
    }
  });
  billingRuntimeEnvironment = createBillingRuntimeEnvironment({
    waitUntilReady: () => pricingCatalogReady,
    resolveRuntimeRoutes: resolveRuntimeRoutesForThread,
    lookupPricing: lookupUsageBillingPricing,
  });
  contextMonitor = new ContextWindowMonitor(
    pricingCache,
    () => workflowSettingsStore.get().contextWindowLimitTokens,
  );
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
  recoverOrphanedRunningThreads();
  currentWorkspace = await ensureHomeProject();
  initializeGitAutoFetcher();
  registerIpcHandlers();
  if (centerServerClient.getSnapshot().settings.enabled) {
    void centerServerClient.start();
  }
  await createMainWindow();
  // Skill materials only when capability is ON (no CDP / no session inject at boot).
  if (browserSettingsStore.get().agentIntegrationEnabled) {
    void ensureClaudeUserEcoAgentBrowserSkill().catch((error) => {
      process.stderr.write(
        `[eco-browser] skill ensure failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    });
  }
  desktopInitializationComplete = true;

  nativeTheme.on("updated", () => {
    syncWindowControlsOverlays();
  });

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
  settleActiveRunsBeforeQuit();
  browserHost?.dispose();
  codexSubagentRuntimeLimit.clear();
  flushAllThreadMetrics();
  codexGatewayUsagePending.dispose();
  codexGatewayUsageDeduplicator.clear();
  gitAutoFetcher?.dispose();
  centerServerClient?.dispose();
  void stopGlobalCodexRuntimeLifecycle();
  void stopGlobalEcoGateway();
});

function settleActiveRunsBeforeQuit(): void {
  for (const thread of conversationStore?.listThreads?.() ?? []) {
    const runtimeActive = activeRunRuntimeState.hasRun(thread.id);
    const persistedActive = thread.status === "running" || thread.status === "queued";
    if (!runtimeActive && !persistedActive) continue;

    activeRunRuntimeState.abortRun(thread.id, "application quitting");
    cancelClarificationsForThread(thread.id, "application quitting");
    cancelBashApprovalsForThread(thread.id, "application quitting");
    cancelPlanApprovalsForThreadWithStoreCleanup(thread.id, "application quitting");
    settleRecoveredLifecycleRecords(thread.id, "cancelled");
    updateThread(thread.id, {
      status: "idle",
      message: "应用退出时已停止运行。可在本对话继续发送消息。",
    });
    emitThreadEvent(thread.id, "thread.idle", "应用退出时已停止运行。", "system");
    finishActiveRun(thread.id);
  }
}

function getModelSettingsSnapshot(): ModelSettingsSnapshot {
  return {
    ...mergeAgentRegistrySettings(providerStore.getSettings(), agentOrchestrationStore),
    mcpSettings: mcpStore.getSettings(),
  };
}

function listCodexCatalogRoutesFromSettings(): CodexGatewayCatalogRoute[] {
  const settings = getModelSettingsSnapshot();
  const refs = [
    ...settings.mainAgentConfigs.map((config) => config.modelRef),
    ...settings.subagentOrchestrations.flatMap((orchestration) =>
      orchestration.agents.map((agent) => agent.modelRef),
    ),
  ];
  return collectCodexCatalogRoutesFromModelRefs(refs, settings.providers);
}

function listCodexCatalogRoutesFromThreadSnapshots(): CodexGatewayCatalogRoute[] {
  const settings = getModelSettingsSnapshot();
  const refs: Array<{
    providerId: string;
    modelId: string;
    apiCompat?: UpstreamApiCompat;
    manualSpec?: RouteManualSpec;
    candidateModelId?: string;
  }> = [];

  for (const thread of conversationStore.listThreads()) {
    const config = thread.runtimeConfig;
    const snapshot = config?.resolvedOrchestrationSnapshot;
    if (snapshot) {
      refs.push(snapshot.mainAgent.modelRef, ...snapshot.agents.map((agent) => agent.modelRef));
    }
    if (config?.mainAgentModelOverride) {
      refs.push(config.mainAgentModelOverride);
    }
  }
  return collectCodexCatalogRoutesFromModelRefs(refs, settings.providers);
}

function collectCodexCatalogRoutesFromModelRefs(
  refs: readonly {
    providerId: string;
    modelId: string;
    apiCompat?: UpstreamApiCompat;
    manualSpec?: RouteManualSpec;
    candidateModelId?: string;
  }[],
  providers: readonly { id: string; name: string; apiCompat: UpstreamApiCompat }[],
): CodexGatewayCatalogRoute[] {
  const providerById = new Map(providers.map((provider) => [provider.id, provider]));
  return refs.flatMap((ref) => {
    const providerId = ref.providerId.trim();
    const candidate = ref.candidateModelId
      ? providerStore
          .listCandidateModels(providerId)
          .find((model) => model.id === ref.candidateModelId)
      : undefined;
    const modelId = (candidate?.modelId || ref.modelId).trim();
    const manualSpec = mergeRouteManualSpec(candidate?.manualSpec, ref.manualSpec);
    const provider = providerById.get(providerId);
    if (!providerId || !modelId || !provider) {
      return [];
    }
    return [
      {
        providerId,
        modelId,
        apiCompat: ref.apiCompat ?? provider.apiCompat,
        displayName: `${provider.name} / ${modelId}`,
        ...(manualSpec
          ? {
              manualSpec: {
                ...(manualSpec.contextTokens !== undefined
                  ? { contextTokens: manualSpec.contextTokens }
                  : {}),
                ...(manualSpec.supportsImageInput !== undefined
                  ? { supportsImageInput: manualSpec.supportsImageInput }
                  : {}),
              },
            }
          : {}),
      } satisfies CodexGatewayCatalogRoute,
    ];
  });
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

function createUniqueImportedTemplateId(baseId: string, existingIds: ReadonlySet<string>): string {
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

function ensureThreadRuntimeConfig(thread: ThreadSummary): ThreadSummary {
  return thread;
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

function parseThreadRuntimeConfigInput(value: unknown): ThreadRuntimeConfig {
  if (!isThreadRuntimeConfig(value)) {
    throw new Error("Invalid thread runtime configuration.");
  }
  return normalizeThreadRuntimeConfig(value);
}

/**
 * Materialize component selection + resolved snapshot for persistence.
 * Callers that only change bashReviewMode while a snapshot already exists should
 * keep the existing snapshot instead of re-resolving.
 */
function getDefaultOrchestrationSelection(): OrchestrationSelection | undefined {
  return workflowSettingsStore.get().defaultOrchestrationSelection;
}

function getRememberedOrchestrationSelections(): OrchestrationSelection[] {
  const globalDefault = getDefaultOrchestrationSelection();
  return [
    ...(globalDefault ? [globalDefault] : []),
    ...projectOrchestrationSettingsStore.listSelections(),
  ];
}

function materializeThreadRuntimeConfig(
  settings: ModelSettingsSnapshot,
  config: ThreadRuntimeConfig,
): ThreadRuntimeConfig {
  const normalized = normalizeThreadRuntimeConfig(config);
  if (!hasCompleteOrchestrationSelection(normalized.orchestrationSelection)) {
    throw new Error("无法物化线程运行时配置：编排组合不完整。");
  }
  try {
    const materialized = materializeThreadOrchestrationSnapshot(settings, normalized.orchestrationSelection);
    return normalizeThreadRuntimeConfig({
      ...normalized,
      ...materialized,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`无法物化线程运行时配置：${detail}`);
  }
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
  const snapshot = resolveThreadOrchestrationSnapshot(settings, config);
  if (!snapshot) {
    throw new Error("找不到线程编排快照，请重新选择完整组合。");
  }
  return resolveCandidateModelDefaults(
    runtimeRoleRoutesFromOrchestrationSnapshot(snapshot, config.mainAgentModelOverride),
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
  _settings: ModelSettingsSnapshot,
  config: ThreadRuntimeConfig,
): { requireCompleteCodingRoutes?: boolean } {
  // Orchestration snapshots only materialize routes that exist in the selection
  // (planner-only for subagents=none, planner + enabled roster agents otherwise).
  void resolveThreadOrchestrationSnapshot(_settings, config);
  return { requireCompleteCodingRoutes: false };
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
  if (routes.some((route) => route.role === BUILTIN_VISION_AGENT_ROLE)) {
    return routes;
  }
  const thread = conversationStore.getThread(threadId);
  const visionSelection = thread
    ? ensureThreadRuntimeConfig(thread).runtimeConfig?.visionModel
    : undefined;
  if (visionSelection) {
    try {
      const visionRoute = resolveVisionModelRoute(visionSelection, providerStore);
      return [
        ...routes,
        {
          ...visionRoute,
          role: BUILTIN_VISION_AGENT_ROLE,
          manualSpec: {
            ...visionRoute.manualSpec,
            maxOutputTokens: 1600,
          },
        },
      ];
    } catch {
      // Fall through to planner clone when the saved vision selection is stale.
    }
  }
  const plannerRoute = routes.find((route) => route.role === "planner");
  if (!plannerRoute) {
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
  const snapshot = resolveThreadOrchestrationSnapshot(settings, runtimeConfig);
  if (!snapshot) {
    return undefined;
  }
  const systemPromptPreset = resolveMainAgentSystemPromptPreset(snapshot, runtimeConfig);
  const config = orchestrationConfigFromSnapshot(snapshot);
  return {
    templates: settings.agentTemplates,
    orchestration:
      systemPromptPreset === snapshot.mainAgent.systemPromptPreset
        ? config
        : {
            ...config,
            mainAgent: { ...config.mainAgent, systemPromptPreset },
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
  const invoke = async (...args: Args): Promise<Result> => {
    try {
      return await handler(...args);
    } catch (error) {
      throw localizeExpectedIpcError(error);
    }
  };
  if (isRemoteCommandChannel(channel)) {
    desktopEventCenter.registerCommand(channel, (args) => invoke(...(args as Args)));
  }
  ipcMain.handle(channel, async (_event, ...args: unknown[]) => invoke(...(args as Args)));
}

function parseComposerDraftContextKey(value: unknown): string {
  const key = typeof value === "string" ? value.trim() : "";
  if (!key || key.length > 4_096 || (!key.startsWith("thread:") && !key.startsWith("landing:"))) {
    throw new Error("Invalid composer draft context key.");
  }
  return key;
}

type AppThemeSource = "dark" | "light" | "system";
let appLocalePreference: AppLocalePreference = "system";

function normalizeAppThemeSource(value: unknown): AppThemeSource {
  return value === "dark" || value === "light" || value === "system" ? value : "system";
}

function currentAppLocale(): AppLocale {
  return resolveAppLocale(appLocalePreference, [app.getLocale()]);
}

function mainText(
  key: Parameters<typeof translateCatalog>[1],
  variables?: Parameters<typeof translateCatalog>[2],
): string {
  return translateCatalog(currentAppLocale(), key, variables);
}

function localizeExpectedIpcError(error: unknown): unknown {
  if (!(error instanceof Error)) {
    return error;
  }
  const message = error.message.trim();
  const key = expectedIpcErrorKey(message);
  return key ? new Error(mainText(key)) : error;
}

async function openThreadFromDesktopNotification(threadId: string): Promise<void> {
  pendingThreadOpenId = threadId;
  let window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
  if (!window || window.isDestroyed()) {
    window = await createMainWindow();
  }
  const loading = window.webContents.isLoading();
  presentDesktopWindow(window);
  if (process.platform === "darwin") {
    app.focus({ steal: true });
  }
  if (loading) {
    await Promise.race([
      new Promise<void>((resolve) => {
        window.webContents.once("did-finish-load", () => resolve());
      }),
      new Promise<void>((resolve) => {
        setTimeout(resolve, 8_000);
      }),
    ]);
  }
  // Prefer payload over consume so open still works if pending was already drained.
  window.webContents.send(IPC_CHANNELS.appThreadOpenRequested, threadId);
}

function evaluateDesktopNotificationDelivery(
  kind: "completion" | "approval" | "question",
  activelyViewed: boolean,
): { ok: true } | { ok: false; reason: "unsupported" | "preference_disabled" } {
  if (!Notification.isSupported()) {
    return { ok: false, reason: "unsupported" };
  }
  const settings = notificationSettingsStore.get();
  if (!preferenceAllowsDesktopNotification(settings, kind, activelyViewed)) {
    return { ok: false, reason: "preference_disabled" };
  }
  return { ok: true };
}

function showDesktopNotification(content: { title: string; body: string }, threadId: string): void {
  const notification = new Notification({
    title: content.title,
    body: content.body,
    ...(appIcon ? { icon: appIcon } : {}),
  });
  notification.on("click", () => {
    void openThreadFromDesktopNotification(threadId).catch((error) => {
      process.stderr.write(
        `[eco] failed to open thread from notification (${threadId}): ${errorMessage(error)}\n`,
      );
    });
  });
  desktopNotificationRetainer.show(notification);
}

function registerIpcHandlers(): void {
  registerDesktopCommand(IPC_CHANNELS.coreAvailabilityGet, async () => {
    const codexAvailable = isCodexCliAvailable();
    return {
      claude: { available: true as const },
      codex: {
        available: codexAvailable,
        ...(!codexAvailable && {
          reason: mainText("native.codexUnavailable"),
        }),
      },
    };
  });

  registerDesktopCommand(IPC_CHANNELS.appSetThemeSource, async (payload: unknown) => {
    const themeSource = normalizeAppThemeSource(payload);
    nativeTheme.themeSource = themeSource;
    syncWindowControlsOverlays();
    return { themeSource };
  });

  registerDesktopCommand(IPC_CHANNELS.appSetWindowTitlebarMode, async (payload: unknown) => {
    if (payload !== "landing" && payload !== "conversation") {
      throw new Error("Invalid window titlebar mode.");
    }
    setWindowControlsOverlayMode(payload);
    return { mode: payload };
  });

  registerDesktopCommand(IPC_CHANNELS.appSetLocale, async (payload: unknown) => {
    appLocalePreference = normalizeLocalePreference(payload);
    return { localePreference: appLocalePreference };
  });

  registerDesktopCommand(IPC_CHANNELS.appConsumePendingThreadOpen, async () => {
    const threadId = pendingThreadOpenId;
    pendingThreadOpenId = undefined;
    return threadId;
  });

  registerDesktopCommand(IPC_CHANNELS.appShowThreadCompletionNotification, async (payload: unknown) => {
    if (
      !isRecord(payload) ||
      typeof payload.threadId !== "string" ||
      !payload.threadId.trim() ||
      typeof payload.activelyViewed !== "boolean"
    ) {
      return { shown: false, reason: "invalid_request" } as const;
    }
    const gate = evaluateDesktopNotificationDelivery("completion", payload.activelyViewed);
    if (!gate.ok) {
      return { shown: false, reason: gate.reason } as const;
    }
    const thread = conversationStore.getThread(payload.threadId);
    if (!thread) {
      return { shown: false, reason: "thread_not_found" } as const;
    }
    if (thread.status !== "completed") {
      return { shown: false, reason: "thread_not_completed" } as const;
    }
    // Codex keeps finals in run events; Claude may still source from SDK session.
    const content = buildThreadCompletionNotificationContentFromSources(thread, [
      await listThreadActivityFromSdkSession(thread.id),
      conversationStore.listActivityLines(thread.id),
      activityLinesFromThreadRunEvents(conversationStore.listThreadRunEvents(thread.id)),
    ]);
    if (!content) {
      return { shown: false, reason: "notification_content_unavailable" } as const;
    }

    showDesktopNotification(content, thread.id);
    return { shown: true } as const;
  });

  registerDesktopCommand(IPC_CHANNELS.appShowThreadApprovalNotification, async (payload: unknown) => {
    if (
      !isRecord(payload) ||
      typeof payload.threadId !== "string" ||
      (payload.kind !== "plan" && payload.kind !== "bash") ||
      typeof payload.activelyViewed !== "boolean"
    ) {
      return { shown: false, reason: "invalid_request" } as const;
    }
    const gate = evaluateDesktopNotificationDelivery("approval", payload.activelyViewed);
    if (!gate.ok) {
      return { shown: false, reason: gate.reason } as const;
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
    const content = buildThreadApprovalNotificationContent(thread, kind, approval, currentAppLocale());
    if (!content) {
      return { shown: false, reason: "notification_content_unavailable" } as const;
    }

    showDesktopNotification(content, thread.id);
    return { shown: true } as const;
  });

  registerDesktopCommand(IPC_CHANNELS.appShowThreadClarificationNotification, async (payload: unknown) => {
    if (
      !isRecord(payload) ||
      typeof payload.threadId !== "string" ||
      !payload.threadId.trim() ||
      typeof payload.activelyViewed !== "boolean"
    ) {
      return { shown: false, reason: "invalid_request" } as const;
    }
    const gate = evaluateDesktopNotificationDelivery("question", payload.activelyViewed);
    if (!gate.ok) {
      return { shown: false, reason: gate.reason } as const;
    }
    const thread = conversationStore.getThread(payload.threadId);
    if (!thread) {
      return { shown: false, reason: "thread_not_found" } as const;
    }
    const clarification = getPendingClarificationForThread(thread.id);
    if (!clarification) {
      return { shown: false, reason: "clarification_not_pending" } as const;
    }
    const content = buildThreadClarificationNotificationContent(
      thread,
      clarification,
      currentAppLocale(),
    );
    if (!content) {
      return { shown: false, reason: "notification_content_unavailable" } as const;
    }

    showDesktopNotification(content, thread.id);
    return { shown: true } as const;
  });

  registerDesktopCommand(IPC_CHANNELS.workspaceOpen, async () => {
    const result = await dialog.showOpenDialog({
      title: mainText("native.openProject"),
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

  registerDesktopCommand(IPC_CHANNELS.workspaceListEntries, async (payload: unknown) => {
    if (!payload || typeof payload !== "object") {
      throw new Error("Invalid workspace list entries request.");
    }
    const request = payload as { workspacePath?: unknown; directoryPath?: unknown };
    if (typeof request.workspacePath !== "string" || typeof request.directoryPath !== "string") {
      throw new Error("Workspace path and directory path are required.");
    }
    return listWorkspaceEntries({ workspacePath: request.workspacePath, directoryPath: request.directoryPath });
  });

  registerDesktopCommand(IPC_CHANNELS.workspaceReadFile, async (payload: unknown) => {
    if (!payload || typeof payload !== "object") {
      throw new Error("Invalid workspace read file request.");
    }
    const request = payload as { workspacePath?: unknown; filePath?: unknown };
    if (typeof request.workspacePath !== "string" || typeof request.filePath !== "string") {
      throw new Error("Workspace path and file path are required.");
    }
    return readWorkspaceFile({ workspacePath: request.workspacePath, filePath: request.filePath });
  });

  registerDesktopCommand(IPC_CHANNELS.workspaceWriteFile, async (payload: unknown) => {
    if (!payload || typeof payload !== "object") {
      throw new Error("Invalid workspace write file request.");
    }
    const request = payload as { workspacePath?: unknown; filePath?: unknown; content?: unknown };
    if (typeof request.workspacePath !== "string" || typeof request.filePath !== "string") {
      throw new Error("Workspace path and file path are required.");
    }
    if (typeof request.content !== "string") {
      throw new Error("Content must be a string.");
    }
    return writeWorkspaceFile({
      workspacePath: request.workspacePath,
      filePath: request.filePath,
      content: request.content,
    });
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

  registerDesktopCommand(IPC_CHANNELS.threadList, async () => conversationStore.listThreads());

  registerDesktopCommand(IPC_CHANNELS.threadGet, async (threadId: unknown) => {
    const id = typeof threadId === "string" ? threadId.trim() : "";
    if (!id) {
      return undefined;
    }
    const thread = conversationStore.getThread(id);
    return thread ? ensureThreadRuntimeConfig(thread) : undefined;
  });

  registerDesktopCommand(IPC_CHANNELS.composerDraftGet, async (contextKey: unknown) => {
    return conversationStore.getComposerDraft(parseComposerDraftContextKey(contextKey));
  });

  registerDesktopCommand(IPC_CHANNELS.composerDraftSave, async (payload: unknown) => {
    if (!payload || typeof payload !== "object") {
      throw new Error("Invalid composer draft save request.");
    }
    const record = payload as { contextKey?: unknown; prompt?: unknown };
    if (typeof record.prompt !== "string") {
      throw new Error("Composer draft prompt must be a string.");
    }
    return conversationStore.saveComposerDraft(
      parseComposerDraftContextKey(record.contextKey),
      record.prompt,
    );
  });

  registerDesktopCommand(IPC_CHANNELS.composerDraftDelete, async (contextKey: unknown) => {
    conversationStore.deleteComposerDraft(parseComposerDraftContextKey(contextKey));
    return { ok: true as const };
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

    await deleteThreadFully(threadId);
    void requireBrowserHost().disposeThreadScope(threadId);
    emitThreadEvent(threadId, "thread.deleted", "对话已删除。", "system", false);
    return { ok: true as const };
  });

  registerDesktopCommand(IPC_CHANNELS.threadRegenerateTitle, async (payload: unknown) => {
    const threadId = typeof payload === "string" ? payload.trim() : "";
    if (!threadId) {
      throw new Error("Thread id is required.");
    }
    const thread = conversationStore.getThread(threadId);
    if (!thread) {
      throw new Error("Thread not found.");
    }
    const regenerated = scheduleThreadTitleSummary(threadId);
    return { ok: true as const, regenerated };
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
    const settings = getModelSettingsSnapshot();
    let runtimeConfig = incoming;
    if (thread.status === "running" || thread.status === "queued") {
      if (!existing || !isBashReviewModeOnlyRuntimeConfigUpdate(existing, incoming)) {
        throw new Error("请等待当前运行结束后再修改配置。");
      }
      // Keep the already-materialized snapshot for bash-only updates while running.
      runtimeConfig = { ...existing, bashReviewMode: incoming.bashReviewMode };
    } else if (
      existing &&
      isBashReviewModeOnlyRuntimeConfigUpdate(existing, incoming) &&
      existing.resolvedOrchestrationSnapshot
    ) {
      runtimeConfig = {
        ...existing,
        bashReviewMode: incoming.bashReviewMode,
      };
    } else {
      runtimeConfig = materializeThreadRuntimeConfig(settings, incoming);
    }
    if (thread.coreKind === "codex") {
      await assertCodexSkillsConfigReloadAllowed(
        threadId,
        existing?.skillsEnabled,
        runtimeConfig.skillsEnabled,
      );
    }
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
        const orchestrationLabel = driftKinds.includes("orchestration")
          ? resolvePromptCacheOrchestrationLabel(settings, runtimeConfig)
          : undefined;
        promptCacheRunEventEmitter.emitConfigDrift(threadId, driftKinds, {
          ...(orchestrationLabel && { orchestrationLabel }),
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
    const projection = buildCurrentThreadRunProjection(request.threadId, {
      fullHistory: request.mode !== "feed",
    });
    if (!projection) {
      return undefined;
    }
    if (request.mode !== "feed") {
      return projection;
    }
    return filterFeedProjectionForClient(trimProjectionForFeed(projection), request);
  });

  registerDesktopCommand(IPC_CHANNELS.threadRunProjectionDetailGet, async (payload: unknown) => {
    const request = parseThreadRunProjectionDetailRequest(payload);
    if (!request) {
      return undefined;
    }
    const projection = buildCurrentThreadRunProjection(request.threadId, { fullHistory: true });
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
    const trimmedProviderId = providerId.trim();
    if (!providerStore.getProviderWithSecret(trimmedProviderId)) {
      return { ok: false as const, reason: "not_found" as const, references: [] };
    }
    const references = collectProviderDeleteReferences(
      trimmedProviderId,
      getModelSettingsSnapshot(),
      conversationStore.listThreads(),
    );
    if (references.length > 0) {
      return { ok: false as const, reason: "in_use" as const, references };
    }
    providerStore.deleteProvider(trimmedProviderId);
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
    // models.dev enrichment is best-effort; never block listing/adding candidates.
    try {
      return await resolveCandidateModels(pricingCache, candidates, baseUrl);
    } catch (error) {
      process.stderr.write(
        `[eco] candidate-model:list pricing enrich failed: ${errorMessage(error)}\n`,
      );
      return candidates;
    }
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

  registerDesktopCommand(IPC_CHANNELS.mainAgentConfigSave, async (payload: unknown) => {
    if (!payload || typeof payload !== "object") {
      throw new Error("主 Agent 配置不能为空。");
    }
    const config = payload as MainAgentConfigResource;
    if (typeof config.id !== "string" || !config.id.trim()) {
      throw new Error("主 Agent 配置 id 不能为空。");
    }
    const saved = agentOrchestrationStore.saveMainAgentConfig(config);
    emitSettingsUpdated();
    return saved;
  });

  registerDesktopCommand(IPC_CHANNELS.mainAgentConfigDelete, async (configId: unknown) => {
    if (typeof configId !== "string" || !configId.trim()) {
      throw new Error("主 Agent 配置 id 不能为空。");
    }
    agentOrchestrationStore.deleteMainAgentConfig(configId, getRememberedOrchestrationSelections());
    emitSettingsUpdated();
    return { ok: true as const };
  });

  registerDesktopCommand(IPC_CHANNELS.mainAgentPromptSave, async (payload: unknown) => {
    if (!payload || typeof payload !== "object") {
      throw new Error("主 Agent 提示词不能为空。");
    }
    const prompt = payload as MainAgentPromptResource;
    if (typeof prompt.id !== "string" || !prompt.id.trim()) {
      throw new Error("主 Agent 提示词 id 不能为空。");
    }
    const saved = agentOrchestrationStore.saveMainAgentPrompt(prompt);
    emitSettingsUpdated();
    return saved;
  });

  registerDesktopCommand(IPC_CHANNELS.mainAgentPromptDelete, async (promptId: unknown) => {
    if (typeof promptId !== "string" || !promptId.trim()) {
      throw new Error("主 Agent 提示词 id 不能为空。");
    }
    agentOrchestrationStore.deleteMainAgentPrompt(promptId, getRememberedOrchestrationSelections());
    emitSettingsUpdated();
    return { ok: true as const };
  });

  registerDesktopCommand(IPC_CHANNELS.subagentOrchestrationSave, async (payload: unknown) => {
    if (!payload || typeof payload !== "object") {
      throw new Error("子代理编排不能为空。");
    }
    const orchestration = payload as SubagentOrchestrationResource;
    if (typeof orchestration.id !== "string" || !orchestration.id.trim()) {
      throw new Error("子代理编排 id 不能为空。");
    }
    const saved = agentOrchestrationStore.saveSubagentOrchestration(orchestration);
    emitSettingsUpdated();
    return saved;
  });

  registerDesktopCommand(IPC_CHANNELS.subagentOrchestrationDelete, async (orchestrationId: unknown) => {
    if (typeof orchestrationId !== "string" || !orchestrationId.trim()) {
      throw new Error("子代理编排 id 不能为空。");
    }
    agentOrchestrationStore.deleteSubagentOrchestration(orchestrationId);
    workflowSettingsStore.clearDefaultSubagentOrchestrationReference(orchestrationId);
    projectOrchestrationSettingsStore.clearSubagentOrchestrationReference(orchestrationId);
    emitSettingsUpdated();
    return { ok: true as const };
  });

  registerDesktopCommand(IPC_CHANNELS.billingModelsDevList, async () => {
    await pricingCatalogReady;
    try {
      return await pricingCache.listModelOptions();
    } catch (error) {
      process.stderr.write(
        `[eco] billing:models-dev-list failed: ${errorMessage(error)}\n`,
      );
      return [];
    }
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

  registerDesktopCommand(IPC_CHANNELS.projectMcpSettingsGet, async (payload: unknown) => {
    if (typeof payload !== "string" || !payload.trim()) {
      throw new Error("Invalid project MCP settings workspace path.");
    }
    return projectMcpSettingsStore.get(payload);
  });

  registerDesktopCommand(IPC_CHANNELS.projectMcpSettingsSave, async (payload: unknown) => {
    if (
      !isRecord(payload) ||
      typeof payload.workspacePath !== "string" ||
      !isRecord(payload.enabledByServer)
    ) {
      throw new Error("Invalid project MCP settings.");
    }
    return projectMcpSettingsStore.save({
      workspacePath: payload.workspacePath,
      enabledByServer: Object.fromEntries(
        Object.entries(payload.enabledByServer).filter(
          (entry): entry is [string, boolean] => typeof entry[1] === "boolean",
        ),
      ),
    });
  });

  registerDesktopCommand(IPC_CHANNELS.projectOrchestrationSettingsGet, async (payload: unknown) => {
    if (typeof payload !== "string" || !payload.trim()) {
      throw new Error("Invalid project orchestration settings workspace path.");
    }
    return projectOrchestrationSettingsStore.get(payload);
  });

  registerDesktopCommand(IPC_CHANNELS.projectOrchestrationSettingsSave, async (payload: unknown) => {
    if (
      !isRecord(payload) ||
      typeof payload.workspacePath !== "string" ||
      !isOrchestrationSelection(payload.orchestrationSelection)
    ) {
      throw new Error("Invalid project orchestration settings.");
    }
    return projectOrchestrationSettingsStore.save({
      workspacePath: payload.workspacePath,
      orchestrationSelection: payload.orchestrationSelection,
    });
  });

  registerDesktopCommand(IPC_CHANNELS.workflowSettingsGet, async () => workflowSettingsStore.get());

  registerDesktopCommand(IPC_CHANNELS.workflowSettingsSave, async (payload: unknown) => {
    if (!isWorkflowSettingsSnapshot(payload)) {
      throw new Error("Invalid workflow settings.");
    }
    const previous = workflowSettingsStore.get();
    const saved = workflowSettingsStore.save(normalizeWorkflowSettingsSnapshot(payload));
    if (saved.contextWindowLimitTokens !== previous.contextWindowLimitTokens) {
      scheduleCodexGlobalRuntimeRefresh();
    }
    if (saved.maxOutputLimitTokens !== previous.maxOutputLimitTokens) {
      void ensureGlobalEcoGateway().catch((error) => {
        process.stderr.write(
          `[eco] eco-gateway refresh after max output change failed: ${error instanceof Error ? error.message : String(error)}\n`,
        );
      });
    }
    return saved;
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

  registerDesktopCommand(IPC_CHANNELS.personalizationSettingsGet, async () =>
    personalizationSettingsStore.get(),
  );

  registerDesktopCommand(IPC_CHANNELS.personalizationSettingsSave, async (payload: unknown) => {
    if (!isPersonalizationSettingsSnapshot(payload)) {
      throw new Error("Invalid personalization settings.");
    }
    return personalizationSettingsStore.save(normalizePersonalizationSettingsSnapshot(payload));
  });

  registerDesktopCommand(IPC_CHANNELS.browserSettingsGet, async () => browserSettingsStore.get());

  registerDesktopCommand(IPC_CHANNELS.browserSettingsSave, async (payload: unknown) => {
    if (!isBrowserSettingsSnapshot(payload)) {
      throw new Error("Invalid browser settings.");
    }
    const next = normalizeBrowserSettingsSnapshot(payload);
    if (next.agentIntegrationEnabled) {
      const ensured = await ensureClaudeUserEcoAgentBrowserSkill();
      if (!ensured.ok) {
        throw new Error(`无法安装内置浏览器 skill：${ensured.reason}`);
      }
      if (!resolveEcoAgentBrowserSkillFileForCodex()) {
        throw new Error("未找到打包的 eco-agent-browser skill 文件。");
      }
      // Persist so isFeatureAvailable sees the capability flag, then check binary only.
      const saved = browserSettingsStore.save(next);
      const feature = requireBrowserHost().isFeatureAvailable();
      if (!feature.available) {
        browserSettingsStore.save({
          agentIntegrationEnabled: false,
          openApprovalMode: next.openApprovalMode,
        });
        throw new Error(`无法启用内置浏览器 Agent 能力：${feature.reason ?? "未知原因"}`);
      }
      return saved;
    }
    await removeClaudeUserEcoAgentBrowserSkill();
    return browserSettingsStore.save(next);
  });

  registerDesktopCommand(IPC_CHANNELS.notificationSettingsGet, async () =>
    notificationSettingsStore.get(),
  );

  registerDesktopCommand(IPC_CHANNELS.notificationSettingsSave, async (payload: unknown) => {
    if (!isNotificationSettingsSnapshot(payload)) {
      throw new Error("Invalid notification settings.");
    }
    return notificationSettingsStore.save(normalizeNotificationSettingsSnapshot(payload));
  });

  registerDesktopCommand(IPC_CHANNELS.browserGetState, async () => requireBrowserHost().getState());

  registerDesktopCommand(IPC_CHANNELS.browserSetVisible, async (payload: unknown) => {
    const request = payload as BrowserSetVisibleRequest;
    if (!request || typeof request.visible !== "boolean") {
      throw new Error("Invalid browser visibility payload.");
    }
    return requireBrowserHost().setVisible(
      request.visible,
      typeof request.browserId === "string" ? request.browserId : undefined,
    );
  });

  registerDesktopCommand(IPC_CHANNELS.browserSetBounds, async (payload: unknown) => {
    const request = payload as BrowserSetBoundsRequest;
    const bounds = request?.bounds;
    if (
      !bounds ||
      typeof bounds.x !== "number" ||
      typeof bounds.y !== "number" ||
      typeof bounds.width !== "number" ||
      typeof bounds.height !== "number"
    ) {
      throw new Error("Invalid browser bounds payload.");
    }
    return requireBrowserHost().setBounds(
      bounds,
      typeof request.browserId === "string" ? request.browserId : undefined,
    );
  });

  registerDesktopCommand(IPC_CHANNELS.browserNavigate, async (payload: unknown) => {
    const request = payload as BrowserNavigateRequest;
    if (!request || typeof request.url !== "string") {
      throw new Error("Invalid browser navigate payload.");
    }
    return requireBrowserHost().openSharedSession({
      url: request.url,
      revealUi: request.reveal !== false,
      ...(typeof request.browserId === "string" ? { browserId: request.browserId } : {}),
      ...(typeof request.threadId === "string" ? { threadId: request.threadId } : {}),
    });
  });

  registerDesktopCommand(IPC_CHANNELS.browserOpen, async (payload: unknown) => {
    const request = (payload && typeof payload === "object" ? payload : {}) as BrowserOpenRequest;
    const url =
      typeof request.url === "string"
        ? request.url
        : typeof payload === "string"
          ? payload
          : undefined;
    return requireBrowserHost().openSharedSession({
      revealUi: request.reveal !== false,
      ...(url && url.trim() && url !== "about:blank" ? { url } : {}),
      ...(typeof request.browserId === "string" ? { browserId: request.browserId } : {}),
      ...(typeof request.threadId === "string" ? { threadId: request.threadId } : {}),
      ...(request.newBrowser ? { newBrowser: true } : {}),
    });
  });

  registerDesktopCommand(IPC_CHANNELS.browserFocus, async (payload: unknown) => {
    const request = payload as BrowserFocusRequest;
    if (!request || typeof request.browserId !== "string" || !request.browserId.trim()) {
      throw new Error("Invalid browser focus payload.");
    }
    return requireBrowserHost().focusBrowser(request.browserId, {
      reveal: request.reveal !== false,
    });
  });

  registerDesktopCommand(IPC_CHANNELS.browserClose, async (payload: unknown) => {
    const request = payload as BrowserCloseRequest;
    if (!request || typeof request.browserId !== "string" || !request.browserId.trim()) {
      throw new Error("Invalid browser close payload.");
    }
    return requireBrowserHost().closeBrowser(request.browserId);
  });

  registerDesktopCommand(IPC_CHANNELS.browserSetUiScope, async (payload: unknown) => {
    const request = payload as BrowserSetUiScopeRequest;
    if (!request || !("threadId" in request)) {
      throw new Error("Invalid browser ui-scope payload.");
    }
    return requireBrowserHost().setUiScope(
      typeof request.threadId === "string" ? request.threadId : null,
    );
  });

  registerDesktopCommand(IPC_CHANNELS.browserGoBack, async (payload: unknown) => {
    const browserId =
      payload && typeof payload === "object" && typeof (payload as { browserId?: string }).browserId === "string"
        ? (payload as { browserId: string }).browserId
        : undefined;
    return requireBrowserHost().goBack(browserId);
  });
  registerDesktopCommand(IPC_CHANNELS.browserGoForward, async (payload: unknown) => {
    const browserId =
      payload && typeof payload === "object" && typeof (payload as { browserId?: string }).browserId === "string"
        ? (payload as { browserId: string }).browserId
        : undefined;
    return requireBrowserHost().goForward(browserId);
  });
  registerDesktopCommand(IPC_CHANNELS.browserReload, async (payload: unknown) => {
    const browserId =
      payload && typeof payload === "object" && typeof (payload as { browserId?: string }).browserId === "string"
        ? (payload as { browserId: string }).browserId
        : undefined;
    return requireBrowserHost().reload(browserId);
  });
  registerDesktopCommand(IPC_CHANNELS.browserOpenExternal, async (payload: unknown) => {
    const browserId =
      payload && typeof payload === "object" && typeof (payload as { browserId?: string }).browserId === "string"
        ? (payload as { browserId: string }).browserId
        : undefined;
    await requireBrowserHost().openExternalCurrent(browserId);
    return { ok: true as const };
  });

  registerDesktopCommand(IPC_CHANNELS.asrSettingsGet, async () => asrSettingsStore.get());
  registerDesktopCommand(IPC_CHANNELS.asrSettingsSave, async (payload: unknown) => {
    if (!payload || typeof payload !== "object") throw new Error("Invalid ASR settings.");
    const value = payload as Record<string, unknown>;
    if (
      value.apiMode !== undefined &&
      value.apiMode !== "chat_completions" &&
      value.apiMode !== "audio_transcriptions"
    ) {
      throw new Error("Invalid ASR API mode.");
    }
    return asrSettingsStore.save({
      endpoint: typeof value.endpoint === "string" ? value.endpoint : "",
      ...(value.apiMode ? { apiMode: value.apiMode } : {}),
      model: typeof value.model === "string" ? value.model : "",
      systemPrompt: typeof value.systemPrompt === "string" ? value.systemPrompt : "",
      ...(typeof value.apiKey === "string" ? { apiKey: value.apiKey } : {}),
    });
  });
  registerDesktopCommand(IPC_CHANNELS.asrProfilesList, async () => asrSettingsStore.listProfiles());
  registerDesktopCommand(IPC_CHANNELS.asrProfileSave, async (payload: unknown) => {
    if (!payload || typeof payload !== "object") throw new Error("Invalid ASR profile.");
    const value = payload as Record<string, unknown>;
    if (
      value.apiMode !== undefined &&
      value.apiMode !== "chat_completions" &&
      value.apiMode !== "audio_transcriptions"
    ) {
      throw new Error("Invalid ASR API mode.");
    }
    return asrSettingsStore.saveProfile({
      ...(typeof value.id === "string" ? { id: value.id } : {}),
      name: typeof value.name === "string" ? value.name : "",
      endpoint: typeof value.endpoint === "string" ? value.endpoint : "",
      ...(value.apiMode ? { apiMode: value.apiMode } : {}),
      model: typeof value.model === "string" ? value.model : "",
      systemPrompt: typeof value.systemPrompt === "string" ? value.systemPrompt : "",
      ...(typeof value.apiKey === "string" ? { apiKey: value.apiKey } : {}),
    });
  });
  registerDesktopCommand(IPC_CHANNELS.asrProfileDelete, async (payload: unknown) => {
    if (
      !payload ||
      typeof payload !== "object" ||
      typeof (payload as Record<string, unknown>).id !== "string"
    ) {
      throw new Error("Invalid ASR profile delete request.");
    }
    return asrSettingsStore.deleteProfile((payload as { id: string }).id);
  });
  registerDesktopCommand(IPC_CHANNELS.asrProfileActivate, async (payload: unknown) => {
    if (
      !payload ||
      typeof payload !== "object" ||
      typeof (payload as Record<string, unknown>).id !== "string"
    ) {
      throw new Error("Invalid ASR profile activate request.");
    }
    return asrSettingsStore.activateProfile((payload as { id: string }).id);
  });
  registerDesktopCommand(IPC_CHANNELS.asrInputDeviceSave, async (payload: unknown) => {
    if (!payload || typeof payload !== "object") throw new Error("Invalid ASR input device settings.");
    const inputDeviceId = (payload as Record<string, unknown>).inputDeviceId;
    if (inputDeviceId !== undefined && inputDeviceId !== null && typeof inputDeviceId !== "string") {
      throw new Error("Invalid ASR input device ID.");
    }
    return asrSettingsStore.saveInputDevice(
      inputDeviceId === undefined ? {} : { inputDeviceId },
    );
  });
  registerDesktopCommand(IPC_CHANNELS.asrSettingsGetStatus, async () => asrSettingsStore.getStatus());
  registerDesktopCommand(IPC_CHANNELS.asrSettingsGetClientConfig, async () => {
    const config = asrSettingsStore.getClientConfig();
    if (!config) throw new Error("ASR 尚未配置 API key。");
    return config;
  });
  registerDesktopCommand(IPC_CHANNELS.asrTranscribe, async (payload: unknown) => {
    const value = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : undefined;
    const audioWavBase64 = typeof value?.audioWavBase64 === "string" ? value.audioWavBase64 : "";
    if (value?.profileId !== undefined && typeof value.profileId !== "string") {
      throw new Error("Invalid ASR profile ID.");
    }
    const profileId = typeof value?.profileId === "string" ? value.profileId : undefined;
    const config = asrSettingsStore.getClientConfig(profileId);
    if (!config) throw new Error("请先在设置中配置 ASR API key。");
    return transcribeAsr(config, { audioWavBase64 });
  });

  registerDesktopCommand(IPC_CHANNELS.storageGetUsage, async () => {
    const userDataDir = app.getPath("userData");
    return buildStorageUsageSnapshot({
      paths: {
        userDataDir,
        databasePath: path.join(userDataDir, "eco-coding.sqlite"),
        codexCheckpointsDir: path.join(userDataDir, "codex-file-checkpoints"),
      },
      threadCount: conversationStore.listThreads().length,
    });
  });

  registerDesktopCommand(IPC_CHANNELS.storageCleanup, async (payload: unknown) => {
    if (!isStorageCleanupRequest(payload)) {
      throw new Error("Invalid storage cleanup request.");
    }
    const userDataDir = app.getPath("userData");
    return runStorageCleanup(
      {
        userDataDir,
        databasePath: path.join(userDataDir, "eco-coding.sqlite"),
        conversationStore,
        codexFileCheckpointStore,
        deleteThreadWithExternalState: async (threadId) => {
          await deleteThreadFully(threadId);
          emitThreadEvent(threadId, "thread.deleted", "对话已删除。", "system", false);
        },
        hasActiveThreadRuns: () =>
          conversationStore.listThreads().some(
            (thread) => thread.status === "running" || thread.status === "queued",
          ),
      },
      payload,
    );
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
    return handleGitListCommitModelOptions(parseGitListCommitModelOptionsRequest(payload), {
      providerStore,
      agentOrchestrationStore,
      gitSettingsStore,
      pricingCache,
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

  registerDesktopCommand(IPC_CHANNELS.gitFetch, async (payload: unknown) => {
    if (!isGitFetchRequest(payload) || !payload.workspacePath.trim()) {
      throw new Error("Invalid git fetch request.");
    }
    const workspacePath = payload.workspacePath.trim();
    const result = await fetchFromOrigin(workspacePath, runGitCommand);
    if (!result.ok) {
      throw new Error(result.output || "抓取远程更新失败。");
    }
    desktopEventCenter.publishGitRemoteFetched(workspacePath);
    return { output: result.output };
  });

  registerDesktopCommand(IPC_CHANNELS.proxyBridgeSettingsGet, async () => proxyBridgeSettingsStore.get());

  registerDesktopCommand(IPC_CHANNELS.proxyBridgeSettingsSave, async (payload: unknown) => {
    if (!isProxyBridgeSettingsSnapshot(payload)) {
      throw new Error("Invalid proxy bridge settings.");
    }
    const saved = proxyBridgeSettingsStore.save(normalizeProxyBridgeSettingsSnapshot(payload));
    // Hot-apply to running gateway/bridge.
    try {
      await ensureGlobalEcoGateway();
    } catch {
      // Gateway may not be up yet; settings apply on next ensure.
    }
    return saved;
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
      throw new Error(
        "Codex Core 不可用：未找到可执行的 Codex CLI。请安装工作区依赖或设置 CODEX_EXECUTABLE。",
      );
    }

    const workspace = await ensureWorkspace(payload.workspacePath);
    const settings = getModelSettingsSnapshot();
    const threadRuntime = materializeThreadRuntimeConfig(
      settings,
      parseThreadRuntimeConfigInput(payload.runtimeConfig),
    );
    if (coreKind === "codex") {
      assertCodexRuntimeConfigSupported(threadRuntime);
    }
    const roleRoutes = roleRoutesForThreadConfig(settings, threadRuntime);
    const runtimeConfig = resolveRuntimeConfigForThreadConfig(settings, threadRuntime, roleRoutes);
    const sessionMode = resolveSessionMode(threadRuntime);
    const routeAsk = sessionMode === "ask";
    const routePlan = sessionMode === "plan";
    const status: ThreadSummary["status"] = runtimeConfig.ok ? "running" : "blocked";
    const now = new Date().toISOString();
    const thread: ThreadSummary = {
      id: `thr_${Date.now()}`,
      title: resolvePendingThreadTitle(currentAppLocale()),
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
      scheduleThreadTitleSummary(thread.id);
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
    // Do not emit a placeholder clarification.answered here — the awaiting AskUserQuestion /
    // Codex handler emits the real summary (with toolUseId) once submitClarification resolves.
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
    // Real clarification.answered is emitted by the pending-handler awaiter with toolUseId so
    // the feed can anchor the answer next to the AskUserQuestion tool / request.
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
    const resolution: BashApprovalResolution = {
      decision: payload.decision,
      ...(payload.feedback?.trim() ? { feedback: payload.feedback.trim() } : {}),
    };
    const ok = resolvePendingBashApproval(payload.toolUseId, resolution);
    if (!ok) {
      throw new Error("Failed to resolve Bash approval.");
    }
    const threadPatch = buildResolvedBashApprovalThreadPatch(resolution.decision);
    patchThreadSummary(pendingApproval.threadId, threadPatch);
    desktopEventCenter.publishThreadLiveEvent({
      threadId: pendingApproval.threadId,
      type: "bash_approval.resolved",
      message: threadPatch.message,
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
    if (approvalThread.coreKind === "codex") {
      requireThreadCore(approvalThread, "codex", "approve a Codex plan");
      if (getPendingPlanApprovalForThread(threadId)) {
        throw new Error("Codex plan approval cannot use the Claude approval bridge.");
      }
      const pendingPlan = conversationStore.getPendingPlan(threadId);
      if (!pendingPlan) {
        throw new Error("找不到待批准的计划。");
      }
      if (approvalThread.status !== "awaiting_plan") {
        throw new Error("This thread is not waiting for plan approval.");
      }
      if (!pendingPlan.plan.trim()) {
        throw new Error("计划内容不能为空。");
      }
      const currentConfig = ensureThreadRuntimeConfig(approvalThread).runtimeConfig;
      if (!currentConfig) {
        throw new Error("Thread runtime configuration is missing.");
      }
      const runtimeConfig = withAgentSessionMode(
        request.runtimeConfig ? parseThreadRuntimeConfigInput(request.runtimeConfig) : currentConfig,
        "agent",
      );
      conversationStore.saveThreadRuntimeConfig(threadId, runtimeConfig);
      commitThreadPlanApprovalToAgentMode(threadId, "codex_plan_approved");
      const result = await startCodexThreadContinuation({
        threadId,
        prompt: "Implement the plan.",
        runtimeConfigInput: runtimeConfig,
      });
      await persistApprovedPlanForThread(threadId, pendingPlan);
      conversationStore.clearPendingPlan(threadId);
      emitThreadEvent(threadId, "thread.plan_cleared", "计划已进入执行阶段。", "system");
      return { thread: result.thread };
    }
    requireThreadCore(approvalThread, "claude", "approve a Claude plan");
    const pendingBridge = getPendingPlanApprovalForThread(threadId);
    const pendingRuntimeConfig = request.runtimeConfig
      ? parseThreadRuntimeConfigInput(request.runtimeConfig)
      : undefined;
    if (pendingRuntimeConfig) {
      roleRoutesForThreadConfig(getModelSettingsSnapshot(), pendingRuntimeConfig);
    }

    if (pendingRuntimeConfig) {
      conversationStore.saveThreadRuntimeConfig(threadId, pendingRuntimeConfig);
    }

    if (pendingBridge) {
      commitThreadPlanApprovalToAgentMode(threadId, "bridge_plan_approved");
      const approvedThread = conversationStore.getThread(threadId);
      if (
        !approvedThread ||
        resolveSessionMode(ensureThreadRuntimeConfig(approvedThread).runtimeConfig) !== "agent"
      ) {
        throw new Error("Plan approval could not switch the thread to Agent mode.");
      }
      if (!resolvePendingPlanApproval(pendingBridge.toolUseId, "approved")) {
        throw new Error("No pending plan approval is active for this thread.");
      }
      const pendingPlan = conversationStore.getPendingPlan(threadId);
      await persistApprovedPlanForThread(threadId, {
        workspacePath: pendingPlan?.workspacePath ?? approvedThread.workspacePath,
        userPrompt: pendingPlan?.userPrompt ?? pendingBridge.userPrompt,
        analysis: pendingPlan?.analysis ?? pendingBridge.analysis,
        plan: pendingPlan?.plan ?? pendingBridge.plan,
        planFilePath: pendingBridge.planFilePath ?? pendingPlan?.planFilePath,
      });
      conversationStore.clearPendingPlan(threadId);
      emitThreadEvent(threadId, "thread.plan_cleared", "计划已批准，当前会话开始执行。", "system");
      updateThread(threadId, {
        status: "running",
        message: "正在按计划执行…",
      });
      return { thread: ensureThreadRuntimeConfig(conversationStore.getThread(threadId) ?? approvedThread) };
    }

    const approval = resolveThreadPlanApprovalRuntime(threadId, {
      getThread: (id) => conversationStore.getThread(id),
      hasActiveRun: (id) => activeRunRuntimeState.hasRun(id),
      getPendingPlan: (id) => conversationStore.getPendingPlan(id),
      resolveRoleRoutes: (id) =>
        pendingRuntimeConfig
          ? roleRoutesForThreadConfig(getModelSettingsSnapshot(), pendingRuntimeConfig)
          : resolveRoleRoutesForThread(id),
      resolveRuntimeConfig: (routes) => resolveRuntimeConfigForThreadId(threadId, routes),
    });

    const pendingBeforeExecution = conversationStore.getPendingPlan(threadId);
    if (pendingBeforeExecution) {
      await persistApprovedPlanForThread(threadId, pendingBeforeExecution);
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

  registerDesktopCommand(IPC_CHANNELS.threadFollowUpEditing, async (payload: unknown) => {
    const request = parseThreadFollowUpEditingRequest(payload);
    if (request.followUpId) {
      const followUp = conversationStore.getThreadFollowUp(request.threadId, request.followUpId);
      if (!followUp || followUp.status !== "queued") {
        throw new Error("Pending follow-up was not found or can no longer be edited.");
      }
      editingThreadFollowUpByThread.set(request.threadId, request.followUpId);
      return { editing: true };
    }
    const released = editingThreadFollowUpByThread.delete(request.threadId);
    if (released) {
      void drainQueuedThreadFollowUpsAfterRun(request.threadId);
    }
    return { editing: false };
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

  registerDesktopCommand(IPC_CHANNELS.threadFollowUpReorder, async (payload: unknown) => {
    const request = parseThreadFollowUpReorderRequest(payload);
    conversationStore.reorderQueuedThreadFollowUps(request.threadId, request.followUpIds);
    return { followUps: conversationStore.listThreadFollowUps(request.threadId) };
  });

  registerDesktopCommand(IPC_CHANNELS.threadFollowUpUpdate, async (payload: unknown) => {
    const request = parseThreadFollowUpUpdateRequest(payload);
    const thread = conversationStore.getThread(request.threadId);
    if (!thread) {
      throw new Error("Thread was not found.");
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

function emitThreadTitleFailure(threadId: string, reason?: string): void {
  const thread = conversationStore.getThread(threadId);
  if (!thread || !shouldReplaceAutoThreadTitle(thread.title)) {
    return;
  }
  const message = reason?.trim()
    ? `会话标题生成失败：${reason.trim()}`
    : "会话标题生成失败";
  const fallbackTitle = resolveFailedThreadTitle(thread.prompt, currentAppLocale());
  if (fallbackTitle !== thread.title) {
    conversationStore.updateThreadTitle(threadId, fallbackTitle);
  }
  emitThreadEvent(threadId, "thread.title_failed", message, "system", false, {
    title: fallbackTitle,
  });
}

function scheduleThreadTitleSummary(
  threadId: string,
): boolean {
  const thread = conversationStore.getThread(threadId);
  if (!thread || !canRegenerateThreadTitle(thread.title, titleGeneratingThreadIds.has(threadId))) {
    return false;
  }

  titleGeneratingThreadIds.add(threadId);
  const prompt = thread.prompt;
  emitThreadEvent(threadId, "thread.title_generating", "", "system", false, { titleGenerating: true });
  emitThreadTitleDelta(threadId, resolveFailedThreadTitle(prompt, currentAppLocale()));
  if (!thread.runtimeConfig?.auxiliaryModel) {
    titleGeneratingThreadIds.delete(threadId);
    emitThreadEvent(threadId, "thread.title_generating", "", "system", false, { titleGenerating: false });
    return true;
  }
  let titleRoute;
  try {
    titleRoute = resolveAuxiliaryModelRoute(thread.runtimeConfig?.auxiliaryModel, providerStore, {
      globalMaxOutputTokens: workflowSettingsStore.get().maxOutputLimitTokens,
    });
  } catch (error) {
    const reason = errorMessage(error);
    process.stderr.write(`[eco] title auxiliary model unavailable: ${reason}\n`);
    emitThreadTitleFailure(threadId, reason);
    titleGeneratingThreadIds.delete(threadId);
    emitThreadEvent(threadId, "thread.title_generating", "", "system", false, { titleGenerating: false });
    return true;
  }
  // Never expose unvalidated model output as a title. The original request remains visible
  // until the complete generated title has passed JSON parsing and sanitization.
  void summarizeThreadTitle([titleRoute], prompt, fetch)
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
    })
    .finally(() => {
      titleGeneratingThreadIds.delete(threadId);
      emitThreadEvent(threadId, "thread.title_generating", "", "system", false, {
        titleGenerating: false,
      });
    });
  return true;
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
  if (threadFollowUpDrainInFlight.has(threadId)) {
    return;
  }
  threadFollowUpDrainInFlight.add(threadId);
  try {
    await drainNextQueuedThreadFollowUp(threadId);
  } finally {
    threadFollowUpDrainInFlight.delete(threadId);
  }
}

async function drainNextQueuedThreadFollowUp(threadId: string): Promise<void> {
  if (activeRunRuntimeState.hasRun(threadId)) {
    return;
  }
  const thread = conversationStore.getThread(threadId);
  if (
    shouldBlockThreadFollowUpDrain({
      hasPendingBridgeApproval: Boolean(getPendingPlanApprovalForThread(threadId)),
      hasPendingClarification: Boolean(getPendingClarificationForThread(threadId)),
      hasEditingFollowUp: editingThreadFollowUpByThread.has(threadId),
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
    const next = materializeThreadRuntimeConfig(
      settings,
      parseThreadRuntimeConfigInput(input.runtimeConfigInput),
    );
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
    const threadRuntimeForBrowser = ensureThreadRuntimeConfig(
      conversationStore.getThread(input.thread.id) ?? input.thread,
    ).runtimeConfig;
    const sessionEcoBrowserEnabled =
      browserSettingsStore.get().agentIntegrationEnabled &&
      isSessionEcoBrowserEnabled(threadRuntimeForBrowser?.mcpServersEnabled);
    const ecoBrowserSkillFile = sessionEcoBrowserEnabled
      ? resolveEcoAgentBrowserSkillFileForCodex()
      : undefined;
    if (sessionEcoBrowserEnabled && !ecoBrowserSkillFile) {
      throw new Error(
        "本会话已开启内置浏览器，但未找到打包的 eco-agent-browser skill 文件。",
      );
    }
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
          signal: controller.signal,
          resolveRuntimeConfig: () => resolveRuntimeConfigForThreadId(input.thread.id, input.roleRoutes),
          resolveAgentRegistry: () => resolveAgentRuntimeConfigForThreadId(input.thread.id),
          resolveExecutionConfirmationMode: () =>
            ensureThreadRuntimeConfig(conversationStore.getThread(input.thread.id) ?? input.thread)
              .runtimeConfig?.bashReviewMode ?? "always",
          resolveSubagentAvailability: () =>
            ensureThreadRuntimeConfig(conversationStore.getThread(input.thread.id) ?? input.thread)
              .runtimeConfig?.subagentEnabled,
          resolveMcpServers: async () => {
            const allEnabled = listEnabledGlobalMcpServerKeys(mcpStore.listServers());
            const base = prepareCodexMcpServersForRuntime(
              buildCodexMcpServersForConfigSync(mcpStore.listServers(), allEnabled),
            );
            if (!sessionEcoBrowserEnabled) {
              return base;
            }
            const browserInject = await requireBrowserHost().resolveAgentBrowserMcpInjection({
              threadId: input.thread.id,
              sessionEnabled: true,
            });
            if (!browserInject.enabled || !browserInject.codexServer) {
              throw new Error(
                `本会话已开启内置浏览器，但不可用：${browserInject.unavailableReason ?? "未知原因"}`,
              );
            }
            // Single logical name eco_agent_browser; Eco gateway routes by auth + claim queue.
            return prepareCodexMcpServersForRuntime([...base, browserInject.codexServer]);
          },
          resolveEnabledMcpServerKeys: async () => {
            const keys = resolveCodexThreadMcpServerKeys(input.thread.id).filter(
              (key) => !key.startsWith("eco_ab_"),
            );
            if (sessionEcoBrowserEnabled && !keys.includes(ECO_AGENT_BROWSER_MCP_SERVER)) {
              return [...keys, ECO_AGENT_BROWSER_MCP_SERVER];
            }
            return keys.filter((key) => key !== ECO_AGENT_BROWSER_MCP_SERVER || sessionEcoBrowserEnabled);
          },
          resolveSkillConfig: () => {
            const base = codexSkills.map(({ skill, enabled }) => ({
              path: skill.skillFilePath,
              enabled,
            }));
            if (!ecoBrowserSkillFile) {
              return base;
            }
            const withoutDup = base.filter(
              (entry) =>
                path.basename(path.dirname(entry.path)) !== ECO_AGENT_BROWSER_SKILL_NAME &&
                entry.path !== ecoBrowserSkillFile,
            );
            return [...withoutDup, { path: ecoBrowserSkillFile, enabled: true }];
          },
          onPrepared: async () => {
            if (input.rewindTarget) {
              await forkCodexThreadForEcoThread({
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
          onConfigReloadWait: ({ reason, activeThreadIds }) => {
            const subject = reason === "model_catalog" ? "模型目录" : "全局运行时配置";
            updateThread(input.thread.id, {
              status: "running",
              message: `Codex ${subject}已变更，正在等待活动会话结束：${activeThreadIds.join(", ")}`,
            });
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
              const events =
                input.continuation && driver.runContinuation
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
    availableMcpServerKeys: [
      ...listEnabledGlobalMcpServerKeys(mcpStore.listServers()),
      ...(browserSettingsStore.get().agentIntegrationEnabled ? [ECO_AGENT_BROWSER_MCP_SERVER] : []),
    ],
  });
}

async function resolveCodexThreadSkills(
  threadId: string,
  workspacePath: string,
): Promise<Array<{ skill: SkillInfo; enabled: boolean }>> {
  const thread = conversationStore.getThread(threadId);
  const settings = thread ? ensureThreadRuntimeConfig(thread).runtimeConfig?.skillsEnabled : undefined;
  const discovered = await listDiscoveredSkills(workspacePath);
  const entries = [...discovered.userSkills, ...discovered.projectSkills]
    .filter(
      (skill) =>
        (skill.layout === "agents" || skill.layout === "codex") &&
        !/[/\\]\.codex[/\\]skills[/\\]\.system[/\\]/.test(skill.skillFilePath) &&
        skill.name !== ECO_AGENT_BROWSER_SKILL_NAME,
    )
    .map((skill) => ({
      skill,
      enabled: settings?.[skill.settingsKey ?? skill.skillFilePath] ?? skill.source === "project",
    }));
  if (browserSettingsStore.get().agentIntegrationEnabled) {
    const skillFile = resolveEcoAgentBrowserSkillFileForCodex();
    if (skillFile) {
      const thread = conversationStore.getThread(threadId);
      const sessionEnabled = isSessionEcoBrowserEnabled(
        thread ? ensureThreadRuntimeConfig(thread).runtimeConfig?.mcpServersEnabled : undefined,
      );
      entries.push({
        skill: buildEcoAgentBrowserCodexSkillInfo(skillFile),
        enabled: sessionEnabled,
      });
    }
  }
  return entries;
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
                buildDesktopSdkRunInput({
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
            const driver = createSdkDriver(
              thread.id,
              attemptProxy,
              taskRunHooks.hookContextExtras,
              "planning",
            );
            if (!driver.runPlan) {
              throw new Error("Runtime driver does not support plan mode.");
            }

            const result = await consumeSdkRunEvents({
              events: driver.runPlan(
                buildDesktopSdkRunInput({
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
                }
                taskRuntime.handleEvent(event);
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

    const currentThread = conversationStore.getThread(thread.id);
    const enteredExecution =
      currentThread !== undefined &&
      resolveSessionMode(ensureThreadRuntimeConfig(currentThread).runtimeConfig) === "agent";
    const hasPendingPlan = planningPlanCaptured || Boolean(conversationStore.getPendingPlan(thread.id));
    const decision = resolvePlanSessionRunOutcome(outcome, { hasPendingPlan, enteredExecution });
    const handled = await applyMainThreadRunDecisionEffects({
      threadId: thread.id,
      decision,
      onCancelled: async (reason) => {
        taskRunHooks.stopIfUnhandled("cancelled");
        cancelClarificationsForThread(thread.id, reason);
        await handleRunCancelled(thread.id, worktreePlan);
      },
      onFailed: (reason) => {
        taskRunHooks.stopIfUnhandled("blocked");
        markThreadInterrupted(thread.id, reason);
      },
      onIncomplete: (reason) => {
        taskRunHooks.stopIfUnhandled("blocked");
        markThreadInterrupted(thread.id, reason);
      },
    });
    if (handled) {
      taskRunHooks.stopIfUnhandled("completed");
      return;
    }
    taskRunHooks.stopIfUnhandled("completed");
    conversationStore.clearPendingPlan(thread.id);
    await completeCodingThreadRun(thread.id, worktreePlan);
  } catch (error) {
    taskRunHooks.stopIfUnhandled("blocked");
    cancelClarificationsForThread(thread.id, errorMessage(error));
    markThreadInterrupted(thread.id, errorMessage(error));
  } finally {
    const worktreePathResolved = resolveThreadWorktreePath(thread.id);
    await finalizeMainThreadRunCleanup({
      threadId: thread.id,
      worktreePath: worktreePathResolved,
      cancelClarificationsReason: "run finished",
      idleFallbackMessage: "计划阶段已结束。",
    });
  }
}

async function completeCodingThreadRun(threadId: string, worktreePlan: WorktreePlan): Promise<void> {
  if (isDirectWorkspacePlan(worktreePlan)) {
    updateThread(threadId, { status: "completed", message: "执行完成。" });
    return;
  }

  try {
    const { files, diff } = await gitWorktrees.collectWorktreeChanges(worktreePlan);
    if (files.length > 0) {
      conversationStore.saveAppliedDiff(threadId, worktreePlan.workspacePath, diff, files);
      const summary = buildWorktreeMergeSummary(diff, files);
      emitThreadEvent(threadId, "workspace.changes", serializeWorktreeMergeMessage(summary), "system");
      updateThread(threadId, { status: "completed", message: "执行完成，变更已写入项目目录。" });
      return;
    }
    updateThread(threadId, {
      status: "completed",
      message: "执行完成，工作树内无相对基线的文件变更。",
    });
  } catch (error) {
    process.stderr.write(`[eco] workspace diff snapshot failed: ${errorMessage(error)}\n`);
    updateThread(threadId, { status: "completed", message: "执行已结束，但无法确认文件变更。" });
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
                buildDesktopSdkRunInput({
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
            return result;
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
        onIncomplete: (reason) => {
          taskRunHooks.stopIfUnhandled("blocked");
          cancelClarificationsForThread(thread.id, reason);
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

  // Persist before any await so status refresh can load approved plan from disk.
  await persistApprovedPlanForThread(threadId, {
    workspacePath: pending.workspacePath,
    userPrompt: pending.userPrompt,
    analysis: pending.analysis,
    plan: pending.plan,
    planFilePath: pending.planFilePath,
    planUserEdited: options?.planUserEdited,
  });

  let worktreePlan = resolveWorktreePlan(pending.workspacePath, threadId, pending.worktreePath);
  const controller = new AbortController();
  startActiveRun(threadId, { controller, worktreePlan });
  resetSubagentContextWindows(threadId);

  const workspace = await ensureWorkspace(pending.workspacePath);
  const resolved = await resolveThreadWorktree(workspace, threadId, worktreePlan);
  worktreePlan = resolved.worktreePlan;
  const executionCwd = resolved.cwd;
  activeRunRuntimeState.setWorktreePlan(threadId, worktreePlan);


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
              const result = await consumeSdkRunEvents({
                events: driver.runContinuation(
                  buildDesktopSdkRunInput({
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
              return result;
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
        onIncomplete: (reason) => {
          taskRunHooks.stopIfUnhandled("blocked");
          markThreadInterrupted(threadId, reason);
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

async function startClaudeThreadContinuation(
  input: StartThreadContinuationInput,
): Promise<ThreadContinueResult> {
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
    const nextConfig = materializeThreadRuntimeConfig(
      settings,
      parseThreadRuntimeConfigInput(input.runtimeConfigInput),
    );
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

function parseThreadFollowUpEditingRequest(payload: unknown): ThreadFollowUpEditingRequest {
  if (!isRecord(payload)) {
    throw new Error("Invalid follow-up editing payload.");
  }
  const followUpId = readOptionalString(payload.followUpId);
  return {
    threadId: readRequiredString(payload.threadId, "Thread id is required."),
    ...(followUpId ? { followUpId } : {}),
  };
}

function parseThreadFollowUpReorderRequest(payload: unknown): ThreadFollowUpReorderRequest {
  if (!isRecord(payload)) {
    throw new Error("Invalid follow-up reorder payload.");
  }
  const followUpIds = Array.isArray(payload.followUpIds)
    ? payload.followUpIds.map((id) => readRequiredString(id, "Follow-up id is required."))
    : [];
  if (followUpIds.length === 0) {
    throw new Error("Follow-up order is required.");
  }
  return {
    threadId: readRequiredString(payload.threadId, "Thread id is required."),
    followUpIds,
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
  let subagentSessionsSettled = 0;
  for (const session of conversationStore.listSubagentSessions(threadId)) {
    if (session.status !== "active") continue;
    conversationStore.markSubagentSessionStopped(threadId, session.agentId);
    subagentMetricsRegistry.onSubagentStop(threadId, {
      agentId: session.agentId,
      role: session.role,
    });
    subagentSessionsSettled += 1;
  }
  const result = agentLifecycle.settleRecoveredThread({
    threadId,
    attempts: conversationStore.listRunAttempts(threadId),
    agents: conversationStore.listAgentInstances(threadId),
    runStatus,
  });
  if (
    result.runAttemptsSettled === 0 &&
    result.agentInstancesSettled === 0 &&
    subagentSessionsSettled === 0
  ) {
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
    subagentSessionsSettled,
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
        buildDesktopSdkRunInput({
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
  await finalizeCancelledRun(threadId, worktreePlan, explicit, createFinalizeCancelledRunDeps(), message);
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
  const subagentLaunchGate = getThreadSubagentConcurrencyGate(threadId);
  const subagentSessions = createSubagentSessionHooks(conversationStore, threadId, phase, {
    lifecycle: agentLifecycle,
    metricsRegistry: subagentMetricsRegistry,
    attribution: subagentAttribution,
    onSubagentStarted: ({ parentToolUseId }) => {
      subagentLaunchGate.releaseLaunch?.({
        ...(parentToolUseId && { toolUseId: parentToolUseId }),
      });
    },
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
  });
  if (subagentSessions.onDelegationLinked) {
    subagentDelegationLinkersByThread.set(
      threadId,
      subagentSessions.onDelegationLinked.bind(subagentSessions),
    );
  }
  const { peekPendingCoderTodoId: _peek, ...rest } = extras ?? {};
  return {
    ...rest,
    subagentSessions,
    subagentLaunchGate,
    subagentMaxRuntimeMs: orchestrationGuardrails.maxSubagentRuntimeMs,
    subagentAttribution,
    subagentLaunchRegistry,
  };
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

function buildDesktopSdkRunInput(
  input: Omit<BuildSdkRunInput, "globalUserRules">,
): ReturnType<typeof buildSdkRunInput> {
  const threadId =
    "threadId" in input && typeof (input as { threadId?: unknown }).threadId === "string"
      ? (input as { threadId: string }).threadId
      : undefined;
  let sessionEco = false;
  if (threadId) {
    const thread = conversationStore.getThread(threadId);
    sessionEco =
      browserSettingsStore.get().agentIntegrationEnabled &&
      isSessionEcoBrowserEnabled(
        thread ? ensureThreadRuntimeConfig(thread).runtimeConfig?.mcpServersEnabled : undefined,
      );
  }
  const globalUserRules = appendBrowserPrompt(
    personalizationSettingsStore.get().globalRules,
    requireBrowserHost().getAgentPromptAppend(sessionEco, threadId),
  );
  return buildSdkRunInput({
    ...input,
    ...(globalUserRules ? { globalUserRules } : {}),
  });
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
  const bashReviewMode = threadConfig?.bashReviewMode ?? "always";
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
      resolveBrowserOpenApprovalMode: () => browserSettingsStore.get().openApprovalMode,
      workspacePath: storedThread.workspacePath,
    },
    executionPermissionMode:
      bashReviewMode === "allow_all" ? "bypassPermissions" : "default",
    toolPermissionHandler: createThreadToolPermissionHandler(
      threadId,
      runPhase,
      bashReviewMode === "allow_all",
    ),
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

/** DB + Claude SDK session + Codex file checkpoints + in-memory run state. */
async function deleteThreadFully(threadId: string): Promise<void> {
  await deleteThreadSdkSession(threadId);
  conversationStore.deleteThread(threadId);
  clearThreadRuntimeMemory(threadId);
  threadRunProjectionHistoryRevisions.delete(threadId);
  await codexFileCheckpointStore.deleteThread(threadId);
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

function resetThreadRuntimeAfterHistoryRewrite(threadId: string): void {
  const timer = runProjectionEmitTimers.get(threadId);
  if (timer) {
    clearTimeout(timer);
    runProjectionEmitTimers.delete(threadId);
  }
  threadUsageAccumulator.clear(threadId);
  contextScheduler.clearThread(threadId);
  threadPromptCacheMonitor.clearThread(threadId);
  threadPromptCacheEpisodeMonitor.clearThread(threadId);
  threadCacheHitMonitor.clearThread(threadId);
  subagentMetricsRegistry.clearThread(threadId);
  usageLedgerCoordinator.clearProxyAttributionState(threadId);
  bumpThreadRunProjectionHistoryRevision(threadId);
  lastFeedProjectionSignatures.delete(threadId);
  lastFeedProjectionTimelineSequences.delete(threadId);
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
      buildDesktopSdkRunInput({
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
  resetThreadRuntimeAfterHistoryRewrite(input.threadId);
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
    resumeDropsTurn: storedTarget.userMessageId,
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

async function persistApprovedPlanForThread(
  threadId: string,
  pending: {
    workspacePath: string;
    userPrompt: string;
    analysis: string;
    plan: string;
    planFilePath?: string;
    planUserEdited?: boolean;
  },
): Promise<string | undefined> {
  if (pending.planFilePath?.trim()) {
    conversationStore.setThreadClaudePlanFilePath(threadId, pending.planFilePath.trim());
  }
  if (!pending.plan.trim()) {
    return undefined;
  }
  const snapshot: ApprovedPlanSnapshot = {
    userPrompt: pending.userPrompt,
    analysis: pending.analysis,
    plan: pending.plan,
    ...(pending.planUserEdited ? { planUserEdited: true } : {}),
  };
  const snapshotPath = await writeApprovedPlanSnapshot(pending.workspacePath, threadId, snapshot);
  return snapshotPath;
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
              const runInput = buildDesktopSdkRunInput({
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

              const result = await consumeSdkRunEvents({
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
              return result;
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
        onIncomplete: (reason) => {
          taskRunHooks?.stopIfUnhandled("blocked");
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
  if (
    (event.type === "tool.started" || event.type === "tool.completed") &&
    isRecord(event.payload)
  ) {
    if (event.type === "tool.started") {
      maybeRevealBrowserFromAgentTool({
        threadId,
        payload: event.payload,
      });
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
            : undefined);
        subagentMetricsRegistry.noteTaskToolUse(threadId, toolUseId, role);
        agentLifecycle.noteTaskToolUse(threadId, toolUseId, role);
      }
      // Seed stream pairing with the Agent/Task tool_use_id itself. Child messages may never
      // arrive (or only after tool.completed); without this, SubagentStart cannot link mission.
      tryResolveStreamSubagentDelegation(threadId, toolUseId);
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
  const onLocalStreamUpdate = (update: SdkLocalStreamUpdate): void => {
    broadcastLocalThreadStreamUpdate({
      threadId: update.threadId,
      type: "thread.local_stream_updated",
      message: update.message,
      role: update.role as RuntimeAgentRole,
      stream: update.stream,
      localStream: {
        threadId: update.threadId,
        streamKey: update.streamKey,
        text: update.message,
        role: update.role,
        channel: update.role === "thinking" ? "thinking" : "message",
        streaming: update.stream,
        observedAt: new Date().toISOString(),
        ...(update.agentId && { agentId: update.agentId }),
      },
    });
  };
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
    },
    undefined,
    {
      ...(activityAgentId && { activityAgentId }),
      ...(sdkParentToolUseId && { parentToolUseId: sdkParentToolUseId }),
      onLocalStreamUpdate,
    },
  );
}

function noteUsageBillingObservation(threadId: string, observation: UsageBillingObservation): void {
  activeRunBillingState.appendObservation(threadId, observation);
}

async function handleCodexGatewayUsage(event: import("@eco/gateway").GatewayUsageEvent): Promise<void> {
  const resolved = resolveCodexGatewayUsageBilling({
    event,
    resolveThreadAttribution: (codexThreadId) => resolveCodexThreadAttribution(codexThreadMap, codexThreadId),
    resolveParentCodexThreadId: (codexThreadId) =>
      codexThreadMap.getThreadAttribution(codexThreadId)?.parentThreadId,
    resolveRuntimeRoutes: resolveRuntimeRoutesForThread,
    runAttemptId: (threadId) => agentLifecycle.usageRunAttemptId(threadId),
    plannerAgentId: (threadId) => agentLifecycle.usagePlannerAgentId(threadId),
  });

  if (resolved.status === "rejected") {
    if (resolved.reason === "missing_turn_metadata") {
      // Fail-closed billing without turning the Gateway observer into a thrown error storm.
      logEcoDiag("codex.gateway_usage_rejected", {
        reason: resolved.reason,
        source: event.source,
        providerId: event.providerId,
        sourceEventId: event.sourceEventId,
      });
      process.stderr.write(
        `[eco-codex] gateway usage will not be billed: missing_turn_metadata ` +
          `provider=${event.providerId} source=${event.source}\n`,
      );
      return;
    }
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
  const availableMcpServerKeys = [
    ...listEnabledGlobalMcpServerKeys(mcpStore.listServers()),
    ...(browserSettingsStore.get().agentIntegrationEnabled ? [ECO_AGENT_BROWSER_MCP_SERVER] : []),
  ];
  const enabledMcpServers = resolveThreadRuntimeMcpServerKeys({
    ...(hydrated?.runtimeConfig ? { runtimeConfig: hydrated.runtimeConfig } : {}),
    settings,
    availableMcpServerKeys,
  });
  const sessionEcoBrowserEnabled =
    browserSettingsStore.get().agentIntegrationEnabled &&
    enabledMcpServers.includes(ECO_AGENT_BROWSER_MCP_SERVER);
  const browserInject = await requireBrowserHost().resolveAgentBrowserMcpInjection({
    threadId,
    sessionEnabled: sessionEcoBrowserEnabled,
  });
  if (sessionEcoBrowserEnabled && !browserInject.enabled) {
    throw new Error(
      `本会话已开启内置浏览器，但不可用：${browserInject.unavailableReason ?? "未知原因"}`,
    );
  }
  let ecoBrowserSkillFilePath: string | undefined;
  if (browserInject.enabled) {
    const ensured = await ensureClaudeUserEcoAgentBrowserSkill();
    if (!ensured.ok) {
      throw new Error(`本会话已开启内置浏览器，但 skill 不可用：${ensured.reason}`);
    }
    ecoBrowserSkillFilePath = ensured.skillFilePath;
  }
  const filteredMcp = filterMcpSdkConfigByAssignedServers(
    mcp,
    enabledMcpServers.filter(
      (key) => key !== ECO_AGENT_BROWSER_MCP_SERVER && !key.startsWith("eco_ab_"),
    ),
  );
  const withBrowserMcp = requireBrowserHost().mergeIntoSdkMcpConfig(filteredMcp, browserInject);
  const runtimeMcp = prepareMcpSdkConfigForRuntime(withBrowserMcp);
  const runtimeMcpServers = [
    ...enabledMcpServers.filter(
      (key) => key !== ECO_AGENT_BROWSER_MCP_SERVER && !key.startsWith("eco_ab_"),
    ),
    ...(browserInject.enabled ? [ECO_AGENT_BROWSER_MCP_SERVER] : []),
  ];
  const enabledSubagents = hydrated?.runtimeConfig?.subagentEnabled ?? defaultSubagentAvailability();
  const workspacePath =
    thread?.workspacePath ??
    (currentWorkspace?.path && currentWorkspace.path.trim() ? currentWorkspace.path : undefined);
  const discovered = await listDiscoveredSkills(workspacePath);
  const skillsEnabled = hydrated?.runtimeConfig?.skillsEnabled;
  const enabledProjectSkills = listSdkReadyProjectSkills(discovered.projectSkills).filter(
    (skill) =>
      skill.name !== ECO_AGENT_BROWSER_SKILL_NAME &&
      (skillsEnabled?.[skill.settingsKey ?? skill.skillFilePath] ?? true),
  );
  const enabledUserSkills = discovered.userSkills.filter(
    (skill) =>
      skill.name !== ECO_AGENT_BROWSER_SKILL_NAME &&
      skill.sdkReady &&
      (skillsEnabled?.[skill.settingsKey ?? skill.skillFilePath] ?? false),
  );
  const projectNames = enabledProjectSkills.map((skill) => skill.name);
  const enabledUserNames = [
    ...enabledUserSkills.map((skill) => skill.name),
    ...(ecoBrowserSkillFilePath ? [ECO_AGENT_BROWSER_SKILL_NAME] : []),
  ];
  const implicitReadAllowRoots = resolveImplicitSkillReadRoots(os.homedir(), workspacePath, [
    ...enabledProjectSkills,
    ...enabledUserSkills,
    ...(ecoBrowserSkillFilePath
      ? [
          {
            name: ECO_AGENT_BROWSER_SKILL_NAME,
            description: "Eco built-in browser skill",
            source: "user" as const,
            directory: path.dirname(ecoBrowserSkillFilePath),
            skillFilePath: ecoBrowserSkillFilePath,
            layout: "claude" as const,
            sdkReady: true,
          },
        ]
      : []),
  ]);
  const skillConfig = resolveSdkSessionSkillConfig(options?.skillsScope ?? "default", {
    projectNames,
    explicitUser: enabledUserNames,
  });
  const snapshot = hydrated?.runtimeConfig
    ? resolveThreadOrchestrationSnapshot(settings, hydrated.runtimeConfig)
    : undefined;
  const mainAgentModelKey = hydrated?.runtimeConfig
    ? resolveMainAgentModelKey(settings, hydrated.runtimeConfig)
    : buildMainAgentModelKey(undefined);
  const orchestrationKey = buildOrchestrationRuntimeKey(
    snapshot,
    hydrated?.runtimeConfig?.orchestrationSelection,
  );
  if (!orchestrationKey) {
    throw new Error("Thread orchestration snapshot is missing; select a complete orchestration before running.");
  }
  const agentSkills = buildRuntimeAgentSkillAssignments(skillConfig.skills, snapshot);
  await auditThreadPromptCacheBeforeSdkSession({
    threadId,
    orchestrationKey,
    mainAgentModelKey,
    mcpServerKeys: runtimeMcpServers,
    ...(workspacePath ? { workspacePath } : {}),
    includeUserClaudeMd: skillConfig.settingSources.includes("user"),
  });
  return {
    settingSources: skillConfig.settingSources,
    ...(skillConfig.skills.length > 0 ? { skills: skillConfig.skills } : {}),
    ...(implicitReadAllowRoots.length > 0 ? { implicitReadAllowRoots } : {}),
    agentSkills,
    enabledSubagents,
    ...(runtimeMcpServers.length > 0 ? { runtimeMcpServers } : {}),
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
  titleGenerating?: ThreadLiveEvent["titleGenerating"];
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

function extractUrlFromLooseTextMessageForNavigate(message: string): string | undefined {
  const trimmed = message.trim();
  if (!trimmed) {
    return undefined;
  }
  // Only trust message when it is (or embeds) an explicit http(s) URL — never event labels.
  if (/https?:\/\//i.test(trimmed)) {
    return extractUrlFromBrowserOpenToolPayload({ href: trimmed }) ??
      extractUrlFromBrowserOpenToolPayload({ url: trimmed });
  }
  return undefined;
}

function isAgentBrowserTabNewToolName(toolName: string): boolean {
  const name = toolName.trim().toLowerCase();
  return name.includes("agent_browser_tab_new") || name.includes("tab_new");
}

function maybeRevealBrowserFromAgentTool(input: {
  threadId?: string;
  toolName?: string;
  message?: string;
  payload?: unknown;
}): void {
  const fromPayload = resolveToolNameFromActivityPayload(input.payload);
  const fromMessage = input.message
    ? resolveToolNameFromActivityPayload({ message: input.message })
    : undefined;
  const toolName = (input.toolName ?? fromPayload ?? fromMessage ?? "").trim();
  if (!toolName || !isEcoAgentBrowserOpenToolName(toolName)) {
    // Still register claims for non-open eco browser tools (snapshot/click).
    if (toolName && (toolName.includes("agent_browser") || toolName.includes("eco_agent_browser"))) {
      const threadId = input.threadId?.trim();
      if (threadId) {
        requireBrowserHost().noteBrowserToolStarted(threadId, toolName);
      }
    }
    return;
  }
  const openUrl =
    extractUrlFromBrowserOpenToolPayload(input.payload) ??
    (input.message ? extractUrlFromLooseTextMessageForNavigate(input.message) : undefined);
  const threadId = input.threadId?.trim();
  if (!threadId) {
    return;
  }
  requireBrowserHost().noteBrowserToolStarted(threadId, toolName);
  const newTab = isAgentBrowserTabNewToolName(toolName);
  void requireBrowserHost()
    .notifyAgentBrowserOpen(threadId, openUrl, newTab ? { newTab: true } : undefined)
    .catch((error) => {
      process.stderr.write(
        `[eco-browser] notifyAgentBrowserOpen failed: ${
          error instanceof Error ? error.message : String(error)
        }\n`,
      );
    });
}

function maybeRevealBrowserFromThreadRunEvent(event: {
  threadId: string;
  eventType: string;
  message?: string;
  metadata?: Record<string, unknown> | undefined;
}): void {
  // Only on tool.started — tool.completed with the same URL used to mint a second tab.
  if (event.eventType !== "tool.started") {
    return;
  }
  const metaTool =
    event.metadata?.tool && typeof event.metadata.tool === "object"
      ? (event.metadata.tool as Record<string, unknown>)
      : undefined;
  const toolName =
    (typeof metaTool?.name === "string" ? metaTool.name : undefined) ??
    resolveToolNameFromActivityPayload(event.metadata) ??
    resolveToolNameFromActivityPayload({ message: event.message });
  const name = (toolName ?? "").trim();
  if (!toolName || !isEcoAgentBrowserOpenToolName(toolName)) {
    if (
      name &&
      (name.includes("agent_browser") ||
        name.includes("eco_agent_browser") ||
        name.includes("eco_ab_"))
    ) {
      requireBrowserHost().noteBrowserToolStarted(event.threadId, name);
    }
    return;
  }
  maybeRevealBrowserFromAgentTool({
    threadId: event.threadId,
    ...(toolName ? { toolName } : {}),
    ...(event.message ? { message: event.message } : {}),
    payload: event.metadata,
  });
}

function emitThreadEvent(
  threadId: string,
  type: string,
  message: string,
  role: RuntimeAgentRole | "system" | "thinking" | "tool" | "user" = "system",
  stream = false,
  extras?: EmitThreadEventExtras,
): ThreadActivityLine | undefined {
  extras = projectEmitThreadEventExtras(extras);
  if (type === "tool.started") {
    maybeRevealBrowserFromAgentTool({
      threadId,
      ...(extras?.tool?.name ? { toolName: extras.tool.name } : {}),
      message,
      payload: {
        ...(extras?.metadata ?? {}),
        ...(extras?.tool ? { tool: extras.tool } : {}),
      },
    });
  }
  const { text: normalizedMessage } = repairActivityText(message);
  const trimmed = normalizedMessage.trim();
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
  if (extras?.titleGenerating !== undefined) {
    payload.titleGenerating = extras.titleGenerating;
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
    const tool = projectThreadRunToolMetadataForFeed(extras.tool);
    if (tool) {
      payload.tool = tool;
    }
  }

  if (type === "workspace.changes" || type === "thread.completed" || type === "thread.idle") {
    scheduleWorkspaceGitStatusPublishForThread(threadId);
  }

  desktopEventCenter.publishThreadLiveEvent(payload);
  return persistedActivityLine;
}

function projectEmitThreadEventExtras(extras: EmitThreadEventExtras | undefined): EmitThreadEventExtras | undefined {
  if (!extras?.tool) {
    return extras;
  }
  const { tool: _tool, ...rest } = extras;
  const tool = projectThreadRunToolMetadata(extras.tool);
  return tool ? { ...rest, tool } : rest;
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
  orchestrationKey: string;
  mainAgentModelKey: string;
  mcpServerKeys: readonly string[];
  workspacePath?: string;
  includeUserClaudeMd: boolean;
}): Promise<void> {
  if (!conversationStore.getThread(input.threadId)) {
    return;
  }
  const fingerprint = await resolveThreadPromptCacheFingerprint({
    orchestrationKey: input.orchestrationKey,
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
  const orchestrationLabel =
    reasons.includes("orchestration_changed") && thread?.runtimeConfig
      ? resolvePromptCacheOrchestrationLabel(settings, thread.runtimeConfig)
      : undefined;
  process.stderr.write(
    `[eco] prompt cache invalidated thread=${input.threadId} reasons=${formatPromptCacheBreakLog(reasons)}\n`,
  );
  promptCacheRunEventEmitter.emitInvalidated(input.threadId, reasons, {
    ...(orchestrationLabel && { orchestrationLabel }),
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

function buildCurrentThreadRunProjection(
  threadId: string,
  options?: { fullHistory?: boolean },
): ThreadRunProjectionSnapshot | undefined {
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
  const events = conversationStore.listThreadRunEventsForProjection(
    threadId,
    ...(options?.fullHistory ? [] : [FEED_PROJECTION_MAX_SOURCE_EVENTS]),
  );
  const projection = buildThreadRunProjection({
    threadId,
    status: thread.status,
    message: thread.message,
    attempts: conversationStore.listRunAttempts(threadId),
    agents: conversationStore.listAgentInstances(threadId),
    events,
    ...(billing && { billing }),
    ...(context && { context }),
    subagentTimings: buildSubagentSessionTimings(conversationStore.listSubagentSessions(threadId)),
    historyComplete: options?.fullHistory === true,
  });
  projection.historyRevision = threadRunProjectionHistoryRevisions.get(threadId) ?? 0;
  if (!options?.fullHistory && events.length >= FEED_PROJECTION_MAX_SOURCE_EVENTS) {
    projection.hasEarlier = true;
  }
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
    const identity = diagnostic.requestId ?? diagnostic.agentId ?? "thread";
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

function createPromptImagePreviews(attachments: readonly PromptImageAttachment[]): PromptImagePreview[] {
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
  const thread = conversationStore.getThread(input.threadId);
  const visionSelection = thread
    ? ensureThreadRuntimeConfig(thread).runtimeConfig?.visionModel
    : undefined;
  let sourceRoute: RuntimeRoute | undefined;
  let usingConfiguredVisionModel = false;
  if (visionSelection) {
    sourceRoute = resolveVisionModelRoute(visionSelection, providerStore);
    usingConfiguredVisionModel = true;
  } else {
    sourceRoute = runtime.routes.find((route) => route.role === "planner") ?? runtime.routes[0];
  }
  if (!sourceRoute) {
    throw new Error("看图子代理缺少可用的模型路由。");
  }
  if (sourceRoute.manualSpec?.supportsImageInput === false) {
    const label = usingConfiguredVisionModel ? "视觉模型" : "主 Agent 模型";
    throw new Error(`${label} ${sourceRoute.modelId} 已明确配置为不支持图片输入。`);
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
  const subagentLaunchGate = getThreadSubagentConcurrencyGate(input.threadId);
  const launchDecision = subagentLaunchGate.tryReserveLaunch({
    toolUseId: agentId,
    role: BUILTIN_VISION_AGENT_ROLE,
    prompt: `Analyze ${attachments.length} image attachment(s).`,
  });
  if (!launchDecision.ok) {
    throw new Error(launchDecision.reason);
  }

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
  subagentLaunchGate.releaseLaunch?.({ toolUseId: agentId });
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
      signal: input.signal
        ? AbortSignal.any([input.signal, AbortSignal.timeout(orchestrationGuardrails.maxSubagentRuntimeMs)])
        : AbortSignal.timeout(orchestrationGuardrails.maxSubagentRuntimeMs),
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
    tool: buildClarificationToolMetadata(parsed.toolUseId, "started"),
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
    {
      tool: buildClarificationToolMetadata(parsed.toolUseId, "completed"),
    },
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
  skipExecutionApprovals = false,
): (request: SdkToolPermissionRequest) => Promise<SdkToolPermissionDecision> {
  const browserOpenHandler = createBrowserOpenToolPermissionHandler(threadId);
  if (skipExecutionApprovals) {
    return composeCanUseToolHandlers(
      createAskUserQuestionHandler((parsed) => handleThreadAskUserQuestion(threadId, parsed)),
      browserOpenHandler,
    );
  }
  const bashAndFilesystemHandler = createThreadBashAndFilesystemToolPermissionHandler(threadId, runPhase);
  return composeCanUseToolHandlers(
    createAskUserQuestionHandler((parsed) => handleThreadAskUserQuestion(threadId, parsed)),
    browserOpenHandler,
    bashAndFilesystemHandler,
  );
}

function createBrowserOpenToolPermissionHandler(
  threadId: string,
): (request: SdkToolPermissionRequest) => Promise<SdkToolPermissionDecision> {
  return async (request) => {
    const needsOpenGate = requiresBrowserOpenApproval(request.toolName);
    const mode = browserSettingsStore.get().openApprovalMode;
    if (!needsOpenGate) {
      return { behavior: "allow", updatedInput: request.input };
    }
    if (mode !== "always_ask") {
      return { behavior: "allow", updatedInput: request.input };
    }

    const url =
      extractUrlFromBrowserOpenToolPayload(request.input) ??
      extractUrlFromBrowserOpenToolPayload({ input: request.input });
    const command = url ? `open ${url}` : request.toolName;
    const thread = conversationStore.getThread(threadId);
    if (!thread) {
      return {
        behavior: "deny",
        message: "Thread was not found; Eco could not request browser open approval.",
        interrupt: true,
      };
    }
    const approvalAgentId = resolveThreadBashApprovalAgentId(threadId, request);
    if (!approvalAgentId) {
      return {
        behavior: "deny",
        message: "Eco could not attribute this browser open approval to an agent instance.",
        interrupt: false,
      };
    }

    const cwd = request.cwd?.trim() || thread.sdkCwd || thread.workspacePath || ".";
    const approvalRequest: BashApprovalRequest = {
      toolUseId: request.toolUseId,
      threadId,
      command,
      cwd,
      reason: url
        ? `Agent wants to open ${url} in the built-in browser.`
        : "Agent wants to open a website in the built-in browser.",
      riskScore: 35,
      riskLevel: "low",
      agentId: approvalAgentId,
      ...(request.agentType ? { agentType: request.agentType } : {}),
      description: url ? `Open ${url}` : "Open website",
    };

    emitThreadEvent(
      threadId,
      "bash_approval.requested",
      url ? `等待确认打开浏览器：${url}` : "等待确认打开内置浏览器",
      "tool",
      false,
      bashApprovalEventExtras(approvalRequest, "bash_approval.requested"),
    );

    const resolution = await registerPendingBashApproval(threadId, approvalRequest);
    if (isBashApprovalGranted(resolution)) {
      emitThreadEvent(
        threadId,
        "bash_approval.approved",
        url ? `已允许打开浏览器：${url}` : "已允许打开内置浏览器",
        "tool",
        false,
        bashApprovalEventExtras(approvalRequest, "bash_approval.approved"),
      );
      return { behavior: "allow", updatedInput: request.input };
    }

    emitThreadEvent(
      threadId,
      "bash_approval.rejected",
      url ? `已拒绝打开浏览器：${url}` : "已拒绝打开内置浏览器",
      "tool",
      false,
      bashApprovalEventExtras(approvalRequest, "bash_approval.rejected"),
    );
    return {
      behavior: "deny",
      message: formatFilesystemApprovalDenyMessage(request.toolName, resolution.feedback),
      interrupt: false,
    };
  };
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

      let approvalRequest: BashApprovalRequest = {
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

      if (confirmationMode === "auto") {
        const review = await reviewThreadToolApproval(threadId, approvalRequest, {
          toolName: request.toolName,
          toolInput: request.input,
        });
        if (review.action === "allow") {
          const reviewedRequest = {
            ...approvalRequest,
            reviewRationale: review.rationale,
          };
          emitThreadEvent(
            threadId,
            "bash_approval.approved",
            `辅助模型已允许 ${request.toolName}：${filesystemPath}`,
            "tool",
            false,
            bashApprovalEventExtras(reviewedRequest, "bash_approval.approved"),
          );
          return { behavior: "allow", updatedInput: request.input };
        }
        if (review.action === "deny") {
          const reviewedRequest = {
            ...approvalRequest,
            reviewRationale: review.rationale,
          };
          emitThreadEvent(
            threadId,
            "bash_approval.denied",
            `已拒绝 ${request.toolName}：${review.rationale}`,
            "tool",
            false,
            bashApprovalEventExtras(reviewedRequest, "bash_approval.denied"),
          );
          return { behavior: "deny", message: review.rationale, interrupt: false };
        }
        approvalRequest = {
          ...approvalRequest,
          reviewRationale: review.rationale,
        };
      }

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
    const bashReviewMode = runtimeConfig?.bashReviewMode ?? "always";
    const confirmation = evaluateThreadToolConfirmation({
      command,
      cwd,
      workspacePath: thread.workspacePath,
      confirmationMode: bashReviewMode,
      phaseAllowsExecution:
        runPhase !== "ask" &&
        (runPhase !== "planning" || resolveSessionMode(runtimeConfig) === "agent"),
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
    let approvalRequest: BashApprovalRequest = {
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

    if (bashReviewMode === "auto") {
      const review = await reviewThreadToolApproval(threadId, approvalRequest, {
        toolName: "Bash",
        toolInput: request.input,
      });
      if (review.action === "allow") {
        const reviewedRequest = {
          ...approvalRequest,
          reviewRationale: review.rationale,
        };
        emitThreadEvent(
          threadId,
          "bash_approval.approved",
          `辅助模型已允许 Bash：${command}`,
          "tool",
          false,
          bashApprovalEventExtras(reviewedRequest, "bash_approval.approved"),
        );
        return { behavior: "allow", updatedInput: request.input };
      }
      if (review.action === "deny") {
        const reviewedRequest = {
          ...approvalRequest,
          reviewRationale: review.rationale,
        };
        emitThreadEvent(
          threadId,
          "bash_approval.denied",
          `已拒绝 Bash：${review.rationale}`,
          "tool",
          false,
          bashApprovalEventExtras(reviewedRequest, "bash_approval.denied"),
        );
        return { behavior: "deny", message: review.rationale, interrupt: false };
      }
      approvalRequest = {
        ...approvalRequest,
        reviewRationale: review.rationale,
      };
    }

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

async function reviewThreadToolApproval(
  threadId: string,
  request: BashApprovalRequest,
  tool: { toolName: string; toolInput: Record<string, unknown> },
  source: string = "claude",
): Promise<EcoApprovalReviewResult> {
  const thread = conversationStore.getThread(threadId);
  if (!thread) {
    return {
      action: "human_required",
      rationale: "线程不存在，自动审批已失败关闭并转人工审批。",
      policyMatches: ["thread_missing"],
    };
  }
  let route;
  try {
    route = resolveAuxiliaryModelRoute(thread.runtimeConfig?.auxiliaryModel, providerStore, {
      globalMaxOutputTokens: workflowSettingsStore.get().maxOutputLimitTokens,
    });
  } catch (error) {
    return {
      action: "human_required",
      rationale: `辅助模型不可用，自动审批已失败关闭并转人工审批：${errorMessage(error)}`,
      policyMatches: ["auxiliary_model_unavailable"],
    };
  }

  const activityLines = conversationStore.listActivityLines(threadId).map((line) => ({
    role: line.role,
    message: line.message,
  }));
  const built = buildThreadApprovalEnvelope({
    activityLines,
    initialPrompt: thread.prompt,
    toolName: tool.toolName,
    toolInput: tool.toolInput,
    cwd: request.cwd,
    workspacePath: thread.workspacePath,
    reason: request.reason,
    riskScore: request.riskScore,
    riskLevel: request.riskLevel,
    source,
  });
  if (!built.ok) {
    return {
      action: "human_required",
      rationale: built.rationale,
      policyMatches: built.policyMatches,
    };
  }
  return reviewEcoApproval({
    route,
    envelope: built.envelope,
    serializedEnvelope: built.serialized,
    locale: currentAppLocale(),
  });
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
  scheduleCodexGlobalRuntimeRefresh();
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
        const contextTokens = contextByRole[route.role];
        return runtimeRouteToProxyRoute(route, {
          globalMaxOutputTokens: workflowSettingsStore.get().maxOutputLimitTokens,
          ...(contextTokens !== undefined && { contextTokens }),
        });
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
