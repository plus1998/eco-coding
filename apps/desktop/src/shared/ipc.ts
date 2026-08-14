import type { McpSettingsSnapshot } from "./mcp";
import type { ThreadRunToolMetadata } from "./thread-run-events";
import type { ThreadRunProjectionSnapshot } from "./thread-run-projection";
import type {
  ImageGenerationArtifact,
  ImageGenerationArtifactListRequest,
  ImageGenerationArtifactReadRequest,
  ImageGenerationArtifactReadResult,
  ImageGenerationProfileSaveInput,
  ImageGenerationProfileSnapshot,
  ImageGenerationSettingsSaveInput,
  ImageGenerationSettingsSnapshot,
} from "./image-generation";
import type {
  IntegrationAvailabilitySnapshot,
  IntegrationsEnabledSettings,
  ProjectIntegrationsSettingsSnapshot,
} from "./integrations";

export const IPC_CHANNELS = {
  appMenuCommand: "app:menu-command",
  appRendererReady: "app:renderer-ready",
  appSetThemeSource: "app:set-theme-source",
  appSetWindowTitlebarMode: "app:set-window-titlebar-mode",
  appSetLocale: "app:set-locale",
  appUpdateGetState: "app:update-get-state",
  appUpdateCheck: "app:update-check",
  appUpdateDownload: "app:update-download",
  appUpdateInstall: "app:update-install",
  appUpdateOpenRelease: "app:update-open-release",
  appUpdateStateChanged: "app:update-state-changed",
  appShowThreadCompletionNotification: "app:show-thread-completion-notification",
  appShowThreadApprovalNotification: "app:show-thread-approval-notification",
  appShowThreadClarificationNotification: "app:show-thread-clarification-notification",
  appConsumePendingThreadOpen: "app:consume-pending-thread-open",
  appThreadOpenRequested: "app:thread-open-requested",
  coreAvailabilityGet: "core:availability-get",
  workspaceOpen: "workspace:open",
  workspaceOpenPath: "workspace:open-path",
  workspaceGetCurrent: "workspace:get-current",
  workspaceGetHomePath: "workspace:get-home-path",
  workspaceGetUserHomePath: "workspace:get-user-home-path",
  workspaceListDirectories: "workspace:list-directories",
  workspaceListEntries: "workspace:list-entries",
  workspaceReadFile: "workspace:read-file",
  workspaceWriteFile: "workspace:write-file",
  workspaceInspect: "workspace:inspect",
  workspaceListPackageScripts: "workspace:list-package-scripts",
  workspaceSavePackageScriptArgs: "workspace:save-package-script-args",
  workspaceWatchPackageJson: "workspace:watch-package-json",
  workspacePackageJsonChanged: "workspace:package-json-changed",
  workspaceStartPackageScript: "workspace:start-package-script",
  workspacePackageScriptTerminal: "workspace:package-script-terminal",
  backgroundTerminalList: "background-terminal:list",
  backgroundTerminalStart: "background-terminal:start",
  backgroundTerminalOpen: "background-terminal:open",
  backgroundTerminalStop: "background-terminal:stop",
  workspacePrepareGit: "workspace:prepare-git",
  modelSettingsGet: "model-settings:get",
  modelProviderSave: "model-provider:save",
  modelProviderDelete: "model-provider:delete",
  modelProviderListModels: "model-provider:list-models",
  modelProviderTest: "model-provider:test",
  modelRouteProfileTest: "model-route-profile:test",
  modelRouteProfileSave: "model-route-profile:save",
  modelRouteProfileDelete: "model-route-profile:delete",
  agentTemplateList: "agent-template:list",
  agentTemplateSave: "agent-template:save",
  agentTemplateDelete: "agent-template:delete",
  agentTemplateExport: "agent-template:export",
  agentTemplateImport: "agent-template:import",
  mainAgentConfigSave: "main-agent-config:save",
  mainAgentConfigDelete: "main-agent-config:delete",
  mainAgentPromptSave: "main-agent-prompt:save",
  mainAgentPromptDelete: "main-agent-prompt:delete",
  subagentOrchestrationSave: "subagent-orchestration:save",
  subagentOrchestrationDelete: "subagent-orchestration:delete",
  threadStart: "thread:start",
  threadUpdateRuntimeConfig: "thread:update-runtime-config",
  threadList: "thread:list",
  threadGet: "thread:get",
  composerDraftGet: "composer-draft:get",
  composerDraftSave: "composer-draft:save",
  composerDraftDelete: "composer-draft:delete",
  threadSessionBootstrap: "thread:session-bootstrap",
  threadActivityList: "thread:activity-list",
  threadUserMessageEditGet: "thread:user-message-edit-get",
  threadRewriteFromMessage: "thread:rewrite-from-message",
  threadRunProjectionGet: "thread:run-projection-get",
  threadRunProjectionDetailGet: "thread:run-projection-detail-get",
  threadSubagentSessionsList: "thread:subagent-sessions-list",
  threadSubagentMetricsList: "thread:subagent-metrics-list",
  threadDelete: "thread:delete",
  threadRegenerateTitle: "thread:regenerate-title",
  threadCancel: "thread:cancel",
  threadRollbackTo: "thread:rollback-to",
  threadGetAppliedDiff: "thread:get-applied-diff",
  threadRevertAppliedDiff: "thread:revert-applied-diff",
  threadRewindCheckpoint: "thread:rewind-checkpoint",
  threadListCheckpoints: "thread:list-checkpoints",
  threadApprovePlan: "thread:approve-plan",
  threadDismissPlan: "thread:dismiss-plan",
  threadContinue: "thread:continue",
  threadFollowUpEnqueue: "thread:follow-up-enqueue",
  threadFollowUpEscalate: "thread:follow-up-escalate",
  threadFollowUpEditing: "thread:follow-up-editing",
  threadFollowUpUpdate: "thread:follow-up-update",
  threadFollowUpReorder: "thread:follow-up-reorder",
  threadFollowUpList: "thread:follow-up-list",
  threadFollowUpCancel: "thread:follow-up-cancel",
  threadGetPendingPlan: "thread:get-pending-plan",
  threadGetApprovedPlan: "thread:get-approved-plan",
  threadGetUsageSnapshot: "thread:get-usage-snapshot",
  threadUsageLedgerEventsList: "thread:usage-ledger-events-list",
  threadTodoList: "thread:todo-list",
  clarificationGetPending: "clarification:get-pending",
  clarificationSubmit: "clarification:submit",
  clarificationDismiss: "clarification:dismiss",
  bashApprovalGetPending: "bash-approval:get-pending",
  bashApprovalResolve: "bash-approval:resolve",
  threadEventsSubscribe: "thread-events:subscribe",
  approvalResolve: "approval:resolve",
  modelProfilesList: "model-profiles:list",
  modelProfileSave: "model-profile:save",
  conformanceRun: "conformance:run",
  worktreeApply: "worktree:apply",
  worktreeGetStatus: "worktree:get-status",
  terminalList: "terminal:list",
  terminalSpawn: "terminal:spawn",
  terminalInput: "terminal:input",
  terminalResize: "terminal:resize",
  terminalKill: "terminal:kill",
  terminalEvent: "terminal:event",
  mcpSettingsGet: "mcp-settings:get",
  mcpServerSave: "mcp-server:save",
  mcpServerDelete: "mcp-server:delete",
  mcpServerCheck: "mcp-server:check",
  skillsList: "skills:list",
  skillsLinkAgents: "skills:link-agents",
  skillsUninstall: "skills:uninstall",
  skillsCatalogLeaderboard: "skills:catalog-leaderboard",
  skillsCatalogSearch: "skills:catalog-search",
  skillsCatalogInstall: "skills:catalog-install",
  projectSkillsSettingsGet: "project-skills-settings:get",
  projectSkillsSettingsSave: "project-skills-settings:save",
  projectMcpSettingsGet: "project-mcp-settings:get",
  projectMcpSettingsSave: "project-mcp-settings:save",
  projectIntegrationsSettingsGet: "project-integrations-settings:get",
  projectIntegrationsSettingsSave: "project-integrations-settings:save",
  projectOrchestrationSettingsGet: "project-orchestration-settings:get",
  projectOrchestrationSettingsSave: "project-orchestration-settings:save",
  workflowSettingsGet: "workflow-settings:get",
  workflowSettingsSave: "workflow-settings:save",
  proxyBridgeSettingsGet: "proxy-bridge-settings:get",
  proxyBridgeSettingsSave: "proxy-bridge-settings:save",
  centerServerSettingsGet: "center-server-settings:get",
  centerServerSettingsSave: "center-server-settings:save",
  centerServerRegisterDesktop: "center-server:register-desktop",
  centerServerSignUp: "center-server:sign-up",
  centerServerSignIn: "center-server:sign-in",
  centerServerCreatePairing: "center-server:create-pairing",
  centerServerListBindings: "center-server:list-bindings",
  centerServerListPresence: "center-server:list-presence",
  centerServerRevokeBinding: "center-server:revoke-binding",
  centerServerConnect: "center-server:connect",
  centerServerDisconnect: "center-server:disconnect",
  centerServerRemoveConnection: "center-server:remove-connection",
  centerServerTestConnection: "center-server:test-connection",
  centerServerStatusChanged: "center-server:status-changed",
  billingRefreshPricing: "billing:refresh-pricing",
  billingRoutePricing: "billing:route-pricing",
  billingRouteCapabilities: "billing:route-capabilities",
  billingModelsDevList: "billing:models-dev-list",
  candidateModelList: "candidate-model:list",
  candidateModelSave: "candidate-model:save",
  candidateModelDelete: "candidate-model:delete",
  candidateModelReorder: "candidate-model:reorder",
  candidateModelBulkImport: "candidate-model:bulk-import",
  gitGetStatus: "git:get-status",
  gitGetWorkspaceDiff: "git:get-workspace-diff",
  gitDiscardWorkspaceChanges: "git:discard-workspace-changes",
  gitListCommits: "git:list-commits",
  gitCheckoutBranch: "git:checkout-branch",
  gitCreateBranch: "git:create-branch",
  gitGenerateCommitMessage: "git:generate-commit-message",
  gitGenerateCommitMessageDelta: "git:generate-commit-message-delta",
  gitListCommitModelOptions: "git:list-commit-model-options",
  gitCommit: "git:commit",
  gitPush: "git:push",
  gitFetch: "git:fetch",
  gitPull: "git:pull",
  gitRemoteFetched: "git:remote-fetched",
  gitSettingsGet: "git-settings:get",
  gitSettingsSave: "git-settings:save",
  personalizationSettingsGet: "personalization-settings:get",
  personalizationSettingsSave: "personalization-settings:save",
  asrSettingsGet: "asr-settings:get",
  asrSettingsSave: "asr-settings:save",
  asrProfilesList: "asr-profiles:list",
  asrProfileSave: "asr-profile:save",
  asrProfileDelete: "asr-profile:delete",
  asrProfileActivate: "asr-profile:activate",
  asrInputDeviceSave: "asr-input-device:save",
  asrTranscribe: "asr:transcribe",
  asrSettingsGetStatus: "asr-settings:get-status",
  asrSettingsGetClientConfig: "asr-settings:get-client-config",
  storageGetUsage: "storage:get-usage",
  storageCleanup: "storage:cleanup",
  browserSettingsGet: "browser-settings:get",
  browserSettingsSave: "browser-settings:save",
  webChatListGet: "web-chat-list:get",
  webChatListSave: "web-chat-list:save",
  notificationSettingsGet: "notification-settings:get",
  notificationSettingsSave: "notification-settings:save",
  browserOpen: "browser:open",
  browserNavigate: "browser:navigate",
  browserFocus: "browser:focus",
  browserClose: "browser:close",
  browserSetUiScope: "browser:set-ui-scope",
  browserGoBack: "browser:go-back",
  browserGoForward: "browser:go-forward",
  browserReload: "browser:reload",
  browserSetBounds: "browser:set-bounds",
  browserSetVisible: "browser:set-visible",
  browserGetState: "browser:get-state",
  browserOpenExternal: "browser:open-external",
  browserStateChanged: "browser:state-changed",
  integrationAvailabilityGet: "integration-availability:get",
  imageGenerationSettingsGet: "image-generation-settings:get",
  imageGenerationSettingsSave: "image-generation-settings:save",
  imageGenerationProfileSave: "image-generation-profile:save",
  imageGenerationProfileDelete: "image-generation-profile:delete",
  imageGenerationProfileActivate: "image-generation-profile:activate",
  imageGenerationArtifactsList: "image-generation-artifacts:list",
  imageGenerationArtifactRead: "image-generation-artifact:read",
  imageGenerationArtifactReveal: "image-generation-artifact:reveal",
  imageGenerationArtifactChanged: "image-generation-artifact:changed",
  imageViewRead: "image-view:read",
} as const;

