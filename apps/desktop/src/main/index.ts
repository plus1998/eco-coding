import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  ClaudeAgentSdkDriver,
  extractSdkRunFailure,
  formatAgentEventDisplay,
  type EcoPlanningContext,
  type EcoSdkSessionOptions,
  type PlanReadyPayload,
} from "@eco/runtime";
import type { ResolvedModelRoute } from "../../../packages/model-router/src/index.ts";
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
  type ThreadContinueRequest,
  type ThreadContinueResult,
  type ThreadLiveEvent,
  type ThreadPendingPlan,
  type ThreadStartRequest,
  type ThreadSummary,
  type WorktreeApplyResult,
  type WorktreeStatusResult,
  type WorkspaceInfo,
} from "../shared/ipc";
import { createConversationStore, type ConversationStore } from "./conversation-store";
import { startAnthropicModelProxy, type AnthropicProxyResolvedRoute } from "./anthropic-proxy";
import { getUpstreamLogFilePath } from "./upstream-log";
import { createMcpStore, type McpStore } from "./mcp-store";
import { listDiscoveredSkills } from "./skills-discovery";
import { listProviderUpstreamModels } from "./provider-models";
import { createProviderStore, type ProviderConfigSecret, type ProviderStore } from "./provider-store";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.VITE_DEV_SERVER_URL !== undefined;
const execFileAsync = promisify(execFile);
const gitRunner: CommandRunner = {
  run: runGitCommand,
};
const gitWorktrees = new GitWorktreeService(gitRunner);
let currentWorkspace: WorkspaceInfo | undefined;
let providerStore: ProviderStore;
let mcpStore: McpStore;
let conversationStore: ConversationStore;

interface ActiveThreadRun {
  controller: AbortController;
  worktreePlan: WorktreePlan;
  worktreeReady: boolean;
}

const activeRuns = new Map<string, ActiveThreadRun>();

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

  ipcMain.handle(IPC_CHANNELS.threadList, async () => conversationStore.listThreads());

  ipcMain.handle(IPC_CHANNELS.threadActivityList, async (_event, threadId: string) => {
    if (typeof threadId !== "string" || !threadId.trim()) {
      return [];
    }
    return conversationStore.listActivityLines(threadId);
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
    const status: ThreadSummary["status"] = runtimeConfig.ok ? "running" : "blocked";
    const thread: ThreadSummary = {
      id: `thr_${Date.now()}`,
      title: promptToTitle(prompt),
      prompt,
      workspacePath: workspace.path,
      status,
      createdAt: new Date().toISOString(),
      message: runtimeConfig.ok
        ? "Creating isolated worktree and starting Claude Agent SDK."
        : runtimeConfig.reason,
    };

    conversationStore.saveThread(thread);
    emitThreadEvent(thread.id, status === "blocked" ? "thread.blocked" : "thread.started", thread.message);

    if (runtimeConfig.ok) {
      void runCodingThreadPlanning(thread, workspace, runtimeConfig, prompt);
    }

    return { thread };
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

  ipcMain.handle(IPC_CHANNELS.threadApprovePlan, async (_event, threadId: unknown) => {
    if (typeof threadId !== "string" || !threadId.trim()) {
      throw new Error("Thread id is required.");
    }
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

    const runtimeConfig = resolveRuntimeConfig(
      providerStore.getSettings(),
      providerStore.listProvidersWithSecrets(),
    );
    if (!runtimeConfig.ok) {
      throw new Error(runtimeConfig.reason);
    }

    updateThread(threadId, {
      status: "running",
      message: "正在按计划执行…",
    });
    void runCodingThreadExecution(threadId, runtimeConfig);
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

    conversationStore.updateThreadPrompt(payload.threadId, prompt);
    updateThread(payload.threadId, {
      status: "running",
      message: "正在分析并制定计划…",
    });

    const updated: ThreadSummary = {
      ...thread,
      prompt,
      status: "running",
      message: "正在分析并制定计划…",
    };
    void runCodingThreadPlanning(updated, workspace, runtimeConfig, prompt);
    return { thread: updated } satisfies ThreadContinueResult;
  });

  ipcMain.handle(IPC_CHANNELS.threadCancel, async (_event, threadId: unknown) => {
    if (typeof threadId !== "string" || !threadId.trim()) {
      return;
    }
    const active = activeRuns.get(threadId);
    if (active) {
      active.controller.abort("cancelled by user");
      return;
    }
    const thread = conversationStore.getThread(threadId);
    if (thread?.status === "awaiting_plan") {
      await dismissPendingPlan(threadId, "已取消。");
    }
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

async function inspectWorkspace(workspacePath: string): Promise<WorkspaceInfo> {
  const gitRoot = await runGit(workspacePath, ["rev-parse", "--show-toplevel"]);
  const branch = gitRoot.ok ? await runGit(workspacePath, ["branch", "--show-current"]) : undefined;
  const status = gitRoot.ok ? await runGit(workspacePath, ["status", "--short"]) : undefined;

  const workspace: WorkspaceInfo = {
    path: workspacePath,
    name: path.basename(workspacePath),
    isGitRepository: gitRoot.ok,
    dirtyFileCount: status?.ok ? status.stdout.split("\n").filter(Boolean).length : 0,
  };

  if (gitRoot.ok) workspace.gitRoot = gitRoot.stdout;
  if (branch?.ok) workspace.branch = branch.stdout || "detached";

  const packageManager = await detectPackageManager(workspacePath);
  if (packageManager) workspace.packageManager = packageManager;

  return workspace;
}

async function runGit(cwd: string, args: string[]): Promise<{ ok: true; stdout: string } | { ok: false }> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd });
    return { ok: true, stdout: stdout.trim() };
  } catch {
    return { ok: false };
  }
}

