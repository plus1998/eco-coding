import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ActivityLogView,
  formatRunLogTurnHeading,
  ProjectionSubagentDetailFeed,
  ProjectionToolGroupEntry,
  resolveActiveSubagentDurationMs,
  resolveMinimumVisibleToolRunningState,
} from "../src/renderer/ActivityLogView";
import { formatDuration, iconForToolName } from "../src/renderer/activity-log";
import { i18n } from "../src/renderer/i18n";
import { StreamingMarkdownContent } from "../src/renderer/StreamingMarkdownContent";
import { SubagentTaskDrawer } from "../src/renderer/SubagentTaskDrawer";
import { buildThreadRunProjectionViewModel } from "../src/renderer/thread-run-projection-view";
import { WorkspaceFloatingCards } from "../src/renderer/WorkspaceFloatingCards";
import type {
  ThreadRunProjectionAgent,
  ThreadRunProjectionRequestSpan,
  ThreadRunProjectionSnapshot,
  ThreadRunProjectionTimelineItem,
} from "../src/shared/ipc";
import { renderLocalized } from "./i18n-test";

const styles = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

let previousLanguage = "zh-CN";

beforeEach(async () => {
  previousLanguage = i18n.resolvedLanguage ?? i18n.language;
  await i18n.changeLanguage("zh-CN");
});

afterEach(async () => {
  await i18n.changeLanguage(previousLanguage);
});

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
  expect(formatDuration(0)).toBe("");
  expect(formatDuration(999)).toBe("");
});

test("running turn heading switches to stopping while cancelling", async () => {
  await i18n.changeLanguage("zh-CN");
  expect(formatRunLogTurnHeading(true, "running", 4_000)).toBe("处理中 4s");
  expect(formatRunLogTurnHeading(true, "running", 4_000, true)).toBe("停止中 4s");
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
    summary: { label: "已读取 README.md", icon: "read" },
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
    ...(input.taskName && { taskName: input.taskName }),
    ...(input.nickname && { nickname: input.nickname }),
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

test("StreamingMarkdownContent streams unfinished prose as markdown (no plain-spacing jump)", () => {
  const html = renderToStaticMarkup(
    createElement(StreamingMarkdownContent, {
      text: "正文输出\n第二行",
      streaming: true,
    }),
  );

  // Live prose uses the same paragraph host as settle — not pre-wrap plain.
  expect(html).toContain("<p>正文输出<br/>第二行</p>");
  expect(html).not.toContain("markdown-content--streaming-plain");
});

test("StreamingMarkdownContent renders an incomplete code fence without a local loading tail", () => {
  const html = renderToStaticMarkup(
    createElement(StreamingMarkdownContent, {
      text: "开始执行\n```bash\necho ready",
      streaming: true,
    }),
  );

  // Stable preface is real markdown; incomplete fence stays plain mutably.
  expect(html).toContain("开始执行");
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

test("desktop feed keeps narrative edge spacing stable when streaming settles to markdown", () => {
  const streamingHtml = renderToStaticMarkup(
    createElement(StreamingMarkdownContent, { text: "正文输出", streaming: true }),
  );
  const settledHtml = renderToStaticMarkup(
    createElement(StreamingMarkdownContent, { text: "正文输出", streaming: false }),
  );

  // Unfinished prose streams as the same <p> host — settle only ends the run flag.
  expect(streamingHtml).toContain("<p>正文输出</p>");
  expect(streamingHtml).not.toContain("markdown-content--streaming-plain");
  expect(settledHtml).toContain("<p>正文输出</p>");
  // Direct SSR children + PM nested blocks both zero their outer edges.
  expect(styles).toMatch(
    /\.codex-main:not\(\.codex-main-landing\)\s+\.run-log-feed-entry\s+\.markdown-content\s+>\s*:first-child[\s\S]*?margin-top:\s*0;/s,
  );
  expect(styles).toMatch(
    /\.codex-main:not\(\.codex-main-landing\)\s+\.run-log-feed-entry\s+\.markdown-content\s+\.ProseMirror\s+>\s*:first-child\s*\{\s*margin-top:\s*0;/s,
  );
  expect(styles).toMatch(
    /\.codex-main:not\(\.codex-main-landing\)\s+\.run-log-feed-entry\s+\.markdown-content\s+>\s*:last-child[\s\S]*?margin-bottom:\s*0;/s,
  );
  expect(styles).toMatch(
    /\.codex-main:not\(\.codex-main-landing\)\s+\.run-log-feed-entry\s+\.markdown-content\s+\.ProseMirror\s+>\s*:last-child\s*\{\s*margin-bottom:\s*0;/s,
  );
});

test("desktop feed disables overflow-anchor so tail tables cannot pull the scroller up", () => {
  expect(styles).toMatch(/\.activity-messages\s*\{[^}]*overflow-anchor:\s*none;/s);
  expect(styles).toMatch(/\.markdown-content\s+table,\s*\n\s*\.markdown-content\s+\.markdown-table\s*\{[^}]*overflow-anchor:\s*none;/s);
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
  expect(html).toContain("run-log-active-tail");
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
  expect(html).toContain("run-log-active-tail");
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
  expect(html).toContain("run-log-active-tail");
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
        requestSpans: [requestSpan({ requestId: "req-waiting", status: "waiting_first_token" })],
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

test("ActivityLogView keeps first-turn thinking spacing stable before request startup", () => {
  const runningAttempt = {
    attemptId: "attempt-first-message",
    phase: "initial" as const,
    status: "running" as const,
    startedAt: "2026-01-01T00:00:00.000Z",
  };
  const userPrompt = item({
    id: "first-user-prompt",
    sequence: 1,
    eventType: "thread.status",
    role: "user",
    text: "检查首次发送间距",
    at: "2026-01-01T00:00:00.100Z",
    metadata: { liveType: "thread.user_prompt" },
  });
  const render = (
    timeline: ThreadRunProjectionTimelineItem[],
    requestSpans: ThreadRunProjectionRequestSpan[],
  ) =>
    renderToStaticMarkup(
      createElement(ActivityLogView, {
        projection: projection({
          status: "running",
          attempts: [runningAttempt],
          timeline,
          requestSpans,
        }),
      }),
    );

  const beforeRequest = render([userPrompt], []);
  const afterRequest = render(
    [
      userPrompt,
      item({
        id: "first-request-started",
        sequence: 2,
        eventType: "request.started",
        requestId: "req-first-message",
        runAttemptId: runningAttempt.attemptId,
        text: "",
      }),
    ],
    [requestSpan({ requestId: "req-first-message", status: "waiting_first_token" })],
  );

  // Waiting indicator is deferred to the active-tail; process stays empty under the
  // 处理中 divider so padding does not stack above "正在思考". Spacing stays stable
  // before and after request.started via the empty-process + active-tail rule.
  expect(beforeRequest).toContain("run-log-turn-process-inner is-empty");
  expect(afterRequest).toContain("run-log-turn-process-inner is-empty");
  expect(beforeRequest).toContain("run-log-active-tail");
  expect(afterRequest).toContain("run-log-active-tail");
  expect(beforeRequest).toContain("正在思考");
  expect(afterRequest).toContain("正在思考");
});

test("ActivityLogView keeps the active thinking indicator at the bottom after tool rows", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityLogView, {
      projection: projection({
        status: "running",
        requestSpans: [requestSpan({ requestId: "req-waiting", status: "waiting_first_token" })],
        timeline: [
          item({
            id: "request-started",
            sequence: 1,
            eventType: "request.started",
            requestId: "req-waiting",
            text: "",
          }),
          item({
            id: "read-completed",
            sequence: 2,
            eventType: "tool.completed",
            text: "Tool: Read · config.ts",
            metadata: {
              tool: {
                name: "Read",
                detail: "config.ts",
                toolUseId: "toolu_read_config",
                status: "completed",
              },
            },
          }),
        ],
      }),
    }),
  );

  expect(html.indexOf("config.ts")).toBeLessThan(html.indexOf("正在思考"));
  expect(html.match(/正在思考/g)?.length).toBe(1);
  expect(html).not.toContain("run-log-conversation-tail");
});

test("ActivityLogView replaces answered clarification waiting with its question and answer", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityLogView, {
      projection: projection({
        status: "running",
        timeline: [
          item({
            id: "clarification-waiting",
            sequence: 1,
            eventType: "thread.status",
            role: "system",
            text: "等待你的回答…",
            metadata: { liveType: "thread.running" },
          }),
          item({
            id: "clarification-answer",
            sequence: 2,
            eventType: "message.final",
            role: "planner",
            text: "澄清回答：应该使用哪种部署方式？ → 蓝绿部署",
            metadata: { liveType: "clarification.answered" },
          }),
        ],
      }),
    }),
  );

  expect(html).not.toContain("等待你的回答");
  expect(html).toContain("应该使用哪种部署方式？");
  expect(html).toContain("蓝绿部署");
  expect(html).toContain("clarification-answer-card");
});

test("ActivityLogView hides the plan execution transition and its empty processed section", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityLogView, {
      projection: projection({
        status: "completed",
        attempts: [
          {
            attemptId: "attempt-planning",
            phase: "planning",
            status: "completed",
            startedAt: "2026-01-01T00:00:00.000Z",
            endedAt: "2026-01-01T00:00:05.000Z",
          },
        ],
        timeline: [
          item({
            id: "plan-cleared",
            sequence: 1,
            eventType: "thread.status",
            role: "system",
            runAttemptId: "attempt-planning",
            text: "计划已进入执行阶段。",
            metadata: { liveType: "thread.plan_cleared" },
          }),
        ],
      }),
    }),
  );

  expect(html).not.toContain("计划已进入执行阶段");
  expect(html).not.toContain("run-log-turn");
  expect(html).not.toContain("已处理");
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
              promptImagePreviews: [{ id: "preview-1", mediaType: "image/jpeg", data: "YWJj" }],
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

test("ActivityLogView labels a manually cancelled attempt with its elapsed time", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityLogView, {
      projection: projection({
        status: "idle",
        attempts: [
          {
            attemptId: "attempt-cancelled",
            phase: "initial",
            retryIndex: 0,
            status: "cancelled",
            startedAt: "2026-01-01T00:00:00.000Z",
            endedAt: "2026-01-01T00:00:05.000Z",
          },
        ],
        timeline: [
          item({
            id: "cancelled-progress",
            eventType: "message.final",
            runAttemptId: "attempt-cancelled",
            text: "正在检查。",
            at: "2026-01-01T00:00:04.000Z",
          }),
        ],
      }),
    }),
  );

  expect(html).toContain("你在 5秒 后停止了");
  expect(html).not.toContain("已处理 5s");
});

