export const IPC_CHANNELS = {
  workspaceOpen: "workspace:open",
  workspaceGetCurrent: "workspace:get-current",
  modelSettingsGet: "model-settings:get",
  modelProviderSave: "model-provider:save",
  modelRoutesSave: "model-routes:save",
  threadStart: "thread:start",
  threadList: "thread:list",
  threadActivityList: "thread:activity-list",
  threadCancel: "thread:cancel",
  threadApprovePlan: "thread:approve-plan",
  threadDismissPlan: "thread:dismiss-plan",
  threadContinue: "thread:continue",
  threadGetPendingPlan: "thread:get-pending-plan",
  threadEventsSubscribe: "thread-events:subscribe",
  approvalResolve: "approval:resolve",
  modelProfilesList: "model-profiles:list",
  modelProfileSave: "model-profile:save",
  conformanceRun: "conformance:run",
  worktreeApply: "worktree:apply",
  terminalSpawn: "terminal:spawn",
  terminalInput: "terminal:input",
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export function isKnownIpcChannel(channel: string): channel is IpcChannel {
  return Object.values(IPC_CHANNELS).includes(channel as IpcChannel);
}

export interface WorkspaceInfo {
  path: string;
  name: string;
  isGitRepository: boolean;
  gitRoot?: string;
  branch?: string;
  dirtyFileCount: number;
  packageManager?: "bun" | "pnpm" | "yarn" | "npm";
}

export interface WorkspaceOpenResult {
  canceled: boolean;
  workspace?: WorkspaceInfo;
}

export const AGENT_ROLES = ["planner", "architect", "coder", "reviewer", "tester"] as const;

export type AgentRole = (typeof AGENT_ROLES)[number];

export interface ProviderConfigInput {
  id?: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  defaultModel: string;
  enabled: boolean;
}

export interface ProviderConfigView {
  id: string;
  name: string;
  baseUrl: string;
  defaultModel: string;
  enabled: boolean;
  hasApiKey: boolean;
  apiKeyPreview?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RoleRouteConfig {
  role: AgentRole;
  providerId: string;
  modelId: string;
}

export interface ModelSettingsSnapshot {
  providers: ProviderConfigView[];
  routes: RoleRouteConfig[];
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
}

export interface ThreadSummary {
  id: string;
  title: string;
  prompt: string;
  workspacePath: string;
  status: ThreadStatus;
  createdAt: string;
  message: string;
}

export interface ThreadStartRequest {
  workspacePath: string;
  prompt: string;
}

export interface ThreadStartResult {
  thread: ThreadSummary;
}

export interface ThreadContinueRequest {
  threadId: string;
  prompt: string;
}

export interface ThreadContinueResult {
  thread: ThreadSummary;
}

export interface ThreadLiveEvent {
  threadId: string;
  type: string;
  message: string;
  role?: AgentRole | "system" | "thinking" | "tool";
  stream?: boolean;
  plan?: Pick<ThreadPendingPlan, "analysis" | "plan" | "userPrompt">;
}

export interface ThreadActivityLine {
  id: string;
  role: string;
  message: string;
  stream?: boolean;
}
