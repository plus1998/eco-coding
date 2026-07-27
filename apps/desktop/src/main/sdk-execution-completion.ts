import type { EcoTaskCompletionState } from "@eco/runtime";
import type { RequestAttemptResult } from "./request-retry";

export function validateSdkExecutionCompletion(
  result: RequestAttemptResult,
  state: EcoTaskCompletionState,
): RequestAttemptResult {
  if (!result.ok) {
    return result;
  }

  if (state.openTasks.length > 0) {
    const titles = state.openTasks
      .slice(0, 3)
      .map((task) => task.title)
      .join("；");
    return {
      ok: false,
      incomplete: true,
      reason: `执行未完成：仍有 ${state.openTasks.length} 个任务未完成（${titles}）。`,
    };
  }

  if (!state.hasSubstantiveToolUse) {
    return {
      ok: false,
      incomplete: true,
      reason: "执行未完成：本轮没有成功执行写入、命令或验证工具，无法确认需求已经实施。",
    };
  }

  return result;
}
