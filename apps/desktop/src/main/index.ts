import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ResolvedModelRoute } from "@eco/model-router";
import {
  ACP_IMAGE_ONLY_PROMPT,
  type AgentEvent,
  acpSessionIdToDelete,
  type CodexGatewayCatalogRoute,
  composeCanUseToolHandlers,
  createAskUserQuestionHandler,
  defaultSubagentAvailability,
  deleteCursorAcpSession,
  type EcoAgentRuntimeConfig,
  type EcoPlanningContext,
  type EcoSdkResumeOptions,
  type EcoSdkSessionOptions,
  type EcoSubagentAttributionHooks,
  evaluateFilesystemReadConfirmation,
  evaluateFilesystemWriteConfirmation,
  isAcpProviderExhaustionMessage,
  isCoreKind,
  isReadFilesystemTool,
  isWriteFilesystemTool,
  materializeEcoToolPolicy,
  normalizeSdkSubagentType,
  type PlanReadyPayload,
  parsePiUsage,
  probePiCoreAvailability,
  readFilesystemPath,
  resolveAcpHostUiFeatures,
  resolveCursorAgentExecutable,
  SDK_GENERAL_PURPOSE_AGENT_KEY,
  SDK_PLAN_AGENT_KEY,
  type SdkAskUserQuestionRequest,
  type SdkToolPermissionDecision,
  type SdkToolPermissionRequest,
  type SessionCapturedPayload,
  type SubagentRunPhase,
  toAcpMcpServers,
} from "@eco/runtime";
import { steerCodexTurn } from "@eco/runtime/codex-turn-steer";
import { listCursorAgentModels } from "@eco/runtime/cursor-agent-models";
import {
  ClaudeAgentSdkDriver,
  deleteClaudeAgentSdkSession,
  type EcoHookContext,
  extractCompactPostTokens,
  forkClaudeSessionAt,
  resolveClaudeResumeSessionAtBeforeUserMessage,
} from "@eco/runtime/sdk";
import { definedProps, isRemoteCommandChannel } from "@eco/shared";
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
  type NativeImage,
  Notification,
  nativeImage,
  nativeTheme,
  net,
  powerMonitor,
  safeStorage,
  session,
  shell,
} from "electron";
import { ClaudeMidTurnPortRegistry } from "./claude-mid-turn-port";
import { decideClaudeResume, snapshotClaudeResumeRoutes } from "./claude-resume-decision";
import { CodexMidTurnPortRegistry } from "./codex-mid-turn-port";
import { getClaudeVersion, getCodexVersion, getCursorVersion } from "./core-version";
import { configureDesktopDevIdentity } from "./desktop-app-identity";
import { ensureDesktopPath } from "./fix-desktop-path";
import { ImageViewReadError, readImageViewFile } from "./image-view-reader";
import { buildApplicationMenuTemplate } from "./native-menu";
import {
  readElectronResourcesPath,
  resolvePackagedClaudeExecutableCandidate,
} from "./packaged-runtime-executables";
import { isReloadShortcutInput } from "./packaged-window-shortcuts";
import { assertSdkSessionRetainedOnRunFailure } from "./sdk-session-run-failure";
import { isAllowedSessionPermission, isLocalRendererUrl } from "./session-permissions";
import { evaluateThreadToolConfirmation } from "./thread-bash-permission";
import {
  resolveWindowsBackdropVersion,
  resolveWindowsBackgroundMaterial,
} from "./windows-background-material";

ensureDesktopPath();

import { repairActivityText } from "../shared/activity-text";
import { isOrchestrationSelection, orchestrationConfigFromSnapshot } from "../shared/agent-orchestration";
import { buildAgentTemplateArchive, parseAgentTemplateArchive } from "../shared/agent-template-archive";
import { resolveUpstreamApiCompat, type UpstreamApiCompat } from "../shared/api-compat";
import {
  deriveBashApprovalRememberPrefix,
  formatBashApprovalDenyMessage,
  formatFilesystemApprovalDenyMessage,
} from "../shared/bash-approval-ui";
import { didSwitchToAllowAllBashReviewMode } from "../shared/bash-review-ui";
import { enrichBillingDisplaySource } from "../shared/billing-display-source";
import {
  type BrowserCloseRequest,
  type BrowserFocusRequest,
  type BrowserNavigateRequest,
  type BrowserOpenRequest,
  type BrowserRegisterGuestRequest,
  type BrowserSetUiScopeRequest,
  type BrowserSetVisibleRequest,
  type BrowserViewState,
  ECO_AGENT_BROWSER_MCP_SERVER,
  ECO_AGENT_BROWSER_SKILL_NAME,
  extractUrlFromBrowserOpenToolPayload,
  isEcoAgentBrowserOpenToolName,
  requiresBrowserOpenApproval,
  resolveToolNameFromActivityPayload,
} from "../shared/browser";
import {
  ECO_COMPUTER_USE_MCP_SERVER,
  isEcoComputerUseToolName,
  requiresComputerUseActionApproval,
} from "../shared/computer-use";
import { codexTurnHasRetryBlockingProgress } from "../shared/codex-request-retry-gate";
import { listEnabledGlobalMcpServerKeys } from "../shared/composer-mcp";
import type { SkillsEnabledSettings } from "../shared/composer-skills-settings";
import type { DesktopUpdateState } from "../shared/desktop-update";
import { computeGlobalSettingsDigest } from "../shared/global-settings-digest";
import { expectedIpcErrorKey, translateCatalog } from "../shared/i18n-catalogs";
import {
  buildImageDisplayPromptAppend,
  ECO_IMAGE_DISPLAY_MCP_SERVER,
  ECO_IMAGE_DISPLAY_TOOL,
  isEcoImageDisplayToolName,
} from "../shared/image-display-tool";
import {
  buildHtmlHostPromptAppend,
  ECO_HTML_HOST_MCP_SERVER,
  ECO_HTML_HOST_TOOL,
  isEcoHtmlHostToolName,
} from "../shared/html-host-tool";
import {
  buildImageGenerationPromptAppend,
  ECO_IMAGE_GENERATION_MCP_SERVER,
  type ImageGenerationArtifact,
  type ImageGenerationProfileSaveInput,
  isEcoImageGenerationToolName,
} from "../shared/image-generation";
import {
  buildIntegratedWebSearchPromptAppend,
  ECO_WEB_SEARCH_MCP_SERVER,
  isEcoWebSearchToolName,
} from "../shared/integrated-web-search";
import {
  buildImageViewPromptAppend,
  ECO_IMAGE_VIEW_MCP_SERVER,
  ECO_IMAGE_VIEW_TOOL,
  isEcoImageViewToolName,
} from "../shared/image-view-tool";
import { integrationEnabled } from "../shared/integrations";
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
  type CenterServerSyncDomain,
  type CenterServerTestConnectionRequest,
  type ClarificationSubmitPayload,
  type CoderTodoItem,
  hasCompleteOrchestrationSelection,
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
  isGitPullRequest,
  isGitPushRequest,
  isKnownIpcChannel,
  isRunPackageScriptRequest,
  isSavePackageScriptArgsRequest,
  isSshBookmarkConnectRequest,
  isSshBookmarkDeleteRequest,
  isSshBookmarkSaveInput,
  isStorageCleanupRequest,
  isTerminalInputRequest,
  isTerminalKillRequest,
  isTerminalListRequest,
  isTerminalResizeRequest,
  isTerminalSpawnRequest,
  isThreadRuntimeConfig,
  type ListUpstreamModelsRequest,
  lockThreadRuntimeConfigSnapshotOnContinue,
  type MainAgentConfigResource,
  type MainAgentPromptResource,
  type McpServerConfigInput,
  type ModelSettingsSnapshot,
  materializeThreadOrchestrationSnapshot,
  normalizeThreadRuntimeConfig,
  type OrchestrationSelection,
  type PlanApprovalRequest,
  type PromptImageAttachment,
  type ProviderConfigInput,
  parseGitListCommitModelOptionsRequest,
  parseGitSaveCommitModelPreferenceRequest,
  type RouteManualSpec,
  type RouteProfileInput,
  type RuntimeAgentRole,
  type RuntimeRoleRouteConfig,
  resolveBusyThreadRuntimeConfigUpdate,
  resolveMainAgentSystemPromptPreset,
  resolveSessionMode,
  resolveThreadOrchestrationSnapshot,
  resolveThreadRuntimeMcpServerKeys,
  runtimeRoleRoutesFromOrchestrationSnapshot,
  SUBAGENT_ROLES,
  type SubagentOrchestrationResource,
  shouldRematerializeThreadRuntimeConfigOnContinue,
  type TerminalListRequest,
  type TestProviderConnectionRequest,
  type TestRoleRoutesRequest,
  type ThreadActivityLine,
  type ThreadActivityRewindTarget,
  type ThreadAppliedDiffResult,
  type ThreadBillingSnapshot,
  type ThreadContextSnapshot,
  type ThreadContinueRequest,
  type ThreadContinueResult,
  type ThreadFollowUpCancelRequest,
  type ThreadFollowUpEditingRequest,
  type ThreadFollowUpEnqueueRequest,
  type ThreadFollowUpEscalateRequest,
  type ThreadFollowUpMutationResult,
  type ThreadFollowUpQueuePausedRequest,
  type ThreadFollowUpQueuePausedResult,
  type ThreadFollowUpReorderRequest,
  type ThreadFollowUpRunPhase,
  type ThreadFollowUpUpdateRequest,
  type ThreadLiveEvent,
  type ThreadModelUsageEntry,
  type ThreadPendingFollowUp,
  type ThreadPendingPlan,
  type ThreadRetryFromMessageRequest,
  type ThreadRevertAppliedDiffResult,
  type ThreadRewindCheckpointRequest,
  type ThreadRewindCheckpointResult,
  type ThreadRewriteFromMessageRequest,
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
  type ThreadUserMessageEditGetRequest,
  type ThreadUserMessageEditGetResult,
  type WorkspaceInfo,
  type WorktreeApplyResult,
  type WorktreeCancelDisposition,
  type WorktreeStatusResult,
  withAgentSessionMode,
} from "../shared/ipc";
import {
  type AppLocale,
  type AppLocalePreference,
  normalizeLocalePreference,
  resolveAppLocale,
} from "../shared/locale";
import { buildCodexMcpServersForConfigSync, filterMcpSdkConfigByAssignedServers } from "../shared/mcp";
import { preferenceAllowsDesktopNotification } from "../shared/notification-settings";
import { parseThreadApprovePlanPayload } from "../shared/plan-approval";
import {
  buildMainAgentModelKey,
  buildOrchestrationRuntimeKey,
  diffPromptCacheRuntimeSignatures,
  resolveMainAgentModelKey,
  resolvePromptCacheOrchestrationLabel,
  resolvePromptCacheRuntimeSignature,
} from "../shared/prompt-cache-config";
import { PROMPT_IMAGE_PREVIEWS_METADATA_KEY, type PromptImagePreview } from "../shared/prompt-image-metadata";
import { BUILTIN_VISION_AGENT_ROLE, buildPromptWithVisionAnalysis } from "../shared/prompt-image-vision";
import { attachOutputTokensToRequestSpans, type RequestSpanLedgerUsageRow } from "../shared/request-span-usage";
import {
  attachPeerGatewayTimingToLedgerEventViews,
  attachSpanTimingToLedgerEventViews,
} from "../shared/ledger-event-timing";
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
  activityLinesFromThreadRunEvents,
  buildThreadApprovalNotificationContent,
  buildThreadClarificationNotificationContent,
  buildThreadCompletionNotificationContentFromSources,
} from "../shared/thread-completion-notification";
import {
  activityLinesBeforeRewindTarget,
  buildAgentPromptWithContext,
  buildThreadTurnPrompt,
  resolveCodexContinueStrategy,
  resolveThreadContinueAction,
  type ThreadContinueAction,
  threadEnteredExecutionPhase,
  threadHasPriorAgentOutput,
} from "../shared/thread-continuation";
import {
  buildPlanExecutionFailureMessage,
  persistThreadSummaryMessage,
  planExecutionFailurePrefix,
} from "../shared/thread-failure-message";
import {
  assertAcpFollowUpEscalateAllowed,
  coreSupportsMidTurnFollowUp,
  resolveAcpFollowUpEnqueuePlan,
} from "../shared/thread-follow-up-core";
import {
  buildThreadFollowUpDisplayPrompt,
  buildThreadFollowUpDrainPrompt,
  collectThreadFollowUpAttachments,
  shouldBlockThreadFollowUpDrain,
  shouldDrainThreadFollowUps,
} from "../shared/thread-follow-up-drain";
import {
  requiresEmptyTurnForRequestRetry,
  supportsOneClickRequestRetry,
  usesRewindOnRequestRetry,
} from "../shared/thread-request-retry";
import { excludeAgentScopedFeedTimelineItems } from "../shared/thread-run-projection-skeleton";
import {
  projectThreadRunToolMetadata,
  projectThreadRunToolMetadataForFeed,
} from "../shared/thread-run-tool-projection";
import {
  buildWorktreeMergeSummary,
  formatWorktreeMergeThreadMessage,
  serializeWorktreeMergeMessage,
} from "../shared/worktree-merge";
import { createAcpAskQuestionHandler } from "./acp-ask-question-bridge";
import {
  type AcpCursorProbeResult,
  assertAcpCursorRunnable,
  handshakeAcpCursor,
  probeAcpCursorAvailability,
  reconcileAcpCursorEnabled,
} from "./acp-cursor-availability";
import { createAcpPermissionHandler } from "./acp-permission-bridge";
import {
  applyAcpPlanProgress,
  applyAcpUpdateTodos,
  isAcpPlanTodoPayload,
  isAcpUpdateTodosPayload,
} from "./acp-plan-progress";
import {
  cancelAcpThread,
  resolveAcpRunPrompt,
  startAcpThreadRun,
  stopAllAcpRuntimes,
  toAcpThreadStartRunInput,
} from "./acp-runtime-run";
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
  emitClaudeGatewayUsageIfSession,
  resolveClaudeBridgeRoute,
  runtimeRouteToProxyRoute,
  startAnthropicModelProxy,
} from "./anthropic-proxy";
import { attachMainWindowQuitGuard, installApplicationShutdownHook } from "./application-shutdown";
import { transcribeAsr } from "./asr-client";
import { type AsrSecretCodec, type AsrSettingsStore, createAsrSettingsStore } from "./asr-settings-store";
import { resolveAuxiliaryModelRoute } from "./auxiliary-model-route";
import { BackgroundTerminalTaskRegistry } from "./background-terminal-tasks";
import { resolveBashApprovalAgentId } from "./bash-approval-agent-id.js";
import {
  approveAllPendingBashApprovalsForThread,
  type BashApprovalResolution,
  buildResolvedBashApprovalThreadPatch,
  cancelBashApprovalsForThread,
  getPendingBashApprovalByToolUseId,
  getPendingBashApprovalForThread,
  registerPendingBashApproval,
  resolvePendingBashApproval,
} from "./bash-approval-bridge";
import type { UsageBillingObservation } from "./billing-orchestration";
import { isSubagentBillingRole } from "./billing-orchestration";
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
import { installBrowserGuestBridge } from "./browser-guest-bridge";
import { appendBrowserPrompt, BrowserHost } from "./browser-host";
import {
  type BrowserSettingsStore,
  createBrowserSettingsStore,
  isBrowserSettingsSnapshot,
  normalizeBrowserSettingsSnapshot,
} from "./browser-settings-store";
import { ComputerUseMcpGateway } from "./computer-use-mcp-gateway";
import {
  type ComputerUseSettingsStore,
  createComputerUseSettingsStore,
  isComputerUseSettingsSnapshot,
  normalizeComputerUseSettingsSnapshot,
} from "./computer-use-settings-store";
import {
  type FinalizeCancelledRunDeps,
  finalizeCancelledRun,
  parseThreadCancelRequest,
  takePendingCancelDisposition,
} from "./cancel-worktree";
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
import { globalClaudeBridgeBindingRegistry } from "./claude-bridge-binding";
import { CodexFileCheckpointStore } from "./codex-file-checkpoints";
import {
  CodexGatewayUsageDeduplicator,
  resolveCodexGatewayUsageBilling,
} from "./codex-gateway-usage-billing";
import { CodexGatewayUsagePendingBuffer } from "./codex-gateway-usage-pending";
import { getGlobalCodexRuntimeLifecycle, stopGlobalCodexRuntimeLifecycle } from "./codex-runtime-lifecycle";
import {
  assertCodexSkillsConfigReloadAllowed,
  configureCodexApprovalBridge,
  configureCodexRuntimeRun,
  createCodexRuntimeDriver,
  ensureCodexControlPlaneClient,
  forkCodexThreadForEcoThread,
  getCodexTurnRouteRegistry,
  isCodexCliAvailable,
  queryCodexThreadStatusForEcoThread,
  registerResolvedCodexGatewayTurnRoute,
  runThreadRequestWithRuntimeProxy as runCodexThreadRequest,
  scheduleCodexGlobalRuntimeRefresh,
} from "./codex-runtime-run";
import { applyCodexSubagentLifecycleEvent } from "./codex-subagent-lifecycle";
import { CodexSubagentRuntimeLimitController } from "./codex-subagent-runtime-limit";
import { type CodexThreadMap, resolveCodexThreadAttribution } from "./codex-thread-map";
import { applyCodexTurnPlanProgress } from "./codex-turn-plan-progress";
import { type ContextLifecycleService, createContextLifecycleService } from "./context-lifecycle-service";
import { logContextSnapshot } from "./context-snapshot-log";
import { ContextSnapshotScheduler } from "./context-snapshot-scheduler";
import { ContextWindowMonitor } from "./context-window-monitor";
import { type ConversationStore, createConversationStore, type ThreadListCursor } from "./conversation-store";
import { ConversationStoreCodexThreadMap } from "./conversation-store-codex-thread-map";
import { listDiscoveredCursorAgents } from "./cursor-agents-discovery";
import { DesktopNotificationRetainer } from "./desktop-notification-retainer";
import { presentDesktopWindow } from "./desktop-single-instance";
import { DesktopUpdateService } from "./desktop-update-service";
import { resolveInitialWindowBounds } from "./desktop-window-placement";
import {
  buildEcoAgentBrowserCodexSkillInfo,
  ensureClaudeUserEcoAgentBrowserSkill,
  removeClaudeUserEcoAgentBrowserSkill,
  resolveEcoAgentBrowserSkillFileForCodex,
} from "./eco-agent-browser-skill";
import {
  buildThreadApprovalEnvelope,
  type EcoApprovalReviewResult,
  reviewEcoApproval,
} from "./eco-approval-reviewer";
import { logEcoDiag, logEcoDiagThrottled, shortAgentId, shortThreadId } from "./eco-diag-log";
import {
  configureEcoGatewayLifecycle,
  ensureGlobalEcoGateway,
  stopGlobalEcoGateway,
} from "./eco-gateway-lifecycle";
import { createElectronEventSink, DesktopEventCenter } from "./event-center";
import { handleGatewayRequestLifecycleEvent } from "./gateway-request-lifecycle";
import { classifyGatewayUsageEvent } from "./gateway-usage-dispatch";
import { GitAutoFetcher } from "./git-autofetch";
import {
  checkoutGitBranch,
  createGitBranch,
  discardWorkspaceChanges,
  fetchFromOrigin,
  getGitWorkingTreeStatus,
  getWorkspaceDiff,
  getWorkspaceFileDiff,
  handleGitCommit,
  handleGitGenerateCommitMessage,
  handleGitListCommitModelOptions,
  handleGitPull,
  handleGitPush,
  handleGitSaveCommitModelPreference,
  listGitCommits,
} from "./git-service";
import {
  createGitSettingsStore,
  type GitSettingsStore,
  isGitSettingsSnapshot,
  normalizeGitSettingsSnapshot,
} from "./git-settings-store";
import { ensureHomeProject, getHomeProjectPath } from "./home-project-bootstrap";
import { ImageDisplayMcpGateway } from "./image-display-mcp-gateway";
import { createImageDisplayStore, ImageDisplayError, ImageDisplayStore } from "./image-display-store";
import { HtmlHostMcpGateway } from "./html-host-mcp-gateway";
import { HtmlHostStore } from "./html-host-store";
import { ImageGenerationMcpGateway } from "./image-generation-mcp-gateway";
import {
  createImageGenerationStore,
  type ImageGenerationSecretCodec,
  type ImageGenerationStore,
} from "./image-generation-store";
import { ImageViewMcpGateway } from "./image-view-mcp-gateway";
import { IntegratedWebSearchMcpGateway } from "./integrated-web-search-mcp-gateway";
import { InteractiveTerminalManager } from "./interactive-terminal-manager";
import { resolveThreadWebSearchPlan } from "./resolve-thread-web-search";
import { createLocalSecretCodec } from "./local-secret-codec";
import { checkMcpServerConnection } from "./mcp-checker";
import { prepareCodexGlobalMcpServerPool, prepareMcpSdkConfigForRuntime } from "./mcp-runtime";
import { createMcpStore, type McpStore } from "./mcp-store";
import { ModelsDevPricingCache } from "./models-dev-pricing-cache";
import {
  createNotificationSettingsStore,
  isNotificationSettingsSnapshot,
  type NotificationSettingsStore,
  normalizeNotificationSettingsSnapshot,
} from "./notification-settings-store";
import { resolveOrchestrationGuardrails } from "./orchestration-run-budget";
import { PackageJsonWatcher } from "./package-json-watcher";
import { createPackageScriptArgsStore, type PackageScriptArgsStore } from "./package-script-args-store";
import {
  listPackageScripts,
  preparePackageScriptRun,
  runPreparedPackageScriptAsBackgroundTask,
} from "./package-scripts";
import {
  createPersonalizationSettingsStore,
  isPersonalizationSettingsSnapshot,
  normalizePersonalizationSettingsSnapshot,
  type PersonalizationSettingsStore,
} from "./personalization-settings-store";
import { buildPiMcpSessionConfig, mergePiAppendSystemPrompt } from "./pi-mcp-session";
import {
  abortPiThread,
  disposePiThreadSession,
  removePiThreadAgentDir,
  startPiThreadRun,
} from "./pi-runtime-run";
import {
  piSkillDirectoriesForSession,
  resolvePiThreadSkills,
  shouldBlockPiSkillsConfigReload,
  skillsEnabledSettingsChanged,
} from "./pi-skills-config";
import {
  cancelPlanApprovalsForThread,
  getPendingPlanApprovalByToolUseId,
  getPendingPlanApprovalForThread,
  getPendingPlanApprovalWaitForThread,
  registerPendingPlanApproval,
  resolvePendingPlanApproval,
} from "./plan-approval-bridge";
import {
  createProjectIntegrationsSettingsStore,
  type ProjectIntegrationsSettingsStore,
} from "./project-integrations-settings-store";
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
import { isPromptImageAttachmentRecord, PromptImageFileStore } from "./prompt-image-file-store";
import { collectProviderDeleteReferences, partitionProviderDeleteReferences } from "./provider-deletion";
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
import {
  createIntegratedWebSearchSettingsStore,
  isIntegratedWebSearchSettingsSaveInput,
  type IntegratedWebSearchSettingsStore,
} from "./integrated-web-search-settings-store";
import { resolveProxyUsageBilling } from "./proxy-usage-billing";
import { REMOTE_THREAD_LIST_INITIAL_LIMIT_PER_WORKSPACE } from "./remote-thread-list";
import { formatUserFacingRequestError, type RequestAttemptResult } from "./request-retry";
import { resolveCommandExecutable } from "./resolve-command-executable";
import { reconcileSdkAgentTerminalEvent } from "./sdk-agent-terminal-reconciliation";
import type { resolveSdkEventUsageBilling, SdkRunUsageBillingInput } from "./sdk-event-usage-billing";
import { resolveSdkRunBillingResolution } from "./sdk-run-billing-resolution";
import { consumeSdkRunEvents } from "./sdk-run-event-loop";
import { type BuildSdkRunInput, buildSdkRunInput, sdkRunPhaseFromMode } from "./sdk-run-input";
import {
  listSdkSessionActivityLines,
  listSdkSubagentActivityLines,
  sdkActivityLineId,
} from "./sdk-session-activity.js";
import {
  type SdkLocalStreamUpdate,
  SdkStreamActivityBridge,
  toThreadLocalStreamUpdate,
} from "./sdk-stream-activity";
import {
  createSdkStreamActivityIngestion,
  type SdkStreamActivityIngestion,
} from "./sdk-stream-activity-ingestion";
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
import { createSshBookmarkStore, type SshBookmarkStore } from "./ssh-bookmark-store";
import { connectSshBookmark, type SshConnectSecrets } from "./ssh-connect";
import { runStorageCleanup } from "./storage-cleanup";
import { buildStorageUsageSnapshot } from "./storage-inventory";
import { SubagentConcurrencyGate } from "./subagent-concurrency-gate";
import {
  clearThreadSubagentLaunchRegistry,
  getThreadSubagentLaunchRegistry,
} from "./subagent-launch-registry-store.js";
import { SubagentMetricsRegistry } from "./subagent-metrics-registry";
import { buildSubagentMetricsSummaries } from "./subagent-metrics-summary";
import { createSubagentSessionHooks } from "./subagent-session-hooks.js";
import { buildSubagentSessionTimings } from "./subagent-session-snapshots.js";
import { reconcileSubagentTerminalTranscript } from "./subagent-terminal-reconciliation.js";
import { SupabaseCenterDesktopClient } from "./supabase-center-client";
import { createDesktopSettingsSyncHooks } from "./supabase-settings-sync-hooks";
import { resolveThreadApprovePlanRoute } from "./thread-approve-plan-route";
import { ThreadCacheHitMonitor } from "./thread-cache-hit-monitor";
import {
  attachThreadCancelling,
  attachThreadListCancelling,
  clearThreadCancelling,
  isThreadCancelling,
  markThreadCancelling,
  shouldKeepThreadCancelling,
} from "./thread-cancelling-state";
import { requireThreadCore } from "./thread-core-routing";
import {
  createThreadFeedSkeletonRecord,
  type FeedSkeletonPatchContext,
  patchThreadFeedSkeletonFromEvent,
  shouldPatchAgentTimelineForFeedSkeleton,
  shouldTrackEventForFeedSkeletonPatch,
} from "./thread-feed-skeleton-patch";
import type { ThreadFeedSkeletonRecord } from "./thread-feed-skeleton-store";
import {
  hydrateThreadFeedSkeletonSnapshot,
  isThreadFeedSkeletonFresh,
  mapRunAttemptsForFeedSkeleton,
  resolveFeedSkeletonPatchAgents,
} from "./thread-feed-skeleton-store";
import {
  applyExactLogicalRequestLateBind,
  applyLogicalRequestTerminal,
  clearFinalizedLiveRequestsForAttempt,
  finalizeDisplayRequestTerminal,
  finalizeLiveRequest,
  GATEWAY_ATTEMPT_CONNECTION_ERROR_ORIGIN,
  handleBridgeMessagesRequest,
  markBridgeRequestStartedPersisted,
  recordProviderRequestIdForLogical,
  resolveExplicitBridgeRequestAgentId,
  resolveFrozenLiveRequestAttribution,
  resolveLiveRequestIdForEvent,
  resolvePiUsageLogicalRequestId,
  resolveSdkLateBindAttribution,
  resolveUpstreamConnectionErrorAttribution,
  shouldEmitRetryScheduledCancellation,
  shouldEmitSdkShadowRequestTerminal,
  shouldPersistRequestStartedShadowEvent,
} from "./thread-live-request-coordinator.js";
import { ThreadLiveRequestRegistry } from "./thread-live-request-registry.js";
import { readOptionalString, resolveThreadMessagePrompt } from "./thread-message-prompt";
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
  type RequestTerminalStage,
  requestTerminalLiveType,
  requestTerminalMessage,
} from "./thread-request-lifecycle.js";
import { type RunAttemptContext, runThreadRequestWithLifecycle } from "./thread-run-attempt";
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
import { createThreadRunEventLivePersister } from "./thread-run-event-live-persist";
import {
  buildSubagentLifecycleRunEvent,
  buildSubagentMissionAttributedRunEvent,
  buildThreadRunEventFromLiveEvent,
  isMetricsOnlyThreadLiveEvent,
  isMetricsOnlyThreadRunEvent,
} from "./thread-run-event-normalizer";
import {
  resolveAskRunOutcome,
  resolveAutonomousRunOutcome,
  resolveContinuationRunOutcome,
  resolveExecutionRunOutcome,
  resolvePlanningRunOutcome,
  resolvePlanSessionRunOutcome,
  runAttemptPhaseFromThreadMode,
} from "./thread-run-outcome";
import { buildThreadRunProjection, buildThreadRunProjectionRequestSpans } from "./thread-run-projection";
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
import {
  runThreadRequestWithRuntimeProxy,
  type ThreadRuntimeProxyResult,
} from "./thread-runtime-proxy-attempt";
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
  coreOwnsSessionTitle,
  normalizeAcpSessionTitle,
  resolveFailedThreadTitle,
  resolvePendingThreadTitle,
  shouldReplaceAutoThreadTitle,
  summarizeThreadTitle,
} from "./thread-title";
import { loadThreadTodoList } from "./thread-todo-list-runtime";
import { ThreadUsageAccumulator } from "./thread-usage-accumulator";
import {
  buildThreadUsageSnapshotResult,
  type ThreadUsageSnapshotRuntimeServices,
} from "./thread-usage-snapshot-runtime";
import { getUpstreamLogFilePath, logUpstream } from "./upstream-log";
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
import { readUsageLedgerGenerationMs, readUsageLedgerLogicalRequestId, readUsageLedgerTtftMs } from "./usage-ledger-cost-metadata";
import { runVisionAnalysis, type VisionAnalysisHost } from "./vision-analysis";
import { resolveThreadVisionAnalysisRoute, resolveVisionModelRoute } from "./vision-model-route";
import {
  createWebChatListStore,
  isWebChatListSnapshot,
  normalizeWebChatListSnapshot,
  type WebChatListStore,
} from "./web-chat-list-store";
import {
  createWorkflowSettingsStore,
  isWorkflowSettingsSnapshot,
  normalizeWorkflowSettingsSnapshot,
  type WorkflowSettingsStore,
} from "./workflow-settings-store";
import { listWorkspaceEntries, readWorkspaceFile, writeWorkspaceFile } from "./workspace-file-browser";
import { prepareWorkspaceGit } from "./workspace-git-setup";
import { WorkspaceGitStatusPublisher } from "./workspace-git-status-publisher";
import { inspectWorkspace, resolveGitExecutable } from "./workspace-inspect";
import {
  type ApprovedPlanSnapshot,
  approvedPlanRelativePath,
  claudePlanFileExists,
  readApprovedPlanSnapshot,
  readClaudePlanFile,
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

function broadcastDesktopUpdateState(state: DesktopUpdateState): void {
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.appUpdateStateChanged, state);
    }
  });
}

const desktopUpdateService = new DesktopUpdateService({
  manifestPath: path.join(__dirname, "../release-manifest.json"),
  onStateChange: broadcastDesktopUpdateState,
});

configureDesktopDevIdentity();

// The shared SQLite store and fixed-port gateway require a single main-process writer.
const e2eMode = process.env.ECO_E2E === "1";
const hasSingleInstanceLock = e2eMode ? true : app.requestSingleInstanceLock();
if (!e2eMode && !hasSingleInstanceLock) {
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
let projectIntegrationsSettingsStore: ProjectIntegrationsSettingsStore;
let projectOrchestrationSettingsStore: ProjectOrchestrationSettingsStore;
let projectSkillsSettingsStore: ProjectSkillsSettingsStore;
let gitSettingsStore: GitSettingsStore;
let personalizationSettingsStore: PersonalizationSettingsStore;
let browserSettingsStore: BrowserSettingsStore;
let computerUseSettingsStore: ComputerUseSettingsStore;
let computerUseGateway: ComputerUseMcpGateway;
let webChatListStore: WebChatListStore;
let sshBookmarkStore: SshBookmarkStore;
let notificationSettingsStore: NotificationSettingsStore;
let browserHost: BrowserHost | undefined;
let imageGenerationStore: ImageGenerationStore;
let imageGenerationGateway: ImageGenerationMcpGateway;
let imageViewGateway: ImageViewMcpGateway;
let imageDisplayStore: ImageDisplayStore;
let imageDisplayGateway: ImageDisplayMcpGateway;
let htmlHostStore: HtmlHostStore;
let htmlHostGateway: HtmlHostMcpGateway;
let integratedWebSearchGateway: IntegratedWebSearchMcpGateway;
let promptImageFileStore: PromptImageFileStore;

function requireBrowserHost(): BrowserHost {
  if (!browserHost) {
    throw new Error("BrowserHost is not initialized.");
  }
  return browserHost;
}

async function resolveCodexGlobalMcpServers() {
  const allEnabled = listEnabledGlobalMcpServerKeys(mcpStore.listServers());
  const configured = buildCodexMcpServersForConfigSync(mcpStore.listServers(), allEnabled);
  return prepareCodexGlobalMcpServerPool({
    configuredServers: configured,
    builtinServerResolvers: [
      () => requireBrowserHost().resolveGlobalAgentBrowserMcpServer(),
      () => computerUseGateway.resolveGlobalCodexServer(),
      () => imageGenerationGateway.resolveGlobalCodexServer(),
      () => imageViewGateway.resolveGlobalCodexServer(),
      () => imageDisplayGateway.resolveGlobalCodexServer(),
      async () => {
        if (!centerServerClient || !htmlHostGateway) {
          return undefined;
        }
        const capability = await centerServerClient.refreshHtmlHostingCapability();
        if (!capability.available) {
          return undefined;
        }
        return htmlHostGateway.resolveGlobalCodexServer();
      },
      () => integratedWebSearchGateway.resolveGlobalCodexServer(),
    ],
  });
}
let asrSettingsStore: AsrSettingsStore;
let packageScriptArgsStore: PackageScriptArgsStore;
let proxyBridgeSettingsStore: ProxyBridgeSettingsStore;
let integratedWebSearchSettingsStore: IntegratedWebSearchSettingsStore;
let centerServerClient: SupabaseCenterDesktopClient;
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

function runThreadRequestWithLiveRequestLifecycle(
  input: Omit<
    import("./thread-runtime-proxy-attempt.js").RunThreadRequestWithRuntimeProxyInput,
    "onAttemptSettled"
  > &
    Pick<
      Partial<import("./thread-runtime-proxy-attempt.js").RunThreadRequestWithRuntimeProxyInput>,
      "onAttemptSettled"
    >,
): Promise<ThreadRuntimeProxyResult> {
  return runThreadRequestWithRuntimeProxy({
    ...input,
    onAttemptSettled: (context) => {
      clearFinalizedLiveRequestsForAttempt(threadLiveRequestRegistry, context.threadId, context.runAttemptId);
      input.onAttemptSettled?.(context);
    },
  });
}

const pendingCancelDisposition = new Map<string, WorktreeCancelDisposition>();
const pendingEscalatedFollowUpDrain = new Set<string>();
const threadFollowUpDrainInFlight = new Set<string>();
const titleGeneratingThreadIds = new Set<string>();
const editingThreadFollowUpByThread = new Map<string, string>();
const threadFollowUpOperationLocks = new Map<string, Promise<void>>();

async function withThreadFollowUpLock<T>(threadId: string, fn: () => Promise<T> | T): Promise<T> {
  const previous = threadFollowUpOperationLocks.get(threadId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const current = previous.then(() => gate);
  threadFollowUpOperationLocks.set(threadId, current);
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (threadFollowUpOperationLocks.get(threadId) === current) {
      threadFollowUpOperationLocks.delete(threadId);
    }
  }
}

function editingFollowUpClaimExclusion(threadId: string): string | undefined {
  return editingThreadFollowUpByThread.get(threadId);
}
/** Live Claude Query mid-turn inject ports (one per running Eco-run). */
const claudeMidTurnPorts = new ClaudeMidTurnPortRegistry();
/** Live Codex turn mid-turn inject ports (main regular turn only). */
const codexMidTurnPorts = new CodexMidTurnPortRegistry();
/** Recent streaming_push follow-up ids per thread for interrupt still_queued reconcile. */
const recentStreamingPushFollowUpIds = new Map<string, Set<string>>();
/** Follow-ups that already inserted a local user bubble (mid-turn between turns). Skip drain re-record. */
const midTurnLocalUserPromptFollowUpIds = new Set<string>();
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
const pendingClaudeForksByThread = new Map<string, { sessionId: string; cwd: string }>();
const claudeUserMessageHydrationByThread = new Map<string, Promise<void>>();
const RUN_PROJECTION_EMIT_DEBOUNCE_MS = 500;
const RUN_PROJECTION_STREAMING_EMIT_MS = 250;
const sdkStreamBridge = new SdkStreamActivityBridge();
let sdkStreamActivityIngestion: SdkStreamActivityIngestion;
let threadRunEventLivePersister: ReturnType<typeof createThreadRunEventLivePersister>;
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
    cancelPlanApprovalsForThreadKeepPending(threadId, "cancelled by user");
  },
});
threadRuntimeCoordinator.register({
  kind: "codex",
  start: (input) => startCodexThreadRun({ ...input, continuation: false }),
  continue: startCodexThreadContinuation,
  cancel: (threadId) => {
    cancelClarificationsForThread(threadId, "cancelled by user");
    cancelBashApprovalsForThread(threadId, "cancelled by user");
    cancelPlanApprovalsForThreadKeepPending(threadId, "cancelled by user");
  },
});
threadRuntimeCoordinator.register({
  kind: "pi",
  start: (input) => void startPiThreadRunFromCoordinator(input),
  continue: startPiThreadContinuation,
  cancel: (threadId) => {
    void abortPiThread(threadId);
    activeRunRuntimeState.abortRun(threadId, "cancelled by user");
  },
});
threadRuntimeCoordinator.register({
  kind: "acp",
  start: (input) =>
    void startAcpThreadRun(
      toAcpThreadStartRunInput({
        thread: input.thread,
        workspace: input.workspace,
        prompt: resolveAcpRunPrompt({
          prompt: input.prompt,
          ...(input.attachments?.length ? { attachments: input.attachments } : {}),
        }),
        restorePrompt: input.prompt,
        ...(input.attachments?.length ? { attachments: input.attachments } : {}),
      }),
      acpRuntimeOrchestrationDeps(),
    ),
  continue: startAcpThreadContinuation,
  cancel: (threadId) => {
    cancelAcpThread(threadId);
    activeRunRuntimeState.abortRun(threadId, "cancelled by user");
  },
});