export type AppMenuCommand =
  | "new-chat"
  | "open-folder"
  | "check-for-updates"
  | "toggle-sidebar"
  | "toggle-bottom-panel"
  | "toggle-work-panel"
  | "toggle-review-panel"
  | "toggle-file-tree"
  | "toggle-browser";

export type {
  CenterServerAccountAuthResult,
  CenterServerAccountView,
  CenterServerConnectionState,
  CenterServerConnectionStatus,
  CenterServerCreatePairingResult,
  CenterServerDeviceBindingView,
  CenterServerDevicePresenceView,
  CenterServerDeviceView,
  CenterServerRegisterDesktopRequest,
  CenterServerRegisterDesktopResult,
  CenterServerRemoveConnectionOptions,
  CenterServerRemoveConnectionResult,
  CenterServerSettingsInput,
  CenterServerSettingsSnapshot,
  CenterServerSettingsView,
  CenterServerSignInRequest,
  CenterServerSignUpRequest,
  CenterServerTestConnectionRequest,
  CenterServerTestConnectionResult,
} from "./center-server";

export interface CoreAvailabilitySnapshot {
  claude: { available: true };
  codex: { available: boolean; reason?: string };
  pi: { available: boolean; reason?: string };
}
export type {
  EventCenterEnvelope,
  EventCenterEventKind,
  EventCenterInvokeParams,
  EventCenterInvokeResult,
  EventCenterJsonRpcFailure,
  EventCenterJsonRpcNotification,
  EventCenterJsonRpcRequest,
  EventCenterJsonRpcResponse,
  EventCenterJsonRpcSuccess,
  EventCenterPackageJsonChangedPayload,
  EventCenterPayloadMap,
  EventCenterSource,
  ThreadEventCenterEventKind,
} from "./event-center";
export {
  buildEventCenterJsonRpcFailure,
  buildEventCenterJsonRpcNotification,
  buildEventCenterJsonRpcSuccess,
  classifyThreadLiveEventForCenter,
  EVENT_CENTER_JSON_RPC_ERROR,
  EVENT_CENTER_JSON_RPC_METHODS,
  EVENT_CENTER_JSON_RPC_VERSION,
  EVENT_CENTER_PROTOCOL_VERSION,
  isEventCenterInvokeParams,
  isEventCenterJsonRpcRequest,
  isThreadPlanLiveEvent,
} from "./event-center";
export type {
  McpServerCheckResult,
  McpServerConfigInput,
  McpServerConfigView,
  McpSettingsSnapshot,
  McpTransport,
} from "./mcp";
export type {
  ListUpstreamModelsRequest,
  ListUpstreamModelsResult,
  ProviderRequestError,
  RoleRouteTestResult,
  TestProviderConnectionRequest,
  TestProviderConnectionResult,
  TestRoleRouteItem,
  TestRoleRoutesRequest,
  TestRoleRoutesResult,
  UpstreamModelOption,
} from "./models";
export type {
  LinkAgentsSkillsRequest,
  LinkAgentsSkillsResult,
  SkillInfo,
  SkillSource,
  SkillCatalogInstallRequest,
  SkillCatalogInstallResult,
  SkillCatalogSearchRequest,
  SkillCatalogSearchResult,
  SkillUninstallRequest,
  SkillUninstallResult,
  SkillsListResult,
} from "./skills";
export type {
  ThreadRunBashApprovalMetadata,
  ThreadRunBashApprovalPhase,
  ThreadRunEvent,
  ThreadRunEventInput,
  ThreadRunEventScope,
  ThreadRunEventStreamState,
  ThreadRunEventType,
  ThreadRunToolMetadata,
  ThreadRunWebSearchMetadata,
} from "./thread-run-events";
export type {
  ThreadRunProjectionAgent,
  ThreadRunProjectionAgentKind,
  ThreadRunProjectionAgentStatus,
  ThreadRunProjectionAttempt,
  ThreadRunProjectionAttemptStatus,
  ThreadRunProjectionContext,
  ThreadRunProjectionDetailKind,
  ThreadRunProjectionDetailRequest,
  ThreadRunProjectionDetailResult,
  ThreadRunProjectionDiagnostic,
  ThreadRunProjectionDiagnosticCode,
  ThreadRunProjectionRequestSpan,
  ThreadRunProjectionRequestStatus,
  ThreadRunProjectionSnapshot,
  ThreadRunProjectionTimelineItem,
  ThreadRunProjectionUsage,
} from "./thread-run-projection";

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export interface ImageViewReadRequest {
  path: string;
}

