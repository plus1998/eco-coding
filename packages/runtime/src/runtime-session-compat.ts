import { CodexForkNotAvailable } from "./codex-fork.js";

/**
 * Phase 1 stub: Claude-style SDK checkpoint resume is not used on the Codex path.
 * Codex rewind uses `thread/fork` (+ lastTurnId) via the desktop/app-server path instead.
 *
 * @see packages/runtime/src/codex-fork.ts
 */
export async function resolveResumeSessionAtBeforeUserMessage(_input: {
  sessionId: string;
  userMessageId: string;
  dir: string;
}): Promise<string | undefined> {
  throw new CodexForkNotAvailable(
    "SDK session checkpoint resume was removed for the Codex path; Eco does not fall back to SDK rewind.",
    {
      nextAction:
        "Use Codex thread/fork with a Codex thread id and target item id (lastTurnId derived from turn history).",
    },
  );
}

/**
 * Resolve the last Claude transcript entry that must be kept before a user turn.
 * The explicit fork API uses this UUID as its inclusive `upToMessageId`.
 */
export async function resolveClaudeResumeSessionAtBeforeUserMessage(input: {
  sessionId: string;
  userMessageId: string;
  dir: string;
  loadSdk?: () => Promise<{
    getSessionMessages?: (
      sessionId: string,
      options?: { dir?: string; includeSystemMessages?: boolean },
    ) => Promise<unknown[]>;
  }>;
}): Promise<string | undefined> {
  const sessionId = input.sessionId.trim();
  const userMessageId = input.userMessageId.trim();
  const dir = input.dir.trim();
  if (!sessionId || !userMessageId || !dir) {
    throw new Error("Claude session id, user message id and directory are required.");
  }
  const sdk = input.loadSdk
    ? await input.loadSdk()
    : ((await import("@anthropic-ai/claude-agent-sdk")) as {
        getSessionMessages?: (
          sessionId: string,
          options?: { dir?: string; includeSystemMessages?: boolean },
        ) => Promise<unknown[]>;
      });
  if (typeof sdk.getSessionMessages !== "function") {
    throw new Error("Claude SDK getSessionMessages is unavailable; cannot safely fork history.");
  }
  const messages = await sdk.getSessionMessages(sessionId, {
    dir,
    includeSystemMessages: false,
  });
  const targetIndex = messages.findIndex(
    (message) =>
      message &&
      typeof message === "object" &&
      (message as { type?: unknown }).type === "user" &&
      (message as { uuid?: unknown }).uuid === userMessageId,
  );
  if (targetIndex < 0) {
    throw new Error("Claude session does not contain the selected user message.");
  }
  if (targetIndex === 0) return undefined;
  const previous = messages[targetIndex - 1];
  const previousUuid =
    previous && typeof previous === "object" && typeof (previous as { uuid?: unknown }).uuid === "string"
      ? (previous as { uuid: string }).uuid.trim()
      : "";
  if (!previousUuid) {
    throw new Error("Claude transcript before the selected message has no stable UUID.");
  }
  return previousUuid;
}

/**
 * Create the Claude SDK branch before Eco mutates its local history.
 *
 * The query-level `resumeSessionAt + resumeDropsTurn` pair can be rejected
 * after local state has already been pruned. The SDK's explicit fork API has
 * the same chain-entry semantics without that asynchronous rejection window.
 */
export async function forkClaudeSessionAt(input: {
  sessionId: string;
  dir: string;
  upToMessageId: string;
  loadSdk?: () => Promise<{
    forkSession?: (sessionId: string, options?: { dir?: string; upToMessageId?: string }) => Promise<unknown>;
  }>;
}): Promise<string> {
  const sessionId = input.sessionId.trim();
  const dir = input.dir.trim();
  const upToMessageId = input.upToMessageId.trim();
  if (!sessionId || !dir || !upToMessageId) {
    throw new Error("Claude session id, directory and fork point are required.");
  }

  const sdk = input.loadSdk
    ? await input.loadSdk()
    : ((await import("@anthropic-ai/claude-agent-sdk")) as {
        forkSession?: (
          sessionId: string,
          options?: { dir?: string; upToMessageId?: string },
        ) => Promise<unknown>;
      });
  if (typeof sdk.forkSession !== "function") {
    throw new Error("Claude SDK forkSession is unavailable; cannot safely fork history.");
  }

  const result = await sdk.forkSession(sessionId, { dir, upToMessageId });
  const forkedSessionId =
    result && typeof result === "object" && typeof (result as { sessionId?: unknown }).sessionId === "string"
      ? (result as { sessionId: string }).sessionId.trim()
      : "";
  if (!forkedSessionId) {
    throw new Error("Claude SDK forkSession returned no session id.");
  }
  if (forkedSessionId === sessionId) {
    throw new Error("Claude SDK forkSession returned the source session; refusing local history rewrite.");
  }
  return forkedSessionId;
}