test("ActivityLogView labels an unexpectedly failed attempt with its elapsed time", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityLogView, {
      projection: projection({
        status: "failed",
        attempts: [
          {
            attemptId: "attempt-failed",
            phase: "initial",
            retryIndex: 0,
            status: "failed",
            startedAt: "2026-01-01T00:00:00.000Z",
            endedAt: "2026-01-01T00:00:05.000Z",
          },
        ],
        timeline: [
          item({
            id: "failed-progress",
            eventType: "message.final",
            runAttemptId: "attempt-failed",
            text: "正在检查。",
            at: "2026-01-01T00:00:04.000Z",
          }),
        ],
      }),
    }),
  );

  expect(html).toContain("运行 5秒 后停止了");
  expect(html).not.toContain("已处理 5s");
});

test("ActivityLogView keeps block spacing between a completed turn and the next user prompt", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityLogView, {
      projection: projection({
        status: "running",
        attempts: [
          {
            attemptId: "attempt-before-follow-up",
            phase: "initial",
            retryIndex: 0,
            status: "completed",
            startedAt: "2026-01-01T00:00:00.000Z",
            endedAt: "2026-01-01T00:00:06.000Z",
          },
        ],
        timeline: [
          item({
            id: "completed-tool",
            sequence: 1,
            eventType: "tool.completed",
            role: "tool",
            runAttemptId: "attempt-before-follow-up",
            text: "Tool: Read · README.md",
            at: "2026-01-01T00:00:05.000Z",
            metadata: {
              tool: { name: "Read", detail: "README.md", status: "completed" },
            },
          }),
          item({
            id: "follow-up-user-prompt",
            sequence: 2,
            eventType: "thread.status",
            role: "user",
            text: "继续",
            at: "2026-01-01T00:00:07.000Z",
            metadata: { liveType: "thread.user_prompt" },
          }),
        ],
      }),
    }),
  );

  expect(html).toMatch(
    /<section class="run-log-turn is-completed is-collapsed"[\s\S]*<\/section><div class="run-log-feed-entry"><article class="run-log-user-prompt"/,
  );
  expect(styles).toMatch(
    /\.codex-main:not\(\.codex-main-landing\) \.run-log > \.run-log-turn \+ \.run-log-feed-entry\s*\{\s*margin-top:\s*var\(--codex-feed-gap-block\);/s,
  );
  expect(styles).toMatch(
    /\.run-log-turn-process-inner\s*>\s*\.run-log-feed-entry:has\(\.run-log-tool-group\)\s*\+\s*\.run-log-feed-entry[\s\S]*?margin-top:\s*calc\(20px - var\(--codex-feed-gap-step\)\);/,
  );
  expect(styles).toMatch(
    /\.run-log-turn-process-inner\s*>\s*\.run-log-feed-entry:has\(\.run-log-thinking\)\s*\+\s*\.run-log-feed-entry[\s\S]*?margin-top:\s*calc\(20px - var\(--codex-feed-gap-step\)\);/,
  );
  expect(styles).toMatch(
    /\.run-log\s*>\s*\.run-log-feed-entry:has\(\.run-log-thinking\)\s*\+\s*\.run-log-feed-entry[\s\S]*?margin-top:\s*20px;/,
  );
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
  expect(html).toContain('class="run-log-turn-toggle" disabled="" aria-expanded="true"');
  expect(html).not.toContain("run-log-turn-chevron");
  expect(html).toContain('aria-label="执行过程" aria-hidden="false"');
  expect(html).not.toContain('class="run-log-turn-final"');
});

