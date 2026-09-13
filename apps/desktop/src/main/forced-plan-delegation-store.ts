import { randomUUID } from "node:crypto";
import type { ForcedPlanDelegationAttempt } from "@eco/runtime/forced-plan-delegation";

/**
 * One-shot ledger for "指定子代理执行已批准计划".
 *
 * Lifecycle: armed → spawned → completed. Any deviation (wrong role, duplicate
 * spawn, subagent error, cancelled run) lands on `failed` or `violated` so the
 * pending plan can be restored and reported honestly. A `completed` attempt is the
 * only state that may be treated as a normal finish.
 */
export interface ArmForcedPlanDelegationInput {
  threadId: string;
  coreKind: string;
  agentKey: string;
  canonicalTask: string;
  runAttemptId?: string;
  now?: string;
}

export interface ClaimForcedPlanDelegationSpawnInput {
  threadId: string;
  agentKey: string;
  toolUseId?: string;
  runAttemptId?: string;
}

export type ClaimForcedPlanDelegationResult =
  | { ok: true; attempt: ForcedPlanDelegationAttempt }
  | { ok: false; reason: string; attempt: ForcedPlanDelegationAttempt };

export function normalizeDelegationAgentKey(value: string | undefined | null): string {
  const trimmed = value?.trim().toLowerCase() ?? "";
  if (!trimmed) {
    return "";
  }
  return trimmed.startsWith("eco_") ? trimmed.slice("eco_".length) : trimmed;
}

export class ForcedPlanDelegationStore {
  private readonly byThread = new Map<string, ForcedPlanDelegationAttempt>();

  arm(input: ArmForcedPlanDelegationInput): ForcedPlanDelegationAttempt {
    const attempt: ForcedPlanDelegationAttempt = {
      runAttemptId: input.runAttemptId ?? randomUUID(),
      threadId: input.threadId,
      coreKind: input.coreKind,
      agentKey: input.agentKey,
      canonicalTask: input.canonicalTask,
      status: "armed",
      createdAt: input.now ?? new Date().toISOString(),
    };
    this.byThread.set(input.threadId, attempt);
    return attempt;
  }

  get(threadId: string): ForcedPlanDelegationAttempt | undefined {
    return this.byThread.get(threadId);
  }

  /**
   * Claim the single allowed spawn. Returns a `violated` attempt (without claiming)
   * for a duplicate spawn or a wrong role, so the caller can fail the run loudly.
   */
  claimSpawn(input: ClaimForcedPlanDelegationSpawnInput): ClaimForcedPlanDelegationResult {
    const attempt = this.byThread.get(input.threadId);
    if (!attempt) {
      return {
        ok: false,
        reason: `No forced plan delegation is armed for thread ${input.threadId}.`,
        attempt: {
          runAttemptId: "unarmed",
          threadId: input.threadId,
          coreKind: "unknown",
          agentKey: input.agentKey,
          canonicalTask: "",
          status: "violated",
          createdAt: new Date().toISOString(),
        },
      };
    }
    if (input.runAttemptId && input.runAttemptId !== attempt.runAttemptId) {
      return {
        ok: false,
        reason: `Forced plan delegation attempt mismatch for thread ${input.threadId}.`,
        attempt,
      };
    }
    if (attempt.status !== "armed") {
      const violated: ForcedPlanDelegationAttempt = {
        ...attempt,
        status: "violated",
        failureReason: `计划委派只能执行一次，检测到重复委派（当前状态：${attempt.status}）。`,
      };
      this.byThread.set(input.threadId, violated);
      return { ok: false, reason: violated.failureReason ?? "", attempt: violated };
    }
    const wanted = normalizeDelegationAgentKey(attempt.agentKey);
    const requested = normalizeDelegationAgentKey(input.agentKey);
    if (!requested || wanted !== requested) {
      const violated: ForcedPlanDelegationAttempt = {
        ...attempt,
        status: "violated",
        failureReason: `计划被委派给「${input.agentKey || "unknown"}」，但用户指定的是「${attempt.agentKey}」。`,
      };
      this.byThread.set(input.threadId, violated);
      return { ok: false, reason: violated.failureReason ?? "", attempt: violated };
    }
    const spawned: ForcedPlanDelegationAttempt = {
      ...attempt,
      status: "spawned",
      ...(input.toolUseId ? { spawnToolUseId: input.toolUseId } : {}),
    };
    this.byThread.set(input.threadId, spawned);
    return { ok: true, attempt: spawned };
  }

  complete(threadId: string, runAttemptId?: string): ForcedPlanDelegationAttempt | undefined {
    const attempt = this.byThread.get(threadId);
    if (!attempt || (runAttemptId && runAttemptId !== attempt.runAttemptId)) {
      return attempt;
    }
    if (attempt.status !== "spawned" && attempt.status !== "completed") {
      // Guard against reporting success without a real spawn; leave the record untouched.
      return attempt;
    }
    const completed: ForcedPlanDelegationAttempt = {
      ...attempt,
      status: "completed",
    };
    delete completed.failureReason;
    this.byThread.set(threadId, completed);
    return completed;
  }

  fail(threadId: string, reason: string, runAttemptId?: string): ForcedPlanDelegationAttempt | undefined {
    const attempt = this.byThread.get(threadId);
    if (!attempt || (runAttemptId && runAttemptId !== attempt.runAttemptId)) {
      return attempt;
    }
    if (attempt.status === "violated") {
      return attempt;
    }
    const failed: ForcedPlanDelegationAttempt = {
      ...attempt,
      status: "failed",
      failureReason: reason,
    };
    this.byThread.set(threadId, failed);
    return failed;
  }

  release(threadId: string): void {
    this.byThread.delete(threadId);
  }

  clearAll(): void {
    this.byThread.clear();
  }
}