export type ImageViewReadFailureCode =
  | "invalid_path"
  | "not_found"
  | "symbolic_link"
  | "not_file"
  | "too_large"
  | "unsupported_type";

export type ImageViewReadResult =
  | {
      ok: true;
      dataBase64: string;
      mimeType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
      path: string;
      fileName: string;
      bytes: number;
      width: number;
      height: number;
    }
  | {
      ok: false;
      code: ImageViewReadFailureCode;
    };

/** ASR upstream protocol: Qwen-style chat completions vs OpenAI audio transcriptions. */
export type AsrApiMode = "chat_completions" | "audio_transcriptions";

export interface AsrSettingsSnapshot {
  endpoint: string;
  apiMode: AsrApiMode;
  model: string;
  systemPrompt: string;
  hasApiKey: boolean;
  apiKeyEncryptionAvailable: boolean;
  /** Present for profile-aware callers; legacy callers can ignore it. */
  profileId?: string;
  /** Present for profile-aware callers; legacy callers can ignore it. */
  profileName?: string;
  inputDeviceId?: string;
}
export interface AsrSettingsStatus {
  activeProfileId: string;
  activeProfileName: string;
  hasApiKey: boolean;
  apiKeyEncryptionAvailable: boolean;
  model: string;
}

export interface AsrSettingsInput {
  endpoint: string;
  apiMode?: AsrApiMode;
  model: string;
  systemPrompt: string;
  /** Empty means keep the existing key. */
  apiKey?: string;
}

export interface AsrClientConfig {
  endpoint: string;
  apiMode: AsrApiMode;
  model: string;
  systemPrompt: string;
  apiKey: string;
}