type SubagentDelegationLinker = (input: {
  agentId: string;
  agentType: string;
  parentToolUseId: string;
  prompt?: string;
  todoId?: string;
}) => void;
const subagentDelegationLinkersByThread = new Map<string, SubagentDelegationLinker>();

type AgentEventLike = Pick<AgentEvent, "id" | "type" | "payload" | "role" | "agentId" | "timestamp">;

function resolveRequestTerminalEventScope(input: { role: string; agentId?: string }): ThreadRunEventScope {
  if (input.agentId?.trim()) {
    return "agent";
  }
  return (SUBAGENT_ROLES as readonly string[]).includes(input.role) ? "agent" : "main";
}

function emitRequestTerminalUiEvent(
  threadId: string,
  input: {
    requestId: string;
    role: string;
    agentId?: string;
    stage: RequestTerminalStage;
    detail?: string;
    providerRequestId?: string;
  },
): void {
  const requestId = input.requestId.trim();
  if (!requestId || !conversationStore.getThread(threadId)) {
    return;
  }
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
        ...(input.providerRequestId && { providerRequestId: input.providerRequestId }),
      },
    });
    scheduleThreadRunProjectionUpdated(threadId);
  } catch (error) {
    process.stderr.write(`[eco] request terminal event write failed: ${errorMessage(error)}\n`);
  }
}

function emitRequestTerminalEvent(
  threadId: string,
  input: {
    requestId: string;
    role: string;
    agentId?: string;
    stage: RequestTerminalStage;
    detail?: string;
    providerRequestId?: string;
  },
): void {
  const requestId = input.requestId.trim();
  if (!requestId) {
    return;
  }
  emitRequestTerminalUiEvent(threadId, input);
  finalizeDisplayRequestTerminal(threadLiveRequestRegistry, threadId, requestId);
}

function startActiveRun(threadId: string, run: ActiveRunRuntimeStateInput): void {
  clearRequestStartedPersisted(threadId);
  activeRunRuntimeState.startRun(threadId, run);
  activeRunBillingState.startRun(threadId);
  getThreadSubagentConcurrencyGate(threadId).clear();
}