test("ActivityLogView collapses completed thinking behind a deep-thinking summary", () => {
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
  expect(html).toContain("run-log-thinking-trigger");
  expect(html).toContain("run-log-thinking-icon");
  expect(html).toContain("run-log-thinking-chevron");
  expect(html).toContain('aria-expanded="false"');
  expect(html).toContain("已思考");
  expect(html).not.toContain("run-log-thinking-details");
  expect(html).not.toContain("run-log-thinking run-log-feed-surface");
  expect(html).not.toContain("run-log-feed-surface-icon");
  expect(html).not.toContain("run-log-thinking-timing-inline");
  expect(html).not.toContain("· 耗时");
  expect(html).not.toContain(">思考</span>");
  expect(html).not.toContain("先检查事件投影，再统一渲染结构。");
});

test("ActivityLogView appends turn-style duration to completed thinking summary", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityLogView, {
      projection: projection({
        status: "completed",
        timeline: [
          item({
            id: "thinking-final-timed",
            eventType: "thinking.final",
            role: "thinking",
            requestId: "req-thinking-timed",
            text: "带耗时的思考内容。",
            at: "2026-01-01T00:00:05.000Z",
            metadata: {
              thinkingStartedAt: "2026-01-01T00:00:00.000Z",
              thinkingDurationMs: 5000,
            },
          }),
        ],
      }),
    }),
  );

  expect(html).toContain("已思考 5s");
  expect(html).not.toContain("带耗时的思考内容。");
});

test("ActivityLogView appends live duration while thinking streams", () => {
  const startedAt = new Date(Date.now() - 4_500).toISOString();
  const html = renderToStaticMarkup(
    createElement(ActivityLogView, {
      projection: projection({
        status: "running",
        timeline: [
          item({
            id: "thinking-delta-timed",
            eventType: "thinking.delta",
            role: "thinking",
            requestId: "req-thinking-live",
            text: "正在输出的思考内容",
            metadata: { thinkingStartedAt: startedAt },
          }),
        ],
        requestSpans: [
          requestSpan({
            requestId: "req-thinking-live",
            status: "streaming",
          }),
        ],
      }),
    }),
  );

  expect(html).toContain("正在思考 4s");
  expect(html).toContain("正在输出的思考内容");
});

test("ActivityLogView expands streaming thinking with live body text", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityLogView, {
      projection: projection({
        status: "running",
        timeline: [
          item({
            id: "thinking-delta",
            eventType: "thinking.delta",
            role: "thinking",
            requestId: "req-thinking-stream",
            text: "正在输出的思考内容",
          }),
        ],
        requestSpans: [
          requestSpan({
            requestId: "req-thinking-stream",
            status: "streaming",
          }),
        ],
      }),
    }),
  );

  expect(html).toContain("run-log-thinking streaming");
  expect(html).toContain("is-expanded");
  expect(html).toContain("正在思考");
  expect(html).toContain("run-log-thinking-details");
  expect(html).toContain("正在输出的思考内容");
});