async function detectPackageManager(workspacePath: string): Promise<WorkspaceInfo["packageManager"]> {
  const candidates: Array<[WorkspaceInfo["packageManager"], string]> = [
    ["bun", "bun.lock"],
    ["pnpm", "pnpm-lock.yaml"],
    ["yarn", "yarn.lock"],
    ["npm", "package-lock.json"],
  ];

  for (const [manager, fileName] of candidates) {
    if (await fileExists(path.join(workspacePath, fileName))) {
      return manager;
    }
  }
  return undefined;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function promptToTitle(prompt: string): string {
  const firstLine = prompt.split("\n").find(Boolean)?.trim() ?? "New coding task";
  return firstLine.length > 42 ? `${firstLine.slice(0, 39)}...` : firstLine;
}

async function runCodingThreadPlanning(
  thread: ThreadSummary,
  workspace: WorkspaceInfo,
  runtimeConfig: RuntimeConfig,
  prompt: string,
): Promise<void> {
  const worktreePlan = createWorktreePlan(workspace.path, thread.id);
  const controller = new AbortController();
  activeRuns.set(thread.id, { controller, worktreePlan, worktreeReady: false });

  try {
    await fs.mkdir(path.dirname(worktreePlan.worktreePath), { recursive: true });
    await gitWorktrees.createWorktree(worktreePlan);
    activeRuns.get(thread.id)!.worktreeReady = true;
    updateThread(thread.id, {
      message: `Isolated worktree ready: ${worktreePlan.worktreePath}`,
      status: "running",
    });

    const modelProxy = await startAnthropicModelProxy(runtimeConfig.routes);
    process.stderr.write(
      `[eco] 模型代理: ${modelProxy.baseUrl} · 上游日志: ${getUpstreamLogFilePath()}\n`,
    );
    updateThread(thread.id, {
      message: `Local model router ready: ${modelProxy.baseUrl}`,
      status: "running",
    });

    const routes = buildDriverRoutes(modelProxy.routes);
    const plannerRoute = modelProxy.routes.find((route) => route.role === "planner");
    process.stderr.write(
      `[eco] SDK model=${plannerRoute?.modelId ?? "?"} (proxy ${modelProxy.baseUrl}, alias ${plannerRoute?.aliasModelId ?? "?"})\n`,
    );
    let planCaptured = false;

    try {
      const driver = new ClaudeAgentSdkDriver({
        apiKey: modelProxy.apiKey,
        baseUrl: modelProxy.baseUrl,
      });

      for await (const event of driver.run({
        threadId: thread.id,
        prompt,
        workspacePath: workspace.path,
        worktreePath: worktreePlan.worktreePath,
        routes,
        signal: controller.signal,
        sdkSession: buildSdkSessionOptions(),
      })) {
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
              userPrompt: event.payload.userPrompt,
              analysis: event.payload.analysis,
              plan: event.payload.plan,
            },
          );
        }

        const display = formatAgentEventDisplay(event);
        if (display) {
          emitThreadEvent(thread.id, event.type, display.message, display.role, display.stream);
        }
      }
    } finally {
      await modelProxy.close();
    }

    if (controller.signal.aborted) {
      updateThread(thread.id, { status: "idle", message: "已取消。" });
      await cleanupWorktreeForThread(thread.id);
      return;
    }

    if (planCaptured) {
      updateThread(thread.id, {
        status: "awaiting_plan",
        message: "等待你确认计划。",
      });
      return;
    }

    updateThread(thread.id, {
      status: "failed",
      message: "未能生成可执行的计划。",
    });
    await cleanupWorktreeForThread(thread.id);
  } catch (error) {
    updateThread(thread.id, {
      status: "failed",
      message: errorMessage(error),
    });
    await cleanupWorktreeForThread(thread.id);
  } finally {
    activeRuns.delete(thread.id);
  }
}

