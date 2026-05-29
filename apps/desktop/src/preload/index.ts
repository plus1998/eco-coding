import { contextBridge, ipcRenderer } from "electron";
import {
  IPC_CHANNELS,
  type IpcChannel,
  type McpServerConfigInput,
  type McpServerConfigView,
  type McpSettingsSnapshot,
  type ListUpstreamModelsRequest,
  type ListUpstreamModelsResult,
  type ModelSettingsSnapshot,
  type ProviderConfigInput,
  type ProviderConfigView,
  type RoleRouteConfig,
  type SkillsListResult,
  type AgentSkillAssignments,
  type ClarificationAnswers,
  type ClarificationRequest,
  type ClarificationSubmitPayload,
  type CoderTodoItem,
  type ThreadActivityLine,
  type ThreadContinueRequest,
  type ThreadContinueResult,
  type ThreadRetryResult,
  type ThreadPendingPlan,
  type ThreadRollbackResult,
  type ThreadStartRequest,
  type ThreadStartResult,
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
  getModelSettings(): Promise<ModelSettingsSnapshot> {
    return ipcRenderer.invoke(IPC_CHANNELS.modelSettingsGet);
  },
  saveProvider(provider: ProviderConfigInput): Promise<ProviderConfigView> {
    return ipcRenderer.invoke(IPC_CHANNELS.modelProviderSave, provider);
  },
  listProviderModels(request: ListUpstreamModelsRequest): Promise<ListUpstreamModelsResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.modelProviderListModels, request);
  },
  saveRoleRoutes(routes: RoleRouteConfig[]): Promise<RoleRouteConfig[]> {
    return ipcRenderer.invoke(IPC_CHANNELS.modelRoutesSave, routes);
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
  startThread(request: ThreadStartRequest): Promise<ThreadStartResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadStart, request);
  },
  continueThread(request: ThreadContinueRequest): Promise<ThreadContinueResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadContinue, request);
  },
  retryThread(threadId: string): Promise<ThreadRetryResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadRetry, threadId);
  },
  cancelThread(threadId: string): Promise<void> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadCancel, threadId);
  },
  rollbackToThread(threadId: string): Promise<ThreadRollbackResult> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadRollbackTo, threadId);
  },
  getPendingPlan(threadId: string): Promise<ThreadPendingPlan | undefined> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadGetPendingPlan, threadId);
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
  approvePlan(threadId: string): Promise<{ thread?: ThreadSummary }> {
    return ipcRenderer.invoke(IPC_CHANNELS.threadApprovePlan, threadId);
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
