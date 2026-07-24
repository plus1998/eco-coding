import { expect, test } from "bun:test";
import { createElement } from "react";
import { ClarificationPanel } from "../src/renderer/ClarificationPanel";
import {
  CLARIFICATION_CUSTOM_OPTION_LABEL,
  isClarificationQuestionReady,
  optionRequiresCustomExplanation,
  resolveClarificationQuestionAnswer,
} from "../src/shared/clarification";
import { renderLocalized } from "./i18n-test";

test("optionRequiresCustomExplanation detects explanation-style labels", () => {
  expect(optionRequiresCustomExplanation("否，请说明希望如何调整")).toBe(true);
  expect(optionRequiresCustomExplanation("其他")).toBe(false);
  expect(optionRequiresCustomExplanation("其他方案")).toBe(false);
  expect(optionRequiresCustomExplanation(CLARIFICATION_CUSTOM_OPTION_LABEL)).toBe(true);
  expect(optionRequiresCustomExplanation("自动启用")).toBe(false);
});

test("isClarificationQuestionReady allows plain 其他 options", () => {
  expect(isClarificationQuestionReady(["其他"], "")).toBe(true);
  expect(isClarificationQuestionReady(["其他方案"], "")).toBe(true);
});

test("resolveClarificationQuestionAnswer prefers custom text over options", () => {
  expect(resolveClarificationQuestionAnswer(["自动启用"], "需要仅对 VIP 客户启用")).toEqual(["自动启用"]);
  expect(resolveClarificationQuestionAnswer(["自动启用"], "  ")).toEqual(["自动启用"]);
  expect(resolveClarificationQuestionAnswer([CLARIFICATION_CUSTOM_OPTION_LABEL], "我的说明")).toEqual([
    "我的说明",
  ]);
});

test("isClarificationQuestionReady requires custom option and text for free-form answers", () => {
  expect(isClarificationQuestionReady(["自动启用"], "")).toBe(true);
  expect(isClarificationQuestionReady(["否，请说明希望如何调整"], "")).toBe(false);
  expect(isClarificationQuestionReady(["否，请说明希望如何调整"], "按 A 方案")).toBe(false);
  expect(isClarificationQuestionReady([CLARIFICATION_CUSTOM_OPTION_LABEL], "")).toBe(false);
  expect(isClarificationQuestionReady([CLARIFICATION_CUSTOM_OPTION_LABEL], "按 A 方案")).toBe(true);
});

test("ClarificationPanel renders the AskUserQuestion surface as a Composer dock", () => {
  const markup = renderLocalized(
    createElement(ClarificationPanel, {
      request: {
        threadId: "thread-1",
        toolUseId: "tool-1",
        questions: [
          {
            question: "选择一种处理方式",
            options: [{ label: "软删除 (Recommended)", description: "保留审计记录" }],
            multiSelect: false,
          },
        ],
      },
      variant: "dock",
      onSubmit: () => {},
      onDismiss: () => {},
    }),
    "zh-CN",
  );

  expect(markup).toContain("clarification-dock-shell");
  expect(markup).toContain('aria-label="关闭问题"');
  expect(markup).not.toContain("跳过");
  expect(markup).not.toContain("下一题");
  expect(markup).toContain("确认");
  expect(markup).toContain("（推荐）");
  expect(markup).not.toContain("(Recommended)");
  expect(markup).toContain("is-highlighted");
});

test("ClarificationPanel advances intermediate single-choice questions without a next button", () => {
  const markup = renderLocalized(
    createElement(ClarificationPanel, {
      request: {
        threadId: "thread-1",
        toolUseId: "tool-1",
        questions: [
          {
            question: "第一题",
            options: [{ label: "选项一", description: "说明" }],
            multiSelect: false,
          },
          {
            question: "第二题",
            options: [{ label: "选项二", description: "说明" }],
            multiSelect: false,
          },
        ],
      },
      variant: "dock",
      onSubmit: () => {},
      onDismiss: () => {},
    }),
    "zh-CN",
  );

  expect(markup).toContain("跳过");
  expect(markup).not.toContain(">下一题<");
  expect(markup).not.toContain(">确认<");
});

test("ClarificationPanel normalizes Codex full-width recommended labels", () => {
  const markup = renderLocalized(
    createElement(ClarificationPanel, {
      request: {
        threadId: "thread-1",
        toolUseId: "tool-1",
        questions: [
          {
            question: "是否保留记录？",
            options: [{ label: "保留（Recommended）", description: "便于审计" }],
            multiSelect: false,
          },
        ],
      },
      variant: "dock",
      onSubmit: () => {},
      onDismiss: () => {},
    }),
    "zh-CN",
  );

  expect(markup).toContain("（推荐）");
  expect(markup).not.toContain("（Recommended）");
});
