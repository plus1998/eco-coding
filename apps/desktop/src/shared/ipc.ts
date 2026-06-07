import type { ThreadRunProjectionSnapshot } from "./thread-run-projection";

export const IPC_CHANNELS = {
  workspaceOpen: "workspace:open",
  workspaceOpenPath: "workspace:open-path",
  workspaceGetCurrent: "workspace:get-current",
  workspaceInspect: "workspace:inspect",
  workspacePrepareGit: "workspace:prepare-git",
  modelSettingsGet: "model-settings:get",
  modelProviderSave: "model-provider:save",
  modelProviderDelete: "model-provider:delete",
  modelProviderListModels: "model-provider:list-models",
  modelProviderTest: "model-provider:test",
  modelRouteProfileTest: "model-route-profile:test",
  modelRouteProfileSave: "model-route-profile:save",
  modelRouteProfileDelete: "model-route-profile:delete",
  threadStart: "thread:start",
  threadUpdateRuntimeConfig: "thread:update-runtime-config",
  threadList: "thread:list",
  threadActivityList: "thread:activity-list",
  threadRunProjectionGet: "thread:run-projection-get",
  threadSubagentSessionsList: "thread:subagent-sessions-list",
  threadSubagentMetricsList: "thread:subagent-metrics-list",
  threadDelete: "thread:delete",
  threadCancel: "thread:cancel",
  threadRollbackTo: "thread:rollback-to",
  threadGetAppliedDiff: "thread:get-applied-diff",
  threadRevertAppliedDiff: "thread:revert-applied-diff",
  threadRewindCheckpoint: "thread:rewind-checkpoint",
  threadListCheckpoints: "thread:list-checkpoints",
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
  skillsLinkAgents: "skills:link-agents",
  subagentSettingsGet: "subagent-settings:get",
  subagentSettingsSave: "subagent-settings:save",
  workflowSettingsGet: "workflow-settings:get",
  workflowSettingsSave: "workflow-settings:save",
  proxyBridgeSettingsGet: "proxy-bridge-settings:get",
  proxyBridgeSettingsSave: "proxy-bridge-settings:save",
  sessionSyncSettingsGet: "session-sync-settings:get",
  sessionSyncSettingsSave: "session-sync-settings:save",
  sessionSyncTestConnection: "session-sync:test-connection",
  billingRefreshPricing: "billing:refresh-pricing",
  billingRoutePricing: "billing:route-pricing",
  billingRouteCapabilities: "billing:route-capabilities",
  billingModelsDevList: "billing:models-dev-list",
} as const;

export type {
  McpServerConfigInput,
  McpServerConfigView,
  McpSettingsSnapshot,
  McpTransport,
} from "./mcp";

export type {
  LinkAgentsSkillsRequest,
  LinkAgentsSkillsResult,
  SkillInfo,
  SkillSource,
  SkillsListResult,
} from "./skills";

export type {
  ListUpstreamModelsRequest,
  ListUpstreamModelsResult,
  RoleRouteTestResult,
  TestProviderConnectionRequest,
  TestProviderConnectionResult,
  TestRoleRouteItem,
  TestRoleRoutesRequest,
  TestRoleRoutesResult,
  UpstreamModelOption,
} from "./models";
export type {
  SessionSyncSettingsInput,
  SessionSyncSettingsSnapshot,
  SessionSyncSettingsView,
  SessionSyncTestConnectionRequest,
  SessionSyncTestConnectionResult,
} from "./session-sync";
export type {
  ThreadRunEvent,
  ThreadRunEventInput,
  ThreadRunEventScope,
  ThreadRunEventStreamState,
  ThreadRunEventType,
  ThreadRunToolMetadata,
} from "./thread-run-events";
export type {
  ThreadRunProjectionAgent,
  ThreadRunProjectionAgentKind,
  ThreadRunProjectionAgentStatus,
  ThreadRunProjectionAttempt,
  ThreadRunProjectionAttemptStatus,
  ThreadRunProjectionContext,
  ThreadRunProjectionDiagnostic,
  ThreadRunProjectionDiagnosticCode,
  ThreadRunProjectionRequestSpan,
  ThreadRunProjectionRequestStatus,
  ThreadRunProjectionSnapshot,
  ThreadRunProjectionTimelineItem,
  ThreadRunProjectionUsage,
} from "./thread-run-projection";

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

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

