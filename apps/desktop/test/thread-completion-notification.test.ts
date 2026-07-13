import { expect, test } from "bun:test";
import type { ThreadActivityLine } from "../src/shared/ipc";
import { buildThreadCompletionNotificationContent } from "../src/shared/thread-completion-notification";

test("builds notification from the latest main assistant output", () => {
  const activity: ThreadActivityLine[] = [
    { id: "user-1", role: "user", message: "实现未读提示" },
    { id: "assistant-1", role: "assistant", message: "旧输出" },
    { id: "subagent-1", role: "assistant", agentId: "coder-1", message: "子代理输出" },
    {
      id: "assistant-2",
      role: "assistant",
      message: "## 已完成\n\n新增 **蓝色未读点**，详情见 [App.tsx](/repo/App.tsx)。",
    },
  ];

  expect(buildThreadCompletionNotificationContent({ title: "未读通知" }, activity)).toEqual({
    title: "未读通知",
    body: "已完成 新增 蓝色未读点，详情见 App.tsx。",
  });
});

test("does not fabricate notification content when title or main output is unavailable", () => {
  expect(
    buildThreadCompletionNotificationContent({ title: "任务" }, [
      { id: "subagent-1", role: "assistant", agentId: "coder-1", message: "仅子代理输出" },
    ]),
  ).toBeUndefined();
  expect(
    buildThreadCompletionNotificationContent({ title: " " }, [
      { id: "assistant-1", role: "assistant", message: "完成" },
    ]),
  ).toBeUndefined();
});

test("limits notification body length", () => {
  const content = buildThreadCompletionNotificationContent({ title: "长输出" }, [
    { id: "assistant-1", role: "assistant", message: "a".repeat(700) },
  ]);

  expect(content?.body).toHaveLength(600);
  expect(content?.body.endsWith("…")).toBe(true);
});