test("ActivityLogView collapses multiple completed thinking items by default", () => {
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

  expect(html).toContain("已思考");
  expect(html).not.toContain("第一段思考。");
  expect(html).not.toContain("第二段思考。");
  expect(html).not.toContain("run-log-thinking-timing-inline");
  expect(html).not.toContain("· 耗时");
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
  expect(html).toContain("正在读取 config.ts");
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
  const latestCommand = "/bin/zsh -lc \"sed -n '1,180p' src/services/very-long-tool-status-file.ts\"";
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

test("ActivityLogView renders reasoning-stage as ephemeral tip status", () => {
  const tipOnlyHtml = renderToStaticMarkup(
    createElement(ActivityLogView, {
      projection: projection({
        timeline: [
          item({
            id: "stage-final",
            eventType: "thinking.final",
            role: "thinking",
            sequence: 1,
            streamKey: "rs_stage_final",
            text: "定位入口",
            metadata: { reasoningDisplay: "summary" },
          }),
        ],
      }),
    }),
  );
  // Final tip stays until a later hard event supersedes it.
  expect(tipOnlyHtml).toContain("定位入口");
  expect(tipOnlyHtml).toContain('class="run-log-thinking streaming empty"');
  expect(tipOnlyHtml).toContain("run-log-shimmer-text");

  const streamingHtml = renderToStaticMarkup(
    createElement(ActivityLogView, {
      projection: projection({
        timeline: [
          item({
            id: "stage-1",
            eventType: "thinking.final",
            role: "thinking",
            sequence: 1,
            streamKey: "rs_stage_1",
            text: "定位入口",
            metadata: { reasoningDisplay: "summary" },
          }),
          item({
            id: "bash-1",
            eventType: "tool.started",
            role: "tool",
            sequence: 2,
            streamKey: "tool_bash_1",
            text: "Tool: Bash · ls",
            metadata: {
              tool: { name: "Bash", detail: "ls", status: "started" },
            },
          }),
          item({
            id: "stage-2",
            eventType: "thinking.delta",
            role: "thinking",
            sequence: 3,
            streamKey: "rs_stage_2",
            text: "检查测试",
            metadata: { reasoningDisplay: "summary" },
          }),
        ],
      }),
    }),
  );
  // Tool supersedes stage-1; only live tip stage-2 remains.
  expect(streamingHtml).not.toContain("定位入口");
  expect(streamingHtml).toContain("检查测试");
  expect(streamingHtml).toContain('class="run-log-thinking streaming empty"');
  expect(streamingHtml).toContain("run-log-shimmer-text");
  expect(streamingHtml).toContain("正在运行");
  expect(streamingHtml).not.toContain("run-log-thinking-trigger");
  expect(streamingHtml).not.toContain("run-log-thinking-icon");

  const replacedHtml = renderToStaticMarkup(
    createElement(ActivityLogView, {
      projection: projection({
        timeline: [
          item({
            id: "stage-a",
            eventType: "thinking.delta",
            role: "thinking",
            sequence: 1,
            streamKey: "rs_a",
            text: "第一阶段",
            metadata: { reasoningDisplay: "summary" },
          }),
          item({
            id: "stage-b",
            eventType: "thinking.delta",
            role: "thinking",
            sequence: 2,
            streamKey: "rs_b",
            text: "第二阶段",
            metadata: { reasoningDisplay: "summary" },
          }),
        ],
      }),
    }),
  );
  expect(replacedHtml).not.toContain("第一阶段");
  expect(replacedHtml).toContain("第二阶段");
  expect(replacedHtml.match(/run-log-thinking streaming empty/g)?.length).toBe(1);

  const completedHtml = renderToStaticMarkup(
    createElement(ActivityLogView, {
      projection: projection({
        status: "completed",
        timeline: [
          item({
            id: "stage-done",
            eventType: "thinking.final",
            role: "thinking",
            sequence: 1,
            streamKey: "rs_stage_done",
            text: "已完成阶段",
            metadata: { reasoningDisplay: "summary" },
          }),
          item({
            id: "bash-done",
            eventType: "tool.completed",
            role: "tool",
            sequence: 2,
            streamKey: "tool_bash_done",
            text: "Tool: Bash · ls",
            metadata: {
              tool: { name: "Bash", detail: "ls", status: "completed" },
            },
          }),
        ],
      }),
    }),
  );
  // Tool after summary clears the tip; durable tool row remains.
  expect(completedHtml).not.toContain("已完成阶段");
  expect(completedHtml).toContain("运行了 ls");
});

test("ActivityLogView renders subagent card without mounting subagent detail timeline", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityLogView, {
      projection: projection({
        timeline: [],
        agents: [
          agent({
            agentId: "agent_coder_1",
            taskName: "implement_drawer",
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
  expect(html).toContain("Implement Drawer");
  expect(html).toContain("实现抽屉");
  expect(html).not.toContain("#coder_1");
  expect(html).not.toContain("subagent-run-agent-chip");
  expect(html).not.toContain("这段正文只应该在右侧详情里出现");
  expect(html).not.toContain("work-session-details-compact");
});

test("WorkspaceFloatingCards lists subagents without mounting unselected detail timelines", () => {
  const subagent = agent({
    agentId: "agent_coder_1",
    nickname: "Goodall",
    taskName: "implement_drawer",
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
  const element = createElement(WorkspaceFloatingCards, {
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
  });
  const chineseHtml = renderLocalized(element, "zh-CN");
  const englishHtml = renderLocalized(element, "en-US");

  expect(chineseHtml).toContain("workspace-subagent-runs-list");
  expect(chineseHtml).toContain("子智能体");
  expect(chineseHtml).toContain("Goodall");
  expect(chineseHtml).toContain("Implement Drawer");
  expect(chineseHtml).not.toContain("实现抽屉");
  expect(chineseHtml).not.toContain("这段详情不应该默认挂载");
  expect(englishHtml).toContain("Subagents");
  expect(englishHtml).not.toContain("这段详情不应该默认挂载");
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
      images: [{ id: "image-1", mediaType: "image/png", data: "YWJj" }],
      requestSpansById: new Map(),
      threadActive: false,
    }),
  );

  expect(html).toContain("subagent-conversation-prompt");
  expect(html).toContain("run-log-user-prompt-bubble");
  expect(html).toContain("run-log-user-prompt-body-wrap");
  expect(html).toContain("run-log-user-prompt-images");
  expect(html).toContain("data:image/png;base64,YWJj");
  expect(html).toContain("只读检查路由链路");
  expect(html).toContain("已处理 2m 8s");
  expect(html).toContain("检查完成，问题在 role fallback。");
  expect(html).toContain('class="run-log-turn-final"');
  expect(html).not.toContain("subagent-conversation-result");
  expect(html).not.toMatch(/>执行结果</);
  expect(html).not.toMatch(/>最终汇总</);
  // Long mission text must live inside the scrollable log so the feed stays reachable.
  expect(html.indexOf("subagent-conversation-log")).toBeGreaterThan(-1);
  expect(html.indexOf("subagent-conversation-prompt")).toBeGreaterThan(
    html.indexOf("subagent-conversation-log"),
  );
});

test("ProjectionSubagentDetailFeed collapses a thinking delta prefix into its final item", () => {
  const subagent = agent({
    agentId: "agent_thinking_stream",
    status: "active",
    timeline: [
      item({
        id: "thinking-delta",
        sequence: 1,
        eventType: "thinking.delta",
        scope: "agent",
        role: "thinking",
        requestId: "request-1",
        streamKey: "thinking-stream-1",
        text: "The",
      }),
      item({
        id: "thinking-final",
        sequence: 2,
        eventType: "thinking.final",
        scope: "agent",
        role: "thinking",
        requestId: "request-1",
        streamKey: "thinking-stream-1",
        text: "The tool result needs closer inspection.",
      }),
    ],
  });
  const html = renderToStaticMarkup(
    createElement(ProjectionSubagentDetailFeed, {
      agent: subagent,
      missionText: "检查工具输出",
      requestSpansById: new Map(),
      threadActive: true,
    }),
  );

  expect(html).toContain("已思考");
  expect(html.match(/已思考/g)?.length).toBe(1);
  expect(html).not.toContain("The tool result needs closer inspection.");
  expect(html).not.toMatch(/>The</);
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

  expect(html.match(/class="run-log-turn-final"/g)?.length ?? 0).toBe(1);
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
  expect(html).not.toContain("run-log-turn-final");
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

test("ActivityLogView renders imageView as a standalone collapsed preview", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityLogView, {
      projection: projection({
        status: "completed",
        timeline: [
          item({
            id: "image-view-feed",
            eventType: "tool.completed",
            text: "Tool: ViewImage · /tmp/feed-preview.png",
            metadata: {
              itemType: "imageView",
              tool: {
                name: "ViewImage",
                detail: "/tmp/feed-preview.png",
                toolUseId: "item_image_view_feed",
                status: "completed",
                imageView: { path: "/tmp/feed-preview.png" },
              },
            },
          }),
        ],
      }),
    }),
  );

  expect(html).toContain("run-log-image-view");
  expect(html).toContain('class="run-log-tool-group-trigger run-log-image-view-summary"');
  expect(html).toContain('class="run-log-action-icon-wrap"');
  expect(html).toContain('class="lucide lucide-images run-log-action-icon"');
  expect(html).not.toContain("run-log-tool-group-chevron open");
  expect(html).toContain("已查看 1 张图像");
  expect(html).toContain('aria-expanded="false"');
  expect(html).not.toContain("feed-preview.png");
  expect(html).not.toContain("/tmp/feed-preview.png");
  expect(html).not.toContain("正在读取本地图片");
  expect(html).not.toContain('class="run-log-tool-group"');
});

test("ActivityLogView upgrades persisted imageView gaps instead of rendering unknown payload", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityLogView, {
      projection: projection({
        status: "completed",
        timeline: [
          item({
            id: "tre:codex:unprojected:exec-image-view-feed",
            eventType: "thread.status",
            text: "未知类型 · imageView",
            metadata: {
              liveType: "codex.item.unprojected",
              itemType: "imageView",
              unprojectedPhase: "completed",
              payloadJson: JSON.stringify({
                type: "imageView",
                id: "exec-image-view-feed",
                path: "/tmp/feed-preview.png",
              }),
              gap: true,
            },
          }),
        ],
      }),
    }),
  );

  expect(html).toContain("run-log-image-view");
  expect(html).toContain("已查看 1 张图像");
  expect(html).not.toContain("run-log-unknown-item");
  expect(html).not.toContain("未知类型原始数据");
  expect(html).not.toContain("/tmp/feed-preview.png");
});

test("ActivityLogView shimmers a running imageView and hides waiting thinking", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityLogView, {
      projection: projection({
        status: "running",
        requestSpans: [requestSpan({ requestId: "req_image", status: "streaming" })],
        timeline: [
          item({
            id: "thinking-empty",
            sequence: 1,
            requestId: "req_image",
            eventType: "thinking.delta",
            role: "thinking",
            text: "",
            streamKey: "thinking:req_image",
            metadata: { liveType: "thinking.delta" },
          }),
          item({
            id: "image-view-running",
            sequence: 2,
            requestId: "req_image",
            eventType: "tool.started",
            text: "Tool: mcp__eco_image_view__view_image · /tmp/feed-preview.png",
            metadata: {
              liveType: "tool.started",
              itemType: "mcpToolCall",
              tool: {
                name: "mcp__eco_image_view__view_image",
                detail: "/tmp/feed-preview.png",
                toolUseId: "item_mcp_view_running",
                status: "started",
                imageView: { path: "/tmp/feed-preview.png" },
              },
            },
          }),
        ],
      }),
    }),
  );

  expect(html).toContain("run-log-image-view");
  expect(html).toContain("正在查看 1 张图像");
  expect(html).toContain("run-log-shimmer-text");
  expect(html).toContain('aria-label="会话进行中"');
  expect(html).not.toContain("正在思考");
});

