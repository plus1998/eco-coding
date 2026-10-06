import { expect, test } from "bun:test";
import { createClarificationQueueSync } from "../src/renderer/clarification-queue-sync";
import {
  registerPendingClarification,
  getPendingClarificationForThread,
  submitClarification,
} from "../src/main/clarification-bridge";
import type { ClarificationRequest } from "../src/shared/ipc";

test("new questions keep the displayed head and draft until the current question is answered", async () => {
  let displayed: ClarificationRequest | undefined;
  let draft = "正在填写第一题";
  const refresh = createClarificationQueueSync({
    getPending: async (id) => getPendingClarificationForThread(id),
    apply: (_id, request) => {
      if (displayed && displayed.toolUseId !== request?.toolUseId) draft = "";
      displayed = request;
    },
  });
  const first = registerPendingClarification("queue-sync", "question-first", {
    questions: [],
    delivery: "async",
    blocking: false,
  });
  await refresh("queue-sync");
  const second = registerPendingClarification("queue-sync", "question-second", {
    questions: [],
    delivery: "async",
    blocking: false,
  });
  await refresh("queue-sync");
  expect(displayed?.toolUseId).toBe("question-first");
  expect(draft).toBe("正在填写第一题");
  submitClarification("question-first", { toolUseId: "question-first", selections: [["A"]] });
  await first;
  await refresh("queue-sync");
  expect(displayed?.toolUseId).toBe("question-second");
  submitClarification("question-second", { toolUseId: "question-second", selections: [["B"]] });
  await second;
});

test("an older snapshot cannot overwrite the next question or clear its draft", async () => {
  const resolvers: Array<(request: ClarificationRequest | undefined) => void> = [];
  let displayed: ClarificationRequest | undefined;
  const refresh = createClarificationQueueSync({
    getPending: () => new Promise((resolve) => resolvers.push(resolve)),
    apply: (_id, request) => {
      displayed = request;
    },
  });
  const old = refresh("queue-race");
  const latest = refresh("queue-race");
  resolvers[1]!({ toolUseId: "next-question", threadId: "queue-race", questions: [] });
  await latest;
  resolvers[0]!(undefined);
  await old;
  expect(displayed?.toolUseId).toBe("next-question");
});
