import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ClaudeAgentSdkDriver,
  extractSdkRunFailure,
  formatUsageBadge,
  estimateContextTokens,
  parseUsagePayload,
  type EcoHookContext,
  type EcoPlanningContext,
  type EcoSdkResumeOptions,
  type EcoSdkSessionOptions,
  type OtelActivityLine,
  type OtelUsageUpdate,
  type PlanReadyPayload,
  type SdkTodoUpdatedPayload,
  type SessionCapturedPayload,
  type AgentEvent,
} from "@eco/runtime";
import {
  createRedisSessionStore,
  createSqliteSessionStore,
  testRedisConnection,
  type SessionStore,
} from "@eco/persistence";
import type { ResolvedModelRoute } from "@eco/model-router";
import {
  createWorktreePlan,
  GitWorktreeService,
  type CommandRunner,
  type WorktreePlan,
} from "@eco/workspace";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import {
  AGENT_ROLES,
  type AgentRole,
  IPC_CHANNELS,
  isKnownIpcChannel,
  type McpServerConfigInput,
  type ListUpstreamModelsRequest,
  type ModelSettingsSnapshot,
  type ProviderConfigInput,
  type RoleRouteConfig,
  type AgentSkillAssignments,
  type ClarificationSubmitPayload,
  type CoderTodoItem,
  type ThreadActivityLine,
  type SessionSyncSettingsInput,
  type SessionSyncTestConnectionRequest,
  type ThreadContinueRequest,
  type ThreadContinueResult,
  type ThreadRetryResult,
  type ThreadLiveEvent,
  type ThreadBillingSnapshot,
  type ThreadModelUsageEntry,
  type ThreadPendingPlan,
  type ThreadRollbackResult,
  type ThreadStartRequest,
  type ThreadSummary,
  type ThreadUsageSnapshot,
  type WorktreeApplyResult,
  type WorktreeStatusResult,
  type WorkspaceInfo,
} from "../shared/ipc";
import {
  extractCoderTasksFromActivity,
  mergeCoderTodoItems,
} from "./coder-tasks";
import { createSdkTaskTracker } from "./sdk-task-tracker";
import {
  REQUEST_AUTO_RETRY_INTERVAL_MS,
  runWithRequestAutoRetry,
  type RequestAttemptResult,
} from "./request-retry";
import { classifyThreadIntent } from "./thread-intent";
import { parseThreadApprovePlanPayload } from "../shared/plan-approval";
import { buildAgentPromptWithContext, isContinuableThreadStatus } from "../shared/thread-continuation";
import { pendingThreadTitle, summarizeThreadTitleWithCoder } from "./thread-title";
import { createConversationStore, type ConversationStore } from "./conversation-store";
import { createSessionSyncStore, type SessionSyncStore } from "./session-sync-store";
import { startAnthropicModelProxy, type AnthropicProxyResolvedRoute } from "./anthropic-proxy";
import {
  buildPlannerModelLabel,
  lookupRoutePricingHints,
  resolveRuntimeRoutesFromSettings,
  resolveUsageRoute,
} from "./billing-resolver";
import { ModelsDevPricingCache } from "./models-dev-pricing-cache";
import {
  buildUsageRequestKey,
  ThreadUsageAccumulator,
} from "./thread-usage-accumulator";
import { getUpstreamLogFilePath } from "./upstream-log";
import { createMcpStore, type McpStore } from "./mcp-store";
import { localOtelReceiver } from "./otel-receiver";
import { listDiscoveredSkills } from "./skills-discovery";
import { listProviderUpstreamModels } from "./provider-models";
import { SdkStreamActivityBridge } from "./sdk-stream-activity";
import { createAgentSkillsStore, type AgentSkillsStore } from "./agent-skills-store";
import { createProviderStore, type ProviderConfigSecret, type ProviderStore } from "./provider-store";
import { inspectWorkspace, resolveGitExecutable } from "./workspace-inspect";
import {
  buildAskUserQuestionUpdatedInput,
  buildIgnoredClarificationAnswers,
  cancelClarificationsForThread,
  formatClarificationAnswersSummary,
  getPendingClarificationByToolUseId,
  getPendingClarificationForThread,
  registerPendingClarification,
  submitClarification,
} from "./clarification-bridge";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.VITE_DEV_SERVER_URL !== undefined;
const gitRunner: CommandRunner = {
  run: runGitCommand,
};
const gitWorktrees = new GitWorktreeService(gitRunner);
let currentWorkspace: WorkspaceInfo | undefined;
let providerStore: ProviderStore;
let mcpStore: McpStore;
let conversationStore: ConversationStore;
let agentSkillsStore: AgentSkillsStore;
let sessionSyncStore: SessionSyncStore;
let sdkSessionStore: SessionStore | undefined;
let closeSdkSessionStore: (() => Promise<void>) | undefined;

interface ActiveThreadRun {
  controller: AbortController;
  worktreePlan?: WorktreePlan;
  worktreeReady?: boolean;
}

const activeRuns = new Map<string, ActiveThreadRun>();
const threadUsageAccumulator = new ThreadUsageAccumulator();
const sdkStreamBridge = new SdkStreamActivityBridge();
let pricingCache: ModelsDevPricingCache;
let pricingCatalogReady: Promise<void> = Promise.resolve();

type AgentEventLike = Pick<AgentEvent, "type" | "payload" | "role">;

