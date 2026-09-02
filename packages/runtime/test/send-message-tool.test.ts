import { expect, test } from "bun:test";
import {
  formatSendMessageToolInputSummary,
  formatSendMessageToolResultSummary,
  parseSendMessageToolResult,
  readSendMessageToolInput,
} from "../src/send-message-tool";

test("readSendMessageToolInput extracts recipient, summary, and message", () => {
  expect(
    readSendMessageToolInput({
      to: "a897f866adcc1af29",
      summary: "继续实现 App 权限与测试",
      message: "请继续完成剩余实现，不要等待确认。",
    }),
  ).toEqual({
    recipient: "a897f866adcc1af29",
    summary: "继续实现 App 权限与测试",
    message: "请继续完成剩余实现，不要等待确认。",
  });
});

test("formatSendMessageToolInputSummary prefers summary with recipient prefix", () => {
  expect(
    formatSendMessageToolInputSummary({
      to: "a897f866adcc1af29",
      summary: "继续实现 App 权限与测试",
      message: "请继续完成剩余实现，不要等待确认。",
    }),
  ).toBe("→ a897f866… · 继续实现 App 权限与测试");
});

test("parseSendMessageToolResult reads JSON output and plain text fallback", () => {
  expect(
    parseSendMessageToolResult(
      JSON.stringify({
        success: true,
        message: 'Agent "a897f866adcc1af29" had no active task; resumed from transcript in the background.',
        resumedAgentId: "a897f866adcc1af29",
      }),
    ),
  ).toEqual({
    success: true,
    resultMessage: 'Agent "a897f866adcc1af29" had no active task; resumed from transcript in the background.',
    resumedAgentId: "a897f866adcc1af29",
  });

  expect(parseSendMessageToolResult("resume failed")).toEqual({
    resultMessage: "resume failed",
  });
});

test("formatSendMessageToolResultSummary prefers result message", () => {
  expect(
    formatSendMessageToolResultSummary({
      success: true,
      resultMessage:
        'Agent "a897f866adcc1af29" had no active task; resumed from transcript in the background.',
      resumedAgentId: "a897f866adcc1af29",
    }),
  ).toBe('Agent "a897f866adcc1af29" had no active task; resumed from transcript in the background.');
});
