import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ActivityLogView, ProjectionSubagentDetailFeed } from "../src/renderer/ActivityLogView";
import { SubagentTaskDrawer } from "../src/renderer/SubagentTaskDrawer";
import { StreamingMarkdownContent } from "../src/renderer/StreamingMarkdownContent";
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
    ...(input.endedAt && { endedAt: input.endedAt }),
    ...(input.usage && { usage: input.usage }),
    ...(input.context && { context: input.context }),
    ...(input.delegationPrompt && { delegationPrompt: input.delegationPrompt }),
    ...(input.delegationSummary && { delegationSummary: input.delegationSummary }),
  };
}

test("StreamingMarkdownContent renders an incomplete code fence progressively without a waiting card", () => {
  const html = renderToStaticMarkup(
    createElement(StreamingMarkdownContent, {
      text: "开始执行\n```bash\necho ready",
      streaming: true,
    }),
  );

  expect(html).toContain("markdown-pre");
  expect(html).toContain("echo ready");
  expect(html).toContain('aria-label="正在输出"');
  expect(html).not.toContain("等待代码块");
  expect(html).not.toContain("等待 Bash 代码块");
  expect(html).not.toContain("markdown-streaming-block-loading");
});

test("StreamingMarkdownContent uses only a compact pulse for a held structured edit", () => {
  const html = renderToStaticMarkup(
    createElement(StreamingMarkdownContent, {
      text: "<<<<<<< SEARCH\nold value",
      streaming: true,
    }),
  );

  expect(html).toContain("markdown-content--streaming-tail is-pending-only");
  expect(html).toContain('aria-label="正在输出"');
  expect(html).not.toContain("old value");
  expect(html).not.toContain("等待");
});

test("ActivityLogView waits for thread stop before exposing final output copy", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityLogView, {
      projection: projection({
        status: "running",
        timeline: [
          item({
            id: "assistant-last",
            eventType: "message.final",
            text: "当前最后一轮，但会话还没停止。",
          }),
        ],
      }),
    }),
  );

  expect(html).not.toContain('aria-label="复制消息"');
});

test("ActivityLogView renders prompt images above the user text", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityLogView, {
      projection: projection({
        timeline: [
          item({
            id: "user-with-image",
            eventType: "thread.status",
            role: "user",
            text: "分析这张图片",
            metadata: {
              liveType: "thread.user_prompt",
              promptImagePreviews: [
                { id: "preview-1", mediaType: "image/jpeg", data: "YWJj" },
              ],
            },
          }),
        ],
      }),
    }),
  );

  expect(html).toContain('class="run-log-user-prompt-images"');
  expect(html).toContain('alt="用户上传的图片 1"');
  expect(html.indexOf("run-log-user-prompt-images")).toBeLessThan(html.indexOf("分析这张图片"));
});

test("ActivityLogView exposes final output copy after thread stops", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityLogView, {
      projection: projection({
        status: "completed",
        timeline: [
          item({
            id: "assistant-final",
            eventType: "message.final",
            text: "会话停止后的最终输出。",
          }),
        ],
      }),
    }),
  );

  expect(html).toContain('aria-label="复制消息"');
  expect(html).toContain("会话停止后的最终输出。");
});

test("ActivityLogView keeps thinking content lightweight", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityLogView, {
      projection: projection({
        status: "completed",
        timeline: [
          item({
            id: "thinking-final",
            eventType: "thinking.final",
            role: "thinking",
            requestId: "req-thinking",
            text: "先检查事件投影，再统一渲染结构。",
          }),
        ],
        requestSpans: [
          requestSpan({
            requestId: "req-thinking",
            status: "completed",
            endedAt: "2026-01-01T00:00:03.000Z",
          }),
        ],
      }),
    }),
  );

  expect(html).toContain('class="run-log-thinking');
  expect(html).toContain('class="run-log-thinking-header"');
  expect(html).not.toContain("run-log-thinking run-log-feed-surface");
  expect(html).not.toContain("run-log-feed-surface-icon");
  expect(html).toContain("run-log-thinking-timing-inline");
  expect(html).toContain("· 耗时 3.0s");
});