test("ActivityLogView hides waiting thinking while context compaction is running", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityLogView, {
      projection: projection({
        status: "running",
        requestSpans: [requestSpan({ requestId: "req_compact", status: "streaming" })],
        timeline: [
          item({
            id: "thinking-empty",
            sequence: 1,
            requestId: "req_compact",
            eventType: "thinking.delta",
            role: "thinking",
            text: "",
            streamKey: "thinking:req_compact",
            metadata: { liveType: "thinking.delta" },
          }),
          item({
            id: "compact-start",
            sequence: 2,
            eventType: "context.compaction.started",
            text: "正在自动压缩上下文",
            metadata: { liveType: "context.compaction.started" },
          }),
        ],
      }),
    }),
  );

  expect(html).toContain("正在自动压缩上下文");
  expect(html).toContain("run-log-context-action");
  expect(html).toContain('aria-label="会话进行中"');
  expect(html).not.toContain("正在思考");
});

test("ActivityLogView renders Eco MCP view_image as the image preview, not a web search", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityLogView, {
      projection: projection({
        status: "completed",
        timeline: [
          item({
            id: "eco-mcp-image-view-feed",
            eventType: "tool.completed",
            text: "Tool: mcp__eco_image_view__view_image · /tmp/feed-preview.png",
            metadata: {
              itemType: "mcpToolCall",
              tool: {
                name: "mcp__eco_image_view__view_image",
                detail: "/tmp/feed-preview.png",
                toolUseId: "item_mcp_view_feed",
                status: "completed",
                imageView: { path: "/tmp/feed-preview.png" },
              },
            },
          }),
        ],
      }),
    }),
  );

  expect(html).toContain("run-log-image-view");
  expect(html).toContain("已查看 1 张图像");
  expect(html).not.toContain("联网搜索");
  expect(html).not.toContain("调用了 MCP 工具");
});

test("ActivityLogView labels PI mcp proxy discovery as searching MCP tools", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityLogView, {
      projection: projection({
        status: "completed",
        timeline: [
          item({
            id: "pi-mcp-search",
            eventType: "tool.completed",
            text: "Tool: mcp",
            metadata: {
              tool: {
                name: "mcp",
                toolUseId: "tool_mcp_search",
                status: "completed",
                mcpDiscovery: { kind: "search" },
              },
            },
          }),
        ],
      }),
    }),
  );

  expect(html).toContain("查找 MCP 工具");
  expect(html).not.toContain("已查找 MCP 工具");
  expect(html).not.toContain("调用了 MCP 工具");
  expect(html).not.toContain("联网搜索");
  expect(html).not.toContain("已搜索代码");
});

test("ActivityLogView labels running PI mcp proxy discovery as searching MCP tools", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityLogView, {
      projection: projection({
        status: "running",
        timeline: [
          item({
            id: "pi-mcp-search-running",
            eventType: "tool.started",
            text: "Tool: mcp",
            metadata: {
              tool: {
                name: "mcp",
                toolUseId: "tool_mcp_search_running",
                status: "started",
                mcpDiscovery: { kind: "search" },
              },
            },
          }),
        ],
      }),
    }),
  );

  expect(html).toContain("正在查找 MCP 工具");
  expect(html).not.toContain("正在调用 MCP");
  expect(html).not.toContain("联网搜索");
});

test("ActivityLogView still labels a real PI mcp tool call as MCP", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityLogView, {
      projection: projection({
        status: "completed",
        timeline: [
          item({
            id: "pi-mcp-real-tool",
            eventType: "tool.completed",
            text: "Tool: mcp",
            metadata: {
              tool: {
                name: "mcp",
                toolUseId: "tool_mcp_real",
                status: "completed",
              },
            },
          }),
        ],
      }),
    }),
  );

  expect(html).toContain("调用了 MCP 工具");
  expect(html).not.toContain("查找 MCP 工具");
  expect(html).not.toContain("联网搜索");
});

