import { contextBridge, ipcRenderer, webUtils } from "electron";
import {
  type AgentTemplate,
  type AgentTemplateExportRequest,
  type AgentTemplateExportResult,
  type AgentTemplateImportResult,
  type BackgroundTerminalListRequest,
  type BackgroundTerminalOpenRequest,
  type BackgroundTerminalStartRequest,
  type BackgroundTerminalStopRequest,
  type BackgroundTerminalStopResult,
  type BackgroundTerminalTask,
  type BashApprovalRequest,
  type BashApprovalResolvePayload,
  type CandidateModelInput,
  type CandidateModelView,
  type CenterServerAccountAuthResult,
  type CenterServerCreatePairingResult,
  type CenterServerDeviceBindingView,
  type CenterServerDevicePresenceView,
  type CenterServerRegisterDesktopRequest,
  type CenterServerRegisterDesktopResult,
  type CenterServerRemoveConnectionOptions,
  type CenterServerRemoveConnectionResult,
  type CenterServerSettingsInput,
  type CenterServerSettingsSnapshot,
  type CenterServerSignInRequest,
  type CenterServerSignUpRequest,
  type CenterServerTestConnectionRequest,
  type CenterServerTestConnectionResult,
  type ClarificationRequest,
  type ClarificationSubmitPayload,
  type CoderTodoItem,
  type FileCheckpointRecord,
  type GitCheckoutBranchRequest,
  type GitCommitRequest,
  type GitCommitResult,
  type GitCreateBranchRequest,
  type GitDiscardWorkspaceChangesRequest,
  type GitDiscardWorkspaceChangesResult,
  type GitGenerateCommitMessageDeltaPayload,
  type GitGenerateCommitMessageRequest,
  type GitGenerateCommitMessageResult,
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
  IPC_CHANNELS,
  type IpcChannel,
  type LinkAgentsSkillsRequest,
  type LinkAgentsSkillsResult,
  type ListUpstreamModelsRequest,
  type ListUpstreamModelsResult,
  type McpServerCheckResult,
  type McpServerConfigInput,
  type McpServerConfigView,
  type McpSettingsSnapshot,
  type ModelSettingsSnapshot,
  type ModelsDevModelOption,
  type OrchestrationProfile,
  type OrchestrationProfileExportRequest,
  type OrchestrationProfileExportResult,
  type OrchestrationProfileImportResult,
  type PackageScriptsListResult,
  type PackageScriptTerminalLaunchPayload,
  type ProviderConfigInput,
  type ProviderConfigView,
  type ProxyBridgeSettingsSnapshot,
  type RouteCapabilityHint,
  type RoutePricingHint,
  type RouteProfileInput,
  type RouteProfileView,
  type RunPackageScriptRequest,
  type SavePackageScriptArgsRequest,
  type RuntimeRoleRouteConfig,
  type SkillsListResult,
  type StartPackageScriptResult,
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
  type ThreadApprovalNotificationRequest,
  type ThreadApprovalNotificationResult,
  type ThreadAppliedDiffResult,
  type ThreadApprovePlanRequest,
  type ThreadCancelRequest,
  type ThreadCompactContextResult,
  type ThreadCompletionNotificationResult,
  type ThreadContinueRequest,
  type ThreadContinueResult,
  type ThreadDeleteResult,
  type ThreadFollowUpCancelRequest,
  type ThreadFollowUpEnqueueRequest,
  type ThreadFollowUpEscalateRequest,
  type ThreadFollowUpListResult,
  type ThreadFollowUpMutationResult,
  type ThreadFollowUpUpdateRequest,
  type ThreadPendingPlan,
  type ThreadRevertAppliedDiffResult,
  type ThreadRewindCheckpointRequest,
  type ThreadRewindCheckpointResult,
  type ThreadRollbackResult,
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
  type WorkflowSettingsSnapshot,
  type WorkspaceDiffResult,
  type WorkspaceDirectoryListing,
  type WorkspaceInfo,
  type WorkspaceOpenResult,
  type WorktreeApplyResult,
  type WorktreeStatusResult,
} from "../shared/ipc";

type InvokePayload = Record<string, unknown> | undefined;

