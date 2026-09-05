import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { DesktopUpdateState } from "../shared/desktop-update";
import {
  type AgentTemplate,
  type AgentTemplateExportRequest,
  type AgentTemplateExportResult,
  type AgentTemplateImportResult,
  type AppMenuCommand,
  type AsrInputDeviceSaveInput,
  type AsrProfileActivateRequest,
  type AsrProfileDeleteRequest,
  type AsrProfileSaveInput,
  type AsrProfileSnapshot,
  type AsrProfilesSnapshot,
  type AsrSettingsInput,
  type AsrSettingsSnapshot,
  type AsrTranscribeRequest,
  type AsrTranscribeResult,
  type BackgroundTerminalListRequest,
  type BackgroundTerminalOpenRequest,
  type BackgroundTerminalStartRequest,
  type BackgroundTerminalStopRequest,
  type BackgroundTerminalStopResult,
  type BackgroundTerminalTask,
  type BashApprovalRequest,
  type BashApprovalResolvePayload,
  type BrowserCloseRequest,
  type BrowserFocusRequest,
  type BrowserNavigateRequest,
  type BrowserOpenRequest,
  type BrowserRegisterGuestRequest,
  type BrowserSettingsSnapshot,
  type BrowserSetUiScopeRequest,
  type BrowserSetVisibleRequest,
  type BrowserViewState,
  type BrowserAgentPresenceEvent,
  type CandidateModelInput,
  type CandidateModelView,
  type CenterServerAccountAuthResult,
  type CenterServerApproveVaultClaimResult,
  type CenterServerCreatePairingResult,
  type CenterServerDeviceBindingView,
  type CenterServerDevicePresenceView,
  type CenterServerRegisterDesktopRequest,
  type CenterServerRegisterDesktopResult,
  type CenterServerRemoveConnectionOptions,
  type CenterServerRemoveConnectionResult,
  type CenterServerRequestVaultClaimResult,
  type CenterServerSettingsInput,
  type CenterServerSettingsSnapshot,
  type CenterServerSignInRequest,
  type CenterServerSignUpRequest,
  type CenterServerSubmitVaultClaimCodeResult,
  type CenterServerSyncConfigResult,
  type CenterServerSyncDomain,
  type CenterServerSyncDomainResult,
  type CenterServerSyncStatusSnapshot,
  type CenterServerTestConnectionRequest,
  type CenterServerTestConnectionResult,
  type CenterServerVaultClaimView,
  type CenterServerVaultStatus,
  type ClarificationRequest,
  type ClarificationSubmitPayload,
  type CoderTodoItem,
  type ComposerDraftDeleteRequest,
  type ComposerDraftDeleteResult,
  type ComposerDraftRecord,
  type ComposerDraftSaveRequest,
  type CoreAvailabilitySnapshot,
  type CursorAgentsListResult,
  type CursorModelOption,
  type FileCheckpointRecord,
  type GitCheckoutBranchRequest,
  type GitCommitRequest,
  type GitCommitResult,
  type GitCreateBranchRequest,
  type GitDiscardWorkspaceChangesRequest,
  type GitDiscardWorkspaceChangesResult,
  type GitFetchRequest,
  type GitFetchResult,
  type GitGenerateCommitMessageDeltaPayload,
  type GitGenerateCommitMessageRequest,
  type GitGenerateCommitMessageResult,
  type GitGetWorkspaceFileDiffRequest,
  type GitListCommitModelOptionsRequest,
  type GitListCommitModelOptionsResult,
  type GitListCommitsRequest,
  type GitListCommitsResult,
  type GitPullRequest,
  type GitPullResult,
  type GitPushRequest,
  type GitPushResult,
  type GitSettingsSnapshot,
  type GitWorkingTreeStatus,
  type ImageGenerationArtifact,
  type ImageGenerationArtifactReadRequest,
  type ImageGenerationArtifactReadResult,
  type ImageGenerationProfileSaveInput,
  type ImageGenerationProfileSnapshot,
  type ImageGenerationSettingsSnapshot,
  type ImageDisplayArtifact,
  type ImageDisplayArtifactReadRequest,
  type ImageDisplayReadResult,
  type ImageViewReadRequest,
  type ImageViewReadResult,
  type IntegrationAvailabilitySnapshot,
  IPC_CHANNELS,
  type IpcChannel,
  type LinkAgentsSkillsRequest,
  type LinkAgentsSkillsResult,
  type ListUpstreamModelsRequest,
  type ListUpstreamModelsResult,
  type MainAgentConfigResource,
  type MainAgentPromptResource,
  type McpServerCheckResult,
  type McpServerConfigInput,
  type McpServerConfigView,
  type McpSettingsSnapshot,
  type ModelSettingsSnapshot,
  type ModelsDevModelOption,
  type PackageScriptsListResult,
  type PackageScriptTerminalLaunchPayload,
  type PersonalizationSettingsSnapshot,
  type ProjectIntegrationsSettingsSnapshot,
  type ProjectMcpSettingsSnapshot,
  type ProjectOrchestrationSettingsSnapshot,
  type ProjectSkillsSettingsSnapshot,
  type PromptImageReleaseRequest,
  type PromptImageStageRequest,
  type PromptImageStageResult,
  type ProviderConfigInput,
  type ProviderConfigView,
  type ProviderDeleteResult,
  type ProxyBridgeSettingsSnapshot,
  type IntegratedWebSearchSettingsSaveInput,
  type IntegratedWebSearchSettingsSnapshot,
  type RouteCapabilityHint,
  type RoutePricingHint,
  type RouteProfileInput,
  type RouteProfileView,
  type RunPackageScriptRequest,
  type RuntimeRoleRouteConfig,
  type SavePackageScriptArgsRequest,
  type SkillCatalogInstallRequest,
  type SkillCatalogInstallResult,
  type SkillCatalogSearchRequest,
  type SkillCatalogSearchResult,
  type SkillsListResult,
  type SkillUninstallRequest,
  type SkillUninstallResult,
  type StartPackageScriptResult,
  type StorageCleanupRequest,
  type StorageCleanupResult,
  type StorageUsageSnapshot,
  type SubagentOrchestrationResource,
  type TerminalInputRequest,
  type TerminalListRequest,
  type TerminalResizeRequest,
  type TerminalSessionView,
  type TerminalSpawnRequest,
  type TerminalSpawnResult,
  type TerminalStreamEvent,
  type TestProviderConnectionRequest,
  type TestProviderConnectionResult,
  type TestRoleRoutesRequest,
  type TestRoleRoutesResult,
  type ThreadActivityLine,
  type ThreadAppliedDiffResult,
  type ThreadApprovalNotificationRequest,
  type ThreadApprovalNotificationResult,
  type ThreadApprovePlanRequest,
  type ThreadCancelRequest,
  type ThreadClarificationNotificationRequest,
  type ThreadClarificationNotificationResult,
  type ThreadCompletionNotificationRequest,
  type ThreadCompletionNotificationResult,
  type ThreadContinueRequest,
  type ThreadContinueResult,
  type ThreadDeleteResult,
  type ThreadFollowUpCancelRequest,
  type ThreadFollowUpEditingRequest,
  type ThreadFollowUpEditingResult,
  type ThreadFollowUpEnqueueRequest,
  type ThreadFollowUpEscalateRequest,
  type ThreadFollowUpListResult,
  type ThreadFollowUpMutationResult,
  type ThreadFollowUpQueuePausedRequest,
  type ThreadFollowUpQueuePausedResult,
  type ThreadFollowUpReorderRequest,
  type ThreadFollowUpUpdateRequest,
  type ThreadPendingPlan,
  type ThreadRetryFromMessageRequest,
  type ThreadRevertAppliedDiffResult,
  type ThreadRewindCheckpointRequest,
  type ThreadRewindCheckpointResult,
  type ThreadRewriteFromMessageRequest,
  type ThreadRollbackResult,
  type ThreadRunProjectionDetailRequest,
  type ThreadRunProjectionDetailResult,
  type ThreadRunProjectionSnapshot,
  type ThreadSessionBootstrapResult,
  type ThreadStartRequest,
  type ThreadStartResult,
  type ThreadSubagentMetricsSummary,
  type ThreadSubagentSessionTiming,
  type ThreadSummary,
  type ThreadUpdateRuntimeConfigRequest,
  type ThreadUsageLedgerEventView,
  type ThreadUsageSnapshotResult,
  type ThreadUserMessageEditGetRequest,
  type ThreadUserMessageEditGetResult,
  type WorkflowSettingsSnapshot,
  type WorkspaceDiffResult,
  type WorkspaceDirectoryListing,
  type WorkspaceFileBrowserRequest,
  type WorkspaceFileDiffResult,
  type WorkspaceFileEntry,
  type WorkspaceFileReadRequest,
  type WorkspaceFileReadResult,
  type WorkspaceFileWriteRequest,
  type WorkspaceFileWriteResult,
  type WorkspaceInfo,
  type WorkspaceOpenResult,
  type WorktreeApplyResult,
  type WorktreeStatusResult,
} from "../shared/ipc";
import type { AppLocalePreference } from "../shared/locale";
import type { NotificationSettingsSnapshot } from "../shared/notification-settings";
import type { WebChatListSnapshot, WebChatListView } from "../shared/web-chat-list";

