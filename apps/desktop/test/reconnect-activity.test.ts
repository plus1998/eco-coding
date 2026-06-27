import { expect, test } from "bun:test";
import {
  isReconnectActivityMessage,
  parseReconnectActivityMessage,
  shouldClearReconnectActivity,
} from "../src/shared/activity-display";

test("parseReconnectActivityMessage maps eco auto-retry to count-only summary", () => {
  const parsed = parseReconnectActivityMessage("【自动重试 2/5】5 秒后重试：fetch failed");
  expect(parsed).toEqual({
    summary: "重连 2/5",
  });
  expect(isReconnectActivityMessage("【自动重试 2/5】fetch failed")).toBe(true);
});

test("parseReconnectActivityMessage maps eco connection failure summary", () => {
  const parsed = parseReconnectActivityMessage(
    "【连接失败】HTTP 502：上游模型服务暂时不可用，请稍后重试或切换 Provider。",
  );
  expect(parsed?.summary).toBe("连接失败 · HTTP 502");
  expect(parsed?.failed).toBe(true);
  expect(parsed?.detail).toBeUndefined();
});

test("shouldClearReconnectActivity keeps reconnect during Requesting model", () => {
  expect(
    shouldClearReconnectActivity({ role: "explore", message: "Requesting model…" }),
  ).toBe(false);
});