test("ActivityLogView collapses a single completed tool behind the shared summary", () => {
  const cases = [
    { name: "Bash", detail: "bun test", expected: "运行了 bun test" },
    { name: "Read", detail: "src/App.tsx", expected: "读取了 App.tsx" },
    { name: "Edit", detail: "src/App.tsx", expected: "编辑了 App.tsx" },
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

test("ProjectionToolGroupEntry keeps a single Bash command behind a child disclosure", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      status: "completed",
      timeline: [
        item({
          id: "single-bash-expanded",
          eventType: "tool.completed",
          text: "Tool: Bash · bun test",
          metadata: {
            tool: {
              name: "Bash",
              detail: "bun test",
              toolUseId: "toolu_single_bash_expanded",
              status: "completed",
              outputPreview: "2 pass",
            },
          },
        }),
      ],
    }),
  );
  const entry = view.mainFeedEntries[0];
  if (entry?.kind !== "tool-group") {
    throw new Error("single Bash tool group missing");
  }

  const html = renderToStaticMarkup(
    createElement(ProjectionToolGroupEntry, {
      entry,
      requestSpansById: new Map(),
      defaultExpanded: true,
    }),
  );

  expect(html.match(/运行了 bun test/g)?.length).toBe(2);
  expect(html).toContain("run-log-tool-group-child-trigger");
  expect(html).toContain("bun test");
  expect(html).toContain('aria-expanded="false"');
  expect(html).not.toContain("run-log-bash-command");
  expect(html).not.toContain("run-log-bash-output");
  expect(html).not.toContain("2 pass");
});

test("ProjectionToolGroupEntry renders Read/Grep children as icon plus action line, not a special verb row", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      status: "completed",
      timeline: [
        item({
          id: "read-structured",
          eventType: "tool.completed",
          text: "Tool: Read · ActivityLogView.tsx:L120-159",
          metadata: {
            tool: {
              name: "Read",
              detail: "ActivityLogView.tsx:L120-159",
              toolUseId: "toolu_read_child",
              status: "completed",
              readTarget: {
                filePath: "/repo/apps/desktop/src/renderer/ActivityLogView.tsx",
                offset: 120,
                limit: 40,
              },
            },
          },
        }),
        item({
          id: "grep-structured",
          eventType: "tool.completed",
          text: "Tool: Grep · RunLogAction",
          sequence: 2,
          metadata: {
            tool: {
              name: "Grep",
              detail: "RunLogAction",
              toolUseId: "toolu_grep_child",
              status: "completed",
              grepTarget: {
                pattern: "RunLogAction",
                path: "apps/desktop/src/renderer",
              },
            },
          },
        }),
      ],
    }),
  );
  const entry = view.mainFeedEntries[0];
  if (entry?.kind !== "tool-group") {
    throw new Error("Read/Grep tool group missing");
  }

  const html = renderToStaticMarkup(
    createElement(ProjectionToolGroupEntry, {
      entry,
      requestSpansById: new Map(),
      defaultExpanded: true,
    }),
  );

  expect(html).toContain("run-log-action-icon");
  expect(html).toContain("lucide-book-open");
  expect(html).toContain("读取了 ActivityLogView.tsx L120-159");
  expect(html).toContain("搜索了 RunLogAction");
  expect(html).not.toContain("run-log-action--read-target");
  expect(html).not.toContain("run-log-action--grep-target");
  expect(html).not.toContain("run-log-read-target-verb");
  expect(html).not.toContain("run-log-grep-target-verb");
});

test("ProjectionToolGroupEntry shows concrete details for grouped tool children", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      status: "completed",
      timeline: [
        item({
          id: "bash-test",
          sequence: 1,
          eventType: "tool.completed",
          text: "Tool: Bash · bun test",
          metadata: {
            tool: {
              name: "Bash",
              detail: "bun test",
              toolUseId: "toolu_bash_test",
              status: "completed",
            },
          },
        }),
        item({
          id: "bash-lint",
          sequence: 2,
          eventType: "tool.completed",
          text: "Tool: Bash · bun lint",
          metadata: {
            tool: {
              name: "Bash",
              detail: "bun lint",
              toolUseId: "toolu_bash_lint",
              status: "completed",
            },
          },
        }),
      ],
    }),
  );
  const entry = view.mainFeedEntries[0];
  if (entry?.kind !== "tool-group") {
    throw new Error("grouped Bash tools missing");
  }

  const html = renderToStaticMarkup(
    createElement(ProjectionToolGroupEntry, {
      entry,
      requestSpansById: new Map(),
      defaultExpanded: true,
    }),
  );

  expect(html).toContain("已运行 2 条命令");
  expect(html).toContain("运行了 bun test");
  expect(html).toContain("运行了 bun lint");
  expect(html).not.toContain("运行了命令");
});

test("ActivityLogView summarizes a failed Edit as an edit, not a command", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityLogView, {
      projection: projection({
        status: "failed",
        timeline: [
          item({
            id: "edit-started",
            sequence: 1,
            eventType: "tool.started",
            text: "Tool: edit · panel.ts",
            metadata: {
              tool: {
                name: "edit",
                toolUseId: "tc_edit",
                status: "started",
                fileChange: { path: "panel.ts", kind: "edit", additions: 1, deletions: 0 },
              },
            },
          }),
          item({
            id: "edit-failed",
            sequence: 2,
            eventType: "tool.failed",
            text: "Tool failed: edit: Found 2 occurrences of the text",
            metadata: {
              tool: {
                name: "edit",
                toolUseId: "tc_edit",
                status: "failed",
              },
            },
          }),
        ],
      }),
    }),
  );

  expect(html).toContain("编辑了 panel.ts");
  expect(html).not.toContain("编辑了文件");
  expect(html).not.toContain("运行了命令");
  expect(html.match(/run-log-tool-group-trigger/g)?.length).toBe(1);
});