async function createMainWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1080,
    minHeight: 720,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#212121",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    await window.loadURL(process.env.VITE_DEV_SERVER_URL as string);
  } else {
    await window.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(async () => {
  const dbPath = path.join(app.getPath("userData"), "eco-coding.sqlite");
  providerStore = await createProviderStore(dbPath);
  mcpStore = await createMcpStore(dbPath);
  conversationStore = await createConversationStore(dbPath);
  agentSkillsStore = await createAgentSkillsStore(dbPath);
  sessionSyncStore = await createSessionSyncStore(dbPath);
  pricingCache = new ModelsDevPricingCache({
    cachePath: path.join(app.getPath("userData"), "models-dev-pricing.json"),
  });
  pricingCatalogReady = pricingCache.getCatalog().then(
    () => {},
    (error) => {
      process.stderr.write(`[eco] models.dev pricing cache init failed: ${errorMessage(error)}\n`);
    },
  );
  try {
    await rebuildSdkSessionStore(path.join(app.getPath("userData"), "eco-sessions.sqlite"));
  } catch (error) {
    process.stderr.write(
      `[eco] SessionStore init failed (${errorMessage(error)}), using local SQLite fallback\n`,
    );
    sdkSessionStore = await createSqliteSessionStore(path.join(app.getPath("userData"), "eco-sessions.sqlite"));
  }
  await localOtelReceiver.start({
    onActivity: emitOtelActivity,
    onUsage: emitOtelUsage,
  });
  recoverOrphanedRunningThreads();
  registerIpcHandlers();
  await createMainWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("will-quit", () => {
  void closeSdkSessionStore?.();
});

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.workspaceOpen, async () => {
    const result = await dialog.showOpenDialog({
      title: "Open project folder",
      properties: ["openDirectory"],
    });

    const selectedPath = result.filePaths[0];
    if (result.canceled || !selectedPath) {
      return { canceled: true };
    }

    currentWorkspace = await inspectWorkspace(selectedPath);
    return { canceled: false, workspace: currentWorkspace };
  });

  ipcMain.handle(IPC_CHANNELS.workspaceGetCurrent, async () => currentWorkspace);

  ipcMain.handle(IPC_CHANNELS.workspaceInspect, async (_event, workspacePath: unknown) => {
    if (typeof workspacePath !== "string" || !workspacePath.trim()) {
      throw new Error("Workspace path is required.");
    }
    return inspectWorkspace(workspacePath.trim());
  });

  ipcMain.handle(IPC_CHANNELS.threadList, async () => conversationStore.listThreads());

  ipcMain.handle(IPC_CHANNELS.threadActivityList, async (_event, threadId: string) => {
    if (typeof threadId !== "string" || !threadId.trim()) {
      return [];
    }
    return conversationStore.listActivityLines(threadId);
  });

  ipcMain.handle(IPC_CHANNELS.threadTodoList, async (_event, threadId: string) => {
    if (typeof threadId !== "string" || !threadId.trim()) {
      return [];
    }
    const stored = conversationStore.listCoderTodos(threadId);
    if (stored.length > 0) {
      return stored;
    }
    const activity = conversationStore.listActivityLines(threadId);
    const drafts = extractCoderTasksFromActivity(activity);
    if (drafts.length === 0) {
      return stored;
    }
    const todos = mergeCoderTodoItems(threadId, drafts, stored);
    conversationStore.replaceCoderTodos(threadId, todos);
    return todos;
  });

  ipcMain.handle(IPC_CHANNELS.modelSettingsGet, async () => providerStore.getSettings());

  ipcMain.handle(IPC_CHANNELS.modelProviderSave, async (_event, payload: ProviderConfigInput) => {
    const provider = providerStore.saveProvider(payload);
    emitSettingsUpdated();
    return provider;
  });

  ipcMain.handle(IPC_CHANNELS.modelProviderListModels, async (_event, payload: ListUpstreamModelsRequest) => {
    if (!payload || typeof payload !== "object") {
      return { ok: false, error: "Invalid models list request." } as const;
    }
    return listProviderUpstreamModels(providerStore, payload);
  });

  ipcMain.handle(IPC_CHANNELS.modelRoutesSave, async (_event, payload: RoleRouteConfig[]) => {
    const routes = providerStore.saveRoleRoutes(payload);
    emitSettingsUpdated();
    return routes;
  });

  ipcMain.handle(IPC_CHANNELS.billingRefreshPricing, async () => {
    await pricingCache.refresh();
    return { ok: true as const, cachedAt: pricingCache.getCachedAt() };
  });

  ipcMain.handle(IPC_CHANNELS.billingRoutePricing, async () => {
    await pricingCatalogReady;
    return lookupRoutePricingHints(
      pricingCache,
      providerStore.getSettings(),
      providerStore.listProvidersWithSecrets(),
    );
  });

  ipcMain.handle(IPC_CHANNELS.mcpSettingsGet, async () => mcpStore.getSettings());

  ipcMain.handle(IPC_CHANNELS.mcpServerSave, async (_event, payload: McpServerConfigInput) => {
    const server = mcpStore.saveServer(payload);
    emitSettingsUpdated();
    return server;
  });

  ipcMain.handle(IPC_CHANNELS.skillsList, async (_event, workspacePath: unknown) => {
    const pathToScan =
      typeof workspacePath === "string" && workspacePath.trim()
        ? workspacePath.trim()
        : currentWorkspace?.path;
    return listDiscoveredSkills(pathToScan);
  });

  ipcMain.handle(IPC_CHANNELS.agentSkillsGet, async () => agentSkillsStore.getAssignments());

  ipcMain.handle(IPC_CHANNELS.agentSkillsSave, async (_event, payload: unknown) => {
    if (!isAgentSkillAssignments(payload)) {
      throw new Error("Invalid agent skills assignments.");
    }
    const pathToScan = currentWorkspace?.path;
    const discovered = await listDiscoveredSkills(pathToScan);
    const allowed = new Set(
      [...discovered.userSkills, ...discovered.projectSkills].map((skill) => skill.name),
    );
    return agentSkillsStore.saveAssignments(payload, allowed);
  });

  ipcMain.handle(IPC_CHANNELS.worktreeGetStatus, async (_event, threadId: unknown) => {
    if (typeof threadId !== "string" || !threadId.trim()) {
      throw new Error("Thread id is required.");
    }
    return getWorktreeStatus(threadId);
  });

  ipcMain.handle(IPC_CHANNELS.worktreeApply, async (_event, threadId: unknown) => {
    if (typeof threadId !== "string" || !threadId.trim()) {
      throw new Error("Thread id is required.");
    }
    return applyWorktreeForThread(threadId);
  });

  ipcMain.handle(IPC_CHANNELS.mcpServerDelete, async (_event, serverId: unknown) => {
    if (typeof serverId !== "string" || !serverId.trim()) {
      throw new Error("MCP server id is required.");
    }
    mcpStore.deleteServer(serverId);
    emitSettingsUpdated();
    return { ok: true };
  });

  ipcMain.handle(IPC_CHANNELS.sessionSyncSettingsGet, async () => sessionSyncStore.getSettings());

  ipcMain.handle(IPC_CHANNELS.sessionSyncSettingsSave, async (_event, payload: SessionSyncSettingsInput) => {
    const settings = sessionSyncStore.saveSettings(payload);
    await rebuildSdkSessionStore(path.join(app.getPath("userData"), "eco-sessions.sqlite"));
    emitSettingsUpdated();
    return settings;
  });

  ipcMain.handle(
    IPC_CHANNELS.sessionSyncTestConnection,
    async (_event, payload: SessionSyncTestConnectionRequest) => {
      if (!payload || typeof payload.redisUrl !== "string" || !payload.redisUrl.trim()) {
        return { ok: false, error: "Redis URL is required." };
      }
      const stored = sessionSyncStore.getSettingsWithSecrets();
      const password =
        payload.redisPassword && payload.redisPassword.length > 0
          ? payload.redisPassword
          : stored.redisPassword;
      return testRedisConnection({
        url: payload.redisUrl.trim(),
        ...(password ? { password } : {}),
      });
    },
  );

  ipcMain.handle(IPC_CHANNELS.threadStart, async (_event, payload: ThreadStartRequest) => {
    const prompt = payload.prompt.trim();
    if (!prompt) {
      throw new Error("Task prompt is required.");
    }

    const workspace = await ensureWorkspace(payload.workspacePath);
    const runtimeConfig = resolveRuntimeConfig(
      providerStore.getSettings(),
      providerStore.listProvidersWithSecrets(),
    );
    const intent = classifyThreadIntent(prompt);
    const status: ThreadSummary["status"] = runtimeConfig.ok ? "running" : "blocked";
    const thread: ThreadSummary = {
      id: `thr_${Date.now()}`,
      title: pendingThreadTitle,
      prompt,
      workspacePath: workspace.path,
      status,
      createdAt: new Date().toISOString(),
      message: runtimeConfig.ok
        ? intent === "question"
          ? "正在回答…"
          : "Creating isolated worktree and starting Claude Agent SDK."
        : runtimeConfig.reason,
    };

    conversationStore.saveThread(thread);
    recordUserPrompt(thread.id, prompt);
    emitThreadEvent(thread.id, status === "blocked" ? "thread.blocked" : "thread.started", thread.message);

    if (runtimeConfig.ok) {
      if (intent === "question") {
        void runQuestionThread(thread, workspace, runtimeConfig, prompt);
      } else {
        void runCodingThreadPlanning(thread, workspace, runtimeConfig, prompt);
      }
    }

    return { thread };
  });

  ipcMain.handle(IPC_CHANNELS.clarificationGetPending, async (_event, threadId: unknown) => {
    if (typeof threadId !== "string" || !threadId.trim()) {
      return undefined;
    }
    return getPendingClarificationForThread(threadId);
  });

  ipcMain.handle(IPC_CHANNELS.clarificationDismiss, async (_event, toolUseId: unknown) => {
    if (typeof toolUseId !== "string" || !toolUseId.trim()) {
      throw new Error("Tool use id is required.");
    }
    const request = getPendingClarificationByToolUseId(toolUseId);
    if (!request) {
      throw new Error("No pending clarification for this tool use.");
    }
    const ok = submitClarification(toolUseId, buildIgnoredClarificationAnswers(request));
    if (!ok) {
      throw new Error("Failed to dismiss clarification.");
    }
    return { ok: true as const };
  });

  ipcMain.handle(IPC_CHANNELS.clarificationSubmit, async (_event, payload: unknown) => {
    if (!isClarificationSubmitPayload(payload)) {
      throw new Error("Invalid clarification payload.");
    }
    if (!getPendingClarificationByToolUseId(payload.toolUseId)) {
      throw new Error("No pending clarification for this tool use.");
    }
    const ok = submitClarification(payload.toolUseId, {
      toolUseId: payload.toolUseId,
      selections: payload.selections,
    });
    if (!ok) {
      throw new Error("Failed to submit clarification.");
    }
    return { ok: true as const };
  });

  ipcMain.handle(IPC_CHANNELS.threadGetPendingPlan, async (_event, threadId: unknown) => {
    if (typeof threadId !== "string" || !threadId.trim()) {
      return undefined;
    }
    const pending = conversationStore.getPendingPlan(threadId);
    if (!pending) {
      return undefined;
    }
    return {
      threadId: pending.threadId,
      userPrompt: pending.userPrompt,
      analysis: pending.analysis,
      plan: pending.plan,
      workspacePath: pending.workspacePath,
      worktreePath: pending.worktreePath,
    } satisfies ThreadPendingPlan;
  });

  ipcMain.handle(IPC_CHANNELS.threadApprovePlan, async (_event, payload: unknown) => {
    const { threadId, plan: editedPlan, analysis: editedAnalysis } = parseThreadApprovePlanPayload(payload);
    const thread = conversationStore.getThread(threadId);
    if (!thread) {
      throw new Error("Thread was not found.");
    }
    if (thread.status !== "awaiting_plan") {
      throw new Error("This thread is not waiting for plan approval.");
    }
    if (activeRuns.has(threadId)) {
      throw new Error("Thread is already running.");
    }

    const pending = conversationStore.getPendingPlan(threadId);
    if (!pending) {
      throw new Error("找不到待批准的计划。");
    }

    const plan = editedPlan !== undefined ? editedPlan.trim() : pending.plan.trim();
    const analysis = editedAnalysis !== undefined ? editedAnalysis.trim() : pending.analysis.trim();
    if (!plan) {
      throw new Error("计划内容不能为空。");
    }

    const planUserEdited = plan !== pending.plan.trim() || analysis !== pending.analysis.trim();
    if (planUserEdited) {
      conversationStore.savePendingPlan({
        ...pending,
        plan,
        analysis,
      });
      emitThreadEvent(threadId, "thread.plan_updated", "已采用你编辑后的计划。", "planner", false);
    }

    const runtimeConfig = resolveRuntimeConfig(
      providerStore.getSettings(),
      providerStore.listProvidersWithSecrets(),
    );
    if (!runtimeConfig.ok) {
      throw new Error(runtimeConfig.reason);
    }

    updateThread(threadId, {
      status: "running",
      message: planUserEdited ? "正在按编辑后的计划执行…" : "正在按计划执行…",
    });
    void runCodingThreadExecution(threadId, runtimeConfig, { planUserEdited });
    return { thread: conversationStore.getThread(threadId) ?? thread };
  });

  ipcMain.handle(IPC_CHANNELS.threadDismissPlan, async (_event, threadId: unknown) => {
    if (typeof threadId !== "string" || !threadId.trim()) {
      throw new Error("Thread id is required.");
    }
    await dismissPendingPlan(threadId, "已忽略计划。你可以继续在本对话中提问。");
    return { thread: conversationStore.getThread(threadId) };
  });

  ipcMain.handle(IPC_CHANNELS.threadContinue, async (_event, payload: ThreadContinueRequest) => {
    const prompt = payload.prompt.trim();
    if (!prompt) {
      throw new Error("Message is required.");
    }
    const thread = conversationStore.getThread(payload.threadId);
    if (!thread) {
      throw new Error("Thread was not found.");
    }
    if (thread.status === "running" || thread.status === "queued") {
      throw new Error("Wait for the current run to finish.");
    }
    if (thread.status === "awaiting_plan") {
      await dismissPendingPlan(payload.threadId, "已忽略原计划。");
    }

    const workspace = await ensureWorkspace(thread.workspacePath);
    const runtimeConfig = resolveRuntimeConfig(
      providerStore.getSettings(),
      providerStore.listProvidersWithSecrets(),
    );
    if (!runtimeConfig.ok) {
      throw new Error(runtimeConfig.reason);
    }

    const intent = classifyThreadIntent(prompt);
    const activityLines = conversationStore.listActivityLines(payload.threadId);
    const worktreePlan = createWorktreePlan(workspace.path, payload.threadId);
    const worktreeExists = await fileExists(worktreePlan.worktreePath);
    const worktreePath = worktreeExists ? worktreePlan.worktreePath : undefined;
    const sdkSession = conversationStore.getSdkSession(payload.threadId);
    const canResume = Boolean(sdkSession?.sessionId && worktreePath && sdkSession.cwd === worktreePath);
    const continuePhase = canResume ? resolveContinuePhase(thread, intent) : undefined;
    const agentPrompt = canResume
      ? prompt
      : buildAgentPromptWithContext(thread.prompt, prompt, activityLines);
    const statusMessage =
      continuePhase === "question"
        ? "正在回答…"
        : continuePhase === "execution"
          ? "正在继续执行…"
          : "正在分析并制定计划…";

    updateThread(payload.threadId, {
      status: "running",
      message: intent === "question" && !canResume ? "正在回答…" : statusMessage,
    });
    recordUserPrompt(payload.threadId, prompt);

    const updated: ThreadSummary = {
      ...thread,
      status: "running",
      message: intent === "question" && !canResume ? "正在回答…" : statusMessage,
    };

    if (canResume && continuePhase) {
      void runThreadContinuation(
        updated,
        workspace,
        runtimeConfig,
        agentPrompt,
        continuePhase,
        worktreeExists ? worktreePlan : undefined,
      );
    } else if (intent === "question") {
      void runQuestionThread(updated, workspace, runtimeConfig, agentPrompt, worktreePath);
    } else {
      void runCodingThreadPlanning(
        updated,
        workspace,
        runtimeConfig,
        agentPrompt,
        worktreeExists ? worktreePlan : undefined,
      );
    }
    return { thread: conversationStore.getThread(payload.threadId) ?? updated } satisfies ThreadContinueResult;
  });

  ipcMain.handle(IPC_CHANNELS.threadRetry, async (_event, threadId: unknown) => {
    if (typeof threadId !== "string" || !threadId.trim()) {
      throw new Error("Thread id is required.");
    }
    return retryThread(threadId.trim());
  });

  ipcMain.handle(IPC_CHANNELS.threadCancel, async (_event, threadId: unknown) => {
    if (typeof threadId !== "string" || !threadId.trim()) {
      return;
    }
    const active = activeRuns.get(threadId);
    if (active) {
      updateThread(threadId, { status: "running", message: "正在停止…" });
      cancelClarificationsForThread(threadId, "cancelled by user");
      active.controller.abort("cancelled by user");
      return;
    }
    const thread = conversationStore.getThread(threadId);
    if (thread?.status === "awaiting_plan") {
      await dismissPendingPlan(threadId, "已取消。");
      return;
    }
    if (thread?.status === "running" || thread?.status === "queued") {
      updateThread(threadId, {
        status: "idle",
        message: "已停止。若隔离工作树仍有变更，可在右侧「应用到工作区」合并。",
      });
      emitThreadEvent(threadId, "thread.idle", "已停止。", "system");
    }
  });

  ipcMain.handle(IPC_CHANNELS.threadRollbackTo, async (_event, threadId: unknown) => {
    if (typeof threadId !== "string" || !threadId.trim()) {
      throw new Error("Thread id is required.");
    }
    return rollbackWorkspaceToThread(threadId);
  });

  ipcMain.handle(IPC_CHANNELS.modelProfilesList, async () => providerStore.getSettings().providers);

  ipcMain.on("message", (event) => {
    if (!isKnownIpcChannel(event.type)) {
      event.preventDefault();
    }
  });
}

async function ensureWorkspace(workspacePath: string): Promise<WorkspaceInfo> {
  if (currentWorkspace?.path === workspacePath) {
    if (!currentWorkspace.isGitRepository) {
      throw new Error("Open a Git repository before starting a coding thread.");
    }
    return currentWorkspace;
  }

  const workspace = await inspectWorkspace(workspacePath);
  if (!workspace.isGitRepository) {
    throw new Error("Open a Git repository before starting a coding thread.");
  }
  currentWorkspace = workspace;
  return workspace;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function scheduleThreadTitleSummary(
  threadId: string,
  prompt: string,
  runtimeConfig: RuntimeConfig,
  context?: { plan?: string; analysis?: string },
): void {
  void summarizeThreadTitleWithCoder(runtimeConfig.routes, prompt, fetch, context)
    .then((title) => {
      if (!title) {
        return;
      }
      const thread = conversationStore.getThread(threadId);
      if (!thread || thread.prompt !== prompt || thread.title === title) {
        return;
      }

      conversationStore.updateThreadTitle(threadId, title);
      emitThreadEvent(threadId, "thread.title_updated", "标题已更新", "system", false, { title });
    })
    .catch((error) => {
      process.stderr.write(`[eco] title summary failed: ${errorMessage(error)}\n`);
    });
}

function runThreadRequestWithAutoRetry(
  threadId: string,
  signal: AbortSignal | undefined,
  runOnce: () => Promise<RequestAttemptResult>,
): Promise<RequestAttemptResult> {
  return runWithRequestAutoRetry(runOnce, {
    signal,
    onRetryScheduled: (retryIndex, maxRetries, reason) => {
      const short = reason.length > 100 ? `${reason.slice(0, 97)}…` : reason;
      const message = `【自动重试 ${retryIndex}/${maxRetries}】${REQUEST_AUTO_RETRY_INTERVAL_MS / 1000} 秒后重试：${short}`;
      emitThreadEvent(threadId, "thread.auto_retry", message, "system");
      updateThread(threadId, { status: "running", message });
    },
  });
}

async function runQuestionThread(
  thread: ThreadSummary,
  workspace: WorkspaceInfo,
  runtimeConfig: RuntimeConfig,
  prompt: string,
  worktreePath?: string,
  resume?: EcoSdkResumeOptions,
): Promise<void> {
  const controller = new AbortController();
  const cwd = worktreePath?.trim() || workspace.path;
  activeRuns.set(thread.id, { controller, worktreePlan: createWorktreePlan(workspace.path, thread.id), worktreeReady: Boolean(worktreePath) });

  try {
    const outcome = await runThreadRequestWithAutoRetry(thread.id, controller.signal, async () => {
      const attemptProxy = await startAnthropicModelProxy(runtimeConfig.routes);
      process.stderr.write(
        `[eco] 模型代理: ${attemptProxy.baseUrl} · 上游日志: ${getUpstreamLogFilePath()}\n`,
      );
      updateThread(thread.id, {
        status: "running",
        message: `Local model router ready: ${attemptProxy.baseUrl}`,
      });
      const routes = buildDriverRoutes(attemptProxy.routes);
      try {
        const driver = createSdkDriver(thread.id, attemptProxy);
        if (!driver.runQuestion) {
          throw new Error("Runtime driver does not support question answering.");
        }

        let sdkFailure: string | undefined;
        for await (const event of driver.runQuestion({
          threadId: thread.id,
          prompt,
          workspacePath: workspace.path,
          worktreePath: cwd,
          routes,
          signal: controller.signal,
          sdkSession: buildSdkSessionOptions(),
          ...(resume ? { resume } : {}),
        })) {
          if (event.type === "usage.recorded") {
            sdkFailure = extractSdkRunFailure(event.payload) ?? sdkFailure;
            emitUsageFromDriverEvent(thread.id, event);
            continue;
          }
          captureSdkSessionFromEvent(thread.id, event, cwd);
          emitSdkStreamActivity(thread.id, event);
        }

        if (controller.signal.aborted) {
          return { ok: false, reason: "cancelled by user", aborted: true };
        }
        if (sdkFailure) {
          return { ok: false, reason: sdkFailure };
        }
        return { ok: true };
      } catch (error) {
        if (controller.signal.aborted) {
          return { ok: false, reason: "cancelled by user", aborted: true };
        }
        return { ok: false, reason: errorMessage(error) };
      } finally {
        await attemptProxy.close();
      }
    });

    if (outcome.aborted) {
      updateThread(thread.id, { status: "idle", message: "已停止回答。" });
      return;
    }
    if (!outcome.ok) {
      updateThread(thread.id, { status: "failed", message: outcome.reason });
      return;
    }

    updateThread(thread.id, { status: "completed", message: "回答完成。" });
    scheduleThreadTitleSummary(thread.id, prompt, runtimeConfig);
  } catch (error) {
    cancelClarificationsForThread(thread.id, errorMessage(error));
    updateThread(thread.id, {
      status: "failed",
      message: errorMessage(error),
    });
  } finally {
    cancelClarificationsForThread(thread.id, "run finished");
    sdkStreamBridge.resetThread(thread.id);
    activeRuns.delete(thread.id);
    const currentThread = conversationStore.getThread(thread.id);
    if (currentThread?.status === "running") {
      updateThread(thread.id, {
        status: "idle",
        message: currentThread.message || "回答已结束。",
      });
    }
  }
}

async function runCodingThreadPlanning(
  thread: ThreadSummary,
  workspace: WorkspaceInfo,
  runtimeConfig: RuntimeConfig,
  prompt: string,
  existingWorktreePlan?: WorktreePlan,
  resume?: EcoSdkResumeOptions,
): Promise<void> {
  const worktreePlan = existingWorktreePlan ?? createWorktreePlan(workspace.path, thread.id);
  const controller = new AbortController();
  const worktreeExists = await fileExists(worktreePlan.worktreePath);
  activeRuns.set(thread.id, { controller, worktreePlan, worktreeReady: worktreeExists });

  try {
    await fs.mkdir(path.dirname(worktreePlan.worktreePath), { recursive: true });
    if (!worktreeExists) {
      await gitWorktrees.createWorktree(worktreePlan);
    }
    activeRuns.get(thread.id)!.worktreeReady = true;
    updateThread(thread.id, {
      message: `Isolated worktree ready: ${worktreePlan.worktreePath}`,
      status: "running",
    });

    const planningOutcome = await runThreadRequestWithAutoRetry(thread.id, controller.signal, async () => {
      const attemptProxy = await startAnthropicModelProxy(runtimeConfig.routes);
      process.stderr.write(
        `[eco] 模型代理: ${attemptProxy.baseUrl} · 上游日志: ${getUpstreamLogFilePath()}\n`,
      );
      updateThread(thread.id, {
        message: `Local model router ready: ${attemptProxy.baseUrl}`,
        status: "running",
      });
      const routes = buildDriverRoutes(attemptProxy.routes);
      const plannerRoute = attemptProxy.routes.find((route) => route.role === "planner");
      process.stderr.write(
        `[eco] SDK model=${plannerRoute?.modelId ?? "?"} (proxy ${attemptProxy.baseUrl}, alias ${plannerRoute?.aliasModelId ?? "?"})\n`,
      );

      try {
        const driver = createSdkDriver(thread.id, attemptProxy);

        let sdkFailure: string | undefined;
        let captured = false;

        const effectiveResume = resume ?? resolveResumeOptions(thread.id, worktreePlan.worktreePath);

        for await (const event of driver.run({
          threadId: thread.id,
          prompt,
          workspacePath: workspace.path,
          worktreePath: worktreePlan.worktreePath,
          routes,
          signal: controller.signal,
          sdkSession: buildSdkSessionOptions(),
          ...(effectiveResume ? { resume: effectiveResume } : {}),
        })) {
          if (event.type === "usage.recorded") {
            sdkFailure = extractSdkRunFailure(event.payload) ?? sdkFailure;
            emitUsageFromDriverEvent(thread.id, event);
            continue;
          }
          captureSdkSessionFromEvent(thread.id, event, worktreePlan.worktreePath);
          if (event.type === "plan.ready" && isPlanReadyPayload(event.payload)) {
            captured = true;
            conversationStore.savePendingPlan({
              threadId: thread.id,
              userPrompt: event.payload.userPrompt,
              analysis: event.payload.analysis,
              plan: event.payload.plan,
              workspacePath: workspace.path,
              worktreePath: worktreePlan.worktreePath,
              routesJson: JSON.stringify(routes),
            });
            emitThreadEvent(
              thread.id,
              "thread.awaiting_plan",
              "计划已生成，请确认是否执行。",
              "planner",
              false,
              {
                plan: {
                  userPrompt: event.payload.userPrompt,
                  analysis: event.payload.analysis,
                  plan: event.payload.plan,
                },
              },
            );
            scheduleThreadTitleSummary(thread.id, prompt, runtimeConfig, {
              plan: event.payload.plan,
              analysis: event.payload.analysis,
            });
          }

          if (event.type === "usage.recorded") {
            sdkFailure = extractSdkRunFailure(event.payload) ?? sdkFailure;
            emitUsageFromDriverEvent(thread.id, event);
            continue;
          }

          emitSdkStreamActivity(thread.id, event);
        }

        if (controller.signal.aborted) {
          return { ok: false, reason: "cancelled by user", aborted: true };
        }
        if (sdkFailure) {
          return { ok: false, reason: sdkFailure };
        }
        if (!captured) {
          return { ok: false, reason: "未能生成可执行的计划。" };
        }
        return { ok: true };
      } catch (error) {
        if (controller.signal.aborted) {
          return { ok: false, reason: "cancelled by user", aborted: true };
        }
        return { ok: false, reason: errorMessage(error) };
      } finally {
        await attemptProxy.close();
      }
    });

    if (planningOutcome.aborted) {
      cancelClarificationsForThread(thread.id, "cancelled by user");
      updateThread(thread.id, { status: "idle", message: "已取消。" });
      await cleanupWorktreeForThread(thread.id);
      return;
    }
    if (!planningOutcome.ok) {
      cancelClarificationsForThread(thread.id, planningOutcome.reason);
      updateThread(thread.id, {
        status: "failed",
        message: planningOutcome.reason,
      });
      await cleanupWorktreeForThread(thread.id);
      return;
    }

    updateThread(thread.id, {
      status: "awaiting_plan",
      message: "等待你确认计划。",
    });
  } catch (error) {
    cancelClarificationsForThread(thread.id, errorMessage(error));
    updateThread(thread.id, {
      status: "failed",
      message: errorMessage(error),
    });
    await cleanupWorktreeForThread(thread.id);
  } finally {
    cancelClarificationsForThread(thread.id, "run finished");
    sdkStreamBridge.resetThread(thread.id);
    activeRuns.delete(thread.id);
    const currentThread = conversationStore.getThread(thread.id);
    if (currentThread?.status === "running") {
      updateThread(thread.id, {
        status: "idle",
        message: currentThread.message || "计划阶段已结束。",
      });
    }
  }
}

async function runCodingThreadExecution(
  threadId: string,
  runtimeConfig: RuntimeConfig,
  options?: { planUserEdited?: boolean },
): Promise<void> {
  const pending = conversationStore.getPendingPlan(threadId);
  const thread = conversationStore.getThread(threadId);
  if (!pending || !thread) {
    updateThread(threadId, { status: "failed", message: "执行失败：找不到待批准的计划。" });
    return;
  }

  const planning: EcoPlanningContext = {
    userPrompt: pending.userPrompt,
    analysis: pending.analysis,
    plan: pending.plan,
    ...(options?.planUserEdited ? { planUserEdited: true } : {}),
  };

  const worktreePlan = resolveWorktreePlan(pending.workspacePath, threadId, pending.worktreePath);
  const controller = new AbortController();
  activeRuns.set(threadId, { controller, worktreePlan, worktreeReady: true });

  const stopStatusRef = { current: "completed" as "completed" | "blocked" | "cancelled" };
  let stopTodosHandled = false;

  const todoTracker = createSdkTaskTracker(threadId, {
    listTodos: () => conversationStore.listCoderTodos(threadId),
    replaceTodos: (todos) => conversationStore.replaceCoderTodos(threadId, todos),
  }, emitTodoList);
  const taskHookHandlers = todoTracker.createHookHandlers(() => stopStatusRef.current);
  const executionPlan = {
    ...pending,
    routesJson: pending.routesJson || "[]",
  };

  try {
    conversationStore.clearPendingPlan(threadId);
    emitThreadEvent(threadId, "thread.plan_cleared", "计划已进入执行阶段。", "system");

    const executionOutcome = await runThreadRequestWithAutoRetry(threadId, controller.signal, async () => {
      const attemptProxy = await startAnthropicModelProxy(runtimeConfig.routes);
      const attemptRoutes = buildDriverRoutes(attemptProxy.routes);
      executionPlan.routesJson = JSON.stringify(attemptRoutes);
      try {
        const driver = createSdkDriver(threadId, attemptProxy, {
          taskTracker: {
            ...taskHookHandlers,
            onStop(status) {
              stopTodosHandled = true;
              taskHookHandlers.onStop(status);
            },
          },
          getStopTodoStatus: () => stopStatusRef.current,
        });

        if (!driver.runExecution) {
          throw new Error("Runtime driver does not support execution phase.");
        }

        let sdkFailure: string | undefined;
        const resume = resolveResumeOptions(threadId, pending.worktreePath);
        for await (const event of driver.runExecution(
          {
            threadId,
            prompt: pending.userPrompt,
            workspacePath: pending.workspacePath,
            worktreePath: pending.worktreePath,
            routes: attemptRoutes,
            signal: controller.signal,
            sdkSession: buildSdkSessionOptions(),
            ...(resume ? { resume } : {}),
          },
          planning,
        )) {
          if (event.type === "usage.recorded") {
            sdkFailure = extractSdkRunFailure(event.payload) ?? sdkFailure;
            emitUsageFromDriverEvent(thread.id, event);
            continue;
          }

          captureSdkSessionFromEvent(threadId, event, pending.worktreePath);

          if (event.type === "todo.updated" && isSdkTodoProgressPayload(event.payload)) {
            todoTracker.handleTaskProgress(event.payload);
          }

          emitSdkStreamActivity(threadId, event);
        }

        if (controller.signal.aborted) {
          return { ok: false, reason: "cancelled by user", aborted: true };
        }
        if (sdkFailure) {
          return { ok: false, reason: sdkFailure };
        }
        return { ok: true };
      } catch (error) {
        if (controller.signal.aborted) {
          return { ok: false, reason: "cancelled by user", aborted: true };
        }
        return { ok: false, reason: errorMessage(error) };
      } finally {
        await attemptProxy.close();
      }
    });

    if (executionOutcome.aborted) {
      stopStatusRef.current = "cancelled";
      if (!stopTodosHandled) {
        taskHookHandlers.onStop("cancelled");
      }
      await restoreAfterExecutionFailure(threadId, worktreePlan, "执行已取消。", executionPlan);
      return;
    }

    if (!executionOutcome.ok) {
      stopStatusRef.current = "blocked";
      if (!stopTodosHandled) {
        taskHookHandlers.onStop("blocked");
      }
      await restoreAfterExecutionFailure(threadId, worktreePlan, executionOutcome.reason, executionPlan);
      return;
    }

    if (!stopTodosHandled) {
      taskHookHandlers.onStop("completed");
    }

    updateThread(threadId, {
      status: "idle",
      message: "代理执行完成，正在合并工作树更改…",
    });

    try {
      const { files, message, diff } = await applyWorktreeChanges(worktreePlan);
      conversationStore.saveAppliedDiff(threadId, worktreePlan.workspacePath, diff, files);
      updateThread(threadId, { status: "completed", message });
      emitThreadEvent(threadId, "worktree.applied", message, "system");
      process.stderr.write(`[eco] worktree apply ok (${files.length} files): ${files.join(", ")}\n`);
    } catch (applyError) {
      const detail = errorMessage(applyError);
      process.stderr.write(`[eco] worktree apply failed: ${detail}\n`);
      updateThread(threadId, {
        status: "completed",
        message: `执行已完成，但未能合并到工作区：${detail}。可点击「应用到工作区」重试，或手动处理 ${worktreePlan.worktreePath}。`,
      });
      emitThreadEvent(threadId, "worktree.apply_failed", detail, "system");
      return;
    }

    await cleanupWorktreeForThread(threadId);
  } catch (error) {
    stopStatusRef.current = "blocked";
    if (!stopTodosHandled) {
      taskHookHandlers.onStop("blocked");
    }
    await restoreAfterExecutionFailure(threadId, worktreePlan, errorMessage(error), executionPlan);
  } finally {
    sdkStreamBridge.resetThread(threadId);
    activeRuns.delete(threadId);
    const thread = conversationStore.getThread(threadId);
    if (thread?.status === "running") {
      updateThread(threadId, {
        status: "idle",
        message: thread.message || "执行已结束。",
      });
    }
  }
}

async function retryThread(threadId: string): Promise<ThreadRetryResult> {
  const thread = conversationStore.getThread(threadId);
  if (!thread) {
    throw new Error("Thread was not found.");
  }
  if (activeRuns.has(threadId)) {
    throw new Error("请等待当前运行结束后再重试。");
  }
  if (thread.status === "running" || thread.status === "queued") {
    throw new Error("对话正在运行中。");
  }

  const runtimeConfig = resolveRuntimeConfig(
    providerStore.getSettings(),
    providerStore.listProvidersWithSecrets(),
  );
  if (!runtimeConfig.ok) {
    throw new Error(runtimeConfig.reason);
  }

  const pending = conversationStore.getPendingPlan(threadId);
  const prompt = thread.prompt.trim();
  if (!prompt) {
    throw new Error("没有可重试的需求内容。");
  }

  if (thread.status === "awaiting_plan" && pending) {
    updateThread(threadId, { status: "running", message: "正在重试执行…" });
    emitThreadEvent(threadId, "thread.retry", "正在重试执行计划…", "system");
    void runCodingThreadExecution(threadId, runtimeConfig);
    return { thread: conversationStore.getThread(threadId) ?? thread };
  }

  if (thread.status !== "failed" && thread.status !== "blocked") {
    throw new Error("当前状态不支持重试，请发送新消息继续。");
  }

  const workspace = await ensureWorkspace(thread.workspacePath);
  const intent = classifyThreadIntent(prompt);
  conversationStore.clearCoderTodos(threadId);
  updateThread(threadId, {
    status: "running",
    message: intent === "question" ? "正在重试回答…" : "正在重试分析并制定计划…",
  });
  emitThreadEvent(
    threadId,
    "thread.retry",
    intent === "question" ? "正在重试回答…" : "正在重试分析并制定计划…",
    "system",
  );
  emitTodoList(threadId, []);

  const updated: ThreadSummary = {
    ...thread,
    status: "running",
    message: intent === "question" ? "正在重试回答…" : "正在重试分析并制定计划…",
  };
  const worktreePlan = createWorktreePlan(workspace.path, threadId);
  const worktreeExists = await fileExists(worktreePlan.worktreePath);
  const resume = worktreeExists ? resolveResumeOptions(threadId, worktreePlan.worktreePath) : undefined;
  if (intent === "question") {
    void runQuestionThread(
      updated,
      workspace,
      runtimeConfig,
      prompt,
      worktreeExists ? worktreePlan.worktreePath : undefined,
      resume,
    );
  } else {
    void runCodingThreadPlanning(
      updated,
      workspace,
      runtimeConfig,
      prompt,
      worktreeExists ? worktreePlan : undefined,
      resume,
    );
  }
  return { thread: updated };
}

/** After a crash, SQLite may still say running while activeRuns is empty. */
function recoverOrphanedRunningThreads(): void {
  for (const thread of conversationStore.listThreads()) {
    if (thread.status !== "running" && thread.status !== "queued") {
      continue;
    }
    if (activeRuns.has(thread.id)) {
      continue;
    }
    updateThread(thread.id, {
      status: "idle",
      message: "应用已意外退出。可在本对话继续发送消息；若右侧有改动可合并到工作区。",
    });
    emitThreadEvent(thread.id, "thread.idle", "已从异常退出恢复。", "system");
  }
}

async function restoreAfterExecutionFailure(
  threadId: string,
  worktreePlan: WorktreePlan,
  reason: string,
  pendingPlan?: ThreadPendingPlan & { routesJson: string },
): Promise<void> {
  try {
    await gitWorktrees.discardWorktreeChanges(worktreePlan);
    emitThreadEvent(threadId, "worktree.restored", "已回退隔离工作树中的未批准更改。", "system");
  } catch (error) {
    console.error("Failed to restore worktree after execution failure:", error);
  }

  if (pendingPlan) {
    conversationStore.savePendingPlan(pendingPlan);
  }

  const summary =
    reason.length > 240 ? `${reason.slice(0, 237)}…` : reason;
  updateThread(threadId, {
    status: "awaiting_plan",
    message: `执行失败，已回退更改。${summary}`,
  });
  emitThreadEvent(threadId, "thread.execution_failed", summary, "system", false, {
    ...(pendingPlan && {
      plan: {
        userPrompt: pendingPlan.userPrompt,
        analysis: pendingPlan.analysis,
        plan: pendingPlan.plan,
      },
    }),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function dismissPendingPlan(threadId: string, message: string): Promise<void> {
  const active = activeRuns.get(threadId);
  if (active) {
    active.controller.abort("dismissed by user");
  }
  conversationStore.clearPendingPlan(threadId);
  await cleanupWorktreeForThread(threadId);
  updateThread(threadId, { status: "idle", message });
  emitThreadEvent(threadId, "thread.idle", message, "system");
}

function resolveWorktreePlan(
  workspacePath: string,
  threadId: string,
  worktreePath?: string,
): WorktreePlan {
  const plan = createWorktreePlan(workspacePath, threadId);
  if (worktreePath?.trim()) {
    return { ...plan, worktreePath: worktreePath.trim() };
  }
  return plan;
}

async function getWorktreeStatus(threadId: string): Promise<WorktreeStatusResult> {
  const thread = conversationStore.getThread(threadId);
  const pending = conversationStore.getPendingPlan(threadId);
  const workspacePath = pending?.workspacePath ?? thread?.workspacePath;
  if (!workspacePath) {
    return { exists: false, worktreePath: "", workspacePath: "", changedFiles: [] };
  }

  const plan = resolveWorktreePlan(
    workspacePath,
    threadId,
    pending?.worktreePath,
  );
  const exists = await fileExists(plan.worktreePath);
  if (!exists) {
    return { exists: false, worktreePath: plan.worktreePath, workspacePath, changedFiles: [] };
  }

  try {
    const changedFiles = await gitWorktrees.changedFiles(plan);
    return { exists: true, worktreePath: plan.worktreePath, workspacePath, changedFiles };
  } catch (error) {
    console.error("Failed to read worktree status:", error);
    return { exists: true, worktreePath: plan.worktreePath, workspacePath, changedFiles: [] };
  }
}

async function applyWorktreeChanges(
  plan: WorktreePlan,
): Promise<{ files: string[]; message: string; diff: string }> {
  if (!(await fileExists(plan.worktreePath))) {
    throw new Error(`找不到隔离工作树：${plan.worktreePath}`);
  }

  const { files, diff } = await gitWorktrees.collectWorktreeChanges(plan);
  if (files.length === 0) {
    return { files: [], diff: "", message: "执行完成，工作树内无相对基线的文件变更。" };
  }

  await gitWorktrees.applyWorktreeDiff(plan, diff, files);
  return {
    files,
    diff,
    message: `已合并 ${files.length} 个文件的更改到工作区（未自动提交）：${files.join(", ")}`,
  };
}

async function applyWorktreeForThread(threadId: string): Promise<WorktreeApplyResult> {
  const status = await getWorktreeStatus(threadId);
  if (!status.exists) {
    throw new Error("该对话没有可合并的隔离工作树。");
  }

  const plan = resolveWorktreePlan(status.workspacePath, threadId, status.worktreePath);
  const { files, message, diff } = await applyWorktreeChanges(plan);
  conversationStore.saveAppliedDiff(threadId, plan.workspacePath, diff, files);
  await cleanupWorktreeForThread(threadId);
  updateThread(threadId, { status: "completed", message });
  emitThreadEvent(threadId, "worktree.applied", message, "system");
  return { ok: true, files, message };
}

async function rollbackWorkspaceToThread(threadId: string): Promise<ThreadRollbackResult> {
  const target = conversationStore.getAppliedDiff(threadId);
  if (!target) {
    throw new Error("该对话没有已应用到工作区的变更记录，无法作为回滚点。");
  }

  const laterDiffs = conversationStore.listAppliedDiffsAfter(target.workspacePath, target.appliedAt);
  if (laterDiffs.length === 0) {
    const message = "当前工作区已经处于该对话之后的状态。";
    updateThread(threadId, { status: "idle", message });
    return { ok: true, revertedThreads: 0, files: [], message };
  }

  const files = new Set<string>();
  for (const record of laterDiffs) {
    if (!record.diff.trim()) {
      conversationStore.markAppliedDiffRolledBack(record.threadId);
      continue;
    }
    const result = await runGitCommand(
      ["git", "apply", "-R", "--whitespace=nowarn", "-"],
      target.workspacePath,
      { stdin: record.diff },
    );
    if (result.exitCode !== 0) {
      throw new Error(`回滚 ${record.threadId} 失败：${result.stderr || result.stdout}`);
    }
    for (const file of record.files) {
      files.add(file);
    }
    conversationStore.markAppliedDiffRolledBack(record.threadId);
  }

  const changedFiles = [...files];
  const message =
    changedFiles.length > 0
      ? `已回滚 ${laterDiffs.length} 个后续对话的变更：${changedFiles.join(", ")}`
      : `已回滚 ${laterDiffs.length} 个后续对话的变更。`;
  updateThread(threadId, { status: "idle", message });
  return { ok: true, revertedThreads: laterDiffs.length, files: changedFiles, message };
}

async function cleanupWorktreeForThread(threadId: string): Promise<void> {
  const pending = conversationStore.getPendingPlan(threadId);
  const thread = conversationStore.getThread(threadId);
  const workspacePath = pending?.workspacePath ?? thread?.workspacePath;
  if (!workspacePath) {
    return;
  }
  const plan = createWorktreePlan(workspacePath, threadId);
  await removeIsolatedWorktree(plan, threadId);
}

function buildDriverRoutes(routes: readonly AnthropicProxyResolvedRoute[]): ResolvedModelRoute[] {
  return routes.map((route) => ({
    role: route.role,
    primary: {
      id: `${route.role}:${route.provider.id}`,
      provider: "custom",
      displayName: `${route.provider.name} / ${route.modelId}`,
      baseUrl: route.provider.baseUrl,
      // Real upstream id for Claude Code; local proxy accepts alias or modelId.
      modelId: route.modelId,
      capabilities: ["messages_api", "streaming", "tool_use", "subagent_compatible"],
      enabled: route.provider.enabled,
    },
    fallbacks: [],
  }));
}

function parseStoredRoutes(routesJson: string): ResolvedModelRoute[] {
  const parsed = JSON.parse(routesJson) as ResolvedModelRoute[];
  if (!Array.isArray(parsed)) {
    throw new Error("Stored route configuration is invalid.");
  }
  return parsed;
}

function createSdkDriver(
  threadId: string,
  proxy: { apiKey: string; baseUrl: string },
  hookContextExtras?: Partial<EcoHookContext>,
): ClaudeAgentSdkDriver {
  const endpoint = localOtelReceiver.getEndpoint();
  if (!endpoint) {
    throw new Error("Local OTel receiver is not ready.");
  }
  return new ClaudeAgentSdkDriver({
    apiKey: proxy.apiKey,
    baseUrl: proxy.baseUrl,
    hookContext: {
      ...createThreadHookContext(threadId),
      ...hookContextExtras,
    },
    otel: { endpoint, threadId },
    ...(sdkSessionStore ? { sessionStore: sdkSessionStore } : {}),
  });
}

async function rebuildSdkSessionStore(localDbPath: string): Promise<void> {
  if (closeSdkSessionStore) {
    await closeSdkSessionStore();
    closeSdkSessionStore = undefined;
  }

  const config = sessionSyncStore.getSettingsWithSecrets();
  if (config.redisEnabled && config.redisUrl.trim()) {
    const connection = await createRedisSessionStore({
      url: config.redisUrl.trim(),
      ...(config.redisPassword ? { password: config.redisPassword } : {}),
      keyPrefix: config.keyPrefix,
    });
    sdkSessionStore = connection.store;
    closeSdkSessionStore = connection.close;
    process.stderr.write(`[eco] SessionStore: Redis (${config.redisUrl.trim()})\n`);
    return;
  }

  sdkSessionStore = await createSqliteSessionStore(localDbPath);
  closeSdkSessionStore = undefined;
  process.stderr.write(`[eco] SessionStore: local SQLite (${localDbPath})\n`);
}

function isSessionCapturedPayload(payload: unknown): payload is SessionCapturedPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    typeof (payload as SessionCapturedPayload).sessionId === "string" &&
    typeof (payload as SessionCapturedPayload).cwd === "string"
  );
}

function captureSdkSessionFromEvent(
  threadId: string,
  event: { type: string; payload: unknown },
  worktreePath: string,
): void {
  if (event.type !== "session.captured") {
    return;
  }
  if (isSessionCapturedPayload(event.payload)) {
    conversationStore.saveSdkSession(threadId, event.payload.sessionId, worktreePath);
  }
}

function resolveResumeOptions(threadId: string, worktreePath: string): EcoSdkResumeOptions | undefined {
  const session = conversationStore.getSdkSession(threadId);
  if (!session?.sessionId) {
    return undefined;
  }
  if (session.cwd !== worktreePath) {
    conversationStore.clearSdkSession(threadId);
    return undefined;
  }
  return { resumeSessionId: session.sessionId };
}

function resolveContinuePhase(
  thread: ThreadSummary,
  intent: "question" | "coding",
): "planning" | "execution" | "question" {
  if (intent === "question") {
    return "question";
  }
  if (conversationStore.getAppliedDiff(thread.id) || thread.status === "completed") {
    return "execution";
  }
  const activity = conversationStore.listActivityLines(thread.id);
  const executed = activity.some(
    (line) =>
      line.message.includes("子代理执行") ||
      line.message.includes("执行完成") ||
      line.message.includes("继续执行"),
  );
  if (executed) {
    return "execution";
  }
  return "planning";
}

async function runThreadContinuation(
  thread: ThreadSummary,
  workspace: WorkspaceInfo,
  runtimeConfig: RuntimeConfig,
  followUp: string,
  mode: "planning" | "execution" | "question",
  existingWorktreePlan?: WorktreePlan,
): Promise<void> {
  const worktreePlan = existingWorktreePlan ?? createWorktreePlan(workspace.path, thread.id);
  const controller = new AbortController();
  const worktreeExists = await fileExists(worktreePlan.worktreePath);
  activeRuns.set(thread.id, { controller, worktreePlan, worktreeReady: worktreeExists });

  const stopStatusRef = { current: "completed" as "completed" | "blocked" | "cancelled" };
  let stopTodosHandled = false;
  const todoTracker =
    mode === "execution"
      ? createSdkTaskTracker(
          thread.id,
          {
            listTodos: () => conversationStore.listCoderTodos(thread.id),
            replaceTodos: (todos) => conversationStore.replaceCoderTodos(thread.id, todos),
          },
          emitTodoList,
        )
      : undefined;
  const taskHookHandlers = todoTracker?.createHookHandlers(() => stopStatusRef.current);

  try {
    if (mode !== "question") {
      await fs.mkdir(path.dirname(worktreePlan.worktreePath), { recursive: true });
      if (!worktreeExists) {
        await gitWorktrees.createWorktree(worktreePlan);
      }
      activeRuns.get(thread.id)!.worktreeReady = true;
    }

    const outcome = await runThreadRequestWithAutoRetry(thread.id, controller.signal, async () => {
      const attemptProxy = await startAnthropicModelProxy(runtimeConfig.routes);
      const routes = buildDriverRoutes(attemptProxy.routes);
      const resume = resolveResumeOptions(thread.id, worktreePlan.worktreePath);
      if (!resume) {
        return { ok: false, reason: "无法恢复 SDK 会话，请重新发送完整需求。" };
      }

      try {
        const driver = createSdkDriver(thread.id, attemptProxy, {
          ...(taskHookHandlers
            ? {
                taskTracker: {
                  ...taskHookHandlers,
                  onStop(status) {
                    stopTodosHandled = true;
                    taskHookHandlers.onStop(status);
                  },
                },
                getStopTodoStatus: () => stopStatusRef.current,
              }
            : {}),
        });
        if (!driver.runQuestion && mode === "question") {
          throw new Error("Runtime driver does not support question answering.");
        }
        if (!driver.runContinuation && mode === "execution") {
          throw new Error("Runtime driver does not support session continuation.");
        }

        let sdkFailure: string | undefined;
        let planCaptured = false;
        const runInput = {
          threadId: thread.id,
          prompt: followUp,
          workspacePath: workspace.path,
          worktreePath: worktreePlan.worktreePath,
          routes,
          signal: controller.signal,
          sdkSession: buildSdkSessionOptions(),
          resume,
        };

        const eventStream =
          mode === "planning"
            ? driver.run(runInput)
            : mode === "question"
              ? driver.runQuestion!(runInput)
              : driver.runContinuation!(runInput, mode);

        for await (const event of eventStream) {
          if (event.type === "usage.recorded") {
            sdkFailure = extractSdkRunFailure(event.payload) ?? sdkFailure;
            emitUsageFromDriverEvent(thread.id, event);
            continue;
          }
          captureSdkSessionFromEvent(thread.id, event, worktreePlan.worktreePath);
          if (event.type === "plan.ready" && isPlanReadyPayload(event.payload)) {
            planCaptured = true;
            conversationStore.savePendingPlan({
              threadId: thread.id,
              userPrompt: event.payload.userPrompt,
              analysis: event.payload.analysis,
              plan: event.payload.plan,
              workspacePath: workspace.path,
              worktreePath: worktreePlan.worktreePath,
              routesJson: JSON.stringify(routes),
            });
            emitThreadEvent(
              thread.id,
              "thread.awaiting_plan",
              "计划已生成，请确认是否执行。",
              "planner",
              false,
              {
                plan: {
                  userPrompt: event.payload.userPrompt,
                  analysis: event.payload.analysis,
                  plan: event.payload.plan,
                },
              },
            );
          }
          if (event.type === "todo.updated" && todoTracker && isSdkTodoProgressPayload(event.payload)) {
            todoTracker.handleTaskProgress(event.payload);
          }
          emitSdkStreamActivity(thread.id, event);
        }

        if (controller.signal.aborted) {
          return { ok: false, reason: "cancelled by user", aborted: true };
        }
        if (sdkFailure) {
          return { ok: false, reason: sdkFailure };
        }
        if (mode === "planning" && !planCaptured) {
          return { ok: false, reason: "未能生成可执行的计划。" };
        }
        return { ok: true };
      } catch (error) {
        if (controller.signal.aborted) {
          return { ok: false, reason: "cancelled by user", aborted: true };
        }
        return { ok: false, reason: errorMessage(error) };
      } finally {
        await attemptProxy.close();
      }
    });

    if (outcome.aborted) {
      stopStatusRef.current = "cancelled";
      taskHookHandlers?.onStop("cancelled");
      updateThread(thread.id, { status: "idle", message: "已停止。" });
      return;
    }
    if (!outcome.ok) {
      stopStatusRef.current = "blocked";
      taskHookHandlers?.onStop("blocked");
      updateThread(thread.id, { status: "failed", message: outcome.reason });
      return;
    }

    if (mode === "execution") {
      taskHookHandlers?.onStop("completed");
      updateThread(thread.id, {
        status: "idle",
        message: "代理执行完成，正在合并工作树更改…",
      });
      try {
        const { files, message, diff } = await applyWorktreeChanges(worktreePlan);
        conversationStore.saveAppliedDiff(thread.id, worktreePlan.workspacePath, diff, files);
        updateThread(thread.id, { status: "completed", message });
        emitThreadEvent(thread.id, "worktree.applied", message, "system");
        await cleanupWorktreeForThread(thread.id);
      } catch (applyError) {
        const detail = errorMessage(applyError);
        updateThread(thread.id, {
          status: "completed",
          message: `执行已完成，但未能合并到工作区：${detail}`,
        });
      }
      return;
    }

    if (mode === "question") {
      updateThread(thread.id, { status: "completed", message: "回答完成。" });
      scheduleThreadTitleSummary(thread.id, followUp, runtimeConfig);
      return;
    }

    if (mode === "planning") {
      updateThread(thread.id, { status: "idle", message: "计划阶段已结束。" });
      return;
    }

    updateThread(thread.id, { status: "idle", message: "续聊已结束。" });
  } catch (error) {
    stopStatusRef.current = "blocked";
    taskHookHandlers?.onStop("blocked");
    updateThread(thread.id, { status: "failed", message: errorMessage(error) });
  } finally {
    cancelClarificationsForThread(thread.id, "run finished");
    sdkStreamBridge.resetThread(thread.id);
    activeRuns.delete(thread.id);
    const currentThread = conversationStore.getThread(thread.id);
    if (currentThread?.status === "running") {
      updateThread(thread.id, {
        status: "idle",
        message: currentThread.message || "续聊已结束。",
      });
    }
  }
}

/** OTel does not stream assistant text; SDK drives narrative, tool, and todo activity. */
function emitSdkStreamActivity(threadId: string, event: AgentEventLike): void {
  sdkStreamBridge.handleEvent(threadId, event, (id, type, message, role, stream) => {
    emitThreadEvent(id, type, message, role as AgentRole | "system" | "thinking" | "tool" | "user", stream);
  });
}

function emitOtelActivity(line: OtelActivityLine): void {
  if (line.role === "tool" && sdkStreamBridge.shouldSuppressOtelToolLine(line.threadId, line.message)) {
    return;
  }
  emitThreadEvent(line.threadId, "otel.activity", line.message, line.role, line.stream ?? false);
}

function emitOtelUsage(usage: OtelUsageUpdate): void {
  void processUsageBilling({
    threadId: usage.threadId,
    role: normalizeBillingRole(usage.role),
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheCreationTokens: usage.cacheCreationTokens ?? 0,
    ...(usage.costUsd !== undefined && { otelCostUsd: usage.costUsd }),
    ...(usage.modelId && { modelId: usage.modelId }),
  }).catch((error) => {
    process.stderr.write(`[eco] usage billing failed: ${errorMessage(error)}\n`);
  });
}

function normalizeBillingRole(role: OtelUsageUpdate["role"]): AgentRole {
  if (role === "system" || role === "thinking" || role === "tool") {
    return "planner";
  }
  if (AGENT_ROLES.includes(role as AgentRole)) {
    return role as AgentRole;
  }
  return "planner";
}

async function processUsageBilling(input: {
  threadId: string;
  role: AgentRole;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  otelCostUsd?: number;
  modelId?: string;
}): Promise<void> {
  await pricingCatalogReady;

  const delta = {
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    cacheReadTokens: input.cacheReadTokens,
    cacheCreationTokens: input.cacheCreationTokens,
    ...(input.modelId && { modelId: input.modelId }),
  };

  if (
    delta.inputTokens === 0 &&
    delta.outputTokens === 0 &&
    delta.cacheReadTokens === 0 &&
    delta.cacheCreationTokens === 0 &&
    input.otelCostUsd === undefined
  ) {
    return;
  }

  const settings = providerStore.getSettings();
  const providers = providerStore.listProvidersWithSecrets();
  const runtimeRoutes = resolveRuntimeRoutesFromSettings(settings, providers);
  const usageRoute = resolveUsageRoute(input.role, input.modelId, runtimeRoutes);
  const plannerRoute = runtimeRoutes.find((route) => route.role === "planner");

  const actualLookup = usageRoute
    ? await pricingCache.lookup(usageRoute.provider.baseUrl, usageRoute.modelId)
    : null;
  const plannerLookup = plannerRoute
    ? await pricingCache.lookup(plannerRoute.provider.baseUrl, plannerRoute.modelId)
    : null;

  const requestKey = buildUsageRequestKey({
    role: input.role,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    cacheReadTokens: input.cacheReadTokens,
    cacheCreationTokens: input.cacheCreationTokens,
    ...(input.modelId && { modelId: input.modelId }),
  });

  const plannerModelLabel = buildPlannerModelLabel(
    plannerRoute,
    plannerLookup?.displayName ?? plannerRoute?.modelId,
  );

  const resolvedModelId = usageRoute?.modelId ?? input.modelId;

  const billing = threadUsageAccumulator.recordUsage({
    threadId: input.threadId,
    role: input.role,
    delta,
    ...(input.otelCostUsd !== undefined && { otelCostUsd: input.otelCostUsd }),
    actualRates: actualLookup?.rates ?? null,
    plannerRates: plannerLookup?.rates ?? null,
    ...(resolvedModelId && { modelId: resolvedModelId }),
    requestKey,
    ...(plannerModelLabel && { plannerModelLabel }),
  });

  const parsed = {
    inputTokens: delta.inputTokens,
    outputTokens: delta.outputTokens,
    cacheReadTokens: delta.cacheReadTokens,
    cacheCreationTokens: delta.cacheCreationTokens,
    ...(input.modelId && { modelId: input.modelId }),
  };

  const snapshot: ThreadUsageSnapshot = {
    inputTokens: parsed.inputTokens,
    outputTokens: parsed.outputTokens,
    cacheReadTokens: parsed.cacheReadTokens,
    cacheCreationTokens: parsed.cacheCreationTokens,
    contextTokens: estimateContextTokens(parsed),
    ...(parsed.modelId && { modelId: parsed.modelId }),
  };

  emitThreadEvent(input.threadId, "thread.usage_updated", formatUsageBadge(parsed), input.role, false, {
    usage: snapshot,
    totalCostUsd: billing.otelCostUsd,
    billing,
    ...(parsed.modelId && { modelId: parsed.modelId }),
  });
}

function buildSdkSessionOptions(): EcoSdkSessionOptions {
  const mcp = mcpStore.buildSdkConfig();
  const assignments = agentSkillsStore.getAssignments();
  return {
    settingSources: ["user", "project"],
    skills: assignments.planner,
    agentSkills: assignments,
    mcpServers: mcp.mcpServers,
    mcpAllowedTools: mcp.allowedTools,
  };
}

function isAgentSkillAssignments(value: unknown): value is AgentSkillAssignments {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return AGENT_ROLES.every((role) => {
    const skills = record[role];
    return Array.isArray(skills) && skills.every((entry) => typeof entry === "string");
  });
}

function isSdkTodoProgressPayload(payload: unknown): payload is SdkTodoUpdatedPayload {
  return typeof payload === "object" && payload !== null && "sdkKind" in payload;
}

function isPlanReadyPayload(payload: unknown): payload is PlanReadyPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "userPrompt" in payload &&
    "analysis" in payload &&
    "plan" in payload &&
    typeof (payload as PlanReadyPayload).plan === "string"
  );
}

async function removeIsolatedWorktree(plan: WorktreePlan, threadId: string): Promise<void> {
  try {
    await gitWorktrees.removeWorktree(plan);
    emitThreadEvent(threadId, "worktree.removed", "已清理隔离工作树。", "system");
  } catch (error) {
    console.error("Failed to remove worktree:", error);
  }
}

async function runGitCommand(
  command: string[],
  cwd: string,
  options?: { stdin?: string },
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = execFile(
      command[0] === "git" ? resolveGitExecutable() : (command[0] ?? resolveGitExecutable()),
      command.slice(1),
      { cwd, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const failed = error as NodeJS.ErrnoException & { code?: number };
          resolve({
            exitCode: typeof failed.code === "number" ? failed.code : 1,
            stdout: String(stdout ?? ""),
            stderr: String(stderr ?? errorMessage(error)),
          });
          return;
        }
        resolve({ exitCode: 0, stdout: String(stdout), stderr: String(stderr) });
      },
    );
    if (options?.stdin !== undefined) {
      child.stdin?.end(options.stdin);
    } else {
      child.stdin?.end();
    }
  });
}

