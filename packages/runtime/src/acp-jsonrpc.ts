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
  timeout: ReturnType<typeof setTimeout>;
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
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private readonly notificationHandlers = new Map<string, Set<(params: unknown) => void>>();
  private requestHandler: AcpIncomingRequestHandler | undefined;

  constructor(private readonly io: AcpJsonRpcIo) {
    this.io.onLine((line) => this.handleLine(line));
  }

  onRequest(handler: AcpIncomingRequestHandler): void {
    this.requestHandler = handler;
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
      const pending = {
        resolve,
        reject,
        method,
        ...(idleTimeoutMs === undefined ? {} : { idleTimeoutMs }),
      } as PendingRequest;
      pending.timeout = this.armTimeout(id, pending, timeoutMs ?? 30_000);
      this.pending.set(id, pending);
      try {
        this.io.write(encodeJsonRpcLine(message));
      } catch (error) {
        clearTimeout(pending.timeout);
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
    const error = new Error("AcpJsonRpcPeer disposed");
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timeout);
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
    const idle = pending.idleTimeoutMs !== undefined;
    return setTimeout(() => {
      this.pending.delete(id);
      pending.reject(
        new Error(
          idle
            ? `Timed out waiting for ${pending.method} response after ${timeoutMs}ms idle`
            : `Timed out waiting for ${pending.method} response after ${timeoutMs}ms`,
        ),
      );
    }, timeoutMs);
  }

  private touchIdleTimeouts(): void {
    for (const [id, pending] of this.pending.entries()) {
      if (pending.idleTimeoutMs === undefined) {
        continue;
      }
      clearTimeout(pending.timeout);
      pending.timeout = this.armTimeout(id, pending, pending.idleTimeoutMs);
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

    this.touchIdleTimeouts();

    if (isJsonRpcResponse(message)) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      clearTimeout(pending.timeout);
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