type InvokePayload = Record<string, unknown> | undefined;

function resolveWindowsBackdropVersion(): "win10" | "win11" | undefined {
  const argument = process.argv.find((value) => value.startsWith("--eco-windows-backdrop="));
  const version = argument?.slice("--eco-windows-backdrop=".length);
  return version === "win10" || version === "win11" ? version : undefined;
}

const api = {
  platform: process.platform,
  windowsBackdropVersion: resolveWindowsBackdropVersion(),
  channels: IPC_CHANNELS,
  invoke(channel: IpcChannel, payload?: InvokePayload): Promise<unknown> {
    return ipcRenderer.invoke(channel, payload);
  },
  setAppThemeSource(
    themeSource: "dark" | "light" | "system",
  ): Promise<{ themeSource: "dark" | "light" | "system" }> {
    return ipcRenderer.invoke(IPC_CHANNELS.appSetThemeSource, themeSource);
  },
  setWindowTitlebarMode(mode: "landing" | "conversation"): Promise<{ mode: "landing" | "conversation" }> {
    return ipcRenderer.invoke(IPC_CHANNELS.appSetWindowTitlebarMode, mode);
  },
  markRendererReady(): Promise<{ ok: true }> {
    return ipcRenderer.invoke(IPC_CHANNELS.appRendererReady);
  },
  setLocalePreference(
    localePreference: AppLocalePreference,
  ): Promise<{ localePreference: AppLocalePreference }> {
    return ipcRenderer.invoke(IPC_CHANNELS.appSetLocale, localePreference);
  },
  getDesktopUpdateState(): Promise<DesktopUpdateState> {
    return ipcRenderer.invoke(IPC_CHANNELS.appUpdateGetState);
  },
  checkDesktopForUpdates(): Promise<DesktopUpdateState> {
    return ipcRenderer.invoke(IPC_CHANNELS.appUpdateCheck);
  },
  downloadDesktopUpdate(): Promise<DesktopUpdateState> {
    return ipcRenderer.invoke(IPC_CHANNELS.appUpdateDownload);
  },
  installDesktopUpdate(): Promise<DesktopUpdateState> {
    return ipcRenderer.invoke(IPC_CHANNELS.appUpdateInstall);
  },
  openDesktopReleasePage(): Promise<{ ok: true }> {
    return ipcRenderer.invoke(IPC_CHANNELS.appUpdateOpenRelease);
  },
  onDesktopUpdateStateChanged(callback: (state: DesktopUpdateState) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: DesktopUpdateState) => {
      callback(payload);
    };
    ipcRenderer.on(IPC_CHANNELS.appUpdateStateChanged, listener);
    return () => ipcRenderer.off(IPC_CHANNELS.appUpdateStateChanged, listener);
  },
  showThreadCompletionNotification(
    request: ThreadCompletionNotificationRequest,
  ): Promise<ThreadCompletionNotificationResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.appShowThreadCompletionNotification, request);
  },
  showThreadApprovalNotification(
    request: ThreadApprovalNotificationRequest,
  ): Promise<ThreadApprovalNotificationResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.appShowThreadApprovalNotification, request);
  },
  showThreadClarificationNotification(
    request: ThreadClarificationNotificationRequest,
  ): Promise<ThreadClarificationNotificationResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.appShowThreadClarificationNotification, request);
  },
  consumePendingThreadOpen(): Promise<string | undefined> {
    return ipcRenderer.invoke(IPC_CHANNELS.appConsumePendingThreadOpen);
  },
  onThreadOpenRequested(callback: (threadId?: string) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, threadId?: unknown) => {
      callback(typeof threadId === "string" && threadId.trim() ? threadId.trim() : undefined);
    };
    ipcRenderer.on(IPC_CHANNELS.appThreadOpenRequested, listener);
    return () => ipcRenderer.off(IPC_CHANNELS.appThreadOpenRequested, listener);
  },
  onAppMenuCommand(callback: (command: AppMenuCommand) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, command: AppMenuCommand) => callback(command);
    ipcRenderer.on(IPC_CHANNELS.appMenuCommand, listener);
    return () => ipcRenderer.off(IPC_CHANNELS.appMenuCommand, listener);
  },
  getCoreAvailability(): Promise<CoreAvailabilitySnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.coreAvailabilityGet);
  },
  listCursorModels(): Promise<CursorModelOption[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.cursorModelsList);
  },
  openWorkspace(): Promise<WorkspaceOpenResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.workspaceOpen);
  },
  openWorkspacePath(workspacePath: string): Promise<WorkspaceInfo> {
    return ipcRenderer.invoke(IPC_CHANNELS.workspaceOpenPath, workspacePath);
  },
  getPathForFile(file: File): string {
    return webUtils.getPathForFile(file);
  },
  getCurrentWorkspace(): Promise<WorkspaceInfo | undefined> {
    return ipcRenderer.invoke(IPC_CHANNELS.workspaceGetCurrent);
  },
  getHomeProjectPath(): Promise<string> {
    return ipcRenderer.invoke(IPC_CHANNELS.workspaceGetHomePath);
  },
  getUserHomePath(): Promise<string> {
    return ipcRenderer.invoke(IPC_CHANNELS.workspaceGetUserHomePath);
  },
  listWorkspaceDirectories(directoryPath: string): Promise<WorkspaceDirectoryListing> {
    return ipcRenderer.invoke(IPC_CHANNELS.workspaceListDirectories, directoryPath);
  },
  listWorkspaceEntries(request: WorkspaceFileBrowserRequest): Promise<WorkspaceFileEntry[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.workspaceListEntries, request);
  },
  readWorkspaceFile(request: WorkspaceFileReadRequest): Promise<WorkspaceFileReadResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.workspaceReadFile, request);
  },
  writeWorkspaceFile(request: WorkspaceFileWriteRequest): Promise<WorkspaceFileWriteResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.workspaceWriteFile, request);
  },
  inspectWorkspace(workspacePath: string): Promise<WorkspaceInfo> {
    return ipcRenderer.invoke(IPC_CHANNELS.workspaceInspect, workspacePath);
  },
  openWorkspaceInFileManager(workspacePath: string): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.workspaceOpenInFileManager, workspacePath);
  },
  prepareWorkspaceGit(workspacePath: string): Promise<WorkspaceInfo> {
    return ipcRenderer.invoke(IPC_CHANNELS.workspacePrepareGit, { workspacePath });
  },
  listPackageScripts(workspacePath: string): Promise<PackageScriptsListResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.workspaceListPackageScripts, workspacePath);
  },
  savePackageScriptArgs(
    request: SavePackageScriptArgsRequest,
  ): Promise<{ workspacePath: string; scriptArgs: Record<string, string> }> {
    return ipcRenderer.invoke(IPC_CHANNELS.workspaceSavePackageScriptArgs, request);
  },
  watchPackageJson(workspacePath: string): Promise<{ ok: true }> {
    return ipcRenderer.invoke(IPC_CHANNELS.workspaceWatchPackageJson, workspacePath);
  },
  onPackageJsonChanged(callback: (workspacePath: string) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      if (typeof payload === "string") {
        callback(payload);
      }
    };
    ipcRenderer.on(IPC_CHANNELS.workspacePackageJsonChanged, listener);
    return () => ipcRenderer.off(IPC_CHANNELS.workspacePackageJsonChanged, listener);
  },
  onGitRemoteFetched(callback: (workspacePath: string) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      if (typeof payload === "string") {
        callback(payload);
      }
    };
    ipcRenderer.on(IPC_CHANNELS.gitRemoteFetched, listener);
    return () => ipcRenderer.off(IPC_CHANNELS.gitRemoteFetched, listener);
  },
  startPackageScript(request: RunPackageScriptRequest): Promise<StartPackageScriptResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.workspaceStartPackageScript, request);
  },
  onPackageScriptTerminalLaunch(callback: (payload: PackageScriptTerminalLaunchPayload) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      if (
        payload &&
        typeof payload === "object" &&
        typeof (payload as PackageScriptTerminalLaunchPayload).sessionId === "string"
      ) {
        callback(payload as PackageScriptTerminalLaunchPayload);
      }
    };
    ipcRenderer.on(IPC_CHANNELS.workspacePackageScriptTerminal, listener);
    return () => ipcRenderer.off(IPC_CHANNELS.workspacePackageScriptTerminal, listener);
  },
  listBackgroundTerminalTasks(request?: BackgroundTerminalListRequest): Promise<BackgroundTerminalTask[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.backgroundTerminalList, request ?? {});
  },
  startBackgroundTerminalTask(request: BackgroundTerminalStartRequest): Promise<BackgroundTerminalTask> {
    return ipcRenderer.invoke(IPC_CHANNELS.backgroundTerminalStart, request);
  },
  openBackgroundTerminalTask(request: BackgroundTerminalOpenRequest): Promise<BackgroundTerminalTask> {
    return ipcRenderer.invoke(IPC_CHANNELS.backgroundTerminalOpen, request);
  },
  stopBackgroundTerminalTask(request: BackgroundTerminalStopRequest): Promise<BackgroundTerminalStopResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.backgroundTerminalStop, request);
  },
  listTerminalSessions(request?: TerminalListRequest): Promise<TerminalSessionView[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.terminalList, request ?? {});
  },
  spawnTerminal(request: TerminalSpawnRequest): Promise<TerminalSpawnResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.terminalSpawn, request);
  },
  writeTerminalInput(request: TerminalInputRequest): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.terminalInput, request);
  },
  resizeTerminal(request: TerminalResizeRequest): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.terminalResize, request);
  },
  killTerminal(sessionId: string): Promise<{ killed: boolean }> {
    return ipcRenderer.invoke(IPC_CHANNELS.terminalKill, { sessionId });
  },
  onTerminalEvent(callback: (event: TerminalStreamEvent) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      callback(payload as TerminalStreamEvent);
    };
    ipcRenderer.on(IPC_CHANNELS.terminalEvent, listener);
    return () => ipcRenderer.off(IPC_CHANNELS.terminalEvent, listener);
  },
  getModelSettings(): Promise<ModelSettingsSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.modelSettingsGet);
  },
  getSettingsDigest(): Promise<{ digest: string }> {
    return ipcRenderer.invoke(IPC_CHANNELS.settingsDigest);
  },
  saveProvider(provider: ProviderConfigInput): Promise<ProviderConfigView> {
    return ipcRenderer.invoke(IPC_CHANNELS.modelProviderSave, provider);
  },
  deleteProvider(providerId: string): Promise<ProviderDeleteResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.modelProviderDelete, providerId);
  },
  listProviderModels(request: ListUpstreamModelsRequest): Promise<ListUpstreamModelsResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.modelProviderListModels, request);
  },
  testProviderConnection(request: TestProviderConnectionRequest): Promise<TestProviderConnectionResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.modelProviderTest, request);
  },
  testRouteProfile(request: TestRoleRoutesRequest): Promise<TestRoleRoutesResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.modelRouteProfileTest, request);
  },
  saveRouteProfile(profile: RouteProfileInput): Promise<RouteProfileView> {
    return ipcRenderer.invoke(IPC_CHANNELS.modelRouteProfileSave, profile);
  },
  deleteRouteProfile(profileId: string): Promise<{ ok: true }> {
    return ipcRenderer.invoke(IPC_CHANNELS.modelRouteProfileDelete, profileId);
  },
  listCandidateModels(providerId: string): Promise<CandidateModelView[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.candidateModelList, providerId);
  },
  saveCandidateModel(input: CandidateModelInput): Promise<CandidateModelView> {
    return ipcRenderer.invoke(IPC_CHANNELS.candidateModelSave, input);
  },
  deleteCandidateModel(id: string): Promise<{ ok: true }> {
    return ipcRenderer.invoke(IPC_CHANNELS.candidateModelDelete, id);
  },
  reorderCandidateModels(providerId: string, orderedIds: string[]): Promise<{ ok: true }> {
    return ipcRenderer.invoke(IPC_CHANNELS.candidateModelReorder, providerId, orderedIds);
  },
  bulkImportCandidateModels(providerId: string, modelIds: string[]): Promise<CandidateModelView[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.candidateModelBulkImport, providerId, modelIds);
  },
  listAgentTemplates(): Promise<AgentTemplate[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.agentTemplateList);
  },
  saveAgentTemplate(template: AgentTemplate): Promise<AgentTemplate> {
    return ipcRenderer.invoke(IPC_CHANNELS.agentTemplateSave, template);
  },
  deleteAgentTemplate(templateId: string): Promise<{ ok: true }> {
    return ipcRenderer.invoke(IPC_CHANNELS.agentTemplateDelete, templateId);
  },
  exportAgentTemplates(request?: AgentTemplateExportRequest): Promise<AgentTemplateExportResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.agentTemplateExport, request);
  },
  importAgentTemplates(): Promise<AgentTemplateImportResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.agentTemplateImport);
  },
  saveMainAgentConfig(config: MainAgentConfigResource): Promise<MainAgentConfigResource> {
    return ipcRenderer.invoke(IPC_CHANNELS.mainAgentConfigSave, config);
  },
  deleteMainAgentConfig(configId: string): Promise<{ ok: true }> {
    return ipcRenderer.invoke(IPC_CHANNELS.mainAgentConfigDelete, configId);
  },
  saveMainAgentPrompt(prompt: MainAgentPromptResource): Promise<MainAgentPromptResource> {
    return ipcRenderer.invoke(IPC_CHANNELS.mainAgentPromptSave, prompt);
  },
  deleteMainAgentPrompt(promptId: string): Promise<{ ok: true }> {
    return ipcRenderer.invoke(IPC_CHANNELS.mainAgentPromptDelete, promptId);
  },
  saveSubagentOrchestration(
    orchestration: SubagentOrchestrationResource,
  ): Promise<SubagentOrchestrationResource> {
    return ipcRenderer.invoke(IPC_CHANNELS.subagentOrchestrationSave, orchestration);
  },
  deleteSubagentOrchestration(orchestrationId: string): Promise<{ ok: true }> {
    return ipcRenderer.invoke(IPC_CHANNELS.subagentOrchestrationDelete, orchestrationId);
  },
  updateThreadRuntimeConfig(request: ThreadUpdateRuntimeConfigRequest): Promise<{ thread: ThreadSummary }> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadUpdateRuntimeConfig, request);
  },
  getRoutePricing(routes?: RuntimeRoleRouteConfig[]): Promise<RoutePricingHint[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.billingRoutePricing, routes);
  },
  getRouteCapabilities(routes?: RuntimeRoleRouteConfig[]): Promise<RouteCapabilityHint[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.billingRouteCapabilities, routes);
  },
  listModelsDevModels(): Promise<ModelsDevModelOption[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.billingModelsDevList);
  },
  refreshPricingCatalog(): Promise<{ ok: true; cachedAt: number }> {
    return ipcRenderer.invoke(IPC_CHANNELS.billingRefreshPricing);
  },
  getMcpSettings(): Promise<McpSettingsSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.mcpSettingsGet);
  },
  saveMcpServer(server: McpServerConfigInput): Promise<McpServerConfigView> {
    return ipcRenderer.invoke(IPC_CHANNELS.mcpServerSave, server);
  },
  deleteMcpServer(serverId: string): Promise<{ ok: true }> {
    return ipcRenderer.invoke(IPC_CHANNELS.mcpServerDelete, serverId);
  },
  checkMcpServer(server: McpServerConfigInput): Promise<McpServerCheckResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.mcpServerCheck, server);
  },
  listSkills(workspacePath?: string): Promise<SkillsListResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.skillsList, workspacePath);
  },
  listCursorAgents(workspacePath?: string): Promise<CursorAgentsListResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.cursorAgentsList, workspacePath);
  },
  linkAgentsSkills(request: LinkAgentsSkillsRequest): Promise<LinkAgentsSkillsResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.skillsLinkAgents, request);
  },
  uninstallSkill(request: SkillUninstallRequest): Promise<SkillUninstallResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.skillsUninstall, request);
  },
  listSkillsCatalogLeaderboard(limit = 12): Promise<SkillCatalogSearchResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.skillsCatalogLeaderboard, limit);
  },
  searchSkillsCatalog(request: SkillCatalogSearchRequest): Promise<SkillCatalogSearchResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.skillsCatalogSearch, request);
  },
  installCatalogSkill(request: SkillCatalogInstallRequest): Promise<SkillCatalogInstallResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.skillsCatalogInstall, request);
  },
  getProjectSkillsSettings(workspacePath: string): Promise<ProjectSkillsSettingsSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.projectSkillsSettingsGet, workspacePath);
  },
  saveProjectSkillsSettings(snapshot: ProjectSkillsSettingsSnapshot): Promise<ProjectSkillsSettingsSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.projectSkillsSettingsSave, snapshot);
  },
  getProjectMcpSettings(workspacePath: string): Promise<ProjectMcpSettingsSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.projectMcpSettingsGet, workspacePath);
  },
  saveProjectMcpSettings(snapshot: ProjectMcpSettingsSnapshot): Promise<ProjectMcpSettingsSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.projectMcpSettingsSave, snapshot);
  },
  getProjectIntegrationsSettings(workspacePath: string): Promise<ProjectIntegrationsSettingsSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.projectIntegrationsSettingsGet, workspacePath);
  },
  saveProjectIntegrationsSettings(
    snapshot: ProjectIntegrationsSettingsSnapshot,
  ): Promise<ProjectIntegrationsSettingsSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.projectIntegrationsSettingsSave, snapshot);
  },
  getProjectOrchestrationSettings(workspacePath: string): Promise<ProjectOrchestrationSettingsSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.projectOrchestrationSettingsGet, workspacePath);
  },
  saveProjectOrchestrationSettings(
    snapshot: ProjectOrchestrationSettingsSnapshot,
  ): Promise<ProjectOrchestrationSettingsSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.projectOrchestrationSettingsSave, snapshot);
  },
  getWorkflowSettings(): Promise<WorkflowSettingsSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.workflowSettingsGet);
  },
  saveWorkflowSettings(settings: WorkflowSettingsSnapshot): Promise<WorkflowSettingsSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.workflowSettingsSave, settings);
  },
  getGitSettings(): Promise<GitSettingsSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.gitSettingsGet);
  },
  saveGitSettings(settings: GitSettingsSnapshot): Promise<GitSettingsSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.gitSettingsSave, settings);
  },
  getPersonalizationSettings(): Promise<PersonalizationSettingsSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.personalizationSettingsGet);
  },
  savePersonalizationSettings(
    settings: PersonalizationSettingsSnapshot,
  ): Promise<PersonalizationSettingsSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.personalizationSettingsSave, settings);
  },
  getBrowserSettings(): Promise<BrowserSettingsSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.browserSettingsGet);
  },
  saveBrowserSettings(settings: BrowserSettingsSnapshot): Promise<BrowserSettingsSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.browserSettingsSave, settings);
  },
  getComputerUseSettings(): Promise<import("../shared/computer-use").ComputerUseSettingsSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.computerUseSettingsGet);
  },
  saveComputerUseSettings(
    settings: import("../shared/computer-use").ComputerUseSettingsSnapshot,
  ): Promise<import("../shared/computer-use").ComputerUseSettingsSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.computerUseSettingsSave, settings);
  },
  runComputerUseDoctor(): Promise<{ ok: boolean; reason?: string; output?: string }> {
    return ipcRenderer.invoke(IPC_CHANNELS.computerUseDoctor);
  },
  previewComputerUsePresence(): Promise<{ ok: boolean }> {
    return ipcRenderer.invoke(IPC_CHANNELS.computerUsePresencePreview);
  },
  getIntegrationAvailability(): Promise<IntegrationAvailabilitySnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.integrationAvailabilityGet);
  },
  getImageGenerationSettings(): Promise<ImageGenerationSettingsSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.imageGenerationSettingsGet);
  },
  saveImageGenerationEnabled(enabled: boolean): Promise<ImageGenerationSettingsSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.imageGenerationSettingsSave, { enabled });
  },
  saveImageGenerationProfile(
    profile: ImageGenerationProfileSaveInput,
  ): Promise<ImageGenerationProfileSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.imageGenerationProfileSave, profile);
  },
  deleteImageGenerationProfile(id: string): Promise<ImageGenerationSettingsSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.imageGenerationProfileDelete, { id });
  },
  activateImageGenerationProfile(id: string): Promise<ImageGenerationSettingsSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.imageGenerationProfileActivate, { id });
  },
  listImageGenerationArtifacts(threadId: string): Promise<ImageGenerationArtifact[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.imageGenerationArtifactsList, { threadId });
  },
  readImageGenerationArtifact(
    request: ImageGenerationArtifactReadRequest,
  ): Promise<ImageGenerationArtifactReadResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.imageGenerationArtifactRead, request);
  },
  revealImageGenerationArtifact(request: ImageGenerationArtifactReadRequest): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.imageGenerationArtifactReveal, request);
  },
  readImageView(request: ImageViewReadRequest): Promise<ImageViewReadResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.imageViewRead, request);
  },
  listImageDisplayArtifacts(threadId: string): Promise<ImageDisplayArtifact[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.imageDisplayArtifactsList, { threadId });
  },
  readImageDisplay(request: ImageDisplayArtifactReadRequest): Promise<ImageDisplayReadResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.imageDisplayRead, request);
  },
  onImageDisplayArtifactChanged(callback: (artifact: ImageDisplayArtifact) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      if (payload && typeof payload === "object") callback(payload as ImageDisplayArtifact);
    };
    ipcRenderer.on(IPC_CHANNELS.imageDisplayArtifactChanged, listener);
    return () => ipcRenderer.off(IPC_CHANNELS.imageDisplayArtifactChanged, listener);
  },
  listHtmlHostArtifacts(threadId: string): Promise<import("../shared/html-host").HtmlHostArtifact[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.htmlHostArtifactsList, { threadId });
  },
  onHtmlHostArtifactChanged(
    callback: (artifact: import("../shared/html-host").HtmlHostArtifact) => void,
  ): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      if (payload && typeof payload === "object") {
        callback(payload as import("../shared/html-host").HtmlHostArtifact);
      }
    };
    ipcRenderer.on(IPC_CHANNELS.htmlHostArtifactChanged, listener);
    return () => ipcRenderer.off(IPC_CHANNELS.htmlHostArtifactChanged, listener);
  },
  refreshHtmlHostingCapability(): Promise<import("../shared/html-host").HtmlHostingCapability> {
    return ipcRenderer.invoke(IPC_CHANNELS.centerServerHtmlHostingRefresh);
  },
  onImageGenerationArtifactChanged(callback: (artifact: ImageGenerationArtifact) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      if (payload && typeof payload === "object") callback(payload as ImageGenerationArtifact);
    };
    ipcRenderer.on(IPC_CHANNELS.imageGenerationArtifactChanged, listener);
    return () => ipcRenderer.off(IPC_CHANNELS.imageGenerationArtifactChanged, listener);
  },
  getWebChatList(): Promise<WebChatListView> {
    return ipcRenderer.invoke(IPC_CHANNELS.webChatListGet);
  },
  saveWebChatList(snapshot: WebChatListSnapshot): Promise<WebChatListView> {
    return ipcRenderer.invoke(IPC_CHANNELS.webChatListSave, snapshot);
  },
  getSshBookmarks(): Promise<import("../shared/ssh-bookmarks").SshBookmarkView[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.sshBookmarksGet);
  },
  saveSshBookmark(
    input: import("../shared/ssh-bookmarks").SshBookmarkSaveInput,
  ): Promise<import("../shared/ssh-bookmarks").SshBookmarkView> {
    return ipcRenderer.invoke(IPC_CHANNELS.sshBookmarksSave, input);
  },
  deleteSshBookmark(id: string): Promise<import("../shared/ssh-bookmarks").SshBookmarkView[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.sshBookmarksDelete, { id });
  },
  connectSshBookmark(
    request: import("../shared/ipc").SshBookmarkConnectRequest,
  ): Promise<import("../shared/ssh-bookmarks").SshBookmarkConnectResult & { passwordAutoInject?: boolean }> {
    return ipcRenderer.invoke(IPC_CHANNELS.sshBookmarksConnect, request);
  },
  getDefaultSshKeyPath(): Promise<string> {
    return ipcRenderer.invoke(IPC_CHANNELS.sshBookmarksGetDefaultKeyPath);
  },
  getNotificationSettings(): Promise<NotificationSettingsSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.notificationSettingsGet);
  },
  saveNotificationSettings(settings: NotificationSettingsSnapshot): Promise<NotificationSettingsSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.notificationSettingsSave, settings);
  },
  getBrowserState(): Promise<BrowserViewState> {
    return ipcRenderer.invoke(IPC_CHANNELS.browserGetState);
  },
  browserDevPrepareAgentCdp(threadId: string): Promise<{ cdpPort: number }> {
    return ipcRenderer.invoke(IPC_CHANNELS.browserDevPrepareAgentCdp, { threadId });
  },
  browserSetVisible(request: BrowserSetVisibleRequest): Promise<BrowserViewState> {
    return ipcRenderer.invoke(IPC_CHANNELS.browserSetVisible, request);
  },
  browserRegisterGuest(request: BrowserRegisterGuestRequest): Promise<BrowserViewState> {
    return ipcRenderer.invoke(IPC_CHANNELS.browserRegisterGuest, request);
  },
  browserNavigate(request: BrowserNavigateRequest): Promise<BrowserViewState> {
    return ipcRenderer.invoke(IPC_CHANNELS.browserNavigate, request);
  },
  browserOpen(request?: BrowserOpenRequest | string): Promise<BrowserViewState> {
    if (typeof request === "string") {
      return ipcRenderer.invoke(IPC_CHANNELS.browserOpen, { url: request, reveal: true });
    }
    return ipcRenderer.invoke(IPC_CHANNELS.browserOpen, request ?? {});
  },
  browserFocus(request: BrowserFocusRequest): Promise<BrowserViewState> {
    return ipcRenderer.invoke(IPC_CHANNELS.browserFocus, request);
  },
  browserCloseInstance(request: BrowserCloseRequest): Promise<BrowserViewState> {
    return ipcRenderer.invoke(IPC_CHANNELS.browserClose, request);
  },
  browserSetUiScope(request: BrowserSetUiScopeRequest): Promise<BrowserViewState> {
    return ipcRenderer.invoke(IPC_CHANNELS.browserSetUiScope, request);
  },
  browserGoBack(browserId?: string): Promise<BrowserViewState> {
    return ipcRenderer.invoke(IPC_CHANNELS.browserGoBack, browserId ? { browserId } : undefined);
  },
  browserGoForward(browserId?: string): Promise<BrowserViewState> {
    return ipcRenderer.invoke(IPC_CHANNELS.browserGoForward, browserId ? { browserId } : undefined);
  },
  browserReload(browserId?: string): Promise<BrowserViewState> {
    return ipcRenderer.invoke(IPC_CHANNELS.browserReload, browserId ? { browserId } : undefined);
  },
  browserOpenExternal(browserId?: string): Promise<{ ok: true }> {
    return ipcRenderer.invoke(IPC_CHANNELS.browserOpenExternal, browserId ? { browserId } : undefined);
  },
  onBrowserStateChanged(callback: (state: BrowserViewState) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      if (payload && typeof payload === "object") {
        callback(payload as BrowserViewState);
      }
    };
    ipcRenderer.on(IPC_CHANNELS.browserStateChanged, listener);
    return () => ipcRenderer.off(IPC_CHANNELS.browserStateChanged, listener);
  },
  onBrowserAgentPresence(callback: (event: BrowserAgentPresenceEvent) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      if (payload && typeof payload === "object" && "type" in payload) {
        callback(payload as BrowserAgentPresenceEvent);
      }
    };
    ipcRenderer.on(IPC_CHANNELS.browserAgentPresence, listener);
    return () => ipcRenderer.off(IPC_CHANNELS.browserAgentPresence, listener);
  },
  getAsrSettings(): Promise<AsrSettingsSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.asrSettingsGet);
  },
  saveAsrSettings(settings: AsrSettingsInput): Promise<AsrSettingsSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.asrSettingsSave, settings);
  },
  listAsrProfiles(): Promise<AsrProfilesSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.asrProfilesList);
  },
  saveAsrProfile(profile: AsrProfileSaveInput): Promise<AsrProfileSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.asrProfileSave, profile);
  },
  deleteAsrProfile(request: AsrProfileDeleteRequest): Promise<AsrProfilesSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.asrProfileDelete, request);
  },
  activateAsrProfile(request: AsrProfileActivateRequest): Promise<AsrSettingsSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.asrProfileActivate, request);
  },
  saveAsrInputDevice(settings: AsrInputDeviceSaveInput): Promise<AsrProfilesSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.asrInputDeviceSave, settings);
  },
  transcribeAsr(request: AsrTranscribeRequest): Promise<AsrTranscribeResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.asrTranscribe, request);
  },
  getGitStatus(workspacePath: string): Promise<GitWorkingTreeStatus> {
    return ipcRenderer.invoke(IPC_CHANNELS.gitGetStatus, workspacePath);
  },
  getWorkspaceDiff(workspacePath: string): Promise<WorkspaceDiffResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.gitGetWorkspaceDiff, workspacePath);
  },
  getWorkspaceFileDiff(request: GitGetWorkspaceFileDiffRequest): Promise<WorkspaceFileDiffResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.gitGetWorkspaceFileDiff, request);
  },
  discardWorkspaceChanges(
    request: GitDiscardWorkspaceChangesRequest,
  ): Promise<GitDiscardWorkspaceChangesResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.gitDiscardWorkspaceChanges, request);
  },
  listGitCommits(request: GitListCommitsRequest): Promise<GitListCommitsResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.gitListCommits, request);
  },
  checkoutGitBranch(request: GitCheckoutBranchRequest): Promise<GitWorkingTreeStatus> {
    return ipcRenderer.invoke(IPC_CHANNELS.gitCheckoutBranch, request);
  },
  createGitBranch(request: GitCreateBranchRequest): Promise<GitWorkingTreeStatus> {
    return ipcRenderer.invoke(IPC_CHANNELS.gitCreateBranch, request);
  },
  generateGitCommitMessage(
    request: GitGenerateCommitMessageRequest,
    options?: { onDelta?: (text: string) => void },
  ): Promise<GitGenerateCommitMessageResult> {
    const requestId = `commit-msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const listener = (_event: Electron.IpcRendererEvent, payload: GitGenerateCommitMessageDeltaPayload) => {
      if (payload.requestId === requestId) {
        options?.onDelta?.(payload.text);
      }
    };
    if (options?.onDelta) {
      ipcRenderer.on(IPC_CHANNELS.gitGenerateCommitMessageDelta, listener);
    }
    return ipcRenderer
      .invoke(IPC_CHANNELS.gitGenerateCommitMessage, { ...request, requestId })
      .finally(() => {
        if (options?.onDelta) {
          ipcRenderer.off(IPC_CHANNELS.gitGenerateCommitMessageDelta, listener);
        }
      });
  },
  listGitCommitModelOptions(
    request: GitListCommitModelOptionsRequest,
  ): Promise<GitListCommitModelOptionsResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.gitListCommitModelOptions, request);
  },
  commitGitChanges(request: GitCommitRequest): Promise<GitCommitResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.gitCommit, request);
  },
  pushGitChanges(request: GitPushRequest): Promise<GitPushResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.gitPush, request);
  },
  fetchGitChanges(request: GitFetchRequest): Promise<GitFetchResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.gitFetch, request);
  },
  pullGitChanges(request: GitPullRequest): Promise<GitPullResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.gitPull, request);
  },
  getProxyBridgeSettings(): Promise<ProxyBridgeSettingsSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.proxyBridgeSettingsGet);
  },
  saveProxyBridgeSettings(settings: ProxyBridgeSettingsSnapshot): Promise<ProxyBridgeSettingsSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.proxyBridgeSettingsSave, settings);
  },
  getIntegratedWebSearchSettings(): Promise<IntegratedWebSearchSettingsSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.integratedWebSearchSettingsGet);
  },
  saveIntegratedWebSearchSettings(
    settings: IntegratedWebSearchSettingsSaveInput,
  ): Promise<IntegratedWebSearchSettingsSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.integratedWebSearchSettingsSave, settings);
  },
  getCenterServerSettings(): Promise<CenterServerSettingsSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.centerServerSettingsGet);
  },
  saveCenterServerSettings(input: CenterServerSettingsInput): Promise<CenterServerSettingsSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.centerServerSettingsSave, input);
  },
  registerCenterServerDesktop(
    request: CenterServerRegisterDesktopRequest,
  ): Promise<CenterServerRegisterDesktopResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.centerServerRegisterDesktop, request);
  },
  signUpCenterServer(request: CenterServerSignUpRequest): Promise<CenterServerAccountAuthResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.centerServerSignUp, request);
  },
  signInCenterServer(request: CenterServerSignInRequest): Promise<CenterServerAccountAuthResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.centerServerSignIn, request);
  },
  createCenterServerPairing(): Promise<CenterServerCreatePairingResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.centerServerCreatePairing);
  },
  buildCenterServerConnectQr(): Promise<{ qrPayload: string }> {
    return ipcRenderer.invoke(IPC_CHANNELS.centerServerBuildConnectQr);
  },
  listCenterServerBindings(): Promise<CenterServerDeviceBindingView[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.centerServerListBindings);
  },
  listCenterServerPresence(): Promise<CenterServerDevicePresenceView[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.centerServerListPresence);
  },
  revokeCenterServerBinding(bindingId: string): Promise<CenterServerDeviceBindingView> {
    return ipcRenderer.invoke(IPC_CHANNELS.centerServerRevokeBinding, bindingId);
  },
  connectCenterServer(): Promise<CenterServerSettingsSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.centerServerConnect);
  },
  disconnectCenterServer(): Promise<CenterServerSettingsSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.centerServerDisconnect);
  },
  removeCenterServerConnection(
    options?: CenterServerRemoveConnectionOptions,
  ): Promise<CenterServerRemoveConnectionResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.centerServerRemoveConnection, options);
  },
  testCenterServerConnection(
    request: CenterServerTestConnectionRequest,
  ): Promise<CenterServerTestConnectionResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.centerServerTestConnection, request);
  },
  getCenterServerVaultStatus(): Promise<CenterServerVaultStatus> {
    return ipcRenderer.invoke(IPC_CHANNELS.centerServerVaultStatusGet);
  },
  syncCenterServerConfig(mode?: "pull" | "push" | "reconcile"): Promise<CenterServerSyncConfigResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.centerServerSyncConfig, mode);
  },
  syncCenterServerConfigDomain(
    domain: CenterServerSyncDomain,
    mode: "pull" | "push",
  ): Promise<CenterServerSyncDomainResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.centerServerSyncConfigDomain, domain, mode);
  },
  getCenterServerSyncStatus(): Promise<CenterServerSyncStatusSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.centerServerGetSyncStatus);
  },
  unlockCenterServerVaultWithPassword(password: string): Promise<{
    hasVaultKey: boolean;
    vaultStatus: CenterServerVaultStatus;
  }> {
    return ipcRenderer.invoke(IPC_CHANNELS.centerServerUnlockVaultWithPassword, password);
  },
  wrapCenterServerVaultWithPassword(password: string): Promise<{
    vaultStatus: CenterServerVaultStatus;
  }> {
    return ipcRenderer.invoke(IPC_CHANNELS.centerServerWrapVaultWithPassword, password);
  },
  requestCenterServerVaultClaim(): Promise<CenterServerRequestVaultClaimResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.centerServerRequestVaultClaim);
  },
  listCenterServerPendingVaultClaims(): Promise<CenterServerVaultClaimView[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.centerServerListPendingVaultClaims);
  },
  approveCenterServerVaultClaim(claimId: string): Promise<CenterServerApproveVaultClaimResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.centerServerApproveVaultClaim, claimId);
  },
  submitCenterServerVaultClaimCode(code: string): Promise<CenterServerSubmitVaultClaimCodeResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.centerServerSubmitVaultClaimCode, code);
  },
  cancelCenterServerVaultClaim(): Promise<CenterServerVaultStatus> {
    return ipcRenderer.invoke(IPC_CHANNELS.centerServerCancelVaultClaim);
  },
  onCenterServerStatusChange(callback: (snapshot: CenterServerSettingsSnapshot) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: CenterServerSettingsSnapshot) =>
      callback(payload);
    ipcRenderer.on(IPC_CHANNELS.centerServerStatusChanged, listener);
    return () => ipcRenderer.off(IPC_CHANNELS.centerServerStatusChanged, listener);
  },
  startThread(request: ThreadStartRequest): Promise<ThreadStartResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadStart, request);
  },
  continueThread(request: ThreadContinueRequest): Promise<ThreadContinueResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadContinue, request);
  },
  enqueueThreadFollowUp(request: ThreadFollowUpEnqueueRequest): Promise<ThreadFollowUpMutationResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadFollowUpEnqueue, request);
  },
  escalateThreadFollowUp(request: ThreadFollowUpEscalateRequest): Promise<ThreadFollowUpMutationResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadFollowUpEscalate, request);
  },
  setThreadFollowUpEditing(request: ThreadFollowUpEditingRequest): Promise<ThreadFollowUpEditingResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadFollowUpEditing, request);
  },
  setThreadFollowUpQueuePaused(
    request: ThreadFollowUpQueuePausedRequest,
  ): Promise<ThreadFollowUpQueuePausedResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadFollowUpQueuePaused, request);
  },
  listThreadFollowUps(threadId: string): Promise<ThreadFollowUpListResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadFollowUpList, threadId);
  },
  cancelThreadFollowUp(request: ThreadFollowUpCancelRequest): Promise<ThreadFollowUpMutationResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadFollowUpCancel, request);
  },
  updateThreadFollowUp(request: ThreadFollowUpUpdateRequest): Promise<ThreadFollowUpMutationResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadFollowUpUpdate, request);
  },
  reorderThreadFollowUps(request: ThreadFollowUpReorderRequest): Promise<ThreadFollowUpListResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadFollowUpReorder, request);
  },
  cancelThread(request: ThreadCancelRequest | string): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadCancel, request);
  },
  rollbackToThread(threadId: string): Promise<ThreadRollbackResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadRollbackTo, threadId);
  },
  getThreadAppliedDiff(threadId: string): Promise<ThreadAppliedDiffResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadGetAppliedDiff, threadId);
  },
  revertThreadAppliedDiff(threadId: string): Promise<ThreadRevertAppliedDiffResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadRevertAppliedDiff, threadId);
  },
  getPendingPlan(threadId: string): Promise<ThreadPendingPlan | undefined> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadGetPendingPlan, threadId);
  },
  getApprovedPlan(threadId: string): Promise<ThreadPendingPlan | undefined> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadGetApprovedPlan, threadId);
  },
  getThreadUsageSnapshot(threadId: string): Promise<ThreadUsageSnapshotResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadGetUsageSnapshot, threadId);
  },
  listUsageLedgerEvents(threadId: string): Promise<ThreadUsageLedgerEventView[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadUsageLedgerEventsList, threadId);
  },
  getPendingClarification(threadId: string): Promise<ClarificationRequest | undefined> {
    return ipcRenderer.invoke(IPC_CHANNELS.clarificationGetPending, threadId);
  },
  listThreadTodos(threadId: string): Promise<CoderTodoItem[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadTodoList, threadId);
  },
  submitClarification(payload: ClarificationSubmitPayload): Promise<{ ok: true }> {
    return ipcRenderer.invoke(IPC_CHANNELS.clarificationSubmit, payload);
  },
  dismissClarification(toolUseId: string): Promise<{ ok: true }> {
    return ipcRenderer.invoke(IPC_CHANNELS.clarificationDismiss, toolUseId);
  },
  getPendingBashApproval(threadId: string): Promise<BashApprovalRequest | undefined> {
    return ipcRenderer.invoke(IPC_CHANNELS.bashApprovalGetPending, threadId);
  },
  resolveBashApproval(payload: BashApprovalResolvePayload): Promise<{ ok: true }> {
    return ipcRenderer.invoke(IPC_CHANNELS.bashApprovalResolve, payload);
  },
  approvePlan(request: ThreadApprovePlanRequest): Promise<{ thread?: ThreadSummary }> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadApprovePlan, request);
  },
  dismissPlan(threadId: string): Promise<{ thread?: ThreadSummary }> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadDismissPlan, threadId);
  },
  getWorktreeStatus(threadId: string): Promise<WorktreeStatusResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.worktreeGetStatus, threadId);
  },
  applyWorktree(threadId: string): Promise<WorktreeApplyResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.worktreeApply, threadId);
  },
  listFileCheckpoints(threadId: string): Promise<FileCheckpointRecord[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadListCheckpoints, threadId);
  },
  rewindToCheckpoint(request: ThreadRewindCheckpointRequest): Promise<ThreadRewindCheckpointResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadRewindCheckpoint, request);
  },
  listThreads(): Promise<ThreadSummary[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadList);
  },
  getThread(threadId: string): Promise<ThreadSummary | undefined> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadGet, threadId);
  },
  getComposerDraft(contextKey: string): Promise<ComposerDraftRecord | undefined> {
    return ipcRenderer.invoke(IPC_CHANNELS.composerDraftGet, contextKey);
  },
  saveComposerDraft(request: ComposerDraftSaveRequest): Promise<ComposerDraftRecord | undefined> {
    return ipcRenderer.invoke(IPC_CHANNELS.composerDraftSave, request);
  },
  deleteComposerDraft(request: string | ComposerDraftDeleteRequest): Promise<ComposerDraftDeleteResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.composerDraftDelete, request);
  },
  stagePromptImage(request: PromptImageStageRequest): Promise<PromptImageStageResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.promptImageStage, request);
  },
  releasePromptImages(request: PromptImageReleaseRequest): Promise<{ ok: true }> {
    return ipcRenderer.invoke(IPC_CHANNELS.promptImageRelease, request);
  },
  sessionBootstrap(threadId: string): Promise<ThreadSessionBootstrapResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadSessionBootstrap, threadId);
  },
  deleteThread(threadId: string): Promise<ThreadDeleteResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadDelete, threadId);
  },
  regenerateThreadTitle(threadId: string): Promise<{ ok: true; regenerated: boolean }> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadRegenerateTitle, threadId);
  },
  listThreadActivity(threadId: string): Promise<ThreadActivityLine[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadActivityList, threadId);
  },
  getUserMessageEdit(request: ThreadUserMessageEditGetRequest): Promise<ThreadUserMessageEditGetResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadUserMessageEditGet, request);
  },
  rewriteThreadFromMessage(request: ThreadRewriteFromMessageRequest): Promise<ThreadContinueResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadRewriteFromMessage, request);
  },
  retryThreadFromMessage(request: ThreadRetryFromMessageRequest): Promise<ThreadContinueResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadRetryFromMessage, request);
  },
  getThreadRunProjection(
    threadIdOrRequest: string | { threadId: string; mode?: "feed" | "full" },
  ): Promise<ThreadRunProjectionSnapshot | undefined> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadRunProjectionGet, threadIdOrRequest);
  },
  getThreadRunProjectionDetail(
    request: ThreadRunProjectionDetailRequest,
  ): Promise<ThreadRunProjectionDetailResult | undefined> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadRunProjectionDetailGet, request);
  },
  listSubagentSessions(threadId: string): Promise<ThreadSubagentSessionTiming[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadSubagentSessionsList, threadId);
  },
  listSubagentMetrics(threadId: string): Promise<ThreadSubagentMetricsSummary[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadSubagentMetricsList, threadId);
  },
  getStorageUsage(): Promise<StorageUsageSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.storageGetUsage);
  },
  cleanupStorage(request: StorageCleanupRequest): Promise<StorageCleanupResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.storageCleanup, request);
  },
  onThreadEvent(callback: (event: unknown) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on(IPC_CHANNELS.threadEventsSubscribe, listener);
    return () => ipcRenderer.off(IPC_CHANNELS.threadEventsSubscribe, listener);
  },
};

contextBridge.exposeInMainWorld("eco", api);

export type EcoDesktopApi = typeof api;