function updateThread(threadId: string, patch: Pick<ThreadSummary, "message" | "status">): void {
  if (!conversationStore.getThread(threadId)) {
    return;
  }

  conversationStore.updateThread(threadId, patch);
  emitThreadEvent(threadId, `thread.${patch.status}`, patch.message, "system");
}

function emitTodoList(threadId: string, todoList: CoderTodoItem[]): void {
  emitThreadEvent(threadId, "thread.todos_updated", "TODO 已更新", "system", false, {
    todoList,
  });
}

function emitUsageFromDriverEvent(threadId: string, event: AgentEventLike): void {
  if (event.type !== "usage.recorded") {
    return;
  }
  const parsed = parseUsagePayload(event.payload);
  if (!parsed) {
    return;
  }
  const role: AgentRole =
    event.role && AGENT_ROLES.includes(event.role) ? event.role : "planner";

  void processUsageBilling({
    threadId,
    role,
    inputTokens: parsed.inputTokens,
    outputTokens: parsed.outputTokens,
    cacheReadTokens: parsed.cacheReadTokens,
    cacheCreationTokens: parsed.cacheCreationTokens,
    ...(parsed.modelId && { modelId: parsed.modelId }),
  }).catch((error) => {
    process.stderr.write(`[eco] sdk usage billing failed: ${errorMessage(error)}\n`);
  });
}

