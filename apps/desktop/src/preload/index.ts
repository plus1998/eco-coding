import { contextBridge, ipcRenderer } from "electron";
import {
  IPC_CHANNELS,
  type IpcChannel,
  type McpServerConfigInput,
  type McpServerConfigView,
  type McpSettingsSnapshot,
  type ListUpstreamModelsRequest,
  type ListUpstreamModelsResult,
  type TestProviderConnectionRequest,
  type TestProviderConnectionResult,
  type TestRoleRoutesRequest,
  type TestRoleRoutesResult,
  type ModelSettingsSnapshot,
  type ProviderConfigInput,
  type ProviderConfigView,
  type RouteCapabilityHint,
  type RoutePricingHint,
  type ModelsDevModelOption,
  type ModelsDevMapping,
  type RouteProfileView,
  type RoleRouteConfig,
  type SessionSyncSettingsInput,
  type SessionSyncSettingsSnapshot,
  type SessionSyncSettingsView,
  type SessionSyncTestConnectionRequest,
  type SessionSyncTestConnectionResult,
  type SkillsListResult,
  type AgentSkillAssignments,
  type SubagentEnabledSettings,
  type WorkflowSettingsSnapshot,
  type ClarificationAnswers,
  type ClarificationRequest,
  type ClarificationSubmitPayload,
  type CoderTodoItem,
  type ThreadActivityLine,
  type ThreadContinueRequest,
  type ThreadContinueResult,
  type ThreadRetryRequest,
  type ThreadRetryResult,
  type ThreadApprovePlanRequest,
  type ThreadPendingPlan,
  type ThreadUsageSnapshotResult,
  type ThreadCancelRequest,
  type ThreadRollbackResult,
  type ThreadStartRequest,
  type ThreadStartResult,
  type ThreadUpdateRuntimeConfigRequest,
  type ThreadSummary,
  type WorktreeApplyResult,
  type WorktreeStatusResult,
  type WorkspaceInfo,
  type WorkspaceOpenResult,
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
  updateThreadRuntimeConfig(
    request: ThreadUpdateRuntimeConfigRequest,
  ): Promise<{ thread: ThreadSummary }> {
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
  getAgentSkillsAssignments(): Promise<AgentSkillAssignments> {
    return ipcRenderer.invoke(IPC_CHANNELS.agentSkillsGet);
  },
  saveAgentSkillsAssignments(assignments: AgentSkillAssignments): Promise<AgentSkillAssignments> {
    return ipcRenderer.invoke(IPC_CHANNELS.agentSkillsSave, assignments);
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
  listThreads(): Promise<ThreadSummary[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadList);
  },
  listThreadActivity(threadId: string): Promise<ThreadActivityLine[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadActivityList, threadId);
  },
  onThreadEvent(callback: (event: unknown) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on(IPC_CHANNELS.threadEventsSubscribe, listener);
    return () => ipcRenderer.off(IPC_CHANNELS.threadEventsSubscribe, listener);
  },
};

contextBridge.exposeInMainWorld("eco", api);

export type EcoDesktopApi = typeof api;