export interface WorkspaceOpenResult {
  canceled: boolean;
  workspace?: WorkspaceInfo;
}

export interface WorkspacePrepareGitRequest {
  workspacePath: string;
}

export const AGENT_ROLES = ["planner", "explore", "architect", "coder", "reviewer", "tester"] as const;

export type AgentRole = (typeof AGENT_ROLES)[number];

export const SUBAGENT_ROLES = ["explore", "architect", "coder", "reviewer", "tester"] as const;

export type SubagentRole = (typeof SUBAGENT_ROLES)[number];

export type SubagentEnabledSettings = Record<SubagentRole, boolean>;

export type OrchestrationModeSetting = "autonomous" | "manual";

export interface WorkflowSettingsSnapshot {
  orchestrationMode: OrchestrationModeSetting;
}

export interface ProxyBridgeSettingsSnapshot {
  /** 留空：透传 SDK User-Agent；非空：覆盖透传 */
  upstreamUserAgent?: string;
}

import type { UpstreamApiCompat } from "./api-compat";
import type { ThreadRuntimeConfig, ThreadRuntimeConfigInput } from "./thread-runtime-config";

export type { UpstreamApiCompat };

export interface ProviderConfigInput {
  id?: string;
  name: string;
  baseUrl: string;
  /** Path prefix for Anthropic-compatible API requests, e.g. `/anthropic`. */
  requestPath?: string;
  /** Default upstream API for this provider (role routes may override). */
  apiCompat?: UpstreamApiCompat;
  apiKey?: string;
  defaultModel: string;
  enabled: boolean;
}

export interface ProviderConfigView {
  id: string;
  name: string;
  baseUrl: string;
  requestPath: string;
  apiCompat: UpstreamApiCompat;
  defaultModel: string;
  enabled: boolean;
  hasApiKey: boolean;
  apiKeyPreview?: string;
  createdAt: string;
  updatedAt: string;
}

export type ThinkingEffort = "off" | "low" | "medium" | "high" | "xhigh" | "max";

export interface ModelsDevMapping {
  providerKey: string;
  modelId: string;
}

/** User-provided pricing/context when upstream model id is absent from models.dev. */
export interface RouteManualSpec {
  /** Context window in tokens. */
  contextTokens?: number;
  /** USD per million input tokens. */
  inputPerM?: number;
  /** USD per million output tokens. */
  outputPerM?: number;
  cacheReadPerM?: number;
  cacheWritePerM?: number;
}

