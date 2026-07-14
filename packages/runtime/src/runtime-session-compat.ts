import { CodexRollbackNotAvailable } from "./codex-rollback.js";

/**
 * Phase 1 stub: SDK checkpoint resume was removed. Codex rewind will use
 * `thread/rollback` (app-server) instead of `rewindSessionFiles`.
 *
 * @see docs/codex-integration-plan.md §4.4.2 (thread/rollback)
 * @see docs/codex-integration-plan.md §F20 (Rewind / Rollback — Phase 2+)
 */
export async function resolveResumeSessionAtBeforeUserMessage(_input: {
  sessionId: string;
  userMessageId: string;
  dir: string;
}): Promise<string | undefined> {
  throw new CodexRollbackNotAvailable(
    "SDK session checkpoint resume was removed in Phase 1; Eco does not fall back to SDK rewind.",
    {
      nextAction:
        "Use Codex thread/rollback with a Codex thread id and target item id (see docs/codex-integration-plan.md §F20).",
    },
  );
}
