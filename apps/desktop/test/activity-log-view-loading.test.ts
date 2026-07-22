import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ActivityLogView,
  ProjectionSubagentDetailFeed,
  resolveActiveSubagentDurationMs,
  resolveMinimumVisibleToolRunningState,
} from "../src/renderer/ActivityLogView";
import { formatDuration } from "../src/renderer/activity-log";
import { StreamingMarkdownContent } from "../src/renderer/StreamingMarkdownContent";
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
    ...(input.runAttemptId && { runAttemptId: input.runAttemptId }),
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

test("feed durations use whole units without decimals", () => {
  expect(formatDuration(4_900)).toBe("4s");
  expect(formatDuration(81_900)).toBe("1m 21s");
  expect(formatDuration(3_723_900)).toBe("1h 2m 3s");
});

test("tool running status remains visible for at least one second", () => {
  const running = resolveMinimumVisibleToolRunningState({
    nowMs: 1_000,
    minimumMs: 1_000,
    summary: { label: "正在运行 git status", icon: "terminal" },
    lifecycle: "running",
    currentActionIdentity: "tool-a",
    runningActionIdentity: "tool-a",
  });
  const completed = resolveMinimumVisibleToolRunningState({
    nowMs: 1_100,
    minimumMs: 1_000,
    summary: { label: "已运行 git status", icon: "terminal" },
    lifecycle: "completed",
    currentActionIdentity: "tool-a",
    previous: running.running,
  });

  expect(completed.lifecycle).toBe("running");
  expect(completed.summary.label).toBe("正在运行 git status");
  expect(completed.remainingMs).toBe(900);

  const released = resolveMinimumVisibleToolRunningState({
    nowMs: 2_000,
    minimumMs: 1_000,
    summary: { label: "已运行 git status", icon: "terminal" },
    lifecycle: "completed",
    currentActionIdentity: "tool-a",
    previous: completed.running,
  });
  expect(released.lifecycle).toBe("completed");
  expect(released.summary.label).toBe("已运行 git status");
});

test("a newer overlapping tool skips the previous minimum running duration", () => {
  const running = resolveMinimumVisibleToolRunningState({
    nowMs: 1_000,
    minimumMs: 1_000,
    summary: { label: "正在运行 git status", icon: "terminal" },
    lifecycle: "running",
    currentActionIdentity: "tool-a",
    runningActionIdentity: "tool-a",
  });
  const newer = resolveMinimumVisibleToolRunningState({
    nowMs: 1_100,
    minimumMs: 1_000,
    summary: { label: "已读取 README.md", icon: "file" },
    lifecycle: "completed",
    currentActionIdentity: "tool-b",
    previous: running.running,
  });

  expect(newer.lifecycle).toBe("completed");
  expect(newer.summary.label).toBe("已读取 README.md");
  expect(newer.remainingMs).toBe(0);
});

