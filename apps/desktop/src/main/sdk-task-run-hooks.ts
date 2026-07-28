import type { EcoTaskTrackerHooks } from "@eco/runtime";
import type { EcoHookContext } from "@eco/runtime/sdk";

export type SdkTaskStopStatus = "completed" | "blocked" | "cancelled";

export type SdkRunHookContextExtras = Partial<EcoHookContext> & {
  peekPendingCoderTodoId?: () => string | undefined;
};

export interface SdkTaskRunHooks {
  hookContextExtras: SdkRunHookContextExtras;
  getStopStatus(): SdkTaskStopStatus;
  setStopStatus(status: SdkTaskStopStatus): void;
  stopIfUnhandled(status: SdkTaskStopStatus): boolean;
  wasStopHandled(): boolean;
}

export function createSdkTaskRunHooks(input: {
  createHookHandlers(getStopStatus: () => SdkTaskStopStatus): EcoTaskTrackerHooks;
  initialStatus?: SdkTaskStopStatus;
}): SdkTaskRunHooks {
  let stopStatus = input.initialStatus ?? "completed";
  let stopHandled = false;
  const taskTracker = input.createHookHandlers(() => stopStatus);

  const handleStop = (status: SdkTaskStopStatus): boolean => {
    if (stopHandled) {
      return false;
    }
    stopHandled = true;
    taskTracker.onStop(status);
    return true;
  };

  const hookContextExtras: SdkRunHookContextExtras = {
    taskTracker: {
      ...taskTracker,
      onStop: (status) => {
        handleStop(status);
      },
    },
    getStopTodoStatus: () => stopStatus,
    ...(taskTracker.peekPendingCoderTodoId && {
      peekPendingCoderTodoId: taskTracker.peekPendingCoderTodoId,
    }),
  };

  return {
    hookContextExtras,
    getStopStatus: () => stopStatus,
    setStopStatus(status) {
      stopStatus = status;
    },
    stopIfUnhandled(status) {
      stopStatus = status;
      return handleStop(status);
    },
    wasStopHandled: () => stopHandled,
  };
}
