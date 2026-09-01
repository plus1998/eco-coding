import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createConversationStore } from "../../src/main/conversation-store";
import type { ThreadSummary } from "../../src/shared/ipc";

export const E2E_FEED_SKELETON_THREAD_ID = "thr_e2e_feed_skeleton";

export async function seedFeedSkeletonE2eData(databasePath: string): Promise<void> {
  mkdirSync(dirname(databasePath), { recursive: true });
  const store = await createConversationStore(databasePath);

  store.deleteThread(E2E_FEED_SKELETON_THREAD_ID);

  const thread: ThreadSummary = {
    id: E2E_FEED_SKELETON_THREAD_ID,
    title: "E2E Feed Skeleton",
    prompt: "e2e feed skeleton prompt",
    workspacePath: "/tmp/eco-e2e-feed-skeleton",
    status: "idle",
    message: "e2e feed skeleton response",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:02.000Z",
  };
  store.saveThread(thread);
  store.upsertRunAttempt({
    attemptId: "att_e2e_feed_skeleton",
    threadId: E2E_FEED_SKELETON_THREAD_ID,
    phase: "run",
    retryIndex: 0,
    status: "completed",
    startedAt: "2026-01-01T00:00:01.000Z",
    endedAt: "2026-01-01T00:00:02.000Z",
  });
  store.appendThreadRunEvent({
    id: "e2e_user_1",
    threadId: E2E_FEED_SKELETON_THREAD_ID,
    sequence: 1,
    eventType: "message.final",
    scope: "main",
    role: "user",
    streamState: "finalized",
    message: "e2e feed skeleton prompt",
    observedAt: "2026-01-01T00:00:01.000Z",
    metadata: { liveType: "thread.user_prompt" },
  });
  store.appendThreadRunEvent({
    id: "e2e_final_1",
    threadId: E2E_FEED_SKELETON_THREAD_ID,
    sequence: 2,
    eventType: "message.final",
    scope: "main",
    role: "coder",
    streamState: "finalized",
    message: "e2e feed skeleton response",
    observedAt: "2026-01-01T00:00:02.000Z",
    runAttemptId: "att_e2e_feed_skeleton",
  });
}
