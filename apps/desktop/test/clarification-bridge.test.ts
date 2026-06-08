import { expect, test } from "bun:test";
import {
  buildAskUserQuestionUpdatedInput,
  buildIgnoredClarificationAnswers,
  cancelClarificationsForThread,
  formatClarificationAnswersSummary,
  getPendingClarificationByToolUseId,
  getPendingClarificationForThread,
  registerPendingClarification,
  submitClarification,
} from "../src/main/clarification-bridge";
import type { ClarificationRequest } from "../src/shared/ipc";

const request: ClarificationRequest = {
  toolUseId: "tool_1",
  threadId: "thr_1",
  questions: [
    {
      question: "新标记为客服主体时是否自动参与分配？",
      options: [
        { label: "自动启用", recommended: true },
        { label: "仅标记，不自动启用" },
      ],
    },
    {
      question: "导出范围",
      header: "Scope",
      multiSelect: true,
      options: [{ label: "已启用" }, { label: "备选" }],
    },
  ],
};

test("buildAskUserQuestionUpdatedInput matches Agent SDK answers format", () => {
  const rawInput = {
    questions: [
      {
        question: "新标记为客服主体时是否自动参与分配？",
        options: [{ label: "自动启用" }, { label: "仅标记，不自动启用" }],
      },
      {
        question: "导出范围",
        header: "Scope",
        multiSelect: true,
        options: [{ label: "已启用" }, { label: "备选" }],
      },
    ],
  };

  const updated = buildAskUserQuestionUpdatedInput(
    request,
    {
      toolUseId: "tool_1",
      selections: [["自动启用"], ["已启用", "备选"]],
    },
    rawInput,
  );

  expect(updated.questions).toBe(rawInput.questions);
  expect(updated.answers).toEqual({
    "新标记为客服主体时是否自动参与分配？": "自动启用",
    导出范围: ["已启用", "备选"],
  });
  expect(updated).not.toHaveProperty("answer");
});

test("buildIgnoredClarificationAnswers fills skip text for every question", () => {
  const answers = buildIgnoredClarificationAnswers(request);
  expect(answers.selections).toHaveLength(2);
  expect(answers.selections[0]?.[0]).toContain("忽略");
  expect(buildAskUserQuestionUpdatedInput(request, answers).answers).toEqual({
    "新标记为客服主体时是否自动参与分配？": "忽略 — 请根据代码与常见做法推进，并在计划中写明假设",
    导出范围: ["忽略 — 请根据代码与常见做法推进，并在计划中写明假设"],
  });
});

test("formatClarificationAnswersSummary renders readable activity text", () => {
  const summary = formatClarificationAnswersSummary(request, {
    toolUseId: "tool_1",
    selections: [["自动启用"], ["已启用", "备选"]],
  });
  expect(summary).toContain("澄清回答：");
  expect(summary).toContain("→ 自动启用");
  expect(summary).toContain("→ 已启用、备选");
});

test("pending clarification stays isolated until submitted or cancelled", async () => {
  const pending = registerPendingClarification("thr_pending", "tool_pending", {
    questions: request.questions,
  });

  expect(getPendingClarificationForThread("thr_pending")?.toolUseId).toBe("tool_pending");
  expect(getPendingClarificationByToolUseId("tool_pending")?.threadId).toBe("thr_pending");
  expect(submitClarification("tool_pending", { toolUseId: "tool_pending", selections: [["自动启用"], []] })).toBe(
    true,
  );
  await expect(pending).resolves.toEqual({
    toolUseId: "tool_pending",
    selections: [["自动启用"], []],
  });
  expect(getPendingClarificationForThread("thr_pending")).toBeUndefined();

  const cancelled = registerPendingClarification("thr_cancel", "tool_cancel", {
    questions: request.questions,
  });
  cancelClarificationsForThread("thr_cancel", "cancelled by phase 0 baseline");
  await expect(cancelled).rejects.toThrow("cancelled by phase 0 baseline");
  expect(submitClarification("tool_cancel", { toolUseId: "tool_cancel", selections: [] })).toBe(false);
});