function projection(input: {
  timeline: ThreadRunProjectionTimelineItem[];
  agents?: ThreadRunProjectionAgent[];
  requestSpans?: ThreadRunProjectionRequestSpan[];
  attempts?: ThreadRunProjectionSnapshot["attempts"];
  status?: string;
}): ThreadRunProjectionSnapshot {
  return {
    thread: {
      threadId: "thr_loading",
      status: input.status ?? "running",
      generatedAt: "2026-01-01T00:00:00.000Z",
    },
    attempts: input.attempts ?? [],
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

test("active subagent duration stays anchored to its feed card start time", () => {
  expect(
    resolveActiveSubagentDurationMs("2026-01-01T00:00:00.000Z", 0, Date.parse("2026-01-01T00:00:42.000Z")),
  ).toBe(42_000);
});

test("active subagent duration never moves behind the projected duration", () => {
  expect(
    resolveActiveSubagentDurationMs(
      "2026-01-01T00:00:40.000Z",
      45_000,
      Date.parse("2026-01-01T00:01:00.000Z"),
    ),
  ).toBe(45_000);
});

test("StreamingMarkdownContent renders an incomplete code fence without a local loading tail", () => {
  const html = renderToStaticMarkup(
    createElement(StreamingMarkdownContent, {
      text: "开始执行\n```bash\necho ready",
      streaming: true,
    }),
  );

  expect(html).toContain("markdown-content--streaming-plain");
  expect(html).toContain("```bash");
  expect(html).toContain("echo ready");
  expect(html).not.toContain("run-log-streaming-dots");
  expect(html).not.toContain("等待代码块");
  expect(html).not.toContain("等待 Bash 代码块");
  expect(html).not.toContain("markdown-streaming-block-loading");
});

test("StreamingMarkdownContent leaves held structured edit loading to the conversation tail", () => {
  const html = renderToStaticMarkup(
    createElement(StreamingMarkdownContent, {
      text: "<<<<<<< SEARCH\nold value",
      streaming: true,
    }),
  );

  expect(html).toBe("");
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
  expect(html).toContain('class="run-log-conversation-tail"');
});

test("ActivityLogView shows the original thinking loader before the first response event", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityLogView, {
      projection: projection({
        status: "running",
        timeline: [
          item({
            id: "initial-user-prompt",
            eventType: "thread.status",
            role: "user",
            text: "检查当前实现",
            metadata: { liveType: "thread.user_prompt" },
          }),
        ],
      }),
    }),
  );

  expect(html).toContain('class="run-log-thinking streaming empty"');
  expect(html).toContain('class="run-log-thinking-header"');
  expect(html).toContain("正在思考");
  expect(html).not.toContain("run-log-thinking-icon");
  expect(html).not.toContain('aria-label="会话进行中"');
});

test("ActivityLogView shows thinking immediately while the first projection event is pending", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityLogView, {
      thread: {
        id: "thread-initial-loading",
        title: "检查当前实现",
        prompt: "检查当前实现",
        workspacePath: "/tmp/project",
        status: "running",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        message: "",
      },
    }),
  );

  expect(html).toContain("检查当前实现");
  expect(html).toContain('class="run-log-thinking streaming empty"');
  expect(html).toContain("正在思考");
  expect(html).not.toContain("run-log-thinking-icon");
  expect(html).not.toContain('aria-label="会话进行中"');
  expect(html).not.toContain("run-log-projection-loading");
});

test("ActivityLogView hides the conversation tail while a request is waiting for its first token", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityLogView, {
      projection: projection({
        status: "running",
        requestSpans: [
          requestSpan({ requestId: "req-waiting", status: "waiting_first_token" }),
        ],
        timeline: [
          item({
            id: "user-before-request",
            sequence: 1,
            eventType: "thread.status",
            role: "user",
            text: "继续检查",
            metadata: { liveType: "thread.user_prompt" },
          }),
          item({
            id: "request-started",
            sequence: 2,
            eventType: "request.started",
            requestId: "req-waiting",
            text: "",
          }),
        ],
      }),
    }),
  );

  expect(html).toContain("正在思考");
  expect(html).not.toContain("run-log-conversation-tail");
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
  expect(html).not.toContain("run-log-conversation-tail");
  expect(html).toContain("会话停止后的最终输出。");
});

test("ActivityLogView separates a completed attempt process from its final output", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityLogView, {
      projection: projection({
        status: "completed",
        attempts: [
          {
            attemptId: "attempt-1",
            phase: "initial",
            retryIndex: 0,
            status: "completed",
            startedAt: "2026-01-01T00:00:00.000Z",
            endedAt: "2026-01-01T00:00:04.000Z",
          },
        ],
        timeline: [
          item({
            id: "process-message",
            sequence: 1,
            eventType: "message.final",
            runAttemptId: "attempt-1",
            text: "先检查事件投影。",
            at: "2026-01-01T00:00:01.000Z",
          }),
          item({
            id: "final-message",
            sequence: 2,
            eventType: "message.final",
            runAttemptId: "attempt-1",
            text: "Feed 已完成整理。",
            at: "2026-01-01T00:00:04.000Z",
          }),
        ],
      }),
    }),
  );

  expect(html).toContain("已处理 4s");
  expect(html).toContain('class="run-log-turn is-completed is-collapsed"');
  expect(html).toContain('class="run-log-turn-process"');
  expect(html).toContain('aria-label="执行过程" aria-hidden="true"');
  expect(html).toContain('class="run-log-turn-final" aria-label="最终输出"');
  expect(html.indexOf("先检查事件投影。")).toBeLessThan(html.indexOf("run-log-turn-final"));
  expect(html.indexOf("run-log-turn-final")).toBeLessThan(html.indexOf("Feed 已完成整理。"));
});