test("ActivityLogView shows independent durations for multiple thinking items in one request", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityLogView, {
      projection: projection({
        status: "completed",
        timeline: [
          item({
            id: "thinking-first",
            eventType: "thinking.final",
            role: "thinking",
            requestId: "req-thinking-multi",
            streamKey: "reasoning-first",
            text: "第一段思考。",
            metadata: {
              logicalEntityId: "reasoning-first",
              thinkingDurationMs: 1200,
            },
          }),
          item({
            id: "thinking-second",
            eventType: "thinking.final",
            role: "thinking",
            requestId: "req-thinking-multi",
            streamKey: "reasoning-second",
            text: "第二段思考。",
            metadata: {
              logicalEntityId: "reasoning-second",
              thinkingDurationMs: 3400,
            },
            sequence: 2,
          }),
        ],
        requestSpans: [
          requestSpan({
            requestId: "req-thinking-multi",
            status: "completed",
            endedAt: "2026-01-01T00:00:09.000Z",
          }),
        ],
      }),
    }),
  );

  expect(html).toContain("· 耗时 1.2s");
  expect(html).toContain("· 耗时 3.4s");
  expect(html).not.toContain("· 耗时 9.0s");
});

test("ActivityLogView does not reuse request duration for legacy multi-part thinking", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityLogView, {
      projection: projection({
        status: "completed",
        timeline: [
          item({
            id: "legacy-thinking-first",
            eventType: "thinking.final",
            role: "thinking",
            requestId: "req-legacy-thinking",
            streamKey: "legacy-reasoning-first",
            text: "旧第一段思考。",
            metadata: { logicalEntityId: "legacy-reasoning-first" },
          }),
          item({
            id: "legacy-thinking-second",
            eventType: "thinking.final",
            role: "thinking",
            requestId: "req-legacy-thinking",
            streamKey: "legacy-reasoning-second",
            text: "旧第二段思考。",
            metadata: { logicalEntityId: "legacy-reasoning-second" },
            sequence: 2,
          }),
        ],
        requestSpans: [
          requestSpan({
            requestId: "req-legacy-thinking",
            status: "completed",
            endedAt: "2026-01-01T00:00:09.000Z",
          }),
        ],
      }),
    }),
  );

  expect(html).not.toContain("run-log-thinking-timing-inline");
});

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
  expect(html).toContain("subagent-run-row run-log-feed-surface");
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
  expect(html).toContain("subagent-conversation-result");
  expect(html).toContain("执行结果");
});

