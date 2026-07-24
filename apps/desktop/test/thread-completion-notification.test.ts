import { expect, test } from "bun:test";
import type { ThreadActivityLine } from "../src/shared/ipc";
import {
  buildThreadApprovalNotificationContent,
  buildThreadCompletionNotificationContent,
} from "../src/shared/thread-completion-notification";

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

test("builds plan approval notification from the pending plan", () => {
  const content = buildThreadApprovalNotificationContent({ title: "实现通知" }, "plan", {
    toolUseId: "plan-1",
    threadId: "thread-1",
    userPrompt: "增加通知",
    analysis: "需要修改桌面端",
    plan: "1. 增加 IPC\n2. 发送 Electron 通知",
  });

  expect(content).toEqual({
    title: "实现通知",
    body: "等待计划审批：1. 增加 IPC 2. 发送 Electron 通知",
  });
});

test("localizes approval notification framing while preserving raw detail", () => {
  const detail = "Run git status && printf raw-output";
  const content = buildThreadApprovalNotificationContent(
    { title: "Review command" },
    "bash",
    {
      threadId: "thread-1",
      toolUseId: "tool-1",
      command: detail,
      description: "",
      reason: "",
      riskLevel: "low",
      riskScore: 0,
    },
    "en-US",
  );

  expect(content?.body).toBe(`Waiting for action approval: ${detail}`);
});

test("builds operation approval notification from Bash and filesystem requests", () => {
  const bashBase = {
    toolUseId: "bash-1",
    threadId: "thread-1",
    cwd: "/repo",
    reason: "运行测试",
    riskScore: 50,
    riskLevel: "medium" as const,
    agentId: "planner",
  };
  expect(
    buildThreadApprovalNotificationContent({ title: "运行测试" }, "bash", {
      ...bashBase,
      command: "bun test",
    }),
  ).toEqual({
    title: "运行测试",
    body: "等待操作审批：bun test",
  });
  expect(
    buildThreadApprovalNotificationContent({ title: "读取配置" }, "bash", {
      ...bashBase,
      command: "Read /etc/hosts",
      filesystemTool: "Read",
      filesystemPath: "/etc/hosts",
    }),
  ).toEqual({
    title: "读取配置",
    body: "等待操作审批：Read /etc/hosts",
  });
});

test("does not fabricate approval detail", () => {
  expect(
    buildThreadApprovalNotificationContent({ title: "空计划" }, "plan", {
      toolUseId: "plan-1",
      threadId: "thread-1",
      userPrompt: "",
      analysis: "",
      plan: "",
    }),
  ).toBeUndefined();
});
