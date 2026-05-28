import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { ClaudeAgentSdkDriver, formatAgentEventDisplay } from "@eco/runtime";
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
  type ModelSettingsSnapshot,
  type ProviderConfigInput,
  type RoleRouteConfig,
  type ThreadStartRequest,
  type ThreadSummary,
  type WorkspaceInfo,
} from "../shared/ipc";
import { createConversationStore, type ConversationStore } from "./conversation-store";
import { startAnthropicModelProxy } from "./anthropic-proxy";
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
let conversationStore: ConversationStore;

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

  ipcMain.handle(IPC_CHANNELS.modelRoutesSave, async (_event, payload: RoleRouteConfig[]) => {
    const routes = providerStore.saveRoleRoutes(payload);
    emitSettingsUpdated();
    return routes;
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
      void runCodingThread(thread, workspace, runtimeConfig, prompt);
    }

    return { thread };
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

async function runCodingThread(
  thread: ThreadSummary,
  workspace: WorkspaceInfo,
  runtimeConfig: RuntimeConfig,
  prompt: string,
): Promise<void> {
  const worktreePlan = createWorktreePlan(workspace.path, thread.id);
  let worktreeReady = false;

  try {
    await fs.mkdir(path.dirname(worktreePlan.worktreePath), { recursive: true });
    await gitWorktrees.createWorktree(worktreePlan);
    worktreeReady = true;
    updateThread(thread.id, {
      message: `Isolated worktree ready: ${worktreePlan.worktreePath}`,
      status: "running",
    });

    const modelProxy = await startAnthropicModelProxy(runtimeConfig.routes);
    updateThread(thread.id, {
      message: `Local model router ready: ${modelProxy.baseUrl}`,
      status: "running",
    });

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
        routes: modelProxy.routes.map((route) => ({
          role: route.role,
          primary: {
            id: `${route.role}:${route.provider.id}`,
            provider: "custom",
            displayName: `${route.provider.name} / ${route.modelId}`,
            baseUrl: route.provider.baseUrl,
            modelId: route.aliasModelId,
            capabilities: ["messages_api", "streaming", "tool_use", "subagent_compatible"],
            enabled: route.provider.enabled,
          },
          fallbacks: [],
        })),
        signal: new AbortController().signal,
      })) {
        const display = formatAgentEventDisplay(event);
        if (display) {
          emitThreadEvent(thread.id, event.type, display.message, display.role, display.stream);
        }
      }
    } finally {
      await modelProxy.close();
    }

    updateThread(thread.id, {
      status: "completed",
      message: "Agent run completed.",
    });
  } catch (error) {
    updateThread(thread.id, {
      status: "failed",
      message: errorMessage(error),
    });
  } finally {
    if (worktreeReady) {
      await removeIsolatedWorktree(worktreePlan, thread.id);
    }
  }
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
): void {
  const trimmed = message.trim();
  if (!trimmed) {
    return;
  }

  if (conversationStore.getThread(threadId)) {
    conversationStore.appendActivityLine(threadId, {
      role: String(role),
      message: trimmed,
      stream,
    });
  }

  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send(IPC_CHANNELS.threadEventsSubscribe, {
      threadId,
      type,
      message: trimmed,
      role,
      stream,
    });
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