export interface AsrProfileSnapshot {
  id: string;
  name: string;
  endpoint: string;
  apiMode: AsrApiMode;
  model: string;
  systemPrompt: string;
  hasApiKey: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AsrProfilesSnapshot {
  profiles: AsrProfileSnapshot[];
  activeProfileId: string;
  inputDeviceId?: string;
  apiKeyEncryptionAvailable: boolean;
}

export interface AsrProfileSaveInput {
  /** Omit to create a new profile. */
  id?: string;
  name: string;
  endpoint: string;
  apiMode?: AsrApiMode;
  model: string;
  systemPrompt: string;
  /** Empty means keep the key of this same profile; a new profile remains keyless. */
  apiKey?: string;
}

export interface AsrProfileDeleteRequest {
  id: string;
}

export interface AsrProfileActivateRequest {
  id: string;
}

export interface AsrInputDeviceSaveInput {
  /** Empty or null clears the saved input device. */
  inputDeviceId?: string | null;
}

export interface AsrTranscribeRequest {
  audioWavBase64: string;
  /** Pins transcription to the profile selected when recording started. */
  profileId?: string;
}

export interface AsrTranscribeResult {
  text: string;
}

export function isKnownIpcChannel(channel: string): channel is IpcChannel {
  return Object.values(IPC_CHANNELS).includes(channel as IpcChannel);
}

export interface WorkspaceInfo {
  path: string;
  name: string;
  isGitRepository: boolean;
  /** False when the repo exists but has no commits yet (HEAD invalid for worktrees). */
  hasGitCommits?: boolean;
  gitRoot?: string;
  branch?: string;
  dirtyFileCount: number;
  packageManager?: "bun" | "pnpm" | "yarn" | "npm";
}

export interface WorkspaceDirectoryEntry {
  name: string;
  path: string;
}

export interface WorkspaceDirectoryListing {
  path: string;
  parentPath?: string;
  directories: WorkspaceDirectoryEntry[];
}

export interface WorkspaceFileBrowserRequest {
  workspacePath: string;
  directoryPath: string;
}

export interface WorkspaceFileEntry {
  name: string;
  path: string;
  kind: "directory" | "file";
  size?: number;
}

export interface WorkspaceFileReadRequest {
  workspacePath: string;
  filePath: string;
}

export interface WorkspaceFileWriteRequest {
  workspacePath: string;
  filePath: string;
  content: string;
}

export interface WorkspaceFileWriteResult {
  path: string;
  name: string;
  size: number;
}

export type WorkspaceFileKind = "text" | "image" | "audio" | "video" | "unsupported";

export interface WorkspaceFileReadResult {
  path: string;
  name: string;
  size: number;
  kind: WorkspaceFileKind;
  mimeType?: string;
  content?: string;
  base64?: string;
  truncated?: boolean;
  reason?: string;
}

export type PackageManagerKind = "bun" | "pnpm" | "yarn" | "npm";

export interface PackageScriptInfo {
  name: string;
  command: string;
}

export interface PackageScriptsListResult {
  workspacePath: string;
  hasPackageJson: boolean;
  packageName?: string;
  packageManager: PackageManagerKind;
  scripts: PackageScriptInfo[];
  /** Per-script extra args saved on Desktop; synced to Mobile via list RPC. */
  scriptArgs: Record<string, string>;
}

export interface SavePackageScriptArgsRequest {
  workspacePath: string;
  script: string;
  args: string;
}

export interface RunPackageScriptRequest {
  workspacePath: string;
  script: string;
  args?: string;
  threadId?: string;
}

export type StartPackageScriptRequest = RunPackageScriptRequest;

export interface StartPackageScriptResult {
  script: string;
  command: string[];
  sessionId: string;
  taskId: string;
}

export interface PackageScriptTerminalLaunchPayload {
  workspacePath: string;
  sessionId: string;
  script: string;
  command: string[];
  taskId?: string;
}

export type BackgroundTerminalTaskStatus = "starting" | "running" | "exited" | "failed" | "stopped";

export interface BackgroundTerminalTask {
  taskId: string;
  workspacePath: string;
  command: string[];
  label: string;
  sessionId: string;
  status: BackgroundTerminalTaskStatus;
  startedAt: string;
  threadId?: string;
  exitCode?: number;
  signal?: number;
  endedAt?: string;
  output?: string;
  outputTruncated?: boolean;
}

export interface BackgroundTerminalListRequest {
  workspacePath?: string;
  threadId?: string;
}

export interface BackgroundTerminalStartRequest {
  workspacePath: string;
  command: string[];
  label?: string;
  threadId?: string;
}

export interface BackgroundTerminalOpenRequest {
  taskId: string;
}

export interface BackgroundTerminalStopRequest {
  taskId: string;
}

export interface BackgroundTerminalStopResult {
  stopped: boolean;
  task?: BackgroundTerminalTask;
}

export interface TerminalSpawnRequest {
  workspacePath: string;
  cols?: number;
  rows?: number;
}

export interface TerminalListRequest {
  workspacePath?: string;
}

export interface TerminalSessionView {
  sessionId: string;
  workspacePath: string;
}

export interface TerminalSpawnResult {
  sessionId: string;
}

export interface TerminalInputRequest {
  sessionId: string;
  data: string;
}

export interface TerminalResizeRequest {
  sessionId: string;
  cols: number;
  rows: number;
}

export interface TerminalKillRequest {
  sessionId: string;
}

export type TerminalStreamEvent =
  | { type: "started"; sessionId: string; workspacePath: string }
  | { type: "output"; sessionId: string; data: string }
  | { type: "exit"; sessionId: string; exitCode: number; signal?: number }
  | { type: "error"; sessionId: string; message: string };

export interface WorkspaceOpenResult {
  canceled: boolean;
  workspace?: WorkspaceInfo;
}

export interface WorkspacePrepareGitRequest {
  workspacePath: string;
}

export const AGENT_ROLES = ["planner", "explore", "architect", "coder", "reviewer", "tester"] as const;

export type AgentRole = (typeof AGENT_ROLES)[number];
export type RuntimeAgentRole = string;

export const SUBAGENT_ROLES = ["explore", "architect", "coder", "reviewer", "tester"] as const;

export type SubagentRole = (typeof SUBAGENT_ROLES)[number];

export type SubagentEnabledSettings = Record<SubagentRole, boolean>;

export type OrchestrationModeSetting = "autonomous" | "manual";

/** Default follow-up delivery while a run is active (Codex-style queue vs mid-turn steer). */
export type FollowUpDeliveryMode = "queue" | "steer";

export interface WorkflowSettingsSnapshot {
  sessionMode: import("./session-mode").SessionMode;
  defaultCoreKind?: import("@eco/runtime/core-runtime").CoreKind;
  contextWindowLimitTokens: number;
  maxOutputLimitTokens: number;
  /**
   * When a thread is running: `steer` prefers mid-turn inject (streamInput / turn/steer);
   * `queue` only enqueues for post-turn drain. Escalated / "handle now" still tries mid-turn first.
   */
  followUpDeliveryMode: FollowUpDeliveryMode;
  defaultOrchestrationSelection?: import("./agent-orchestration").OrchestrationSelection;
  defaultAuxiliaryModel?: import("./auxiliary-model").AuxiliaryModelSelection;
  defaultVisionModel?: import("./vision-model").VisionModelSelection;
  mcpServersEnabled?: Record<string, boolean>;
  integrationsEnabled?: IntegrationsEnabledSettings;
}

export type {
  ImageGenerationArtifact,
  ImageGenerationArtifactListRequest,
  ImageGenerationArtifactReadRequest,
  ImageGenerationArtifactReadResult,
  ImageGenerationProfileSaveInput,
  ImageGenerationProfileSnapshot,
  ImageGenerationSettingsSaveInput,
  ImageGenerationSettingsSnapshot,
  IntegrationAvailabilitySnapshot,
};

export interface GhAvailabilityView {
  available: boolean;
  authenticated: boolean;
  reason?: string;
}

export interface GitWorkingTreeStatus {
  workspacePath: string;
  isGitRepository: boolean;
  hasGitCommits: boolean;
  branch?: string;
  branches: string[];
  dirtyFileCount: number;
  insertions: number;
  deletions: number;
  canCommit: boolean;
  aheadCount: number;
  behindCount: number;
  hasUpstream: boolean;
  remoteOriginUrl?: string;
  gh: GhAvailabilityView;
}

export interface GitCheckoutBranchRequest {
  workspacePath: string;
  branch: string;
}

export interface GitCreateBranchRequest {
  workspacePath: string;
  branch: string;
}

export interface GitCommitRecord {
  sha: string;
  shortSha: string;
  subject: string;
  author: string;
  relativeDate: string;
  decorations: string[];
}

export type WorkspaceDiffFileStatus = "modified" | "untracked" | "added" | "deleted";

export interface WorkspaceDiffResult {
  workspacePath: string;
  patch: string;
  patchTruncated: boolean;
  fileCount: number;
  files: Array<{
    path: string;
    additions: number;
    deletions: number;
    status: WorkspaceDiffFileStatus;
    originalContent: string;
    currentContent: string;
  }>;
  totalAdditions: number;
  totalDeletions: number;
}

export interface GitDiscardWorkspaceChangesRequest {
  workspacePath: string;
  path?: string;
}

export interface GitDiscardWorkspaceChangesResult {
  discardedPaths: string[];
}

export interface GitListCommitsRequest {
  workspacePath: string;
  skip: number;
  limit: number;
}

export interface GitListCommitsResult {
  commits: GitCommitRecord[];
  hasMore: boolean;
}

export interface GitGenerateCommitMessageRequest {
  workspacePath: string;
  mainAgentConfigId: string;
  includeUnstaged: boolean;
  /** Correlates streaming deltas pushed on gitGenerateCommitMessageDelta. */
  requestId?: string;
  /** @deprecated Use candidateModelId */
  role?: RuntimeAgentRole | "auto";
  candidateModelId?: string | "auto";
}

export interface GitGenerateCommitMessageDeltaPayload {
  requestId: string;
  /** Accumulated assistant text so far. */
  text: string;
}

export interface GitGenerateCommitMessageResult {
  message: string;
  candidateModelId: string;
  modelId: string;
  providerName: string;
  /** @deprecated Always "explore" for commit message generation */
  role?: RuntimeAgentRole;
}

export interface GitCommitRequest {
  workspacePath: string;
  mainAgentConfigId: string;
  includeUnstaged: boolean;
  message?: string;
  /** @deprecated Use candidateModelId */
  role?: RuntimeAgentRole | "auto";
  candidateModelId?: string | "auto";
}

export interface GitListCommitModelOptionsRequest {
  mainAgentConfigId: string;
}

export interface GitListCommitModelOptionsResult {
  options: CommitModelOptionView[];
  savedCandidateModelId: string | "auto";
}

export interface CommitModelOptionView {
  id: string;
  candidateModelId: string;
  providerId: string;
  providerName: string;
  modelId: string;
  modelLabel: string;
  providerColor: string;
  hint?: CommitModelPricingHint;
}

export interface GitCommitResult {
  commitSha: string;
  message: string;
  generated: boolean;
  candidateModelId?: string;
  modelId?: string;
  /** @deprecated Always "explore" when generated */
  role?: RuntimeAgentRole;
}

export interface GitPushRequest {
  workspacePath: string;
  branch?: string;
}

export interface GitPushResult {
  method: "git" | "gh";
  output: string;
}

export interface GitFetchRequest {
  workspacePath: string;
}

export interface GitFetchResult {
  output: string;
}

export interface GitPullRequest {
  workspacePath: string;
  branch?: string;
}

export interface GitPullResult {
  output: string;
  pulled: boolean;
  conflicted: boolean;
  conflictFiles: string[];
}

export interface GitSettingsSnapshot {
  commitMessageRoleByMainAgentConfigId: Record<string, RuntimeAgentRole | "auto">;
  commitMessageCandidateModelIdByMainAgentConfigId: Record<string, string | "auto">;
  /** 生成提交信息时附加给大模型的额外指令（格式、语言、长度等） */
  commitMessageInstructions?: string;
  /** 窗口聚焦且仓库空闲时周期性 git fetch，对齐 VS Code git.autofetch */
  autofetch?: boolean;
  /** 自动 fetch 间隔（秒），默认 180 */
  autofetchPeriod?: number;
}

export interface PersonalizationSettingsSnapshot {
  /** 注入 Claude systemPrompt.append / Codex developerInstructions 的全局个人规则 */
  globalRules?: string;
}

export type {
  BrowserCloseRequest,
  BrowserFocusRequest,
  BrowserInstanceView,
  BrowserNavigateRequest,
  BrowserOpenRequest,
  BrowserPanelBounds,
  BrowserSetBoundsRequest,
  BrowserSetUiScopeRequest,
  BrowserSetVisibleRequest,
  BrowserSettingsSnapshot,
  BrowserViewState,
} from "./browser";

export interface ProxyBridgeSettingsSnapshot {
  /** 留空：透传 SDK User-Agent；非空：覆盖透传 */
  upstreamUserAgent?: string;
  /** 出站 HTTP/HTTPS/SOCKS5 代理 URL（gateway upstream）；留空直连 */
  upstreamProxyUrl?: string;
}

import type { AgentTemplate } from "./agent-orchestration";
import type { UpstreamApiCompat } from "./api-compat";
import type { ProviderTokenCountMode } from "./provider-token-count";
import type { ThreadRuntimeConfig, ThreadRuntimeConfigInput } from "./thread-runtime-config";

export type {
  AgentInstanceConfig,
  AgentTemplate,
  EcoOrchestrationConfig,
  MainAgentConfig,
  MainAgentConfigResource,
  MainAgentPromptMode,
  MainAgentPromptResource,
  MainAgentPromptSelection,
  ModelRef,
  ModelRequirementCapability,
  ModelRequirements,
  OrchestrationSelection,
  OrchestrationStrategy,
  ResolvedOrchestrationSnapshot,
  SubagentOrchestrationResource,
  SubagentSelection,
  ToolPolicy,
} from "./agent-orchestration";
export type { ProviderTokenCountMode, UpstreamApiCompat };
export type { ProjectMcpSettingsSnapshot } from "./composer-mcp";
export type { ProjectIntegrationsSettingsSnapshot } from "./integrations";
export type { ProjectSkillsSettingsSnapshot } from "./composer-skills-settings";
export type { ProjectOrchestrationSettingsSnapshot } from "./project-orchestration-settings";

export interface ProviderConfigInput {
  id?: string;
  name: string;
  baseUrl: string;
  /** Path prefix for Anthropic-compatible API requests, e.g. `/anthropic`. */
  requestPath?: string;
  /**
   * API path version segment (e.g. `v1`). Empty/missing defaults to `v1`.
   * Forms `{baseUrl}{requestPath}/{version}/messages|responses|...`.
   */
  version?: string;
  /** Default upstream API for this provider (role routes may override). */
  apiCompat?: UpstreamApiCompat;
  /** Explicit count_tokens implementation; never inferred from apiCompat. */
  tokenCountMode?: ProviderTokenCountMode;
  apiKey?: string;
  defaultModel: string;
  enabled: boolean;
}

export interface ProviderConfigView {
  id: string;
  name: string;
  baseUrl: string;
  requestPath: string;
  /** Always normalized; empty historical values surface as `v1`. */
  version: string;
  apiCompat: UpstreamApiCompat;
  tokenCountMode?: ProviderTokenCountMode;
  defaultModel: string;
  enabled: boolean;
  hasApiKey: boolean;
  apiKeyPreview?: string;
  createdAt: string;
  updatedAt: string;
}

export type ProviderDeleteReferenceKind =
  | "route_profile"
  | "main_agent_config"
  | "subagent_orchestration"
  | "active_thread";

export interface ProviderDeleteReference {
  kind: ProviderDeleteReferenceKind;
  id: string;
  name: string;
}

export type ProviderDeleteResult =
  | { ok: true }
  | {
      ok: false;
      reason: "not_found" | "in_use";
      references: ProviderDeleteReference[];
    };

export type ThinkingEffort = "off" | "low" | "medium" | "high" | "xhigh" | "max";

export interface ModelsDevMapping {
  providerKey: string;
  modelId: string;
}

/** User-provided pricing/context/capabilities when models.dev is absent or should be overridden. */
export interface RouteManualSpec {
  /** Context window in tokens. */
  contextTokens?: number;
  /** Max output tokens. */
  maxOutputTokens?: number;
  /** When set, overrides models.dev multimodal detection. */
  supportsImageInput?: boolean;
  /** When set, overrides models.dev reasoning detection. */
  supportsReasoning?: boolean;
  /** USD per million input tokens. */
  inputPerM?: number;
  /** USD per million output tokens. */
  outputPerM?: number;
  cacheReadPerM?: number;
  cacheWritePerM?: number;
  /** Multiplier applied to models.dev catalog rates; default 1. */
  priceMultiplier?: number;
}

export interface CandidateModelInput {
  id?: string;
  providerId: string;
  modelId: string;
  displayName?: string;
  modelsDevMapping?: ModelsDevMapping;
  manualSpec?: RouteManualSpec;
  sortOrder?: number;
}

export interface CandidateModelView {
  id: string;
  providerId: string;
  modelId: string;
  displayName?: string;
  modelsDevMapping?: ModelsDevMapping;
  manualSpec?: RouteManualSpec;
  sortOrder: number;
  /** models.dev 实时解析后的最终有效值（不持久化） */
  resolvedContextTokens?: number;
  resolvedMaxOutputTokens?: number;
  resolvedSupportsImageInput?: boolean;
  resolvedSupportsReasoning?: boolean;
  resolvedInputPerM?: number;
  resolvedOutputPerM?: number;
  resolvedCacheReadPerM?: number;
  resolvedCacheWritePerM?: number;
  modelsDevLabel?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeRoleRouteConfig {
  role: RuntimeAgentRole;
  providerId: string;
  modelId: string;
  /** Overrides provider default when set. */
  apiCompat?: UpstreamApiCompat;
  thinkingEffort?: ThinkingEffort;
  modelsDevMapping?: ModelsDevMapping;
  manualSpec?: RouteManualSpec;
  candidateModelId?: string;
}

export interface RoleRouteConfig extends RuntimeRoleRouteConfig {
  role: AgentRole;
}

export interface RouteProfileView {
  id: string;
  name: string;
  routes: RoleRouteConfig[];
  createdAt: string;
  updatedAt: string;
}

export interface RouteProfileInput {
  id?: string;
  name: string;
  routes: RoleRouteConfig[];
}

export {
  countEnabledMcpServers,
  deriveMcpServersEnabled,
  listEnabledGlobalMcpServerKeys,
} from "./composer-mcp";
export type {
  AuxiliaryModelSelection,
  MainAgentModelOverride,
  MainAgentSystemPromptPreset,
  McpServersEnabledSettings,
  ThreadRuntimeConfig,
  ThreadRuntimeConfigInput,
  VisionModelSelection,
} from "./thread-runtime-config";
export {
  buildThreadRuntimeConfigFromDefaults,
  deriveSubagentEnabledFromSnapshot,
  hasCompleteOrchestrationSelection,
  lockThreadRuntimeConfigSnapshotOnContinue,
  materializeThreadOrchestrationSnapshot,
  serializeThreadRuntimeConfigForCompare,
  shouldRematerializeThreadRuntimeConfigOnContinue,
  threadRuntimeConfigsEquivalent,
  isAskSessionMode,
  isBashReviewModeOnlyRuntimeConfigUpdate,
  isThreadRuntimeConfig,
  normalizeThreadRuntimeConfig,
  orchestrationResourceLookupFromSettings,
  resolveMainAgentModelOverrideForProvider,
  resolveMainAgentSystemPromptPreset,
  resolveSessionMode,
  resolveThreadOrchestrationConfig,
  resolveThreadOrchestrationSnapshot,
  resolveThreadRuntimeMcpServerKeys,
  runtimeRoleRoutesFromOrchestrationSnapshot,
  withAgentSessionMode,
} from "./thread-runtime-config";

export interface PromptImageAttachment {
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  /** Base64 payload without data: URL prefix. */
  data: string;
}

export interface ModelSettingsSnapshot {
  providers: ProviderConfigView[];
  routeProfiles: RouteProfileView[];
  agentTemplates: AgentTemplate[];
  mainAgentConfigs: import("./agent-orchestration").MainAgentConfigResource[];
  mainAgentPrompts: import("./agent-orchestration").MainAgentPromptResource[];
  subagentOrchestrations: import("./agent-orchestration").SubagentOrchestrationResource[];
  mcpSettings?: McpSettingsSnapshot;
}

export interface AgentTemplateExportRequest {
  templateIds?: string[];
}

export interface AgentTemplateExportResult {
  ok: true;
  canceled: boolean;
  exported: number;
  path?: string;
}

export interface AgentTemplateImportResult {
  ok: true;
  canceled: boolean;
  imported: number;
  templates: AgentTemplate[];
  errors: string[];
}

export type ThreadStatus =
  | "queued"
  | "running"
  | "blocked"
  | "awaiting_plan"
  | "idle"
  | "completed"
  | "failed";

export interface ThreadPendingPlan {
  threadId: string;
  userPrompt: string;
  analysis: string;
  plan: string;
  workspacePath: string;
  worktreePath: string;
  /** Claude Code `.claude/plans/` path (workspace-relative when possible). */
  planFilePath?: string;
  /** Exact deferred ExitPlanMode call that may complete after approval. */
  deferredExitPlanToolUseId?: string;
}

/** Approve execution of the pending plan captured from the planner. */
export interface ThreadApprovePlanRequest {
  threadId: string;
  /** @deprecated UI no longer edits plan text; ignored if sent. */
  plan?: string;
  /** @deprecated UI no longer edits plan text; ignored if sent. */
  analysis?: string;
  runtimeConfig?: ThreadRuntimeConfigInput;
}

export interface ThreadSummary {
  id: string;
  title: string;
  prompt: string;
  workspacePath: string;
  status: ThreadStatus;
  createdAt: string;
  updatedAt: string;
  message: string;
  /** Runtime Core permanently selected for this thread after first run. */
  coreKind?: import("@eco/runtime").CoreKind;
  /** ISO timestamp marking the point after which coreKind cannot change. */
  coreLockedAt?: string;
  /** Claude Agent SDK session ID when resume is available. */
  sdkSessionId?: string;
  /** Worktree path used as SDK cwd when the session was created. */
  sdkCwd?: string;
  /** Per-thread orchestration, subagent switches, and session mode (snapshotted at start). */
  runtimeConfig?: ThreadRuntimeConfig;
}

export interface ThreadCompletionNotificationRequest {
  threadId: string;
  /** Whether the user is actively viewing this thread (window focused + selected). */
  activelyViewed: boolean;
}

export interface ThreadCompletionNotificationResult {
  shown: boolean;
  reason?:
    | "unsupported"
    | "invalid_request"
    | "thread_not_found"
    | "thread_not_completed"
    | "notification_content_unavailable"
    | "preference_disabled";
}

export type ThreadApprovalNotificationKind = "plan" | "bash";

export interface ThreadApprovalNotificationRequest {
  threadId: string;
  kind: ThreadApprovalNotificationKind;
  activelyViewed: boolean;
}

export interface ThreadApprovalNotificationResult {
  shown: boolean;
  reason?:
    | "unsupported"
    | "invalid_request"
    | "thread_not_found"
    | "approval_not_pending"
    | "notification_content_unavailable"
    | "preference_disabled";
}

export interface ThreadClarificationNotificationRequest {
  threadId: string;
  activelyViewed: boolean;
}

export interface ThreadClarificationNotificationResult {
  shown: boolean;
  reason?:
    | "unsupported"
    | "invalid_request"
    | "thread_not_found"
    | "clarification_not_pending"
    | "notification_content_unavailable"
    | "preference_disabled";
}

export interface ThreadStartRequest {
  workspacePath: string;
  prompt: string;
  coreKind?: import("@eco/runtime").CoreKind;
  attachments?: PromptImageAttachment[];
  runtimeConfig: ThreadRuntimeConfigInput;
}

export interface ThreadUpdateRuntimeConfigRequest {
  threadId: string;
  runtimeConfig: ThreadRuntimeConfigInput;
}

export interface ThreadStartResult {
  thread: ThreadSummary;
}

export interface ThreadContinueRequest {
  threadId: string;
  prompt: string;
  attachments?: PromptImageAttachment[];
  /** Continue by replacing this prior user activity and pruning everything after it. */
  rewindTarget?: ThreadActivityRewindTarget;
  /** Optional update before sending the next message. */
  runtimeConfig?: ThreadRuntimeConfigInput;
}

export interface ThreadContinueResult {
  thread: ThreadSummary;
}

export type ThreadUserMessageEditReasonCode =
  | "thread_not_found"
  | "thread_running"
  | "unsupported_core"
  | "missing_upstream_mapping"
  | "missing_checkpoint"
  | "workspace_unavailable"
  | "history_changed"
  | "invalid_message"
  | "runtime_unavailable";

export interface ThreadUserMessageEditCapability {
  status: "ready" | "unavailable";
  reasonCode?: ThreadUserMessageEditReasonCode;
  reason?: string;
}

export interface ThreadUserMessageEditGetRequest {
  threadId: string;
  activityLineId: string;
}

export interface ThreadUserMessageEditGetResult {
  threadId: string;
  activityLineId: string;
  upstreamMessageId?: string;
  text: string;
  attachments: PromptImageAttachment[];
  capability: ThreadUserMessageEditCapability;
  historyRevision: number;
}

export interface ThreadRewriteFromMessageRequest {
  threadId: string;
  activityLineId: string;
  prompt: string;
  attachments?: PromptImageAttachment[];
  expectedHistoryRevision: number;
  runtimeConfig?: ThreadRuntimeConfigInput;
}

export interface ThreadResumeSubagentRequest {
  threadId: string;
  agentId: string;
  followupTask?: string;
}

export interface ThreadResumeSubagentResult {
  thread: ThreadSummary;
  agentId: string;
  codexThreadId: string;
}

export type ThreadFollowUpStatus = "queued" | "delivered" | "applied" | "superseded" | "cancelled" | "failed";

export type ThreadFollowUpPriority = "normal" | "escalated";

export type ThreadFollowUpDeliveryMode = "queued" | "resume" | "interrupt_resume" | "streaming_push";

export type ThreadFollowUpRunPhase = "planning" | "execution" | "ask" | "continuation";

export type ThreadFollowUpBoundary = "safe_boundary" | "forced_interrupt";

export interface ThreadPendingFollowUp {
  id: string;
  threadId: string;
  prompt: string;
  attachments?: PromptImageAttachment[];
  priority: ThreadFollowUpPriority;
  status: ThreadFollowUpStatus;
  deliveryMode: ThreadFollowUpDeliveryMode;
  createdAt: string;
  updatedAt: string;
  deliveredAt?: string;
  appliedAt?: string;
  sourceRunAttemptId?: string;
  targetRunAttemptId?: string;
  queuedDuringPhase?: ThreadFollowUpRunPhase;
  deliveryBoundary?: ThreadFollowUpBoundary;
  queuePosition?: number;
  error?: string;
}

export interface ThreadFollowUpEnqueueRequest {
  threadId: string;
  prompt: string;
  attachments?: PromptImageAttachment[];
  priority?: ThreadFollowUpPriority;
  /**
   * Per-message override of the default follow-up delivery mode
   * (e.g. ⌘↩ does the opposite of the settings default).
   */
  followUpDeliveryMode?: FollowUpDeliveryMode;
}

export interface ThreadFollowUpEscalateRequest {
  threadId: string;
  followUpId?: string;
  prompt?: string;
  attachments?: PromptImageAttachment[];
}

export interface ThreadFollowUpCancelRequest {
  threadId: string;
  followUpId: string;
}

export interface ThreadFollowUpEditingRequest {
  threadId: string;
  followUpId?: string;
}

export interface ThreadFollowUpEditingResult {
  editing: boolean;
}

export interface ThreadFollowUpUpdateRequest {
  threadId: string;
  followUpId: string;
  prompt: string;
  attachments?: PromptImageAttachment[];
}

export interface ThreadFollowUpReorderRequest {
  threadId: string;
  followUpIds: string[];
}

export interface ThreadFollowUpListResult {
  followUps: ThreadPendingFollowUp[];
}

export interface ThreadFollowUpMutationResult extends ThreadFollowUpListResult {
  followUp: ThreadPendingFollowUp;
}

export interface ThreadDeleteResult {
  ok: true;
}

export interface ComposerDraftRecord {
  contextKey: string;
  prompt: string;
  updatedAt: string;
}

export interface ComposerDraftSaveRequest {
  contextKey: string;
  prompt: string;
}

export interface ThreadRollbackResult {
  ok: true;
  revertedThreads: number;
  files: string[];
  message: string;
}

export type WorktreeCancelDisposition = "apply" | "keep" | "discard";

export interface ThreadCancelRequest {
  threadId: string;
  worktreeDisposition?: WorktreeCancelDisposition;
}

export type CoderTodoStatus = "pending" | "running" | "completed" | "blocked" | "cancelled";

export interface CoderTodoItem {
  id: string;
  threadId: string;
  title: string;
  detail: string;
  status: CoderTodoStatus;
  position: number;
  updatedAt: string;
}

export interface WorktreeStatusResult {
  exists: boolean;
  worktreePath: string;
  workspacePath: string;
  changedFiles: string[];
}

export interface WorktreeApplyResult {
  ok: true;
  files: string[];
  message: string;
}

export interface FileCheckpointRecord {
  userMessageId: string;
  activityLineId?: string;
  createdAt: string;
}

export interface ThreadRewindCheckpointRequest {
  threadId: string;
  userMessageId: string;
}

export interface ThreadRewindCheckpointResult {
  ok: boolean;
  message: string;
}

export interface ThreadAppliedDiffFileStat {
  path: string;
  additions: number;
  deletions: number;
}

export interface ThreadAppliedDiffResult {
  diff: string;
  files: string[];
  fileStats: ThreadAppliedDiffFileStat[];
  totalAdditions: number;
  totalDeletions: number;
  rolledBackAt?: string;
}

export interface ThreadRevertAppliedDiffResult {
  ok: true;
  files: string[];
  message: string;
}

export interface ClarificationQuestionOption {
  label: string;
  description?: string;
  /** Matches AskUserQuestion option hint; shown as （推荐） in UI */
  recommended?: boolean;
}

export interface ClarificationQuestion {
  question: string;
  header?: string;
  options: ClarificationQuestionOption[];
  multiSelect?: boolean;
  allowCustom?: boolean;
  preserveCustomText?: boolean;
}

export interface ClarificationRequest {
  toolUseId: string;
  threadId: string;
  questions: ClarificationQuestion[];
}

/** selections[i] = chosen option labels for question i */
export interface ClarificationAnswers {
  toolUseId: string;
  selections: string[][];
  customInputIndices?: number[];
}

export interface ClarificationSubmitPayload {
  toolUseId: string;
  selections: string[][];
  customInputIndices?: number[];
}

export type BashApprovalKind = "command" | "file_change" | "network" | "image_generation";

export interface BashApprovalNetworkPolicyAmendment {
  host: string;
  action: "allow" | "deny";
}

export interface BashApprovalRequest {
  toolUseId: string;
  threadId: string;
  command: string;
  cwd: string;
  reason: string;
  riskScore: number;
  riskLevel: "low" | "medium" | "high" | "critical";
  agentId: string;
  agentType?: string;
  description?: string;
  /** Auxiliary-model explanation, kept separate from the original approval request. */
  reviewRationale?: string;
  kind?: BashApprovalKind;
  /** When set, this approval is for a filesystem tool outside the workspace. */
  filesystemTool?: string;
  filesystemPath?: string;
  proposedExecpolicyAmendment?: string[];
  proposedNetworkPolicyAmendments?: BashApprovalNetworkPolicyAmendment[];
}

export type BashApprovalDecision =
  | "approved"
  | "approved_remember_prefix"
  | "approved_for_session"
  | "approved_execpolicy_amendment"
  | "approved_network_policy_amendment"
  | "denied"
  | "cancelled";

export interface BashApprovalResolvePayload {
  toolUseId: string;
  decision: BashApprovalDecision;
  /** When denying, optional instructions for Eco on how to adjust. */
  feedback?: string;
}

export interface PlanApprovalRequest {
  toolUseId: string;
  threadId: string;
  userPrompt: string;
  analysis: string;
  plan: string;
  planFilePath?: string;
}

export type PlanApprovalDecision = "approved" | "denied";

export type ContextSegmentKey =
  | "systemPrompt"
  | "toolDefinitions"
  | "rules"
  | "skills"
  | "mcp"
  | "subagentDefinitions"
  | "conversation"
  | "unattributed";

export interface ContextBreakdownSegment {
  key: ContextSegmentKey;
  label: string;
  tokens: number;
  color: string;
}

export interface ThreadRoleContextSnapshot {
  role: RuntimeAgentRole;
  occupied: number;
  limit: number;
  occupancyPct: number;
  limitsResolved: boolean;
  modelId?: string;
  segments: ContextBreakdownSegment[];
  maxOutputTokens?: number;
}

export interface ThreadContextInstanceSnapshot {
  agentId: string;
  role: RuntimeAgentRole;
  occupied: number;
  limit: number;
  occupancyPct: number;
  limitsResolved: boolean;
  modelId?: string;
  segments: ContextBreakdownSegment[];
  maxOutputTokens?: number;
  updatedAt: number;
}

export interface ThreadContextSnapshot {
  occupied: number;
  limit: number;
  occupancyPct: number;
  limitsResolved: boolean;
  /** Which agent role/key's session fill is shown. */
  displayRole?: RuntimeAgentRole;
  modelId?: string;
  segments: ContextBreakdownSegment[];
  roles?: ThreadRoleContextSnapshot[];
  instances?: ThreadContextInstanceSnapshot[];
  updatedAt: number;
  maxOutputTokens?: number;
}

export interface ThreadUsageSnapshot {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  contextTokens: number;
  contextLimit?: number;
  occupancyPct?: number;
  modelId?: string;
}

export interface ThreadModelUsageEntry {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd?: number;
}

export type BillingUsageSource = "proxy" | "sdk" | "codex" | "pi";

export interface TokenCostBreakdown {
  inputUsd: number;
  outputUsd: number;
  cacheReadUsd: number;
  cacheCreationUsd: number;
  totalUsd: number;
}

export interface ThreadBillingModelSnapshot {
  modelId: string;
  roles: RuntimeAgentRole[];
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  ecoCostUsd: number;
  /** Cost reported by the source itself, when available (SDK estimate). */
  reportedCostUsd?: number;
}

export interface ThreadBillingSourceSnapshot {
  source: BillingUsageSource;
  totalTokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheCreation: number;
  };
  plannerTokenCostUsd: number;
  ecoCostUsd: number;
  /** Cost reported by the source itself, when available (SDK estimate). */
  reportedCostUsd?: number;
  pricingResolved: boolean;
  byModel?: ThreadBillingModelSnapshot[];
  byRole?: Partial<
    Record<
      RuntimeAgentRole,
      {
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens: number;
        cacheCreationTokens: number;
        ecoCostUsd: number;
        modelId?: string;
      }
    >
  >;
}

export interface ThreadSubagentBillingSnapshot {
  agentId: string;
  role: RuntimeAgentRole;
  status: "active" | "stopped";
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  contextOccupied: number;
  contextLimit?: number;
  ecoCostUsd: number;
  ecoCostBreakdown?: TokenCostBreakdown;
  modelId?: string;
}

export type ThreadBillingDiagnosticSeverity = "info" | "warning" | "error";

export type ThreadBillingDiagnosticType =
  | "pricing_unresolved"
  | "projection_missing"
  | "primary_source_mismatch"
  | "token_mismatch"
  | "cost_mismatch"
  | "subagent_metrics_mismatch"
  | "unattributed_usage"
  | "unresolved_usage"
  | "pending_attribution"
  | "shadow_reconciliation";

export interface ThreadBillingDiagnostic {
  type: ThreadBillingDiagnosticType;
  severity: ThreadBillingDiagnosticSeverity;
  message: string;
  source?: BillingUsageSource;
  agentId?: string;
  field?: string;
  delta?: number;
  count?: number;
}

export interface ThreadBillingSnapshot {
  totalTokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheCreation: number;
  };
  sourceReportedCostUsd: number;
  plannerTokenCostUsd: number;
  ecoCostUsd: number;
  savedUsd: number;
  savedPct: number;
  ecoCostBreakdown?: TokenCostBreakdown;
  plannerCostBreakdown?: TokenCostBreakdown;
  plannerModelLabel?: string;
  pricingResolved: boolean;
  /** Primary source used for settlement and validation; SDK-first when present. */
  primarySource?: BillingUsageSource;
  /** Headline totals shown in UI; uses proxy while running, otherwise matches primarySource. */
  displaySource?: BillingUsageSource;
  sourceBreakdown?: Partial<Record<BillingUsageSource, ThreadBillingSourceSnapshot>>;
  byModel?: ThreadBillingModelSnapshot[];
  byRole?: Partial<
    Record<
      RuntimeAgentRole,
      {
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens: number;
        cacheCreationTokens: number;
        ecoCostUsd: number;
        modelId?: string;
      }
    >
  >;
  subagents?: ThreadSubagentBillingSnapshot[];
  diagnostics?: ThreadBillingDiagnostic[];
}

