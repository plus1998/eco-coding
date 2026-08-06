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
