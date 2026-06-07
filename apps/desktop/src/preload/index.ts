import { contextBridge, ipcRenderer, webUtils } from "electron";
import {
  type AgentAuditExportRequest,
  type AgentAuditExportResult,
  type AgentProfilePerformanceSnapshot,
  type AgentTemplate,
  type AgentTemplateExportRequest,
  type AgentTemplateExportResult,
  type AgentTemplateImportResult,
  type AgentTemplateVersionRestoreRequest,
  type AgentTemplateVersionView,
  type ClarificationRequest,
  type ClarificationSubmitPayload,
  type CoderTodoItem,
  type FileCheckpointRecord,
  IPC_CHANNELS,
  type IpcChannel,
  type LinkAgentsSkillsRequest,
  type LinkAgentsSkillsResult,
  type ListUpstreamModelsRequest,
  type ListUpstreamModelsResult,
  type McpServerConfigInput,
  type McpServerConfigView,
  type McpSettingsSnapshot,
  type ModelSettingsSnapshot,
  type ModelsDevModelOption,
  type OrchestrationProfile,
  type ProviderConfigInput,
  type ProviderConfigView,
  type ProxyBridgeSettingsSnapshot,
  type RoleRouteConfig,
  type RouteCapabilityHint,
  type RoutePricingHint,
  type RouteProfileInput,
  type RouteProfileView,
  type SessionSyncSettingsInput,
  type SessionSyncSettingsSnapshot,
  type SessionSyncSettingsView,
  type SessionSyncTestConnectionRequest,
  type SessionSyncTestConnectionResult,
  type SkillsListResult,
  type SubagentEnabledSettings,
  type TestProviderConnectionRequest,
  type TestProviderConnectionResult,
  type TestRoleRoutesRequest,
  type TestRoleRoutesResult,
  type ThreadActivityLine,
  type ThreadAppliedDiffResult,
  type ThreadApprovePlanRequest,
  type ThreadCancelRequest,
  type ThreadContinueRequest,
  type ThreadContinueResult,
  type ThreadDeleteResult,
  type ThreadPendingPlan,
  type ThreadRetryRequest,
  type ThreadRetryResult,
  type ThreadRevertAppliedDiffResult,
  type ThreadRewindCheckpointRequest,
  type ThreadRewindCheckpointResult,
  type ThreadRollbackResult,
  type ThreadRunProjectionSnapshot,
  type ThreadStartRequest,
  type ThreadStartResult,
  type ThreadSubagentMetricsSummary,
  type ThreadSubagentSessionTiming,
  type ThreadSummary,
  type ThreadUpdateRuntimeConfigRequest,
  type ThreadUsageSnapshotResult,
  type WorkflowSettingsSnapshot,
  type WorkspaceInfo,
  type WorkspaceOpenResult,
  type WorktreeApplyResult,
  type WorktreeStatusResult,
} from "../shared/ipc";

type InvokePayload = Record<string, unknown> | undefined;