export interface ThreadUsageSnapshotResult {
  billing?: ThreadBillingSnapshot;
  context?: ThreadContextSnapshot;
}

export interface ThreadSessionBootstrapResult {
  thread?: ThreadSummary;
  followUps: ThreadPendingFollowUp[];
  pendingPlan?: ThreadPendingPlan;
  pendingBash?: BashApprovalRequest;
  pendingClarification?: ClarificationRequest;
  subagentSessions: ThreadSubagentSessionTiming[];
  usage: ThreadUsageSnapshotResult;
}

export interface RoutePricingRates {
  inputPerM: number;
  outputPerM: number;
  cacheReadPerM?: number;
  cacheWritePerM?: number;
}

export interface RoutePricingHint {
  role: RuntimeAgentRole;
  modelId: string;
  providerName: string;
  /** models.dev 参考单价（每百万 token，USD） */
  rates?: RoutePricingRates;
  /** catalog 原始单价，用于手动覆盖面板的「自动」提示 */
  catalogRates?: RoutePricingRates;
  /** 完整说明，用于悬停提示 */
  pricingLabel?: string;
  pricingResolved: boolean;
}

export interface CommitModelPricingHint {
  candidateModelId: string;
  modelId: string;
  providerName: string;
  rates?: RoutePricingRates;
  catalogRates?: RoutePricingRates;
  pricingLabel?: string;
  pricingResolved: boolean;
}

