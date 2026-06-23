export type ThreadRunProjectionMode = "feed" | "full";

export interface ThreadRunProjectionGetRequest {
  threadId: string;
  mode: ThreadRunProjectionMode;
}

export function parseThreadRunProjectionGetRequest(
  payload: unknown,
  modeArg?: unknown,
): ThreadRunProjectionGetRequest {
  if (typeof payload === "string") {
    const mode = modeArg === "feed" ? "feed" : "full";
    return { threadId: payload.trim(), mode };
  }
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    const threadId = typeof record.threadId === "string" ? record.threadId.trim() : "";
    const mode = record.mode === "feed" ? "feed" : "full";
    return { threadId, mode };
  }
  return { threadId: "", mode: "full" };
}
