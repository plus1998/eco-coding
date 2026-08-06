import { expect, test } from "bun:test";
import { submitClarification } from "../src/main/clarification-bridge";
import {
  CODEX_TOOL_REQUEST_USER_INPUT,
  type CodexApprovalBridgeDeps,
  handleCodexServerRequest,
} from "../src/main/codex-approval-bridge";
import type { ThreadLiveEvent } from "../src/shared/ipc";

test("Codex clarification publishes the answered summary and exits the waiting status", async () => {
  const events: ThreadLiveEvent[] = [];
  const statuses: Array<{ status: string; message: string }> = [];
  const deps: CodexApprovalBridgeDeps = {
    resolveEcoThreadId: () => "thread-1",
    getThread: () => ({ prompt: "实现功能", workspacePath: "/workspace" }),
    getWorktreePath: () => undefined,
    getPlannerAgentId: () => "planner-1",
    getRoutesJson: () => "[]",
    savePendingPlan: () => undefined,
    emitThreadLive: (event) => events.push(event),
    updateThreadStatus: (_threadId, patch) => statuses.push(patch),
  };

  const response = handleCodexServerRequest(deps, CODEX_TOOL_REQUEST_USER_INPUT, {
    threadId: "codex-thread-1",
    turnId: "turn-1",
    itemId: "question-1",
    questions: [
      {
        id: "deployment",
        header: "部署方式",
        question: "应该使用哪种部署方式？",
        options: [
          { label: "蓝绿部署", description: "保持两套环境" },
          { label: "滚动发布", description: "逐步替换实例" },
        ],
      },
    ],
  });

  expect(
    submitClarification("question-1", {
      toolUseId: "question-1",
      selections: [["蓝绿部署"]],
    }),
  ).toBe(true);
  await expect(response).resolves.toEqual({
    answers: { deployment: { answers: ["蓝绿部署"] } },
  });

  expect(statuses).toEqual([
    { status: "running", message: "等待你的回答…" },
    { status: "running", message: "正在继续处理…" },
  ]);
  expect(events.map((event) => event.type)).toEqual(["clarification.requested", "clarification.answered"]);
  expect(events[1]?.message).toBe("澄清回答：应该使用哪种部署方式？ → 蓝绿部署");
  expect(events[0]?.tool).toEqual({
    name: "AskUserQuestion",
    toolUseId: "question-1",
    status: "started",
  });
  expect(events[1]?.tool).toEqual({
    name: "AskUserQuestion",
    toolUseId: "question-1",
    status: "completed",
  });
});
