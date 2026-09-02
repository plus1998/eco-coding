/**
 * @deprecated Prefer `@eco/runtime` / `codex-fork` — production rewind uses `thread/fork`.
 * Compatibility re-exports for existing `./codex-rollback.js` import paths.
 */
export {
  buildCodexThreadForkParams,
  CODEX_FORK_METHOD,
  CODEX_ROLLBACK_METHOD,
  CodexForkNotAvailable,
  type CodexForkNotAvailableOptions,
  CodexRollbackNotAvailable,
  type CodexThreadForkInput,
  type CodexThreadForkInput as CodexThreadRollbackInput,
  type CodexThreadForkParams,
  type CodexThreadForkResult,
  type CodexThreadForkResult as CodexThreadRollbackResult,
  forkCodexThread,
  forkCodexThread as rollbackCodexThread,
  resolveCodexRewindTargetTurnIndex,
} from "./codex-fork.js";