test("ActivityLogView keeps a running attempt process expanded without final output", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityLogView, {
      projection: projection({
        attempts: [
          {
            attemptId: "attempt-running",
            phase: "follow_up",
            retryIndex: 0,
            status: "running",
            startedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        timeline: [
          item({
            id: "running-message",
            eventType: "message.final",
            runAttemptId: "attempt-running",
            text: "正在检查剩余文件。",
          }),
        ],
      }),
    }),
  );

  expect(html).toContain("处理中");
  expect(html).toContain('class="run-log-turn is-running is-expanded"');
  expect(html).toContain('class="run-log-turn-toggle" disabled=""');
  expect(html).not.toContain("run-log-turn-chevron");
  expect(html).toContain('aria-label="执行过程" aria-hidden="false"');
  expect(html).not.toContain('class="run-log-turn-final"');
});

test("ActivityLogView shows thinking in an internally scrollable region without a duration", () => {
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
  expect(html).toContain('class="run-log-thinking-content"');
  expect(html).toContain("run-log-thinking-icon");
  expect(html).toContain('class="run-log-thinking-body-inner"');
  expect(html).toContain('role="region"');
  expect(html).toContain('aria-label="思考内容"');
  expect(html).not.toContain("run-log-thinking-chevron");
  expect(html).not.toContain("aria-expanded");
  expect(html).not.toContain("run-log-thinking run-log-feed-surface");
  expect(html).not.toContain("run-log-feed-surface-icon");
  expect(html).not.toContain("run-log-thinking-timing-inline");
  expect(html).not.toContain("耗时");
  expect(html).not.toContain(">思考</span>");
  expect(html).toContain("先检查事件投影，再统一渲染结构。");
});

test("ActivityLogView shows content for multiple thinking items without timing metadata", () => {
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
            metadata: { logicalEntityId: "reasoning-first" },
          }),
          item({
            id: "thinking-second",
            eventType: "thinking.final",
            role: "thinking",
            requestId: "req-thinking-multi",
            streamKey: "reasoning-second",
            text: "第二段思考。",
            metadata: { logicalEntityId: "reasoning-second" },
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

  expect(html).toContain("第一段思考。");
  expect(html).toContain("第二段思考。");
  expect(html).not.toContain("run-log-thinking-timing-inline");
  expect(html).not.toContain("耗时");
});

test("ActivityLogView shows only the conversation tail for a running file write action", () => {
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

  expect(html).not.toContain("run-log-inline-loading");
  expect(html).toContain('aria-label="会话进行中"');
  expect(html.match(/class="run-log-streaming-dot"/g)?.length).toBe(3);
});

test("ActivityLogView keeps loading at the feed tail for collapsed running tool groups", () => {
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
  expect(html).toContain("正在读取 src/config.ts");
  expect(html).not.toContain("已写入 1 个文件和已读取 1 个文件");
  expect(html).not.toContain("run-log-inline-loading");
  expect(html).toContain('aria-label="会话进行中"');
  expect(html.match(/class="run-log-streaming-dot"/g)?.length).toBe(3);
});

