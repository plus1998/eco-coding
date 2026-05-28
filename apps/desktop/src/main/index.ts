import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { ClaudeAgentSdkDriver } from "@eco/runtime";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import {
  IPC_CHANNELS,
  isKnownIpcChannel,
  type ThreadStartRequest,
  type ThreadSummary,
  type WorkspaceInfo,
} from "../shared/ipc";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.VITE_DEV_SERVER_URL !== undefined;
const execFileAsync = promisify(execFile);
const threads: ThreadSummary[] = [];
let currentWorkspace: WorkspaceInfo | undefined;

async function createMainWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1080,
    minHeight: 720,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#f7f5f1",
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

  ipcMain.handle(IPC_CHANNELS.threadList, async () => threads);

  ipcMain.handle(IPC_CHANNELS.threadStart, async (_event, payload: ThreadStartRequest) => {
    const prompt = payload.prompt.trim();
    if (!prompt) {
      throw new Error("Task prompt is required.");
    }

    const workspace = await ensureWorkspace(payload.workspacePath);
    const apiKey = process.env.ANTHROPIC_API_KEY;
    const status: ThreadSummary["status"] = apiKey ? "running" : "blocked";
    const thread: ThreadSummary = {
      id: `thr_${Date.now()}`,
      title: promptToTitle(prompt),
      prompt,
      workspacePath: workspace.path,
      status,
      createdAt: new Date().toISOString(),
      message: apiKey
        ? "Creating isolated worktree and starting Claude Agent SDK."
        : "Missing ANTHROPIC_API_KEY. Configure an Anthropic-compatible key/base URL before the coding agent can run.",
    };

    threads.unshift(thread);
    emitThreadEvent(thread.id, status === "blocked" ? "thread.blocked" : "thread.started", thread.message);

    if (apiKey) {
      void runCodingThread(thread, workspace, apiKey, prompt);
    }

    return { thread };
  });

  ipcMain.handle(IPC_CHANNELS.modelProfilesList, async () => []);

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
  apiKey: string,
  prompt: string,
): Promise<void> {
  try {
    const worktreePath = await createIsolatedWorktree(workspace.path, thread.id);
    updateThread(thread.id, {
      message: `Isolated worktree ready: ${worktreePath}`,
      status: "running",
    });

    const modelId = process.env.ANTHROPIC_MODEL ?? "sonnet";
    const baseUrl = process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com";
    const driver = new ClaudeAgentSdkDriver({
      apiKey,
      baseUrl,
      maxTurns: Number(process.env.ECO_AGENT_MAX_TURNS ?? 24),
    });

    for await (const event of driver.run({
      threadId: thread.id,
      prompt,
      workspacePath: workspace.path,
      worktreePath,
      routes: [
        {
          role: "planner",
          primary: {
            id: "planner",
            provider: "custom",
            displayName: modelId,
            baseUrl,
            modelId,
            capabilities: ["messages_api", "streaming", "tool_use", "subagent_compatible"],
            enabled: true,
          },
          fallbacks: [],
        },
      ],
      signal: new AbortController().signal,
    })) {
      emitThreadEvent(thread.id, event.type, summarizeRuntimeEvent(event.payload));
    }

    updateThread(thread.id, {
      status: "completed",
      message: "Agent run completed. Review the generated diff before applying changes.",
    });
  } catch (error) {
    updateThread(thread.id, {
      status: "failed",
      message: errorMessage(error),
    });
  }
}

async function createIsolatedWorktree(workspacePath: string, threadId: string): Promise<string> {
  const worktreePath = path.join(workspacePath, ".eco", "worktrees", threadId);
  const branchName = `eco/${threadId}`;
  await fs.mkdir(path.dirname(worktreePath), { recursive: true });
  await execFileAsync("git", ["worktree", "add", "-B", branchName, worktreePath, "HEAD"], {
    cwd: workspacePath,
  });
  return worktreePath;
}

function updateThread(threadId: string, patch: Pick<ThreadSummary, "message" | "status">): void {
  const thread = threads.find((candidate) => candidate.id === threadId);
  if (!thread) return;

  thread.status = patch.status;
  thread.message = patch.message;
  emitThreadEvent(threadId, `thread.${patch.status}`, patch.message);
}

function emitThreadEvent(threadId: string, type: string, message: string): void {
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send(IPC_CHANNELS.threadEventsSubscribe, {
      threadId,
      type,
      message,
    });
  });
}

function summarizeRuntimeEvent(payload: unknown): string {
  if (typeof payload === "string") return payload;
  if (typeof payload === "object" && payload !== null && "message" in payload) {
    return String(payload.message);
  }
  return "Agent runtime event received.";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
