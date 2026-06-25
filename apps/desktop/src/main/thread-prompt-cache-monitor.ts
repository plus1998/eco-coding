import {
  buildPromptCacheFingerprint,
  diffPromptCacheFingerprint,
  type PromptCacheBreakReason,
  type PromptCacheFingerprint,
} from "./prompt-cache-fingerprint";

export class ThreadPromptCacheMonitor {
  private readonly baselines = new Map<string, PromptCacheFingerprint>();

  clearThread(threadId: string): void {
    this.baselines.delete(threadId);
  }

  /** Returns break reasons when fingerprint changed after the thread baseline was set. */
  observe(threadId: string, next: PromptCacheFingerprint): PromptCacheBreakReason[] {
    const previous = this.baselines.get(threadId);
    if (!previous) {
      this.baselines.set(threadId, next);
      return [];
    }
    const reasons = diffPromptCacheFingerprint(previous, next);
    if (reasons.length === 0) {
      return [];
    }
    this.baselines.set(threadId, next);
    return reasons;
  }
}

export async function resolveThreadPromptCacheFingerprint(input: {
  profileId: string;
  mcpServerKeys: readonly string[];
  workspacePath?: string;
  userHomeDir: string;
  includeUserClaudeMd: boolean;
  resolveClaudeMdDigest: (options: {
    workspacePath?: string;
    userHomeDir: string;
    includeUserSource: boolean;
  }) => Promise<string>;
}): Promise<PromptCacheFingerprint> {
  const claudeMdDigest = await input.resolveClaudeMdDigest({
    ...(input.workspacePath ? { workspacePath: input.workspacePath } : {}),
    userHomeDir: input.userHomeDir,
    includeUserSource: input.includeUserClaudeMd,
  });
  return buildPromptCacheFingerprint({
    profileId: input.profileId,
    mcpServerKeys: input.mcpServerKeys,
    claudeMdDigest,
  });
}