async function runCodingThreadExecution(threadId: string, runtimeConfig: RuntimeConfig): Promise<void> {
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
  };

  const worktreePlan = resolveWorktreePlan(pending.workspacePath, threadId, pending.worktreePath);
  const controller = new AbortController();
  activeRuns.set(threadId, { controller, worktreePlan, worktreeReady: true });

  let executionFailure: string | undefined;

  try {
    const modelProxy = await startAnthropicModelProxy(runtimeConfig.routes);
    process.stderr.write(
      `[eco] 模型代理: ${modelProxy.baseUrl} · 上游日志: ${getUpstreamLogFilePath()}\n`,
    );
    const routes = buildDriverRoutes(modelProxy.routes);
    conversationStore.savePendingPlan({
      ...pending,
      routesJson: JSON.stringify(routes),
    });

    try {
      const driver = new ClaudeAgentSdkDriver({
        apiKey: modelProxy.apiKey,
        baseUrl: modelProxy.baseUrl,
      });

      if (!driver.runExecution) {
        throw new Error("Runtime driver does not support execution phase.");
      }

      for await (const event of driver.runExecution(
        {
          threadId,
          prompt: pending.userPrompt,
          workspacePath: pending.workspacePath,
          worktreePath: pending.worktreePath,
          routes,
          signal: controller.signal,
          sdkSession: buildSdkSessionOptions(),
        },
        planning,
      )) {
        const failure = extractSdkRunFailure(event.payload);
        if (failure) {
          executionFailure = failure;
        }

        const display = formatAgentEventDisplay(event);
        if (display) {
          emitThreadEvent(threadId, event.type, display.message, display.role, display.stream);
        }
      }
    } finally {
      await modelProxy.close();
    }

    if (controller.signal.aborted) {
      await restoreAfterExecutionFailure(threadId, worktreePlan, "执行已取消。");
      return;
    }

    if (executionFailure) {
      await restoreAfterExecutionFailure(threadId, worktreePlan, executionFailure);
      return;
    }

    conversationStore.clearPendingPlan(threadId);

    try {
      const { files, message } = await applyWorktreeChanges(worktreePlan);
      updateThread(threadId, { status: "completed", message });
      emitThreadEvent(threadId, "worktree.applied", message, "system");
      process.stderr.write(`[eco] worktree apply ok (${files.length} files): ${files.join(", ")}\n`);
    } catch (applyError) {
      const detail = errorMessage(applyError);
      process.stderr.write(`[eco] worktree apply failed: ${detail}\n`);
      updateThread(threadId, {
        status: "awaiting_plan",
        message: `执行已完成，但未能合并到工作区：${detail}。可点击「应用到工作区」重试，或手动处理 ${worktreePlan.worktreePath}。`,
      });
      emitThreadEvent(threadId, "worktree.apply_failed", detail, "system");
      return;
    }

    await cleanupWorktreeForThread(threadId);
  } catch (error) {
    await restoreAfterExecutionFailure(threadId, worktreePlan, errorMessage(error));
  } finally {
    activeRuns.delete(threadId);
  }
}

