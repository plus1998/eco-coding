import type { EcoSdkResumeOptions } from "@eco/runtime";
import { buildEcoCompactHandoffPrompt, type ThreadCompactHandoffData } from "../shared/eco-compact-handoff";

export interface PreparedSdkRunAfterContextCompaction {
  prompt: string;
  resume?: EcoSdkResumeOptions;
}

export interface PrepareSdkRunAfterContextCompactionInput {
  threadId: string;
  prompt: string;
  worktreePath: string;
  resume?: EcoSdkResumeOptions | undefined;
  signal: AbortSignal;
}

export interface PrepareSdkRunAfterContextCompactionServices {
  ensureHeadroom(
    threadId: string,
    worktreePath: string,
    signal: AbortSignal,
    options: { ignoreRunningGuard: true },
  ): Promise<boolean>;
  getCompactHandoff(
    threadId: string,
  ): Pick<ThreadCompactHandoffData, "summary" | "recentMessages"> | undefined;
  getThreadPrompt(threadId: string): string | undefined;
}

export async function prepareSdkRunContextAfterCompaction(
  input: PrepareSdkRunAfterContextCompactionInput,
  services: PrepareSdkRunAfterContextCompactionServices,
): Promise<PreparedSdkRunAfterContextCompaction> {
  if (!input.resume?.resumeSessionId) {
    return { prompt: input.prompt };
  }
  const compacted = await services.ensureHeadroom(input.threadId, input.worktreePath, input.signal, {
    ignoreRunningGuard: true,
  });
  if (!compacted) {
    return { prompt: input.prompt, resume: input.resume };
  }

  const handoff = services.getCompactHandoff(input.threadId);
  if (!handoff) {
    throw new Error("上下文压缩已清除 SDK 会话，但未生成可恢复的压缩交接内容。");
  }
  const threadPrompt = services.getThreadPrompt(input.threadId);
  if (threadPrompt === undefined) {
    throw new Error("上下文压缩后找不到线程记录，无法启动新 SDK 会话。");
  }
  return {
    prompt: buildEcoCompactHandoffPrompt(threadPrompt, input.prompt, handoff),
  };
}
