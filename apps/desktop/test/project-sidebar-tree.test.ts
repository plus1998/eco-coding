import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { isThreadWaitingForApproval, ProjectSidebarTree } from "../src/renderer/ProjectSidebarTree";
import type { ThreadSummary } from "../src/shared/ipc";

test("renders stable reveal targets for projects and threads", () => {
  const thread = {
    id: "thread_1",
    title: "Locate sidebar item",
    prompt: "Find it",
    workspacePath: "/repo",
    status: "completed",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:01.000Z",
    message: "Done",
  } satisfies ThreadSummary;
  const markup = renderToStaticMarkup(
    createElement(ProjectSidebarTree, {
      projectTree: [
        {
          project: { path: "/repo", name: "repo" },
          projectThreads: [thread],
          collapsed: false,
          visibleThreads: [thread],
          hasMore: false,
        },
      ],
      currentProjectPath: "/repo",
      activeThreadId: thread.id,
      unreadThreadIds: new Set<string>(),
      pinnedThreadIds: new Set<string>(),
      onSwitchProject: () => undefined,
      onSelectThread: () => undefined,
      onToggleProjectCollapsed: () => undefined,
      onExpandProjectThreads: () => undefined,
      onReorderProjects: () => undefined,
      onOpenProjectPath: async () => undefined,
      onPinProject: () => undefined,
      onUnpinProject: () => undefined,
      onRemoveProject: () => undefined,
      onPinThread: () => undefined,
      onUnpinThread: () => undefined,
      onDeleteThread: () => undefined,
    }),
  );

  expect(markup).toContain('data-project-path="/repo"');
  expect(markup).toContain('data-thread-id="thread_1"');
});

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
