import { expect, test } from "bun:test";
import {
  CLARIFICATION_CUSTOM_OPTION_LABEL,
  isClarificationQuestionReady,
  optionRequiresCustomExplanation,
  resolveClarificationQuestionAnswer,
} from "../src/shared/clarification";

test("optionRequiresCustomExplanation detects explanation-style labels", () => {
  expect(optionRequiresCustomExplanation("否，请说明希望如何调整")).toBe(true);
  expect(optionRequiresCustomExplanation("其他")).toBe(true);
  expect(optionRequiresCustomExplanation("自动启用")).toBe(false);
});

test("resolveClarificationQuestionAnswer prefers custom text over options", () => {
  expect(
    resolveClarificationQuestionAnswer(["自动启用"], "需要仅对 VIP 客户启用"),
  ).toEqual(["需要仅对 VIP 客户启用"]);
  expect(resolveClarificationQuestionAnswer(["自动启用"], "  ")).toEqual(["自动启用"]);
  expect(
    resolveClarificationQuestionAnswer([CLARIFICATION_CUSTOM_OPTION_LABEL], "我的说明"),
  ).toEqual(["我的说明"]);
});

test("isClarificationQuestionReady requires text when explanation option selected", () => {
  expect(isClarificationQuestionReady(["自动启用"], "")).toBe(true);
  expect(isClarificationQuestionReady(["否，请说明希望如何调整"], "")).toBe(false);
  expect(isClarificationQuestionReady(["否，请说明希望如何调整"], "按 A 方案")).toBe(true);
  expect(isClarificationQuestionReady([], "直接说明")).toBe(true);
});