test("ActivityLogView flattens a failed Bash command behind a subtle status dot", () => {
  const failedProjection = projection({
    status: "failed",
    timeline: [
      item({
        id: "bash-started",
        sequence: 1,
        eventType: "tool.started",
        text: "Tool: Bash · bun test",
        metadata: {
          tool: {
            name: "Bash",
            detail: "bun test",
            toolUseId: "toolu_bash_failed",
            status: "started",
          },
        },
      }),
      item({
        id: "bash-failed",
        sequence: 2,
        eventType: "tool.failed",
        text: "Tool failed: Bash: Exit code 1",
        metadata: {
          tool: {
            name: "Bash",
            detail: "Exit code 1\n1 test failed",
            toolUseId: "toolu_bash_failed",
            status: "failed",
            outputPreview: "Exit code 1\n1 test failed",
          },
        },
      }),
    ],
  });
  const html = renderToStaticMarkup(
    createElement(ActivityLogView, {
      projection: failedProjection,
    }),
  );

  expect(html).toContain("run-log-tool-group-trigger");
  expect(html).toContain("运行了 bun test");
  // Aggregated group titles omit the failure dot; open the group to see it on the Bash child.
  expect(html).not.toContain("run-log-tool-status-dot");
  expect(html).not.toContain("工具未完成");
  expect(html).not.toContain("run-log-tool-group-trigger is-failed");
  expect(html).not.toContain("run-log-bash-command");
  expect(html).not.toContain("run-log-bash-output");
  expect(html).not.toContain("1 test failed");

  const entry = buildThreadRunProjectionViewModel(failedProjection).mainFeedEntries[0];
  if (entry?.kind !== "tool-group") {
    throw new Error("failed Bash tool group missing");
  }
  const expandedHtml = renderToStaticMarkup(
    createElement(ProjectionToolGroupEntry, {
      entry,
      requestSpansById: new Map(),
      defaultExpanded: true,
    }),
  );

  expect(expandedHtml).toContain("运行了 bun test");
  expect(expandedHtml).toContain("bun test");
  expect(expandedHtml).toContain("run-log-tool-group-child-trigger");
  expect(expandedHtml).not.toContain("run-log-action--bash-card");
  expect(expandedHtml).toContain('aria-expanded="false"');
  expect(expandedHtml.match(/run-log-tool-status-dot/g)?.length).toBe(1);
  expect(expandedHtml).not.toContain("run-log-bash-command");
  expect(expandedHtml).not.toContain("run-log-bash-output");
  expect(expandedHtml).not.toContain("1 test failed");
});

test("failed Bash action uses the completed command style plus a status dot", () => {
  const renderCommand = (status: "completed" | "failed") =>
    renderToStaticMarkup(
      createElement(ActivityLogView, {
        projection: projection({
          timeline: [
            item({
              id: `bash-${status}`,
              eventType: "tool.completed",
              text: "Tool: Bash · bun test",
              metadata: {
                tool: {
                  name: "Bash",
                  detail: "bun test",
                  toolUseId: `toolu_bash_${status}`,
                  status,
                  outputPreview: "2 pass",
                },
              },
            }),
          ],
        }),
      }),
    );

  const completedHtml = renderCommand("completed");
  const failedHtml = renderCommand("failed");
  const triggerClass = (html: string) => html.match(/class="([^"]*run-log-tool-group-trigger[^"]*)"/)?.[1];

  expect(triggerClass(failedHtml)).toBe(triggerClass(completedHtml));
  // Collapsed aggregate summary has no failure dot.
  expect(completedHtml).not.toContain("run-log-tool-status-dot");
  expect(failedHtml).not.toContain("run-log-tool-status-dot");
  expect(failedHtml).not.toContain("is-failed");

  const entry = buildThreadRunProjectionViewModel(
    projection({
      timeline: [
        item({
          id: "bash-failed",
          eventType: "tool.completed",
          text: "Tool: Bash · bun test",
          metadata: {
            tool: {
              name: "Bash",
              detail: "bun test",
              toolUseId: "toolu_bash_failed",
              status: "failed",
              outputPreview: "2 pass",
            },
          },
        }),
      ],
    }),
  ).mainFeedEntries[0];
  if (entry?.kind !== "tool-group") {
    throw new Error("failed Bash tool group missing");
  }
  const expandedFailedHtml = renderToStaticMarkup(
    createElement(ProjectionToolGroupEntry, {
      entry,
      requestSpansById: new Map(),
      defaultExpanded: true,
    }),
  );
  // Failure indicator belongs on the Bash child title after expand.
  expect(expandedFailedHtml.match(/run-log-tool-status-dot/g)?.length).toBe(1);
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
      openTabIds: [subagent.agentId],
      backgroundTasks: [],
      onSelectAgent: () => undefined,
      onSelectPlan: () => undefined,
      onCloseTab: () => undefined,
      onSelectBackgroundTasks: () => undefined,
      onSelectReview: () => undefined,
      workspacePath: "/tmp/workspace",
      onSelectFiles: () => undefined,
      onSelectFileViewer: () => undefined,
      onSelectBrowser: () => undefined,
      onOpenTerminal: () => undefined,
      onShowHome: () => undefined,
      onSelectReviewPath: () => undefined,
      onOpenTerminalTask: () => undefined,
      onStopTerminalTask: () => undefined,
    }),
  );

  expect(html).toContain("subagent-task-panel-tab-meta");
  expect(html).toContain("正在读取 src/config.ts");
});