export interface RouteCapabilityHint {
  role: RuntimeAgentRole;
  modelId: string;
  providerName: string;
  supportsImageInput: boolean;
  supportsReasoning: boolean;
  capabilitiesResolved: boolean;
  contextTokens?: number;
  maxOutputTokens?: number;
  contextLimitResolved: boolean;
  /** catalog 原始能力，用于手动覆盖面板的「自动」提示 */
  catalogSupportsImageInput?: boolean;
  catalogSupportsReasoning?: boolean;
  catalogContextTokens?: number;
  catalogMaxOutputTokens?: number;
  modelsDevMapping?: ModelsDevMapping;
  modelsDevLabel?: string;
  /** 自动匹配命中的 models.dev 模型（非手动映射） */
  resolvedModelsDevMapping?: ModelsDevMapping;
  resolvedModelsDevLabel?: string;
}

export interface ModelsDevModelOption {
  providerKey: string;
  modelId: string;
  displayName: string;
}

export interface ThreadSubagentSessionTiming {
  agentId: string;
  role: RuntimeAgentRole;
  status: "active" | "stopped" | "handed_off";
  startedAt: string;
  lastActiveAt: string;
  endedAt?: string;
  accumulatedMs: number;
  /** Active processing duration (accumulated + current segment when active). */
  durationMs: number;
}

