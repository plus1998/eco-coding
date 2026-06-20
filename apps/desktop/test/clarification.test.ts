import { expect, test } from "bun:test";
import {
  CLARIFICATION_CUSTOM_OPTION_LABEL,
  isClarificationQuestionReady,
  optionRequiresCustomExplanation,
  resolveClarificationQuestionAnswer,
} from "../src/shared/clarification";

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
  expect(
    resolveClarificationQuestionAnswer(["自动启用"], "需要仅对 VIP 客户启用"),
  ).toEqual(["自动启用"]);
  expect(resolveClarificationQuestionAnswer(["自动启用"], "  ")).toEqual(["自动启用"]);
  expect(
    resolveClarificationQuestionAnswer([CLARIFICATION_CUSTOM_OPTION_LABEL], "我的说明"),
  ).toEqual(["我的说明"]);
});

test("isClarificationQuestionReady requires custom option and text for free-form answers", () => {
  expect(isClarificationQuestionReady(["自动启用"], "")).toBe(true);
  expect(isClarificationQuestionReady(["否，请说明希望如何调整"], "")).toBe(false);
  expect(isClarificationQuestionReady(["否，请说明希望如何调整"], "按 A 方案")).toBe(false);
  expect(isClarificationQuestionReady([CLARIFICATION_CUSTOM_OPTION_LABEL], "")).toBe(false);
  expect(isClarificationQuestionReady([CLARIFICATION_CUSTOM_OPTION_LABEL], "按 A 方案")).toBe(true);
});
