/**
 * Single shared MCP stdio upstream (one child process) for Eco gateways that
 * still wrap an external stdio MCP binary (e.g. open-computer-use).
 * JSON-RPC is serialized over NDJSON lines.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { createInterface, type Interface } from "node:readline";

type JsonRpcId = string | number;

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  cleanup?: () => void;
};

export class SharedMcpStdioUpstream {
  private child: ChildProcess | undefined;
  private readline: Interface | undefined;
  private readonly pending = new Map<string, Pending>();
  private nextId = 1;
  private chain: Promise<unknown> = Promise.resolve();
  private binaryPath: string | undefined;
  private launchKey: string | undefined;
  private initialized = false;

  get pid(): number | undefined {
    return this.child?.pid;
  }

  get alive(): boolean {
    return Boolean(this.child && !this.child.killed && this.child.exitCode === null);
  }

  async ensure(binaryPath: string, args: string[] = ["mcp"], env?: Record<string, string>): Promise<void> {
    const nextLaunchKey = JSON.stringify([binaryPath, args, env ?? {}]);
    if (this.alive && this.launchKey === nextLaunchKey) {
      return;
    }
    await this.close();
    this.binaryPath = binaryPath;
    this.launchKey = nextLaunchKey;
    const child = spawn(binaryPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, ...(env ?? {}) },
    });
    this.child = child;
    if (!child.stdin || !child.stdout) {
      await this.close();
      throw new Error("Shared MCP upstream requires piped stdin/stdout");
    }
    child.stderr?.on("data", (chunk: Buffer) => {
      process.stderr.write(`[eco-shared-mcp-upstream] ${chunk.toString("utf8")}`);
    });
    child.on("exit", () => {
      this.failAll(new Error("shared MCP upstream exited"));
      this.child = undefined;
      this.readline = undefined;
      this.launchKey = undefined;
      this.initialized = false;
    });
    this.readline = createInterface({ input: child.stdout, crlfDelay: Infinity });
    this.readline.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) return;
      let message: { id?: JsonRpcId; result?: unknown; error?: { message?: string } };
      try {
        message = JSON.parse(trimmed) as typeof message;
      } catch {
        return;
      }
      if (message.id === undefined || message.id === null) return;
      const key = String(message.id);
      const waiter = this.pending.get(key);
      if (!waiter) return;
      this.pending.delete(key);
      waiter.cleanup?.();
      if (message.error) {
        waiter.reject(new Error(message.error.message || "upstream MCP error"));
        return;
      }
      waiter.resolve(message.result);
    });
  }

  async initialize(serverHint?: string, signal?: AbortSignal): Promise<void> {
    if (this.initialized) return;
    await this.request(
      "initialize",
      {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: serverHint || "eco-shared-upstream", version: "1.0.0" },
      },
      signal,
    );
    await this.notify("notifications/initialized", {}, signal);
    this.initialized = true;
  }

  async listTools(signal?: AbortSignal): Promise<{ tools: unknown[] }> {
    await this.initialize(undefined, signal);
    const result = (await this.request("tools/list", {}, signal)) as { tools?: unknown[] };
    return { tools: Array.isArray(result?.tools) ? result.tools : [] };
  }

  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    await this.initialize(undefined, signal);
    return this.request("tools/call", { name, arguments: args }, signal);
  }

  async close(): Promise<void> {
    this.failAll(new Error("shared MCP upstream closed"));
    this.initialized = false;
    try {
      this.readline?.close();
    } catch {
      // ignore
    }
    this.readline = undefined;
    const child = this.child;
    this.child = undefined;
    this.launchKey = undefined;
    if (!child) return;
    try {
      child.stdin?.end();
    } catch {
      // ignore
    }
    try {
      if (!child.killed) {
        child.kill("SIGTERM");
      }
    } catch {
      // ignore
    }
  }

  private notify(method: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    return this.enqueue(async () => {
      signal?.throwIfAborted();
      this.write({ jsonrpc: "2.0", method, params });
    }, signal);
  }

  private request(method: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    signal?.throwIfAborted();
    return this.enqueue(() => {
      signal?.throwIfAborted();
      const id = this.nextId++;
      const key = String(id);
      return new Promise<unknown>((resolve, reject) => {
        let settled = false;
        let onAbort: (() => void) | undefined;
        const cleanup = () => {
          if (onAbort) {
            signal?.removeEventListener("abort", onAbort);
          }
        };
        const finishReject = (error: Error) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(error);
        };
        onAbort = () => {
          if (settled || !this.pending.has(key)) return;
          this.pending.delete(key);
          settled = true;
          cleanup();
          // MCP forbids cancelling initialize. Other in-flight requests use
          // an explicit upstream cancellation notification; a queued request
          // never reaches this callback because enqueue rejects it before work
          // starts.
          if (method !== "initialize") {
            try {
              this.write({
                jsonrpc: "2.0",
                method: "notifications/cancelled",
                params: {
                  requestId: id,
                  reason: toAbortError(signal?.reason).message,
                },
              });
            } catch {
              // The child may have exited at the same moment as the abort.
            }
          }
          reject(toAbortError(signal?.reason));
        };
        this.pending.set(key, { resolve, reject: finishReject, cleanup });
        signal?.addEventListener("abort", onAbort, { once: true });
        try {
          this.write({ jsonrpc: "2.0", id, method, params });
        } catch (error) {
          this.pending.delete(key);
          finishReject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    }, signal);
  }

  /**
   * Serialize writes while allowing a request waiting behind another response
   * to reject as soon as its signal aborts. The skipped item still advances
   * the queue but never writes to the child. Once work has started, request()
   * owns abort handling and emits notifications/cancelled where MCP permits.
   */
  private enqueue<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    let started = false;
    let queueCancelled = false;
    let removeQueueAbort: (() => void) | undefined;
    let onQueueAbort: (() => void) | undefined;

    const run = this.chain.then(async () => {
      started = true;
      removeQueueAbort?.();
      if (queueCancelled || signal?.aborted) {
        throw toAbortError(signal?.reason);
      }
      return work();
    });
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );

    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        removeQueueAbort?.();
        removeQueueAbort = undefined;
      };
      onQueueAbort = () => {
        if (started || settled) return;
        queueCancelled = true;
        settled = true;
        cleanup();
        reject(toAbortError(signal?.reason));
      };
      if (signal) {
        const listener = onQueueAbort;
        signal.addEventListener("abort", listener, { once: true });
        removeQueueAbort = () => signal.removeEventListener("abort", listener);
      }
      if (signal?.aborted) {
        onQueueAbort();
        return;
      }
      run.then(
        (value) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(value);
        },
        (error) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  }

  private write(message: Record<string, unknown>): void {
    const child = this.child;
    if (!child?.stdin || child.killed) {
      throw new Error("shared MCP upstream is not running");
    }
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private failAll(error: Error): void {
    for (const waiter of this.pending.values()) {
      waiter.cleanup?.();
      waiter.reject(error);
    }
    this.pending.clear();
  }
}

function toAbortError(reason: unknown): Error {
  if (reason instanceof Error) {
    return reason;
  }
  const error = new Error(typeof reason === "string" && reason.trim() ? reason : "MCP request aborted");
  error.name = "AbortError";
  return error;
}
