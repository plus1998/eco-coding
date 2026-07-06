import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ActivityLogView, ProjectionSubagentDetailFeed } from "../src/renderer/ActivityLogView";
import { SubagentTaskDrawer } from "../src/renderer/SubagentTaskDrawer";
import { WorkspaceFloatingCards } from "../src/renderer/WorkspaceFloatingCards";
import type {
  ThreadRunProjectionAgent,
  ThreadRunProjectionRequestSpan,
  ThreadRunProjectionSnapshot,
  ThreadRunProjectionTimelineItem,
} from "../src/shared/ipc";

function item(
  input: Partial<ThreadRunProjectionTimelineItem> & { id: string },
): ThreadRunProjectionTimelineItem {
  return {
    id: input.id,
    sequence: input.sequence ?? 1,
    eventType: input.eventType ?? "tool.started",
    scope: input.scope ?? "main",
    role: input.role ?? "planner",
    text: input.text ?? "Tool: Write",
    at: input.at ?? "2026-01-01T00:00:00.000Z",
    ...(input.requestId && { requestId: input.requestId }),
    ...(input.streamKey && { streamKey: input.streamKey }),
    ...(input.metadata && { metadata: input.metadata }),
  };
}

function requestSpan(
  input: Partial<ThreadRunProjectionRequestSpan> & { requestId: string },
): ThreadRunProjectionRequestSpan {
  return {
    requestId: input.requestId,
    status: input.status ?? "streaming",
    startedAt: input.startedAt ?? "2026-01-01T00:00:00.000Z",
    ...(input.endedAt && { endedAt: input.endedAt }),
    ...(input.firstTokenAt && { firstTokenAt: input.firstTokenAt }),
    ...(input.role && { role: input.role }),
    ...(input.ownerAgentId && { ownerAgentId: input.ownerAgentId }),
    ...(input.source && { source: input.source }),
    ...(input.error && { error: input.error }),
  };
}

function projection(input: {
  timeline: ThreadRunProjectionTimelineItem[];
  agents?: ThreadRunProjectionAgent[];
  requestSpans?: ThreadRunProjectionRequestSpan[];
  status?: string;
}): ThreadRunProjectionSnapshot {
  return {
    thread: {
      threadId: "thr_loading",
      status: input.status ?? "running",
      generatedAt: "2026-01-01T00:00:00.000Z",
    },
    attempts: [],
    agents: input.agents ?? [],
    requestSpans: input.requestSpans ?? [],
    timeline: input.timeline,
    diagnostics: [],
    sourceEventCount: input.timeline.length + (input.agents?.length ?? 0),
  };
}

function agent(input: Partial<ThreadRunProjectionAgent> & { agentId: string }): ThreadRunProjectionAgent {
  return {
    agentId: input.agentId,
    role: input.role ?? "coder",
    kind: "subagent",
    status: input.status ?? "active",
    startedAt: input.startedAt ?? "2026-01-01T00:00:00.000Z",
    durationMs: input.durationMs ?? 0,
    timeline: input.timeline ?? [],
    ...(input.delegationPrompt && { delegationPrompt: input.delegationPrompt }),
    ...(input.delegationSummary && { delegationSummary: input.delegationSummary }),
  };
}

test("ActivityLogView shows inline loading for a running file write action", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityLogView, {
      projection: projection({
        requestSpans: [requestSpan({ requestId: "req_write", status: "streaming" })],
        timeline: [
          item({
            id: "write-started",
            requestId: "req_write",
            text: "Tool: Write · src/big-file.ts",
            metadata: {
              liveType: "tool.started",
              tool: {
                name: "Write",
                detail: "src/big-file.ts",
                toolUseId: "toolu_write_big",
                status: "started",
              },
            },
          }),
        ],
      }),
    }),
  );

  expect(html).toContain("run-log-inline-loading");
  expect(html).toContain('aria-label="正在执行"');
  expect(html.match(/class="run-log-streaming-dot"/g)?.length).toBe(3);
});

test("ActivityLogView shows inline loading on collapsed running tool groups", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityLogView, {
      projection: projection({
        requestSpans: [requestSpan({ requestId: "req_tools", status: "streaming" })],
        timeline: [
          item({
            id: "write-started",
            sequence: 1,
            requestId: "req_tools",
            text: "Tool: Write · src/big-file.ts",
            metadata: {
              liveType: "tool.started",
              tool: {
                name: "Write",
                detail: "src/big-file.ts",
                toolUseId: "toolu_write_big",
                status: "started",
              },
            },
          }),
          item({
            id: "read-started",
            sequence: 2,
            requestId: "req_tools",
            text: "Tool: Read · src/config.ts",
            metadata: {
              liveType: "tool.started",
              tool: {
                name: "Read",
                detail: "src/config.ts",
                toolUseId: "toolu_read_config",
                status: "started",
              },
            },
          }),
        ],
      }),
    }),
  );

  expect(html).toContain("run-log-tool-group-trigger is-running");
  expect(html).toContain('aria-label="正在执行工具"');
  expect(html.match(/class="run-log-streaming-dot"/g)?.length).toBe(3);
});

