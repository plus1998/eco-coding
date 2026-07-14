import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import path from "node:path";
import {
  CodexAppServerClient,
  type CodexAppServerClientOptions,
  type CodexAppServerNotificationHandler,
  resolveCodexHomeDir,
} from "@eco/runtime";

export interface CodexRuntimeLifecycleOptions {
  ecoDataDir: string;
  codexExecutable?: string;
  clientOptions?: Omit<CodexAppServerClientOptions, "onNotification">;
  onNotification?: CodexAppServerNotificationHandler;
  onStderr?: (chunk: string) => void;
}

export class CodexRuntimeLifecycle {
  private child: ChildProcessWithoutNullStreams | undefined;
  private client: CodexAppServerClient | undefined;
  private startPromise: Promise<CodexAppServerClient> | undefined;
  private stopPromise: Promise<void> | undefined;
  private generation = 0;

  constructor(private readonly options: CodexRuntimeLifecycleOptions) {}

  get codexHomeDir(): string {
    return resolveCodexHomeDir(this.options.ecoDataDir);
  }

  isRunning(): boolean {
    return this.child !== undefined && this.client !== undefined;
  }

  getClient(): CodexAppServerClient | undefined {
    return this.client;
  }

  async start(): Promise<CodexAppServerClient> {
    if (this.stopPromise) {
      await this.stopPromise;
      return this.start();
    }
    if (this.startPromise) {
      return this.startPromise;
    }
    if (this.client) {
      return this.client;
    }
    if (this.child) {
      if (this.child.exitCode === null && this.child.signalCode === null) {
        throw new Error("Codex app-server cannot restart because the previous process has not exited.");
      }
      this.child = undefined;
    }

    const startPromise = this.spawnAndInitialize(this.generation);
    this.startPromise = startPromise;
    try {
      return await startPromise;
    } finally {
      if (this.startPromise === startPromise) {
        this.startPromise = undefined;
      }
    }
  }

  async stop(): Promise<void> {
    if (this.stopPromise) {
      return this.stopPromise;
    }
    const stopPromise = this.stopCurrentLifecycle();
    this.stopPromise = stopPromise;
    try {
      await stopPromise;
    } finally {
      if (this.stopPromise === stopPromise) {
        this.stopPromise = undefined;
      }
    }
  }

  private async stopCurrentLifecycle(): Promise<void> {
    this.generation += 1;
    const pendingStart = this.startPromise;
    const child = this.child;
    const client = this.client;
    this.client = undefined;
    this.startPromise = undefined;

    client?.close();

    if (child) {
      await terminateProcess(child);
      if (this.child === child) {
        this.child = undefined;
      }
    }

    if (pendingStart) {
      try {
        await pendingStart;
      } catch {
        // A start interrupted by stop is expected to reject after its client/process closes.
      }
    }
  }

  private async spawnAndInitialize(generation: number): Promise<CodexAppServerClient> {
    const codexHomeDir = this.codexHomeDir;
    await import("node:fs/promises").then((fs) => fs.mkdir(codexHomeDir, { recursive: true }));
    if (generation !== this.generation) {
      throw new Error("Codex app-server start was cancelled before process spawn.");
    }

    const executable =
      this.options.codexExecutable?.trim() || process.env.CODEX_EXECUTABLE?.trim() || "codex";
    const child = spawn(executable, ["app-server", "--stdio"], {
      env: {
        ...process.env,
        CODEX_HOME: codexHomeDir,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      this.options.onStderr?.(chunk);
    });

    const client = CodexAppServerClient.attachToProcess(child, {
      ...this.options.clientOptions,
      ...(this.options.onNotification ? { onNotification: this.options.onNotification } : {}),
    });

    child.on("exit", () => {
      if (this.child === child) {
        this.child = undefined;
        this.client = undefined;
      }
    });

    this.child = child;
    this.client = client;
    try {
      await client.initialize();
      if (generation !== this.generation) {
        throw new Error("Codex app-server start was cancelled during initialization.");
      }
      return client;
    } catch (error) {
      if (this.client === client) {
        this.client = undefined;
      }
      client.close();
      try {
        await terminateProcess(child);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "Codex app-server initialization failed and its process could not be stopped.",
        );
      }
      if (this.child === child) {
        this.child = undefined;
      }
      throw error;
    }
  }
}

export function resolveEcoDataCodexHome(ecoDataDir: string): string {
  return path.join(ecoDataDir, "codex");
}

function waitForProcessExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, timeoutMs);

    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };

    child.once("exit", onExit);
  });
}

async function terminateProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  child.kill("SIGTERM");
  if (await waitForProcessExit(child, 1_000)) {
    return;
  }

  child.kill("SIGKILL");
  if (await waitForProcessExit(child, 500)) {
    return;
  }

  throw new Error(`Codex app-server process ${child.pid ?? "unknown"} did not exit after SIGKILL.`);
}

let globalLifecycle: CodexRuntimeLifecycle | undefined;
let globalStopPromise: Promise<void> | undefined;

export function getGlobalCodexRuntimeLifecycle(): CodexRuntimeLifecycle | undefined {
  return globalLifecycle;
}

export function setGlobalCodexRuntimeLifecycle(lifecycle: CodexRuntimeLifecycle | undefined): void {
  globalLifecycle = lifecycle;
}

export async function ensureGlobalCodexRuntimeLifecycle(
  options: CodexRuntimeLifecycleOptions,
): Promise<CodexAppServerClient> {
  while (globalStopPromise) {
    await globalStopPromise;
  }
  if (!globalLifecycle) {
    globalLifecycle = new CodexRuntimeLifecycle(options);
  }
  return globalLifecycle.start();
}

export async function stopGlobalCodexRuntimeLifecycle(): Promise<void> {
  if (globalStopPromise) {
    return globalStopPromise;
  }
  const lifecycle = globalLifecycle;
  if (!lifecycle || typeof lifecycle.stop !== "function") {
    return;
  }

  const stopPromise = lifecycle.stop();
  globalStopPromise = stopPromise;
  try {
    await stopPromise;
    if (globalLifecycle === lifecycle) {
      globalLifecycle = undefined;
    }
  } finally {
    if (globalStopPromise === stopPromise) {
      globalStopPromise = undefined;
    }
  }
}