function finishActiveRun(threadId: string): void {
  clearThreadCancelling(threadId);
  for (const active of threadLiveRequestRegistry.listActive(threadId)) {
    if (active.emitTimelineActivity) {
      emitRequestTerminalEvent(threadId, {
        requestId: active.logicalRequestId,
        role: active.role,
        ...(active.agentId && { agentId: active.agentId }),
        ...(active.providerRequestId && { providerRequestId: active.providerRequestId }),
        stage: "cancelled",
      });
    } else {
      finalizeLiveRequest(threadLiveRequestRegistry, threadId, active.logicalRequestId);
    }
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
const windowsAreBooting = new WeakSet<BrowserWindow>();
const BOOT_WINDOW_OVERLAY_SYMBOL_COLOR = "rgba(0, 0, 0, 0)";
const WINDOWS_MICA_OVERLAY_COLOR = "rgba(0, 0, 0, 0)";

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
  const overlayColor =
    process.platform === "win32" && resolveWindowsMaterial()
      ? WINDOWS_MICA_OVERLAY_COLOR
      : windowsUseConversationTitlebar.get(window)
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

  window.setTitleBarOverlay({
    ...chrome.overlay,
    color: overlayColor,
    ...(windowsAreBooting.has(window) ? { symbolColor: BOOT_WINDOW_OVERLAY_SYMBOL_COLOR } : {}),
  });
}

function revealWindowControls(window: BrowserWindow): void {
  if (process.platform !== "win32" || window.isDestroyed()) {
    return;
  }
  windowsAreBooting.delete(window);
  window.setMinimizable(true);
  window.setMaximizable(true);
  window.setClosable(true);
  applyWindowControlsOverlay(window);
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
  const width = 1320;
  const height = 860;
  const { x, y } = resolveInitialWindowBounds(width, height);
  const windowOptions: BrowserWindowConstructorOptions = {
    x,
    y,
    width,
    height,
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
            // Keep native caption controls out of the Windows boot frame until
            // the renderer reports that its initial app state is ready.
            ...(isWindows
              ? {
                  minimizable: false,
                  maximizable: false,
                  closable: false,
                }
              : {}),
            titleBarStyle: "hidden" as const,
            titleBarOverlay: isWindows
              ? {
                  ...windowsChrome.overlay,
                  color: windowsMaterial ? WINDOWS_MICA_OVERLAY_COLOR : windowsChrome.overlay.color,
                  symbolColor: BOOT_WINDOW_OVERLAY_SYMBOL_COLOR,
                }
              : windowsChrome.overlay,
            ...(windowsMaterial ? { backgroundMaterial: windowsMaterial } : {}),
            backgroundColor: windowsBackdropVersion === "win10" ? windowsChrome.backgroundColor : "#00000000",
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
      webviewTag: true,
      ...(windowsBackdropVersion
        ? { additionalArguments: [`--eco-windows-backdrop=${windowsBackdropVersion}`] }
        : {}),
    },
  };
  const window = new BrowserWindow(windowOptions);
  if (isWindows) {
    windowsAreBooting.add(window);
  }

  if (app.isPackaged) {
    window.webContents.on("before-input-event", (event, input) => {
      if (isReloadShortcutInput(input)) {
        event.preventDefault();
      }
    });
  }

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalHttpUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  if (isDev) {
    try {
      await window.loadURL(process.env.VITE_DEV_SERVER_URL as string);
    } catch (error) {
      revealWindowControls(window);
      throw error;
    }
  } else {
    try {
      await window.loadFile(path.join(__dirname, "../renderer/index.html"));
    } catch (error) {
      revealWindowControls(window);
      throw error;
    }
  }
  if (browserHost) {
    installBrowserGuestBridge(window, browserHost);
  }
  attachMainWindowQuitGuard(window);
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
  const isLocalRendererWebContents = (webContents: Electron.WebContents | null): boolean => {
    if (!webContents) {
      return false;
    }
    try {
      return isLocalRendererUrl(webContents.getURL());
    } catch {
      return false;
    }
  };
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const mediaTypes = (details as { mediaTypes?: string[] }).mediaTypes;
    callback(isAllowedSessionPermission(isLocalRendererWebContents(webContents), permission, mediaTypes));
  });
  session.defaultSession.setPermissionCheckHandler((webContents, permission, _requestingOrigin, details) => {
    const mediaType = (details as { mediaType?: string }).mediaType;
    return isAllowedSessionPermission(
      isLocalRendererWebContents(webContents),
      permission,
      mediaType ? [mediaType] : undefined,
    );
  });
  const dbPath = path.join(app.getPath("userData"), "eco-coding.sqlite");
  providerStore = await createProviderStore(dbPath);
  agentOrchestrationStore = await createAgentOrchestrationStore(dbPath);
  mcpStore = await createMcpStore(dbPath);
  conversationStore = await createConversationStore(dbPath);
  conversationStore.onThreadRunEventAppended(maintainThreadFeedSkeletonFromEvent);
  promptImageFileStore = new PromptImageFileStore(app.getPath("userData"));
  conversationStore.setPromptImageFileStore(promptImageFileStore);
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
  await reconcileAcpCursorAgainstProbe();
  projectMcpSettingsStore = await createProjectMcpSettingsStore(dbPath);
  projectIntegrationsSettingsStore = await createProjectIntegrationsSettingsStore(dbPath);
  projectOrchestrationSettingsStore = await createProjectOrchestrationSettingsStore(dbPath);
  projectSkillsSettingsStore = await createProjectSkillsSettingsStore(dbPath);
  gitSettingsStore = await createGitSettingsStore(dbPath);
  personalizationSettingsStore = await createPersonalizationSettingsStore(dbPath);
  browserSettingsStore = await createBrowserSettingsStore(dbPath);
  computerUseSettingsStore = await createComputerUseSettingsStore(dbPath);
  computerUseGateway = new ComputerUseMcpGateway(() => computerUseSettingsStore.get());
  webChatListStore = await createWebChatListStore(dbPath);
  sshBookmarkStore = await createSshBookmarkStore(dbPath, createLocalSecretCodec());
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
    broadcastAgentPresence: (event) => {
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send(IPC_CHANNELS.browserAgentPresence, event);
        }
      });
    },
    resolveWorkspacePath: (threadId) => conversationStore.getThread(threadId)?.workspacePath,
  });
  const imageSecretCodec: ImageGenerationSecretCodec = {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (value) => `safe-v1:${safeStorage.encryptString(value).toString("base64")}`,
    decrypt: (value) => {
      if (!value.startsWith("safe-v1:")) throw new Error("创意绘画 API Key 存储格式无效。");
      return safeStorage.decryptString(Buffer.from(value.slice("safe-v1:".length), "base64"));
    },
  };
  imageGenerationStore = await createImageGenerationStore(dbPath, imageSecretCodec);
  imageGenerationGateway = new ImageGenerationMcpGateway({
    store: imageGenerationStore,
    resolveWorkspacePath: (threadId) => conversationStore.getThread(threadId)?.workspacePath,
    resolveGenerationRoot: (threadId) =>
      activeRunRuntimeState.worktreePlan(threadId)?.worktreePath ??
      conversationStore.getThread(threadId)?.sdkCwd ??
      conversationStore.getThread(threadId)?.workspacePath,
    onArtifactChanged: (artifact) => {
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed())
          window.webContents.send(IPC_CHANNELS.imageGenerationArtifactChanged, artifact);
      });
    },
  });
  imageViewGateway = new ImageViewMcpGateway({
    analyze: async ({ threadId, path: imagePath, question }) => {
      const file = await readImageViewFile(imagePath);
      const attachments: PromptImageAttachment[] = [{ mediaType: file.mimeType, data: file.dataBase64 }];
      const agentId = `vision:${threadId}:${randomUUID()}`;
      const runAttemptId = agentLifecycle.currentRunAttemptId(threadId);
      return runVisionAnalysis(
        {
          threadId,
          prompt: question?.trim() || `Analyze the local image at ${imagePath}.`,
          attachments,
          billingAgentId: agentId,
          emitSubagentLifecycle: false,
          ...(runAttemptId ? { runAttemptId } : {}),
        },
        createThreadVisionAnalysisHost(runAttemptId),
      );
    },
  });
  imageDisplayStore = await createImageDisplayStore(
    dbPath,
    path.join(app.getPath("userData"), "image-display"),
  );
  imageDisplayGateway = new ImageDisplayMcpGateway({
    store: imageDisplayStore,
    onArtifactChanged: (artifact) => {
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send(IPC_CHANNELS.imageDisplayArtifactChanged, artifact);
        }
      });
    },
  });
  htmlHostStore = new HtmlHostStore();
  htmlHostGateway = new HtmlHostMcpGateway({
    store: htmlHostStore,
    api: {
      probeCapability: () => centerServerClient.refreshHtmlHostingCapability({ force: true }),
      publish: (input) => centerServerClient.publishHtmlPage(input),
    },
    getCapability: () => centerServerClient.refreshHtmlHostingCapability(),
    onArtifactChanged: (artifact) => {
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send(IPC_CHANNELS.htmlHostArtifactChanged, artifact);
        }
      });
    },
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
  await packageScriptArgsStore.warmCache();
  proxyBridgeSettingsStore = await createProxyBridgeSettingsStore(dbPath);
  const integratedWebSearchSecretCodec = {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (value: string) => `safe-v1:${safeStorage.encryptString(value).toString("base64")}`,
    decrypt: (value: string) => {
      if (!value.startsWith("safe-v1:")) {
        throw new Error("Integrated Web Search API key is stored in an unsupported format.");
      }
      return safeStorage.decryptString(Buffer.from(value.slice("safe-v1:".length), "base64"));
    },
  };
  integratedWebSearchSettingsStore = await createIntegratedWebSearchSettingsStore(
    dbPath,
    integratedWebSearchSecretCodec,
  );
  integratedWebSearchGateway = new IntegratedWebSearchMcpGateway({
    store: integratedWebSearchSettingsStore,
    getApiKey: () => integratedWebSearchSettingsStore.getApiKey() ?? undefined,
  });
  const centerServerSecretCodec = createElectronSafeStorageCenterServerSecretCodec(safeStorage);
  centerServerClient = new SupabaseCenterDesktopClient({
    store: await createCenterServerStore(dbPath, {
      ...(centerServerSecretCodec ? { secretCodec: centerServerSecretCodec } : {}),
    }),
    eventCenter: desktopEventCenter,
    log: (message) => process.stderr.write(message),
    onStatusChange: emitCenterServerStatus,
  });
  centerServerClient.setSettingsSyncHooks(
    createDesktopSettingsSyncHooks({
      providerStore,
      asrSettingsStore,
      imageGenerationStore,
      workflowSettingsStore,
      agentOrchestrationStore,
      proxyBridgeSettingsStore,
      integratedWebSearchSettingsStore,
      gitSettingsStore,
      packageScriptArgsStore,
      projectOrchestrationSettingsStore,
      sshBookmarkStore,
    }),
  );
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
    getUpstreamUserAgent: () => resolveUpstreamUserAgentOverride(proxyBridgeSettingsStore.get()),
    getUpstreamProxyUrl: () => {
      const raw = proxyBridgeSettingsStore.get().upstreamProxyUrl?.trim();
      return raw || undefined;
    },
    getTurnRouteRegistry: () => getCodexTurnRouteRegistry(),
    resolveEcoThreadIdFromCodex: (codexThreadId) => codexThreadMap.getEcoThreadId(codexThreadId),
    prepareClaudeMessages: async ({ path, body, model, headers }) => {
      const { prepareClaudeBridgeMessagesRequest } = await import("./anthropic-proxy");
      return prepareClaudeBridgeMessagesRequest({
        path,
        body,
        requestedModel: model,
        headers,
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
        // Synchronously reserve settle before any await so proxy.close() cannot race past billing.
        const releaseUsageSettle = globalClaudeBridgeBindingRegistry.reserveUsageSettle(
          event.bridgeBindingId,
        );
        try {
          const binding = event.bridgeBindingId?.trim()
            ? globalClaudeBridgeBindingRegistry.getByBindingId(event.bridgeBindingId)
            : undefined;
          const stampThreadId = event.threadId?.trim() || binding?.threadId?.trim();
          const logicalRequestId = event.logicalRequestId?.trim();
          const frozen =
            stampThreadId && logicalRequestId
              ? resolveFrozenLiveRequestAttribution(
                  threadLiveRequestRegistry,
                  stampThreadId,
                  logicalRequestId,
                )
              : undefined;
          const stampedAgentId = frozen?.agentId?.trim();
          const stampedBillingRole = frozen?.role?.trim() as RuntimeAgentRole | undefined;
          const handled = await emitClaudeGatewayUsageIfSession({
            providerId: event.providerId,
            requestedModel: event.requestedModel,
            upstreamModelId: event.upstreamModelId,
            usage: event.usage,
            ...(event.providerRequestId ? { requestId: event.providerRequestId } : {}),
            ...(event.bridgeBindingId ? { bridgeBindingId: event.bridgeBindingId } : {}),
            ...(logicalRequestId ? { logicalRequestId } : {}),
            ...(event.ttftMs !== undefined && { ttftMs: event.ttftMs }),
            ...(event.generationMs !== undefined && { generationMs: event.generationMs }),
            ...(stampedAgentId ? { stampedAgentId } : {}),
            ...(stampedBillingRole ? { stampedBillingRole } : {}),
          });
          if (!handled) {
            // Title/approval/aux or closed binding — do not fall into Codex turn billing.
            logEcoDiag("messages.usage_unattributed", {
              providerId: event.providerId,
              requestedModel: event.requestedModel,
              upstreamModelId: event.upstreamModelId,
              sourceEventId: event.sourceEventId,
              reason: "no_claude_bridge_binding_or_route",
            });
            process.stderr.write(
              `[eco] messages usage not billed: no Claude bridge binding route ` +
                `provider=${event.providerId} model=${event.upstreamModelId || event.requestedModel}\n`,
            );
          }
        } finally {
          releaseUsageSettle?.();
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
    onRequestLifecycle: (event) => {
      handleGatewayRequestLifecycleEvent(event, {
        onUpstreamRequestId: ({ threadId, role, requestId, logicalRequestId }) => {
          adoptLiveProviderRequestId(threadId, logicalRequestId, requestId);
        },
        onUpstreamConnectionError: (input) => {
          emitUpstreamConnectionErrorActivity(input);
        },
        onLogicalCompleted: ({ threadId, role, logicalRequestId }) => {
          emitLogicalRequestTerminal(threadId, role, logicalRequestId, "completed");
        },
        onLogicalFailed: ({ threadId, role, error, statusCode, logicalRequestId }) => {
          const detail = statusCode ? `HTTP ${statusCode}` : error;
          emitLogicalRequestTerminal(threadId, role, logicalRequestId, "failed", detail);
        },
        onLogicalCancelled: ({ threadId, role, reason, logicalRequestId }) => {
          emitLogicalRequestTerminal(threadId, role, logicalRequestId, "cancelled", reason);
        },
      });
    },
    onStderr: (chunk) => process.stderr.write(chunk.endsWith("\n") ? chunk : `${chunk}\n`),
  });
  configureCodexRuntimeRun({
    ecoDataDir: app.getPath("userData"),
    getGlobalUserRules: () => personalizationSettingsStore.get().globalRules,
    getGlobalContextWindowLimit: () => workflowSettingsStore.get().contextWindowLimitTokens,
    enrichCatalogRoutes: async (routes) => {
      const providers = providerStore.listProviders();
      const byId = new Map(providers.map((provider) => [provider.id, provider]));
      const enriched: CodexGatewayCatalogRoute[] = [];
      for (const route of routes) {
        if (typeof route.manualSpec?.contextTokens === "number" && route.manualSpec.contextTokens > 0) {
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
    listGlobalMcpServers: resolveCodexGlobalMcpServers,
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
    captureRecoveryBeforeCodexFork: async (threadId) => {
      const worktreePath = resolveThreadWorktreePath(threadId);
      if (!worktreePath) throw new Error("Codex rewind has no persisted worktree path for recovery.");
      const recoveryId = `codex-rewind-${randomUUID()}`;
      await codexFileCheckpointStore.captureRecovery(threadId, worktreePath, recoveryId);
      return recoveryId;
    },
    restoreRecoveryAfterCodexFork: async (threadId, recoveryId) => {
      const worktreePath = resolveThreadWorktreePath(threadId);
      if (!worktreePath) throw new Error("Codex rewind has no persisted worktree path for recovery restore.");
      await codexFileCheckpointStore.restoreRecovery(threadId, worktreePath, recoveryId);
    },
    deleteRecoveryAfterCodexFork: (threadId, recoveryId) =>
      codexFileCheckpointStore.deleteRecovery(threadId, recoveryId),
    resolveCodexForkTurnIndex: (threadId, itemId) =>
      conversationStore.resolveCodexUserTurnIndex(threadId, itemId),
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
    onCodexTurnPlanUpdated: ({ ecoThreadId, plan }) => {
      if (!conversationStore.getThread(ecoThreadId)) {
        process.stderr.write(`[eco-codex] turn/plan/updated references unknown Eco thread ${ecoThreadId}\n`);
        return;
      }
      applyCodexTurnPlanProgress({
        threadId: ecoThreadId,
        plan,
        services: {
          listTodos: (threadId) => conversationStore.listCoderTodos(threadId),
          replaceTodos: (threadId, todos) => conversationStore.replaceCoderTodos(threadId, todos),
          emitTodoList,
        },
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
        awaitingPlanMessage: "",
      });
      updateThread(ecoThreadId, {
        status: "awaiting_plan",
        message: "",
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
        ? (ensureThreadRuntimeConfig(thread).runtimeConfig?.bashReviewMode ?? "always")
        : "always";
    },
    getBrowserOpenApprovalMode: () => browserSettingsStore.get().openApprovalMode,
    getComputerUseActionApprovalMode: () => computerUseSettingsStore.get().actionApprovalMode,
    noteUpcomingImageGenerationTool: (threadId, toolName, toolUseId) => {
      imageGenerationGateway.noteUpcomingTool(threadId, toolName, toolUseId);
    },
    reviewApproval: (threadId, request, tool) => reviewThreadToolApproval(threadId, request, tool, "codex"),
    injectCodexApprovalFeedback: async ({ ecoThreadId, codexThreadId, turnId, toolUseId, text }) => {
      const phase = codexMidTurnPorts.getPhase(ecoThreadId);
      if (phase === "accepting") {
        const pushed = await codexMidTurnPorts.tryPushUserText(ecoThreadId, text, {
          clientUserMessageId: `approval-feedback:${toolUseId}`,
        });
        if (!pushed.ok) {
          throw new Error(`Codex approval feedback was not delivered: ${pushed.reason}`);
        }
        return;
      }
      if (phase === "closing" || phase === "closed") {
        throw new Error(`Codex approval feedback arrived after turn ingress closed (${phase}).`);
      }
      const client = getGlobalCodexRuntimeLifecycle()?.getClient();
      if (!client) {
        throw new Error("Codex approval feedback cannot be delivered because Codex is not running.");
      }
      await steerCodexTurn(client, {
        threadId: codexThreadId,
        turnId,
        input: [{ type: "text", text }],
        clientUserMessageId: `approval-feedback:${toolUseId}`,
      });
    },
    getRoutesJson: (threadId) => JSON.stringify(resolveRoleRoutesForThread(threadId)),
    savePendingPlan: (plan) => conversationStore.savePendingPlan(plan),
    emitThreadLive: (event) => {
      if (event.type.startsWith("clarification.")) {
        const clarificationToolUseId =
          event.clarification?.toolUseId?.trim() || event.tool?.toolUseId?.trim();
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
  contextScheduler = new ContextSnapshotScheduler({
    monitor: contextMonitor,
    emitContext: emitThreadContextUpdated,
  });
  contextLifecycle = createContextLifecycleService({
    monitor: contextMonitor,
    emitLiveContext: (threadId) => contextScheduler.emitLiveFromMonitor(threadId),
    applySdkContextUsageBreakdown: (threadId, payload) => {
      contextScheduler.applySdkContextUsageBreakdown(threadId, payload);
    },
    recordCompactionBoundary: (threadId, payload) => {
      const postTokens = extractCompactPostTokens(payload);
      emitContextCompactionStatus(threadId, {
        stage: "completed",
        trigger: "auto",
        ...(postTokens !== undefined && { postTokens }),
      });
    },
  });
  initializeSdkStreamActivityPipeline();
  loadThreadMetricsFromStore();
  recoverOrphanedRunningThreads();
  currentWorkspace = await ensureHomeProject();
  initializeGitAutoFetcher();
  registerIpcHandlers();
  if (centerServerClient.getSnapshot().settings.enabled) {
    void centerServerClient.start();
  }
  await createMainWindow();
  desktopUpdateService.start();
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
    void centerServerClient?.recoverAfterIdle("focus");
  });
  app.on("browser-window-blur", () => {
    gitAutoFetcher?.setWindowFocused(false);
  });

  powerMonitor.on("resume", () => {
    void centerServerClient?.recoverAfterIdle("resume");
  });
  powerMonitor.on("unlock-screen", () => {
    void centerServerClient?.recoverAfterIdle("unlock-screen");
  });

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  // Main-window close already runs full shutdownApplication (stops eco-gateway).
  // Always quit so macOS does not leave a dock-resident process with globalGateway cleared —
  // otherwise activate → new window → Codex/Claude hits "lifecycle is not configured".
  app.quit();
});

installApplicationShutdownHook({
  locale: currentAppLocale,
  listThreads: () => conversationStore.listThreads(),
  hasActiveRun: (threadId) => activeRunRuntimeState.hasRun(threadId),
  isCompactInFlight: (threadId) => contextMonitor?.isCompactInFlight(threadId) ?? false,
  countRunningBackgroundTasks: () => backgroundTerminalTaskRegistry.countRunning(),
  cancelThreadRuntime: async (coreKind, threadId) => {
    await threadRuntimeCoordinator.cancel(coreKind, threadId);
  },
  abortActiveRun: (threadId, reason) => activeRunRuntimeState.abortRun(threadId, reason),
  finishActiveRun,
  cancelClarifications: cancelClarificationsForThread,
  cancelBashApprovals: cancelBashApprovalsForThread,
  cancelPlanApprovals: cancelPlanApprovalsForThreadKeepPending,
  settleRecoveredLifecycleRecords,
  getPendingPlan: (threadId) => conversationStore.getPendingPlan(threadId),
  updateThreadOnQuit: (threadId, patch) => {
    updateThread(threadId, patch);
  },
  emitThreadQuitEvent: (threadId, type, message) => {
    if (type === "thread.awaiting_plan") {
      const pendingPlan = conversationStore.getPendingPlan(threadId);
      emitThreadEvent(threadId, type, message, "system", false, {
        plan: pendingPlan
          ? {
              userPrompt: pendingPlan.userPrompt,
              analysis: pendingPlan.analysis,
              plan: pendingPlan.plan,
            }
          : undefined,
      });
      return;
    }
    emitThreadEvent(threadId, type, message, "system");
  },
  stopAllBackgroundTasks: () => {
    backgroundTerminalTaskRegistry.stopAllRunning();
  },
  killAllInteractiveTerminals: () => {
    interactiveTerminalManager.killAll();
  },
  disposeBrowserHost: () => {
    browserHost?.dispose();
    void computerUseGateway?.close();
  },
  closeImageGenerationGateway: async () => {
    await imageGenerationGateway?.close();
  },
  closeImageViewGateway: async () => {
    await imageViewGateway?.close();
  },
  closeImageDisplayGateway: async () => {
    await imageDisplayGateway?.close();
    await htmlHostGateway?.close();
  },
  closeIntegratedWebSearchGateway: async () => {
    await integratedWebSearchGateway?.close();
  },
  stopGlobalCodexRuntime: () => stopGlobalCodexRuntimeLifecycle(),
  stopAllAcpRuntimes,
  stopGlobalEcoGateway: () => stopGlobalEcoGateway(),
  disposeDesktopUpdateService: () => {
    desktopUpdateService.dispose();
  },
  clearCodexSubagentRuntimeLimit: () => {
    codexSubagentRuntimeLimit.clear();
  },
  flushAllThreadMetrics: () => {
    flushAllThreadMetrics();
  },
  disposeCodexGatewayUsagePending: () => {
    codexGatewayUsagePending.dispose();
  },
  clearCodexGatewayUsageDeduplicator: () => {
    codexGatewayUsageDeduplicator.clear();
  },
  disposeGitAutoFetcher: () => {
    gitAutoFetcher?.dispose();
  },
  disposeCenterServerClient: () => {
    centerServerClient?.dispose();
  },
  parentWindow: () => BrowserWindow.getAllWindows()[0],
  logError: (error) => {
    process.stderr.write(
      `[eco] application shutdown failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  },
});

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
      ? providerStore.listCandidateModels(providerId).find((model) => model.id === ref.candidateModelId)
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

function resolveContinueThreadRuntimeConfig(
  settings: ModelSettingsSnapshot,
  existing: ThreadRuntimeConfig | undefined,
  incoming: ThreadRuntimeConfig,
): ThreadRuntimeConfig {
  if (!shouldRematerializeThreadRuntimeConfigOnContinue(existing, incoming)) {
    return lockThreadRuntimeConfigSnapshotOnContinue(existing!, incoming);
  }
  return materializeThreadRuntimeConfig(settings, incoming);
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
  if (!activityLineId) {
    throw new Error("Invalid rewind target.");
  }
  return {
    activityLineId,
    ...(userMessageId ? { userMessageId } : {}),
  };
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
  const visionSelection = thread ? ensureThreadRuntimeConfig(thread).runtimeConfig?.visionModel : undefined;
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
  remoteHandler?: (...args: Args) => Result | Promise<Result>,
): void {
  const invokeLocal = async (...args: Args): Promise<Result> => {
    try {
      return await handler(...args);
    } catch (error) {
      throw localizeExpectedIpcError(error);
    }
  };
  const remote = remoteHandler ?? handler;
  const invokeRemote = async (...args: Args): Promise<Result> => {
    try {
      return await remote(...args);
    } catch (error) {
      throw localizeExpectedIpcError(error);
    }
  };
  if (isRemoteCommandChannel(channel)) {
    desktopEventCenter.registerCommand(channel, (args) => invokeRemote(...(args as Args)));
  }
  ipcMain.handle(channel, async (_event, ...args: unknown[]) => invokeLocal(...(args as Args)));
}

function resolveImageGenerationArtifactImage(payload: unknown): {
  image: ImageGenerationArtifact["images"][number];
  resolvedPath: string;
} {
  if (!isRecord(payload) || typeof payload.artifactId !== "string" || !Number.isInteger(payload.imageIndex)) {
    throw new Error("图片产物参数无效。");
  }
  const artifact = imageGenerationStore.getArtifact(payload.artifactId);
  const image = artifact.images[payload.imageIndex as number];
  if (!image) throw new Error("图片产物索引不存在。");
  const candidates = [image.absolutePath, path.resolve(artifact.workspacePath, image.relativePath)];
  const resolvedPath = candidates.find((candidate) => existsSync(candidate));
  if (!resolvedPath) throw new Error("图片文件已不存在。");
  return { image, resolvedPath };
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

/**
 * Env for the Cursor ACP child. When the user configured a Cursor API key
 * (headless / no browser login), inject CURSOR_API_KEY; merged over
 * process.env so HOME/PATH-based executable resolution still works.
 */
function acpCursorSpawnEnv(): NodeJS.ProcessEnv | undefined {
  const apiKey = workflowSettingsStore.get().acpCursorApiKey?.trim();
  if (!apiKey) return undefined;
  return { ...process.env, CURSOR_API_KEY: apiKey };
}

async function probeAcpCursorForMain(): Promise<AcpCursorProbeResult> {
  const env = acpCursorSpawnEnv();
  return probeAcpCursorAvailability({
    resolveExecutable: () => resolveCursorAgentExecutable(),
    executableExists: (candidate) => existsSync(candidate),
    handshake: () => handshakeAcpCursor(env ? { env } : {}),
  });
}

function acpCursorUnavailableMessage(probe: AcpCursorProbeResult): string {
  if (probe.available) {
    return mainText("native.cursorUnavailable");
  }
  if (probe.reasonKey === "handshakeFailed") {
    const detail = probe.detail?.trim() ? `: ${probe.detail.trim()}` : "";
    return mainText("native.cursorModelsUnavailable", { detail });
  }
  return mainText("native.cursorUnavailable");
}

async function assertAcpCursorRunnableForMain(): Promise<void> {
  const probe = await probeAcpCursorForMain();
  assertAcpCursorRunnable({
    probe,
    unavailableMessage: acpCursorUnavailableMessage(probe),
  });
}

async function reconcileAcpCursorAgainstProbe(probe?: AcpCursorProbeResult): Promise<void> {
  const current = workflowSettingsStore.get();
  const resolved = probe ?? (await probeAcpCursorForMain());
  if (resolved.available) {
    return;
  }
  const shouldClear = current.acpAgentsEnabled?.cursor === true || current.defaultCoreKind === "acp";
  if (!shouldClear) {
    return;
  }
  const patch = reconcileAcpCursorEnabled(
    definedProps({
      acpCursorEnabled: true,
      defaultCoreKind: current.defaultCoreKind,
      probe: resolved,
    }),
  );
  if (!patch) {
    return;
  }
  const next: typeof current = {
    ...current,
    ...(patch.defaultCoreKind !== undefined ? { defaultCoreKind: patch.defaultCoreKind } : {}),
  };
  delete next.acpAgentsEnabled;
  if (patch.defaultCoreKind === "claude") {
    delete next.defaultAcpAgentId;
  }
  workflowSettingsStore.save(next);
}

function localizeExpectedIpcError(error: unknown): unknown {
  if (!(error instanceof Error)) {
    return error;
  }
  const message = error.message.trim();
  const key = expectedIpcErrorKey(message);
  if (!key) {
    return error;
  }
  if (key === "native.acpSessionDeleteFailed") {
    const prefix = "ACP session/delete 失败：";
    const detail = message.startsWith(prefix) ? message.slice(prefix.length) : message;
    return new Error(mainText(key, { detail }));
  }
  return new Error(mainText(key));
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
  registerDesktopCommand(IPC_CHANNELS.cursorModelsList, async () => {
    const apiKey = workflowSettingsStore.get().acpCursorApiKey?.trim();
    return listCursorAgentModels(apiKey ? { env: { CURSOR_API_KEY: apiKey } } : {});
  });

  registerDesktopCommand(IPC_CHANNELS.coreAvailabilityGet, async () => {
    const codexAvailable = isCodexCliAvailable();
    const pi = await probePiCoreAvailability();
    const cursorProbe = await probeAcpCursorForMain();
    if (!cursorProbe.available) {
      await reconcileAcpCursorAgainstProbe(cursorProbe);
    }
    const [codexVersion, claudeVersion, cursorVersion] = await Promise.all([
      getCodexVersion(),
      getClaudeVersion(),
      getCursorVersion(),
    ]);
    return {
      claude: { available: true as const, ...(claudeVersion && { version: claudeVersion }) },
      codex: {
        available: codexAvailable,
        ...(!codexAvailable && {
          reason: mainText("native.codexUnavailable"),
        }),
        ...(codexVersion && { version: codexVersion }),
      },
      pi: {
        available: pi.available,
        ...(!pi.available && pi.reason
          ? { reason: pi.reason }
          : !pi.available
            ? { reason: mainText("native.piUnavailable") }
            : {}),
        ...(pi.version && { version: pi.version }),
      },
      cursor: {
        available: cursorProbe.available,
        ...(!cursorProbe.available && {
          reason: acpCursorUnavailableMessage(cursorProbe),
        }),
        ...(cursorVersion && { version: cursorVersion }),
      },
    };
  });

  ipcMain.handle(IPC_CHANNELS.appRendererReady, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      throw new Error("Renderer ready notification came from an unknown window.");
    }
    revealWindowControls(window);
    return { ok: true as const };
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

  registerDesktopCommand(IPC_CHANNELS.appUpdateGetState, async () => desktopUpdateService.getState());

  registerDesktopCommand(IPC_CHANNELS.appUpdateCheck, async () => desktopUpdateService.checkForUpdates());

  registerDesktopCommand(IPC_CHANNELS.appUpdateDownload, async () => desktopUpdateService.downloadUpdate());

  registerDesktopCommand(IPC_CHANNELS.appUpdateInstall, async () => desktopUpdateService.installUpdate());

  registerDesktopCommand(IPC_CHANNELS.appUpdateOpenRelease, async () =>
    desktopUpdateService.openReleasePage(),
  );

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
    const content = buildThreadClarificationNotificationContent(thread, clarification, currentAppLocale());
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
    return listWorkspaceEntries({
      workspacePath: request.workspacePath,
      directoryPath: request.directoryPath,
    });
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

  registerDesktopCommand(IPC_CHANNELS.workspaceOpenInFileManager, async (workspacePath: unknown) => {
    if (typeof workspacePath !== "string" || !workspacePath.trim()) {
      throw new Error("Workspace path is required.");
    }
    const resolvedPath = path.resolve(workspacePath.trim());
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(resolvedPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error("找不到该项目目录。");
      }
      throw error;
    }
    if (!stat.isDirectory()) {
      throw new Error("请选择文件夹，而不是文件。");
    }
    const openError = await shell.openPath(resolvedPath);
    if (openError) {
      throw new Error(openError);
    }
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
    attachThreadListCancelling(conversationStore.listThreads()),
  );

  registerDesktopCommand(IPC_CHANNELS.threadListInitial, async () => {
    const result = conversationStore.listInitialThreads(REMOTE_THREAD_LIST_INITIAL_LIMIT_PER_WORKSPACE);
    return {
      ...result,
      threads: attachThreadListCancelling(result.threads),
    };
  });

  registerDesktopCommand(IPC_CHANNELS.threadListMore, async (payload: unknown) => {
    if (!isRecord(payload) || typeof payload.workspacePath !== "string" || !isRecord(payload.cursor)) {
      throw new Error("Invalid thread list page request.");
    }
    const cursor = payload.cursor;
    if (
      typeof cursor.updatedAt !== "string" ||
      typeof cursor.createdAt !== "string" ||
      typeof cursor.id !== "string"
    ) {
      throw new Error("Invalid thread list page cursor.");
    }
    const limit = typeof payload.limit === "number" && Number.isFinite(payload.limit) ? payload.limit : 20;
    const page = conversationStore.listThreadPage(
      payload.workspacePath,
      { updatedAt: cursor.updatedAt, createdAt: cursor.createdAt, id: cursor.id } satisfies ThreadListCursor,
      limit,
    );
    return { ...page, threads: attachThreadListCancelling(page.threads) };
  });

  registerDesktopCommand(IPC_CHANNELS.threadGet, async (threadId: unknown) => {
    const id = typeof threadId === "string" ? threadId.trim() : "";
    if (!id) {
      return undefined;
    }
    const thread = conversationStore.getThread(id);
    return thread ? attachThreadCancelling(ensureThreadRuntimeConfig(thread)) : undefined;
  });

  registerDesktopCommand(IPC_CHANNELS.composerDraftGet, async (contextKey: unknown) => {
    const draft = conversationStore.getComposerDraft(parseComposerDraftContextKey(contextKey));
    if (!draft?.attachments?.length) {
      return draft;
    }
    const attachments = await Promise.all(
      draft.attachments.map(async (attachment) => {
        if (attachment.data?.trim()) {
          return attachment;
        }
        if (!attachment.path?.trim()) {
          return attachment;
        }
        return {
          mediaType: attachment.mediaType,
          path: attachment.path,
          data: await promptImageFileStore.readAttachmentData(attachment),
        };
      }),
    );
    return {
      ...draft,
      attachments,
    };
  });

  registerDesktopCommand(IPC_CHANNELS.composerDraftSave, async (payload: unknown) => {
    if (!payload || typeof payload !== "object") {
      throw new Error("Invalid composer draft save request.");
    }
    const record = payload as {
      contextKey?: unknown;
      prompt?: unknown;
      attachments?: unknown;
      recoveryReason?: unknown;
    };
    if (typeof record.prompt !== "string") {
      throw new Error("Composer draft prompt must be a string.");
    }
    const contextKey = parseComposerDraftContextKey(record.contextKey);
    const attachments = await normalizeComposerDraftAttachments(
      contextKey,
      parsePromptImageAttachments(record.attachments),
    );
    return conversationStore.saveComposerDraft(
      contextKey,
      record.prompt,
      attachments,
      typeof record.recoveryReason === "string" ? record.recoveryReason : undefined,
    );
  });

  registerDesktopCommand(IPC_CHANNELS.composerDraftDelete, async (payload: unknown) => {
    if (typeof payload === "string") {
      return {
        ok: true as const,
        deleted: conversationStore.deleteComposerDraft(parseComposerDraftContextKey(payload)),
      };
    }
    if (!payload || typeof payload !== "object") {
      throw new Error("Invalid composer draft delete request.");
    }
    const record = payload as {
      contextKey?: unknown;
      expectedRevision?: unknown;
      releaseAttachments?: unknown;
    };
    const expectedRevision =
      typeof record.expectedRevision === "string" && record.expectedRevision.trim()
        ? record.expectedRevision.trim()
        : undefined;
    const releaseAttachments =
      record.releaseAttachments === false ? { releaseAttachments: false as const } : undefined;
    return {
      ok: true as const,
      deleted: conversationStore.deleteComposerDraft(
        parseComposerDraftContextKey(record.contextKey),
        expectedRevision,
        releaseAttachments,
      ),
    };
  });

  registerDesktopCommand(IPC_CHANNELS.promptImageStage, async (payload: unknown) => {
    if (!payload || typeof payload !== "object") {
      throw new Error("Invalid prompt image stage request.");
    }
    const record = payload as {
      contextKey?: unknown;
      imageId?: unknown;
      mediaType?: unknown;
      data?: unknown;
    };
    const contextKey = parseComposerDraftContextKey(record.contextKey);
    const imageId = typeof record.imageId === "string" ? record.imageId.trim() : "";
    if (!imageId) {
      throw new Error("Prompt image id is required.");
    }
    if (!isPromptImageMediaType(record.mediaType)) {
      throw new Error("Unsupported image attachment media type.");
    }
    const data = typeof record.data === "string" ? record.data.trim() : "";
    if (!data) {
      throw new Error("Image attachment data is required.");
    }
    return promptImageFileStore.stageComposerImage({
      contextKey,
      imageId,
      mediaType: record.mediaType,
      dataBase64: data,
    });
  });

  registerDesktopCommand(IPC_CHANNELS.promptImageRelease, async (payload: unknown) => {
    if (!payload || typeof payload !== "object") {
      throw new Error("Invalid prompt image release request.");
    }
    const record = payload as { paths?: unknown };
    const paths = Array.isArray(record.paths)
      ? record.paths.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : [];
    await promptImageFileStore.releasePaths(paths);
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
    emitThreadEvent(threadId, "thread.deleted", "对话已删除。", "system", false, {
      workspacePath: thread.workspacePath,
    });
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
    if (coreOwnsSessionTitle(thread.coreKind)) {
      return { ok: true as const, regenerated: false };
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
      const busy = resolveBusyThreadRuntimeConfigUpdate({ existing, incoming });
      if (busy.kind === "blocked") {
        throw new Error("请等待当前运行结束后再修改配置。");
      }
      runtimeConfig = busy.runtimeConfig;
    } else if (thread.coreKind === "acp") {
      runtimeConfig = normalizeThreadRuntimeConfig(incoming);
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
    if (thread.coreKind === "pi") {
      assertPiSkillsConfigReloadAllowed(thread.status, existing?.skillsEnabled, runtimeConfig.skillsEnabled);
    }
    if (thread.coreKind === "acp") {
      conversationStore.saveThreadRuntimeConfig(threadId, runtimeConfig);
      const updatedThread = ensureThreadRuntimeConfig(conversationStore.getThread(threadId) ?? thread);
      const configChanged =
        !existing ||
        JSON.stringify(normalizeThreadRuntimeConfig(existing)) !==
          JSON.stringify(normalizeThreadRuntimeConfig(runtimeConfig));
      if (configChanged) {
        emitThreadEvent(threadId, "thread.runtime_config_updated", "", "system", false, {
          runtimeConfig,
        });
      }
      if (didSwitchToAllowAllBashReviewMode(existing?.bashReviewMode, runtimeConfig.bashReviewMode)) {
        flushPendingBashApprovalsForAllowAllSwitch(threadId);
      }
      return { thread: updatedThread };
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
    if (didSwitchToAllowAllBashReviewMode(existing?.bashReviewMode, runtimeConfig.bashReviewMode)) {
      flushPendingBashApprovalsForAllowAllSwitch(threadId);
    }
    return { thread: updatedThread };
  });

  registerDesktopCommand(IPC_CHANNELS.threadActivityList, async (threadId: string) => {
    if (typeof threadId !== "string" || !threadId.trim()) {
      return [];
    }
    return listThreadActivityFromSdkSession(threadId);
  });

  registerDesktopCommand(IPC_CHANNELS.threadUserMessageEditGet, async (payload: unknown) => {
    if (!payload || typeof payload !== "object") {
      throw new Error("Invalid user message edit request.");
    }
    const request = payload as Partial<ThreadUserMessageEditGetRequest>;
    const threadId = typeof request.threadId === "string" ? request.threadId.trim() : "";
    const activityLineId = typeof request.activityLineId === "string" ? request.activityLineId.trim() : "";
    if (!threadId || !activityLineId) {
      throw new Error("threadId and activityLineId are required.");
    }
    return getThreadUserMessageEdit(threadId, activityLineId);
  });

  registerDesktopCommand(IPC_CHANNELS.threadRewriteFromMessage, async (payload: unknown) => {
    if (!payload || typeof payload !== "object") {
      throw new Error("Invalid user message rewrite request.");
    }
    const request = payload as Partial<ThreadRewriteFromMessageRequest>;
    const threadId = typeof request.threadId === "string" ? request.threadId.trim() : "";
    const activityLineId = typeof request.activityLineId === "string" ? request.activityLineId.trim() : "";
    const prompt = typeof request.prompt === "string" ? request.prompt.trim() : "";
    const attachments = parsePromptImageAttachments(request.attachments);
    const expectedHistoryRevision =
      typeof request.expectedHistoryRevision === "number" && Number.isInteger(request.expectedHistoryRevision)
        ? request.expectedHistoryRevision
        : undefined;
    if (!threadId || !activityLineId || expectedHistoryRevision === undefined) {
      throw new Error("threadId, activityLineId and expectedHistoryRevision are required.");
    }
    if (!prompt && attachments.length === 0) {
      throw new Error("Message is required.");
    }
    const edit = await getThreadUserMessageEdit(threadId, activityLineId);
    if (edit.capability.status !== "ready") {
      throw new Error(edit.capability.reason ?? "该消息当前不可编辑。");
    }
    const currentRevision = threadRunProjectionHistoryRevisions.get(threadId) ?? 0;
    if (currentRevision !== expectedHistoryRevision) {
      throw new Error("历史记录已变化，请刷新后再编辑该消息。");
    }
    const target: ThreadActivityRewindTarget = {
      activityLineId,
      ...(edit.upstreamMessageId ? { userMessageId: edit.upstreamMessageId } : {}),
    };
    return startThreadContinuation({
      threadId,
      prompt,
      attachments,
      ...(request.runtimeConfig ? { runtimeConfigInput: request.runtimeConfig } : {}),
      rewindTarget: target,
      displayPrompt: prompt,
    });
  });

  registerDesktopCommand(IPC_CHANNELS.threadRetryFromMessage, async (payload: unknown) => {
    if (!payload || typeof payload !== "object") {
      throw new Error("Invalid retry request.");
    }
    const request = payload as Partial<ThreadRetryFromMessageRequest>;
    const threadId = typeof request.threadId === "string" ? request.threadId.trim() : "";
    const activityLineId = typeof request.activityLineId === "string" ? request.activityLineId.trim() : "";
    const prompt = typeof request.prompt === "string" ? request.prompt.trim() : "";
    const expectedHistoryRevision =
      typeof request.expectedHistoryRevision === "number" && Number.isInteger(request.expectedHistoryRevision)
        ? request.expectedHistoryRevision
        : undefined;
    if (!threadId || expectedHistoryRevision === undefined) {
      throw new Error("threadId and expectedHistoryRevision are required.");
    }
    return retryThreadFromFailedRequest({
      threadId,
      prompt,
      expectedHistoryRevision,
      hasImages: request.hasImages === true,
      ...(activityLineId ? { activityLineId } : {}),
      ...(request.runtimeConfig ? { runtimeConfig: request.runtimeConfig } : {}),
    });
  });

  registerDesktopCommand(IPC_CHANNELS.threadRunProjectionGet, async (payload: unknown, modeArg?: unknown) => {
    const request = parseThreadRunProjectionGetRequest(payload, modeArg);
    if (!request.threadId) {
      return undefined;
    }
    await hydrateClaudeUserMessageEditState(request.threadId);
    if (request.mode === "feed") {
      return loadThreadFeedProjectionForClient(request.threadId, request);
    }
    const projection = buildCurrentThreadRunProjection(request.threadId, {
      fullHistory: true,
    });
    if (!projection) {
      return undefined;
    }
    return projection;
  });

  registerDesktopCommand(IPC_CHANNELS.threadRunProjectionDetailGet, async (payload: unknown) => {
    const request = parseThreadRunProjectionDetailRequest(payload);
    if (!request) {
      return undefined;
    }
    // Details are explicitly requested process blocks, so rebuild from complete events.
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

  registerDesktopCommand(IPC_CHANNELS.settingsDigest, async () =>
    computeGlobalSettingsDigest({
      modelSettings: getModelSettingsSnapshot(),
      workflowSettings: workflowSettingsStore.get(),
    }),
  );

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
    const { blocking, cascadeMainAgentConfigs, cascadeSubagentOrchestrations } =
      partitionProviderDeleteReferences(references);
    if (blocking.length > 0) {
      return { ok: false as const, reason: "in_use" as const, references: blocking };
    }

    for (const reference of cascadeMainAgentConfigs) {
      workflowSettingsStore.clearDefaultMainAgentConfigReference(reference.id);
      projectOrchestrationSettingsStore.clearMainAgentConfigReference(reference.id);
      agentOrchestrationStore.deleteMainAgentConfig(reference.id);
    }
    for (const reference of cascadeSubagentOrchestrations) {
      workflowSettingsStore.clearDefaultSubagentOrchestrationReference(reference.id);
      projectOrchestrationSettingsStore.clearSubagentOrchestrationReference(reference.id);
      agentOrchestrationStore.deleteSubagentOrchestration(reference.id);
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
      process.stderr.write(`[eco] candidate-model:list pricing enrich failed: ${errorMessage(error)}\n`);
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
    const trimmed = configId.trim();
    // Match subagent-delete behavior: clear dependents, then remove the resource.
    // Projects that pointed at this config fall back to the global default.
    workflowSettingsStore.clearDefaultMainAgentConfigReference(trimmed);
    projectOrchestrationSettingsStore.clearMainAgentConfigReference(trimmed);
    agentOrchestrationStore.deleteMainAgentConfig(trimmed);
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
    const trimmed = promptId.trim();
    workflowSettingsStore.clearDefaultMainAgentPromptReference(trimmed);
    projectOrchestrationSettingsStore.clearMainAgentPromptReference(trimmed);
    agentOrchestrationStore.deleteMainAgentPrompt(trimmed);
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
      process.stderr.write(`[eco] billing:models-dev-list failed: ${errorMessage(error)}\n`);
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

  registerDesktopCommand(IPC_CHANNELS.cursorAgentsList, async (workspacePath: unknown) => {
    const pathToScan =
      typeof workspacePath === "string" && workspacePath.trim()
        ? workspacePath.trim()
        : currentWorkspace?.path;
    return listDiscoveredCursorAgents(pathToScan);
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

  registerDesktopCommand(IPC_CHANNELS.projectIntegrationsSettingsGet, async (payload: unknown) => {
    if (typeof payload !== "string" || !payload.trim()) {
      throw new Error("Invalid project integrations settings workspace path.");
    }
    return projectIntegrationsSettingsStore.get(payload);
  });

  registerDesktopCommand(IPC_CHANNELS.projectIntegrationsSettingsSave, async (payload: unknown) => {
    if (!isRecord(payload) || typeof payload.workspacePath !== "string" || !isRecord(payload.enabled)) {
      throw new Error("Invalid project integrations settings.");
    }
    return projectIntegrationsSettingsStore.save({
      workspacePath: payload.workspacePath,
      enabled: Object.fromEntries(
        Object.entries(payload.enabled).filter(
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
    const normalized = normalizeWorkflowSettingsSnapshot(payload);
    // Legacy acpAgentsEnabled.cursor is no longer a user-facing gate; Cursor ACP
    // is allowed whenever the CLI probe succeeds (checked below for default=acp).
    const gated: typeof normalized = { ...normalized };
    delete gated.acpAgentsEnabled;

    if (gated.defaultCoreKind === "acp") {
      const probe = await probeAcpCursorForMain();
      if (!probe.available) {
        throw new Error(acpCursorUnavailableMessage(probe));
      }
      gated.defaultAcpAgentId = gated.defaultAcpAgentId ?? "cursor";
    } else {
      delete gated.defaultAcpAgentId;
    }

    const saved = workflowSettingsStore.save(gated);
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
    emitSettingsUpdated();
    return workflowSettingsStore.get();
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

  registerDesktopCommand(IPC_CHANNELS.computerUseSettingsGet, async () => computerUseSettingsStore.get());

  registerDesktopCommand(IPC_CHANNELS.computerUseDoctor, async () => {
    const resolved = computerUseGateway.resolveBinary();
    if (!resolved.available || !resolved.binaryPath) {
      return { ok: false, onboardingLaunched: false, reason: resolved.reason ?? "open-computer-use 不可用" };
    }
    const { probeOpenComputerUsePermissionStatus, launchOpenComputerUseOnboarding, getOpenComputerUseOnboardingError } = await import(
      "./computer-use-mcp-gateway"
    );
    const probe = await probeOpenComputerUsePermissionStatus(resolved.binaryPath);
    if (probe.ok) {
      return {
        ok: true,
        onboardingLaunched: false,
        ...(probe.output ? { output: probe.output } : {}),
      };
    }
    const launch = launchOpenComputerUseOnboarding(resolved.binaryPath, resolved.appBundlePath);
    const onboardingError = getOpenComputerUseOnboardingError();
    return {
      ok: false,
      onboardingLaunched: launch.launched,
      reason: launch.launched
        ? undefined
        : (probe.reason ?? "系统权限未就绪"),
      ...(onboardingError ? { onboardingError } : {}),
      ...(probe.output ? { output: probe.output } : {}),
    };
  });

  registerDesktopCommand(IPC_CHANNELS.computerUsePermissionStatus, async () => {
    const resolved = computerUseGateway.resolveBinary();
    if (!resolved.available || !resolved.binaryPath) {
      return { ok: false, missing: [] as string[] };
    }
    const { probeOpenComputerUsePermissionStatus } = await import("./computer-use-mcp-gateway");
    const probe = await probeOpenComputerUsePermissionStatus(resolved.binaryPath);
    return { ok: probe.ok, missing: probe.missing };
  });

  registerDesktopCommand(IPC_CHANNELS.integrationAvailabilityGet, async () => {
    const browserSettings = browserSettingsStore.get();
    const browserFeature = requireBrowserHost().isFeatureAvailable();
    const computerUseSettings = computerUseSettingsStore.get();
    const computerUseFeature = computerUseGateway.isFeatureAvailableQuick();
    const imageSettings = imageGenerationStore.getSettings();
    const activeImageProfile = imageSettings.profiles.find(
      (profile) => profile.id === imageSettings.activeProfileId,
    );
    let imageReason: string | undefined;
    if (!activeImageProfile?.hasApiKey) imageReason = "当前创意绘画 Profile 尚未配置 API Key。";
    else if (!imageSettings.apiKeyEncryptionAvailable)
      imageReason = "系统加密不可用，无法读取创意绘画 API Key。";
    return {
      integrations: [
        {
          id: "browser" as const,
          enabled: browserSettings.agentIntegrationEnabled,
          available: browserFeature.available,
          ...(browserFeature.reason ? { reason: browserFeature.reason } : {}),
        },
        {
          id: "computerUse" as const,
          enabled: computerUseSettings.agentIntegrationEnabled,
          available: computerUseFeature.available,
          ...(computerUseFeature.reason ? { reason: computerUseFeature.reason } : {}),
        },
        {
          id: "imageGeneration" as const,
          enabled: imageSettings.enabled,
          available: Boolean(imageSettings.enabled && activeImageProfile?.hasApiKey && !imageReason),
          ...(imageReason ? { reason: imageReason } : {}),
          ...(activeImageProfile ? { activeProfileName: activeImageProfile.name } : {}),
        },
      ],
    };
  });

  registerDesktopCommand(IPC_CHANNELS.imageGenerationSettingsGet, async () =>
    imageGenerationStore.getSettings(),
  );
  registerDesktopCommand(IPC_CHANNELS.imageGenerationSettingsSave, async (payload: unknown) => {
    if (!isRecord(payload) || typeof payload.enabled !== "boolean") {
      throw new Error("创意绘画设置无效。");
    }
    const saved = imageGenerationStore.setEnabled(payload.enabled);
    scheduleCodexGlobalRuntimeRefresh();
    return saved;
  });
  registerDesktopCommand(IPC_CHANNELS.imageGenerationProfileSave, async (payload: unknown) => {
    if (!isRecord(payload)) throw new Error("创意绘画 Profile 无效。");
    const saved = imageGenerationStore.saveProfile(payload as unknown as ImageGenerationProfileSaveInput);
    scheduleCodexGlobalRuntimeRefresh();
    return saved;
  });
  registerDesktopCommand(IPC_CHANNELS.imageGenerationProfileDelete, async (payload: unknown) => {
    if (!isRecord(payload) || typeof payload.id !== "string") throw new Error("创意绘画 Profile ID 无效。");
    const saved = imageGenerationStore.deleteProfile(payload.id);
    scheduleCodexGlobalRuntimeRefresh();
    return saved;
  });
  registerDesktopCommand(IPC_CHANNELS.imageGenerationProfileActivate, async (payload: unknown) => {
    if (!isRecord(payload) || typeof payload.id !== "string") throw new Error("创意绘画 Profile ID 无效。");
    const saved = imageGenerationStore.activateProfile(payload.id);
    scheduleCodexGlobalRuntimeRefresh();
    return saved;
  });
  registerDesktopCommand(IPC_CHANNELS.imageGenerationArtifactsList, async (payload: unknown) => {
    if (!isRecord(payload) || typeof payload.threadId !== "string") throw new Error("threadId 无效。");
    return imageGenerationStore.listArtifacts(payload.threadId);
  });
  registerDesktopCommand(IPC_CHANNELS.imageGenerationArtifactRead, async (payload: unknown) => {
    const { image, resolvedPath } = resolveImageGenerationArtifactImage(payload);
    const data = await fs.readFile(resolvedPath);
    if (data.length > 64 * 1024 * 1024) throw new Error("图片文件超过 64 MB 限制。");
    return { dataBase64: data.toString("base64"), mimeType: image.mimeType, path: resolvedPath };
  });
  registerDesktopCommand(IPC_CHANNELS.imageGenerationArtifactReveal, async (payload: unknown) => {
    const { resolvedPath } = resolveImageGenerationArtifactImage(payload);
    shell.showItemInFolder(resolvedPath);
  });
  registerDesktopCommand(IPC_CHANNELS.imageViewRead, async (payload: unknown) => {
    if (!isRecord(payload) || typeof payload.path !== "string") {
      return { ok: false as const, code: "invalid_path" as const };
    }
    try {
      return { ok: true as const, ...(await readImageViewFile(payload.path)) };
    } catch (error) {
      if (error instanceof ImageViewReadError) {
        return { ok: false as const, code: error.code };
      }
      throw error;
    }
  });

  registerDesktopCommand(IPC_CHANNELS.imageRevealInFolder, async (payload: unknown) => {
    if (!isRecord(payload) || typeof payload.path !== "string" || !payload.path.trim()) {
      throw new Error("Image path is required.");
    }
    const resolvedPath = path.resolve(payload.path.trim());
    let fileStat: Awaited<ReturnType<typeof fs.lstat>>;
    try {
      fileStat = await fs.lstat(resolvedPath);
    } catch {
      throw new Error("Image file not found.");
    }
    if (!fileStat.isFile()) {
      throw new Error("Please choose a file, not a folder.");
    }
    shell.showItemInFolder(resolvedPath);
  });
  registerDesktopCommand(IPC_CHANNELS.imageDisplayArtifactsList, async (payload: unknown) => {
    if (!isRecord(payload) || typeof payload.threadId !== "string") {
      throw new Error("Invalid image display list request.");
    }
    return imageDisplayStore.listArtifacts(payload.threadId);
  });
  registerDesktopCommand(IPC_CHANNELS.htmlHostArtifactsList, async (payload: unknown) => {
    if (!isRecord(payload) || typeof payload.threadId !== "string") {
      throw new Error("Invalid html host list request.");
    }
    return htmlHostStore.list(payload.threadId);
  });
  registerDesktopCommand(IPC_CHANNELS.centerServerHtmlHostingRefresh, async () => {
    return centerServerClient.refreshHtmlHostingCapability({ force: true });
  });
  registerDesktopCommand(IPC_CHANNELS.imageDisplayRead, async (payload: unknown) => {
    if (!isRecord(payload) || typeof payload.artifactId !== "string" || !payload.artifactId.trim()) {
      return { ok: false as const, code: "invalid_artifact" as const };
    }
    try {
      const file = await imageDisplayStore.readArtifactFile(payload.artifactId.trim());
      return { ok: true as const, ...file };
    } catch (error) {
      if (error instanceof ImageDisplayError) {
        const code =
          error.code === "not_found"
            ? ("not_found" as const)
            : error.code === "too_large"
              ? ("too_large" as const)
              : ("read_failed" as const);
        return { ok: false as const, code };
      }
      throw error;
    }
  });

  registerDesktopCommand(IPC_CHANNELS.webChatListGet, async () => webChatListStore.get());

  registerDesktopCommand(IPC_CHANNELS.webChatListSave, async (payload: unknown) => {
    if (!isWebChatListSnapshot(payload)) {
      throw new Error("Invalid web chat list.");
    }
    return webChatListStore.save(normalizeWebChatListSnapshot(payload));
  });

  registerDesktopCommand(IPC_CHANNELS.sshBookmarksGet, async () => sshBookmarkStore.list());

  registerDesktopCommand(IPC_CHANNELS.sshBookmarksSave, async (payload: unknown) => {
    if (!isSshBookmarkSaveInput(payload)) {
      throw new Error("Invalid SSH bookmark.");
    }
    return sshBookmarkStore.save(payload);
  });

  registerDesktopCommand(IPC_CHANNELS.sshBookmarksDelete, async (payload: unknown) => {
    if (!isSshBookmarkDeleteRequest(payload)) {
      throw new Error("Invalid SSH bookmark delete request.");
    }
    return sshBookmarkStore.delete(payload.id.trim());
  });

  registerDesktopCommand(IPC_CHANNELS.sshBookmarksGetDefaultKeyPath, async () => {
    const { resolveDefaultSshPrivateKeyPath } = await import("../shared/ssh-bookmarks");
    const resolved = resolveDefaultSshPrivateKeyPath(os.homedir(), existsSync);
    return resolved ?? "";
  });

  registerDesktopCommand(IPC_CHANNELS.sshBookmarksConnect, async (payload: unknown) => {
    if (!isSshBookmarkConnectRequest(payload)) {
      throw new Error("Invalid SSH bookmark connect request.");
    }
    const bookmark = sshBookmarkStore.getPublic(payload.bookmarkId.trim());
    if (!bookmark) {
      throw new Error("SSH bookmark not found.");
    }
    const password = sshBookmarkStore.getPassword(bookmark.id);
    const storedKey = sshBookmarkStore.getStoredKey(bookmark.id);
    const secrets: SshConnectSecrets = {
      ...(password ? { password } : {}),
      ...(storedKey ? { storedKey } : {}),
    };
    return connectSshBookmark(interactiveTerminalManager, {
      workspacePath: payload.workspacePath,
      bookmark,
      secrets,
      userDataDir: app.getPath("userData"),
    });
  });

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
      scheduleCodexGlobalRuntimeRefresh();
      return saved;
    }
    await removeClaudeUserEcoAgentBrowserSkill();
    const saved = browserSettingsStore.save(next);
    scheduleCodexGlobalRuntimeRefresh();
    return saved;
  });

  registerDesktopCommand(IPC_CHANNELS.computerUseSettingsSave, async (payload: unknown) => {
    if (!isComputerUseSettingsSnapshot(payload)) {
      throw new Error("Invalid computer use settings.");
    }
    const next = normalizeComputerUseSettingsSnapshot(payload);
    if (next.agentIntegrationEnabled) {
      const feature = await computerUseGateway.checkFeatureAvailable();
      if (!feature.available) {
        throw new Error(`无法启用电脑操控 Agent 能力：${feature.reason ?? "未知原因"}`);
      }
      const saved = computerUseSettingsStore.save(next);
      scheduleCodexGlobalRuntimeRefresh();
      return saved;
    }
    const saved = computerUseSettingsStore.save(next);
    scheduleCodexGlobalRuntimeRefresh();
    return saved;
  });

  registerDesktopCommand(IPC_CHANNELS.notificationSettingsGet, async () => notificationSettingsStore.get());

  registerDesktopCommand(IPC_CHANNELS.notificationSettingsSave, async (payload: unknown) => {
    if (!isNotificationSettingsSnapshot(payload)) {
      throw new Error("Invalid notification settings.");
    }
    return notificationSettingsStore.save(normalizeNotificationSettingsSnapshot(payload));
  });

  registerDesktopCommand(IPC_CHANNELS.browserGetState, async () => requireBrowserHost().getState());

  registerDesktopCommand(IPC_CHANNELS.browserDevPrepareAgentCdp, async (payload: unknown) => {
    const { isDevRuntime } = await import("../shared/dev-cdp");
    if (!isDevRuntime()) {
      throw new Error("browserDevPrepareAgentCdp is only available in dev builds.");
    }
    const threadId =
      typeof (payload as { threadId?: string } | null)?.threadId === "string"
        ? (payload as { threadId: string }).threadId.trim()
        : "";
    if (!threadId) {
      throw new Error("browserDevPrepareAgentCdp requires threadId.");
    }
    const cdpPort = await requireBrowserHost().ensureCdpPort(threadId);
    return { cdpPort };
  });

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

  registerDesktopCommand(IPC_CHANNELS.browserRegisterGuest, async (payload: unknown) => {
    const request = payload as BrowserRegisterGuestRequest;
    if (
      !request ||
      typeof request.browserId !== "string" ||
      !request.browserId.trim() ||
      typeof request.webContentsId !== "number" ||
      !Number.isFinite(request.webContentsId)
    ) {
      throw new Error("Invalid browser guest registration payload.");
    }
    return requireBrowserHost().registerGuestByWebContentsId(request.browserId.trim(), request.webContentsId);
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
      ...(typeof request.workspacePath === "string" && request.workspacePath.trim()
        ? { workspacePath: request.workspacePath.trim() }
        : {}),
    });
  });

  registerDesktopCommand(IPC_CHANNELS.browserOpen, async (payload: unknown) => {
    const request = (payload && typeof payload === "object" ? payload : {}) as BrowserOpenRequest;
    const url =
      typeof request.url === "string" ? request.url : typeof payload === "string" ? payload : undefined;
    const htmlContent = typeof request.htmlContent === "string" ? request.htmlContent : undefined;
    return requireBrowserHost().openSharedSession({
      revealUi: request.reveal !== false,
      ...(url && url.trim() && url !== "about:blank" ? { url } : {}),
      ...(htmlContent && htmlContent.trim() ? { htmlContent: htmlContent.trim() } : {}),
      ...(typeof request.browserId === "string" ? { browserId: request.browserId } : {}),
      ...(typeof request.threadId === "string" ? { threadId: request.threadId } : {}),
      ...(request.newBrowser ? { newBrowser: true } : {}),
      ...(typeof request.workspacePath === "string" && request.workspacePath.trim()
        ? { workspacePath: request.workspacePath.trim() }
        : {}),
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
    return requireBrowserHost().setUiScope(typeof request.threadId === "string" ? request.threadId : null);
  });

  registerDesktopCommand(IPC_CHANNELS.browserGoBack, async (payload: unknown) => {
    const browserId =
      payload &&
      typeof payload === "object" &&
      typeof (payload as { browserId?: string }).browserId === "string"
        ? (payload as { browserId: string }).browserId
        : undefined;
    return requireBrowserHost().goBack(browserId);
  });
  registerDesktopCommand(IPC_CHANNELS.browserGoForward, async (payload: unknown) => {
    const browserId =
      payload &&
      typeof payload === "object" &&
      typeof (payload as { browserId?: string }).browserId === "string"
        ? (payload as { browserId: string }).browserId
        : undefined;
    return requireBrowserHost().goForward(browserId);
  });
  registerDesktopCommand(IPC_CHANNELS.browserReload, async (payload: unknown) => {
    const browserId =
      payload &&
      typeof payload === "object" &&
      typeof (payload as { browserId?: string }).browserId === "string"
        ? (payload as { browserId: string }).browserId
        : undefined;
    return requireBrowserHost().reload(browserId);
  });
  registerDesktopCommand(IPC_CHANNELS.browserOpenExternal, async (payload: unknown) => {
    const browserId =
      payload &&
      typeof payload === "object" &&
      typeof (payload as { browserId?: string }).browserId === "string"
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
    const saved = asrSettingsStore.save({
      endpoint: typeof value.endpoint === "string" ? value.endpoint : "",
      ...(value.apiMode ? { apiMode: value.apiMode } : {}),
      model: typeof value.model === "string" ? value.model : "",
      systemPrompt: typeof value.systemPrompt === "string" ? value.systemPrompt : "",
      ...(typeof value.apiKey === "string" ? { apiKey: value.apiKey } : {}),
    });
    return saved;
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
    const saved = asrSettingsStore.saveProfile({
      ...(typeof value.id === "string" ? { id: value.id } : {}),
      name: typeof value.name === "string" ? value.name : "",
      endpoint: typeof value.endpoint === "string" ? value.endpoint : "",
      ...(value.apiMode ? { apiMode: value.apiMode } : {}),
      model: typeof value.model === "string" ? value.model : "",
      systemPrompt: typeof value.systemPrompt === "string" ? value.systemPrompt : "",
      ...(typeof value.apiKey === "string" ? { apiKey: value.apiKey } : {}),
    });
    return saved;
  });
  registerDesktopCommand(IPC_CHANNELS.asrProfileDelete, async (payload: unknown) => {
    if (
      !payload ||
      typeof payload !== "object" ||
      typeof (payload as Record<string, unknown>).id !== "string"
    ) {
      throw new Error("Invalid ASR profile delete request.");
    }
    const saved = asrSettingsStore.deleteProfile((payload as { id: string }).id);
    return saved;
  });
  registerDesktopCommand(IPC_CHANNELS.asrProfileActivate, async (payload: unknown) => {
    if (
      !payload ||
      typeof payload !== "object" ||
      typeof (payload as Record<string, unknown>).id !== "string"
    ) {
      throw new Error("Invalid ASR profile activate request.");
    }
    const saved = asrSettingsStore.activateProfile((payload as { id: string }).id);
    return saved;
  });
  registerDesktopCommand(IPC_CHANNELS.asrInputDeviceSave, async (payload: unknown) => {
    if (!payload || typeof payload !== "object") throw new Error("Invalid ASR input device settings.");
    const inputDeviceId = (payload as Record<string, unknown>).inputDeviceId;
    if (inputDeviceId !== undefined && inputDeviceId !== null && typeof inputDeviceId !== "string") {
      throw new Error("Invalid ASR input device ID.");
    }
    return asrSettingsStore.saveInputDevice(inputDeviceId === undefined ? {} : { inputDeviceId });
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
          const deletedThread = conversationStore.getThread(threadId);
          await deleteThreadFully(threadId);
          void requireBrowserHost().disposeThreadScope(threadId);
          emitThreadEvent(threadId, "thread.deleted", "对话已删除。", "system", false, {
            ...(deletedThread?.workspacePath ? { workspacePath: deletedThread.workspacePath } : {}),
          });
        },
        hasActiveThreadRuns: () =>
          conversationStore
            .listThreads()
            .some((thread) => thread.status === "running" || thread.status === "queued"),
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
    // List metadata only; file bodies load via git:get-workspace-file-diff.
    return getWorkspaceDiff(workspacePath.trim(), runGitCommand, {
      includeContents: false,
      includePatch: false,
    });
  });

  registerDesktopCommand(IPC_CHANNELS.gitGetWorkspaceFileDiff, async (payload: unknown) => {
    if (!payload || typeof payload !== "object") {
      throw new Error("Invalid git workspace file diff request.");
    }
    const record = payload as Record<string, unknown>;
    if (typeof record.workspacePath !== "string" || !record.workspacePath.trim()) {
      throw new Error("Workspace path is required.");
    }
    if (typeof record.path !== "string" || !record.path.trim()) {
      throw new Error("File path is required.");
    }
    return getWorkspaceFileDiff(record.workspacePath.trim(), record.path.trim(), runGitCommand);
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

  registerDesktopCommand(IPC_CHANNELS.gitSaveCommitModelPreference, async (payload: unknown) => {
    return handleGitSaveCommitModelPreference(parseGitSaveCommitModelPreferenceRequest(payload), {
      providerStore,
      gitSettingsStore,
      workflowSettingsStore,
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

  registerDesktopCommand(IPC_CHANNELS.integratedWebSearchSettingsGet, async () =>
    integratedWebSearchSettingsStore.get(),
  );

  registerDesktopCommand(IPC_CHANNELS.integratedWebSearchSettingsSave, async (payload: unknown) => {
    if (!isIntegratedWebSearchSettingsSaveInput(payload)) {
      throw new Error("Invalid integrated web search settings.");
    }
    return integratedWebSearchSettingsStore.save(payload);
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

  registerDesktopCommand(IPC_CHANNELS.centerServerBuildConnectQr, async () =>
    centerServerClient.buildConnectQr(),
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

  registerDesktopCommand(IPC_CHANNELS.centerServerVaultStatusGet, async () =>
    centerServerClient.getVaultStatus(),
  );

  registerDesktopCommand(
    IPC_CHANNELS.centerServerSyncConfig,
    async (mode?: "pull" | "push" | "reconcile") => {
      const result = await centerServerClient.syncConfig(
        mode === "pull" || mode === "push" || mode === "reconcile" ? mode : "reconcile",
      );
      emitSettingsUpdated();
      return result;
    },
  );

  registerDesktopCommand(
    IPC_CHANNELS.centerServerSyncConfigDomain,
    async (domain: CenterServerSyncDomain, mode: "pull" | "push") => {
      const result = await centerServerClient.syncConfigDomain(domain, mode);
      emitSettingsUpdated();
      return result;
    },
  );

  registerDesktopCommand(IPC_CHANNELS.centerServerGetSyncStatus, async () =>
    centerServerClient.getSyncStatus(),
  );

  registerDesktopCommand(IPC_CHANNELS.centerServerUnlockVaultWithPassword, async (password: string) => {
    if (typeof password !== "string") {
      throw new Error("password is required.");
    }
    const result = await centerServerClient.unlockVaultWithPassword(password);
    emitSettingsUpdated();
    return result;
  });

  registerDesktopCommand(IPC_CHANNELS.centerServerWrapVaultWithPassword, async (password: string) => {
    if (typeof password !== "string") {
      throw new Error("password is required.");
    }
    const result = await centerServerClient.wrapVaultWithPassword(password);
    emitSettingsUpdated();
    return result;
  });

  registerDesktopCommand(IPC_CHANNELS.centerServerRequestVaultClaim, async () =>
    centerServerClient.requestVaultClaim(),
  );

  registerDesktopCommand(IPC_CHANNELS.centerServerListPendingVaultClaims, async () =>
    centerServerClient.listPendingVaultClaims(),
  );

  registerDesktopCommand(IPC_CHANNELS.centerServerApproveVaultClaim, async (claimId: string) => {
    if (typeof claimId !== "string" || !claimId.trim()) {
      throw new Error("claimId is required.");
    }
    return centerServerClient.approveVaultClaim(claimId.trim());
  });

  registerDesktopCommand(IPC_CHANNELS.centerServerSubmitVaultClaimCode, async (code: string) => {
    if (typeof code !== "string") {
      throw new Error("code is required.");
    }
    const result = await centerServerClient.submitVaultClaimCode(code);
    emitSettingsUpdated();
    return result;
  });

  registerDesktopCommand(IPC_CHANNELS.centerServerCancelVaultClaim, async () => {
    await centerServerClient.cancelActiveVaultClaim();
    return centerServerClient.getVaultStatus();
  });

  registerDesktopCommand(IPC_CHANNELS.threadStart, async (payload: ThreadStartRequest) => {
    const attachments = parsePromptImageAttachments(payload.attachments);
    const prompt = resolveThreadMessagePrompt(payload.prompt, attachments);
    if (!prompt) {
      throw new Error("Task prompt is required.");
    }
    // Materialize path-only spool attachments before any slow await (e.g. ACP CLI probe).
    // Otherwise a concurrent composer-draft delete can wipe spool and yield ENOENT.
    const attachmentsForHandOff = attachments.length
      ? await loadPromptAttachmentsForRuntime(attachments)
      : [];
    const coreKind = payload.coreKind ?? "claude";
    if (!isCoreKind(coreKind)) {
      throw new Error(`Unsupported Core: ${String(payload.coreKind)}`);
    }
    if (coreKind === "codex" && !isCodexCliAvailable()) {
      throw new Error(
        "Codex Core 不可用：未找到可执行的 Codex CLI。请安装工作区依赖或设置 CODEX_EXECUTABLE。",
      );
    }
    if (coreKind === "pi") {
      const pi = await probePiCoreAvailability();
      if (!pi.available) {
        throw new Error(pi.reason ?? "PI Core 不可用。");
      }
    }
    if (coreKind === "acp") {
      await assertAcpCursorRunnableForMain();
    }

    const workspace = await ensureWorkspace(payload.workspacePath);
    const settings = getModelSettingsSnapshot();
    const parsedRuntimeConfig = parseThreadRuntimeConfigInput(payload.runtimeConfig);
    const threadRuntime =
      coreKind === "acp"
        ? normalizeThreadRuntimeConfig(parsedRuntimeConfig)
        : materializeThreadRuntimeConfig(settings, parsedRuntimeConfig);
    if (coreKind === "codex") {
      assertCodexRuntimeConfigSupported(threadRuntime);
    }
    const roleRoutes = coreKind === "acp" ? [] : roleRoutesForThreadConfig(settings, threadRuntime);
    const resolvedRuntimeConfig =
      coreKind === "acp"
        ? { ok: true as const, routes: [] as RuntimeRoute[] }
        : resolveRuntimeConfigForThreadConfig(settings, threadRuntime, roleRoutes);
    const status: ThreadSummary["status"] = resolvedRuntimeConfig.ok ? "running" : "blocked";
    const now = new Date().toISOString();
    const acpAgentId = coreKind === "acp" ? ("cursor" as const) : undefined;
    const thread: ThreadSummary = {
      id: `thr_${Date.now()}`,
      title: resolvePendingThreadTitle(currentAppLocale()),
      prompt,
      workspacePath: workspace.path,
      status,
      createdAt: now,
      updatedAt: now,
      coreKind,
      ...(acpAgentId ? { acpAgentId } : {}),
      hostUiFeatures: resolveAcpHostUiFeatures({
        coreKind,
        ...(acpAgentId ? { acpAgentId } : {}),
      }),
      coreLockedAt: now,
      message: resolvedRuntimeConfig.ok ? "" : resolvedRuntimeConfig.reason,
      runtimeConfig: threadRuntime,
    };

    conversationStore.saveThread(thread);
    const recorded = await recordUserPrompt(thread.id, prompt, attachmentsForHandOff);
    const attachmentsForRuntime = await loadPromptAttachmentsForRuntime(
      recorded.storedAttachments ?? attachmentsForHandOff,
    );
    emitThreadEvent(thread.id, status === "blocked" ? "thread.blocked" : "thread.started", thread.message);

    // Landing browsers opened before the first message must move onto this thread
    // before the renderer setUiScope effect runs (otherwise pages look "left behind").
    try {
      await requireBrowserHost().adoptPersonalScopeToThread(thread.id);
    } catch (error) {
      console.warn(
        `[eco-browser] adoptPersonalScopeToThread failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    if (resolvedRuntimeConfig.ok) {
      if (coreKind !== "acp") {
        scheduleThreadTitleSummary(thread.id);
      }
      void threadRuntimeCoordinator.start(coreKind, {
        thread,
        workspace,
        runtimeConfig: { routes: resolvedRuntimeConfig.routes },
        prompt,
        ...(attachmentsForRuntime?.length ? { attachments: attachmentsForRuntime } : {}),
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
    return listThreadUsageLedgerEventViewsForBilling(threadId.trim());
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
    if (approvalThread.coreKind === "pi") {
      requireThreadCore(approvalThread, "pi", "approve a PI plan");
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
      commitThreadPlanApprovalToAgentMode(threadId, "pi_plan_approved");
      // Cancel any leftover Claude-style bridge if present; PI Plan is Codex-style async.
      cancelPlanApprovalsForThreadKeepPending(threadId, "pi plan approved asynchronously");
      const result = await startPiThreadContinuation({
        threadId,
        prompt:
          "The user approved the plan. Implement it now with full Agent tools. Follow the approved plan.",
        runtimeConfigInput: runtimeConfig,
        skipRecordUserPrompt: true,
      });
      await persistApprovedPlanForThread(threadId, pendingPlan);
      conversationStore.clearPendingPlan(threadId);
      emitThreadEvent(threadId, "thread.plan_cleared", "计划已进入执行阶段。", "system");
      return { thread: result.thread };
    }

    const pendingBridge = getPendingPlanApprovalForThread(threadId);
    const approveRoute = resolveThreadApprovePlanRoute(
      definedProps({
        coreKind: approvalThread.coreKind,
        hasPendingBridge: Boolean(pendingBridge),
      }),
    );
    const pendingRuntimeConfig = request.runtimeConfig
      ? parseThreadRuntimeConfigInput(request.runtimeConfig)
      : undefined;
    if (pendingRuntimeConfig) {
      roleRoutesForThreadConfig(getModelSettingsSnapshot(), pendingRuntimeConfig);
    }

    if (pendingRuntimeConfig) {
      conversationStore.saveThreadRuntimeConfig(threadId, pendingRuntimeConfig);
    }

    if (approveRoute.kind === "bridge") {
      if (!pendingBridge) {
        throw new Error("No pending plan approval is active for this thread.");
      }
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
      const planFilePath = pendingBridge.planFilePath ?? pendingPlan?.planFilePath;
      await persistApprovedPlanForThread(threadId, {
        workspacePath: pendingPlan?.workspacePath ?? approvedThread.workspacePath,
        userPrompt: pendingPlan?.userPrompt ?? pendingBridge.userPrompt,
        analysis: pendingPlan?.analysis ?? pendingBridge.analysis,
        plan: pendingPlan?.plan ?? pendingBridge.plan,
        ...(planFilePath ? { planFilePath } : {}),
      });
      conversationStore.clearPendingPlan(threadId);
      emitThreadEvent(threadId, "thread.plan_cleared", "计划已批准，当前会话开始执行。", "system");
      updateThread(threadId, {
        status: "running",
        message: "",
      });
      return { thread: ensureThreadRuntimeConfig(conversationStore.getThread(threadId) ?? approvedThread) };
    }

    if (approveRoute.kind === "acp_continuation") {
      if (approvalThread.coreKind !== "acp") {
        throw new Error(
          `CORE_ROUTE_MISMATCH: Thread ${approvalThread.id} belongs to ${approvalThread.coreKind ?? "unknown"}, not acp; cannot approve an ACP plan.`,
        );
      }
      const pendingPlan = conversationStore.getPendingPlan(threadId);
      if (!pendingPlan) {
        throw new Error(
          "ACP plan approval has no live cursor/create_plan bridge and no stored pending plan.",
        );
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
      const runtimeConfig = withAgentSessionMode(pendingRuntimeConfig ?? currentConfig, "agent");
      conversationStore.saveThreadRuntimeConfig(threadId, runtimeConfig);
      commitThreadPlanApprovalToAgentMode(threadId, "acp_plan_approved");
      // Disconnect fallback only: live create_plan bridge is preferred (Cursor blocking contract).
      cancelPlanApprovalsForThreadKeepPending(threadId, "acp plan approved via disconnect fallback");
      const result = await startAcpThreadContinuation({
        threadId,
        prompt:
          "The user approved the plan. Implement it now with full Agent tools. Follow the approved plan.",
        runtimeConfigInput: runtimeConfig,
        skipRecordUserPrompt: true,
      });
      await persistApprovedPlanForThread(threadId, pendingPlan);
      conversationStore.clearPendingPlan(threadId);
      emitThreadEvent(threadId, "thread.plan_cleared", "计划已进入执行阶段。", "system");
      return { thread: result.thread };
    }

    requireThreadCore(approvalThread, "claude", "approve a Claude plan");

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
      message: "",
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
    const attachments = parsePromptImageAttachments(payload.attachments);
    const prompt = resolveThreadMessagePrompt(payload.prompt, attachments);
    if (!prompt) {
      throw new Error("Message is required.");
    }
    const rewindTarget = parseThreadActivityRewindTarget(payload.rewindTarget);
    return startThreadContinuation({
      threadId: payload.threadId,
      prompt,
      ...(payload.runtimeConfig ? { runtimeConfigInput: payload.runtimeConfig } : {}),
      ...(attachments.length > 0 ? { attachments } : {}),
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
    const enqueuePlan = resolveAcpFollowUpEnqueuePlan({
      coreKind: thread.coreKind,
      attachmentCount: request.attachments?.length ?? 0,
    });
    const forceQueue = enqueuePlan.kind === "force_queue";
    const metadata = resolveThreadFollowUpEnqueueMetadata(thread.id);
    const preferInterrupt = !forceQueue && request.priority === "escalated";
    const followUpPendingActivityLineId = `follow-up:${randomUUID()}`;
    const persistedAttachments = request.attachments?.length
      ? await promptImageFileStore.persistMessageAttachments(
          thread.id,
          followUpPendingActivityLineId,
          request.attachments,
        )
      : undefined;
    const followUp = conversationStore.enqueueThreadFollowUp({
      threadId: thread.id,
      prompt: request.prompt,
      ...(persistedAttachments?.length ? { attachments: persistedAttachments } : {}),
      ...(!forceQueue && request.priority ? { priority: request.priority } : {}),
      deliveryMode: preferInterrupt ? "interrupt_resume" : "queued",
      ...metadata,
    });

    if (forceQueue) {
      emitThreadFollowUpEvent(followUp, "thread.follow_up.queued", formatFollowUpQueuedMessage(followUp));
      return buildThreadFollowUpMutationResult(
        conversationStore.getThreadFollowUp(thread.id, followUp.id) ?? followUp,
      );
    }

    if (preferInterrupt) {
      const midTurnResult = await tryDeliverFollowUpViaMidTurn(thread, followUp);
      if (midTurnResult) {
        return buildThreadFollowUpMutationResult(midTurnResult);
      }
      const current = await requestEscalatedFollowUpInterrupt(
        thread,
        conversationStore.getThreadFollowUp(thread.id, followUp.id) ?? followUp,
      );
      if (current.status === "queued") {
        emitThreadFollowUpEvent(current, "thread.follow_up.queued", formatFollowUpQueuedMessage(current));
      }
      return buildThreadFollowUpMutationResult(current);
    }

    const deliveryMode =
      request.followUpDeliveryMode ?? workflowSettingsStore.get().followUpDeliveryMode ?? "steer";
    if (deliveryMode === "queue") {
      // Only surface the queue panel when we intentionally keep the row queued.
      emitThreadFollowUpEvent(followUp, "thread.follow_up.queued", formatFollowUpQueuedMessage(followUp));
      return buildThreadFollowUpMutationResult(
        conversationStore.getThreadFollowUp(thread.id, followUp.id) ?? followUp,
      );
    }

    const midTurnResult = await tryDeliverFollowUpViaMidTurn(thread, followUp);
    const settled = midTurnResult ?? conversationStore.getThreadFollowUp(thread.id, followUp.id) ?? followUp;
    // Announce queue only when the row is still waiting (mid-turn skipped/rejected and requeued).
    if (settled.status === "queued") {
      emitThreadFollowUpEvent(settled, "thread.follow_up.queued", formatFollowUpQueuedMessage(settled));
    }
    return buildThreadFollowUpMutationResult(settled);
  });

  registerDesktopCommand(IPC_CHANNELS.threadFollowUpEscalate, async (payload: unknown) => {
    const request = parseThreadFollowUpEscalateRequest(payload);
    const thread = conversationStore.getThread(request.threadId);
    if (!thread) {
      throw new Error("Thread was not found.");
    }
    assertAcpFollowUpEscalateAllowed(thread.coreKind);
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

    const midTurnResult = await tryDeliverFollowUpViaMidTurn(thread, followUp);
    if (midTurnResult) {
      return buildThreadFollowUpMutationResult(midTurnResult);
    }
    const current = await requestEscalatedFollowUpInterrupt(
      thread,
      conversationStore.getThreadFollowUp(thread.id, followUp.id) ?? followUp,
    );
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
    return withThreadFollowUpLock(request.threadId, async () => {
      if (request.followUpId) {
        editingThreadFollowUpByThread.set(request.threadId, request.followUpId);
        const followUp = conversationStore.getThreadFollowUp(request.threadId, request.followUpId);
        if (!followUp || followUp.status !== "queued") {
          editingThreadFollowUpByThread.delete(request.threadId);
          throw new Error("Pending follow-up was not found or can no longer be edited.");
        }
        return { editing: true };
      }
      const released = editingThreadFollowUpByThread.delete(request.threadId);
      if (released) {
        void drainQueuedThreadFollowUpsAfterRun(request.threadId);
      }
      return { editing: false };
    });
  });

  registerDesktopCommand(IPC_CHANNELS.threadFollowUpQueuePaused, async (payload: unknown) => {
    const request = parseThreadFollowUpQueuePausedRequest(payload);
    const thread = setThreadFollowUpQueuePausedState(request.threadId, request.paused);
    if (!thread) {
      throw new Error("Thread was not found.");
    }
    if (!request.paused) {
      void drainQueuedThreadFollowUpsAfterRun(request.threadId);
    }
    return { paused: Boolean(thread.followUpQueuePaused), thread } satisfies ThreadFollowUpQueuePausedResult;
  });

  registerDesktopCommand(IPC_CHANNELS.threadFollowUpCancel, async (payload: unknown) => {
    const request = parseThreadFollowUpCancelRequest(payload);
    const followUp = conversationStore.cancelThreadFollowUp(request.threadId, request.followUpId);
    if (!followUp) {
      throw new Error("Pending follow-up was not found or cannot be cancelled.");
    }
    const attachmentPaths = promptImageFileStore.collectAttachmentPaths(followUp.attachments);
    if (attachmentPaths.length > 0) {
      await promptImageFileStore.releasePaths(attachmentPaths);
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
    const hadActiveRun = activeRunRuntimeState.hasRun(threadId);
    if (hadActiveRun) {
      markThreadCancelling(threadId);
    }
    if (owner) {
      await threadRuntimeCoordinator.cancel(owner, threadId);
    }
    if (worktreeDisposition) {
      pendingCancelDisposition.set(threadId, worktreeDisposition);
    }
    if (activeRunRuntimeState.abortRun(threadId, "cancelled by user") || hadActiveRun) {
      markThreadCancelling(threadId);
      updateThread(threadId, { status: "running", message: "" });
      cancelClarificationsForThread(threadId, "cancelled by user");
      cancelBashApprovalsForThread(threadId, "cancelled by user");
      cancelPlanApprovalsForThreadKeepPending(threadId, "cancelled by user");
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
        updateThread(threadId, { status: "idle", message: "" });
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

function applyThreadTitleSummary(threadId: string, title: string): void {
  const thread = conversationStore.getThread(threadId);
  if (!thread || thread.title === title || !shouldReplaceAutoThreadTitle(thread.title)) {
    return;
  }

  conversationStore.updateThreadTitle(threadId, title);
  emitThreadEvent(threadId, "thread.title_updated", "标题已更新", "system", false, { title });
}

/** ACP owns the sidebar title via session_info_update — do not require a placeholder. */
function applyAcpSessionTitle(threadId: string, rawTitle: string): void {
  const title = normalizeAcpSessionTitle(rawTitle);
  if (!title) {
    return;
  }
  const thread = conversationStore.getThread(threadId);
  if (!thread || thread.title === title) {
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
  const message = reason?.trim() ? `会话标题生成失败：${reason.trim()}` : "会话标题生成失败";
  const fallbackTitle = resolveFailedThreadTitle(thread.prompt, currentAppLocale());
  if (fallbackTitle !== thread.title) {
    conversationStore.updateThreadTitle(threadId, fallbackTitle);
  }
  emitThreadEvent(threadId, "thread.title_failed", message, "system", false, {
    title: fallbackTitle,
  });
}

function scheduleThreadTitleSummary(threadId: string): boolean {
  const thread = conversationStore.getThread(threadId);
  if (
    !thread ||
    !canRegenerateThreadTitle(thread.title, titleGeneratingThreadIds.has(threadId), thread.coreKind)
  ) {
    return false;
  }

  titleGeneratingThreadIds.add(threadId);
  const prompt = thread.prompt;
  emitThreadEvent(threadId, "thread.title_generating", "", "system", false, { titleGenerating: true });
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
  // Never expose unvalidated model output as a title. Keep the placeholder visible
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
  const followUpQueuePaused = autoPauseFollowUpQueueForErrorStatus(threadId, "blocked");
  emitThreadEvent(threadId, "thread.blocked", truncated, "system", false, {
    metadata: { activityOrigin: "eco.thread_blocked" },
    followUpQueuePaused,
  });
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
  runOnce: (context: RunAttemptContext) => Promise<RequestAttemptResult>,
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

/**
 * Cancel in-memory plan-approval bridges only.
 * Never clear persisted pending plans — users must be able to approve after quit/restart.
 */
function cancelPlanApprovalsForThreadKeepPending(threadId: string, reason: string): void {
  cancelPlanApprovalsForThread(threadId, reason);
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
    cancelPlanApprovals: cancelPlanApprovalsForThreadKeepPending,
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
    resetSdkStream: (threadId) => {
      sdkStreamBridge.flushPendingAndReset(threadId, (id, type, message, role, stream, agentId, extras) => {
        const metadata = extras?.metadata;
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
                ...(metadata && { metadata }),
              }
            : undefined,
        );
      });
    },
    flushUsageUpdates: (threadId) => usageLedgerCoordinator.flushUsageUpdates(threadId),
    finishActiveRun,
    afterRunContextRefresh,
    getThread: (threadId) => conversationStore.getThread(threadId),
    updateThreadIdle: (threadId, message) => {
      updateThread(threadId, { status: "idle", message });
    },
  });
  await cleanupPendingClaudeFork(input.threadId);
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
      message: "",
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
  const drainClaim = await withThreadFollowUpLock(threadId, async () => {
    const thread = conversationStore.getThread(threadId);
    const forceEscalatedDrain = pendingEscalatedFollowUpDrain.delete(threadId);
    // Escalated interrupt may force one drain while the queue remains user-paused.
    if (
      shouldBlockThreadFollowUpDrain({
        hasPendingBridgeApproval: Boolean(getPendingPlanApprovalForThread(threadId)),
        hasPendingClarification: Boolean(getPendingClarificationForThread(threadId)),
        hasEditingFollowUp: editingThreadFollowUpByThread.has(threadId),
        hasFollowUpQueuePaused: Boolean(thread?.followUpQueuePaused) && !forceEscalatedDrain,
        ...(thread?.status && { threadStatus: thread.status }),
        hasStoredPendingPlan: Boolean(conversationStore.getPendingPlan(threadId)),
      })
    ) {
      if (forceEscalatedDrain) {
        pendingEscalatedFollowUpDrain.add(threadId);
      }
      return { claimed: [] as ThreadPendingFollowUp[], forceEscalatedDrain: false };
    }
    if (!thread || (!forceEscalatedDrain && !shouldDrainThreadFollowUps(thread.status))) {
      return { claimed: [] as ThreadPendingFollowUp[], forceEscalatedDrain: false };
    }
    const excludeFollowUpId = editingFollowUpClaimExclusion(threadId);
    const queued = conversationStore.listThreadFollowUps(threadId, { statuses: ["queued"] });
    const claimPriority = queued.some((followUp) => followUp.priority === "escalated")
      ? "escalated"
      : undefined;
    const claimed = conversationStore.claimQueuedThreadFollowUps(threadId, {
      deliveryMode: "resume",
      deliveryBoundary: forceEscalatedDrain ? "forced_interrupt" : "safe_boundary",
      ...(claimPriority ? { priority: claimPriority } : {}),
      ...(excludeFollowUpId ? { excludeFollowUpId } : {}),
    });
    return { claimed, forceEscalatedDrain };
  });
  const { claimed, forceEscalatedDrain } = drainClaim;
  if (claimed.length === 0) {
    return;
  }
  const thread = conversationStore.getThread(threadId);
  if (!thread) {
    return;
  }

  const prompt = buildThreadFollowUpDrainPrompt(claimed);
  const displayPrompt = buildThreadFollowUpDisplayPrompt(claimed);
  const attachments = collectThreadFollowUpAttachments(claimed);
  const skipRecordUserPrompt = claimed.some((followUp) => midTurnLocalUserPromptFollowUpIds.has(followUp.id));
  for (const followUp of claimed) {
    midTurnLocalUserPromptFollowUpIds.delete(followUp.id);
  }
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
      ...(skipRecordUserPrompt ? { skipRecordUserPrompt: true } : {}),
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

async function discardUnstartedAcpTurn(input: {
  threadId: string;
  reason: string;
  restorePrompt: string;
  attachments?: PromptImageAttachment[];
  recordedUserActivityLineId?: string;
  continuation?: boolean;
}): Promise<void> {
  const records = conversationStore.listUserMessageRecords(input.threadId);
  const activityLineId =
    input.recordedUserActivityLineId?.trim() ||
    (!input.continuation ? records[records.length - 1]?.activityLineId : undefined);
  if (!activityLineId) {
    markThreadInterrupted(input.threadId, input.reason);
    return;
  }
  const stored = conversationStore.getUserMessageRecord(input.threadId, activityLineId);
  const rawPrompt = stored?.text ?? input.restorePrompt;
  const restorePrompt = rawPrompt.trim() === ACP_IMAGE_ONLY_PROMPT ? "" : rawPrompt;
  const attachments = stored?.attachments?.length ? stored.attachments : input.attachments;
  try {
    conversationStore.discardThreadTurnFromActivityLine(input.threadId, activityLineId);
  } catch (error) {
    process.stderr.write(`[eco] ACP unstarted discard failed (${input.threadId}): ${errorMessage(error)}\n`);
    markThreadInterrupted(input.threadId, input.reason);
    return;
  }
  resetThreadRuntimeAfterHistoryRewrite(input.threadId);
  const failureMessage = formatUserFacingRequestError(input.reason);
  const draft = conversationStore.saveComposerDraft(
    `thread:${input.threadId}`,
    restorePrompt,
    attachments,
    failureMessage,
  );
  if (!draft) {
    markThreadInterrupted(input.threadId, input.reason);
    return;
  }
  updateThread(input.threadId, { status: "failed", message: failureMessage });
  emitThreadEvent(input.threadId, "thread.unstarted_turn_discarded", failureMessage, "system", false, {
    composerRestore: {
      prompt: restorePrompt,
      ...(attachments?.length ? { attachments } : {}),
      revision: draft.revision,
    },
  });
  emitThreadRunProjectionUpdated(input.threadId);
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

async function startPiThreadRunFromCoordinator(input: ThreadCoreStartRunInput): Promise<void> {
  imageViewGateway.noteThreadPrompt(input.thread.id, input.prompt);
  const prepared = await resolvePiSessionResourcesForThread(input.thread.id, input.workspace.path);
  const agentRegistry = resolveAgentRuntimeConfigForThread(input.thread);
  await startPiThreadRun(
    {
      thread: input.thread,
      workspace: input.workspace,
      runtimeConfig: input.runtimeConfig,
      prompt: input.prompt,
      ...(input.attachments?.length ? { attachments: input.attachments } : {}),
      roleRoutes: input.roleRoutes,
      continuation: false,
      skillPaths: prepared.skillPaths,
      ...(Object.keys(prepared.mcpServers).length > 0 ? { mcpServers: prepared.mcpServers } : {}),
      ...(prepared.appendSystemPrompt.length > 0 ? { appendSystemPrompt: prepared.appendSystemPrompt } : {}),
      ...(agentRegistry ? { agentRegistry } : {}),
    },
    piRuntimeOrchestrationDeps(),
  );
}

async function startPiThreadContinuation(input: StartThreadContinuationInput): Promise<ThreadContinueResult> {
  const prompt = input.prompt.trim();
  if (!prompt && !input.attachments?.length) {
    throw new Error("Message is required.");
  }
  const thread = conversationStore.getThread(input.threadId);
  if (!thread) {
    throw new Error("Thread was not found.");
  }
  requireThreadCore(thread, "pi", "continue with PI");
  if (thread.status === "running" || thread.status === "queued") {
    throw new Error("Wait for the current run to finish.");
  }

  const settings = getModelSettingsSnapshot();
  if (input.runtimeConfigInput) {
    const next = resolveContinueThreadRuntimeConfig(
      settings,
      thread.runtimeConfig,
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
  const roleRoutes = roleRoutesForThreadConfig(settings, threadConfig);
  const runtime = resolveRuntimeConfigForThreadConfig(settings, threadConfig, roleRoutes);
  if (!runtime.ok) {
    throw new Error(runtime.reason);
  }

  updateThread(thread.id, { status: "running", message: "" });
  const workspace = await ensureWorkspace(thread.workspacePath);
  let attachmentsForRuntime = await loadPromptAttachmentsForRuntime(input.attachments);
  if (!input.skipRecordUserPrompt) {
    const recorded = await recordUserPrompt(
      thread.id,
      input.displayPrompt?.trim() || prompt,
      input.attachments,
    );
    attachmentsForRuntime = await loadPromptAttachmentsForRuntime(
      recorded.storedAttachments ?? input.attachments,
    );
  }
  imageViewGateway.noteThreadPrompt(thread.id, prompt);
  const updated = ensureThreadRuntimeConfig(conversationStore.getThread(thread.id) ?? activeThread);
  const prepared = await resolvePiSessionResourcesForThread(updated.id, workspace.path);
  const agentRegistry = resolveAgentRuntimeConfigForThread(updated);
  void startPiThreadRun(
    {
      thread: updated,
      workspace,
      runtimeConfig: { routes: runtime.routes },
      prompt,
      ...(attachmentsForRuntime?.length ? { attachments: attachmentsForRuntime } : {}),
      roleRoutes,
      continuation: true,
      skillPaths: prepared.skillPaths,
      ...(Object.keys(prepared.mcpServers).length > 0 ? { mcpServers: prepared.mcpServers } : {}),
      ...(prepared.appendSystemPrompt.length > 0 ? { appendSystemPrompt: prepared.appendSystemPrompt } : {}),
      ...(agentRegistry ? { agentRegistry } : {}),
    },
    piRuntimeOrchestrationDeps(),
  );
  return { thread: updated };
}

async function startAcpThreadContinuation(
  input: StartThreadContinuationInput,
): Promise<ThreadContinueResult> {
  // Read spool images before ACP CLI probe — same race as thread:start.
  const attachmentsForPrompt = await loadPromptAttachmentsForRuntime(input.attachments);
  const prompt = resolveAcpRunPrompt({
    prompt: input.prompt,
    ...(attachmentsForPrompt?.length ? { attachments: attachmentsForPrompt } : {}),
  });
  if (!prompt) {
    throw new Error("Message is required.");
  }
  const thread = conversationStore.getThread(input.threadId);
  if (!thread) {
    throw new Error("Thread was not found.");
  }
  requireThreadCore(thread, "acp", "continue with ACP");
  await assertAcpCursorRunnableForMain();
  if (thread.status === "running" || thread.status === "queued") {
    throw new Error("Wait for the current run to finish.");
  }
  updateThread(thread.id, { status: "running", message: "" });
  const workspace = await ensureWorkspace(thread.workspacePath);
  let recordedUserActivityLineId: string | undefined;
  let attachmentsForRuntime = attachmentsForPrompt;
  if (!input.skipRecordUserPrompt) {
    const recorded = await recordUserPrompt(
      thread.id,
      input.displayPrompt?.trim() || prompt,
      attachmentsForPrompt ?? input.attachments,
    );
    recordedUserActivityLineId = recorded.line?.rewindTarget?.activityLineId ?? recorded.line?.id;
    attachmentsForRuntime = await loadPromptAttachmentsForRuntime(
      recorded.storedAttachments ?? attachmentsForPrompt ?? input.attachments,
    );
  }
  const updated = conversationStore.getThread(thread.id) ?? thread;
  if (input.runtimeConfigInput) {
    const next = normalizeThreadRuntimeConfig(parseThreadRuntimeConfigInput(input.runtimeConfigInput));
    conversationStore.saveThreadRuntimeConfig(thread.id, next);
  }
  const activeThread = conversationStore.getThread(thread.id) ?? updated;
  void startAcpThreadRun(
    toAcpThreadStartRunInput({
      thread: activeThread,
      workspace,
      prompt,
      continuation: true,
      restorePrompt: input.displayPrompt?.trim() || input.prompt,
      ...(recordedUserActivityLineId ? { recordedUserActivityLineId } : {}),
      ...(attachmentsForRuntime?.length ? { attachments: attachmentsForRuntime } : {}),
    }),
    acpRuntimeOrchestrationDeps(),
  );
  return { thread: activeThread };
}

function acpRuntimeOrchestrationDeps(): import("./acp-runtime-run").AcpRuntimeOrchestrationDeps {
  const captureSession = (threadId: string, sessionId: string, cwd: string): void => {
    const trimmedSessionId = sessionId.trim();
    conversationStore.saveThreadCoreSession({
      threadId,
      coreKind: "acp",
      externalSessionId: trimmedSessionId,
      cwd,
    });
    emitThreadEvent(threadId, "thread.session_captured", "", "system", false, {
      externalSessionId: trimmedSessionId,
    });
  };
  return {
    requireThreadCore,
    resolveSessionMode,
    startActiveRun,
    createSessionPlan,
    runThreadRequestOnce: (threadId, phase, signal, run) =>
      runThreadRequestOnce(threadId, phase, signal, () => run()),
    consumeEvents: ({ events, threadId, worktreePath, signal }) =>
      consumeSdkRunEvents({
        events,
        threadId,
        worktreePath,
        signal,
        onUsageRecorded: () => {},
        captureSession: async (id, event, cwd) => {
          if (event.type !== "session.captured" || !isRecord(event.payload)) return;
          const sessionId = typeof event.payload.sessionId === "string" ? event.payload.sessionId.trim() : "";
          if (sessionId) {
            captureSession(id, sessionId, cwd);
          }
        },
        onEvent: async (event) => {
          if (event.type === "todo.updated" && isAcpPlanTodoPayload(event.payload)) {
            applyAcpPlanProgress({
              threadId,
              entries: event.payload.entries,
              services: {
                listTodos: (id) => conversationStore.listCoderTodos(id),
                replaceTodos: (id, todos) => conversationStore.replaceCoderTodos(id, todos),
                emitTodoList,
              },
            });
            return;
          }
          if (event.type === "todo.updated" && isAcpUpdateTodosPayload(event.payload)) {
            applyAcpUpdateTodos({
              threadId,
              todos: event.payload.todos,
              merge: event.payload.merge === true,
              services: {
                listTodos: (id) => conversationStore.listCoderTodos(id),
                replaceTodos: (id, todos) => conversationStore.replaceCoderTodos(id, todos),
                emitTodoList,
              },
            });
            return;
          }
          if (event.type !== "session.title" || !isRecord(event.payload)) return;
          const title = typeof event.payload.title === "string" ? event.payload.title : "";
          applyAcpSessionTitle(threadId, title);
        },
        emitActivity: emitSdkStreamActivity,
      }),
    updateThread,
    markInterrupted: markThreadInterrupted,
    finalizeCleanup: async (threadId) => {
      await finalizeMainThreadRunCleanup({
        threadId,
        worktreePath: resolveThreadWorktreePath(threadId),
        idleFallbackMessage: "",
      });
    },
    captureSession,
    getThreadCoreSession: (threadId) => conversationStore.getThreadCoreSession(threadId),
    resolveAcpCursorEnv: () => {
      const apiKey = workflowSettingsStore.get().acpCursorApiKey?.trim();
      return apiKey ? { CURSOR_API_KEY: apiKey } : {};
    },
    resolveAcpMcpServers: async ({ threadId, workspacePath }) => {
      const prepared = await resolvePiSessionResourcesForThread(threadId, workspacePath);
      return toAcpMcpServers(prepared.mcpServers);
    },
    resolveAcpCreatePlanHandler: ({ threadId, workspacePath, userPrompt }) => {
      return async (request) => {
        const overview =
          typeof request.overview === "string" && request.overview.trim()
            ? request.overview.trim()
            : typeof request.name === "string" && request.name.trim()
              ? request.name.trim()
              : "";
        const planPayload = {
          userPrompt: userPrompt.trim() || userPrompt,
          analysis: overview,
          plan: request.plan,
          deferredExitPlanToolUseId: request.toolCallId,
        };
        const approvalRequest: PlanApprovalRequest = {
          toolUseId: request.toolCallId,
          threadId,
          userPrompt: planPayload.userPrompt,
          analysis: planPayload.analysis,
          plan: planPayload.plan,
        };
        // Park the bridge before any UI emit so approve cannot race an empty map.
        const decisionPromise = registerPendingPlanApproval(threadId, approvalRequest);
        captureThreadPlanReady({
          threadId,
          workspacePath,
          worktreePath: workspacePath,
          routesJson: "[]",
          awaitingPlanMessage: "",
          payload: planPayload,
        });
        updateThread(threadId, { status: "awaiting_plan", message: "" });
        emitThreadEvent(threadId, "plan_approval.requested", "计划已提交，等待你确认。", "planner", false, {
          plan: planPayload,
          planApproval: approvalRequest,
        });
        const decision = await decisionPromise;
        if (decision === "approved") {
          emitThreadEvent(threadId, "plan_approval.approved", "已批准计划。", "user", false, {
            planApproval: approvalRequest,
          });
          return { outcome: "accepted" as const };
        }
        conversationStore.clearPendingPlan(threadId);
        emitThreadEvent(threadId, "plan_approval.denied", "计划忽略", "user", false, {
          planApproval: approvalRequest,
        });
        return { outcome: "rejected" as const, reason: "user dismissed plan" };
      };
    },
    resolveAcpAskQuestionHandler: ({ threadId }) => {
      return createAcpAskQuestionHandler(threadId, {
        updateThreadRunning: () => {
          updateThread(threadId, { status: "running", message: "" });
        },
        emit: (type, message, clarification, toolStatus) => {
          emitThreadEvent(threadId, type, message, "planner", false, {
            ...(type === "clarification.requested" ? { clarification } : {}),
            tool: buildClarificationToolMetadata(clarification.toolUseId, toolStatus),
          });
        },
      });
    },
    resolveAcpPermissionHandler: ({ threadId, workspacePath }) => {
      return createAcpPermissionHandler(threadId, {
        getBashReviewMode: () => {
          const thread = conversationStore.getThread(threadId);
          if (!thread) return "always";
          return ensureThreadRuntimeConfig(thread).runtimeConfig?.bashReviewMode ?? "always";
        },
        getCwd: () =>
          activeRunRuntimeState.worktreePlan(threadId)?.worktreePath ||
          conversationStore.getThread(threadId)?.sdkCwd ||
          conversationStore.getThread(threadId)?.workspacePath ||
          workspacePath,
        getWorkspacePath: () => conversationStore.getThread(threadId)?.workspacePath || workspacePath,
        getPlannerAgentId: () => agentLifecycle.usagePlannerAgentId(threadId),
        getRememberPrefixes: () => activeRunRuntimeState.bashRememberPrefixes(threadId),
        evaluateConfirmation: evaluateThreadToolConfirmation,
        reviewApproval: (request, tool) => reviewThreadToolApproval(threadId, request, tool, "acp"),
        log: (phase, payload) => logUpstream(phase, payload),
        registerPending: registerPendingBashApproval,
        rememberPrefix: (tid, command) =>
          activeRunRuntimeState.rememberBashPrefix(tid, deriveBashApprovalRememberPrefix(command)),
        emit: (type, message, request) => {
          emitThreadEvent(threadId, type, message, "tool", false, bashApprovalEventExtras(request, type));
        },
      });
    },
    hasStoredPendingPlan: (threadId) => Boolean(conversationStore.getPendingPlan(threadId)),
    releasePlanBridgeKeepPending: cancelPlanApprovalsForThreadKeepPending,
    discardUnstartedTurn: discardUnstartedAcpTurn,
    applyRunDecision: async ({ threadId, decision }) => {
      await applyMainThreadRunDecisionEffects({
        threadId,
        decision,
        onCancelled: async (_reason) => {
          const thread = conversationStore.getThread(threadId);
          const plan = resolveWorktreePlan(
            thread?.workspacePath ?? "",
            threadId,
            resolveThreadWorktreePath(threadId),
          );
          await handleRunCancelled(threadId, plan);
        },
        onFailed: (reason) => {
          markThreadInterrupted(threadId, reason);
        },
        onCompleted: () => {
          updateThread(threadId, { status: "completed", message: "" });
        },
      });
    },
    errorMessage,
    loadSessionFailedMessage: (detail) =>
      mainText("native.acpLoadSessionFailed", { detail: detail.trim() ? `: ${detail.trim()}` : "" }),
    cannotResumeWithoutSessionMessage: () => mainText("native.acpCannotResumeWithoutSessionId"),
    threadHasPriorAgentOutput: (threadId) =>
      threadHasPriorAgentOutput(
        conversationStore.listActivityLines(threadId).map((line) => ({
          role: line.role,
          message: line.message,
        })),
      ),
  };
}

function piRuntimeOrchestrationDeps(): import("./pi-runtime-run").PiRuntimeOrchestrationDeps {
  return {
    ecoDataDir: app.getPath("userData"),
    requireThreadCore,
    resolveSessionMode,
    startActiveRun,
    createSessionPlan,
    resolveThreadWorktree: async (workspace: WorkspaceInfo, threadId: string) => {
      if (resolveSessionMode(conversationStore.getThread(threadId)?.runtimeConfig) === "ask") {
        return {
          worktreePlan: createSessionPlan(workspace.path, threadId),
          cwd: workspace.path,
        };
      }
      return resolveThreadWorktree(workspace, threadId);
    },
    runThreadRequestOnce: (
      threadId: string,
      phase: "execution" | "ask" | "planning" | "continuation",
      signal: AbortSignal,
      run: (context: RunAttemptContext) => Promise<RequestAttemptResult>,
    ) => runThreadRequestOnce(threadId, phase, signal, run),
    resolveRuntimeConfigForThreadId: (threadId: string) => resolveRuntimeConfigForThreadId(threadId),
    recordRouteFingerprint: recordThreadRouteFingerprint,
    startRuntimeProxy: (routes, attachments, context) => startRuntimeProxy(routes, attachments, context),
    resolvePromptImagesForMainContext,
    getGlobalContextWindowLimit: () => workflowSettingsStore.get().contextWindowLimitTokens,
    consumeEvents: async (input: {
      events: AsyncIterable<AgentEvent>;
      threadId: string;
      worktreePath: string;
      signal: AbortSignal;
    }) =>
      consumeSdkRunEvents({
        events: input.events,
        threadId: input.threadId,
        worktreePath: input.worktreePath,
        signal: input.signal,
        onUsageRecorded: onPiUsageRecordedEvent,
        captureSession: async () => {},
        emitActivity: emitSdkStreamActivity,
      }),
    applyRunDecision: async (input: {
      threadId: string;
      decision: RequestAttemptResult;
      mode: "agent" | "plan" | "ask";
      hasPendingPlan: boolean;
    }) => {
      const decision =
        input.mode === "ask"
          ? resolveAskRunOutcome(input.decision)
          : input.mode === "plan"
            ? resolvePlanningRunOutcome(input.decision, {
                hasPendingPlan: input.hasPendingPlan,
              })
            : resolveAutonomousRunOutcome(input.decision, {
                hasPendingPlan: input.hasPendingPlan,
                planCaptured: input.hasPendingPlan,
              });
      await applyMainThreadRunDecisionEffects({
        threadId: input.threadId,
        decision,
        onCancelled: async (_reason) => {
          const plan = resolveWorktreePlan(
            conversationStore.getThread(input.threadId)?.workspacePath ?? "",
            input.threadId,
            resolveThreadWorktreePath(input.threadId),
          );
          await handleRunCancelled(input.threadId, plan);
        },
        onFailed: (reason) => {
          markThreadInterrupted(input.threadId, reason);
        },
        onCompleted: () => {
          updateThread(input.threadId, {
            status: "completed",
            message: "",
          });
        },
      });
    },
    finalizeCleanup: async (threadId: string) => {
      const worktreePath = resolveThreadWorktreePath(threadId);
      await finalizeMainThreadRunCleanup({
        threadId,
        worktreePath,
        cancelClarificationsReason: "run finished",
      });
    },
    markInterrupted: markThreadInterrupted,
    updateThread,
    captureSession: (
      threadId: string,
      sessionId: string,
      cwd: string,
      metadata?: {
        sessionFile?: string;
        identityFingerprint?: string;
        mcpFingerprint?: string;
      },
    ) => {
      conversationStore.saveThreadCoreSession({
        threadId,
        coreKind: "pi",
        externalSessionId: sessionId,
        cwd,
        ...(metadata && Object.keys(metadata).length > 0
          ? {
              metadata: {
                ...(metadata.sessionFile ? { sessionFile: metadata.sessionFile } : {}),
                ...(metadata.identityFingerprint
                  ? { identityFingerprint: metadata.identityFingerprint }
                  : {}),
                ...(metadata.mcpFingerprint !== undefined ? { mcpFingerprint: metadata.mcpFingerprint } : {}),
              },
            }
          : {}),
      });
    },
    getThreadCoreSession: (threadId: string) => conversationStore.getThreadCoreSession(threadId),
    errorMessage,
    conversationStore,
    lifecycle: agentLifecycle,
    metricsRegistry: subagentMetricsRegistry,
    getBashReviewMode: (threadId) => {
      const thread = conversationStore.getThread(threadId);
      return thread
        ? (ensureThreadRuntimeConfig(thread).runtimeConfig?.bashReviewMode ?? "always")
        : "always";
    },
    getToolPermissionHandler: (threadId, skipExecutionApprovals) =>
      createThreadToolPermissionHandler(threadId, "execution", skipExecutionApprovals),
    capturePlanReady: (input) =>
      captureThreadPlanReady({
        threadId: input.threadId,
        workspacePath: input.workspacePath,
        worktreePath: input.worktreePath,
        routesJson: JSON.stringify(resolveRoleRoutesForThread(input.threadId)),
        payload: input.payload,
        awaitingPlanMessage: "",
      }),
    getIntegratedWebSearchRuntime: () => ({
      settings: integratedWebSearchSettingsStore.get(),
      ...(integratedWebSearchSettingsStore.getApiKey()
        ? { apiKey: integratedWebSearchSettingsStore.getApiKey() }
        : {}),
    }),
  };
}

function onPiUsageRecordedEvent(threadId: string, event: AgentEventLike & { id: string }): void {
  const payload = event.payload;
  if (!isRecord(payload) || payload.source !== "pi") {
    return;
  }
  const usage = parsePiUsage(
    isRecord(payload.usage)
      ? {
          input: Number(payload.usage.input_tokens ?? payload.usage.input ?? 0),
          output: Number(payload.usage.output_tokens ?? payload.usage.output ?? 0),
          cacheRead: Number(payload.usage.cache_read_input_tokens ?? payload.usage.cacheRead ?? 0),
          cacheWrite: Number(payload.usage.cache_creation_input_tokens ?? payload.usage.cacheWrite ?? 0),
          cost: {
            total:
              typeof payload.total_cost_usd === "number"
                ? payload.total_cost_usd
                : typeof payload.totalCostUsd === "number"
                  ? payload.totalCostUsd
                  : undefined,
          },
        }
      : null,
    typeof payload.model === "string" ? payload.model : undefined,
  );
  if (!usage) {
    return;
  }
  const billingRequest: SingleUsageBillingRequest = {
    threadId,
    role: typeof event.role === "string" && event.role.trim() ? event.role.trim() : "planner",
    source: "pi",
    usage,
    sourceEventId: event.id,
    updateContext: true,
    ...(typeof event.agentId === "string" && event.agentId.trim() && event.role && event.role !== "planner"
      ? { agentId: event.agentId.trim() }
      : {}),
  };
  if (usage.modelId) {
    billingRequest.modelId = usage.modelId;
  }
  if (usage.totalCostUsd !== undefined) {
    billingRequest.sourceReportedCostUsd = usage.totalCostUsd;
  }
  const runAttemptId = agentLifecycle.usageRunAttemptId(threadId);
  if (runAttemptId) {
    billingRequest.runAttemptId = runAttemptId;
  }
  const plannerAgentId = agentLifecycle.usagePlannerAgentId(threadId);
  if (plannerAgentId) {
    billingRequest.plannerAgentId = plannerAgentId;
  }
  const billingRole =
    typeof event.role === "string" && event.role.trim() ? event.role.trim() : "planner";
  const logicalRequestId = resolvePiUsageLogicalRequestId(threadLiveRequestRegistry, threadId, {
    role: billingRole,
    ...(typeof event.agentId === "string" && event.agentId.trim() ? { agentId: event.agentId.trim() } : {}),
  });
  if (logicalRequestId) {
    billingRequest.logicalRequestId = logicalRequestId;
  }
  usageLedgerCoordinator.trackUsageUpdate(
    threadId,
    processUsageBilling(billingRequest).then(
      () => undefined,
      (error) => {
        process.stderr.write(`[eco] PI usage billing failed: ${errorMessage(error)}\n`);
      },
    ),
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
  const hasBinding = binding?.coreKind === "codex" && Boolean(binding.externalSessionId.trim());
  const strategy = resolveCodexContinueStrategy({
    hasBinding,
    hasRewindTarget: Boolean(input.rewindTarget),
  });
  if (strategy.kind === "error") {
    throw new Error(strategy.message);
  }
  const continuation = strategy.kind === "resume";
  if (strategy.kind === "cold_start") {
    process.stderr.write(
      `[eco-codex] continue cold-start thread=${thread.id} reason=missing_codex_binding\n`,
    );
  }
  const settings = getModelSettingsSnapshot();
  if (input.runtimeConfigInput) {
    const next = resolveContinueThreadRuntimeConfig(
      settings,
      thread.runtimeConfig,
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

  // Cold start has no Codex remote history — carry original task + follow-up into the first turn.
  const runPrompt =
    strategy.kind === "cold_start" ? buildThreadTurnPrompt(activeThread.prompt, prompt) : prompt;

  updateThread(thread.id, { status: "running", message: "" });
  const workspace = await ensureWorkspace(thread.workspacePath);
  // Prefer finishing fork+local prune before the rewrite IPC returns (clean feed on refresh).
  // notLoaded threads need prepareCodexRuntime first — defer those to onPrepared.
  let rewindCompletedEarly = false;
  let attachmentsForRuntime: PromptImageAttachment[] | undefined;
  if (input.rewindTarget) {
    const rewindResult = await tryPrepareCodexThreadRewindEarly({
      threadId: thread.id,
      prompt,
      ...(input.attachments !== undefined ? { attachments: input.attachments } : {}),
      target: input.rewindTarget,
      ...(input.displayPrompt?.trim() ? { displayPrompt: input.displayPrompt.trim() } : {}),
    });
    rewindCompletedEarly = rewindResult.completedEarly;
    attachmentsForRuntime = await loadPromptAttachmentsForRuntime(
      rewindResult.storedAttachments ?? input.attachments,
    );
  } else if (!input.skipRecordUserPrompt) {
    const recorded = await recordUserPrompt(
      thread.id,
      input.displayPrompt?.trim() || prompt,
      input.attachments,
    );
    attachmentsForRuntime = await loadPromptAttachmentsForRuntime(
      recorded.storedAttachments ?? input.attachments,
    );
  } else {
    attachmentsForRuntime = await loadPromptAttachmentsForRuntime(input.attachments);
  }
  const updated = ensureThreadRuntimeConfig(conversationStore.getThread(thread.id) ?? activeThread);
  void startCodexThreadRun({
    thread: updated,
    workspace,
    runtimeConfig: { routes: runtime.routes },
    prompt: runPrompt,
    ...(attachmentsForRuntime?.length ? { attachments: attachmentsForRuntime } : {}),
    roleRoutes,
    continuation,
    ...(!rewindCompletedEarly && input.rewindTarget ? { rewindTarget: input.rewindTarget } : {}),
    ...(input.displayPrompt?.trim() ? { displayPrompt: input.displayPrompt.trim() } : {}),
  });
  return { thread: updated };
}

/**
 * Fork + prune when the Codex thread is already loaded (idle). Returns false when the
 * thread is notLoaded / unreadable and must wait for prepareCodexRuntime in onPrepared.
 */
async function tryPrepareCodexThreadRewindEarly(input: {
  threadId: string;
  prompt: string;
  displayPrompt?: string;
  attachments?: PromptImageAttachment[];
  target: ThreadActivityRewindTarget;
}): Promise<{ completedEarly: boolean; storedAttachments?: PromptImageAttachment[] }> {
  const targetItemId = input.target.userMessageId?.trim();
  if (!targetItemId) {
    throw new Error("该节点缺少当前 Codex 消息 id，无法安全 fork。");
  }
  await ensureCodexControlPlaneClient();
  const status = await queryCodexThreadStatusForEcoThread(input.threadId);
  if (status === undefined || status === "notLoaded") {
    return { completedEarly: false };
  }
  if (status !== "idle" && status !== "systemError") {
    throw new Error(
      `Codex fork requires an idle thread; current status is ${status}. Wait for the active turn to finish, then retry.`,
    );
  }
  await forkCodexThreadForEcoThread({
    ecoThreadId: input.threadId,
    targetItemId,
  });
  const recorded = await recordUserPrompt(
    input.threadId,
    input.displayPrompt?.trim() || input.prompt,
    input.attachments,
  );
  emitThreadRunProjectionUpdated(input.threadId);
  return {
    completedEarly: true,
    ...(recorded.storedAttachments?.length ? { storedAttachments: recorded.storedAttachments } : {}),
  };
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
    const threadRuntimeForIntegrations = ensureThreadRuntimeConfig(
      conversationStore.getThread(input.thread.id) ?? input.thread,
    ).runtimeConfig;
    const sessionEcoBrowserEnabled =
      browserSettingsStore.get().agentIntegrationEnabled &&
      integrationEnabled(threadRuntimeForIntegrations?.integrationsEnabled, "browser");
    const sessionComputerUseEnabled =
      computerUseSettingsStore.get().agentIntegrationEnabled &&
      integrationEnabled(threadRuntimeForIntegrations?.integrationsEnabled, "computerUse");
    const sessionImageGenerationEnabled =
      imageGenerationStore.getSettings().enabled &&
      integrationEnabled(threadRuntimeForIntegrations?.integrationsEnabled, "imageGeneration");
    const codexAgentRegistry = resolveAgentRuntimeConfigForThreadId(input.thread.id);
    const codexPlannerRoute = resolveRoleRoutesForThread(input.thread.id).find(
      (route) => route.role === "planner",
    );
    const codexWebSearchPlan = resolveThreadWebSearchPlan({
      networkWebSearch: codexAgentRegistry
        ? materializeEcoToolPolicy(codexAgentRegistry.orchestration.mainAgent.tools).network?.webSearch
        : undefined,
      ...(codexPlannerRoute?.manualSpec ? { plannerManualSpec: codexPlannerRoute.manualSpec } : {}),
      integratedSettings: integratedWebSearchSettingsStore.get(),
      ...(integratedWebSearchSettingsStore.getApiKey()
        ? { integratedApiKey: integratedWebSearchSettingsStore.getApiKey()! }
        : {}),
    });
    const sessionIntegratedWebSearchEnabled = codexWebSearchPlan.backend === "integrated";
    const ecoBrowserSkillFile = sessionEcoBrowserEnabled
      ? resolveEcoAgentBrowserSkillFileForCodex()
      : undefined;
    if (sessionEcoBrowserEnabled && !ecoBrowserSkillFile) {
      throw new Error("本会话已开启内置浏览器，但未找到打包的 eco-agent-browser skill 文件。");
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
          resolveSystemPromptAppend: () => {
            let append = requireBrowserHost().getAgentPromptAppend(sessionEcoBrowserEnabled, input.thread.id);
            if (sessionComputerUseEnabled) {
              append = appendBrowserPrompt(append, computerUseGateway.getAgentPromptAppend(true));
            }
            if (sessionImageGenerationEnabled) {
              append = appendBrowserPrompt(
                append,
                buildImageGenerationPromptAppend(imageGenerationStore.getActiveClientConfig()),
              );
            }
            append = appendBrowserPrompt(append, buildImageViewPromptAppend());
            append = appendBrowserPrompt(append, buildImageDisplayPromptAppend());
            if (centerServerClient.getHtmlHostingCapability().available) {
              append = appendBrowserPrompt(append, buildHtmlHostPromptAppend());
            }
            if (sessionIntegratedWebSearchEnabled) {
              append = appendBrowserPrompt(
                append,
                buildIntegratedWebSearchPromptAppend(
                  integratedWebSearchSettingsStore.get().provider === "tavily"
                    ? "Tavily"
                    : integratedWebSearchSettingsStore.get().provider === "doubao"
                      ? "Doubao Search"
                      : "Brave Search",
                ),
              );
            }
            return append;
          },
          resolveWebSearchOverride: () =>
            sessionIntegratedWebSearchEnabled ? ("disabled" as const) : undefined,
          resolveExecutionConfirmationMode: () =>
            ensureThreadRuntimeConfig(conversationStore.getThread(input.thread.id) ?? input.thread)
              .runtimeConfig?.bashReviewMode ?? "always",
          resolveSubagentAvailability: () =>
            ensureThreadRuntimeConfig(conversationStore.getThread(input.thread.id) ?? input.thread)
              .runtimeConfig?.subagentEnabled,
          resolveMcpServers: async () => {
            const globalPool = await resolveCodexGlobalMcpServers();
            if (sessionEcoBrowserEnabled) {
              const browserInject = await requireBrowserHost().resolveAgentBrowserMcpInjection({
                threadId: input.thread.id,
                sessionEnabled: true,
              });
              if (!browserInject.enabled || !browserInject.codexServer) {
                throw new Error(
                  `本会话已开启内置浏览器，但不可用：${browserInject.unavailableReason ?? "未知原因"}`,
                );
              }
            }
            if (sessionImageGenerationEnabled) {
              const imageInject = await imageGenerationGateway.resolveInjection({
                threadId: input.thread.id,
                sessionEnabled: true,
              });
              if (!imageInject.enabled || !imageInject.codexServer) {
                throw new Error(
                  `本会话已开启创意绘画，但不可用：${imageInject.unavailableReason ?? "未知原因"}`,
                );
              }
            }
            if (sessionComputerUseEnabled) {
              const computerUseInject = await computerUseGateway.resolveInjection({
                threadId: input.thread.id,
                sessionEnabled: true,
              });
              if (!computerUseInject.enabled || !computerUseInject.codexServer) {
                throw new Error(
                  `本会话已开启电脑操控，但不可用：${computerUseInject.unavailableReason ?? "未知原因"}`,
                );
              }
            }
            if (sessionIntegratedWebSearchEnabled) {
              const webSearchInject = await integratedWebSearchGateway.resolveInjection({
                threadId: input.thread.id,
                sessionEnabled: true,
              });
              if (!webSearchInject.enabled || !webSearchInject.codexServer) {
                throw new Error(
                  `本会话需要 Integrated Web Search，但不可用：${webSearchInject.unavailableReason ?? "未知原因"}`,
                );
              }
            }
            await imageViewGateway.resolveInjection(input.thread.id);
            await imageDisplayGateway.resolveInjection(input.thread.id);
            const htmlCap = await centerServerClient.refreshHtmlHostingCapability();
            if (htmlCap.available) {
              await htmlHostGateway.resolveInjection(input.thread.id);
            }
            return globalPool;
          },
          resolveEnabledMcpServerKeys: async () => {
            const keys = resolveCodexThreadMcpServerKeys(input.thread.id).filter(
              (key) => !key.startsWith("eco_ab_"),
            );
            if (sessionEcoBrowserEnabled && !keys.includes(ECO_AGENT_BROWSER_MCP_SERVER)) {
              keys.push(ECO_AGENT_BROWSER_MCP_SERVER);
            }
            if (sessionComputerUseEnabled && !keys.includes(ECO_COMPUTER_USE_MCP_SERVER)) {
              keys.push(ECO_COMPUTER_USE_MCP_SERVER);
            }
            if (sessionImageGenerationEnabled && !keys.includes(ECO_IMAGE_GENERATION_MCP_SERVER)) {
              keys.push(ECO_IMAGE_GENERATION_MCP_SERVER);
            }
            if (sessionIntegratedWebSearchEnabled && !keys.includes(ECO_WEB_SEARCH_MCP_SERVER)) {
              keys.push(ECO_WEB_SEARCH_MCP_SERVER);
            }
            if (!keys.includes(ECO_IMAGE_VIEW_MCP_SERVER)) {
              keys.push(ECO_IMAGE_VIEW_MCP_SERVER);
            }
            if (!keys.includes(ECO_IMAGE_DISPLAY_MCP_SERVER)) {
              keys.push(ECO_IMAGE_DISPLAY_MCP_SERVER);
            }
            const htmlCap = centerServerClient.getHtmlHostingCapability();
            if (htmlCap.available && !keys.includes(ECO_HTML_HOST_MCP_SERVER)) {
              keys.push(ECO_HTML_HOST_MCP_SERVER);
            }
            return keys.filter(
              (key) =>
                (key !== ECO_AGENT_BROWSER_MCP_SERVER || sessionEcoBrowserEnabled) &&
                (key !== ECO_COMPUTER_USE_MCP_SERVER || sessionComputerUseEnabled) &&
                (key !== ECO_IMAGE_GENERATION_MCP_SERVER || sessionImageGenerationEnabled) &&
                (key !== ECO_WEB_SEARCH_MCP_SERVER || sessionIntegratedWebSearchEnabled) &&
                (key !== ECO_HTML_HOST_MCP_SERVER || centerServerClient.getHtmlHostingCapability().available),
            );
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
          skillDiscoveryCwd: cwd,
          onPrepared: async () => {
            if (input.rewindTarget) {
              const targetItemId = input.rewindTarget.userMessageId?.trim();
              if (!targetItemId) {
                throw new Error("该节点缺少当前 Codex 消息 id，无法安全 fork。");
              }
              await forkCodexThreadForEcoThread({
                ecoThreadId: input.thread.id,
                targetItemId,
              });
              // Prune removes attempts started after the edited user message, including the
              // continuation attempt created by startRunAttempt. Rehydrate before recording
              // the replacement prompt so feed attribution stays attached to this turn.
              agentLifecycle.rehydrateCurrentRunAttempt(input.thread.id);
              await recordUserPrompt(
                input.thread.id,
                input.displayPrompt?.trim() || input.prompt,
                input.attachments,
              );
              // Turn sections sort by attempt.startedAt while user prompts sort by event.at.
              // Retime the attempt after the replacement prompt so the turn stays below it.
              agentLifecycle.rehydrateCurrentRunAttempt(input.thread.id);
              scheduleThreadRunProjectionUpdated(input.thread.id, { streaming: false });
            }
            await codexFileCheckpointStore.capturePending(input.thread.id, cwd);
          },
          onConfigReloadWait: () => {
            updateThread(input.thread.id, {
              status: "running",
              message: "",
            });
          },
          recordRouteFingerprint: recordThreadRouteFingerprint,
          onProxyReady: () => {
            patchThreadSummary(input.thread.id, {
              status: "running",
              message: "",
            });
          },
          run: async ({ routes }) => {
            const driver = createCodexRuntimeDriver(input.thread.id, mode, {
              enableMidTurnPort: true,
              onTurnBound: ({ ecoThreadId, codexThreadId, turnId }) => {
                const client = getGlobalCodexRuntimeLifecycle()?.getClient();
                if (!client) {
                  return;
                }
                codexMidTurnPorts.open(ecoThreadId, {
                  client,
                  codexThreadId,
                  turnId,
                });
              },
              onTurnClosing: async ({ ecoThreadId }) => {
                await codexMidTurnPorts.closeIngress(ecoThreadId);
              },
              onTurnClosed: ({ ecoThreadId }) => {
                codexMidTurnPorts.close(ecoThreadId);
              },
            });
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
      updateThread(input.thread.id, { status: "completed", message: "" });
    } else if (conversationStore.getThread(input.thread.id)?.status !== "awaiting_plan") {
      updateThread(input.thread.id, { status: "idle", message: "" });
    }
  } catch (error) {
    markThreadInterrupted(input.thread.id, errorMessage(error));
  } finally {
    await finalizeMainThreadRunCleanup({
      threadId: input.thread.id,
      worktreePath: cwd,
      idleFallbackMessage: "",
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
    availableMcpServerKeys: [...listEnabledGlobalMcpServerKeys(mcpStore.listServers())],
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
      const sessionEnabled = integrationEnabled(
        thread ? ensureThreadRuntimeConfig(thread).runtimeConfig?.integrationsEnabled : undefined,
        "browser",
      );
      entries.push({
        skill: buildEcoAgentBrowserCodexSkillInfo(skillFile),
        enabled: sessionEnabled,
      });
    }
  }
  return entries;
}

async function resolvePiSkillPathsForThread(threadId: string, workspacePath: string): Promise<string[]> {
  const thread = conversationStore.getThread(threadId);
  const skillsEnabled = thread ? ensureThreadRuntimeConfig(thread).runtimeConfig?.skillsEnabled : undefined;
  const entries = await resolvePiThreadSkills({
    workspacePath,
    ...(skillsEnabled ? { skillsEnabled } : {}),
  });
  return piSkillDirectoriesForSession(entries);
}

/**
 * Resolve PI skill paths + isolated MCP/integration injection for one thread run.
 */
async function resolvePiSessionResourcesForThread(
  threadId: string,
  workspacePath: string,
): Promise<{
  skillPaths: string[];
  mcpServers: Record<string, unknown>;
  appendSystemPrompt: string[];
}> {
  const skillPaths = await resolvePiSkillPathsForThread(threadId, workspacePath);
  const thread = conversationStore.getThread(threadId);
  const hydrated = thread ? ensureThreadRuntimeConfig(thread) : undefined;
  const settings = getModelSettingsSnapshot();
  const availableMcpServerKeys = listEnabledGlobalMcpServerKeys(mcpStore.listServers());
  const enabledMcpServers = resolveThreadRuntimeMcpServerKeys({
    ...(hydrated?.runtimeConfig ? { runtimeConfig: hydrated.runtimeConfig } : {}),
    settings,
    availableMcpServerKeys,
  });

  const sessionEcoBrowserEnabled =
    browserSettingsStore.get().agentIntegrationEnabled &&
    integrationEnabled(hydrated?.runtimeConfig?.integrationsEnabled, "browser");
  const sessionComputerUseEnabled =
    computerUseSettingsStore.get().agentIntegrationEnabled &&
    integrationEnabled(hydrated?.runtimeConfig?.integrationsEnabled, "computerUse");
  const sessionImageGenerationEnabled =
    imageGenerationStore.getSettings().enabled &&
    integrationEnabled(hydrated?.runtimeConfig?.integrationsEnabled, "imageGeneration");

  const browserInject = await requireBrowserHost().resolveAgentBrowserMcpInjection({
    threadId,
    sessionEnabled: sessionEcoBrowserEnabled,
  });
  if (sessionEcoBrowserEnabled && !browserInject.enabled) {
    throw new Error(`本会话已开启内置浏览器，但不可用：${browserInject.unavailableReason ?? "未知原因"}`);
  }
  const computerUseInject = await computerUseGateway.resolveInjection({
    threadId,
    sessionEnabled: sessionComputerUseEnabled,
  });
  if (sessionComputerUseEnabled && !computerUseInject.enabled) {
    throw new Error(`本会话已开启电脑操控，但不可用：${computerUseInject.unavailableReason ?? "未知原因"}`);
  }
  const imageInject = await imageGenerationGateway.resolveInjection({
    threadId,
    sessionEnabled: sessionImageGenerationEnabled,
  });
  if (sessionImageGenerationEnabled && !imageInject.enabled) {
    throw new Error(`本会话已开启创意绘画，但不可用：${imageInject.unavailableReason ?? "未知原因"}`);
  }
  const imageViewInject = await imageViewGateway.resolveInjection(threadId);
  const imageDisplayInject = await imageDisplayGateway.resolveInjection(threadId);
  const htmlHostingCapability = await centerServerClient.refreshHtmlHostingCapability();
  const htmlHostInject = htmlHostingCapability.available
    ? await htmlHostGateway.resolveInjection(threadId)
    : undefined;

  let browserSkillDirectory: string | undefined;
  if (browserInject.enabled) {
    const skillFile = resolveEcoAgentBrowserSkillFileForCodex();
    if (!skillFile) {
      throw new Error("本会话已开启内置浏览器，但未找到打包的 eco-agent-browser skill 文件。");
    }
    browserSkillDirectory = path.dirname(skillFile);
  }

  const mcpSession = buildPiMcpSessionConfig({
    globalSdkConfig: mcpStore.buildSdkConfig(),
    enabledMcpServerKeys: enabledMcpServers,
    browserInject: {
      enabled: browserInject.enabled,
      ...(browserInject.sdkEntry ? { sdkEntry: browserInject.sdkEntry } : {}),
      ...(browserInject.promptAppend ? { promptAppend: browserInject.promptAppend } : {}),
    },
    computerUseInject: {
      enabled: computerUseInject.enabled,
      ...(computerUseInject.sdkEntry ? { sdkEntry: computerUseInject.sdkEntry } : {}),
      ...(computerUseInject.promptAppend ? { promptAppend: computerUseInject.promptAppend } : {}),
    },
    imageInject: {
      enabled: imageInject.enabled,
      ...(imageInject.sdkEntry ? { sdkEntry: imageInject.sdkEntry } : {}),
      ...(imageInject.promptAppend ? { promptAppend: imageInject.promptAppend } : {}),
    },
    imageViewInject: {
      enabled: true,
      sdkEntry: imageViewInject.sdkEntry,
      promptAppend: imageViewInject.promptAppend,
    },
    imageDisplayInject: {
      enabled: true,
      sdkEntry: imageDisplayInject.sdkEntry,
      promptAppend: imageDisplayInject.promptAppend,
    },
    ...(htmlHostInject
      ? {
          htmlHostInject: {
            enabled: true,
            sdkEntry: htmlHostInject.sdkEntry,
            promptAppend: htmlHostInject.promptAppend,
          },
        }
      : {}),
    ...(browserSkillDirectory ? { browserSkillDirectory } : {}),
  });

  return {
    skillPaths: [
      ...new Set([...skillPaths, ...mcpSession.extraSkillDirectories].map((entry) => path.resolve(entry))),
    ].sort((a, b) => a.localeCompare(b)),
    mcpServers: mcpSession.mcpServers,
    appendSystemPrompt: mergePiAppendSystemPrompt(
      definedProps({
        globalUserRules: personalizationSettingsStore.get().globalRules,
        integrationAppend: mcpSession.appendSystemPrompt,
      }),
    ),
  };
}

/**
 * PI hot-reloads skills on the next run via AgentSession.reload.
 * Unlike Codex, idle PI sessions do not block Skills toggles.
 */
function assertPiSkillsConfigReloadAllowed(
  threadStatus: string | undefined,
  existingSkills: SkillsEnabledSettings | undefined,
  nextSkills: SkillsEnabledSettings | undefined,
): void {
  const skillsChanged = skillsEnabledSettingsChanged(existingSkills, nextSkills);
  if (
    shouldBlockPiSkillsConfigReload({
      skillsChanged,
      threadStatus,
    })
  ) {
    throw new Error("请等待当前运行结束后再修改 Skills。");
  }
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
    const outcome = await runThreadRequestOnce(
      thread.id,
      "ask",
      controller.signal,
      async (attemptContext) => {
        const mainPrompt = await resolvePromptImagesForMainContext({
          threadId: thread.id,
          prompt,
          ...(attachments?.length ? { attachments } : {}),
          ...(routesOverride ? { routesOverride } : {}),
          signal: controller.signal,
        });
        return runThreadRequestWithLiveRequestLifecycle({
          context: attemptContext,
          resolveRuntimeConfig: () => resolveRuntimeConfigForThreadId(thread.id, routesOverride),
          recordRouteFingerprint: recordThreadRouteFingerprint,
          startRuntimeProxy,
          onProxyReady: ({ proxy }) => {
            process.stderr.write(
              `[eco] 模型代理: ${proxy.baseUrl} · 上游日志: ${getUpstreamLogFilePath()}\n`,
            );
            patchThreadSummary(thread.id, {
              status: "running",
              message: "",
            });
          },
          run: async ({ proxy: attemptProxy, routes }) => {
            const resumeOpts = resume ?? resolveResumeOptions(thread.id, cwd);
            try {
              const driver = createSdkDriver(thread.id, attemptProxy, undefined, "ask");
              if (!driver.runAsk) {
                throw new Error("Runtime driver does not support ask mode.");
              }

              return await consumeSdkRunEvents({
                events: driver.runAsk(
                  buildDesktopSdkRunInput({
                    threadId: thread.id,
                    prompt: mainPrompt,
                    workspacePath: workspace.path,
                    worktreePath: cwd,
                    routes,
                    signal: controller.signal,
                    sdkSession: await buildSdkSessionOptions(thread.id, mainPrompt),
                    agentRegistry: resolveAgentRuntimeConfigForThread(thread),
                    ...(resumeOpts ? { resume: resumeOpts } : {}),
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
      onCompleted: () => {
        updateThread(thread.id, { status: "completed", message: "" });
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
      idleFallbackMessage: "",
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

    const outcome = await runThreadRequestOnce(
      thread.id,
      "planning",
      controller.signal,
      async (attemptContext) => {
        const mainPrompt = await resolvePromptImagesForMainContext({
          threadId: thread.id,
          prompt,
          ...(attachments?.length ? { attachments } : {}),
          ...(routesOverride ? { routesOverride } : {}),
          signal: controller.signal,
        });
        return runThreadRequestWithLiveRequestLifecycle({
          context: attemptContext,
          resolveRuntimeConfig: () => resolveRuntimeConfigForThreadId(thread.id, routesOverride),
          recordRouteFingerprint: recordThreadRouteFingerprint,
          startRuntimeProxy,
          onProxyReady: ({ proxy }) => {
            process.stderr.write(
              `[eco] 模型代理: ${proxy.baseUrl} · 上游日志: ${getUpstreamLogFilePath()}\n`,
            );
            patchThreadSummary(thread.id, {
              status: "running",
              message: "",
            });
          },
          run: async ({ proxy: attemptProxy, routes }) => {
            const resumeOpts = resume ?? resolveResumeOptions(thread.id, effectiveCwd);
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
                    prompt: mainPrompt,
                    workspacePath: workspace.path,
                    worktreePath: effectiveCwd,
                    routes,
                    signal: controller.signal,
                    sdkSession: await buildSdkSessionOptions(thread.id, mainPrompt, {
                      skillsScope: "planning",
                    }),
                    agentRegistry: resolveAgentRuntimeConfigForThread(thread),
                    ...(resumeOpts ? { resume: resumeOpts } : {}),
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
                      awaitingPlanMessage: "",
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
      },
    );

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
      idleFallbackMessage: "",
    });
  }
}

async function completeCodingThreadRun(threadId: string, worktreePlan: WorktreePlan): Promise<void> {
  if (isDirectWorkspacePlan(worktreePlan)) {
    updateThread(threadId, { status: "completed", message: "" });
    return;
  }

  try {
    const { files, diff } = await gitWorktrees.collectWorktreeChanges(worktreePlan);
    if (files.length > 0) {
      conversationStore.saveAppliedDiff(threadId, worktreePlan.workspacePath, diff, files);
      const summary = buildWorktreeMergeSummary(diff, files);
      emitThreadEvent(threadId, "workspace.changes", serializeWorktreeMergeMessage(summary), "system");
      updateThread(threadId, { status: "completed", message: "" });
      return;
    }
    updateThread(threadId, {
      status: "completed",
      message: "",
    });
  } catch (error) {
    process.stderr.write(`[eco] workspace diff snapshot failed: ${errorMessage(error)}\n`);
    updateThread(threadId, { status: "completed", message: "" });
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
    patchThreadSummary(thread.id, {
      message: "",
      status: "running",
    });

    const resumeOptsForRun = resume ?? resolveResumeOptions(thread.id, cwd);

    const runOutcome = await runThreadRequestOnce(
      thread.id,
      "execution",
      controller.signal,
      async (attemptContext) => {
        const mainPrompt = await resolvePromptImagesForMainContext({
          threadId: thread.id,
          prompt,
          ...(attachments?.length ? { attachments } : {}),
          ...(routesOverride ? { routesOverride } : {}),
          signal: controller.signal,
        });
        return runThreadRequestWithLiveRequestLifecycle({
          context: attemptContext,
          resolveRuntimeConfig: () => resolveRuntimeConfigForThreadId(thread.id, routesOverride),
          recordRouteFingerprint: recordThreadRouteFingerprint,
          startRuntimeProxy,
          onProxyReady: ({ proxy, plannerRoute }) => {
            process.stderr.write(
              `[eco] 模型代理: ${proxy.baseUrl} · 上游日志: ${getUpstreamLogFilePath()}\n`,
            );
            patchThreadSummary(thread.id, {
              message: "",
              status: "running",
            });
            process.stderr.write(
              `[eco] SDK model=${plannerRoute?.modelId ?? "?"} (direct / claude_code preset)\n`,
            );
          },
          run: async ({ proxy: attemptProxy, routes }) => {
            try {
              const driver = createSdkDriver(
                thread.id,
                attemptProxy,
                taskRunHooks.hookContextExtras,
                "execution",
              );
              return await consumeSdkRunEvents({
                events: driver.run(
                  buildDesktopSdkRunInput({
                    threadId: thread.id,
                    prompt: mainPrompt,
                    workspacePath: workspace.path,
                    worktreePath: cwd,
                    routes,
                    signal: controller.signal,
                    sdkSession: await buildSdkSessionOptions(thread.id, mainPrompt),
                    agentRegistry: resolveAgentRuntimeConfigForThread(thread),
                    ...(resumeOptsForRun ? { resume: resumeOptsForRun } : {}),
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
          assertSdkSessionRetainedOnRunFailure({
            hadResume: Boolean(resumeOptsForRun),
            reason,
          });
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
      idleFallbackMessage: "",
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
    ...(pending.planFilePath ? { planFilePath: pending.planFilePath } : {}),
    ...(options?.planUserEdited !== undefined ? { planUserEdited: options.planUserEdited } : {}),
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
      async (attemptContext) => {
        const followUp = options?.followUp?.trim();
        const runPrompt = followUp || pending.userPrompt;
        const mainPrompt = await resolvePromptImagesForMainContext({
          threadId,
          prompt: runPrompt,
          ...(options?.attachments?.length ? { attachments: options.attachments } : {}),
          ...(options?.routesOverride ? { routesOverride: options.routesOverride } : {}),
          signal: controller.signal,
        });
        return runThreadRequestWithLiveRequestLifecycle({
          context: attemptContext,
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
              const resume = options?.resume ?? resolveResumeOptions(threadId, executionCwd);
              const continuationPlanning = resume
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
                  buildDesktopSdkRunInput({
                    threadId,
                    prompt: mainPrompt,
                    workspacePath: pending.workspacePath,
                    worktreePath: executionCwd,
                    routes: attemptRoutes,
                    signal: controller.signal,
                    sdkSession: await buildSdkSessionOptions(threadId, mainPrompt),
                    agentRegistry: resolveAgentRuntimeConfigForThreadId(threadId),
                    ...(resume ? { resume } : {}),
                    ...(resume && {
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
      idleFallbackMessage: "",
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
  /** Mid-turn already wrote thread.user_prompt for this follow-up; drain must not duplicate. */
  skipRecordUserPrompt?: boolean;
}

async function startThreadContinuation(input: StartThreadContinuationInput): Promise<ThreadContinueResult> {
  const thread = conversationStore.getThread(input.threadId);
  if (!thread) {
    throw new Error("Thread was not found.");
  }
  if (!thread.coreKind) {
    throw new Error(`Thread ${thread.id} has unknown Core ownership.`);
  }
  const resolvedTarget = input.rewindTarget
    ? conversationStore.getActivityRewindTarget(input.threadId, input.rewindTarget.activityLineId)
    : undefined;
  if (input.rewindTarget && !resolvedTarget) {
    throw new Error("该节点缺少当前 SDK 消息映射，无法安全改写。");
  }
  return threadRuntimeCoordinator.continue(thread.coreKind, {
    ...input,
    ...(resolvedTarget ? { rewindTarget: resolvedTarget } : {}),
  });
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
    const nextConfig = resolveContinueThreadRuntimeConfig(
      settings,
      thread.runtimeConfig,
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

  // Rewind mutates the persisted activity/session state. Capture the source
  // history before that mutation so rewinding the first user turn (which
  // clears the SDK session entirely) can still resolve the continuation mode.
  const activityLinesBeforeRewind = input.rewindTarget
    ? await listThreadActivityFromSdkSession(input.threadId)
    : undefined;
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
    ? activityLinesBeforeRewindTarget(activityLinesBeforeRewind ?? [], input.rewindTarget)
    : await listThreadActivityFromSdkSession(input.threadId);
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

  const agentPrompt =
    continueAction.kind === "resume_sdk" || continueAction.kind === "resume_execution"
      ? prompt
      : buildAgentPromptWithContext(effectiveThread.prompt, prompt, activityLines);

  updateThread(input.threadId, {
    status: "running",
    message: "",
  });
  let attachmentsForRuntime = await loadPromptAttachmentsForRuntime(input.attachments);
  if (!input.skipRecordUserPrompt) {
    const recorded = await recordUserPrompt(
      input.threadId,
      input.displayPrompt?.trim() || prompt,
      input.attachments,
    );
    attachmentsForRuntime = await loadPromptAttachmentsForRuntime(
      recorded.storedAttachments ?? input.attachments,
    );
  }
  if (input.rewindTarget) {
    // Publish the new history revision only after its replacement prompt exists.
    // An empty rewind projection can otherwise race the renderer refresh and make
    // a live continuation look as though it was never submitted.
    emitThreadRunProjectionUpdated(input.threadId);
  }

  const updated: ThreadSummary = {
    ...effectiveThread,
    status: "running",
    message: "",
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
    ...(attachmentsForRuntime?.length ? { attachments: attachmentsForRuntime } : {}),
    roleRoutes,
    ...(rewindResume && { resumeOverride: rewindResume }),
  }).catch((error) => {
    markThreadInterrupted(input.threadId, errorMessage(error));
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
  const prompt = resolveThreadMessagePrompt(payload.prompt, attachments);
  if (!prompt) {
    throw new Error("Follow-up message is required.");
  }
  const priority = payload.priority === "escalated" ? "escalated" : "normal";
  const followUpDeliveryMode =
    payload.followUpDeliveryMode === "queue" || payload.followUpDeliveryMode === "steer"
      ? payload.followUpDeliveryMode
      : undefined;
  return {
    threadId,
    prompt,
    ...(attachments.length > 0 ? { attachments } : {}),
    priority,
    ...(followUpDeliveryMode ? { followUpDeliveryMode } : {}),
  };
}

function parseThreadFollowUpEscalateRequest(payload: unknown): ThreadFollowUpEscalateRequest {
  if (!isRecord(payload)) {
    throw new Error("Invalid follow-up escalation payload.");
  }
  const threadId = readRequiredString(payload.threadId, "Thread id is required.");
  const followUpId = readOptionalString(payload.followUpId);
  const attachments = parsePromptImageAttachments(payload.attachments);
  const prompt = resolveThreadMessagePrompt(payload.prompt, attachments);
  if (!followUpId && !prompt) {
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

function parseThreadFollowUpQueuePausedRequest(payload: unknown): ThreadFollowUpQueuePausedRequest {
  if (!isRecord(payload)) {
    throw new Error("Invalid follow-up queue pause payload.");
  }
  if (typeof payload.paused !== "boolean") {
    throw new Error("Follow-up queue paused flag is required.");
  }
  return {
    threadId: readRequiredString(payload.threadId, "Thread id is required."),
    paused: payload.paused,
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
  const prompt = resolveThreadMessagePrompt(payload.prompt, attachments);
  if (!prompt) {
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

function parsePromptImageAttachments(value: unknown): PromptImageAttachment[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const attachments: PromptImageAttachment[] = [];
  for (const entry of value) {
    if (!isPromptImageAttachmentRecord(entry)) {
      throw new Error("Invalid image attachment.");
    }
    attachments.push({
      mediaType: entry.mediaType,
      ...(entry.data?.trim() ? { data: entry.data.trim() } : {}),
      ...(entry.path?.trim() ? { path: entry.path.trim() } : {}),
    });
  }
  return attachments;
}

async function normalizeComposerDraftAttachments(
  contextKey: string,
  attachments: readonly PromptImageAttachment[],
): Promise<PromptImageAttachment[]> {
  if (attachments.length === 0) {
    return [];
  }
  const existing = conversationStore.getComposerDraft(contextKey);
  const previousPaths = promptImageFileStore.collectAttachmentPaths(existing?.attachments);
  const next: PromptImageAttachment[] = [];
  const keptPaths = new Set<string>();

  for (const attachment of attachments) {
    const filePath = attachment.path?.trim();
    if (filePath && promptImageFileStore.isManagedPath(filePath)) {
      next.push({ mediaType: attachment.mediaType, path: filePath });
      keptPaths.add(filePath);
      continue;
    }
    const data = attachment.data?.trim();
    if (!data) {
      continue;
    }
    const staged = await promptImageFileStore.stageComposerImage({
      contextKey,
      imageId: `draft_${randomUUID()}`,
      mediaType: attachment.mediaType,
      dataBase64: data,
    });
    next.push({ mediaType: attachment.mediaType, path: staged.path });
    keptPaths.add(staged.path);
  }

  const released = previousPaths.filter((filePath) => !keptPaths.has(filePath));
  if (released.length > 0) {
    await promptImageFileStore.releasePaths(released);
  }
  return next;
}

async function loadPromptAttachmentsForRuntime(
  attachments?: readonly PromptImageAttachment[],
): Promise<PromptImageAttachment[] | undefined> {
  if (!attachments?.length) {
    return undefined;
  }
  return promptImageFileStore.resolveAttachmentsForRuntime(attachments);
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

/**
 * Mid-turn delivery for Claude (streamInput) and Codex (turn/steer).
 * Pure-text only; attachments / blocked approvals / no accepting port stay queued.
 * Returns a handled row (applied, failed, or concurrently finalized); undefined
 * only when the row is safely queued for the existing drain/interrupt path.
 *
 * After claim, inserts a local user bubble **before** the async inject so Feed
 * order matches Codex-style mid-turn (user turn boundary between prior process
 * and the steered reply) — not after the model finishes answering.
 */
async function tryDeliverFollowUpViaMidTurn(
  thread: ThreadSummary,
  followUp: ThreadPendingFollowUp,
): Promise<ThreadPendingFollowUp | undefined> {
  if (!coreSupportsMidTurnFollowUp(thread.coreKind)) {
    return undefined;
  }
  if ((followUp.attachments?.length ?? 0) > 0) {
    return undefined;
  }
  const prompt = followUp.prompt.trim();
  if (!prompt) {
    return undefined;
  }
  const isCodex = thread.coreKind === "codex";
  const claimed = await withThreadFollowUpLock(thread.id, async () => {
    if (
      shouldBlockThreadFollowUpDrain({
        hasPendingBridgeApproval: Boolean(getPendingPlanApprovalForThread(thread.id)),
        hasPendingClarification: Boolean(getPendingClarificationForThread(thread.id)),
        hasEditingFollowUp: editingThreadFollowUpByThread.has(thread.id),
        hasFollowUpQueuePaused: Boolean(thread.followUpQueuePaused),
        ...(thread.status && { threadStatus: thread.status }),
        hasStoredPendingPlan: Boolean(conversationStore.getPendingPlan(thread.id)),
      })
    ) {
      return undefined;
    }
    if (!activeRunRuntimeState.hasRun(thread.id)) {
      return undefined;
    }

    if (isCodex) {
      if (!codexMidTurnPorts.isAccepting(thread.id)) {
        return undefined;
      }
    } else if (!claudeMidTurnPorts.isAccepting(thread.id)) {
      return undefined;
    }

    const excludeFollowUpId = editingFollowUpClaimExclusion(thread.id);
    return conversationStore.claimThreadFollowUpStreamingPush(thread.id, followUp.id, {
      ...(excludeFollowUpId ? { excludeFollowUpId } : {}),
    });
  });
  if (!claimed) {
    logEcoDiag(isCodex ? "follow_up.turn_steer_claim_miss" : "follow_up.stream_input_claim_miss", {
      threadId: shortThreadId(thread.id),
      followUpId: followUp.id,
    });
    return conversationStore.getThreadFollowUp(thread.id, followUp.id);
  }

  // Insert between turns immediately after reserving the row (before await inject).
  await recordUserPrompt(thread.id, prompt);
  midTurnLocalUserPromptFollowUpIds.add(claimed.id);

  const push = isCodex
    ? await codexMidTurnPorts.tryPushUserText(thread.id, prompt, {
        clientUserMessageId: followUp.id,
      })
    : await claudeMidTurnPorts.tryPushUserText(thread.id, prompt, {
        uuid: followUp.id,
      });

  if (!push.ok) {
    if (push.deliveryUnknown) {
      const failed =
        conversationStore.markThreadFollowUpDeliveryUnknown(
          thread.id,
          claimed.id,
          `${isCodex ? "Codex turn/steer" : "Claude streamInput"} delivery is unknown: ${push.reason}`,
        ) ?? claimed;
      emitThreadEvent(
        thread.id,
        "thread.follow_up.delivery_unknown",
        isCodex
          ? "Codex mid-turn 注入结果未知；为避免重复执行，不会自动重发。"
          : "Claude mid-turn 注入结果未知；为避免重复执行，不会自动重发。",
        "system",
        false,
        { followUp: failed },
      );
      return failed;
    }
    const requeued =
      conversationStore.requeueThreadFollowUpStreamingPush(thread.id, claimed.id, {
        error: push.reason,
      }) ?? claimed;
    emitThreadEvent(
      thread.id,
      "thread.follow_up.push_failed",
      `Mid-turn 注入失败，已保留排队：${formatFollowUpDrainError(push.reason)}`,
      "system",
      false,
      { followUp: requeued },
    );
    logEcoDiag(isCodex ? "follow_up.turn_steer_failed" : "follow_up.stream_input_failed", {
      threadId: shortThreadId(thread.id),
      followUpId: followUp.id,
      reason: push.reason,
    });
    return undefined;
  }

  if (!isCodex) {
    const known = recentStreamingPushFollowUpIds.get(thread.id) ?? new Set<string>();
    known.add(claimed.id);
    recentStreamingPushFollowUpIds.set(thread.id, known);
  }

  const applied = conversationStore.markThreadFollowUpStreamingPushApplied(thread.id, claimed.id);
  if (!applied) {
    const failed =
      conversationStore.markThreadFollowUpDeliveryUnknown(
        thread.id,
        claimed.id,
        isCodex
          ? "Codex accepted turn/steer, but Eco could not commit the applied state."
          : "Claude accepted streamInput, but Eco could not commit the applied state.",
      ) ?? claimed;
    logEcoDiag(isCodex ? "follow_up.turn_steer_commit_miss" : "follow_up.stream_input_commit_miss", {
      threadId: shortThreadId(thread.id),
      followUpId: followUp.id,
    });
    return failed;
  }

  emitThreadEvent(
    thread.id,
    "thread.follow_up.applied",
    isCodex
      ? "已注入当前 Codex 回合（streaming_push / turn/steer）。"
      : "已注入当前 Claude 回合（streaming_push）。",
    "user",
    false,
    { followUp: applied },
  );
  return applied;
}

/**
 * `still_queued` messages survive interrupt and may start immediately. Closing the
 * Query after the receipt makes their final outcome unknowable, so never resend them.
 */
function reconcileInterruptedStreamingPushFollowUps(threadId: string, stillQueued: readonly string[]): void {
  const knownIds = recentStreamingPushFollowUpIds.get(threadId);
  if (!knownIds || knownIds.size === 0) {
    if (stillQueued.length > 0) {
      logEcoDiag("follow_up.still_queued_unmapped", {
        threadId: shortThreadId(threadId),
        stillQueued: stillQueued.slice(0, 20),
      });
    }
    return;
  }
  const still = new Set(stillQueued.map((id) => id.trim()).filter(Boolean));
  for (const uuid of still) {
    if (!knownIds.has(uuid)) {
      logEcoDiag("follow_up.delivery_unknown", {
        threadId: shortThreadId(threadId),
        uuid,
        reason: "interrupt still_queued uuid is not a known Eco streaming_push follow-up id",
      });
      continue;
    }
    const failed = conversationStore.markThreadFollowUpDeliveryUnknown(
      threadId,
      uuid,
      "Message survived interrupt, but the Query closed before Eco could prove final delivery.",
    );
    if (failed) {
      emitThreadEvent(
        threadId,
        "thread.follow_up.delivery_unknown",
        "中断后无法确认 mid-turn 消息是否已执行；为避免重复执行，不会自动重发。",
        "system",
        false,
        { followUp: failed },
      );
    }
  }
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
  if (!stored || routesMatchFingerprint(roleRoutes, stored)) {
    return;
  }
  const session = conversationStore.getSdkSession(threadId);
  if (!session?.sessionId) {
    return;
  }
  const thread = conversationStore.getThread(threadId);
  const workspacePath = thread?.workspacePath ?? "";
  const sessionCwd = workspacePath ? normalizeSessionCwd(workspacePath, session.cwd) : session.cwd.trim();
  const decision = decideClaudeResume({
    sessionId: session.sessionId,
    previousRoutes: { fingerprint: stored },
    nextRoutes: snapshotClaudeResumeRoutes(roleRoutes),
    sessionCwd,
    nextCwd: sessionCwd,
    sessionCwdExists: existsSync(sessionCwd),
  });
  logEcoDiagThrottled(
    `sdk-session-route-change:${threadId}`,
    "sdk_session.route_changed",
    {
      threadId: shortThreadId(threadId),
      decision: decision.kind,
      reason: decision.kind === "resume" ? "route_drift_resume_ok" : decision.reason,
    },
    30_000,
  );
  // Do not clearSdkSession here — resume policy runs at resolveResumeOptions.
}

function recordThreadRouteFingerprint(threadId: string, routes: readonly RuntimeRoute[]): void {
  conversationStore.saveRouteFingerprint(threadId, computeRouteFingerprint(roleRoutesFromRuntime(routes)));
}

/** After a crash, SQLite may still say running while no runtime run is active. */
function recoverOrphanedRunningThreads(): void {
  for (const thread of conversationStore.listThreads()) {
    if (!activeRunRuntimeState.hasRun(thread.id)) {
      settleRecoveredLifecycleRecords(thread.id, "failed");
      settleRecoveredStreamingPushFollowUps(thread.id);
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
      message: "",
    });
    emitThreadEvent(thread.id, "thread.idle", "已从异常退出恢复。", "system");
  }
}

function settleRecoveredStreamingPushFollowUps(threadId: string): void {
  const orphaned = conversationStore
    .listThreadFollowUps(threadId, { statuses: ["delivered"] })
    .filter((followUp) => followUp.deliveryMode === "streaming_push");
  for (const followUp of orphaned) {
    const failed = conversationStore.markThreadFollowUpDeliveryUnknown(
      threadId,
      followUp.id,
      "Application exited while a mid-turn push was in flight; delivery is unknown.",
    );
    if (!failed) {
      continue;
    }
    emitThreadEvent(
      threadId,
      "thread.follow_up.delivery_unknown",
      "应用退出时 mid-turn 消息仍在发送中；无法确认是否已执行，因此不会自动重发。",
      "system",
      false,
      { followUp: failed },
    );
  }
}

function restoreThreadAwaitingPlanAfterRecovery(threadId: string): void {
  const pendingPlan = conversationStore.getPendingPlan(threadId);
  if (!pendingPlan) {
    return;
  }
  updateThread(threadId, {
    status: "awaiting_plan",
    message: "",
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
  updateThread(threadId, { status: "idle", message: "" });
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
    const proxy = await startRuntimeProxy(routes.routes, undefined, { threadId });
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

async function getThreadUserMessageEdit(
  threadId: string,
  activityLineId: string,
): Promise<ThreadUserMessageEditGetResult> {
  const emptyCapability = (
    reasonCode: NonNullable<ThreadUserMessageEditGetResult["capability"]["reasonCode"]>,
    reason: string,
  ) => ({
    threadId,
    activityLineId,
    text: "",
    attachments: [],
    historyRevision: threadRunProjectionHistoryRevisions.get(threadId) ?? 0,
    capability: { status: "unavailable" as const, reasonCode, reason },
  });
  const thread = conversationStore.getThread(threadId);
  if (!thread) return emptyCapability("thread_not_found", "找不到该对话。");
  if (thread.coreKind === "claude") {
    await hydrateClaudeUserMessageEditState(threadId);
  }
  const record = conversationStore.getUserMessageForEdit(threadId, activityLineId);
  if (!record) return emptyCapability("invalid_message", "找不到可编辑的用户消息。");
  if (thread.status === "running" || thread.status === "queued") {
    return {
      threadId,
      activityLineId,
      ...(record.upstreamMessageId && { upstreamMessageId: record.upstreamMessageId }),
      text: record.text,
      attachments: record.attachments,
      historyRevision: threadRunProjectionHistoryRevisions.get(threadId) ?? 0,
      capability: {
        status: "unavailable",
        reasonCode: "thread_running",
        reason: "当前对话正在运行，请等待结束后再编辑。",
      },
    };
  }
  if (thread.coreKind !== "claude" && thread.coreKind !== "codex") {
    return {
      threadId,
      activityLineId,
      text: record.text,
      attachments: record.attachments,
      historyRevision: threadRunProjectionHistoryRevisions.get(threadId) ?? 0,
      capability: {
        status: "unavailable",
        reasonCode: "unsupported_core",
        reason: "当前核心不支持历史消息改写。",
      },
    };
  }
  if (!thread.workspacePath || !existsSync(thread.workspacePath)) {
    return {
      threadId,
      activityLineId,
      ...(record.upstreamMessageId && { upstreamMessageId: record.upstreamMessageId }),
      text: record.text,
      attachments: record.attachments,
      historyRevision: threadRunProjectionHistoryRevisions.get(threadId) ?? 0,
      capability: {
        status: "unavailable",
        reasonCode: "workspace_unavailable",
        reason: "工作区不存在，无法安全恢复文件。",
      },
    };
  }
  if (!record.upstreamMessageId) {
    return {
      threadId,
      activityLineId,
      text: record.text,
      attachments: record.attachments,
      historyRevision: threadRunProjectionHistoryRevisions.get(threadId) ?? 0,
      capability: {
        status: "unavailable",
        reasonCode: "missing_upstream_mapping",
        reason: "该消息尚未绑定到当前 SDK 会话。",
      },
    };
  }
  const checkpointReady =
    conversationStore.hasFileCheckpoint(threadId, record.upstreamMessageId, activityLineId) &&
    (await codexFileCheckpointStore.has(threadId, record.upstreamMessageId));
  if (!checkpointReady) {
    return {
      threadId,
      activityLineId,
      upstreamMessageId: record.upstreamMessageId,
      text: record.text,
      attachments: record.attachments,
      historyRevision: threadRunProjectionHistoryRevisions.get(threadId) ?? 0,
      capability: {
        status: "unavailable",
        reasonCode: "missing_checkpoint",
        reason: "该消息没有可验证的文件检查点，已停止改写。",
      },
    };
  }
  return {
    threadId,
    activityLineId,
    upstreamMessageId: record.upstreamMessageId,
    text: record.text,
    attachments: record.attachments,
    historyRevision: threadRunProjectionHistoryRevisions.get(threadId) ?? 0,
    capability: { status: "ready" },
  };
}

async function retryThreadFromFailedRequest(input: {
  threadId: string;
  activityLineId?: string;
  prompt: string;
  hasImages: boolean;
  expectedHistoryRevision: number;
  runtimeConfig?: ThreadRuntimeConfigInput;
}): Promise<ThreadContinueResult> {
  const thread = conversationStore.getThread(input.threadId);
  if (!thread) {
    throw new Error("Thread was not found.");
  }
  if (!supportsOneClickRequestRetry(thread.coreKind)) {
    throw new Error("当前核心不支持一键重试失败请求。");
  }
  if (thread.status === "running" || thread.status === "queued") {
    throw new Error("Wait for the current run to finish.");
  }
  const currentRevision = threadRunProjectionHistoryRevisions.get(input.threadId) ?? 0;
  if (currentRevision !== input.expectedHistoryRevision) {
    throw new Error("历史记录已变化，请刷新后再重试。");
  }
  const activityLineId = input.activityLineId?.trim() ?? "";
  const prompt = input.prompt.trim();

  if (usesRewindOnRequestRetry(thread.coreKind)) {
    if (!activityLineId) {
      throw new Error("找不到可重试的用户消息。");
    }
    const edit = await getThreadUserMessageEdit(input.threadId, activityLineId);
    if (edit.capability.status !== "ready") {
      throw new Error(edit.capability.reason ?? "该消息当前无法重试。");
    }
    const retryPrompt = edit.text.trim() || prompt;
    const attachments = edit.attachments;
    if (!retryPrompt && attachments.length === 0) {
      throw new Error("Message is required.");
    }
    const target: ThreadActivityRewindTarget = {
      activityLineId,
      ...(edit.upstreamMessageId ? { userMessageId: edit.upstreamMessageId } : {}),
    };
    return startThreadContinuation({
      threadId: input.threadId,
      prompt: retryPrompt,
      attachments,
      rewindTarget: target,
      displayPrompt: retryPrompt,
      ...(input.runtimeConfig ? { runtimeConfigInput: input.runtimeConfig } : {}),
    });
  }

  if (requiresEmptyTurnForRequestRetry(thread.coreKind)) {
    if (!activityLineId) {
      throw new Error("找不到可重试的用户消息。");
    }
    const projection = buildCurrentThreadRunProjection(input.threadId, { fullHistory: true });
    if (!projection) {
      throw new Error("无法读取当前对话历史，请刷新后再重试。");
    }
    if (codexTurnHasRetryBlockingProgress(projection.timeline, activityLineId)) {
      throw new Error("本轮已有模型输出或文件改动，无法一键重试。");
    }
  }

  const record = activityLineId
    ? conversationStore.getUserMessageForEdit(input.threadId, activityLineId)
    : undefined;
  const retryPrompt = record?.text.trim() || prompt;
  const storedAttachments = record?.attachments ?? [];
  if (input.hasImages && storedAttachments.length === 0) {
    throw new Error("该次请求包含图片，但本地没有保存原图，无法一键重试。请重新发送。");
  }
  const attachmentsForRuntime = storedAttachments.length
    ? await loadPromptAttachmentsForRuntime(storedAttachments)
    : undefined;
  if (!retryPrompt && (!attachmentsForRuntime || attachmentsForRuntime.length === 0)) {
    throw new Error("Message is required.");
  }
  return startThreadContinuation({
    threadId: input.threadId,
    prompt: retryPrompt,
    ...(attachmentsForRuntime?.length ? { attachments: attachmentsForRuntime } : {}),
    skipRecordUserPrompt: true,
    displayPrompt: retryPrompt,
    ...(input.runtimeConfig ? { runtimeConfigInput: input.runtimeConfig } : {}),
  });
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
  updateThread(threadId, { status: "completed", message: "" });
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
    updateThread(threadId, { status: "idle", message: "" });
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
  updateThread(threadId, { status: "idle", message: "" });
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
  // User stop lands on idle (not drainable). Pause remaining queued follow-ups so they
  // do not silently sit forever, and so Resume/引导 stays an explicit next step.
  autoPauseFollowUpQueueWhenQueuedRemain(threadId);
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
    const linker = subagentSessions.onDelegationLinked.bind(subagentSessions);
    const wrappedLinker: SubagentDelegationLinker = (input) => {
      linker({ ...input, prompt: input.prompt ?? "" });
    };
    subagentDelegationLinkersByThread.set(threadId, wrappedLinker);
    sdkStreamActivityIngestion.registerDelegationLinker(threadId, wrappedLinker);
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
  const attemptProxy = await startRuntimeProxy(
    runtimeConfig.routes,
    undefined,
    { threadId },
    {
      emitRequestActivity: false,
    },
  );
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
  let sessionImage = false;
  let sessionComputerUse = false;
  if (threadId) {
    const thread = conversationStore.getThread(threadId);
    sessionEco =
      browserSettingsStore.get().agentIntegrationEnabled &&
      integrationEnabled(
        thread ? ensureThreadRuntimeConfig(thread).runtimeConfig?.integrationsEnabled : undefined,
        "browser",
      );
    sessionComputerUse =
      computerUseSettingsStore.get().agentIntegrationEnabled &&
      integrationEnabled(
        thread ? ensureThreadRuntimeConfig(thread).runtimeConfig?.integrationsEnabled : undefined,
        "computerUse",
      );
    sessionImage =
      imageGenerationStore.getSettings().enabled &&
      integrationEnabled(
        thread ? ensureThreadRuntimeConfig(thread).runtimeConfig?.integrationsEnabled : undefined,
        "imageGeneration",
      );
  }
  let globalUserRules = appendBrowserPrompt(
    personalizationSettingsStore.get().globalRules,
    requireBrowserHost().getAgentPromptAppend(sessionEco, threadId),
  );
  if (sessionComputerUse) {
    globalUserRules = appendBrowserPrompt(
      globalUserRules,
      computerUseGateway.getAgentPromptAppend(true),
    );
  }
  if (sessionImage && threadId) {
    const config = imageGenerationStore.getActiveClientConfig();
    globalUserRules = appendBrowserPrompt(globalUserRules, buildImageGenerationPromptAppend(config));
  }
  globalUserRules = appendBrowserPrompt(globalUserRules, buildImageViewPromptAppend());
  globalUserRules = appendBrowserPrompt(globalUserRules, buildImageDisplayPromptAppend());
  if (centerServerClient.getHtmlHostingCapability().available) {
    globalUserRules = appendBrowserPrompt(globalUserRules, buildHtmlHostPromptAppend());
  }
  if (threadId) {
    const agentRegistry = resolveAgentRuntimeConfigForThreadId(threadId);
    const plannerRoute = resolveRoleRoutesForThread(threadId).find((route) => route.role === "planner");
    const webSearchPlan = resolveThreadWebSearchPlan({
      networkWebSearch: agentRegistry
        ? materializeEcoToolPolicy(agentRegistry.orchestration.mainAgent.tools).network?.webSearch
        : undefined,
      ...(plannerRoute?.manualSpec ? { plannerManualSpec: plannerRoute.manualSpec } : {}),
      integratedSettings: integratedWebSearchSettingsStore.get(),
      ...(integratedWebSearchSettingsStore.getApiKey()
        ? { integratedApiKey: integratedWebSearchSettingsStore.getApiKey()! }
        : {}),
    });
    if (webSearchPlan.backend === "integrated") {
      const provider = integratedWebSearchSettingsStore.get().provider;
      globalUserRules = appendBrowserPrompt(
        globalUserRules,
        buildIntegratedWebSearchPromptAppend(
          provider === "tavily" ? "Tavily" : provider === "doubao" ? "Doubao Search" : "Brave Search",
        ),
      );
    }
  }
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
    executionPermissionMode: bashReviewMode === "allow_all" ? "bypassPermissions" : "default",
    toolPermissionHandler: createThreadToolPermissionHandler(
      threadId,
      runPhase,
      bashReviewMode === "allow_all",
    ),
    queryLifecycle: {
      onOpen: (handle) => {
        claudeMidTurnPorts.open(threadId, handle);
      },
      onClosing: async () => {
        await claudeMidTurnPorts.closeIngress(threadId);
      },
      onClosed: (_handle, detail) => {
        reconcileInterruptedStreamingPushFollowUps(threadId, detail.stillQueued);
        claudeMidTurnPorts.close(threadId);
        recentStreamingPushFollowUpIds.delete(threadId);
      },
    },
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

/** Delete an explicit Claude fork that never emitted a session capture event. */
async function cleanupPendingClaudeFork(threadId: string): Promise<void> {
  const pending = pendingClaudeForksByThread.get(threadId);
  if (!pending) {
    return;
  }
  try {
    await deleteClaudeAgentSdkSession({ sessionId: pending.sessionId, dir: pending.cwd });
    pendingClaudeForksByThread.delete(threadId);
  } catch (error) {
    if (isSdkSessionAlreadyMissing(error)) {
      pendingClaudeForksByThread.delete(threadId);
      return;
    }
    process.stderr.write(
      `[eco] pending Claude fork cleanup failed thread=${threadId}: ${errorMessage(error)}\n`,
    );
  }
}

/** Delete an Eco thread: DB + Claude SDK session + Codex checkpoints + PI agent dir + in-memory run state. */
async function deleteThreadFully(threadId: string): Promise<void> {
  await cleanupPendingClaudeFork(threadId);
  await deleteThreadSdkSession(threadId);
  disposePiThreadSession(threadId);
  await removePiThreadAgentDir(app.getPath("userData"), threadId);
  imageGenerationGateway.disposeThread(threadId);
  imageViewGateway.disposeThread(threadId);
  imageDisplayGateway.disposeThread(threadId);
  htmlHostGateway.disposeThread(threadId);
  computerUseGateway.disposeThread(threadId);
  integratedWebSearchGateway.disposeThread(threadId);
  const acpSessionId = acpSessionIdToDelete(conversationStore.getThreadCoreSession(threadId));
  if (acpSessionId) {
    const env = acpCursorSpawnEnv();
    await deleteCursorAcpSession({
      sessionId: acpSessionId,
      ...(env ? { env } : {}),
    });
  }
  conversationStore.deleteThread(threadId);
  clearThreadRuntimeMemory(threadId);
  threadRunProjectionHistoryRevisions.delete(threadId);
  await codexFileCheckpointStore.deleteThread(threadId);
  await promptImageFileStore.deleteThreadMessages(threadId);
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
  sdkStreamActivityIngestion.clearDelegationLinker(threadId);
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
  conversationStore.deleteThreadFeedSkeleton(threadId);
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
  if (
    !storedTarget?.userMessageId ||
    (input.target.userMessageId && storedTarget.userMessageId !== input.target.userMessageId)
  ) {
    throw new Error("该节点缺少 SDK 检查点，无法安全回滚。");
  }
  const storedUserMessageId = storedTarget.userMessageId;

  const session = conversationStore.getSdkSession(input.threadId);
  if (!session?.sessionId) {
    throw new Error("没有可恢复的 SDK 会话，无法回到该节点。");
  }
  const sessionCwd = normalizeSessionCwd(input.workspace.path, session.cwd);
  if (!existsSync(sessionCwd)) {
    throw new Error("SDK 会话工作目录不存在，无法回到该节点。");
  }

  const resumeSessionAt = await resolveClaudeResumeSessionAtBeforeUserMessage({
    sessionId: session.sessionId,
    userMessageId: storedUserMessageId,
    dir: sessionCwd,
  });

  if (
    !conversationStore.hasFileCheckpoint(input.threadId, storedUserMessageId, input.target.activityLineId) ||
    !(await codexFileCheckpointStore.has(input.threadId, storedUserMessageId))
  ) {
    throw new Error("该节点没有可验证的 Eco 文件检查点，无法安全回滚。");
  }
  const recoveryId = `claude-rewind-${randomUUID()}`;
  await codexFileCheckpointStore.captureRecovery(input.threadId, sessionCwd, recoveryId);
  let forkedSessionId: string | undefined;
  let resumeOptions: EcoSdkResumeOptions | undefined;
  try {
    // Fork the remote transcript before touching the local DB/worktree. The
    // query-level resumeDropsTurn guard is intentionally not used here: the
    // official SDK may reject it asynchronously and cannot be retried safely.
    if (resumeSessionAt) {
      const createdForkedSessionId = await forkClaudeSessionAt({
        sessionId: session.sessionId,
        dir: sessionCwd,
        upToMessageId: resumeSessionAt,
      });
      forkedSessionId = createdForkedSessionId;
      pendingClaudeForksByThread.set(input.threadId, {
        sessionId: createdForkedSessionId,
        cwd: sessionCwd,
      });
    }

    await codexFileCheckpointStore.restore(input.threadId, storedUserMessageId, sessionCwd);

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

    resumeOptions = forkedSessionId ? { resumeSessionId: forkedSessionId } : undefined;
  } catch (error) {
    const recoveryErrors: unknown[] = [];
    try {
      await codexFileCheckpointStore.restoreRecovery(input.threadId, sessionCwd, recoveryId);
    } catch (restoreError) {
      recoveryErrors.push(restoreError);
      process.stderr.write(`[eco] Claude rewind recovery restore failed: ${errorMessage(restoreError)}\n`);
    }
    if (forkedSessionId) {
      pendingClaudeForksByThread.delete(input.threadId);
      try {
        await deleteClaudeAgentSdkSession({ sessionId: forkedSessionId, dir: sessionCwd });
      } catch (deleteError) {
        recoveryErrors.push(deleteError);
        process.stderr.write(`[eco] Claude fork cleanup failed: ${errorMessage(deleteError)}\n`);
      }
    }
    await codexFileCheckpointStore.deleteRecovery(input.threadId, recoveryId).catch((cleanupError) => {
      process.stderr.write(`[eco] Claude rewind recovery cleanup failed: ${errorMessage(cleanupError)}\n`);
    });
    if (recoveryErrors.length > 0) {
      throw new Error(
        `Claude rewind local recovery failed: ${recoveryErrors.map(errorMessage).join("; ")}; original error: ${errorMessage(error)}`,
      );
    }
    throw error;
  }

  // The local history/worktree rewrite is committed. Cleanup failure must not
  // pretend that a committed rewrite was rolled back; retain the exact gap.
  await codexFileCheckpointStore.deleteRecovery(input.threadId, recoveryId).catch((cleanupError) => {
    process.stderr.write(
      `[eco] Claude rewind recovery cleanup pending after successful rewrite: ${errorMessage(cleanupError)}\n`,
    );
  });
  return resumeOptions;
}

function isSessionCapturedPayload(payload: unknown): payload is SessionCapturedPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    typeof (payload as SessionCapturedPayload).sessionId === "string" &&
    typeof (payload as SessionCapturedPayload).cwd === "string"
  );
}

async function captureSdkSessionFromEvent(
  threadId: string,
  event: { type: string; payload: unknown },
  worktreePath: string,
): Promise<void> {
  if (event.type === "file.checkpoint") {
    const payload = event.payload;
    if (
      payload &&
      typeof payload === "object" &&
      typeof (payload as { userMessageId?: string }).userMessageId === "string"
    ) {
      const userMessageId = (payload as { userMessageId: string }).userMessageId;
      const thread = conversationStore.getThread(threadId);
      if (thread?.coreKind === "claude") {
        await codexFileCheckpointStore.capturePending(threadId, worktreePath);
      }
      const bound = conversationStore.bindLatestUserActivityToSdkMessage(threadId, userMessageId);
      if (bound) {
        if (thread?.coreKind === "claude") {
          await codexFileCheckpointStore.bindPending(threadId, userMessageId);
          await rebindClaudeUserMessageRecordsFromSession(threadId);
        }
        scheduleThreadRunProjectionUpdated(threadId);
      }
    }
    return;
  }
  if (event.type !== "session.captured") {
    return;
  }
  if (isSessionCapturedPayload(event.payload)) {
    const pendingFork = pendingClaudeForksByThread.get(threadId);
    if (pendingFork) {
      const capturedSessionId = event.payload.sessionId.trim();
      if (pendingFork.sessionId !== capturedSessionId) {
        throw new Error(
          `Claude fork session capture mismatch: expected ${pendingFork.sessionId}, received ${capturedSessionId}.`,
        );
      }
    }
    conversationStore.captureSdkSessionAndConsumeCompactHandoff(
      threadId,
      event.payload.sessionId,
      worktreePath,
    );
    if (pendingFork) {
      pendingClaudeForksByThread.delete(threadId);
    }
    if (conversationStore.getThread(threadId)?.coreKind === "claude") {
      await rebindClaudeUserMessageRecordsFromSession(threadId);
    }
  }
}

async function rebindClaudeUserMessageRecordsFromSession(
  threadId: string,
): Promise<Array<{ activityLineId: string; upstreamMessageId: string }>> {
  const records = conversationStore.ensureClaudeUserMessageRecordsFromRunEvents(threadId);
  if (records.length === 0) {
    return [];
  }
  const sessionLines = await listThreadActivityFromSdkSession(threadId);
  const userLines = sessionLines.filter(
    (
      line,
    ): line is ThreadActivityLine & { rewindTarget: { activityLineId: string; userMessageId?: string } } =>
      line.role === "user" && Boolean(line.rewindTarget?.activityLineId),
  );
  if (userLines.length === 0) {
    return [];
  }

  const mappings: Array<{ activityLineId: string; upstreamMessageId: string }> = [];
  if (userLines.length === records.length) {
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      const line = userLines[index];
      const upstreamMessageId = line?.rewindTarget?.userMessageId?.trim();
      if (record && upstreamMessageId) {
        mappings.push({ activityLineId: record.activityLineId, upstreamMessageId });
      }
    }
  } else {
    let cursor = 0;
    for (const record of records) {
      const recordText = record.text.trim();
      const matchIndex = userLines.findIndex(
        (line, index) => index >= cursor && line.message.trim() === recordText,
      );
      if (matchIndex < 0) {
        continue;
      }
      const line = userLines[matchIndex];
      const upstreamMessageId = line?.rewindTarget?.userMessageId?.trim();
      if (upstreamMessageId) {
        mappings.push({ activityLineId: record.activityLineId, upstreamMessageId });
      }
      cursor = matchIndex + 1;
    }
  }
  conversationStore.rebindClaudeUserMessageRecords(threadId, mappings);
  return mappings;
}

async function hydrateClaudeUserMessageEditState(threadId: string): Promise<void> {
  const existing = claudeUserMessageHydrationByThread.get(threadId);
  if (existing) {
    return existing;
  }
  const hydration = hydrateClaudeUserMessageEditStateOnce(threadId).finally(() => {
    claudeUserMessageHydrationByThread.delete(threadId);
  });
  claudeUserMessageHydrationByThread.set(threadId, hydration);
  return hydration;
}

async function hydrateClaudeUserMessageEditStateOnce(threadId: string): Promise<void> {
  const thread = conversationStore.getThread(threadId);
  if (!thread || thread.coreKind !== "claude" || thread.status === "running" || thread.status === "queued") {
    return;
  }
  const promptEvents = conversationStore
    .listThreadRunEvents(threadId)
    .filter((event) => event.role === "user" && event.metadata?.liveType === "thread.user_prompt");
  if (promptEvents.length === 0) {
    return;
  }
  let records = conversationStore.ensureClaudeUserMessageRecordsFromRunEvents(threadId);
  const fullyMapped =
    records.length >= promptEvents.length &&
    records.every((record) => Boolean(record.upstreamMessageId?.trim())) &&
    promptEvents.every((event) => {
      const rewindTarget = event.metadata?.rewindTarget;
      return (
        rewindTarget &&
        typeof rewindTarget === "object" &&
        !Array.isArray(rewindTarget) &&
        typeof (rewindTarget as { userMessageId?: unknown }).userMessageId === "string" &&
        Boolean((rewindTarget as { userMessageId: string }).userMessageId.trim())
      );
    });
  if (!fullyMapped) {
    await rebindClaudeUserMessageRecordsFromSession(threadId);
    records = conversationStore
      .listUserMessageRecords(threadId)
      .filter((record) => record.provider !== "codex");
  }

  const latest = [...records].reverse().find((record) => Boolean(record.upstreamMessageId?.trim()));
  const latestUpstreamMessageId = latest?.upstreamMessageId?.trim();
  if (
    latest &&
    latestUpstreamMessageId &&
    conversationStore.hasFileCheckpoint(threadId, latestUpstreamMessageId, latest.activityLineId) &&
    !(await codexFileCheckpointStore.has(threadId, latestUpstreamMessageId)) &&
    (await codexFileCheckpointStore.hasPending(threadId))
  ) {
    await codexFileCheckpointStore.bindPending(threadId, latestUpstreamMessageId);
  }
}

function evaluateClaudeResumeDecision(
  threadId: string,
  worktreePath: string,
): ReturnType<typeof decideClaudeResume> | null {
  const session = conversationStore.getSdkSession(threadId);
  if (!session?.sessionId) {
    return null;
  }
  const thread = conversationStore.getThread(threadId);
  const workspacePath = thread?.workspacePath;
  const sessionCwd = workspacePath ? normalizeSessionCwd(workspacePath, session.cwd) : session.cwd.trim();
  const cwd = workspacePath
    ? normalizeSessionCwd(workspacePath, worktreePath || session.cwd)
    : worktreePath.trim();

  // Prefer resolved RuntimeRoute fields (provider defaults) so fingerprint diagnostics match writes.
  const resolved = resolveRuntimeConfigForThreadId(threadId);
  const nextRoleRoutes = resolved.ok ? roleRoutesFromRuntime(resolved.routes) : [];
  const storedFingerprint = conversationStore.getRouteFingerprint(threadId);
  return decideClaudeResume({
    sessionId: session.sessionId,
    ...(storedFingerprint ? { previousRoutes: { fingerprint: storedFingerprint } } : {}),
    nextRoutes: snapshotClaudeResumeRoutes(nextRoleRoutes),
    sessionCwd,
    nextCwd: cwd || sessionCwd,
    sessionCwdExists: existsSync(sessionCwd),
  });
}

function resolveResumeOptions(threadId: string, worktreePath: string): EcoSdkResumeOptions | undefined {
  const decision = evaluateClaudeResumeDecision(threadId, worktreePath);
  if (!decision) {
    return undefined;
  }

  if (decision.kind === "resume") {
    return { resumeSessionId: decision.sessionId };
  }

  logEcoDiag("sdk_session.resume_decision", {
    threadId: shortThreadId(threadId),
    decision: decision.kind,
    reason: decision.reason,
  });

  // reject (cwd missing/changed, corrupt, …): new session, drop unusable resume target.
  conversationStore.clearSdkSession(threadId);
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
    let resume: EcoSdkResumeOptions | undefined;
    try {
      resume = action.resume !== false ? (resumeOverride ?? resolveResumeOptions(threadId, cwd)) : undefined;
    } catch (error) {
      markThreadInterrupted(threadId, errorMessage(error));
      return;
    }
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
      async (attemptContext) => {
        const mainPrompt = await resolvePromptImagesForMainContext({
          threadId: thread.id,
          prompt: followUp,
          ...(attachments?.length ? { attachments } : {}),
          ...(routesOverride ? { routesOverride } : {}),
          signal: controller.signal,
        });
        return runThreadRequestWithLiveRequestLifecycle({
          context: attemptContext,
          resolveRuntimeConfig: () => resolveRuntimeConfigForThreadId(thread.id, routesOverride),
          recordRouteFingerprint: recordThreadRouteFingerprint,
          startRuntimeProxy,
          run: async ({ proxy: attemptProxy, routes }) => {
            const resume = resumeOptsForContinuation;
            if (!resume) {
              return { ok: false, reason: "无法恢复 SDK 会话，请重新发送完整需求。" };
            }
            try {
              const continuationPhase = sdkRunPhaseFromMode(mode);
              const driver = createSdkDriver(
                thread.id,
                attemptProxy,
                taskRunHooks?.hookContextExtras,
                continuationPhase,
              );
              if (!driver.runContinuation) {
                throw new Error("Runtime driver does not support session continuation.");
              }
              return await consumeSdkRunEvents({
                events: driver.runContinuation(
                  buildDesktopSdkRunInput({
                    threadId: thread.id,
                    prompt: mainPrompt,
                    workspacePath: workspace.path,
                    worktreePath: cwd,
                    routes,
                    signal: controller.signal,
                    sdkSession: await buildSdkSessionOptions(thread.id, mainPrompt, {
                      skillsScope: mode === "planning" ? "planning" : "default",
                    }),
                    agentRegistry: resolveAgentRuntimeConfigForThread(thread),
                    resume,
                    resumableSubagents: listResumableSubagentRefs(thread.id, continuationPhase),
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
                  if (event.type === "plan.ready" && isPlanReadyPayload(event.payload)) {
                    planningPlanCaptured = captureThreadPlanReady({
                      threadId: thread.id,
                      workspacePath: workspace.path,
                      worktreePath: cwd,
                      routesJson: JSON.stringify(routes),
                      payload: event.payload,
                      awaitingPlanMessage: "",
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
          assertSdkSessionRetainedOnRunFailure({
            hadResume: Boolean(resumeOptsForContinuation),
            reason,
          });
          markThreadInterrupted(thread.id, reason);
        },
        onIncomplete: (reason) => {
          taskRunHooks?.stopIfUnhandled("blocked");
          markThreadInterrupted(thread.id, reason);
        },
        onCompleted: async () => {
          if (mode === "execution") {
            taskRunHooks?.stopIfUnhandled("completed");
            await completeCodingThreadRun(thread.id, worktreePlan);
            return;
          }
          if (mode === "ask") {
            updateThread(thread.id, {
              status: "completed",
              message: "",
            });
            return;
          }
          updateThread(thread.id, { status: "idle", message: "" });
        },
      })
    ) {
      return;
    }

    updateThread(thread.id, { status: "idle", message: "" });
  } catch (error) {
    taskRunHooks?.stopIfUnhandled("blocked");
    markThreadInterrupted(thread.id, errorMessage(error));
  } finally {
    const worktreePath = resolveThreadWorktreePath(thread.id);
    await finalizeMainThreadRunCleanup({
      threadId: thread.id,
      worktreePath,
      cancelClarificationsReason: "run finished",
      idleFallbackMessage: "",
    });
  }
}

/** SDK drives narrative, tool, todo, and billing activity. */
function initializeSdkStreamActivityPipeline(): void {
  threadRunEventLivePersister = createThreadRunEventLivePersister({
    store: conversationStore,
    lifecycle: agentLifecycle,
    metricsRegistry: subagentMetricsRegistry,
    liveRequestRegistry: threadLiveRequestRegistry,
    resolveCurrentRunAttemptId,
    resolveAgentIdByParentToolUseId,
    buildBashApprovalMetadata: buildBashApprovalRunMetadataFromRequest,
    emitRequestTerminalEvent,
    onProjectionUpdated: scheduleThreadRunProjectionUpdated,
    onFileChange: scheduleWorkspaceGitStatusPublishForThread,
  });
  sdkStreamActivityIngestion = createSdkStreamActivityIngestion({
    store: conversationStore,
    lifecycle: agentLifecycle,
    metricsRegistry: subagentMetricsRegistry,
    usageLedger: usageLedgerCoordinator,
    contextLifecycle,
    liveRequestRegistry: threadLiveRequestRegistry,
    bridge: sdkStreamBridge,
    logDiagnostic: logEcoDiag,
    emitRequestTerminalEvent,
    onProjectionUpdated: scheduleThreadRunProjectionUpdated,
    onSubagentTimingUpdated: emitSubagentTimingUpdated,
    onContextCompactionStatus: (threadId, input) => emitContextCompactionStatus(threadId, input),
    onLocalStreamUpdate: (update) => {
      broadcastLocalThreadStreamUpdate({
        threadId: update.threadId,
        type: "thread.local_stream_updated",
        message: update.message,
        role: update.role as RuntimeAgentRole,
        stream: update.stream,
        localStream: toThreadLocalStreamUpdate(update, update.observedAt),
      });
    },
    onBrowserToolStarted: ({ threadId, payload }) => {
      maybeRevealBrowserFromAgentTool({ threadId, payload });
    },
    buildBashApprovalMetadata: buildBashApprovalRunMetadataFromRequest,
    emitBridgeThreadEvent: (threadId, type, message, role, stream, extras) => {
      emitThreadEvent(
        threadId,
        type,
        message,
        role as AgentRole | "system" | "thinking" | "tool" | "user",
        stream,
        extras as EmitThreadEventExtras | undefined,
      );
    },
  });
}

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

/** ACP nested Agent/Task tools emit agent.started/completed; mint Cards store rows. */
function maybeHandleAcpNestedSubagentLifecycle(threadId: string, event: AgentEventLike): boolean {
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
  const observedAt = new Date().toISOString();
  const runAttemptId = agentLifecycle.usageRunAttemptId(threadId);
  const parentAgentId = agentLifecycle.currentPlannerAgentId(threadId);

  if (event.type === "agent.started") {
    const existing = conversationStore.listAgentInstances(threadId).find((row) => row.agentId === agentId);
    if (existing) {
      return true;
    }
    const lifecycleRecord = agentLifecycle.startSubagent({
      threadId,
      agentId,
      role,
      parentToolUseId,
      ...(prompt && { missionKey: prompt.slice(0, 120) }),
    });
    conversationStore.upsertSubagentSessionActive({
      threadId,
      role,
      agentId,
      phase: "execution",
      ...(prompt && { missionKey: prompt.slice(0, 120) }),
    });
    subagentMetricsRegistry.onSubagentStart(threadId, {
      agentId,
      role,
      parentToolUseId,
    });
    conversationStore.appendThreadRunEvent(
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
      conversationStore.appendThreadRunEvent(
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
    scheduleThreadRunProjectionUpdated(threadId, { streaming: true });
    emitSubagentTimingUpdated(threadId);
    return true;
  }

  const failed = event.payload.failed === true;
  if (failed) {
    agentLifecycle.abandonSubagent({ threadId, agentId, role });
  } else {
    agentLifecycle.stopSubagent({ threadId, agentId, role });
  }
  subagentMetricsRegistry.onSubagentStop(threadId, { agentId, role });
  conversationStore.markSubagentSessionStopped(threadId, agentId);
  conversationStore.appendThreadRunEvent(
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
  scheduleThreadRunProjectionUpdated(threadId, { streaming: false });
  emitSubagentTimingUpdated(threadId);
  return true;
}

/** SDK drives narrative, tool, todo, and billing activity. */
function emitSdkStreamActivity(threadId: string, event: AgentEventLike): void {
  sdkStreamActivityIngestion.ingest(threadId, event);
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
  const timingIdsForBilling = {
    logicalRequestId: event.logicalRequestId?.trim() || resolved.turnId,
    providerRequestId: (event.providerRequestId ?? event.responseId)?.trim(),
  };
  const billingTask = processUsageBilling({
    ...resolved.billingInput,
    ...(event.ttftMs !== undefined && { ttftMs: event.ttftMs }),
    ...(event.generationMs !== undefined && { generationMs: event.generationMs }),
    logicalRequestId: timingIdsForBilling.logicalRequestId,
  }).then(
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
  // Prefer binding-stamped attempt id so late usage cannot attach to a newer attempt.
  const runAttemptId = info.stampedRunAttemptId?.trim();
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
  noteUsageBillingObservation(info.threadId, resolved.observation);
  const billingTask = processUsageBilling({
    ...resolved.billingInput,
    ...(info.ttftMs !== undefined && { ttftMs: info.ttftMs }),
    ...(info.generationMs !== undefined && { generationMs: info.generationMs }),
  });
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
    inputTokens: input.usage.inputTokens,
    cacheReadTokens: input.usage.cacheReadTokens,
    cacheCreationTokens: input.usage.cacheCreationTokens,
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
    (value.layout === "agents" ||
      value.layout === "codex" ||
      value.layout === "claude" ||
      value.layout === "pi")
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
  const sessionEcoBrowserEnabled =
    browserSettingsStore.get().agentIntegrationEnabled &&
    integrationEnabled(hydrated?.runtimeConfig?.integrationsEnabled, "browser");
  const sessionComputerUseEnabled =
    computerUseSettingsStore.get().agentIntegrationEnabled &&
    integrationEnabled(hydrated?.runtimeConfig?.integrationsEnabled, "computerUse");
  const sessionImageGenerationEnabled =
    imageGenerationStore.getSettings().enabled &&
    integrationEnabled(hydrated?.runtimeConfig?.integrationsEnabled, "imageGeneration");
  const browserInject = await requireBrowserHost().resolveAgentBrowserMcpInjection({
    threadId,
    sessionEnabled: sessionEcoBrowserEnabled,
  });
  if (sessionEcoBrowserEnabled && !browserInject.enabled) {
    throw new Error(`本会话已开启内置浏览器，但不可用：${browserInject.unavailableReason ?? "未知原因"}`);
  }
  const computerUseInject = await computerUseGateway.resolveInjection({
    threadId,
    sessionEnabled: sessionComputerUseEnabled,
  });
  if (sessionComputerUseEnabled && !computerUseInject.enabled) {
    throw new Error(`本会话已开启电脑操控，但不可用：${computerUseInject.unavailableReason ?? "未知原因"}`);
  }
  const imageInject = await imageGenerationGateway.resolveInjection({
    threadId,
    sessionEnabled: sessionImageGenerationEnabled,
  });
  if (sessionImageGenerationEnabled && !imageInject.enabled) {
    throw new Error(`本会话已开启创意绘画，但不可用：${imageInject.unavailableReason ?? "未知原因"}`);
  }
  const imageViewInject = await imageViewGateway.resolveInjection(threadId);
  const imageDisplayInject = await imageDisplayGateway.resolveInjection(threadId);
  const htmlHostingCapability = await centerServerClient.refreshHtmlHostingCapability();
  const htmlHostInject = htmlHostingCapability.available
    ? await htmlHostGateway.resolveInjection(threadId)
    : undefined;
  const agentRegistry = resolveAgentRuntimeConfigForThreadId(threadId);
  const plannerRoute = resolveRoleRoutesForThread(threadId).find((route) => route.role === "planner");
  const webSearchPlan = resolveThreadWebSearchPlan({
    networkWebSearch: agentRegistry
      ? materializeEcoToolPolicy(agentRegistry.orchestration.mainAgent.tools).network?.webSearch
      : undefined,
    ...(plannerRoute?.manualSpec ? { plannerManualSpec: plannerRoute.manualSpec } : {}),
    integratedSettings: integratedWebSearchSettingsStore.get(),
    ...(integratedWebSearchSettingsStore.getApiKey()
      ? { integratedApiKey: integratedWebSearchSettingsStore.getApiKey()! }
      : {}),
  });
  const webSearchInject = await integratedWebSearchGateway.resolveInjection({
    threadId,
    sessionEnabled: webSearchPlan.backend === "integrated",
  });
  if (webSearchPlan.backend === "integrated" && !webSearchInject.enabled) {
    throw new Error(
      `本会话需要 Integrated Web Search，但不可用：${webSearchInject.unavailableReason ?? "未知原因"}`,
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
      (key) =>
        key !== ECO_AGENT_BROWSER_MCP_SERVER &&
        !key.startsWith("eco_ab_") &&
        key !== ECO_COMPUTER_USE_MCP_SERVER &&
        key !== ECO_IMAGE_VIEW_MCP_SERVER &&
        key !== ECO_IMAGE_DISPLAY_MCP_SERVER &&
        key !== ECO_HTML_HOST_MCP_SERVER &&
        key !== ECO_WEB_SEARCH_MCP_SERVER,
    ),
  );
  const withBrowserMcp = requireBrowserHost().mergeIntoSdkMcpConfig(filteredMcp, browserInject);
  const withComputerUseMcp = computerUseGateway.mergeIntoSdkConfig(withBrowserMcp, computerUseInject);
  const withImageMcp = imageGenerationGateway.mergeIntoSdkConfig(withComputerUseMcp, imageInject);
  const withImageViewMcp = imageViewGateway.mergeIntoSdkConfig(withImageMcp, imageViewInject);
  const withImageDisplayMcp = imageDisplayGateway.mergeIntoSdkConfig(withImageViewMcp, imageDisplayInject);
  const withHtmlHostMcp = htmlHostInject
    ? htmlHostGateway.mergeIntoSdkConfig(withImageDisplayMcp, htmlHostInject)
    : withImageDisplayMcp;
  const withWebSearchMcp = integratedWebSearchGateway.mergeIntoSdkConfig(
    withHtmlHostMcp,
    webSearchInject,
  );
  const runtimeMcp = prepareMcpSdkConfigForRuntime(withWebSearchMcp);
  const runtimeMcpServers = [
    ...enabledMcpServers.filter(
      (key) =>
        key !== ECO_AGENT_BROWSER_MCP_SERVER &&
        !key.startsWith("eco_ab_") &&
        key !== ECO_COMPUTER_USE_MCP_SERVER &&
        key !== ECO_IMAGE_VIEW_MCP_SERVER &&
        key !== ECO_IMAGE_DISPLAY_MCP_SERVER &&
        key !== ECO_HTML_HOST_MCP_SERVER &&
        key !== ECO_WEB_SEARCH_MCP_SERVER,
    ),
    ...(browserInject.enabled ? [ECO_AGENT_BROWSER_MCP_SERVER] : []),
    ...(computerUseInject.enabled ? [ECO_COMPUTER_USE_MCP_SERVER] : []),
    ...(imageInject.enabled ? [ECO_IMAGE_GENERATION_MCP_SERVER] : []),
    ...(webSearchInject.enabled ? [ECO_WEB_SEARCH_MCP_SERVER] : []),
    ECO_IMAGE_VIEW_MCP_SERVER,
    ECO_IMAGE_DISPLAY_MCP_SERVER,
    ...(htmlHostInject ? [ECO_HTML_HOST_MCP_SERVER] : []),
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
    throw new Error(
      "Thread orchestration snapshot is missing; select a complete orchestration before running.",
    );
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
    ...(webSearchPlan.backend === "integrated" ? { disallowedTools: ["WebSearch"] } : {}),
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
  const persisted = persistThreadSummaryMessage(status, message);
  if (!persisted) {
    return "";
  }
  if (status === "failed") {
    return formatUserFacingRequestError(persisted);
  }
  if (persisted.startsWith(planExecutionFailurePrefix)) {
    const detail = persisted.slice(planExecutionFailurePrefix.length);
    return buildPlanExecutionFailureMessage(formatUserFacingRequestError(detail));
  }
  return persisted;
}

function updateThread(threadId: string, patch: Pick<ThreadSummary, "message" | "status">): void {
  if (!conversationStore.getThread(threadId)) {
    return;
  }
  if (!shouldKeepThreadCancelling(patch.status)) {
    clearThreadCancelling(threadId);
  }

  const message = normalizeThreadMessage(patch.status, patch.message);
  conversationStore.updateThread(threadId, { ...patch, message });
  const followUpQueuePaused = autoPauseFollowUpQueueForErrorStatus(threadId, patch.status);
  const pendingPlan =
    patch.status === "awaiting_plan" ? conversationStore.getPendingPlan(threadId) : undefined;
  emitThreadEvent(
    threadId,
    `thread.${patch.status}`,
    message,
    "system",
    false,
    {
      ...(pendingPlan ? { plan: buildThreadPlanLivePayload(pendingPlan) } : {}),
      ...(typeof followUpQueuePaused === "boolean" ? { followUpQueuePaused } : {}),
    },
  );
}

/**
 * Mid-run switch to Eco「完全访问」: approve parked execution cards so the UI clears
 * and awaiters continue. Mirrors bashApprovalResolve event side-effects.
 */
function flushPendingBashApprovalsForAllowAllSwitch(threadId: string): void {
  const approved = approveAllPendingBashApprovalsForThread(threadId);
  for (const request of approved) {
    const threadPatch = buildResolvedBashApprovalThreadPatch("approved");
    patchThreadSummary(threadId, threadPatch);
    desktopEventCenter.publishThreadLiveEvent({
      threadId,
      type: "bash_approval.resolved",
      message: threadPatch.message,
      role: "tool",
      stream: false,
      bashApproval: request,
    });
  }
}

function patchThreadSummary(threadId: string, patch: Pick<ThreadSummary, "message" | "status">): void {
  if (!conversationStore.getThread(threadId)) {
    return;
  }
  if (!shouldKeepThreadCancelling(patch.status)) {
    clearThreadCancelling(threadId);
  }

  const message = normalizeThreadMessage(patch.status, patch.message);
  conversationStore.updateThread(threadId, { ...patch, message });
  autoPauseFollowUpQueueForErrorStatus(threadId, patch.status);
}

/** Auto-pause queued follow-ups when the session errors; returns current paused flag when known. */
function autoPauseFollowUpQueueForErrorStatus(
  threadId: string,
  status: ThreadSummary["status"],
): boolean | undefined {
  if (status !== "failed" && status !== "blocked") {
    return conversationStore.getThread(threadId)?.followUpQueuePaused ? true : undefined;
  }
  const current = conversationStore.getThread(threadId);
  if (!current) {
    return undefined;
  }
  if (current.followUpQueuePaused) {
    return true;
  }
  conversationStore.setThreadFollowUpQueuePaused(threadId, true);
  return true;
}

/** Pause the follow-up queue when queued rows remain after a user stop. */
function autoPauseFollowUpQueueWhenQueuedRemain(threadId: string): void {
  const queued = conversationStore.listThreadFollowUps(threadId, { statuses: ["queued"] });
  if (queued.length === 0) {
    return;
  }
  setThreadFollowUpQueuePausedState(threadId, true);
}

function setThreadFollowUpQueuePausedState(
  threadId: string,
  paused: boolean,
): ThreadSummary | undefined {
  const existing = conversationStore.getThread(threadId);
  if (!existing) {
    return undefined;
  }
  if (Boolean(existing.followUpQueuePaused) === paused) {
    return existing;
  }
  const thread = conversationStore.setThreadFollowUpQueuePaused(threadId, paused);
  if (!thread) {
    return undefined;
  }
  emitThreadEvent(
    threadId,
    paused ? "thread.follow_up_queue_paused" : "thread.follow_up_queue_resumed",
    paused ? "排队发送已暂停。" : "排队发送已恢复。",
    "system",
    false,
    { followUpQueuePaused: Boolean(thread.followUpQueuePaused) },
  );
  return thread;
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
  workspacePath?: string;
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
  externalSessionId?: string;
  tool?: ThreadRunToolMetadata;
  metadata?: Record<string, unknown>;
  requestId?: string;
  composerRestore?: ThreadLiveEvent["composerRestore"];
  followUpQueuePaused?: boolean;
}

function extractUrlFromLooseTextMessageForNavigate(message: string): string | undefined {
  const trimmed = message.trim();
  if (!trimmed) {
    return undefined;
  }
  // Only trust message when it is (or embeds) an explicit http(s) URL — never event labels.
  if (/https?:\/\//i.test(trimmed)) {
    return (
      extractUrlFromBrowserOpenToolPayload({ href: trimmed }) ??
      extractUrlFromBrowserOpenToolPayload({ url: trimmed })
    );
  }
  return undefined;
}

function resolveToolUseIdFromActivityPayload(payload: unknown): string | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }
  const direct =
    typeof payload.tool_use_id === "string"
      ? payload.tool_use_id
      : typeof payload.toolUseId === "string"
        ? payload.toolUseId
        : undefined;
  if (direct?.trim()) {
    return direct.trim();
  }
  return isRecord(payload.tool) ? resolveToolUseIdFromActivityPayload(payload.tool) : undefined;
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
  if (toolName && isEcoImageGenerationToolName(toolName)) {
    const threadId = input.threadId?.trim();
    const toolUseId = resolveToolUseIdFromActivityPayload(input.payload);
    if (threadId) imageGenerationGateway.noteUpcomingTool(threadId, toolName, toolUseId);
  }
  if (toolName && (isEcoImageViewToolName(toolName) || toolName === ECO_IMAGE_VIEW_TOOL)) {
    const threadId = input.threadId?.trim();
    const toolUseId = resolveToolUseIdFromActivityPayload(input.payload);
    if (threadId) imageViewGateway.noteUpcomingTool(threadId, toolName, toolUseId);
  }
  if (toolName && (isEcoImageDisplayToolName(toolName) || toolName === ECO_IMAGE_DISPLAY_TOOL)) {
    const threadId = input.threadId?.trim();
    const toolUseId = resolveToolUseIdFromActivityPayload(input.payload);
    if (threadId) imageDisplayGateway.noteUpcomingTool(threadId, toolName, toolUseId);
  }
  if (toolName && (isEcoHtmlHostToolName(toolName) || toolName === ECO_HTML_HOST_TOOL)) {
    const threadId = input.threadId?.trim();
    const toolUseId = resolveToolUseIdFromActivityPayload(input.payload);
    if (threadId) htmlHostGateway.noteUpcomingTool(threadId, toolName, toolUseId);
  }
  if (toolName && isEcoWebSearchToolName(toolName)) {
    const threadId = input.threadId?.trim();
    const toolUseId = resolveToolUseIdFromActivityPayload(input.payload);
    if (threadId) integratedWebSearchGateway.noteUpcomingTool(threadId, toolName, toolUseId);
  }
  const threadId = input.threadId?.trim();
  if (!threadId || !toolName) {
    return;
  }
  if (
    toolName.includes("agent_browser") ||
    toolName.includes("eco_agent_browser") ||
    toolName.includes("eco_ab_")
  ) {
    requireBrowserHost().noteBrowserToolStarted(threadId, toolName);
  }
  // Navigation / tab creation run once in BrowserHost.invokeNativeAgentBrowserTool (MCP path).
  // tool.started only registers auth claims — no notifyAgentBrowserOpen (avoid double open).
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
  if (name && isEcoImageGenerationToolName(name)) {
    const toolUseId = typeof metaTool?.toolUseId === "string" ? metaTool.toolUseId.trim() : undefined;
    imageGenerationGateway.noteUpcomingTool(event.threadId, name, toolUseId);
  }
  if (name && (isEcoImageViewToolName(name) || name === ECO_IMAGE_VIEW_TOOL)) {
    const toolUseId = typeof metaTool?.toolUseId === "string" ? metaTool.toolUseId.trim() : undefined;
    imageViewGateway.noteUpcomingTool(event.threadId, name, toolUseId);
  }
  if (name && (isEcoImageDisplayToolName(name) || name === ECO_IMAGE_DISPLAY_TOOL)) {
    const toolUseId = typeof metaTool?.toolUseId === "string" ? metaTool.toolUseId.trim() : undefined;
    imageDisplayGateway.noteUpcomingTool(event.threadId, name, toolUseId);
  }
  if (name && (isEcoHtmlHostToolName(name) || name === ECO_HTML_HOST_TOOL)) {
    const toolUseId = typeof metaTool?.toolUseId === "string" ? metaTool.toolUseId.trim() : undefined;
    htmlHostGateway.noteUpcomingTool(event.threadId, name, toolUseId);
  }
  if (name && isEcoWebSearchToolName(name)) {
    const toolUseId = typeof metaTool?.toolUseId === "string" ? metaTool.toolUseId.trim() : undefined;
    integratedWebSearchGateway.noteUpcomingTool(event.threadId, name, toolUseId);
  }
  if (!toolName || !isEcoAgentBrowserOpenToolName(toolName)) {
    if (
      name &&
      (name.includes("agent_browser") || name.includes("eco_agent_browser") || name.includes("eco_ab_"))
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
  extras = projectEmitThreadEventExtras(threadId, extras);
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
      const status = type === "bash_approval.requested" ? "running" : thread.status;
      patchThreadSummary(threadId, {
        message: persistThreadSummaryMessage(status, thread.message),
        status,
      });
    }
  }

  if (type.startsWith("plan_approval.")) {
    const thread = conversationStore.getThread(threadId);
    if (thread) {
      const status = type === "plan_approval.requested" ? "awaiting_plan" : thread.status;
      patchThreadSummary(threadId, {
        message: persistThreadSummaryMessage(status, thread.message),
        status,
      });
    }
  }

  const payload: ThreadLiveEvent = {
    threadId,
    type,
    message: isSilentFollowUpEvent ? "" : displayMessage || (extras?.plan ? "计划已就绪" : "状态已更新"),
    role,
    stream,
    ...(isThreadCancelling(threadId) ? { cancelling: true } : {}),
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
  if (extras?.externalSessionId) {
    payload.externalSessionId = extras.externalSessionId;
  }
  if (extras?.tool) {
    const tool = projectThreadRunToolMetadataForFeed(
      enrichHtmlHostToolMetadata(
        threadId,
        enrichImageDisplayToolMetadata(threadId, extras.tool),
      ),
    );
    if (tool) {
      payload.tool = tool;
    }
  }
  if (extras?.composerRestore) {
    payload.composerRestore = extras.composerRestore;
  }
  if (typeof extras?.followUpQueuePaused === "boolean") {
    payload.followUpQueuePaused = extras.followUpQueuePaused;
  }

  if (type === "workspace.changes" || type === "thread.completed" || type === "thread.idle") {
    scheduleWorkspaceGitStatusPublishForThread(threadId);
  }

  const workspacePath =
    extras?.workspacePath?.trim() || conversationStore.getThread(threadId)?.workspacePath?.trim();
  desktopEventCenter.publishThreadLiveEvent(payload, workspacePath);
  return persistedActivityLine;
}

function projectEmitThreadEventExtras(
  threadId: string,
  extras: EmitThreadEventExtras | undefined,
): EmitThreadEventExtras | undefined {
  if (!extras?.tool) {
    return extras;
  }
  const { tool: _tool, ...rest } = extras;
  const tool = projectThreadRunToolMetadata(
    enrichHtmlHostToolMetadata(threadId, enrichImageDisplayToolMetadata(threadId, extras.tool)),
  );
  return tool ? { ...rest, tool } : rest;
}

/**
 * Feed preview is attached via store lookup (toolUseId / latest), not model-visible tool output.
 * display_image only returns `{ status: "ok" }` to the model.
 */
function enrichImageDisplayToolMetadata(
  threadId: string,
  tool: ThreadRunToolMetadata,
): ThreadRunToolMetadata {
  if (!isEcoImageDisplayToolName(tool.name) && tool.name.trim() !== ECO_IMAGE_DISPLAY_TOOL) {
    return tool;
  }
  if (tool.status === "started" || tool.imageDisplay?.artifactId?.trim()) {
    return tool;
  }
  if (!imageDisplayStore) {
    return tool;
  }
  const byToolUseId = tool.toolUseId?.trim()
    ? imageDisplayStore.getArtifactByToolUseId(tool.toolUseId)
    : undefined;
  const artifact = byToolUseId ?? imageDisplayStore.getLatestArtifact(threadId);
  if (!artifact || artifact.status !== "completed") {
    return tool;
  }
  return {
    ...tool,
    imageDisplay: {
      artifactId: artifact.id,
      ...(artifact.title?.trim() ? { title: artifact.title.trim() } : {}),
    },
  };
}

function enrichHtmlHostToolMetadata(
  threadId: string,
  tool: ThreadRunToolMetadata,
): ThreadRunToolMetadata {
  if (!isEcoHtmlHostToolName(tool.name) && tool.name.trim() !== ECO_HTML_HOST_TOOL) {
    return tool;
  }
  if (tool.status === "started" || tool.htmlHost?.pageId?.trim()) {
    return tool;
  }
  if (!htmlHostStore) {
    return tool;
  }
  const byToolUseId = tool.toolUseId?.trim()
    ? htmlHostStore.getArtifactByToolUseId(tool.toolUseId)
    : undefined;
  const artifact = byToolUseId ?? htmlHostStore.getLatestArtifact(threadId);
  if (!artifact || artifact.status !== "completed") {
    return tool;
  }
  return {
    ...tool,
    htmlHost: {
      pageId: artifact.pageId,
      publicUrl: artifact.publicUrl,
      title: artifact.title,
      expiresAt: artifact.expiresAt,
      canExtend: artifact.canExtend,
    },
  };
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
    return `自动上下文压缩已暂停（连续失败 3 次）。请手动压缩或开启新会话。`;
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
  threadRunEventLivePersister.persistFromLiveEvent(
    definedProps({
      threadId: input.threadId,
      type: input.type,
      displayMessage: input.displayMessage,
      role: input.role,
      stream: input.stream,
      extras: input.extras as
        | import("./thread-run-event-live-persist").ThreadRunEventLivePersistExtras
        | undefined,
      persistedActivityLine: input.persistedActivityLine,
    }),
  );
}

function resolveLiveEventStreamKey(input: {
  threadId: string;
  type: string;
  role: string;
  stream: boolean;
  agentId?: string;
  parentToolUseId?: string;
  runAttemptId?: string;
  persistedActivityLine?: ThreadActivityLine;
  extras?: EmitThreadEventExtras;
}): string | undefined {
  if (input.persistedActivityLine) {
    return input.persistedActivityLine.id;
  }
  if (input.type === "thread.user_prompt") {
    const rewindTarget = input.extras?.metadata?.rewindTarget;
    if (rewindTarget && typeof rewindTarget === "object" && !Array.isArray(rewindTarget)) {
      const activityLineId = (rewindTarget as { activityLineId?: unknown }).activityLineId;
      if (typeof activityLineId === "string" && activityLineId.trim()) {
        return activityLineId.trim();
      }
    }
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
      input.runAttemptId,
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
  return resolveLiveRequestIdForEvent(threadLiveRequestRegistry, threadId, input);
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

function readSdkEventLogicalRequestId(event: AgentEventLike): string | undefined {
  const payload = event.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }
  const record = payload as Record<string, unknown>;
  const fromPayload = record.request_id ?? record.logicalRequestId;
  if (typeof fromPayload === "string" && fromPayload.trim()) {
    return fromPayload.trim();
  }
  return undefined;
}

/**
 * Exact late bind: SDK request_id (= Gateway logicalRequestId) + precise attribution.
 * Patches persisted started/terminal rows when agentId upgrades absent → known.
 */
function maybeLateBindLogicalRequestFromSdkEvent(
  threadId: string,
  event: AgentEventLike,
  options: {
    plannerSessionId?: string;
    metricsRegistry: SubagentMetricsRegistry;
  },
): void {
  const logicalRequestId = readSdkEventLogicalRequestId(event);
  if (!logicalRequestId) {
    return;
  }
  const attribution = resolveSdkLateBindAttribution(
    threadId,
    {
      type: event.type,
      role: String(event.role),
      ...(event.agentId ? { agentId: event.agentId } : {}),
      payload: event.payload,
    },
    {
      ...(options.plannerSessionId ? { plannerSessionId: options.plannerSessionId } : {}),
      metricsRegistry: options.metricsRegistry,
    },
  );
  if (!attribution) {
    return;
  }
  const lateBind = applyExactLogicalRequestLateBind(threadLiveRequestRegistry, conversationStore, {
    threadId,
    logicalRequestId,
    agentId: attribution.agentId,
    role: attribution.role,
  });
  if (!lateBind.ok) {
    if (
      lateBind.reason === "role_conflict" ||
      lateBind.reason === "agent_conflict" ||
      lateBind.reason === "db_conflict"
    ) {
      logEcoDiag("logical.late_bind_conflict", {
        threadId,
        logicalRequestId,
        agentId: attribution.agentId.slice(-12),
        reason: lateBind.reason,
        eventType: event.type,
      });
    }
    return;
  }
  if (lateBind.emitTimelineActivity && lateBind.updated > 0) {
    scheduleThreadRunProjectionUpdated(threadId);
  }
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

function buildThreadFeedSkeletonHydrationContext(): Parameters<typeof hydrateThreadFeedSkeletonSnapshot>[2] {
  return {
    getThread: (threadId) => conversationStore.getThread(threadId),
    listRunAttempts: (threadId) => conversationStore.listRunAttempts(threadId),
    getBilling: (threadId) => {
      const legacyBilling = threadUsageAccumulator.getSnapshot(threadId);
      const ledgerBilling = usageLedgerCoordinator.projectBillingSnapshot(
        threadId,
        legacyBilling?.plannerModelLabel,
      );
      return (
        ledgerBilling ??
        (legacyBilling ? usageLedgerCoordinator.enrichBillingSnapshot(threadId, legacyBilling) : undefined)
      );
    },
    getContext: (threadId) => contextScheduler.getDisplaySnapshot(threadId),
    getHistoryRevision: (threadId) => threadRunProjectionHistoryRevisions.get(threadId) ?? 0,
    getSubagentTimings: (threadId) =>
      buildSubagentSessionTimings(conversationStore.listSubagentSessions(threadId)),
  };
}

const RUN_ATTEMPT_TERMINAL_EVENT_TYPES = new Set([
  "run.attempt.completed",
  "run.attempt.failed",
  "run.attempt.cancelled",
]);

function buildFeedSkeletonPatchContext(threadId: string): FeedSkeletonPatchContext {
  const cached = conversationStore.getThreadFeedSkeleton(threadId);
  return {
    attempts: mapRunAttemptsForFeedSkeleton(conversationStore.listRunAttempts(threadId)),
    agents: resolveFeedSkeletonPatchAgents(
      cached?.snapshot.agents ?? [],
      conversationStore.listAgentInstances(threadId),
    ),
    historyRevision: threadRunProjectionHistoryRevisions.get(threadId) ?? 0,
    maxEventSequence: conversationStore.getThreadRunEventMaxSequence(threadId),
  };
}

function persistThreadFeedSkeletonRecord(record: ThreadFeedSkeletonRecord): void {
  conversationStore.saveThreadFeedSkeleton(record.snapshot.thread.threadId, {
    historyRevision: record.historyRevision,
    maxEventSequence: record.maxEventSequence,
    snapshot: record.snapshot,
    ...(record.patchState && { patchState: record.patchState }),
  });
}

/**
 * Ledger rows for the per-billing (逐笔) view. Rows missing gateway timing first
 * inherit the exact gateway measurement from a same-`logicalRequestId` peer row
 * (e.g. PI rows billed alongside the gateway proxy row); client span timing is
 * the remaining fallback. Gateway rows keep their own ttftMs/generationMs.
 */
function listThreadUsageLedgerEventViewsForBilling(threadId: string): ThreadUsageLedgerEventView[] {
  const views = usageLedgerCoordinator.listUsageLedgerEventViews(threadId);
  if (views.length === 0) {
    return views;
  }
  const withPeerTiming = attachPeerGatewayTimingToLedgerEventViews(views);
  const thread = conversationStore.getThread(threadId);
  if (!thread) {
    return withPeerTiming;
  }
  const spans = buildThreadRunProjectionRequestSpans({
    events: conversationStore.listThreadRunEventsForProjection(threadId),
    threadStatus: thread.status,
    agents: conversationStore.listAgentInstances(threadId),
  });
  if (spans.length === 0) {
    return withPeerTiming;
  }
  return attachSpanTimingToLedgerEventViews(withPeerTiming, spans);
}

function usageLedgerRowsForRequestSpanJoin(threadId: string): RequestSpanLedgerUsageRow[] {
  return conversationStore.listUsageLedgerEvents(threadId).map((event) => {
    const ttftMs = readUsageLedgerTtftMs(event.metadata);
    const generationMs = readUsageLedgerGenerationMs(event.metadata);
    const logicalRequestId = readUsageLedgerLogicalRequestId(event.metadata);
    return {
      outputTokens: event.outputTokens,
      source: event.source,
      ...(event.reasoningTokens !== undefined &&
        event.reasoningTokens > 0 && { reasoningTokens: event.reasoningTokens }),
      ...(event.providerRequestId && { providerRequestId: event.providerRequestId }),
      ...(event.requestKey && { requestKey: event.requestKey }),
      ...(logicalRequestId && { logicalRequestId }),
      ...(ttftMs !== undefined && { ttftMs }),
      ...(generationMs !== undefined && { generationMs }),
    };
  });
}

function hydrateFeedProjectionRequestSpans(
  threadId: string,
  snapshot: ThreadRunProjectionSnapshot,
): ThreadRunProjectionSnapshot {
  const thread = conversationStore.getThread(threadId);
  if (!thread) {
    return snapshot;
  }
  const requestSpans = attachOutputTokensToRequestSpans(
    buildThreadRunProjectionRequestSpans({
      events: conversationStore.listThreadRunEventsForProjection(threadId),
      threadStatus: thread.status,
      agents: conversationStore.listAgentInstances(threadId),
    }),
    usageLedgerRowsForRequestSpanJoin(threadId),
  );
  if (JSON.stringify(requestSpans) === JSON.stringify(snapshot.requestSpans)) {
    return snapshot;
  }
  return { ...snapshot, requestSpans };
}

function rebuildThreadFeedSkeletonRecord(threadId: string): ThreadFeedSkeletonRecord | undefined {
  const projection = buildCurrentThreadRunProjection(threadId);
  if (!projection) {
    return undefined;
  }
  const feedProjection = trimProjectionForFeed(projection);
  const record = createThreadFeedSkeletonRecord(feedProjection, buildFeedSkeletonPatchContext(threadId));
  persistThreadFeedSkeletonRecord(record);
  return record;
}

function maintainThreadFeedSkeletonFromEvent(event: ThreadRunEvent): void {
  const threadId = event.threadId;
  if (!conversationStore.getThread(threadId)) {
    return;
  }
  if (event.eventType.startsWith("agent.")) {
    conversationStore.deleteThreadFeedSkeleton(threadId);
    return;
  }

  const context = buildFeedSkeletonPatchContext(threadId);
  context.maxEventSequence = Math.max(context.maxEventSequence, event.sequence);

  if (isMetricsOnlyThreadRunEvent(event)) {
    conversationStore.touchThreadFeedSkeletonSequence(threadId, context.maxEventSequence);
    return;
  }

  const existing = conversationStore.getThreadFeedSkeleton(threadId);
  const leakedAgentItemsOnMain = existing?.snapshot.timeline.some((item) => item.scope === "agent") === true;
  const structureChanging =
    shouldTrackEventForFeedSkeletonPatch(event, context.attempts) ||
    shouldPatchAgentTimelineForFeedSkeleton(event) ||
    RUN_ATTEMPT_TERMINAL_EVENT_TYPES.has(event.eventType) ||
    leakedAgentItemsOnMain;

  if (!structureChanging) {
    conversationStore.touchThreadFeedSkeletonSequence(threadId, context.maxEventSequence);
    return;
  }

  if (!existing?.patchState) {
    rebuildThreadFeedSkeletonRecord(threadId);
    return;
  }

  const patched = patchThreadFeedSkeletonFromEvent(existing, event, context);
  if (!patched) {
    conversationStore.deleteThreadFeedSkeleton(threadId);
    return;
  }
  persistThreadFeedSkeletonRecord(patched);
}

function rebuildThreadFeedSkeleton(threadId: string): ThreadRunProjectionSnapshot | undefined {
  return rebuildThreadFeedSkeletonRecord(threadId)?.snapshot;
}

function loadThreadFeedProjectionForClient(
  threadId: string,
  request: ReturnType<typeof parseThreadRunProjectionGetRequest>,
): ThreadRunProjectionSnapshot | undefined {
  const historyRevision = threadRunProjectionHistoryRevisions.get(threadId) ?? 0;
  const maxEventSequence = conversationStore.getThreadRunEventMaxSequence(threadId);
  let cached = conversationStore.getThreadFeedSkeleton(threadId);
  if (cached && isThreadFeedSkeletonFresh(cached, historyRevision, maxEventSequence)) {
    // Stale ACP skeletons can stay "fresh" while orphan agent-scoped rows were
    // never tracked — force a full rebuild so historical content reappears.
    if (shouldRebuildFeedSkeletonForOrphanAgentEvents(threadId, cached.snapshot)) {
      conversationStore.deleteThreadFeedSkeleton(threadId);
      cached = undefined;
    }
  }
  const feedProjection =
    cached && isThreadFeedSkeletonFresh(cached, historyRevision, maxEventSequence)
      ? cached.snapshot
      : rebuildThreadFeedSkeleton(threadId);
  if (!feedProjection) {
    return undefined;
  }
  const hydrated = hydrateThreadFeedSkeletonSnapshot(
    hydrateFeedProjectionRequestSpans(threadId, feedProjection),
    threadId,
    buildThreadFeedSkeletonHydrationContext(),
  );
  return filterFeedProjectionForClient(hydrated, request);
}

/**
 * Cursor ACP root events historically landed as `scope: agent` with a per-run UUID
 * that has no agent instance. Incremental Feed patches dropped them; detect that
 * hole so reload rebuilds from the full projection (orphan → main).
 */
function shouldRebuildFeedSkeletonForOrphanAgentEvents(
  threadId: string,
  snapshot: ThreadRunProjectionSnapshot,
): boolean {
  const knownAgentIds = new Set([
    ...conversationStore.listAgentInstances(threadId).map((agent) => agent.agentId),
    ...snapshot.agents.map((agent) => agent.agentId),
  ]);
  const events = conversationStore.listThreadRunEventsForProjection(threadId);
  let orphanAssistant = false;
  for (const event of events) {
    if (event.scope !== "agent") {
      continue;
    }
    const agentId = event.agentId?.trim();
    if (!agentId || knownAgentIds.has(agentId)) {
      continue;
    }
    if (
      event.eventType === "message.final" ||
      event.eventType === "message.delta" ||
      event.eventType === "thinking.final" ||
      event.eventType === "thinking.delta" ||
      event.eventType === "tool.started" ||
      event.eventType === "tool.completed"
    ) {
      orphanAssistant = true;
      break;
    }
  }
  if (!orphanAssistant) {
    return false;
  }
  const mainHasAssistant = snapshot.timeline.some(
    (item) =>
      item.scope !== "agent" &&
      (item.eventType === "message.final" ||
        item.eventType === "message.delta" ||
        item.eventType === "thinking.final" ||
        item.eventType === "thinking.delta" ||
        item.eventType === "tool.started" ||
        item.eventType === "tool.completed"),
  );
  return !mainHasAssistant;
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
  // Feed is a full skeleton (user prompts + turn finals). Process bodies load
  // on turn expand via detail RPC.
  const events = conversationStore.listThreadRunEventsForProjection(threadId);
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
    historyComplete: true,
  });
  projection.requestSpans = attachOutputTokensToRequestSpans(
    projection.requestSpans,
    usageLedgerRowsForRequestSpanJoin(threadId),
  );
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
  const historyRevision = threadRunProjectionHistoryRevisions.get(threadId) ?? 0;
  const maxEventSequence = conversationStore.getThreadRunEventMaxSequence(threadId);
  let cached = conversationStore.getThreadFeedSkeleton(threadId);
  if (cached && isThreadFeedSkeletonFresh(cached, historyRevision, maxEventSequence)) {
    if (shouldRebuildFeedSkeletonForOrphanAgentEvents(threadId, cached.snapshot)) {
      conversationStore.deleteThreadFeedSkeleton(threadId);
      cached = undefined;
    }
  }
  let feedProjection =
    cached && isThreadFeedSkeletonFresh(cached, historyRevision, maxEventSequence)
      ? cached.snapshot
      : rebuildThreadFeedSkeleton(threadId);
  if (!feedProjection) {
    return;
  }
  const withSpans = hydrateFeedProjectionRequestSpans(threadId, feedProjection);
  feedProjection = {
    ...withSpans,
    timeline: excludeAgentScopedFeedTimelineItems(withSpans.timeline),
  };
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

interface RecordedUserPromptResult {
  line?: ThreadActivityLine;
  storedAttachments?: PromptImageAttachment[];
}

async function recordUserPrompt(
  threadId: string,
  prompt: string,
  attachments?: readonly PromptImageAttachment[],
): Promise<RecordedUserPromptResult> {
  const resolvedForPreview = attachments?.length
    ? await loadPromptAttachmentsForRuntime(attachments)
    : undefined;
  const previews = createPromptImagePreviews(resolvedForPreview ?? []);
  const thread = conversationStore.getThread(threadId);
  // Codex binds SDK item ids later; a local id here would desync file checkpoints.
  const localActivityLineId = thread?.coreKind === "codex" ? undefined : `user:${randomUUID()}`;
  const line = emitThreadEvent(threadId, "thread.user_prompt", prompt, "user", false, {
    ...((previews.length > 0 || localActivityLineId) && {
      metadata: {
        ...(previews.length > 0 && { [PROMPT_IMAGE_PREVIEWS_METADATA_KEY]: previews }),
        ...(localActivityLineId && { rewindTarget: { activityLineId: localActivityLineId } }),
      },
    }),
  });
  const codexPendingActivityLineId =
    !line?.id && !localActivityLineId && thread?.coreKind === "codex"
      ? `codex-pending:${randomUUID()}`
      : undefined;
  const activityLineId = line?.id ?? localActivityLineId ?? codexPendingActivityLineId;
  let storedAttachments: PromptImageAttachment[] | undefined;
  if (activityLineId && attachments?.length) {
    storedAttachments = await promptImageFileStore.persistMessageAttachments(
      threadId,
      activityLineId,
      attachments,
    );
  }
  if (activityLineId) {
    conversationStore.saveUserMessageRecord({
      threadId,
      activityLineId,
      text: prompt,
      ...(storedAttachments?.length ? { attachments: storedAttachments } : {}),
      ...(thread?.coreKind && { provider: thread.coreKind }),
    });
  }
  const resolvedLine =
    line ??
    (localActivityLineId
      ? {
          id: localActivityLineId,
          role: "user" as const,
          message: prompt,
          rewindTarget: { activityLineId: localActivityLineId },
        }
      : undefined);
  return {
    ...(resolvedLine ? { line: resolvedLine } : {}),
    ...(storedAttachments?.length ? { storedAttachments } : {}),
  };
}

function createPromptImagePreviews(attachments: readonly PromptImageAttachment[]): PromptImagePreview[] {
  const previews: PromptImagePreview[] = [];
  for (const attachment of attachments) {
    const data = attachment.data?.trim();
    if (!data) {
      continue;
    }
    const image = nativeImage.createFromBuffer(Buffer.from(data, "base64"));
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

function createThreadVisionAnalysisHost(runAttemptId?: string): VisionAnalysisHost {
  return {
    resolveRoute(threadId, routesOverride) {
      const thread = conversationStore.getThread(threadId);
      const visionSelection = thread
        ? ensureThreadRuntimeConfig(thread).runtimeConfig?.visionModel
        : undefined;
      return resolveThreadVisionAnalysisRoute({
        ...(thread?.coreKind ? { coreKind: thread.coreKind } : {}),
        visionSelection,
        providerStore,
        resolveEcoFallback: () => {
          const runtime = resolveRuntimeConfigForThreadId(threadId, routesOverride);
          if (!runtime.ok) {
            throw new Error(runtime.reason);
          }
          const sourceRoute = runtime.routes.find((route) => route.role === "planner") ?? runtime.routes[0];
          if (!sourceRoute) {
            throw new Error("看图子代理缺少可用的模型路由。");
          }
          return sourceRoute;
        },
      });
    },
    async startProxy(route, attachments, stamp) {
      const proxy = await startRuntimeProxy([route], [...attachments], {
        threadId: stamp.threadId,
        ...(stamp.runAttemptId ? { runAttemptId: stamp.runAttemptId } : {}),
      });
      const alias = proxy.routes[0];
      if (!alias) {
        throw new Error("看图子代理没有生成可调用的模型别名。");
      }
      return {
        baseUrl: proxy.baseUrl,
        apiKey: proxy.apiKey,
        aliasModelId: alias.aliasModelId,
        close: () => proxy.close(),
      };
    },
    registerBilling(threadId, agentId) {
      proxyBillingStampRegistry.register(threadId, {
        agentId,
        role: BUILTIN_VISION_AGENT_ROLE,
        ...(runAttemptId && { runAttemptId }),
      });
    },
    unregisterBilling(threadId, agentId) {
      proxyBillingStampRegistry.unregister(threadId, agentId);
    },
    emitSubagentStart(input) {
      const parentAgentId = agentLifecycle.currentPlannerAgentId(input.threadId);
      const phase = resolveBuiltInVisionSubagentPhase(input.threadId);
      const startedAt = new Date().toISOString();
      const subagentLaunchGate = getThreadSubagentConcurrencyGate(input.threadId);
      const launchDecision = subagentLaunchGate.tryReserveLaunch({
        toolUseId: input.agentId,
        role: BUILTIN_VISION_AGENT_ROLE,
        prompt: `Analyze ${input.imageCount} image attachment(s).`,
      });
      if (!launchDecision.ok) {
        throw new Error(launchDecision.reason);
      }
      conversationStore.upsertSubagentSessionActive({
        threadId: input.threadId,
        role: BUILTIN_VISION_AGENT_ROLE,
        agentId: input.agentId,
        phase,
        missionKey: `prompt-images:${input.imageCount}`,
      });
      subagentMetricsRegistry.onSubagentStart(input.threadId, {
        agentId: input.agentId,
        role: BUILTIN_VISION_AGENT_ROLE,
      });
      agentLifecycle.startSubagent({
        threadId: input.threadId,
        agentId: input.agentId,
        role: BUILTIN_VISION_AGENT_ROLE,
        missionKey: `prompt-images:${input.imageCount}`,
      });
      subagentLaunchGate.releaseLaunch?.({ toolUseId: input.agentId });
      conversationStore.appendThreadRunEvent(
        buildSubagentLifecycleRunEvent({
          threadId: input.threadId,
          agentId: input.agentId,
          role: BUILTIN_VISION_AGENT_ROLE,
          lifecycle: "started",
          observedAt: startedAt,
          ...(runAttemptId && { runAttemptId }),
          ...(parentAgentId && { parentAgentId }),
          missionKey: `prompt-images:${input.imageCount}`,
          delegationPrompt: `分析本轮 ${input.imageCount} 张图片，只返回结构化视觉报告。`,
        }),
      );
      scheduleThreadRunProjectionUpdated(input.threadId, { streaming: false });
      emitSubagentTimingUpdated(input.threadId);
    },
    emitSubagentStop(input) {
      const parentAgentId = agentLifecycle.currentPlannerAgentId(input.threadId);
      const terminalAt = new Date().toISOString();
      conversationStore.appendThreadRunEvent(
        buildSubagentLifecycleRunEvent({
          threadId: input.threadId,
          agentId: input.agentId,
          role: BUILTIN_VISION_AGENT_ROLE,
          lifecycle: input.failed ? "abandoned" : "stopped",
          observedAt: terminalAt,
          ...(runAttemptId && { runAttemptId }),
          ...(parentAgentId && { parentAgentId }),
          missionKey: `prompt-images:${input.imageCount}`,
          ...(input.report && {
            delegationSummary: `已完成 ${input.imageCount} 张图片的结构化分析。`,
          }),
        }),
      );
      conversationStore.markSubagentSessionStopped(input.threadId, input.agentId);
      subagentMetricsRegistry.onSubagentStop(input.threadId, {
        agentId: input.agentId,
        role: BUILTIN_VISION_AGENT_ROLE,
      });
      if (input.failed) {
        agentLifecycle.abandonSubagent({
          threadId: input.threadId,
          agentId: input.agentId,
          role: BUILTIN_VISION_AGENT_ROLE,
        });
      } else {
        agentLifecycle.stopSubagent({
          threadId: input.threadId,
          agentId: input.agentId,
          role: BUILTIN_VISION_AGENT_ROLE,
        });
      }
      scheduleThreadRunProjectionUpdated(input.threadId, { streaming: false });
      emitSubagentTimingUpdated(input.threadId);
    },
  };
}

async function resolvePromptImagesForMainContext(input: {
  threadId: string;
  prompt: string;
  attachments?: readonly PromptImageAttachment[];
  routesOverride?: readonly RuntimeRoleRouteConfig[];
  signal?: AbortSignal;
}): Promise<string> {
  imageViewGateway.noteThreadPrompt(input.threadId, input.prompt);
  const attachments = input.attachments ?? [];
  if (attachments.length === 0) {
    return input.prompt;
  }

  const agentId = `vision:${input.threadId}:${randomUUID()}`;
  const runAttemptId = agentLifecycle.currentRunAttemptId(input.threadId);
  const report = await runVisionAnalysis(
    {
      threadId: input.threadId,
      prompt: input.prompt,
      attachments,
      billingAgentId: agentId,
      emitSubagentLifecycle: true,
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.routesOverride ? { routesOverride: input.routesOverride } : {}),
      ...(runAttemptId ? { runAttemptId } : {}),
    },
    createThreadVisionAnalysisHost(runAttemptId),
  );
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
}

function resolveBuiltInVisionSubagentPhase(threadId: string): SubagentRunPhase {
  const mode = conversationStore.getThread(threadId)?.runtimeConfig?.sessionMode;
  return mode === "plan" ? "planning" : mode === "ask" ? "ask" : "execution";
}

async function handleThreadAskUserQuestion(
  threadId: string,
  parsed: SdkAskUserQuestionRequest & { toolUseId: string },
): Promise<Record<string, unknown>> {
  patchThreadSummary(threadId, { status: "running", message: "" });
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
  patchThreadSummary(threadId, { status: "running", message: "" });
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
      const existingWait = getPendingPlanApprovalWaitForThread(threadId);
      if (existingWait && getPendingPlanApprovalByToolUseId(request.toolUseId)) {
        return existingWait;
      }
      const thread = conversationStore.getThread(threadId);
      if (!thread) {
        throw new Error("Thread was not found.");
      }
      const worktreePlan = activeRunRuntimeState.worktreePlan(threadId);
      const worktreePath = worktreePlan?.worktreePath ?? thread.workspacePath;
      const roleRoutes = resolveRoleRoutesForThread(threadId);
      const analysis = [
        "Plan submitted for Eco approval.",
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
      const approvalRequest: PlanApprovalRequest = {
        toolUseId: request.toolUseId,
        threadId,
        ...planPayload,
      };
      // Park the bridge before any UI emit so approve cannot race an empty map.
      const decisionPromise = registerPendingPlanApproval(threadId, approvalRequest);
      applyThreadPlanReadyEffects({
        threadId,
        payload: planPayload,
        workspacePath: thread.workspacePath,
        worktreePath,
        routesJson: JSON.stringify(roleRoutes),
        awaitingPlanMessage: "",
        effects: {
          savePendingPlan: (plan) => {
            conversationStore.savePendingPlan(plan);
          },
          emitAwaitingPlan: () => {
            // Bridge path keeps the thread running until the user approves.
          },
        },
      });
      updateThread(threadId, { status: "awaiting_plan", message: "" });
      emitThreadEvent(threadId, "plan_approval.requested", "计划已提交，等待你确认。", "planner", false, {
        plan: planPayload,
        planApproval: approvalRequest,
      });
      const decision = await decisionPromise;
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
        updateThread(threadId, { status: "running", message: "" });
        return;
      }
      if (notificationType === "idle_prompt") {
        updateThread(threadId, { status: "running", message: "" });
      }
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
  const computerUseHandler = createComputerUseToolPermissionHandler(threadId);
  const imageGenerationHandler = createImageGenerationToolPermissionHandler(threadId);
  if (skipExecutionApprovals) {
    return composeCanUseToolHandlers(
      createAskUserQuestionHandler((parsed) => handleThreadAskUserQuestion(threadId, parsed)),
      imageGenerationHandler,
      computerUseHandler,
      browserOpenHandler,
    );
  }
  const bashAndFilesystemHandler = createThreadBashAndFilesystemToolPermissionHandler(threadId, runPhase);
  return composeCanUseToolHandlers(
    createAskUserQuestionHandler((parsed) => handleThreadAskUserQuestion(threadId, parsed)),
    imageGenerationHandler,
    computerUseHandler,
    browserOpenHandler,
    bashAndFilesystemHandler,
  );
}

function createImageGenerationToolPermissionHandler(
  threadId: string,
): (request: SdkToolPermissionRequest) => Promise<SdkToolPermissionDecision> {
  return async (request) => {
    if (!isEcoImageGenerationToolName(request.toolName)) {
      return { behavior: "allow", updatedInput: request.input };
    }
    const thread = conversationStore.getThread(threadId);
    if (!thread) {
      return {
        behavior: "deny",
        message: "Thread was not found; Eco could not request image approval.",
        interrupt: true,
      };
    }
    const approvalAgentId = resolveThreadBashApprovalAgentId(threadId, request);
    if (!approvalAgentId) {
      return {
        behavior: "deny",
        message: "Eco could not attribute this image approval to an agent instance.",
        interrupt: false,
      };
    }
    const prompt = typeof request.input.prompt === "string" ? request.input.prompt.trim() : "";
    const count = typeof request.input.count === "number" ? request.input.count : 1;
    const config = imageGenerationStore.getActiveClientConfig();
    const approvalRequest: BashApprovalRequest = {
      toolUseId: request.toolUseId,
      threadId,
      command: `create_image count=${count}${request.input.size ? ` size=${String(request.input.size)}` : ""}`,
      cwd:
        request.cwd?.trim() ||
        activeRunRuntimeState.worktreePlan(threadId)?.worktreePath ||
        thread.sdkCwd ||
        thread.workspacePath,
      reason: prompt ? `Agent 请求生成图片：${prompt.slice(0, 500)}` : "Agent 请求生成图片。",
      riskScore: 55,
      riskLevel: "medium",
      agentId: approvalAgentId,
      ...(request.agentType ? { agentType: request.agentType } : {}),
      description: `${config.profileName} · ${config.model} · ${count} 张`,
      kind: "image_generation",
    };
    emitThreadEvent(
      threadId,
      "bash_approval.requested",
      "等待确认创意绘画请求",
      "tool",
      false,
      bashApprovalEventExtras(approvalRequest, "bash_approval.requested"),
    );
    const resolution = await registerPendingBashApproval(threadId, approvalRequest);
    if (resolution.decision === "approved") {
      emitThreadEvent(
        threadId,
        "bash_approval.approved",
        "已允许本次创意绘画",
        "tool",
        false,
        bashApprovalEventExtras(approvalRequest, "bash_approval.approved"),
      );
      return { behavior: "allow", updatedInput: request.input };
    }
    emitThreadEvent(
      threadId,
      "bash_approval.rejected",
      "已拒绝本次创意绘画",
      "tool",
      false,
      bashApprovalEventExtras(approvalRequest, "bash_approval.rejected"),
    );
    return {
      behavior: "deny",
      message: resolution.feedback?.trim() || "User rejected this image generation request.",
      interrupt: false,
    };
  };
}

function createComputerUseToolPermissionHandler(
  threadId: string,
): (request: SdkToolPermissionRequest) => Promise<SdkToolPermissionDecision> {
  return async (request) => {
    const needsGate = requiresComputerUseActionApproval(request.toolName);
    const mode = computerUseSettingsStore.get().actionApprovalMode;
    if (!needsGate) {
      return { behavior: "allow", updatedInput: request.input };
    }
    if (mode !== "always_ask") {
      return { behavior: "allow", updatedInput: request.input };
    }

    const thread = conversationStore.getThread(threadId);
    if (!thread) {
      return {
        behavior: "deny",
        message: "Thread was not found; Eco could not request Computer Use approval.",
        interrupt: true,
      };
    }
    const approvalAgentId = resolveThreadBashApprovalAgentId(threadId, request);
    if (!approvalAgentId) {
      return {
        behavior: "deny",
        message: "Eco could not attribute this Computer Use approval to an agent instance.",
        interrupt: false,
      };
    }

    const cwd = request.cwd?.trim() || thread.sdkCwd || thread.workspacePath || ".";
    const approvalRequest: BashApprovalRequest = {
      toolUseId: request.toolUseId,
      threadId,
      command: request.toolName,
      cwd,
      reason: "Agent 请求执行电脑操控动作（点击 / 输入等）。",
      riskScore: 55,
      riskLevel: "medium",
      agentId: approvalAgentId,
      ...(request.agentType ? { agentType: request.agentType } : {}),
      description: "Computer Use action",
    };

    emitThreadEvent(
      threadId,
      "bash_approval.requested",
      "等待确认电脑操控动作",
      "tool",
      false,
      bashApprovalEventExtras(approvalRequest, "bash_approval.requested"),
    );
    const resolution = await registerPendingBashApproval(threadId, approvalRequest);
    if (isBashApprovalGranted(resolution)) {
      emitThreadEvent(
        threadId,
        "bash_approval.approved",
        "已允许本次电脑操控",
        "tool",
        false,
        bashApprovalEventExtras(approvalRequest, "bash_approval.approved"),
      );
      return { behavior: "allow", updatedInput: request.input };
    }
    emitThreadEvent(
      threadId,
      "bash_approval.rejected",
      "已拒绝本次电脑操控",
      "tool",
      false,
      bashApprovalEventExtras(approvalRequest, "bash_approval.rejected"),
    );
    return {
      behavior: "deny",
      message: resolution.feedback?.trim() || "User rejected this Computer Use action.",
      interrupt: false,
    };
  };
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
        runPhase !== "ask" && (runPhase !== "planning" || resolveSessionMode(runtimeConfig) === "agent"),
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
  logUpstream("eco-approval-review-begin", {
    threadId,
    source,
    toolName: tool.toolName,
    command: request.command,
  });
  const thread = conversationStore.getThread(threadId);
  if (!thread) {
    logUpstream("eco-approval-review-skipped", {
      threadId,
      source,
      reason: "thread_missing",
    });
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
    logUpstream("eco-approval-review-skipped", {
      threadId,
      source,
      reason: "auxiliary_model_unavailable",
      detail: errorMessage(error),
    });
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
    logUpstream("eco-approval-review-skipped", {
      threadId,
      source,
      reason: "envelope_invalid",
      detail: built.rationale,
      policyMatches: built.policyMatches,
    });
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
  const { digest } = computeGlobalSettingsDigest({
    modelSettings: getModelSettingsSnapshot(),
    workflowSettings: workflowSettingsStore.get(),
  });
  desktopEventCenter.publishSettingsUpdated({
    threadId: "settings",
    type: "settings.updated",
    message: "Model provider settings saved.",
    settingsDigest: digest,
  });
  scheduleCodexGlobalRuntimeRefresh();
}

const lastConnectionErrorEmitByThread = new Map<string, { at: number; message: string }>();

function emitUpstreamModelRequestActivity(
  threadId: string,
  snapshot: { role: string; agentId?: string; logicalRequestId: string },
): void {
  emitThreadEvent(
    threadId,
    "request.started",
    "Requesting model…",
    snapshot.role as RuntimeAgentRole,
    false,
    {
      requestId: snapshot.logicalRequestId,
      ...(snapshot.agentId ? { agentId: snapshot.agentId } : {}),
    },
  );
}

function emitUpstreamConnectionErrorActivity(input: {
  threadId: string;
  role: RuntimeAgentRole;
  error: string;
  logicalRequestId: string;
  statusCode?: number;
}): void {
  const attribution = resolveUpstreamConnectionErrorAttribution(threadLiveRequestRegistry, {
    threadId: input.threadId,
    logicalRequestId: input.logicalRequestId,
    eventRole: input.role,
    ...(input.statusCode !== undefined ? { statusCode: input.statusCode } : {}),
  });
  if (!attribution) {
    const frozen = resolveFrozenLiveRequestAttribution(
      threadLiveRequestRegistry,
      input.threadId,
      input.logicalRequestId,
    );
    if (frozen && frozen.role !== input.role) {
      logEcoDiag("logical.connection_role_conflict", {
        threadId: input.threadId,
        logicalRequestId: input.logicalRequestId,
        eventRole: input.role,
        entryRole: frozen.role,
      });
    }
    return;
  }
  const detail = formatUserFacingRequestError(input.error);
  const summary = input.statusCode ? `HTTP ${input.statusCode}` : detail;
  const message = summary === detail ? `【连接失败】${summary}` : `【连接失败】${summary}：${detail}`;
  const now = Date.now();
  const last = lastConnectionErrorEmitByThread.get(input.threadId);
  if (last && last.message === message && now - last.at < 4000) {
    return;
  }
  lastConnectionErrorEmitByThread.set(input.threadId, { at: now, message });
  emitThreadEvent(input.threadId, "thread.api_error", message, attribution.role as RuntimeAgentRole, false, {
    apiError: {
      message: detail,
      ...(input.statusCode !== undefined && { statusCode: input.statusCode }),
    },
    requestId: attribution.logicalRequestId,
    ...(attribution.agentId ? { agentId: attribution.agentId } : {}),
    metadata: {
      activityOrigin: GATEWAY_ATTEMPT_CONNECTION_ERROR_ORIGIN,
      logicalRequestId: attribution.logicalRequestId,
      ...(attribution.providerRequestId ? { providerRequestId: attribution.providerRequestId } : {}),
      ...(attribution.agentId ? { agentId: attribution.agentId } : {}),
    },
  });
}

function emitLogicalRequestTerminal(
  threadId: string,
  eventRole: string,
  logicalRequestId: string,
  stage: RequestTerminalStage,
  detail?: string,
): void {
  const result = applyLogicalRequestTerminal(
    threadLiveRequestRegistry,
    {
      threadId,
      logicalRequestId,
      stage,
      eventRole,
      ...(detail ? { detail } : {}),
      ...(resolveCurrentRunAttemptId(threadId)
        ? { runAttemptId: resolveCurrentRunAttemptId(threadId)! }
        : {}),
    },
    ({
      threadId: resolvedThreadId,
      role: resolvedRole,
      agentId,
      displayRequestId,
      providerRequestId,
      stage: resolvedStage,
      detail: resolvedDetail,
    }) => {
      emitRequestTerminalUiEvent(resolvedThreadId, {
        requestId: displayRequestId,
        role: resolvedRole,
        ...(agentId && { agentId }),
        ...(providerRequestId && { providerRequestId }),
        stage: resolvedStage,
        ...(resolvedDetail ? { detail: resolvedDetail } : {}),
      });
    },
  );
  if (!result.ok && result.reason === "role_conflict") {
    const frozen = resolveFrozenLiveRequestAttribution(threadLiveRequestRegistry, threadId, logicalRequestId);
    logEcoDiag("logical.terminal_role_conflict", {
      threadId,
      logicalRequestId,
      eventRole,
      ...(frozen ? { entryRole: frozen.role } : {}),
    });
  }
}

function adoptLiveProviderRequestId(
  threadId: string,
  logicalRequestId: string,
  providerRequestId: string,
): void {
  recordProviderRequestIdForLogical(threadLiveRequestRegistry, threadId, logicalRequestId, providerRequestId);
}

function startRuntimeProxy(
  routes: RuntimeRoute[],
  attachments?: PromptImageAttachment[],
  context?: RunAttemptContext | { threadId?: string; runAttemptId?: string },
  proxyThreadOptions?: { emitRequestActivity?: boolean; runAttemptId?: string },
): Promise<Awaited<ReturnType<typeof startAnthropicModelProxy>>> {
  return (async () => {
    const contextByRole = await resolveContextTokensByRole(
      routes,
      pricingCache,
      workflowSettingsStore.get().contextWindowLimitTokens,
    );
    const upstreamUserAgent = resolveUpstreamUserAgentOverride(proxyBridgeSettingsStore.get());
    const threadId = context?.threadId?.trim();
    const runAttemptId = context?.runAttemptId?.trim() || proxyThreadOptions?.runAttemptId?.trim();
    const options: AnthropicProxyStartOptions = {
      ...(threadId && { threadId }),
      ...(runAttemptId && { runAttemptId }),
      ...(upstreamUserAgent && { upstreamUserAgent }),
      ...(attachments && attachments.length > 0 && { pendingImages: attachments }),
      ...(threadId && {
        onMessagesRequest: ({ role, requestHeaders }) => {
          const explicitAgentId = resolveExplicitBridgeRequestAgentId(role, requestHeaders);
          if (!explicitAgentId && isSubagentBillingRole(role)) {
            logEcoDiag("bridge.missing_claude_agent_id_header", {
              threadId: shortThreadId(threadId),
              role,
              reason: "missing_claude_agent_id_header",
            });
          }
          const emitTimelineActivity = proxyThreadOptions?.emitRequestActivity !== false;
          const snapshot = handleBridgeMessagesRequest(threadLiveRequestRegistry, {
            threadId,
            role,
            ...(explicitAgentId && { agentId: explicitAgentId }),
            emitTimelineActivity,
          });
          if (snapshot.emitTimelineActivity) {
            emitUpstreamModelRequestActivity(threadId, snapshot);
          }
          return { logicalRequestId: snapshot.logicalRequestId };
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
      view.resolvedSupportsNativeWebSearch = manual?.supportsNativeWebSearch !== false;
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