export interface RoleRouteConfig {
  role: AgentRole;
  providerId: string;
  modelId: string;
  /** Overrides provider default when set. */
  apiCompat?: UpstreamApiCompat;
  thinkingEffort?: ThinkingEffort;
  modelsDevMapping?: ModelsDevMapping;
  manualSpec?: RouteManualSpec;
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

export type { ThreadRuntimeConfig, ThreadRuntimeConfigInput };
export {
  buildThreadRuntimeConfigFromDefaults,
  getDefaultRouteProfileId,
  getRoutesForProfile,
  isThreadRuntimeConfig,
  normalizeThreadRuntimeConfig,
} from "./thread-runtime-config";

export interface PromptImageAttachment {
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  /** Base64 payload without data: URL prefix. */
  data: string;
}

export interface ModelSettingsSnapshot {
  providers: ProviderConfigView[];
  routeProfiles: RouteProfileView[];
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
  updatedAt: string;
  message: string;
  /** Claude Agent SDK session ID when resume is available. */
  sdkSessionId?: string;
  /** Worktree path used as SDK cwd when the session was created. */
  sdkCwd?: string;
  /** Per-thread route profile, subagent, and plan mode (snapshotted at start). */
  runtimeConfig?: ThreadRuntimeConfig;
}

export interface ThreadStartRequest {
  workspacePath: string;
  prompt: string;
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
  /** Optional update before sending the next message. */
  runtimeConfig?: ThreadRuntimeConfigInput;
}

export interface ThreadContinueResult {
  thread: ThreadSummary;
}

export interface ThreadRetryRequest {
  threadId: string;
  /** One-off retry with another route profile template. */
  routeProfileId?: string;
}

export interface ThreadRetryResult {
  thread: ThreadSummary;
}

export interface ThreadDeleteResult {
  ok: true;
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
  | "conversation"
  | "unattributed";

export interface ContextBreakdownSegment {
  key: ContextSegmentKey;
  label: string;
  tokens: number;
  color: string;
}

export interface ThreadRoleContextSnapshot {
  role: AgentRole;
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
  role: AgentRole;
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
  /** Which role's session fill is shown (planner vs subagent). */
  displayRole?: AgentRole;
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

export type BillingUsageSource = "proxy" | "otel" | "sdk";

export interface TokenCostBreakdown {
  inputUsd: number;
  outputUsd: number;
  cacheReadUsd: number;
  cacheCreationUsd: number;
  totalUsd: number;
}

export interface ThreadBillingModelSnapshot {
  modelId: string;
  roles: AgentRole[];
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  ecoCostUsd: number;
  /** Cost reported by the source itself, when available (SDK/OTel estimate). */
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
  /** Cost reported by the source itself, when available (SDK/OTel estimate). */
  reportedCostUsd?: number;
  pricingResolved: boolean;
  byModel?: ThreadBillingModelSnapshot[];
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

export interface ThreadSubagentBillingSnapshot {
  agentId: string;
  role: AgentRole;
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
  /** Primary source used for settlement and validation; SDK-first when present. */
  primarySource?: BillingUsageSource;
  /** Headline totals shown in UI; uses proxy while running, otherwise matches primarySource. */
  displaySource?: BillingUsageSource;
  sourceBreakdown?: Partial<Record<BillingUsageSource, ThreadBillingSourceSnapshot>>;
  byModel?: ThreadBillingModelSnapshot[];
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
  subagents?: ThreadSubagentBillingSnapshot[];
}

export interface ThreadUsageSnapshotResult {
  billing?: ThreadBillingSnapshot;
  context?: ThreadContextSnapshot;
}

export interface RoutePricingRates {
  inputPerM: number;
  outputPerM: number;
  cacheReadPerM?: number;
  cacheWritePerM?: number;
}

export interface RoutePricingHint {
  role: AgentRole;
  modelId: string;
  providerName: string;
  /** models.dev 参考单价（每百万 token，USD） */
  rates?: RoutePricingRates;
  /** 完整说明，用于悬停提示 */
  pricingLabel?: string;
  pricingResolved: boolean;
}

export interface RouteCapabilityHint {
  role: AgentRole;
  modelId: string;
  providerName: string;
  supportsImageInput: boolean;
  supportsReasoning: boolean;
  capabilitiesResolved: boolean;
  contextTokens?: number;
  maxOutputTokens?: number;
  contextLimitResolved: boolean;
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
  role: AgentRole;
  status: "active" | "stopped";
  startedAt: string;
  lastActiveAt: string;
  endedAt?: string;
  accumulatedMs: number;
  /** Active processing duration (accumulated + current segment when active). */
  durationMs: number;
}

export interface ThreadSubagentMetricsSummary {
  agentId: string;
  role: AgentRole;
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
  role?: AgentRole | "system" | "thinking" | "tool" | "user";
  stream?: boolean;
  /** Set when the main process persisted this event as a thread_activity row. */
  activityLine?: ThreadActivityLine;
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
  projection?: ThreadRunProjectionSnapshot;
  subagentSessions?: ThreadSubagentSessionTiming[];
  apiError?: ThreadApiErrorInfo;
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
  /** Sub-agent instance id (SDK session_id / SubagentStart agent_id). */
  agentId?: string;
  /** Structured API failure from OTLP api_error event (not parsed from stream text). */
  apiError?: ThreadApiErrorInfo;
}
