import { extractSdkRunFailure } from "@eco/runtime/sdk";
import type { RequestAttemptResult } from "./request-retry";

export interface SdkRunEventLike {
  type: string;
  payload: unknown;
}

export interface ConsumeSdkRunEventsInput<TEvent extends SdkRunEventLike> {
  events: AsyncIterable<TEvent>;
  threadId: string;
  worktreePath: string;
  signal: AbortSignal;
  onUsageRecorded: (threadId: string, event: TEvent) => void;
  captureSession: (threadId: string, event: TEvent, worktreePath: string) => void;
  emitActivity: (threadId: string, event: TEvent) => void;
  onEvent?: (event: TEvent) => void | Promise<void>;
}

export async function consumeSdkRunEvents<TEvent extends SdkRunEventLike>(
  input: ConsumeSdkRunEventsInput<TEvent>,
): Promise<RequestAttemptResult> {
  let sdkFailure: string | undefined;

  for await (const event of input.events) {
    if (event.type === "usage.recorded") {
      sdkFailure = extractSdkRunFailure(event.payload) ?? sdkFailure;
      input.onUsageRecorded(input.threadId, event);
      continue;
    }

    input.captureSession(input.threadId, event, input.worktreePath);
    await input.onEvent?.(event);
    input.emitActivity(input.threadId, event);
  }

  if (input.signal.aborted) {
    return { ok: false, reason: "cancelled by user", aborted: true };
  }
  if (sdkFailure) {
    return { ok: false, reason: sdkFailure };
  }
  return { ok: true };
}
