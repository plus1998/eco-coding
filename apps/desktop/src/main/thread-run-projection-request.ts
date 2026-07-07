export type ThreadRunProjectionMode = "feed" | "full";

export interface ThreadRunProjectionGetRequest {
  threadId: string;
  mode: ThreadRunProjectionMode;
  afterSequence?: number;
}

/** Remote RPC uses a single string arg; feed mode is encoded with this prefix. */
export const THREAD_RUN_PROJECTION_FEED_ARG_PREFIX = "feed:";

export function encodeThreadRunProjectionGetArg(
  threadId: string,
  mode: ThreadRunProjectionMode = "full",
  options: { afterSequence?: number } = {},
): string {
  const id = threadId.trim();
  if (mode !== "feed") {
    return id;
  }
  const afterSequence = readOptionalSequence(options.afterSequence);
  if (afterSequence === undefined) {
    return `${THREAD_RUN_PROJECTION_FEED_ARG_PREFIX}${id}`;
  }
  return `${THREAD_RUN_PROJECTION_FEED_ARG_PREFIX}${encodeURIComponent(id)}?afterSequence=${afterSequence}`;
}

export function parseThreadRunProjectionGetRequest(
  payload: unknown,
  modeArg?: unknown,
): ThreadRunProjectionGetRequest {
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    if (trimmed.startsWith(THREAD_RUN_PROJECTION_FEED_ARG_PREFIX)) {
      const feedArg = parseFeedProjectionArg(
        trimmed.slice(THREAD_RUN_PROJECTION_FEED_ARG_PREFIX.length).trim(),
      );
      return {
        threadId: feedArg.threadId,
        mode: "feed",
        ...(feedArg.afterSequence !== undefined
          ? { afterSequence: feedArg.afterSequence }
          : {}),
      };
    }
    const mode = modeArg === "feed" ? "feed" : "full";
    return { threadId: trimmed, mode };
  }
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    const threadId = typeof record.threadId === "string" ? record.threadId.trim() : "";
    const mode = record.mode === "feed" ? "feed" : "full";
    const afterSequence = readOptionalSequence(record.afterSequence);
    return {
      threadId,
      mode,
      ...(afterSequence !== undefined ? { afterSequence } : {}),
    };
  }
  return { threadId: "", mode: "full" };
}

function parseFeedProjectionArg(value: string): { threadId: string; afterSequence?: number } {
  const queryStart = value.indexOf("?");
  if (queryStart < 0) {
    return { threadId: value.trim() };
  }
  const encodedThreadId = value.slice(0, queryStart);
  const query = value.slice(queryStart + 1);
  const threadId = decodeFeedThreadId(encodedThreadId).trim();
  const params = new URLSearchParams(query);
  const afterSequence = readOptionalSequence(params.get("afterSequence"));
  return {
    threadId,
    ...(afterSequence !== undefined ? { afterSequence } : {}),
  };
}

function decodeFeedThreadId(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function readOptionalSequence(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.floor(value) : undefined;
  }
  if (typeof value !== "string" || value.trim() === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : undefined;
}
