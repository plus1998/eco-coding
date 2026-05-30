export const IPC_CHANNELS = {
  workspaceOpen: "workspace:open",
  workspaceGetCurrent: "workspace:get-current",
  workspaceInspect: "workspace:inspect",
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
  threadRetry: "thread:retry",
  threadGetPendingPlan: "thread:get-pending-plan",
  threadGetUsageSnapshot: "thread:get-usage-snapshot",
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
  agentSkillsGet: "agent-skills:get",
  agentSkillsSave: "agent-skills:save",
  sessionSyncSettingsGet: "session-sync-settings:get",
  sessionSyncSettingsSave: "session-sync-settings:save",
  sessionSyncTestConnection: "session-sync:test-connection",
  billingRefreshPricing: "billing:refresh-pricing",
  billingRoutePricing: "billing:route-pricing",
} as const;

export type {
  McpServerConfigInput,
  McpServerConfigView,
  McpSettingsSnapshot,
  McpTransport,
} from "./mcp";

export type { SkillInfo, SkillsListResult, SkillSource } from "./skills";

/** Skill directory names enabled per agent role at runtime (SDK skills preload). */
export type AgentSkillAssignments = Record<AgentRole, string[]>;
export type { ListUpstreamModelsRequest, ListUpstreamModelsResult, UpstreamModelOption } from "./models";
export type {
  SessionSyncSettingsInput,
  SessionSyncSettingsSnapshot,
  SessionSyncSettingsView,
  SessionSyncTestConnectionRequest,
  SessionSyncTestConnectionResult,
} from "./session-sync";

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

/** Approve execution of the pending plan captured from the planner. */
export interface ThreadApprovePlanRequest {
  threadId: string;
  /** @deprecated UI no longer edits plan text; ignored if sent. */
  plan?: string;
  /** @deprecated UI no longer edits plan text; ignored if sent. */
  analysis?: string;
}

export interface ThreadSummary {
  id: string;
  title: string;
  prompt: string;
  workspacePath: string;
  status: ThreadStatus;
  createdAt: string;
  message: string;
  /** Claude Agent SDK session ID when resume is available. */
  sdkSessionId?: string;
  /** Worktree path used as SDK cwd when the session was created. */
  sdkCwd?: string;
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

export interface ThreadRetryResult {
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

export type ContextSegmentKey =
  | "systemPrompt"
  | "toolDefinitions"
  | "rules"
  | "skills"
  | "mcp"
  | "subagentDefinitions"
  | "conversation";

export interface ContextBreakdownSegment {
  key: ContextSegmentKey;
  label: string;
  tokens: number;
  color: string;
}

export interface ThreadContextSnapshot {
  occupied: number;
  limit: number;
  occupancyPct: number;
  limitsResolved: boolean;
  segments: ContextBreakdownSegment[];
  updatedAt: number;
  /** @deprecated Use breakdownRefreshing. */
  stale?: boolean;
  /** True while Eco runs `/context` to refresh segment breakdown (meter stays live). */
  breakdownRefreshing?: boolean;
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

export interface TokenCostBreakdown {
  inputUsd: number;
  outputUsd: number;
  cacheReadUsd: number;
  cacheCreationUsd: number;
  totalUsd: number;
}

export interface ThreadBillingSnapshot {
  totalTokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheCreation: number;
  };
  otelCostUsd: number;
  plannerTokenCostUsd: number;
  ecoCostUsd: number;
  savedUsd: number;
  savedPct: number;
  ecoCostBreakdown?: TokenCostBreakdown;
  plannerCostBreakdown?: TokenCostBreakdown;
  plannerModelLabel?: string;
  pricingResolved: boolean;
  byRole?: Partial<
    Record<
      AgentRole,
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

export interface ThreadUsageSnapshotResult {
  billing?: ThreadBillingSnapshot;
  context?: ThreadContextSnapshot;
}

export interface RoutePricingHint {
  role: AgentRole;
  modelId: string;
  providerName: string;
  pricingLabel?: string;
  pricingResolved: boolean;
}

export interface ThreadLiveEvent {
  threadId: string;
  type: string;
  message: string;
  title?: string;
  role?: AgentRole | "system" | "thinking" | "tool" | "user";
  stream?: boolean;
  plan?: Pick<ThreadPendingPlan, "analysis" | "plan" | "userPrompt">;
  clarification?: ClarificationRequest;
  todoList?: CoderTodoItem[];
  usage?: ThreadUsageSnapshot;
  modelId?: string;
  /** Cumulative SDK-estimated cost across all query() calls in this thread. */
  totalCostUsd?: number;
  modelUsage?: Record<string, ThreadModelUsageEntry>;
  billing?: ThreadBillingSnapshot;
  context?: ThreadContextSnapshot;
}

export interface ThreadActivityLine {
  id: string;
  role: string;
  message: string;
  stream?: boolean;
}