function emitThreadEvent(
  threadId: string,
  type: string,
  message: string,
  role: AgentRole | "system" | "thinking" | "tool" | "user" = "system",
  stream = false,
  extras?: {
    plan?: ThreadLiveEvent["plan"];
    clarification?: ThreadLiveEvent["clarification"];
    todoList?: ThreadLiveEvent["todoList"];
    title?: ThreadLiveEvent["title"];
    usage?: ThreadUsageSnapshot;
    modelId?: string;
    totalCostUsd?: number;
    modelUsage?: Record<string, ThreadModelUsageEntry>;
    billing?: ThreadBillingSnapshot;
  },
): void {
  const trimmed = message.trim();
  const isThreadStatusEvent = type.startsWith("thread.");
  const isUsageEvent = type === "thread.usage_updated";
  const allowEmptyStream = stream && trimmed.length === 0;
  if (
    !trimmed &&
    !allowEmptyStream &&
    !extras?.plan &&
    !extras?.clarification &&
    !isThreadStatusEvent &&
    !isUsageEvent
  ) {
    return;
  }

  const displayMessage = trimmed || (isThreadStatusEvent ? "状态已更新" : "");

  if (
    conversationStore.getThread(threadId) &&
    (displayMessage || allowEmptyStream) &&
    !extras?.todoList &&
    !extras?.title &&
    !isUsageEvent
  ) {
    conversationStore.appendActivityLine(threadId, {
      role: String(role),
      message: displayMessage,
      stream,
    });
  }

  const payload: ThreadLiveEvent = {
    threadId,
    type,
    message: displayMessage || (extras?.plan ? "计划已就绪" : "状态已更新"),
    role,
    stream,
  };
  if (extras?.plan) {
    payload.plan = extras.plan;
  }
  if (extras?.clarification) {
    payload.clarification = extras.clarification;
  }
  if (extras?.todoList) {
    payload.todoList = extras.todoList;
  }
  if (extras?.title) {
    payload.title = extras.title;
  }
  if (extras?.usage) {
    payload.usage = extras.usage;
  }
  if (extras?.modelId) {
    payload.modelId = extras.modelId;
  }
  if (extras?.totalCostUsd !== undefined) {
    payload.totalCostUsd = extras.totalCostUsd;
  }
  if (extras?.modelUsage) {
    payload.modelUsage = extras.modelUsage;
  }
  if (extras?.billing) {
    payload.billing = extras.billing;
  }

  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send(IPC_CHANNELS.threadEventsSubscribe, payload);
  });
}