test("ActivityLogView renders subagent card without mounting subagent detail timeline", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityLogView, {
      projection: projection({
        timeline: [],
        agents: [
          agent({
            agentId: "agent_coder_1",
            delegationPrompt: "实现抽屉",
            timeline: [
              item({
                id: "agent-detail",
                eventType: "message.final",
                scope: "agent",
                role: "coder",
                text: "这段正文只应该在右侧详情里出现",
              }),
            ],
          }),
        ],
      }),
      onOpenSubagent: () => undefined,
    }),
  );

  expect(html).toContain("subagent-run-row");
  expect(html).toContain("实现抽屉");
  expect(html).not.toContain("这段正文只应该在右侧详情里出现");
  expect(html).not.toContain("work-session-details-compact");
});

test("WorkspaceFloatingCards lists subagents without mounting unselected detail timelines", () => {
  const subagent = agent({
    agentId: "agent_coder_1",
    delegationPrompt: "实现抽屉",
    timeline: [
      item({
        id: "agent-detail",
        eventType: "message.final",
        scope: "agent",
        role: "coder",
        text: "这段详情不应该默认挂载",
      }),
    ],
  });
  const html = renderToStaticMarkup(
    createElement(WorkspaceFloatingCards, {
      hasActiveThread: true,
      subagentRunCards: [
        {
          key: subagent.agentId,
          agent: subagent,
          timelineIds: subagent.timeline.map((entry) => entry.id),
          running: false,
          missionText: "实现抽屉",
        },
      ],
      onOpenSubagent: () => undefined,
    }),
  );

  expect(html).toContain("workspace-subagent-runs-list");
  expect(html).toContain("子智能体");
  expect(html).toContain("实现抽屉");
  expect(html).not.toContain("这段详情不应该默认挂载");
});

test("ProjectionSubagentDetailFeed renders subagent details as a conversation", () => {
  const subagent = agent({
    agentId: "agent_coder_1",
    status: "completed",
    durationMs: 128_000,
    delegationPrompt: "只读检查路由链路",
    timeline: [
      item({
        id: "agent-detail",
        eventType: "message.final",
        scope: "agent",
        role: "coder",
        text: "检查完成，问题在 role fallback。",
      }),
    ],
  });
  const html = renderToStaticMarkup(
    createElement(ProjectionSubagentDetailFeed, {
      agent: subagent,
      missionText: "只读检查路由链路",
      requestSpansById: new Map(),
      threadActive: false,
    }),
  );

  expect(html).toContain("subagent-conversation-prompt");
  expect(html).toContain("run-log-user-prompt-bubble");
  expect(html).toContain("run-log-user-prompt-body-wrap");
  expect(html).toContain("只读检查路由链路");
  expect(html).toContain("已处理 2m 8s");
  expect(html).toContain("检查完成，问题在 role fallback。");
});

test("SubagentTaskDrawer shows live running status text in subagent tabs", () => {
  const subagent = agent({
    agentId: "agent_coder_1",
    status: "active",
    timeline: [],
  });
  const html = renderToStaticMarkup(
    createElement(SubagentTaskDrawer, {
      open: true,
      fullscreen: false,
      cards: [
        {
          key: subagent.agentId,
          agent: subagent,
          timelineIds: [],
          running: true,
          statusText: "正在读取 src/config.ts",
          missionText: "检查配置",
        },
      ],
      activeTab: subagent.agentId,
      openSubagentTabIds: [subagent.agentId],
      backgroundTasks: [],
      onSelectAgent: () => undefined,
      onCloseAgent: () => undefined,
      onSelectBackgroundTasks: () => undefined,
      onSelectReview: () => undefined,
      onToggleFullscreen: () => undefined,
      onSelectReviewPath: () => undefined,
      onOpenTerminalTask: () => undefined,
      onStopTerminalTask: () => undefined,
    }),
  );

  expect(html).toContain("subagent-task-panel-tab-meta");
  expect(html).toContain("正在读取 src/config.ts");
});

