import { ACP_IDLE_TIMEOUT_MS } from "./acp-types.js";

export type JsonRpcId = string | number;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: unknown;
}

export interface JsonRpcError {
  jsonrpc: "2.0";
  id: JsonRpcId;
  error: { code: number; message: string; data?: unknown };
}

export type AcpJsonRpcIo = {
  write: (line: string) => void;
  onLine: (cb: (line: string) => void) => void;
};

export type AcpRpcTimeout = number | { idleTimeoutMs: number };

type PendingRequest = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout?: ReturnType<typeof setTimeout>;
  timerGeneration: number;
  method: string;
  idleTimeoutMs?: number;
};

export function encodeJsonRpcLine(message: object): string {
  return `${JSON.stringify(message)}\n`;
}

export function parseJsonRpcLine(line: string): object | undefined {
  const trimmed = line.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonRpcId(value: unknown): value is JsonRpcId {
  return typeof value === "string" || typeof value === "number";
}

function isJsonRpcResponse(value: object): value is JsonRpcSuccess | JsonRpcError {
  if (!isRecord(value) || !isJsonRpcId(value.id)) {
    return false;
  }
  return "result" in value || "error" in value;
}

function isJsonRpcNotificationMessage(value: object): value is JsonRpcNotification {
  return isRecord(value) && typeof value.method === "string" && !("id" in value);
}

function isJsonRpcIncomingRequest(value: object): value is JsonRpcRequest {
  if (!isRecord(value) || !isJsonRpcId(value.id) || typeof value.method !== "string") {
    return false;
  }
  return !("result" in value) && !("error" in value);
}

export type AcpIncomingRequestHandler = (request: JsonRpcRequest) => Promise<unknown> | unknown;

export class AcpJsonRpcPeer {
  private nextId = 1;
  private disposed = false;
  /** Host-side inbound RPCs in flight (permission / plan / question). Pause idle while > 0. */
  private inboundInFlight = 0;
  /** Last inbound JSON-RPC activity. Idle clocks compare against this instead of being reset via clearTimeout. */
  private lastInboundAt = Date.now();
  /**
   * When set, the idle timer treats the run as active (not hung) as long as this
   * returns true — e.g. while a subagent tool_call is in_progress. A hard ceiling
   * (`toolActiveHardCeilingMs`) still applies so a truly dead run cannot block forever.
   */
  private toolActiveSignal: (() => boolean) | undefined;
  private toolActiveHardCeilingMs: number | undefined;
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private readonly notificationHandlers = new Map<string, Set<(params: unknown) => void>>();
  private requestHandler: AcpIncomingRequestHandler | undefined;

  constructor(private readonly io: AcpJsonRpcIo) {
    this.io.onLine((line) => this.handleLine(line));
  }

  onRequest(handler: AcpIncomingRequestHandler): void {
    this.requestHandler = handler;
  }

  /**
   * Signal that client-side tool calls (e.g. subagent Agent/Task) are running.
   * While `signal()` returns true, the prompt idle timer does not fire — but the
   * optional hard ceiling still forces failure after `hardCeilingMs` of total
   * silence, so a genuinely dead run cannot hang the session forever.
   */
  setToolActiveSignal(signal: (() => boolean) | undefined, hardCeilingMs = ACP_IDLE_TIMEOUT_MS): void {
    this.toolActiveSignal = signal;
    this.toolActiveHardCeilingMs = hardCeilingMs;
  }

  request(method: string, params?: unknown, timeout: AcpRpcTimeout = 30_000): Promise<unknown> {
    if (this.disposed) {
      return Promise.reject(new Error("AcpJsonRpcPeer is disposed"));
    }
    const id = this.nextId++;
    const message: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      ...(params === undefined ? {} : { params }),
    };
    const idleTimeoutMs =
      typeof timeout === "object" ? timeout.idleTimeoutMs : undefined;
    const timeoutMs = typeof timeout === "number" ? timeout : idleTimeoutMs;
    return new Promise<unknown>((resolve, reject) => {
      const pending: PendingRequest = {
        resolve,
        reject,
        method,
        timerGeneration: 0,
        ...(idleTimeoutMs === undefined ? {} : { idleTimeoutMs }),
      };
      if (idleTimeoutMs !== undefined) {
        this.lastInboundAt = Date.now();
      }
      pending.timeout = this.armTimeout(id, pending, timeoutMs ?? 30_000);
      this.pending.set(id, pending);
      try {
        this.io.write(encodeJsonRpcLine(message));
      } catch (error) {
        this.clearPendingTimer(pending);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  notify(method: string, params?: unknown): void {
    if (this.disposed) {
      throw new Error("AcpJsonRpcPeer is disposed");
    }
    const message: JsonRpcNotification = {
      jsonrpc: "2.0",
      method,
      ...(params === undefined ? {} : { params }),
    };
    this.io.write(encodeJsonRpcLine(message));
  }

  onNotification(method: string, handler: (params: unknown) => void): () => void {
    let handlers = this.notificationHandlers.get(method);
    if (!handlers) {
      handlers = new Set();
      this.notificationHandlers.set(method, handlers);
    }
    handlers.add(handler);
    return () => {
      handlers?.delete(handler);
      if (handlers && handlers.size === 0) {
        this.notificationHandlers.delete(method);
      }
    };
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.inboundInFlight = 0;
    const error = new Error("AcpJsonRpcPeer disposed");
    for (const [id, pending] of this.pending.entries()) {
      this.clearPendingTimer(pending);
      this.pending.delete(id);
      pending.reject(error);
    }
    this.notificationHandlers.clear();
  }

  private armTimeout(
    id: JsonRpcId,
    pending: PendingRequest,
    timeoutMs: number,
  ): ReturnType<typeof setTimeout> {
    const generation = ++pending.timerGeneration;
    if (pending.idleTimeoutMs !== undefined) {
      // Poll lastInboundAt instead of clearTimeout+re-arm. Resetting a one-shot
      // timer on every session/update can cancel an unrelated RPC timeout (bun
      // timer-id reuse) and treats permission wait as silence.
      const idleTimeoutMs = pending.idleTimeoutMs;
      const tickMs = Math.max(5, Math.min(1_000, Math.ceil(idleTimeoutMs / 4)));
      const timer = setInterval(() => {
        if (this.disposed || pending.timerGeneration !== generation || !this.pending.has(id)) {
          clearInterval(timer);
          return;
        }
        if (this.inboundInFlight > 0) {
          return;
        }
        // While a client-side tool (e.g. subagent Agent/Task) is running, the run
        // is active — do not treat silence as a hang. A hard ceiling still applies
        // so a truly dead run cannot block the session forever.
        const toolActive = this.toolActiveSignal?.() ?? false;
        if (toolActive) {
          const ceilingMs = this.toolActiveHardCeilingMs ?? idleTimeoutMs;
          if (Date.now() - this.lastInboundAt < ceilingMs) {
            return;
          }
        }
        if (Date.now() - this.lastInboundAt < idleTimeoutMs) {
          return;
        }
        pending.timerGeneration += 1;
        clearInterval(timer);
        this.pending.delete(id);
        pending.reject(
          new Error(
            `Timed out waiting for ${pending.method} response after ${idleTimeoutMs}ms idle`,
          ),
        );
      }, tickMs);
      return timer;
    }
    return setTimeout(() => {
      if (this.disposed || pending.timerGeneration !== generation || !this.pending.has(id)) {
        return;
      }
      this.pending.delete(id);
      pending.reject(
        new Error(`Timed out waiting for ${pending.method} response after ${timeoutMs}ms`),
      );
    }, timeoutMs);
  }

  private clearPendingTimer(pending: PendingRequest): void {
    pending.timerGeneration += 1;
    if (pending.timeout === undefined) {
      return;
    }
    clearTimeout(pending.timeout);
    clearInterval(pending.timeout);
    pending.timeout = undefined;
  }

  private noteInboundActivity(): void {
    this.lastInboundAt = Date.now();
  }

  private beginInboundRequest(): void {
    this.inboundInFlight += 1;
  }

  private endInboundRequest(): void {
    this.inboundInFlight = Math.max(0, this.inboundInFlight - 1);
    if (this.inboundInFlight === 0 && !this.disposed) {
      this.lastInboundAt = Date.now();
    }
  }

  private handleLine(line: string): void {
    if (this.disposed) {
      return;
    }
    const message = parseJsonRpcLine(line);
    if (!message) {
      return;
    }

    this.noteInboundActivity();

    if (isJsonRpcResponse(message)) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.clearPendingTimer(pending);
      this.pending.delete(message.id);
      if ("error" in message && message.error) {
        const err = message.error;
        const rpcMessage =
          typeof err === "object" && err !== null && "message" in err
            ? String((err as { message: unknown }).message)
            : "JSON-RPC error";
        const code =
          typeof err === "object" && err !== null && "code" in err
            ? Number((err as { code: unknown }).code)
            : undefined;
        const detail =
          typeof err === "object" && err !== null && "data" in err && (err as { data: unknown }).data !== undefined
            ? ` data=${JSON.stringify((err as { data: unknown }).data)}`
            : "";
        const formatted = Number.isFinite(code)
          ? `${pending.method} failed (${code}): ${rpcMessage}${detail}`
          : `${pending.method} failed: ${rpcMessage}${detail}`;
        const error = new Error(formatted) as Error & { code?: number; rpcMethod?: string };
        if (Number.isFinite(code)) {
          error.code = code;
        }
        error.rpcMethod = pending.method;
        pending.reject(error);
        return;
      }
      pending.resolve("result" in message ? message.result : undefined);
      return;
    }

    if (isJsonRpcIncomingRequest(message)) {
      void this.dispatchIncomingRequest(message);
      return;
    }

    if (isJsonRpcNotificationMessage(message)) {
      const handlers = this.notificationHandlers.get(message.method);
      if (!handlers) {
        return;
      }
      for (const handler of handlers) {
        handler(message.params);
      }
    }
  }

  private async dispatchIncomingRequest(request: JsonRpcRequest): Promise<void> {
    if (this.disposed) {
      return;
    }
    const handler = this.requestHandler;
    if (!handler) {
      this.writeError(request.id, -32601, `Method not found: ${request.method}`);
      return;
    }
    this.beginInboundRequest();
    try {
      const result = await handler(request);
      if (this.disposed) {
        return;
      }
      this.io.write(
        encodeJsonRpcLine({
          jsonrpc: "2.0",
          id: request.id,
          result: result ?? null,
        }),
      );
    } catch (error) {
      if (this.disposed) {
        return;
      }
      this.writeError(
        request.id,
        -32603,
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      this.endInboundRequest();
    }
  }

  private writeError(id: JsonRpcId, code: number, message: string): void {
    this.io.write(
      encodeJsonRpcLine({
        jsonrpc: "2.0",
        id,
        error: { code, message },
      }),
    );
  }
}
