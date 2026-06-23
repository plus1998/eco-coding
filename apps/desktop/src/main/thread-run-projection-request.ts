export type ThreadRunProjectionMode = "feed" | "full";

export interface ThreadRunProjectionGetRequest {
  threadId: string;
  mode: ThreadRunProjectionMode;
}

/** Remote RPC uses a single string arg; feed mode is encoded with this prefix. */
export const THREAD_RUN_PROJECTION_FEED_ARG_PREFIX = "feed:";

export function encodeThreadRunProjectionGetArg(
  threadId: string,
  mode: ThreadRunProjectionMode = "full",
): string {
  const id = threadId.trim();
  return mode === "feed" ? `${THREAD_RUN_PROJECTION_FEED_ARG_PREFIX}${id}` : id;
}

export function parseThreadRunProjectionGetRequest(
  payload: unknown,
  modeArg?: unknown,
): ThreadRunProjectionGetRequest {
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    if (trimmed.startsWith(THREAD_RUN_PROJECTION_FEED_ARG_PREFIX)) {
      return {
        threadId: trimmed.slice(THREAD_RUN_PROJECTION_FEED_ARG_PREFIX.length).trim(),
        mode: "feed",
      };
    }
    const mode = modeArg === "feed" ? "feed" : "full";
    return { threadId: trimmed, mode };
  }
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    const threadId = typeof record.threadId === "string" ? record.threadId.trim() : "";
    const mode = record.mode === "feed" ? "feed" : "full";
    return { threadId, mode };
  }
  return { threadId: "", mode: "full" };
}