function recordUserPrompt(threadId: string, prompt: string): void {
  emitThreadEvent(threadId, "thread.user_prompt", prompt, "user");
}

function createThreadHookContext(threadId: string): EcoHookContext {
  return {
    askUserQuestion: async (parsed) => {
      updateThread(threadId, { status: "running", message: "等待你的回答…" });
      const clarificationRequest: ThreadLiveEvent["clarification"] = {
        toolUseId: parsed.toolUseId,
        threadId,
        questions: parsed.questions,
      };
      emitThreadEvent(threadId, "clarification.requested", "Planner 需要你回答几个问题。", "planner", false, {
        clarification: clarificationRequest,
      });
      const answers = await registerPendingClarification(threadId, parsed.toolUseId, parsed);
      updateThread(threadId, { status: "running", message: "正在分析并制定计划…" });
      emitThreadEvent(
        threadId,
        "clarification.answered",
        formatClarificationAnswersSummary(
          { toolUseId: parsed.toolUseId, threadId, questions: parsed.questions },
          answers,
        ),
        "planner",
        false,
      );
      return buildAskUserQuestionUpdatedInput(
        { toolUseId: parsed.toolUseId, threadId, questions: parsed.questions },
        answers,
        parsed.rawInput,
      );
    },
    resolveChangedFiles: async () => {
      const run = activeRuns.get(threadId);
      if (!run?.worktreePlan) {
        return [];
      }
      try {
        return await gitWorktrees.changedFiles(run.worktreePlan);
      } catch (error) {
        console.error("Failed to list worktree files for reviewer scope:", error);
        return [];
      }
    },
    onNotification: ({ message, notificationType }) => {
      if (notificationType === "permission_prompt") {
        updateThread(threadId, { status: "running", message: "等待工具权限确认…" });
        return;
      }
      if (notificationType === "idle_prompt") {
        updateThread(threadId, { status: "running", message: message.trim() || "Agent 等待输入…" });
      }
    },
  };
}