const api = {
  channels: IPC_CHANNELS,
  invoke(channel: IpcChannel, payload?: InvokePayload): Promise<unknown> {
    return ipcRenderer.invoke(channel, payload);
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
  inspectWorkspace(workspacePath: string): Promise<WorkspaceInfo> {
    return ipcRenderer.invoke(IPC_CHANNELS.workspaceInspect, workspacePath);
  },
  prepareWorkspaceGit(workspacePath: string): Promise<WorkspaceInfo> {
    return ipcRenderer.invoke(IPC_CHANNELS.workspacePrepareGit, { workspacePath });
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
  listAgentTemplateVersions(templateId: string): Promise<AgentTemplateVersionView[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.agentTemplateVersionsList, templateId);
  },
  restoreAgentTemplateVersion(request: AgentTemplateVersionRestoreRequest): Promise<AgentTemplate> {
    return ipcRenderer.invoke(IPC_CHANNELS.agentTemplateVersionRestore, request);
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
  updateThreadRuntimeConfig(request: ThreadUpdateRuntimeConfigRequest): Promise<{ thread: ThreadSummary }> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadUpdateRuntimeConfig, request);
  },
  getRoutePricing(routes?: RoleRouteConfig[]): Promise<RoutePricingHint[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.billingRoutePricing, routes);
  },
  getRouteCapabilities(routes?: RoleRouteConfig[]): Promise<RouteCapabilityHint[]> {
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
  listSkills(workspacePath?: string): Promise<SkillsListResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.skillsList, workspacePath);
  },
  linkAgentsSkills(request: LinkAgentsSkillsRequest): Promise<LinkAgentsSkillsResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.skillsLinkAgents, request);
  },
  getSubagentSettings(): Promise<SubagentEnabledSettings> {
    return ipcRenderer.invoke(IPC_CHANNELS.subagentSettingsGet);
  },
  saveSubagentSettings(settings: SubagentEnabledSettings): Promise<SubagentEnabledSettings> {
    return ipcRenderer.invoke(IPC_CHANNELS.subagentSettingsSave, settings);
  },
  getWorkflowSettings(): Promise<WorkflowSettingsSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.workflowSettingsGet);
  },
  saveWorkflowSettings(settings: WorkflowSettingsSnapshot): Promise<WorkflowSettingsSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.workflowSettingsSave, settings);
  },
  getProxyBridgeSettings(): Promise<ProxyBridgeSettingsSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.proxyBridgeSettingsGet);
  },
  saveProxyBridgeSettings(settings: ProxyBridgeSettingsSnapshot): Promise<ProxyBridgeSettingsSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.proxyBridgeSettingsSave, settings);
  },
  getSessionSyncSettings(): Promise<SessionSyncSettingsSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.sessionSyncSettingsGet);
  },
  saveSessionSyncSettings(input: SessionSyncSettingsInput): Promise<SessionSyncSettingsView> {
    return ipcRenderer.invoke(IPC_CHANNELS.sessionSyncSettingsSave, input);
  },
  testSessionSyncConnection(
    request: SessionSyncTestConnectionRequest,
  ): Promise<SessionSyncTestConnectionResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.sessionSyncTestConnection, request);
  },
  startThread(request: ThreadStartRequest): Promise<ThreadStartResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadStart, request);
  },
  continueThread(request: ThreadContinueRequest): Promise<ThreadContinueResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadContinue, request);
  },
  retryThread(request: ThreadRetryRequest | string): Promise<ThreadRetryResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadRetry, request);
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
  getThreadUsageSnapshot(threadId: string): Promise<ThreadUsageSnapshotResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadGetUsageSnapshot, threadId);
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
  deleteThread(threadId: string): Promise<ThreadDeleteResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadDelete, threadId);
  },
  listThreadActivity(threadId: string): Promise<ThreadActivityLine[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadActivityList, threadId);
  },
  getThreadRunProjection(threadId: string): Promise<ThreadRunProjectionSnapshot | undefined> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadRunProjectionGet, threadId);
  },
  listSubagentSessions(threadId: string): Promise<ThreadSubagentSessionTiming[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadSubagentSessionsList, threadId);
  },
  listSubagentMetrics(threadId: string): Promise<ThreadSubagentMetricsSummary[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadSubagentMetricsList, threadId);
  },
  listAgentProfilePerformance(): Promise<AgentProfilePerformanceSnapshot[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.agentProfilePerformanceList);
  },
  exportAgentAudit(request?: AgentAuditExportRequest): Promise<AgentAuditExportResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.agentAuditExport, request);
  },
  onThreadEvent(callback: (event: unknown) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on(IPC_CHANNELS.threadEventsSubscribe, listener);
    return () => ipcRenderer.off(IPC_CHANNELS.threadEventsSubscribe, listener);
  },
};

contextBridge.exposeInMainWorld("eco", api);

export type EcoDesktopApi = typeof api;
