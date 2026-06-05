import { expect, test } from "bun:test";
import {
  apiErrorDedupeKey,
  formatApiErrorActivitySummary,
  formatApiErrorUserMessage,
  parseLegacyApiErrorActivityMessage,
  parseOtelApiErrorAttribute,
} from "../src/api-error";

const screenshotRaw =
  '502 {"error":{"message":"Upstream request failed","type":"upstream_error"}}event: response.failed\ndata: {"type":"response.failed","response":{"error":{"code":"upstream_error","message":"Upstream request failed"}}}';

test("parseOtelApiErrorAttribute extracts 502 upstream_error from SDK error attribute", () => {
  const parsed = parseOtelApiErrorAttribute(screenshotRaw, "eco-reviewer-61324f8113a3");
  expect(parsed).toEqual({
    model: "eco-reviewer-61324f8113a3",
    statusCode: 502,
    code: "upstream_error",
    message: "上游模型服务暂时不可用，请稍后重试或切换 Provider。",
  });
});

test("formatApiErrorActivitySummary keeps short API error prefix for logging", () => {
  const parsed = parseOtelApiErrorAttribute(screenshotRaw);
  expect(formatApiErrorActivitySummary(parsed!)).toBe(
    "API error · 502 · 上游模型服务暂时不可用，请稍后重试或切换 Provider。",
  );
});

test("parseLegacyApiErrorActivityMessage handles cleaned activity lines", () => {
  const parsed = parseLegacyApiErrorActivityMessage(
    "API error · 502 · 上游模型服务暂时不可用，请稍后重试或切换 Provider。",
  );
  expect(parsed?.statusCode).toBe(502);
  expect(parsed?.message).toContain("上游模型服务暂时不可用");
});

test("parseOtelApiErrorAttribute maps model_not_found", () => {
  const parsed = parseOtelApiErrorAttribute(
    '404 {"error":{"message":"model not found","code":"model_not_found"}}',
  );
  expect(parsed?.code).toBe("model_not_found");
  expect(formatApiErrorUserMessage(parsed!)).toBe(
    "模型不存在或无权访问，请检查 Provider 配置与模型 ID。",
  );
});

test("apiErrorDedupeKey collapses identical failures", () => {
  const first = parseOtelApiErrorAttribute(screenshotRaw, "eco-reviewer");
  const second = parseOtelApiErrorAttribute(screenshotRaw, "eco-reviewer");
  expect(apiErrorDedupeKey(first!)).toBe(apiErrorDedupeKey(second!));
});