test("ActivityLogView switches command groups from live action back to completed totals", () => {
  const completedCommands = Array.from({ length: 6 }, (_, index) =>
    item({
      id: `bash-completed-${index + 1}`,
      sequence: index + 1,
      eventType: "tool.completed",
      text: `Tool: Bash · echo ${index + 1}`,
      metadata: {
        tool: {
          name: "Bash",
          detail: `echo ${index + 1}`,
          toolUseId: `toolu_bash_${index + 1}`,
          status: "completed",
        },
      },
    }),
  );
  const latestCommand = '/bin/zsh -lc "sed -n \'1,180p\' src/services/very-long-tool-status-file.ts"';
  const runningCommand = item({
    id: "bash-running-7",
    sequence: 7,
    text: `Tool: Bash · ${latestCommand}`,
    metadata: {
      tool: {
        name: "Bash",
        detail: latestCommand,
        toolUseId: "toolu_bash_7",
        status: "started",
      },
    },
  });

  const runningHtml = renderToStaticMarkup(
    createElement(ActivityLogView, {
      projection: projection({ timeline: [...completedCommands, runningCommand] }),
    }),
  );
  expect(runningHtml).toContain("正在运行 /bin/zsh -lc &quot;sed -n");
  expect(runningHtml).toContain("run-log-shimmer-text");
  expect(runningHtml).not.toContain("已运行 6 条命令");

  const completedHtml = renderToStaticMarkup(
    createElement(ActivityLogView, {
      projection: projection({
        status: "completed",
        timeline: [
          ...completedCommands,
          item({
            ...runningCommand,
            eventType: "tool.completed",
            metadata: {
              tool: {
                name: "Bash",
                detail: latestCommand,
                toolUseId: "toolu_bash_7",
                status: "completed",
              },
            },
          }),
        ],
      }),
    }),
  );
  expect(completedHtml).toContain("已运行 7 条命令");
  expect(completedHtml).not.toContain("正在运行");
  expect(completedHtml).not.toContain("run-log-shimmer-text");
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

test("ActivityLogView collapses a single completed tool behind the shared summary", () => {
  const cases = [
    { name: "Bash", detail: "bun test", expected: "已运行 bun test" },
    { name: "Read", detail: "src/App.tsx", expected: "已读取 src/App.tsx" },
    { name: "Edit", detail: "src/App.tsx", expected: "已编辑 src/App.tsx" },
  ] as const;

  for (const toolCase of cases) {
    const html = renderToStaticMarkup(
      createElement(ActivityLogView, {
        projection: projection({
          status: "completed",
          timeline: [
            item({
              id: `single-${toolCase.name.toLowerCase()}`,
              eventType: "tool.completed",
              text: `Tool: ${toolCase.name} · ${toolCase.detail}`,
              metadata: {
                tool: {
                  name: toolCase.name,
                  detail: toolCase.detail,
                  toolUseId: `toolu_single_${toolCase.name.toLowerCase()}`,
                  status: "completed",
                  ...(toolCase.name === "Bash" && { output: "2 pass" }),
                },
              },
            }),
          ],
        }),
      }),
    );

    expect(html).toContain("run-log-tool-group-trigger");
    expect(html).toContain(toolCase.expected);
    expect(html).not.toContain("run-log-action-trigger");
    expect(html).not.toContain("run-log-action--bash-card");
  }
});

test("ActivityLogView collapses incomplete Bash details behind a neutral summary", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityLogView, {
      projection: projection({
        status: "failed",
        timeline: [
          item({
            id: "bash-failed",
            eventType: "tool.failed",
            text: "Tool: Bash · bun test",
            metadata: {
              tool: {
                name: "Bash",
                detail: "bun test",
                toolUseId: "toolu_bash_failed",
                status: "failed",
                output: "1 test failed",
              },
            },
          }),
        ],
      }),
    }),
  );

  expect(html).toContain("run-log-tool-group-trigger");
  expect(html).toContain("工具未完成 · Bash");
  expect(html).not.toContain("run-log-tool-group-trigger is-failed");
  expect(html).not.toContain("run-log-bash-command");
  expect(html).not.toContain("run-log-bash-output");
  expect(html).not.toContain("1 test failed");
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

test("ActivityLogView uses conversation loading for a completed request with a stale running action", () => {
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

  expect(html).toContain("run-log-tool-group-trigger is-running");
  expect(html).not.toContain("run-log-inline-loading");
  expect(html).toContain("run-log-conversation-tail");
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

  expect(html).toContain("run-log-tool-group-trigger is-running");
  expect(html).toContain("正在运行 sleep 8");
  expect(html).toContain("run-log-shimmer-text");
  expect(html).not.toContain("run-log-action-trigger");
  expect(html).not.toContain("run-log-action--bash-card");
  expect(html).not.toContain("run-log-bash-command");
  expect(html).not.toContain("run-log-inline-loading");
  expect(html).toContain("run-log-conversation-tail");
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

  expect(html).toContain("run-log-tool-group-trigger is-running");
  expect(html).not.toContain("run-log-inline-loading");
  expect(html).not.toContain("run-log-conversation-tail");
});
