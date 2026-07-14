import { DEFAULT_CODEX_RPC_TIMEOUT_MS, type CodexAppServerClient } from "./codex-app-server-client.js";

export const CODEX_COMPACT_METHOD = "thread/compact/start";

export interface CodexThreadCompactInput {
  threadId: string;
}

export interface CodexThreadCompactParams {
  threadId: string;
}

/** App-server returns `{}` immediately; progress streams via item/* notifications. */
export type CodexThreadCompactResult = Record<string, never>;

export const DEFAULT_CODEX_COMPACT_WAIT_TIMEOUT_MS = DEFAULT_CODEX_RPC_TIMEOUT_MS;

export interface CodexCompactWaitOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface CodexThreadCompactCompletion {
  threadId: string;
  turnId: string;
  itemId: string;
  postTokens: number;
}

export interface CodexCompactNotAvailableOptions {
  nextAction: string;
  cause?: unknown;
}

export class CodexCompactNotAvailable extends Error {
  readonly code = "CodexCompactNotAvailable";
  readonly nextAction: string;

  constructor(message: string, options: CodexCompactNotAvailableOptions) {
    super(`${message} Next action: ${options.nextAction}`, { cause: options.cause });
    this.name = "CodexCompactNotAvailable";
    this.nextAction = options.nextAction;
  }
}

export function buildCodexThreadCompactParams(input: CodexThreadCompactInput): CodexThreadCompactParams {
  const threadId = input.threadId.trim();
  if (!threadId) {
    throw new CodexCompactNotAvailable("Codex compact requires a thread id.", {
      nextAction: "Retry from a Codex-backed thread that has a persisted Codex thread id.",
    });
  }
  return { threadId };
}

export async function compactCodexThread(
  client: Pick<CodexAppServerClient, "request">,
  input: CodexThreadCompactInput,
): Promise<CodexThreadCompactResult> {
  return client.request<CodexThreadCompactResult>(
    CODEX_COMPACT_METHOD,
    buildCodexThreadCompactParams(input),
  );
}

/**
 * Wait for the canonical compaction lifecycle. The start RPC only acknowledges
 * scheduling; completion requires the matching item, turn, and post-compact usage.
 */