const api = {
  platform: process.platform,
  channels: IPC_CHANNELS,
  invoke(channel: IpcChannel, payload?: InvokePayload): Promise<unknown> {
    return ipcRenderer.invoke(channel, payload);
  },
  setAppThemeSource(
    themeSource: "dark" | "light" | "system",
  ): Promise<{ themeSource: "dark" | "light" | "system" }> {
    return ipcRenderer.invoke(IPC_CHANNELS.appSetThemeSource, themeSource);
  },
  showThreadCompletionNotification(threadId: string): Promise<ThreadCompletionNotificationResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.appShowThreadCompletionNotification, threadId);
  },
  showThreadApprovalNotification(
    request: ThreadApprovalNotificationRequest,
  ): Promise<ThreadApprovalNotificationResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.appShowThreadApprovalNotification, request);
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
  inspectWorkspace(workspacePath: string): Promise<WorkspaceInfo> {
    return ipcRenderer.invoke(IPC_CHANNELS.workspaceInspect, workspacePath);
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
  saveProvider(provider: ProviderConfigInput): Promise<ProviderConfigView> {
    return ipcRenderer.invoke(IPC_CHANNELS.modelProviderSave, provider);
  },
  deleteProvider(providerId: string): Promise<{ ok: true }> {
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
  listOrchestrationProfiles(): Promise<OrchestrationProfile[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.orchestrationProfileList);
  },
  saveOrchestrationProfile(profile: OrchestrationProfile): Promise<OrchestrationProfile> {
    return ipcRenderer.invoke(IPC_CHANNELS.orchestrationProfileSave, profile);
  },
  deleteOrchestrationProfile(profileId: string): Promise<{ ok: true }> {
    return ipcRenderer.invoke(IPC_CHANNELS.orchestrationProfileDelete, profileId);
  },
  exportOrchestrationProfiles(
    request?: OrchestrationProfileExportRequest,
  ): Promise<OrchestrationProfileExportResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.orchestrationProfileExport, request);
  },
  importOrchestrationProfiles(): Promise<OrchestrationProfileImportResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.orchestrationProfileImport);
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
  linkAgentsSkills(request: LinkAgentsSkillsRequest): Promise<LinkAgentsSkillsResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.skillsLinkAgents, request);
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
  getGitStatus(workspacePath: string): Promise<GitWorkingTreeStatus> {
    return ipcRenderer.invoke(IPC_CHANNELS.gitGetStatus, workspacePath);
  },
  getWorkspaceDiff(workspacePath: string): Promise<WorkspaceDiffResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.gitGetWorkspaceDiff, workspacePath);
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
  pullGitChanges(request: GitPullRequest): Promise<GitPullResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.gitPull, request);
  },
  getProxyBridgeSettings(): Promise<ProxyBridgeSettingsSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.proxyBridgeSettingsGet);
  },
  saveProxyBridgeSettings(settings: ProxyBridgeSettingsSnapshot): Promise<ProxyBridgeSettingsSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.proxyBridgeSettingsSave, settings);
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
  listThreadFollowUps(threadId: string): Promise<ThreadFollowUpListResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadFollowUpList, threadId);
  },
  cancelThreadFollowUp(request: ThreadFollowUpCancelRequest): Promise<ThreadFollowUpMutationResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadFollowUpCancel, request);
  },
  updateThreadFollowUp(request: ThreadFollowUpUpdateRequest): Promise<ThreadFollowUpMutationResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadFollowUpUpdate, request);
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
  compactThreadContext(threadId: string): Promise<ThreadCompactContextResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadCompactContext, threadId);
  },
  listThreads(): Promise<ThreadSummary[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadList);
  },
  getThread(threadId: string): Promise<ThreadSummary | undefined> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadGet, threadId);
  },
  sessionBootstrap(threadId: string): Promise<ThreadSessionBootstrapResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadSessionBootstrap, threadId);
  },
  deleteThread(threadId: string): Promise<ThreadDeleteResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadDelete, threadId);
  },
  listThreadActivity(threadId: string): Promise<ThreadActivityLine[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadActivityList, threadId);
  },
  getThreadRunProjection(
    threadIdOrRequest: string | { threadId: string; mode?: "feed" | "full" },
  ): Promise<ThreadRunProjectionSnapshot | undefined> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadRunProjectionGet, threadIdOrRequest);
  },
  listSubagentSessions(threadId: string): Promise<ThreadSubagentSessionTiming[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadSubagentSessionsList, threadId);
  },
  listSubagentMetrics(threadId: string): Promise<ThreadSubagentMetricsSummary[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadSubagentMetricsList, threadId);
  },
  onThreadEvent(callback: (event: unknown) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on(IPC_CHANNELS.threadEventsSubscribe, listener);
    return () => ipcRenderer.off(IPC_CHANNELS.threadEventsSubscribe, listener);
  },
};

contextBridge.exposeInMainWorld("eco", api);

export type EcoDesktopApi = typeof api;
