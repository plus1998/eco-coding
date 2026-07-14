import type { CodexAppServerClient } from "./codex-app-server-client.js";

export const CODEX_ROLLBACK_METHOD = "thread/rollback";

export interface CodexThreadRollbackInput {
  threadId: string;
  /** Codex user item id to keep as the rollback target. */
  itemId: string;
}

export interface CodexThreadRollbackParams {
  threadId: string;
  itemId: string;
}

export interface CodexThreadRollbackResult {
  thread?: {
    id: string;
  };
  rolledBackToItemId?: string;
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

export function buildCodexThreadRollbackParams(input: CodexThreadRollbackInput): CodexThreadRollbackParams {
  const threadId = input.threadId.trim();
  const itemId = input.itemId.trim();
  if (!threadId || !itemId) {
    throw new CodexRollbackNotAvailable("Codex rollback requires a thread id and target item id.", {
      nextAction: "Retry from a Codex-backed user message that has a persisted item id.",
    });
  }
  return { threadId, itemId };
}

export async function rollbackCodexThread(
  client: Pick<CodexAppServerClient, "request">,
  input: CodexThreadRollbackInput,
): Promise<CodexThreadRollbackResult> {
  return client.request<CodexThreadRollbackResult>(
    CODEX_ROLLBACK_METHOD,
    buildCodexThreadRollbackParams(input),
  );
}
