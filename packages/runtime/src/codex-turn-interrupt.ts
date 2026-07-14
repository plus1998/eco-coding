import type { CodexAppServerClient } from "./codex-app-server-client.js";

export const CODEX_TURN_INTERRUPT_METHOD = "turn/interrupt";

export interface CodexTurnInterruptInput {
  threadId: string;
  turnId: string;
}

export interface CodexTurnInterruptParams {
  threadId: string;
  turnId: string;
}

export interface CodexTurnInterruptResult {
  // app-server returns an empty object on success
}

export class CodexTurnInterruptFailed extends Error {
  readonly code = "CodexTurnInterruptFailed";

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "CodexTurnInterruptFailed";
  }
}

export function isCodexTurnInterruptFailed(error: unknown): error is CodexTurnInterruptFailed {
  return error instanceof CodexTurnInterruptFailed;
}

export function buildCodexTurnInterruptParams(input: CodexTurnInterruptInput): CodexTurnInterruptParams {
  const threadId = input.threadId.trim();
  const turnId = input.turnId.trim();
  if (!threadId || !turnId) {
    throw new CodexTurnInterruptFailed(
      "turn/interrupt requires threadId and turnId; refusing to pretend the turn stopped.",
    );
  }
  return { threadId, turnId };
}

/**
 * Ask app-server to interrupt an active turn (`turn/interrupt`).
 * Failures are explicit — callers must not treat them as a successful cancel.
 */
export async function interruptCodexTurn(
  client: Pick<CodexAppServerClient, "request">,
  input: CodexTurnInterruptInput,
): Promise<CodexTurnInterruptResult> {
  const params = buildCodexTurnInterruptParams(input);
  try {
    return await client.request<CodexTurnInterruptResult>(CODEX_TURN_INTERRUPT_METHOD, params);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const failed = new CodexTurnInterruptFailed(
      `turn/interrupt failed for thread ${params.threadId} turn ${params.turnId}: ${detail}`,
      { cause: error },
    );
    console.error(`[eco-codex] ${failed.message}`);
    throw failed;
  }
}