test("ProjectionSubagentDetailFeed appends subagent tool rows without grouping", () => {
  const subagent = agent({
    agentId: "agent_coder_1",
    status: "completed",
    delegationPrompt: "整理文件操作",
    timeline: [
      item({
        id: "read-done",
        sequence: 1,
        eventType: "tool.completed",
        scope: "agent",
        role: "coder",
        agentId: "agent_coder_1",
        text: "Tool: Read · src/input.ts",
        metadata: {
          tool: {
            name: "Read",
            detail: "src/input.ts",
            toolUseId: "toolu_read",
            status: "completed",
          },
        },
      }),
      item({
        id: "write-done",
        sequence: 2,
        eventType: "tool.completed",
        scope: "agent",
        role: "coder",
        agentId: "agent_coder_1",
        text: "Tool: Write · src/output.ts",
        metadata: {
          tool: {
            name: "Write",
            detail: "src/output.ts",
            toolUseId: "toolu_write",
            status: "completed",
          },
        },
      }),
      item({
        id: "edit-done",
        sequence: 3,
        eventType: "tool.completed",
        scope: "agent",
        role: "coder",
        agentId: "agent_coder_1",
        text: "Tool: Edit · src/existing.ts",
        metadata: {
          tool: {
            name: "Edit",
            detail: "src/existing.ts",
            toolUseId: "toolu_edit",
            status: "completed",
          },
        },
      }),
    ],
  });
  const html = renderToStaticMarkup(
    createElement(ProjectionSubagentDetailFeed, {
      agent: subagent,
      missionText: "整理文件操作",
      requestSpansById: new Map(),
      threadActive: false,
    }),
  );

  expect(html).not.toContain("run-log-tool-group-trigger");
  expect(html).toContain("input.ts");
  expect(html).toContain("src/output.ts");
  expect(html).toContain("src/existing.ts");
  expect(html.match(/class="run-log-action(?:\s|")/g)?.length).toBe(3);
});

test("ActivityLogView summarizes task progress tools without calling them subagents", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityLogView, {
      projection: projection({
        status: "completed",
        timeline: [
          item({
            id: "task-create",
            sequence: 1,
            text: "Tool: TaskCreate · implement drawer",
            metadata: {
              tool: {
                name: "TaskCreate",
                detail: "implement drawer",
                toolUseId: "toolu_task_create",
                status: "completed",
              },
            },
          }),
          item({
            id: "task-update",
            sequence: 2,
            text: "Tool: TaskUpdate · implement drawer",
            metadata: {
              tool: {
                name: "TaskUpdate",
                detail: "implement drawer",
                toolUseId: "toolu_task_update",
                status: "completed",
              },
            },
          }),
        ],
      }),
    }),
  );

  expect(html).toContain("已创建 1 个任务");
  expect(html).toContain("已更新任务 1 次");
  expect(html).not.toContain("已调用 2 个子代理");
});

test("ActivityLogView does not show inline loading for a completed request with a stale running action", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityLogView, {
      projection: projection({
        requestSpans: [
          requestSpan({
            requestId: "req_done",
            status: "completed",
            endedAt: "2026-01-01T00:00:03.000Z",
          }),
        ],
        timeline: [
          item({
            id: "write-started",
            requestId: "req_done",
            text: "Tool: Write · src/big-file.ts",
            metadata: {
              liveType: "tool.started",
              tool: {
                name: "Write",
                detail: "src/big-file.ts",
                toolUseId: "toolu_write_big",
                status: "started",
              },
            },
          }),
        ],
      }),
    }),
  );

  expect(html).toContain("run-log-action-trigger is-running");
  expect(html).not.toContain("run-log-inline-loading");
});

test("ActivityLogView does not show inline loading for orphan running actions while thread continues", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityLogView, {
      projection: projection({
        status: "running",
        timeline: [
          item({
            id: "bash-started",
            text: "Tool: Bash · sleep 8",
            metadata: {
              liveType: "tool.started",
              tool: {
                name: "Bash",
                detail: "sleep 8",
                toolUseId: "toolu_sleep",
                status: "started",
              },
            },
          }),
        ],
      }),
    }),
  );

  expect(html).toContain("run-log-action-trigger is-running");
  expect(html).not.toContain("run-log-inline-loading");
});

test("ActivityLogView does not leave inline loading on orphan running actions after the thread ends", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityLogView, {
      projection: projection({
        status: "completed",
        timeline: [
          item({
            id: "bash-started",
            text: "Tool: Bash · sleep 8",
            metadata: {
              liveType: "tool.started",
              tool: {
                name: "Bash",
                detail: "sleep 8",
                toolUseId: "toolu_sleep",
                status: "started",
              },
            },
          }),
        ],
      }),
    }),
  );

  expect(html).toContain("run-log-action-trigger is-running");
  expect(html).not.toContain("run-log-inline-loading");
});
