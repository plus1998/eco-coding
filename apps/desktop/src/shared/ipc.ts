export const IPC_CHANNELS = {
  workspaceOpen: "workspace:open",
  workspaceGetCurrent: "workspace:get-current",
  modelSettingsGet: "model-settings:get",
  modelProviderSave: "model-provider:save",
  modelProviderListModels: "model-provider:list-models",
  modelRoutesSave: "model-routes:save",
  threadStart: "thread:start",
  threadList: "thread:list",
  threadActivityList: "thread:activity-list",
  threadCancel: "thread:cancel",
  threadRollbackTo: "thread:rollback-to",
  threadApprovePlan: "thread:approve-plan",
  threadDismissPlan: "thread:dismiss-plan",
  threadContinue: "thread:continue",
  threadGetPendingPlan: "thread:get-pending-plan",
  threadTodoList: "thread:todo-list",
  clarificationGetPending: "clarification:get-pending",
  clarificationSubmit: "clarification:submit",
  clarificationDismiss: "clarification:dismiss",
  threadEventsSubscribe: "thread-events:subscribe",
  approvalResolve: "approval:resolve",
  modelProfilesList: "model-profiles:list",
  modelProfileSave: "model-profile:save",
  conformanceRun: "conformance:run",
  worktreeApply: "worktree:apply",
  worktreeGetStatus: "worktree:get-status",
  terminalSpawn: "terminal:spawn",
  terminalInput: "terminal:input",
  mcpSettingsGet: "mcp-settings:get",
  mcpServerSave: "mcp-server:save",
  mcpServerDelete: "mcp-server:delete",
  skillsList: "skills:list",
} as const;

export type {
  McpServerConfigInput,
  McpServerConfigView,
  McpSettingsSnapshot,
  McpTransport,
} from "./mcp";

export type { SkillInfo, SkillsListResult, SkillSource } from "./skills";
export type { ListUpstreamModelsRequest, ListUpstreamModelsResult, UpstreamModelOption } from "./models";

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

export interface ThreadRollbackResult {
  ok: true;
  revertedThreads: number;
  files: string[];
  message: string;
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
}

export interface ClarificationSubmitPayload {
  toolUseId: string;
  selections: string[][];
}

export interface ThreadLiveEvent {
  threadId: string;
  type: string;
  message: string;
  title?: string;
  role?: AgentRole | "system" | "thinking" | "tool";
  stream?: boolean;
  plan?: Pick<ThreadPendingPlan, "analysis" | "plan" | "userPrompt">;
  clarification?: ClarificationRequest;
  todoList?: CoderTodoItem[];
}

export interface ThreadActivityLine {
  id: string;
  role: string;
  message: string;
  stream?: boolean;
}