function isClarificationSubmitPayload(value: unknown): value is ClarificationSubmitPayload {
  if (!value || typeof value !== "object") {
    return false;
  }
  const payload = value as ClarificationSubmitPayload;
  return (
    typeof payload.toolUseId === "string" &&
    payload.toolUseId.trim().length > 0 &&
    Array.isArray(payload.selections)
  );
}

function emitSettingsUpdated(): void {
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send(IPC_CHANNELS.threadEventsSubscribe, {
      threadId: "settings",
      type: "settings.updated",
      message: "Model provider settings saved.",
    });
  });
}

interface RuntimeRoute {
  role: AgentRole;
  provider: ProviderConfigSecret;
  modelId: string;
}

interface RuntimeConfig {
  routes: RuntimeRoute[];
}

type RuntimeConfigResolution = { ok: true; routes: RuntimeRoute[] } | { ok: false; reason: string };

function resolveRuntimeConfig(
  settings: ModelSettingsSnapshot,
  providersWithSecrets: ProviderConfigSecret[],
): RuntimeConfigResolution {
  const providersById = new Map(providersWithSecrets.map((provider) => [provider.id, provider]));
  const routes = settings.routes.map((route): RuntimeRoute | undefined => {
    const provider = providersById.get(route.providerId);
    if (!provider) return undefined;
    return { role: route.role, provider, modelId: route.modelId };
  });

  const missingRoute = settings.routes.find((route) => !providersById.has(route.providerId));
  if (missingRoute) {
    return { ok: false, reason: `Route ${missingRoute.role} references a missing provider.` };
  }

  for (const role of AGENT_ROLES) {
    const route = routes.find((candidate): candidate is RuntimeRoute => candidate?.role === role);
    if (!route) {
      return { ok: false, reason: `Configure a ${role} route before starting a coding thread.` };
    }
    if (!route.modelId.trim()) {
      return { ok: false, reason: `Model id is required for ${role}.` };
    }
    if (!route.provider.enabled) {
      return { ok: false, reason: `Provider "${route.provider.name}" for ${role} is disabled.` };
    }
    if (!route.provider.apiKey) {
      return { ok: false, reason: `Provider "${route.provider.name}" for ${role} is missing an API key.` };
    }
  }

  return {
    ok: true,
    routes: routes.filter((route): route is RuntimeRoute => Boolean(route)),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
