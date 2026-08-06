/**
 * @deprecated Prefer `@eco/runtime` / `codex-fork` — production rewind uses `thread/fork`.
 * Compatibility re-exports for existing `./codex-rollback.js` import paths.
 */
export {
  CODEX_FORK_METHOD,
  CODEX_ROLLBACK_METHOD,
  CodexForkNotAvailable,
  CodexRollbackNotAvailable,
  buildCodexThreadForkParams,
  forkCodexThread,
  forkCodexThread as rollbackCodexThread,
  resolveCodexRewindTargetTurnIndex,
  type CodexForkNotAvailableOptions,
  type CodexThreadForkInput,
  type CodexThreadForkInput as CodexThreadRollbackInput,
  type CodexThreadForkParams,
  type CodexThreadForkResult,
  type CodexThreadForkResult as CodexThreadRollbackResult,
} from "./codex-fork.js";
