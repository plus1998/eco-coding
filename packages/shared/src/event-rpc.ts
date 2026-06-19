export const ECO_RPC_PROTOCOL_VERSION = 1 as const;
export const ECO_JSON_RPC_VERSION = "2.0" as const;

export const ECO_RPC_METHODS = {
  event: "eco.event",
  invoke: "eco.invoke",
  ping: "eco.ping",
} as const;

export const ECO_RPC_ERROR = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
  unauthorized: -32001,
  forbidden: -32003,
  targetOffline: -32004,
  timeout: -32008,
} as const;

export type EcoJsonRpcMethod = (typeof ECO_RPC_METHODS)[keyof typeof ECO_RPC_METHODS];
export type EcoJsonRpcId = string | number | null;

export interface EcoJsonRpcRequest<TParams = unknown> {
  jsonrpc: typeof ECO_JSON_RPC_VERSION;
  id?: EcoJsonRpcId;
  method: string;
  params?: TParams;
}

export interface EcoJsonRpcNotification<TParams = unknown> {
  jsonrpc: typeof ECO_JSON_RPC_VERSION;
  id?: undefined;
  method: string;
  params?: TParams;
}

export interface EcoJsonRpcSuccess<TResult = unknown> {
  jsonrpc: typeof ECO_JSON_RPC_VERSION;
  id: EcoJsonRpcId;
  result: TResult;
}

export interface EcoJsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface EcoJsonRpcFailure {
  jsonrpc: typeof ECO_JSON_RPC_VERSION;
  id: EcoJsonRpcId;
  error: EcoJsonRpcError;
}

export type EcoJsonRpcResponse<TResult = unknown> =
  | EcoJsonRpcSuccess<TResult>
  | EcoJsonRpcFailure;

export type EcoJsonRpcMessage<TParams = unknown, TResult = unknown> =
  | EcoJsonRpcRequest<TParams>
  | EcoJsonRpcNotification<TParams>
  | EcoJsonRpcResponse<TResult>;

export type EcoDeviceKind = "desktop" | "mobile";

export type EcoRpcSource = "desktop" | "center-server" | "mobile";

export type EcoDeviceCapability =
  | "events:publish"
  | "events:read"
  | "rpc:receive"
  | "rpc:invoke"
  | "approval:decide"
  | "device:pair"
  | "device:admin";

export type EcoCommandRisk = "read" | "write_safe" | "execute" | "privileged";

export interface EcoInvokeParams {
  desktopDeviceId: string;
  channel: string;
  args?: unknown[];
  requestId?: string;
  deadlineMs?: number;
  idempotencyKey?: string;
}

export interface EcoInvokeOrigin {
  source: "mobile";
  userId: string;
  mobileDeviceId: string;
  mobileSessionId: string;
  capabilities: EcoDeviceCapability[];
}

export interface EcoForwardedInvokeParams extends EcoInvokeParams {
  caller: "mobile";
  origin: EcoInvokeOrigin;
}

export interface EcoInvokeResult<TResult = unknown> {
  channel: string;
  result: TResult;
}

export interface EcoEventEnvelope<TPayload = unknown> {
  protocolVersion: typeof ECO_RPC_PROTOCOL_VERSION;
  id: string;
  kind: string;
  source: EcoRpcSource;
  occurredAt: string;
  payload: TPayload;
  threadId?: string;
  workspacePath?: string;
  aggregateKey?: string;
  metadata?: Record<string, unknown>;
}

const PRIVILEGED_CHANNEL_PREFIXES = [
  "approval:",
  "bash-approval:",
  "git:",
  "model-provider:",
  "model-route-profile:",
  "proxy-bridge-settings:",
  "session-sync-settings:",
  "thread:approve-plan",
  "thread:rollback-to",
  "thread:revert-applied-diff",
  "thread:rewind-checkpoint",
  "worktree:apply",
] as const;

const EXECUTE_CHANNEL_PREFIXES = [
  "thread:start",
  "thread:continue",
  "thread:retry",
  "thread:follow-up-",
  "workspace:start-package-script",
  "workspace:stop-package-script",
  "terminal:",
  "conformance:",
] as const;

const WRITE_SAFE_CHANNEL_SUFFIXES = [":save", ":delete", ":import", ":restore", ":reorder"] as const;

