import type { ThreadApprovePlanRequest } from "./ipc";

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

  return {
    threadId,
    ...(typeof record.plan === "string" ? { plan: record.plan } : {}),
    ...(typeof record.analysis === "string" ? { analysis: record.analysis } : {}),
  };
}
