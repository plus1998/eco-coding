import path from "node:path";
import type { RuntimeRoleRouteConfig } from "../shared/ipc";
import { computeRouteFingerprint } from "../shared/route-fingerprint";

/**
 * Formal Claude session resume decision for cwd / session integrity.
 * Replaces log-only `noteSdkSessionRouteChange` as the behavioral source of truth.
 *
 * Gateway always presents Anthropic `/messages` to Claude Agent SDK; `apiCompat` only
 * changes upstream translation. Route/apiCompat drift therefore still resumes the same
 * session — Gateway bugs are fixed in Gateway, not by forcing a new sessionId.
 *
 * Eco compact is NOT a resume decision: continuation orchestration builds the handoff
 * prompt and starts a new session without calling resume.
 */
export type ClaudeResumeDecision = { kind: "resume"; sessionId: string } | { kind: "reject"; reason: string };

export interface ClaudeResumeRouteSnapshot {
  fingerprint: string;
}

export interface DecideClaudeResumeInput {
  sessionId: string;
  /** Previous route fingerprint when the session was captured (may be missing). */
  previousRoutes?: ClaudeResumeRouteSnapshot;
  /** Routes for the upcoming run. */
  nextRoutes: ClaudeResumeRouteSnapshot;
  /** Session cwd recorded with the SDK session. */
  sessionCwd: string;
  /** Cwd for the upcoming run (worktree / workspace). */
  nextCwd: string;
  /** False when session cwd path is missing on disk. */
  sessionCwdExists: boolean;
  /** True when the stored session is known corrupt / unreadable. */
  sessionCorrupt?: boolean;
}

export function snapshotClaudeResumeRoutes(
  routes: readonly RuntimeRoleRouteConfig[],
): ClaudeResumeRouteSnapshot {
  return {
    fingerprint: computeRouteFingerprint(routes),
  };
}

/**
 * Pure Claude resume policy.
 *
 * | Change | Decision |
 * |---|---|
 * | Route unchanged | resume |
 * | Route / apiCompat / model / provider drift | resume |
 * | cwd missing or changed | reject (new session, no resume) |
 * | Session corrupt | reject |
 */
export function decideClaudeResume(input: DecideClaudeResumeInput): ClaudeResumeDecision {
  const sessionId = input.sessionId.trim();
  if (!sessionId) {
    return { kind: "reject", reason: "Missing Claude SDK session id." };
  }

  if (input.sessionCorrupt) {
    return {
      kind: "reject",
      reason: "Claude SDK session is corrupt; refusing silent empty-context resume.",
    };
  }

  if (!input.sessionCwdExists) {
    return {
      kind: "reject",
      reason: "Claude session cwd no longer exists; start a new session without resume.",
    };
  }

  const sessionCwd = normalizeCwd(input.sessionCwd);
  const nextCwd = normalizeCwd(input.nextCwd);
  if (!sessionCwd || !nextCwd || sessionCwd !== nextCwd) {
    return {
      kind: "reject",
      reason: "Claude session cwd changed; start a new session without resume.",
    };
  }

  // cwd + integrity passed — resume stored session (including apiCompat / model drift).
  // Route fingerprints remain for diagnostics / noteSdkSessionRouteChange only.
  return { kind: "resume", sessionId };
}

function normalizeCwd(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return path.resolve(trimmed);
}