export interface ThreadSubagentMetricsSummary {
  agentId: string;
  role: RuntimeAgentRole;
  status: "active" | "stopped";
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  contextOccupied: number;
  contextLimit?: number;
  ecoCostUsd: number;
  modelId?: string;
}

export interface ThreadLiveEvent {
  threadId: string;
  type: string;
  message: string;
  title?: string;
  /** Whether an auxiliary model is currently generating this thread's title. */
  titleGenerating?: boolean;
  role?: RuntimeAgentRole | "system" | "thinking" | "tool" | "user";
  stream?: boolean;
  /** Set when the main process persisted this event as a thread_activity row. */
  activityLine?: ThreadActivityLine;
  plan?: Pick<ThreadPendingPlan, "analysis" | "plan" | "userPrompt" | "planFilePath">;
  planApproval?: PlanApprovalRequest;
  clarification?: ClarificationRequest;
  bashApproval?: BashApprovalRequest;
  followUp?: ThreadPendingFollowUp;
  todoList?: CoderTodoItem[];
  usage?: ThreadUsageSnapshot;
  modelId?: string;
  /** Cumulative SDK-estimated cost across all query() calls in this thread. */
  totalCostUsd?: number;
  modelUsage?: Record<string, ThreadModelUsageEntry>;
  billing?: ThreadBillingSnapshot;
  context?: ThreadContextSnapshot;
  projection?: ThreadRunProjectionSnapshot;
  subagentSessions?: ThreadSubagentSessionTiming[];
  apiError?: ThreadApiErrorInfo;
  runtimeConfig?: ThreadRuntimeConfig;
  tool?: ThreadRunToolMetadata;
  /** Desktop-only unthrottled SDK stream overlay. Never forwarded through the event center. */
  localStream?: ThreadLocalStreamUpdate;
}

