import type { CodexAppServerClient } from "./codex-app-server-client.js";

export const CODEX_ROLLBACK_METHOD = "thread/rollback";

export interface CodexThreadRollbackInput {
  threadId: string;
  /** Codex user item id to keep as the rollback target. */
  itemId: string;
  /** Zero-based Eco user-turn ordinal for Codex versions that rebuild item ids on thread/read. */
  targetTurnIndex?: number;
}

export interface CodexThreadRollbackParams {
  threadId: string;
  numTurns: number;
}

export interface CodexThreadRollbackResult {
  thread?: {
    id: string;
  };
}

export interface CodexRollbackNotAvailableOptions {
  nextAction: string;
  cause?: unknown;
}

export class CodexRollbackNotAvailable extends Error {
  readonly code = "CodexRollbackNotAvailable";
  readonly nextAction: string;

  constructor(message: string, options: CodexRollbackNotAvailableOptions) {
    super(`${message} Next action: ${options.nextAction}`, { cause: options.cause });
    this.name = "CodexRollbackNotAvailable";
    this.nextAction = options.nextAction;
  }
}

export function buildCodexThreadRollbackParams(
  input: CodexThreadRollbackInput,
  numTurns: number,
): CodexThreadRollbackParams {
  const threadId = input.threadId.trim();
  const itemId = input.itemId.trim();
  if (!threadId || !itemId || !Number.isInteger(numTurns) || numTurns < 1) {
    throw new CodexRollbackNotAvailable("Codex rollback requires a thread id and target item id.", {
      nextAction: "Retry from a Codex-backed user message that has a persisted item id.",
    });
  }
  return { threadId, numTurns };
}

export async function rollbackCodexThread(
  client: Pick<CodexAppServerClient, "request">,
  input: CodexThreadRollbackInput,
): Promise<CodexThreadRollbackResult> {
  const threadId = input.threadId.trim();
  const targetItemId = input.itemId.trim();
  const read = await client.request<{
    thread?: { turns?: Array<{ items?: Array<{ id?: unknown; clientId?: unknown; type?: unknown }> }> };
  }>("thread/read", { threadId, includeTurns: true });
  const turns = read.thread?.turns;
  if (!Array.isArray(turns)) {
    throw new CodexRollbackNotAvailable("Codex thread history is unavailable for rollback.", {
      nextAction: "Reload the Codex thread with turn history, then retry rewind.",
    });
  }
  let targetTurnIndex = turns.findIndex((turn) =>
    turn.items?.some(
      (item) =>
        item.type === "userMessage" &&
        (item.id === targetItemId || item.clientId === targetItemId),
    ),
  );
  if (
    targetTurnIndex < 0 &&
    Number.isInteger(input.targetTurnIndex) &&
    input.targetTurnIndex! >= 0
  ) {
    const userTurnIndexes = turns.flatMap((turn, index) =>
      turn.items?.some((item) => item.type === "userMessage") ? [index] : [],
    );
    targetTurnIndex = userTurnIndexes[input.targetTurnIndex!] ?? -1;
  }
  if (targetTurnIndex < 0) {
    const availableUserItemCount = turns.reduce(
      (count, turn) =>
        count + (turn.items ?? []).filter((item) => item.type === "userMessage").length,
      0,
    );
    throw new CodexRollbackNotAvailable(
      `Codex user item '${targetItemId}' was not found among ${availableUserItemCount} persisted user items.`,
      {
        nextAction: "Refresh the activity feed and select a persisted Codex user message.",
      },
    );
  }
  const numTurns = turns.length - targetTurnIndex;
  return client.request<CodexThreadRollbackResult>(
    CODEX_ROLLBACK_METHOD,
    buildCodexThreadRollbackParams(input, numTurns),
  );
}