export function buildEcoJsonRpcSuccess<TResult>(
  id: EcoJsonRpcId,
  result: TResult,
): EcoJsonRpcSuccess<TResult> {
  return {
    jsonrpc: ECO_JSON_RPC_VERSION,
    id,
    result,
  };
}

export function buildEcoJsonRpcFailure(
  id: EcoJsonRpcId,
  code: number,
  message: string,
  data?: unknown,
): EcoJsonRpcFailure {
  return {
    jsonrpc: ECO_JSON_RPC_VERSION,
    id,
    error: {
      code,
      message,
      ...(data !== undefined ? { data } : {}),
    },
  };
}

export function buildEcoJsonRpcNotification<TParams>(
  method: string,
  params: TParams,
): EcoJsonRpcNotification<TParams> {
  return {
    jsonrpc: ECO_JSON_RPC_VERSION,
    method,
    params,
  };
}

export function buildEcoJsonRpcRequest<TParams>(
  id: EcoJsonRpcId,
  method: string,
  params: TParams,
): EcoJsonRpcRequest<TParams> {
  return {
    jsonrpc: ECO_JSON_RPC_VERSION,
    id,
    method,
    params,
  };
}

export function isEcoJsonRpcRequest(value: unknown): value is EcoJsonRpcRequest {
  if (!value || typeof value !== "object") {
    return false;
  }
  const request = value as EcoJsonRpcRequest;
  return (
    request.jsonrpc === ECO_JSON_RPC_VERSION &&
    request.id !== undefined &&
    typeof request.method === "string" &&
    request.method.trim().length > 0 &&
    isEcoJsonRpcId(request.id)
  );
}

export function isEcoJsonRpcResponse(value: unknown): value is EcoJsonRpcResponse {
  if (!value || typeof value !== "object") {
    return false;
  }
  const response = value as EcoJsonRpcResponse;
  return (
    response.jsonrpc === ECO_JSON_RPC_VERSION &&
    response.id !== undefined &&
    (isEcoJsonRpcSuccess(response) || isEcoJsonRpcFailure(response))
  );
}

export function isEcoJsonRpcNotification(value: unknown): value is EcoJsonRpcNotification {
  if (!value || typeof value !== "object") {
    return false;
  }
  const notification = value as EcoJsonRpcNotification;
  return (
    notification.jsonrpc === ECO_JSON_RPC_VERSION &&
    notification.id === undefined &&
    typeof notification.method === "string" &&
    notification.method.trim().length > 0
  );
}

export function isEcoInvokeParams(value: unknown): value is EcoInvokeParams {
  if (!value || typeof value !== "object") {
    return false;
  }
  const params = value as EcoInvokeParams;
  return (
    typeof params.desktopDeviceId === "string" &&
    params.desktopDeviceId.trim().length > 0 &&
    typeof params.channel === "string" &&
    params.channel.trim().length > 0 &&
    (params.args === undefined || Array.isArray(params.args)) &&
    (params.requestId === undefined || typeof params.requestId === "string") &&
    (params.deadlineMs === undefined || isPositiveInteger(params.deadlineMs)) &&
    (params.idempotencyKey === undefined || typeof params.idempotencyKey === "string")
  );
}

export function classifyEcoCommandRisk(channel: string): EcoCommandRisk {
  if (PRIVILEGED_CHANNEL_PREFIXES.some((prefix) => channel.startsWith(prefix))) {
    return "privileged";
  }
  if (EXECUTE_CHANNEL_PREFIXES.some((prefix) => channel.startsWith(prefix))) {
    return "execute";
  }
  if (WRITE_SAFE_CHANNEL_SUFFIXES.some((suffix) => channel.endsWith(suffix))) {
    return "write_safe";
  }
  return "read";
}

function isEcoJsonRpcId(value: unknown): value is EcoJsonRpcId | undefined {
  return value === undefined || value === null || typeof value === "string" || typeof value === "number";
}

function isEcoJsonRpcSuccess(value: EcoJsonRpcResponse): value is EcoJsonRpcSuccess {
  return "result" in value && !("error" in value);
}

function isEcoJsonRpcFailure(value: EcoJsonRpcResponse): value is EcoJsonRpcFailure {
  return "error" in value && typeof value.error?.message === "string";
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}