export function compactCodexThreadAndWait(
  client: Pick<CodexAppServerClient, "request" | "addNotificationHandler">,
  input: CodexThreadCompactInput,
  options: CodexCompactWaitOptions = {},
): Promise<CodexThreadCompactCompletion> {
  const { threadId } = buildCodexThreadCompactParams(input);
  const timeoutMs = options.timeoutMs ?? DEFAULT_CODEX_COMPACT_WAIT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.reject(new Error(`Invalid Codex compact wait timeout: ${timeoutMs}`));
  }
  if (options.signal?.aborted) {
    return Promise.reject(asError(options.signal.reason, "Codex compact aborted before start"));
  }

  return new Promise<CodexThreadCompactCompletion>((resolve, reject) => {
    let acknowledged = false;
    let targetTurnId: string | undefined;
    let targetItemId: string | undefined;
    let itemCompleted = false;
    let turnCompleted = false;
    let postTokens: number | undefined;
    let settled = false;
    let removeNotification: () => void = () => undefined;

    const cleanup = () => {
      clearTimeout(timeout);
      removeNotification();
      options.signal?.removeEventListener("abort", onAbort);
    };

    const fail = (error: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(asError(error, "Codex compact failed"));
    };

    const maybeResolve = () => {
      if (
        settled ||
        !acknowledged ||
        !targetTurnId ||
        !targetItemId ||
        !itemCompleted ||
        !turnCompleted ||
        postTokens === undefined
      ) {
        return;
      }
      settled = true;
      cleanup();
      resolve({
        threadId,
        turnId: targetTurnId,
        itemId: targetItemId,
        postTokens,
      });
    };

    const onAbort = () => {
      fail(asError(options.signal?.reason, "Codex compact aborted"));
    };

    const timeout = setTimeout(() => {
      const missing = [
        !acknowledged ? "start acknowledgement" : undefined,
        !targetTurnId ? "contextCompaction item start" : undefined,
        !itemCompleted ? "contextCompaction item completion" : undefined,
        !turnCompleted ? "completed turn" : undefined,
        postTokens === undefined ? "post-compaction token usage" : undefined,
      ].filter((value): value is string => value !== undefined);
      fail(
        new Error(`Timed out waiting for Codex compact after ${timeoutMs}ms; missing: ${missing.join(", ")}`),
      );
    }, timeoutMs);

    removeNotification = client.addNotificationHandler((method, params) => {
      if (settled) {
        return;
      }

      if (method === "item/started") {
        const item = readContextCompactionItem(params);
        if (item?.threadId !== threadId) {
          return;
        }
        if (!targetTurnId) {
          targetTurnId = item.turnId;
          targetItemId = item.itemId;
        }
        return;
      }

      if (method === "item/completed") {
        const item = readContextCompactionItem(params);
        if (item?.threadId === threadId && item.turnId === targetTurnId && item.itemId === targetItemId) {
          itemCompleted = true;
          maybeResolve();
        }
        return;
      }

      if (method === "thread/tokenUsage/updated") {
        if (!isRecord(params)) {
          return;
        }
        if (readString(params.threadId) !== threadId || readString(params.turnId) !== targetTurnId) {
          return;
        }
        const totalTokens = readPostCompactTokens(params.tokenUsage);
        if (totalTokens === undefined) {
          fail(new Error(`Codex compact turn ${targetTurnId} emitted invalid tokenUsage.last.totalTokens`));
          return;
        }
        postTokens = totalTokens;
        maybeResolve();
        return;
      }

      if (method === "turn/completed") {
        const completion = readTurnCompletion(params);
        if (completion?.threadId !== threadId || completion.turnId !== targetTurnId) {
          return;
        }
        if (completion.status !== "completed") {
          fail(
            new Error(
              `Codex compact turn ${completion.turnId} ${completion.status}${completion.error ? `: ${completion.error}` : ""}`,
            ),
          );
          return;
        }
        turnCompleted = true;
        maybeResolve();
      }
    });

    options.signal?.addEventListener("abort", onAbort, { once: true });

    void compactCodexThread(client, { threadId }).then(
      (result) => {
        if (settled) {
          return;
        }
        if (!isRecord(result)) {
          fail(new Error("Codex compact start returned an invalid acknowledgement"));
          return;
        }
        acknowledged = true;
        maybeResolve();
      },
      (error) => {
        fail(error);
      },
    );
  });
}

function readContextCompactionItem(
  params: unknown,
): { threadId: string; turnId: string; itemId: string } | undefined {
  if (!isRecord(params) || !isRecord(params.item) || params.item.type !== "contextCompaction") {
    return undefined;
  }
  const threadId = readString(params.threadId);
  const turnId = readString(params.turnId);
  const itemId = readString(params.item.id);
  if (!threadId || !turnId || !itemId) {
    return undefined;
  }
  return { threadId, turnId, itemId };
}

function readPostCompactTokens(tokenUsage: unknown): number | undefined {
  if (!isRecord(tokenUsage) || !isRecord(tokenUsage.last)) {
    return undefined;
  }
  const totalTokens = tokenUsage.last.totalTokens;
  return typeof totalTokens === "number" && Number.isInteger(totalTokens) && totalTokens >= 0
    ? totalTokens
    : undefined;
}

function readTurnCompletion(
  params: unknown,
): { threadId: string; turnId: string; status: string; error?: string } | undefined {
  if (!isRecord(params) || !isRecord(params.turn)) {
    return undefined;
  }
  const threadId = readString(params.threadId);
  const turnId = readString(params.turn.id);
  const status = readString(params.turn.status);
  if (!threadId || !turnId || !status) {
    return undefined;
  }
  const error = isRecord(params.turn.error) ? readTurnError(params.turn.error) : undefined;
  return { threadId, turnId, status, ...(error ? { error } : {}) };
}

function readTurnError(error: Record<string, unknown>): string | undefined {
  const message = readString(error.message);
  const details = readString(error.additionalDetails);
  if (message && details) {
    return `${message}: ${details}`;
  }
  return message ?? details;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asError(value: unknown, fallbackMessage: string): Error {
  if (value instanceof Error) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    return new Error(value.trim());
  }
  return new Error(fallbackMessage);
}