async function restoreAfterExecutionFailure(
  threadId: string,
  worktreePlan: WorktreePlan,
  reason: string,
): Promise<void> {
  try {
    await gitWorktrees.discardWorktreeChanges(worktreePlan);
    emitThreadEvent(threadId, "worktree.restored", "已回退隔离工作树中的未批准更改。", "system");
  } catch (error) {
    console.error("Failed to restore worktree after execution failure:", error);
  }

  const summary =
    reason.length > 240 ? `${reason.slice(0, 237)}…` : reason;
  updateThread(threadId, {
    status: "awaiting_plan",
    message: `执行失败，已回退更改。${summary}`,
  });
  emitThreadEvent(threadId, "thread.execution_failed", summary, "system");
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

async function applyWorktreeChanges(plan: WorktreePlan): Promise<{ files: string[]; message: string }> {
  if (!(await fileExists(plan.worktreePath))) {
    throw new Error(`找不到隔离工作树：${plan.worktreePath}`);
  }

  const files = await gitWorktrees.changedFiles(plan);
  if (files.length === 0) {
    return { files: [], message: "执行完成，工作树内无相对基线的文件变更。" };
  }

  await gitWorktrees.applyApprovedDiff(plan);
  return {
    files,
    message: `已合并 ${files.length} 个文件的更改到工作区（未自动提交）：${files.join(", ")}`,
  };
}

async function applyWorktreeForThread(threadId: string): Promise<WorktreeApplyResult> {
  const status = await getWorktreeStatus(threadId);
  if (!status.exists) {
    throw new Error("该对话没有可合并的隔离工作树。");
  }

  const plan = resolveWorktreePlan(status.workspacePath, threadId, status.worktreePath);
  const { files, message } = await applyWorktreeChanges(plan);
  await cleanupWorktreeForThread(threadId);
  updateThread(threadId, { status: "completed", message });
  emitThreadEvent(threadId, "worktree.applied", message, "system");
  return { ok: true, files, message };
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

function buildSdkSessionOptions(): EcoSdkSessionOptions {
  const mcp = mcpStore.buildSdkConfig();
  return {
    settingSources: ["user", "project"],
    skills: "all",
    mcpServers: mcp.mcpServers,
    mcpAllowedTools: mcp.allowedTools,
  };
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
  try {
    const { stdout, stderr } = await execFileAsync(command[0] ?? "git", command.slice(1), {
      cwd,
      input: options?.stdin,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { exitCode: 0, stdout: String(stdout), stderr: String(stderr) };
  } catch (error) {
    const failed = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    return {
      exitCode: typeof failed.code === "number" ? failed.code : 1,
      stdout: String(failed.stdout ?? ""),
      stderr: String(failed.stderr ?? errorMessage(error)),
    };
  }
}

function updateThread(threadId: string, patch: Pick<ThreadSummary, "message" | "status">): void {
  if (!conversationStore.getThread(threadId)) {
    return;
  }

  conversationStore.updateThread(threadId, patch);
  emitThreadEvent(threadId, `thread.${patch.status}`, patch.message, "system");
}

function emitThreadEvent(
  threadId: string,
  type: string,
  message: string,
  role: AgentRole | "system" | "thinking" | "tool" = "system",
  stream = false,
  plan?: ThreadLiveEvent["plan"],
): void {
  const trimmed = message.trim();
  if (!trimmed && !plan) {
    return;
  }

  if (conversationStore.getThread(threadId) && trimmed) {
    conversationStore.appendActivityLine(threadId, {
      role: String(role),
      message: trimmed,
      stream,
    });
  }

  const payload: ThreadLiveEvent = {
    threadId,
    type,
    message: trimmed || "计划已就绪",
    role,
    stream,
  };
  if (plan) {
    payload.plan = plan;
  }

  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send(IPC_CHANNELS.threadEventsSubscribe, payload);
  });
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