export interface ThreadLocalStreamUpdate {
  threadId: string;
  streamKey: string;
  text: string;
  role: string;
  channel: "message" | "thinking";
  streaming: boolean;
  observedAt: string;
  agentId?: string;
  /** Present from the first thinking overlay frame so the Feed does not flip kinds. */
  reasoningDisplay?: "summary" | "raw";
}

export interface ThreadApiErrorInfo {
  statusCode?: number;
  code?: string;
  message: string;
  model?: string;
}

export interface ThreadActivityLine {
  id: string;
  role: string;
  message: string;
  stream?: boolean;
  /** SDK-backed target that can be used to fork from this user message. */
  rewindTarget?: ThreadActivityRewindTarget;
  /** Sub-agent instance id (SDK session_id / SubagentStart agent_id). */
  agentId?: string;
  /** Structured API failure from OTLP api_error event (not parsed from stream text). */
  apiError?: ThreadApiErrorInfo;
}

export interface ThreadUsageLedgerEventView {
  id: string;
  source: BillingUsageSource;
  role: RuntimeAgentRole;
  routeRole: RuntimeAgentRole;
  billingRole: RuntimeAgentRole;
  modelId?: string;
  aliasModelId?: string;
  providerId?: string;
  agentId?: string;
  requestKey?: string;
  providerRequestId?: string;
  attributionStatus: "attributed" | "pending" | "unattributed";
  attributionReason?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  ecoCostUsd?: number;
  reportedCostUsd?: number;
  pricingResolved?: boolean;
  observedAt: string;
}

export interface ThreadActivityRewindTarget {
  activityLineId: string;
  /** Current provider message id. Deprecated for new edit RPCs; server resolves it. */
  userMessageId?: string;
}

export function isGitGenerateCommitMessageRequest(value: unknown): value is GitGenerateCommitMessageRequest {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.workspacePath === "string" &&
    typeof record.mainAgentConfigId === "string" &&
    typeof record.includeUnstaged === "boolean"
  );
}

export function parseGitListCommitModelOptionsRequest(value: unknown): GitListCommitModelOptionsRequest {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid git list commit model options request.");
  }
  const record = value as Record<string, unknown>;
  const mainAgentConfigId =
    typeof record.mainAgentConfigId === "string" ? record.mainAgentConfigId.trim() : "";
  if (!mainAgentConfigId) {
    throw new Error("Invalid git list commit model options request.");
  }
  return { mainAgentConfigId };
}

export function isGitListCommitModelOptionsRequest(value: unknown): value is GitListCommitModelOptionsRequest {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  const mainAgentConfigId =
    typeof record.mainAgentConfigId === "string" ? record.mainAgentConfigId.trim() : "";
  return Boolean(mainAgentConfigId);
}

export function isGitListCommitsRequest(value: unknown): value is GitListCommitsRequest {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.workspacePath === "string" &&
    typeof record.skip === "number" &&
    Number.isFinite(record.skip) &&
    typeof record.limit === "number" &&
    Number.isFinite(record.limit) &&
    record.limit > 0
  );
}

export function isGitCommitRequest(value: unknown): value is GitCommitRequest {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.workspacePath === "string" &&
    typeof record.mainAgentConfigId === "string" &&
    typeof record.includeUnstaged === "boolean"
  );
}

export function isGitPushRequest(value: unknown): value is GitPushRequest {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.workspacePath === "string";
}

export function isGitFetchRequest(value: unknown): value is GitFetchRequest {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.workspacePath === "string";
}

export function isGitPullRequest(value: unknown): value is GitPullRequest {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.workspacePath === "string";
}

export function isRunPackageScriptRequest(value: unknown): value is RunPackageScriptRequest {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.workspacePath === "string" &&
    typeof record.script === "string" &&
    (record.args === undefined || typeof record.args === "string") &&
    (record.threadId === undefined || typeof record.threadId === "string")
  );
}

export function isSavePackageScriptArgsRequest(value: unknown): value is SavePackageScriptArgsRequest {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.workspacePath === "string" &&
    typeof record.script === "string" &&
    typeof record.args === "string"
  );
}

export function isPackageScriptTerminalLaunchPayload(
  value: unknown,
): value is PackageScriptTerminalLaunchPayload {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.workspacePath === "string" &&
    typeof record.sessionId === "string" &&
    typeof record.script === "string" &&
    (record.taskId === undefined || typeof record.taskId === "string") &&
    Array.isArray(record.command) &&
    record.command.every((entry) => typeof entry === "string")
  );
}

export function isBackgroundTerminalListRequest(value: unknown): value is BackgroundTerminalListRequest {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    (record.workspacePath === undefined || typeof record.workspacePath === "string") &&
    (record.threadId === undefined || typeof record.threadId === "string")
  );
}

export function isBackgroundTerminalStartRequest(value: unknown): value is BackgroundTerminalStartRequest {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.workspacePath === "string" &&
    Array.isArray(record.command) &&
    record.command.length > 0 &&
    record.command.every((entry) => typeof entry === "string") &&
    (record.label === undefined || typeof record.label === "string") &&
    (record.threadId === undefined || typeof record.threadId === "string")
  );
}

export function isBackgroundTerminalOpenRequest(value: unknown): value is BackgroundTerminalOpenRequest {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.taskId === "string";
}

export function isBackgroundTerminalStopRequest(value: unknown): value is BackgroundTerminalStopRequest {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.taskId === "string";
}

export function isTerminalSpawnRequest(value: unknown): value is TerminalSpawnRequest {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.workspacePath === "string" &&
    (record.cols === undefined || typeof record.cols === "number") &&
    (record.rows === undefined || typeof record.rows === "number")
  );
}

export function isTerminalListRequest(value: unknown): value is TerminalListRequest {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.workspacePath === undefined || typeof record.workspacePath === "string";
}

export function isTerminalInputRequest(value: unknown): value is TerminalInputRequest {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.sessionId === "string" && typeof record.data === "string";
}

export function isTerminalResizeRequest(value: unknown): value is TerminalResizeRequest {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.sessionId === "string" && typeof record.cols === "number" && typeof record.rows === "number"
  );
}

export function isTerminalKillRequest(value: unknown): value is TerminalKillRequest {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.sessionId === "string";
}

export function isTerminalStreamEvent(value: unknown): value is TerminalStreamEvent {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record.type === "started") {
    return typeof record.sessionId === "string" && typeof record.workspacePath === "string";
  }
  if (record.type === "output") {
    return typeof record.sessionId === "string" && typeof record.data === "string";
  }
  if (record.type === "exit") {
    return typeof record.sessionId === "string" && typeof record.exitCode === "number";
  }
  if (record.type === "error") {
    return typeof record.sessionId === "string" && typeof record.message === "string";
  }
  return false;
}

export type {
  StorageCategoryId,
  StorageCategoryUsage,
  StorageCleanupAction,
  StorageCleanupRequest,
  StorageCleanupResult,
  StorageUnmeteredId,
  StorageUnmeteredItem,
  StorageUsageSnapshot,
} from "./storage-usage";

export function isStorageCleanupRequest(value: unknown): value is import("./storage-usage").StorageCleanupRequest {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  const action = record.action;
  if (
    action !== "clearLogs" &&
    action !== "clearCodexCheckpoints" &&
    action !== "clearCodexHomeCaches" &&
    action !== "clearClaudeSessions" &&
    action !== "clearPiAgent" &&
    action !== "clearAllConversations" &&
    action !== "vacuumDatabase"
  ) {
    return false;
  }
  if (record.options === undefined) {
    return true;
  }
  if (!record.options || typeof record.options !== "object") {
    return false;
  }
  const options = record.options as Record<string, unknown>;
  if (
    options.olderThanDays !== undefined &&
    (typeof options.olderThanDays !== "number" || !Number.isFinite(options.olderThanDays))
  ) {
    return false;
  }
  if (options.orphansOnly !== undefined && typeof options.orphansOnly !== "boolean") {
    return false;
  }
  return true;
}
