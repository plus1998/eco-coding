import type { PlanExecutionTarget } from "@eco/runtime/forced-plan-delegation";
import type { ThreadApprovePlanRequest, ThreadRuntimeConfigInput } from "./ipc";
import { isThreadRuntimeConfig } from "./thread-runtime-config";

export type { PlanExecutionTarget };

function parsePlanExecutionTarget(raw: unknown): PlanExecutionTarget | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (typeof raw !== "object") {
    throw new Error("Invalid plan execution target.");
  }
  const record = raw as Record<string, unknown>;
  const kind = typeof record.kind === "string" ? record.kind.trim() : "";
  if (!kind) {
    return undefined;
  }
  if (kind === "main") {
    return { kind: "main" };
  }
  if (kind === "subagent") {
    const agentKey = typeof record.agentKey === "string" ? record.agentKey.trim() : "";
    if (!agentKey) {
      throw new Error("选择子代理执行计划时必须提供 agentKey。");
    }
    const additionalMessage =
      typeof record.additionalMessage === "string" ? record.additionalMessage : undefined;
    return {
      kind: "subagent",
      agentKey,
      ...(additionalMessage !== undefined ? { additionalMessage } : {}),
    };
  }
  throw new Error("未知的计划执行目标。");
}

export function parseThreadApprovePlanPayload(payload: unknown): ThreadApprovePlanRequest {
  if (typeof payload === "string") {
    const threadId = payload.trim();
    if (!threadId) {
      throw new Error("Thread id is required.");
    }
    return { threadId };
  }

  if (!payload || typeof payload !== "object") {
    throw new Error("Thread id is required.");
  }

  const record = payload as Record<string, unknown>;
  const threadId = typeof record.threadId === "string" ? record.threadId.trim() : "";
  if (!threadId) {
    throw new Error("Thread id is required.");
  }
  const runtimeConfig = isThreadRuntimeConfig(record.runtimeConfig)
    ? (record.runtimeConfig as ThreadRuntimeConfigInput)
    : undefined;
  const executionTarget = parsePlanExecutionTarget(record.executionTarget);

  return {
    threadId,
    ...(typeof record.plan === "string" ? { plan: record.plan } : {}),
    ...(typeof record.analysis === "string" ? { analysis: record.analysis } : {}),
    ...(runtimeConfig ? { runtimeConfig } : {}),
    ...(executionTarget ? { executionTarget } : {}),
  };
}