test("ProjectionSubagentDetailFeed marks only the last completed summary as result and removes its phase echo", () => {
  const completedAgent = agent({
    agentId: "agent_coder_final",
    status: "completed",
    timeline: [
      item({
        id: "intermediate-message",
        sequence: 1,
        eventType: "message.final",
        scope: "agent",
        role: "coder",
        text: "我先检查了事件投影。",
      }),
      item({
        id: "final-phase-echo",
        sequence: 2,
        eventType: "message.final",
        scope: "agent",
        role: "coder",
        text: "修复完成，重复结果已移除。",
        metadata: { activityOrigin: "sdk.upstream_error" },
      }),
      item({
        id: "final-summary",
        sequence: 3,
        eventType: "message.final",
        scope: "agent",
        role: "coder",
        text: "修复完成，重复结果已移除。",
      }),
    ],
  });
  const html = renderToStaticMarkup(
    createElement(ProjectionSubagentDetailFeed, {
      agent: completedAgent,
      missionText: "修复子代理结果展示",
      requestSpansById: new Map(),
      threadActive: false,
    }),
  );

  expect(html.match(/subagent-conversation-result"/g)?.length ?? 0).toBe(1);
  expect(html.match(/修复完成，重复结果已移除。/g)?.length ?? 0).toBe(1);
  expect(html).toContain("我先检查了事件投影。");
  expect(html).not.toContain("run-log-phase");
});

test("ProjectionSubagentDetailFeed does not expose a result before the subagent ends", () => {
  const runningAgent = agent({
    agentId: "agent_coder_running",
    status: "active",
    timeline: [
      item({
        id: "running-message",
        eventType: "message.final",
        scope: "agent",
        role: "coder",
        text: "当前只是执行过程中的正文。",
      }),
    ],
  });
  const html = renderToStaticMarkup(
    createElement(ProjectionSubagentDetailFeed, {
      agent: runningAgent,
      missionText: "继续执行",
      requestSpansById: new Map(),
      threadActive: true,
    }),
  );

  expect(html).toContain("当前只是执行过程中的正文。");
  expect(html).not.toContain("subagent-conversation-result");
  expect(html).not.toContain("执行结果");
});

test("ProjectionSubagentDetailFeed renders four runtime metric cards with billing and model combined", () => {
  const measuredAgent = agent({
    agentId: "agent_coder_metrics",
    status: "completed",
    usage: {
      inputTokens: 1200,
      outputTokens: 340,
      cacheReadTokens: 900,
      cacheCreationTokens: 80,
      ecoCostUsd: 0.0123,
      modelId: "claude-sonnet-4-5",
    },
    context: {
      occupied: 24000,
      limit: 200000,
      occupancyPct: 12,
      modelId: "claude-sonnet-4-5",
    },
  });
  const html = renderToStaticMarkup(
    createElement(ProjectionSubagentDetailFeed, {
      agent: measuredAgent,
      missionText: "统计运行指标",
      requestSpansById: new Map(),
      threadActive: false,
    }),
  );

  for (const label of ["输入输出", "缓存", "上下文", "计费 / 模型"]) {
    expect(html).toContain(label);
  }
  expect(html).toContain("subagent-run-instance-metric--billing-model");
  expect(html.match(/subagent-run-instance-metric /g)?.length ?? 0).toBe(4);
});

test("ActivityLogView summarizes Bash with adjacent file tools", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityLogView, {
      projection: projection({
        status: "completed",
        timeline: [
          item({
            id: "bash-done",
            sequence: 1,
            eventType: "tool.completed",
            text: "Tool: Bash · bun test",
            metadata: {
              tool: {
                name: "Bash",
                detail: "bun test",
                toolUseId: "toolu_bash",
                status: "completed",
                output: "2 pass",
              },
            },
          }),
          item({
            id: "read-done-after-bash",
            sequence: 2,
            eventType: "tool.completed",
            text: "Tool: Read · src/index.ts",
            metadata: {
              tool: {
                name: "Read",
                detail: "src/index.ts",
                toolUseId: "toolu_read_after_bash",
                status: "completed",
              },
            },
          }),
        ],
      }),
    }),
  );

  expect(html).toContain("run-log-tool-group");
  expect(html).toContain("已读取 1 个文件和已运行 1 条命令");
  expect(html).not.toContain("run-log-action--bash-card");
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

test("ProjectionSubagentDetailFeed groups adjacent subagent tool rows in the app drawer", () => {
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

  expect(html).toContain("run-log-tool-group-trigger");
  expect(html).toContain("已读取 1 个文件");
  expect(html).toContain("已写入 1 个文件");
  expect(html).toContain("已编辑 1 个文件");
  expect(html.match(/class="run-log-action(?:\s|")/g)?.length ?? 0).toBe(0);
});

test("SubagentTaskDrawer renders grouped subagent tool calls in its standalone panel", () => {
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
        id: "edit-done",
        sequence: 2,
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
    createElement(SubagentTaskDrawer, {
      open: true,
      fullscreen: false,
      cards: [
        {
          key: subagent.agentId,
          agent: subagent,
          timelineIds: subagent.timeline.map((entry) => entry.id),
          running: false,
          missionText: "整理文件操作",
        },
      ],
      projection: projection({
        status: "completed",
        timeline: [],
        agents: [subagent],
      }),
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

  expect(html).toContain("subagent-task-side-panel");
  expect(html).toContain("run-log-tool-group-trigger");
  expect(html).toContain("已读取 1 个文件和已编辑 1 个文件");
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
