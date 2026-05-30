import { expect, test } from "bun:test";
import { SdkStreamActivityBridge } from "../src/main/sdk-stream-activity";

test("suppresses redundant OTel tool line after SDK tool start", () => {
  const bridge = new SdkStreamActivityBridge();
  bridge.noteSdkToolActivity("thr_1", {
    type: "tool_use",
    tool_name: "Read",
    streaming: true,
  });
  expect(bridge.shouldSuppressOtelToolLine("thr_1", "Tool: Read")).toBe(true);
  expect(bridge.shouldSuppressOtelToolLine("thr_1", "Tool: Read · styles.css")).toBe(false);
});

test("allows OTel tool line with detail when SDK only showed name", () => {
  const bridge = new SdkStreamActivityBridge();
  bridge.noteSdkToolActivity("thr_1", {
    type: "tool_use",
    tool_name: "Grep",
    tool_use_id: "toolu_1",
  });
  expect(bridge.shouldSuppressOtelToolLine("thr_1", "Tool: Grep · pattern")).toBe(false);
});
