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
};

export class SharedMcpStdioUpstream {
  private child: ChildProcess | undefined;
  private readline: Interface | undefined;
  private readonly pending = new Map<string, Pending>();
  private nextId = 1;
  private chain: Promise<unknown> = Promise.resolve();
  private binaryPath: string | undefined;
  private initialized = false;

  get pid(): number | undefined {
    return this.child?.pid;
  }

  get alive(): boolean {
    return Boolean(this.child && !this.child.killed && this.child.exitCode === null);
  }

  async ensure(binaryPath: string, args: string[] = ["mcp"]): Promise<void> {
    if (this.alive && this.binaryPath === binaryPath) {
      return;
    }
    await this.close();
    this.binaryPath = binaryPath;
    const child = spawn(binaryPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: process.env,
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
      if (message.error) {
        waiter.reject(new Error(message.error.message || "upstream MCP error"));
        return;
      }
      waiter.resolve(message.result);
    });
  }

  async initialize(serverHint?: string): Promise<void> {
    if (this.initialized) return;
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: serverHint || "eco-shared-upstream", version: "1.0.0" },
    });
    await this.notify("notifications/initialized", {});
    this.initialized = true;
  }

  async listTools(): Promise<{ tools: unknown[] }> {
    await this.initialize();
    const result = (await this.request("tools/list", {})) as { tools?: unknown[] };
    return { tools: Array.isArray(result?.tools) ? result.tools : [] };
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    await this.initialize();
    return this.request("tools/call", { name, arguments: args });
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

  private notify(method: string, params: Record<string, unknown>): Promise<void> {
    return this.enqueue(async () => {
      this.write({ jsonrpc: "2.0", method, params });
    });
  }

  private request(method: string, params: Record<string, unknown>): Promise<unknown> {
    return this.enqueue(() => {
      const id = this.nextId++;
      const key = String(id);
      return new Promise<unknown>((resolve, reject) => {
        this.pending.set(key, { resolve, reject });
        try {
          this.write({ jsonrpc: "2.0", id, method, params });
        } catch (error) {
          this.pending.delete(key);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    });
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const run = this.chain.then(work, work);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
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
      waiter.reject(error);
    }
    this.pending.clear();
  }
}