test("ProjectionSubagentDetailFeed groups detail tools across empty terminal thinking rows", () => {
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
        id: "empty-thinking-after-read",
        sequence: 2,
        eventType: "thinking.final",
        scope: "agent",
        role: "coder",
        agentId: "agent_coder_1",
        text: "",
        metadata: { itemType: "reasoning" },
      }),
      item({
        id: "write-done",
        sequence: 3,
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
        id: "empty-thinking-after-write",
        sequence: 4,
        eventType: "thinking.final",
        scope: "agent",
        role: "coder",
        agentId: "agent_coder_1",
        text: "",
        metadata: { itemType: "reasoning" },
      }),
      item({
        id: "edit-done",
        sequence: 5,
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
  expect(html.match(/class="run-log-tool-group-trigger/g)?.length ?? 0).toBe(1);
  expect(html.match(/class="run-log-action(?:\s|")/g)?.length ?? 0).toBe(0);
});

test("ProjectionSubagentDetailFeed renders follow-up instructions as prompt bubbles without repeating the mission", () => {
  const mission = "实现后端通知分流";
  const subagent = agent({
    agentId: "agent_coder_1",
    status: "active",
    delegationPrompt: mission,
    timeline: [
      item({
        id: "initial-agent-prompt",
        sequence: 1,
        eventType: "message.final",
        scope: "agent",
        role: "coder",
        text: mission,
        metadata: { liveType: "message.user", itemType: "userMessage" },
      }),
      item({
        id: "agent-output",
        sequence: 2,
        eventType: "message.final",
        scope: "agent",
        role: "coder",
        text: "初版实现已完成。",
        metadata: { itemType: "agentMessage" },
      }),
      item({
        id: "follow-up-request-started",
        sequence: 3,
        eventType: "request.started",
        scope: "agent",
        role: "coder",
        requestId: "req_follow_up",
        text: "Requesting model…",
      }),
      item({
        id: "follow-up-agent-prompt",
        sequence: 4,
        eventType: "message.final",
        scope: "agent",
        role: "coder",
        requestId: "req_follow_up",
        text: "按审查意见修正验签逻辑。",
        metadata: { liveType: "message.user", itemType: "userMessage" },
      }),
      item({
        id: "follow-up-agent-output",
        sequence: 5,
        eventType: "message.final",
        scope: "agent",
        role: "coder",
        requestId: "req_follow_up",
        text: "验签逻辑已修正。",
        metadata: { itemType: "agentMessage" },
      }),
      item({
        id: "same-request-follow-up-agent-prompt",
        sequence: 6,
        eventType: "message.final",
        scope: "agent",
        role: "coder",
        requestId: "req_follow_up",
        text: "继续补充回归测试。",
        metadata: { liveType: "message.user", itemType: "userMessage" },
      }),
    ],
  });
  const html = renderToStaticMarkup(
    createElement(ProjectionSubagentDetailFeed, {
      agent: subagent,
      missionText: mission,
      requestSpansById: new Map([
        ["req_follow_up", requestSpan({ requestId: "req_follow_up", status: "streaming" })],
      ]),
      threadActive: true,
    }),
  );

  expect(html.match(/<article class="run-log-user-prompt/g)?.length ?? 0).toBe(3);
  expect(html.match(/subagent-conversation-turn/g)?.length ?? 0).toBe(3);
  expect(html.match(/class="run-log-turn-toggle/g)?.length ?? 0).toBe(3);
  expect(html.match(new RegExp(mission, "g"))?.length ?? 0).toBe(1);
  expect(html).toContain("按审查意见修正验签逻辑。");
  expect(html).toContain("继续补充回归测试。");
  expect(html).toContain("初版实现已完成。");
  expect(html.indexOf("按审查意见修正验签逻辑。")).toBeLessThan(html.indexOf("正在思考"));
  const sameRequestPromptIndex = html.indexOf("继续补充回归测试。");
  expect(sameRequestPromptIndex).toBeGreaterThan(-1);
  expect(sameRequestPromptIndex).toBeLessThan(html.indexOf("正在思考", sameRequestPromptIndex));
});

test("ProjectionToolGroupEntry keeps file-change details behind a second disclosure level", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      status: "completed",
      timeline: [
        item({
          id: "edit-a",
          sequence: 1,
          eventType: "tool.completed",
          text: "Tool: Edit · src/a.ts",
          metadata: {
            tool: {
              name: "Edit",
              detail: "src/a.ts",
              toolUseId: "toolu_edit_a",
              status: "completed",
              fileChange: {
                path: "src/a.ts",
                additions: 1,
                deletions: 1,
                previewLines: [
                  { kind: "remove", text: "const value = 1;" },
                  { kind: "add", text: "const value = 2;" },
                ],
              },
            },
          },
        }),
        item({
          id: "edit-b",
          sequence: 2,
          eventType: "tool.completed",
          text: "Tool: Edit · src/b.ts",
          metadata: {
            tool: {
              name: "Edit",
              detail: "src/b.ts",
              toolUseId: "toolu_edit_b",
              status: "completed",
              fileChange: {
                path: "src/b.ts",
                additions: 1,
                deletions: 0,
                previewLines: [{ kind: "add", text: "export const ready = true;" }],
              },
            },
          },
        }),
      ],
    }),
  );
  const entry = view.mainFeedEntries[0];
  if (entry?.kind !== "tool-group") {
    throw new Error("file-change tool group missing");
  }

  const html = renderToStaticMarkup(
    createElement(ProjectionToolGroupEntry, {
      entry,
      requestSpansById: new Map(),
      defaultExpanded: true,
    }),
  );

  expect(html.match(/class="run-log-action-trigger/g)?.length ?? 0).toBe(2);
  expect(html.match(/aria-expanded="false"/g)?.length ?? 0).toBe(2);
  expect(html).toContain("编辑了 a.ts");
  expect(html).toContain("编辑了 b.ts");
  expect(html).not.toContain("run-log-action-card-detail");
  expect(html).not.toContain("const value = 2;");
  expect(html).not.toContain("export const ready = true;");
});

test("ProjectionSubagentDetailFeed replaces a running tool row with its completed state", () => {
  const subagent = agent({
    agentId: "agent_coder_1",
    status: "active",
    timeline: [
      item({
        id: "bash-started",
        sequence: 1,
        eventType: "tool.started",
        scope: "agent",
        role: "coder",
        text: "Tool: Bash · bun test",
        metadata: {
          tool: {
            name: "Bash",
            detail: "bun test",
            toolUseId: "toolu_bash",
            status: "started",
          },
        },
      }),
      item({
        id: "bash-completed",
        sequence: 2,
        eventType: "tool.completed",
        scope: "agent",
        role: "coder",
        text: "Tool: Bash · bun test",
        metadata: {
          tool: {
            name: "Bash",
            detail: "bun test",
            toolUseId: "toolu_bash",
            status: "completed",
            durationMs: 250,
          },
        },
      }),
    ],
  });

  const html = renderToStaticMarkup(
    createElement(ProjectionSubagentDetailFeed, {
      agent: subagent,
      missionText: "运行测试",
      requestSpansById: new Map(),
      threadActive: true,
    }),
  );

  expect(html).toContain("运行了 bun test");
  expect(html).not.toContain("正在运行 bun test");
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
      openTabIds: [subagent.agentId],
      backgroundTasks: [],
      onSelectAgent: () => undefined,
      onSelectPlan: () => undefined,
      onCloseTab: () => undefined,
      onSelectBackgroundTasks: () => undefined,
      onSelectReview: () => undefined,
      workspacePath: "/tmp/workspace",
      onSelectFiles: () => undefined,
      onSelectFileViewer: () => undefined,
      onSelectBrowser: () => undefined,
      onOpenTerminal: () => undefined,
      onShowHome: () => undefined,
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

test("iconForToolName maps eco browser and image generation tools", () => {
  expect(iconForToolName("mcp__eco_agent_browser__agent_browser_click")).toBe("browser");
  expect(iconForToolName("mcp__eco_agent_browser__agent_browser_open")).toBe("browser");
  expect(iconForToolName("mcp__eco_image_generation__create_image")).toBe("image");
  expect(iconForToolName("ViewImage")).toBe("images");
  expect(iconForToolName("mcp__eco_image_view__view_image")).toBe("images");
  expect(iconForToolName("WebSearch")).toBe("network");
  expect(iconForToolName("Read")).toBe("read");
  expect(iconForToolName("TotallyUnknown")).toBe("tool");
});
