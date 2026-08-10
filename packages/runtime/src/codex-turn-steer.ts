import type { CodexAppServerClient } from "./codex-app-server-client.js";

export const CODEX_TURN_STEER_METHOD = "turn/steer";
export const CODEX_TURN_STEER_DEADLINE_MS = 10_000;

export type CodexTurnSteerUserInput =
  | { type: "text"; text: string }
  | { type: "localImage"; path: string; detail?: "low" | "high" }
  | { type: "skill"; name: string; path: string };

export interface CodexTurnSteerInput {
  threadId: string;
  /** Active turn id; wire as expectedTurnId. */
  turnId: string;
  input: readonly CodexTurnSteerUserInput[];
  /**
   * Eco follow-up id (or other stable client id). Wire as clientUserMessageId so the
   * UserMessage item can echo it; not a delivery proof beyond steer enqueue success.
   */
  clientUserMessageId?: string;
}

export interface CodexTurnSteerParams {
  threadId: string;
  expectedTurnId: string;
  input: CodexTurnSteerUserInput[];
  clientUserMessageId?: string;
}

export interface CodexTurnSteerResult {
  turnId: string;
}

export class CodexTurnSteerFailed extends Error {
  readonly code = "CodexTurnSteerFailed";

  constructor(
    message: string,
    readonly deliveryUnknown = false,
    options?: { cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "CodexTurnSteerFailed";
  }
}

export function isCodexTurnSteerFailed(error: unknown): error is CodexTurnSteerFailed {
  return error instanceof CodexTurnSteerFailed;
}

export function buildCodexTurnSteerParams(input: CodexTurnSteerInput): CodexTurnSteerParams {
  const threadId = input.threadId.trim();
  const turnId = input.turnId.trim();
  if (!threadId || !turnId) {
    throw new CodexTurnSteerFailed(
      "turn/steer requires threadId and turnId (expectedTurnId); refusing to pretend input was injected.",
    );
  }
  if (!Array.isArray(input.input) || input.input.length === 0) {
    throw new CodexTurnSteerFailed("turn/steer requires non-empty input; refusing empty mid-turn inject.");
  }
  const items: CodexTurnSteerUserInput[] = [];
  for (const [index, entry] of input.input.entries()) {
    if (!entry || typeof entry !== "object") {
      throw new CodexTurnSteerFailed(`turn/steer input[${index}] is invalid.`);
    }
    if (entry.type === "text") {
      const text = entry.text.trim();
      if (!text) {
        throw new CodexTurnSteerFailed(`turn/steer input[${index}] text must be non-empty.`);
      }
      items.push({ type: "text", text });
      continue;
    }
    if (entry.type === "localImage") {
      const imagePath = entry.path.trim();
      if (!imagePath) {
        throw new CodexTurnSteerFailed(`turn/steer input[${index}] localImage path is required.`);
      }
      items.push({
        type: "localImage",
        path: imagePath,
        ...(entry.detail === "low" || entry.detail === "high" ? { detail: entry.detail } : {}),
      });
      continue;
    }
    if (entry.type === "skill") {
      const name = entry.name.trim();
      const skillPath = entry.path.trim();
      if (!name || !skillPath) {
        throw new CodexTurnSteerFailed(`turn/steer input[${index}] skill requires name and path.`);
      }
      items.push({ type: "skill", name, path: skillPath });
      continue;
    }
    throw new CodexTurnSteerFailed(`turn/steer input[${index}] has unsupported type.`);
  }

  const clientUserMessageId = input.clientUserMessageId?.trim();
  return {
    threadId,
    expectedTurnId: turnId,
    input: items,
    ...(clientUserMessageId ? { clientUserMessageId } : {}),
  };
}

/**
 * Inject user input into an active Codex turn (`turn/steer`).
 * Success means app-server enqueued the input into the active turn's pending_input —
 * not that the model has finished reading it.
 * Failures are explicit (no active turn, expected id mismatch, non-steerable turn, RPC error).
 */
export async function steerCodexTurn(
  client: Pick<CodexAppServerClient, "request">,
  input: CodexTurnSteerInput,
): Promise<CodexTurnSteerResult> {
  const params = buildCodexTurnSteerParams(input);
  try {
    const result = await client.request<unknown>(CODEX_TURN_STEER_METHOD, params, {
      timeoutMs: CODEX_TURN_STEER_DEADLINE_MS,
    });
    return parseCodexTurnSteerResult(result, params.expectedTurnId);
  } catch (error) {
    if (isCodexTurnSteerFailed(error)) {
      throw error;
    }
    const detail = error instanceof Error ? error.message : String(error);
    const deliveryUnknown = !detail.startsWith(`${CODEX_TURN_STEER_METHOD} failed:`);
    const failed = new CodexTurnSteerFailed(
      `turn/steer failed for thread ${params.threadId} turn ${params.expectedTurnId}: ${detail}`,
      deliveryUnknown,
      { cause: error },
    );
    console.error(`[eco-codex] ${failed.message}`);
    throw failed;
  }
}

function parseCodexTurnSteerResult(value: unknown, expectedTurnId: string): CodexTurnSteerResult {
  if (!value || typeof value !== "object") {
    // Older wires may return {} — still ok if RPC succeeded; use expected id.
    return { turnId: expectedTurnId };
  }
  const record = value as Record<string, unknown>;
  const turnId =
    typeof record.turnId === "string" && record.turnId.trim() ? record.turnId.trim() : expectedTurnId;
  return { turnId };
}
