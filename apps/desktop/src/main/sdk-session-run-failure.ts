/**
 * Round-failure policy for the Claude SDK session pointer.
 *
 * Network / API / model errors must keep `sdk_session_id` so the next turn
 * resumes the same JSONL. Clearing is reserved for rewind, a deleted
 * worktree cwd, and `decideClaudeResume` cwd reject — not this path.
 *
 * `onFailed` must call `assertSdkSessionRetainedOnRunFailure` instead of
 * `clearSdkSession`. If this policy ever flipped, fail loud rather than
 * silently dropping the session again.
 */
export function shouldClearSdkSessionOnRunFailure(_input: { hadResume: boolean; reason: string }): boolean {
  return false;
}

export function assertSdkSessionRetainedOnRunFailure(input: { hadResume: boolean; reason: string }): void {
  if (shouldClearSdkSessionOnRunFailure(input)) {
    throw new Error("Run failure must not clear the Claude SDK session.");
  }
}
