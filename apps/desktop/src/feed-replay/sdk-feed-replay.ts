import type { AgentEvent } from "@eco/runtime";
import type { ThreadRunEvent } from "../shared/ipc";
import type { ThreadRunProjectionSnapshot } from "../shared/thread-run-projection";
import { replaySdkAgentEventsThroughLivePipeline } from "../main/sdk-agent-events-replay";

export interface SdkFeedReplayResult {
  threadId: string;
  persistedEvents: ThreadRunEvent[];
  projection: ThreadRunProjectionSnapshot;
  fullProjection: ThreadRunProjectionSnapshot;
}

/** @deprecated Use replaySdkAgentEventsThroughLivePipeline from sdk-agent-events-replay.ts */
export async function replaySdkAgentEventsToFeed(input: {
  threadId: string;
  title: string;
  prompt: string;
  workspacePath?: string;
  agentEvents: AgentEvent[];
  runAttemptId?: string;
}): Promise<SdkFeedReplayResult> {
  const result = await replaySdkAgentEventsThroughLivePipeline(input);
  return {
    threadId: result.threadId,
    persistedEvents: result.persistedEvents,
    projection: result.projection,
    fullProjection: result.fullProjection,
  };
}

export { replaySdkAgentEventsThroughLivePipeline } from "../main/sdk-agent-events-replay";
