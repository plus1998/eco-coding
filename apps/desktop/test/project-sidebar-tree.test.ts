import { expect, test } from "bun:test";
import { isThreadWaitingForApproval } from "../src/renderer/ProjectSidebarTree";
import type { ThreadSummary } from "../src/shared/ipc";

test("detects running threads waiting for Bash approval", () => {
  expect(
    isThreadWaitingForApproval({
      id: "thread_1",
      title: "Install dependencies",
      prompt: "Run install",
      workspacePath: "/repo",
      status: "running",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:01.000Z",
      message: "等待 Bash 执行确认…",
    } satisfies ThreadSummary),
  ).toBe(true);

  expect(
    isThreadWaitingForApproval({
      id: "thread_3",
      title: "Read external file",
      prompt: "Inspect config",
      workspacePath: "/repo",
      status: "running",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:02.000Z",
      message: "等待确认 Read：/etc/hosts",
    } satisfies ThreadSummary),
  ).toBe(true);

  expect(
    isThreadWaitingForApproval({
      id: "thread_2",
      title: "Regular run",
      prompt: "Check status",
      workspacePath: "/repo",
      status: "running",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:01.000Z",
      message: "正在分析…",
    } satisfies ThreadSummary),
  ).toBe(false);
});
