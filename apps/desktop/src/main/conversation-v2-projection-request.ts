export type ThreadRunProjectionMode = "feed" | "full";

export interface ThreadRunProjectionGetRequest {
  threadId: string;
  mode: ThreadRunProjectionMode;
  afterSequence?: number;
  historyRevision?: number;
}

/** Remote RPC uses a single string arg; feed mode is encoded with this prefix. */
export const THREAD_RUN_PROJECTION_FEED_ARG_PREFIX = "feed:";

export function encodeThreadRunProjectionGetArg(
  threadId: string,
  mode: ThreadRunProjectionMode = "full",
  options: { afterSequence?: number; historyRevision?: number } = {},
): string {
  const id = threadId.trim();
  if (mode !== "feed") {
    return id;
  }
  const afterSequence = readOptionalSequence(options.afterSequence);
  const historyRevision = readOptionalSequence(options.historyRevision);
  if (afterSequence === undefined && historyRevision === undefined) {
    return `${THREAD_RUN_PROJECTION_FEED_ARG_PREFIX}${id}`;
  }
  const params = new URLSearchParams();
  if (afterSequence !== undefined) params.set("afterSequence", String(afterSequence));
  if (historyRevision !== undefined) params.set("historyRevision", String(historyRevision));
  return `${THREAD_RUN_PROJECTION_FEED_ARG_PREFIX}${encodeURIComponent(id)}?${params.toString()}`;
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
        ...(feedArg.afterSequence !== undefined ? { afterSequence: feedArg.afterSequence } : {}),
        ...(feedArg.historyRevision !== undefined ? { historyRevision: feedArg.historyRevision } : {}),
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
    const historyRevision = readOptionalSequence(record.historyRevision);
    return {
      threadId,
      mode,
      ...(afterSequence !== undefined ? { afterSequence } : {}),
      ...(historyRevision !== undefined ? { historyRevision } : {}),
    };
  }
  return { threadId: "", mode: "full" };
}

function parseFeedProjectionArg(value: string): {
  threadId: string;
  afterSequence?: number;
  historyRevision?: number;
} {
  const queryStart = value.indexOf("?");
  if (queryStart < 0) {
    return { threadId: value.trim() };
  }
  const encodedThreadId = value.slice(0, queryStart);
  const query = value.slice(queryStart + 1);
  const threadId = decodeFeedThreadId(encodedThreadId).trim();
  const params = new URLSearchParams(query);
  const afterSequence = readOptionalSequence(params.get("afterSequence"));
  const historyRevision = readOptionalSequence(params.get("historyRevision"));
  return {
    threadId,
    ...(afterSequence !== undefined ? { afterSequence } : {}),
    ...(historyRevision !== undefined ? { historyRevision } : {}),
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
