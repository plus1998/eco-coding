import { expect, test } from "bun:test";
import { formatSubagentMissionMessage } from "@eco/runtime";
import {
  buildProjectionDisplayTimelineItems,
  buildThreadRunProjectionViewModel,
  isProjectionRequestActive,
  isProjectionUserPromptItem,
  isThreadAutoCompactSuspended,
  isThreadContextCompactionInFlight,
  isThreadPromptCacheInvalidated,
  projectionItemToDetailBlock,
  projectionMainFeedEntryKey,
  resolveSubagentCardMissionText,
} from "../src/renderer/thread-run-projection-view";
import type {
  ThreadRunProjectionAgent,
  ThreadRunProjectionSnapshot,
  ThreadRunProjectionTimelineItem,
} from "../src/shared/ipc";

function item(
  input: Partial<ThreadRunProjectionTimelineItem> & { id: string },
): ThreadRunProjectionTimelineItem {
  return {
    id: input.id,
    sequence: input.sequence ?? 1,
    eventType: input.eventType ?? "message.final",
    scope: input.scope ?? "main",
    text: input.text ?? "",
    at: input.at ?? "2026-01-01T00:00:00.000Z",
    ...(input.role && { role: input.role }),
    ...(input.agentId && { agentId: input.agentId }),
    ...(input.requestId && { requestId: input.requestId }),
    ...(input.streamKey && { streamKey: input.streamKey }),
    ...(input.metadata && { metadata: input.metadata }),
  };
}

function agent(input: Partial<ThreadRunProjectionAgent> & { agentId: string }): ThreadRunProjectionAgent {
  return {
    agentId: input.agentId,
    role: input.role ?? "coder",
    kind: input.kind ?? "subagent",
    status: input.status ?? "active",
    startedAt: input.startedAt ?? "2026-01-01T00:00:01.000Z",
    durationMs: input.durationMs ?? 1000,
    timeline: input.timeline ?? [],
    ...(input.latestActivity && { latestActivity: input.latestActivity }),
    ...(input.endedAt && { endedAt: input.endedAt }),
    ...(input.usage && { usage: input.usage }),
    ...(input.context && { context: input.context }),
  };
}

function projection(input: Partial<ThreadRunProjectionSnapshot>): ThreadRunProjectionSnapshot {
  return {
    thread: {
      threadId: "thr_view",
      status: "running",
      generatedAt: "2026-01-01T00:00:00.000Z",
    },
    attempts: [],
    agents: [],
    requestSpans: [],
    timeline: [],
    diagnostics: [],
    sourceEventCount: 1,
    ...input,
  };
}

function requireValue<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`${label} missing`);
  }
  return value;
}

test("buildThreadRunProjectionViewModel keys subagent cards by agentId", () => {
  const firstTimeline = [item({ id: "a-msg", scope: "agent", role: "coder", agentId: "coder_a" })];
  const secondTimeline = [item({ id: "b-msg", scope: "agent", role: "coder", agentId: "coder_b" })];
  const view = buildThreadRunProjectionViewModel(
    projection({
      agents: [
        agent({ agentId: "coder_a", role: "coder", timeline: firstTimeline, latestActivity: "Read API" }),
        agent({ agentId: "coder_b", role: "coder", timeline: secondTimeline, latestActivity: "Edit UI" }),
      ],
      timeline: [
        item({
          id: "prompt",
          eventType: "thread.status",
          role: "user",
          text: "实现功能",
          metadata: { liveType: "thread.user_prompt" },
        }),
      ],
    }),
    { id: "thr_view", prompt: "实现功能" },
  );

  expect(view.showThreadPrompt).toBe(false);
  expect(view.subagentCards.map((card) => card.key)).toEqual(["coder_a", "coder_b"]);
  expect(view.subagentCards.map((card) => card.timelineIds)).toEqual([["a-msg"], ["b-msg"]]);
  expect(view.subagentCards.map((card) => card.statusText)).toEqual(["Read API", "Edit UI"]);
});

test("buildThreadRunProjectionViewModel keeps agent narrative in subagent card details only", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      timeline: [
        item({
          id: "main-thinking",
          eventType: "thinking.final",
          role: "thinking",
          text: "先分析结构",
          at: "2026-01-01T00:00:01.000Z",
        }),
      ],
      agents: [
        agent({
          agentId: "coder_agent_00000001",
          role: "coder",
          timeline: [
            item({
              id: "coder-says",
              eventType: "message.final",
              scope: "agent",
              role: "coder",
              agentId: "coder_agent_00000001",
              text: "我在检查渲染路径。",
              at: "2026-01-01T00:00:02.000Z",
              sequence: 2,
            }),
          ],
        }),
      ],
    }),
    undefined,
    { agentDisplayNames: { coder: "Implementation Agent" } },
  );

  expect(view.mainFeedEntries.map((entry) => entry.kind)).toEqual(["timeline", "agent-card"]);
  expect(view.mainFeedEntries.some((entry) => entry.kind === "agent-echo")).toBe(false);
  const card = view.mainFeedEntries[1];
  expect(card?.kind).toBe("agent-card");
  if (card?.kind === "agent-card") {
    expect(card.card.statusText).toBe("我在检查渲染路径。");
    expect(card.card.agent.timeline[0]?.id).toBe("coder-says");
  }
  expect(view.subagentCards[0]?.timelineIds).toEqual(["coder-says"]);
});

test("buildThreadRunProjectionViewModel keeps concurrent same-role agent details distinct", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      agents: [
        agent({
          agentId: "coder_agent_00000001",
          role: "coder",
          timeline: [
            item({
              id: "coder-a-msg",
              eventType: "message.final",
              scope: "agent",
              role: "coder",
              agentId: "coder_agent_00000001",
              text: "我处理 API。",
              at: "2026-01-01T00:00:01.000Z",
              sequence: 1,
            }),
          ],
        }),
        agent({
          agentId: "coder_agent_00000002",
          role: "coder",
          timeline: [
            item({
              id: "coder-b-msg",
              eventType: "message.final",
              scope: "agent",
              role: "coder",
              agentId: "coder_agent_00000002",
              text: "我处理 UI。",
              at: "2026-01-01T00:00:02.000Z",
              sequence: 2,
            }),
          ],
        }),
      ],
    }),
  );

  expect(view.mainFeedEntries.map((entry) => entry.kind)).toEqual(["agent-card", "agent-card"]);
  expect(view.subagentCards.map((card) => card.agent.agentId)).toEqual([
    "coder_agent_00000001",
    "coder_agent_00000002",
  ]);
  expect(view.subagentCards.map((card) => card.timelineIds)).toEqual([["coder-a-msg"], ["coder-b-msg"]]);
});

test("buildThreadRunProjectionViewModel interleaves planner and agent speech by time", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      timeline: [
        item({
          id: "planner-first",
          eventType: "thinking.final",
          role: "thinking",
          text: "先看代码。",
          at: "2026-01-01T00:00:01.000Z",
          sequence: 1,
        }),
        item({
          id: "planner-last",
          eventType: "message.final",
          role: "planner",
          text: "我总结一下。",
          at: "2026-01-01T00:00:03.000Z",
          sequence: 3,
        }),
      ],
      agents: [
        agent({
          agentId: "coder_agent_00000001",
          role: "coder",
          timeline: [
            item({
              id: "coder-middle",
              eventType: "message.final",
              scope: "agent",
              role: "coder",
              agentId: "coder_agent_00000001",
              text: "我找到问题了。",
              at: "2026-01-01T00:00:02.000Z",
              sequence: 2,
            }),
          ],
        }),
      ],
    }),
  );

  expect(view.mainFeedEntries.map((entry) => entry.key)).toEqual([
    "main:stream:thinking:role:thinking",
    "agent-card:coder_agent_00000001",
    "main:stream:message:role:planner",
  ]);
  expect(view.subagentCards[0]?.agent.timeline[0]?.text).toBe("我找到问题了。");
});

test("buildThreadRunProjectionViewModel does not echo request or lifecycle noise", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      timeline: [item({ id: "main", role: "planner", text: "Working" })],
      agents: [
        agent({
          agentId: "coder_agent_00000001",
          role: "coder",
          timeline: [
            item({
              id: "agent-start",
              eventType: "agent.started",
              scope: "agent",
              role: "coder",
              agentId: "coder_agent_00000001",
              text: "Subagent coder started",
              sequence: 1,
            }),
            item({
              id: "request-start",
              eventType: "request.started",
              scope: "agent",
              role: "coder",
              agentId: "coder_agent_00000001",
              text: "Requesting model",
              sequence: 2,
            }),
          ],
        }),
      ],
    }),
  );

  expect(view.mainFeedEntries.map((entry) => entry.key)).toEqual([
    "main:stream:message:role:planner",
    "agent-card:coder_agent_00000001",
  ]);
  expect(view.mainFeedEntries.some((entry) => entry.kind === "agent-echo")).toBe(false);
});

test("buildThreadRunProjectionViewModel hides generic approval transition status lines", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      timeline: [
        item({
          id: "prompt",
          eventType: "thread.status",
          role: "user",
          text: "读取外部配置",
          metadata: { liveType: "thread.user_prompt" },
          sequence: 1,
        }),
        item({
          id: "generic-wait",
          eventType: "thread.status",
          role: "system",
          text: "等待工具读取确认…",
          metadata: { liveType: "thread.running" },
          sequence: 2,
        }),
        item({
          id: "generic-permission-wait",
          eventType: "thread.status",
          role: "system",
          text: "等待工具权限确认…",
          metadata: { liveType: "thread.running" },
          sequence: 2.5,
        }),
        item({
          id: "approval-wait",
          eventType: "message.final",
          role: "tool",
          text: "等待确认 Read：/etc/hosts",
          streamKey: "activity-line-wait",
          metadata: {
            liveType: "bash_approval.requested",
            bashApproval: {
              toolUseId: "toolu_read_approval",
              phase: "requested",
              toolName: "Read",
              detail: "/etc/hosts",
            },
          },
          sequence: 3,
        }),
        item({
          id: "approval-approved",
          eventType: "message.final",
          role: "tool",
          text: "已允许本次 Read：/etc/hosts",
          streamKey: "activity-line-approved",
          metadata: {
            liveType: "bash_approval.approved",
            bashApproval: {
              toolUseId: "toolu_read_approval",
              phase: "approved",
              toolName: "Read",
              detail: "/etc/hosts",
            },
          },
          sequence: 4,
        }),
      ],
    }),
  );

  expect(view.mainFeedEntries.map((entry) => entry.key)).toEqual([
    "main:prompt",
    "main:stream:message:sk:activity-line-approved",
  ]);
  expect(view.mainFeedEntries.some((entry) => entry.key === "main:generic-wait")).toBe(false);
  expect(view.mainFeedEntries.some((entry) => entry.key === "main:approval-wait")).toBe(false);
});

test("buildProjectionDisplayTimelineItems merges approval and tool execution by toolUseId", () => {
  const timeline = [
    item({
      id: "approval-wait",
      eventType: "message.final",
      role: "tool",
      text: "等待确认 Grep：/outside/secret.txt",
      streamKey: "activity-line-wait",
      metadata: {
        liveType: "bash_approval.requested",
        bashApproval: {
          toolUseId: "toolu_grep_1",
          phase: "requested",
          toolName: "Grep",
          detail: "/outside/secret.txt",
        },
      },
      sequence: 1,
    }),
    item({
      id: "approval-approved",
      eventType: "message.final",
      role: "tool",
      text: "已允许本次 Grep：/outside/secret.txt",
      streamKey: "activity-line-approved",
      metadata: {
        liveType: "bash_approval.approved",
        bashApproval: {
          toolUseId: "toolu_grep_1",
          phase: "approved",
          toolName: "Grep",
          detail: "/outside/secret.txt",
        },
      },
      sequence: 2,
    }),
    item({
      id: "grep-completed",
      eventType: "tool.completed",
      role: "tool",
      text: "Tool: Grep · /outside/secret.txt",
      metadata: {
        liveType: "tool.completed",
        tool: {
          name: "Grep",
          detail: "/outside/secret.txt",
          toolUseId: "toolu_grep_1",
          status: "completed",
        },
      },
      sequence: 3,
    }),
  ];

  const displayTimeline = buildProjectionDisplayTimelineItems(timeline, new Map());
  expect(displayTimeline.map((entry) => entry.id)).toEqual(["grep-completed"]);
});

test("buildThreadRunProjectionViewModel removes main feed status and usage noise", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      timeline: [
        item({
          id: "prompt",
          eventType: "thread.status",
          role: "user",
          text: "使用子代理查询天气",
          metadata: { liveType: "thread.user_prompt" },
          sequence: 1,
        }),
        item({
          id: "agent-lifecycle",
          eventType: "agent.started",
          role: "planner",
          text: "Requesting model…",
          sequence: 2,
        }),
        item({
          id: "usage",
          eventType: "thread.status",
          role: "planner",
          text: "↑23k ↓404",
          sequence: 3,
        }),
        item({
          id: "status-updated",
          eventType: "thread.status",
          role: "system",
          text: "状态已更新",
          sequence: 4,
        }),
        item({
          id: "router-ready",
          eventType: "thread.status",
          role: "system",
          text: "Local model router ready: http://127.0.0.1:24643",
          sequence: 5,
        }),
        item({
          id: "worktree-merge",
          eventType: "message.final",
          role: "system",
          text: '__eco_worktree_merge__\n{"fileCount":1}',
          sequence: 6,
        }),
        item({
          id: "substantive",
          eventType: "message.final",
          role: "planner",
          text: "天气查询完成。",
          sequence: 7,
        }),
      ],
    }),
  );

  expect(view.mainFeedEntries.map((entry) => entry.key)).toEqual([
    "main:prompt",
    "main:stream:message:role:planner",
  ]);
});

test("buildThreadRunProjectionViewModel hides follow-up interrupt and resume status noise", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      timeline: [
        item({
          id: "prompt",
          eventType: "thread.status",
          role: "user",
          text: "继续实现登录页",
          metadata: { liveType: "thread.user_prompt" },
          sequence: 1,
        }),
        item({
          id: "interrupt",
          eventType: "thread.status",
          role: "system",
          text: "正在停止当前步骤，随后处理最新后续消息。",
          metadata: { liveType: "thread.running" },
          sequence: 2,
        }),
        item({
          id: "stopped",
          eventType: "thread.status",
          role: "system",
          text: "已停止。可继续对话；文件可通过检查点回滚。",
          metadata: { liveType: "thread.idle" },
          sequence: 3,
        }),
        item({
          id: "resume",
          eventType: "thread.status",
          role: "system",
          text: "正在继续执行…",
          metadata: { liveType: "thread.running" },
          sequence: 4,
        }),
        item({
          id: "codex-resume",
          eventType: "thread.status",
          role: "system",
          text: "正在继续 Codex 会话…",
          sequence: 5,
        }),
        item({
          id: "substantive",
          eventType: "message.final",
          role: "planner",
          text: "好的，继续实现。",
          sequence: 6,
        }),
      ],
    }),
  );

  expect(view.mainFeedEntries.map((entry) => entry.key)).toEqual([
    "main:prompt",
    "main:stream:message:role:planner",
  ]);
});

test("isProjectionUserPromptItem only accepts recorded user prompts", () => {
  const recorded = item({
    id: "prompt",
    eventType: "thread.status",
    role: "user",
    text: "请继续实现登录页",
    metadata: { liveType: "thread.user_prompt" },
  });
  const followUpCancelled = item({
    id: "cancelled",
    eventType: "thread.status",
    role: "user",
    text: "已取消排队的后续消息。",
    metadata: { liveType: "thread.follow_up.cancelled" },
  });
  const roleOnly = item({
    id: "role-only",
    eventType: "thread.status",
    role: "user",
    text: "看起来像用户消息",
  });

  expect(isProjectionUserPromptItem(recorded)).toBe(true);
  expect(isProjectionUserPromptItem(followUpCancelled)).toBe(false);
  expect(isProjectionUserPromptItem(roleOnly)).toBe(false);
});

test("buildThreadRunProjectionViewModel keeps pre-speech current action on the agent card", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      agents: [
        agent({
          agentId: "coder_agent_00000001",
          role: "coder",
          status: "active",
          timeline: [
            item({
              id: "tool-read",
              eventType: "tool.started",
              scope: "agent",
              role: "coder",
              agentId: "coder_agent_00000001",
              text: "Tool: Read · ActivityLogView.tsx",
              metadata: {
                tool: {
                  name: "Read",
                  detail: "ActivityLogView.tsx",
                  toolUseId: "toolu_read_1",
                  status: "running",
                },
              },
              sequence: 1,
            }),
          ],
        }),
      ],
    }),
  );

  expect(view.mainFeedEntries).toHaveLength(1);
  const entry = view.mainFeedEntries[0];
  expect(entry?.kind).toBe("agent-card");
  if (entry?.kind === "agent-card") {
    expect(entry.card.statusText).toBe("ActivityLogView.tsx");
    expect(entry.card.agent.agentId).toBe("coder_agent_00000001");
  }
});

test("buildThreadRunProjectionViewModel removes completed agent request placeholders from cards", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      requestSpans: [
        {
          requestId: "req_coder",
          status: "completed",
          startedAt: "2026-01-01T00:00:01.000Z",
          endedAt: "2026-01-01T00:00:05.000Z",
          ownerAgentId: "coder_done",
          role: "coder",
        },
      ],
      agents: [
        agent({
          agentId: "coder_done",
          role: "coder",
          status: "stopped",
          endedAt: "2026-01-01T00:00:05.000Z",
          timeline: [
            item({
              id: "request-start",
              eventType: "request.started",
              scope: "agent",
              role: "coder",
              agentId: "coder_done",
              requestId: "req_coder",
              at: "2026-01-01T00:00:01.000Z",
              sequence: 1,
            }),
            item({
              id: "tool",
              eventType: "tool.started",
              scope: "agent",
              role: "coder",
              agentId: "coder_done",
              text: "Tool: Bash · git diff",
              at: "2026-01-01T00:00:03.000Z",
              sequence: 2,
            }),
          ],
        }),
      ],
    }),
  );

  expect(view.subagentCards[0]?.timelineIds).toEqual(["tool"]);
});

test("buildThreadRunProjectionViewModel ignores empty streaming agent placeholders", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      agents: [
        agent({
          agentId: "coder_agent_00000001",
          role: "coder",
          status: "active",
          timeline: [
            item({
              id: "empty-delta",
              eventType: "message.delta",
              scope: "agent",
              role: "coder",
              agentId: "coder_agent_00000001",
              text: "",
              sequence: 1,
            }),
          ],
        }),
      ],
    }),
  );

  expect(view.mainFeedEntries.map((entry) => entry.kind)).toEqual(["agent-card"]);
  expect(view.mainFeedEntries.some((entry) => entry.kind === "agent-echo")).toBe(false);
});

test("buildThreadRunProjectionViewModel treats legacy todo updates as tool state not speech", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      agents: [
        agent({
          agentId: "explore_agent_00000001",
          role: "explore",
          status: "stopped",
          timeline: [
            item({
              id: "todo-webfetch",
              eventType: "message.final",
              scope: "agent",
              role: "explore",
              agentId: "explore_agent_00000001",
              text: "Tool: WebFetch · https://weather.example",
              metadata: {
                liveType: "todo.updated",
                tool: {
                  name: "WebFetch",
                  detail: "https://weather.example",
                  toolUseId: "toolu_fetch_1",
                },
              },
              sequence: 1,
            }),
          ],
        }),
      ],
    }),
  );

  expect(view.mainFeedEntries.map((entry) => entry.kind)).toEqual(["agent-card"]);
  expect(view.mainFeedEntries.some((entry) => entry.kind === "agent-echo")).toBe(false);
  expect(view.subagentCards[0]?.statusText).toBe("https://weather.example");
  const firstCard = requireValue(view.subagentCards[0], "subagent card");
  const firstTimelineItem = requireValue(firstCard.agent.timeline[0], "subagent timeline item");
  expect(projectionItemToDetailBlock(firstTimelineItem)).toMatchObject({
    kind: "action",
    label: "https://weather.example",
  });
});

test("buildThreadRunProjectionViewModel hides empty streaming placeholder without losing request state", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      timeline: [
        item({
          id: "request-start",
          eventType: "request.started",
          role: "planner",
          requestId: "req_planner",
          at: "2026-01-01T00:00:01.000Z",
          sequence: 1,
        }),
        item({
          id: "thinking-placeholder",
          eventType: "thinking.delta",
          role: "thinking",
          requestId: "req_planner",
          text: "",
          at: "2026-01-01T00:00:02.000Z",
          sequence: 2,
        }),
      ],
    }),
  );

  expect(view.mainFeedEntries.map((entry) => entry.key)).toEqual(["main:request-start"]);
});

test("buildThreadRunProjectionViewModel hides legacy Codex lifecycle noise", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      thread: {
        threadId: "thr_view",
        status: "completed",
        generatedAt: "2026-01-01T00:00:05.000Z",
      },
      timeline: [
        item({
          id: "prompt",
          eventType: "thread.status",
          role: "user",
          text: "你好",
          metadata: { liveType: "thread.user_prompt" },
        }),
        item({ id: "starting", eventType: "thread.status", role: "system", text: "正在启动 Codex…" }),
        item({
          id: "connected",
          eventType: "thread.status",
          role: "system",
          text: "Codex 已连接 · gpt-5.6-sol",
        }),
        item({ id: "turn-start", eventType: "run.attempt.started", text: "Turn started" }),
        item({ id: "answer", eventType: "message.final", role: "assistant", text: "你好！" }),
        item({ id: "turn-end", eventType: "run.attempt.completed", text: "Turn completed" }),
        item({
          id: "completed",
          eventType: "thread.status",
          role: "system",
          text: "回答完成。",
          metadata: { liveType: "thread.completed" },
        }),
      ],
    }),
  );

  expect(
    view.mainFeedEntries.filter((entry) => entry.kind === "timeline").map((entry) => entry.item.text),
  ).toEqual(["你好", "你好！"]);
});

test("buildThreadRunProjectionViewModel hides plan-ready statuses already represented by Composer", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      thread: {
        threadId: "thr_plan",
        status: "awaiting_plan",
        generatedAt: "2026-01-01T00:00:05.000Z",
      },
      timeline: [
        item({
          id: "prompt",
          eventType: "thread.status",
          role: "user",
          text: "制定计划",
          metadata: { liveType: "thread.user_prompt" },
        }),
        item({
          id: "plan-ready",
          eventType: "thread.status",
          role: "planner",
          text: "计划已生成，等待确认。",
          metadata: { liveType: "plan.ready" },
        }),
        item({
          id: "awaiting-plan",
          eventType: "thread.status",
          role: "system",
          text: "计划已生成，请确认是否执行。",
          metadata: { liveType: "thread.awaiting_plan" },
        }),
        item({
          id: "legacy-plan-ready",
          eventType: "thread.status",
          role: "planner",
          text: "计划已生成，等待确认。",
        }),
      ],
    }),
  );

  expect(
    view.mainFeedEntries.filter((entry) => entry.kind === "timeline").map((entry) => entry.item.text),
  ).toEqual(["制定计划"]);
});

test("buildThreadRunProjectionViewModel collapses legacy duplicate plan dismissals", () => {
  const legacyMessage = "已忽略计划。可在下方继续对话说明修改意见，Planner 将重新输出完整计划。";
  const view = buildThreadRunProjectionViewModel(
    projection({
      thread: {
        threadId: "thr_plan",
        status: "idle",
        generatedAt: "2026-01-01T00:00:05.000Z",
      },
      timeline: [
        item({
          id: "prompt",
          eventType: "thread.status",
          role: "user",
          text: "制定计划",
          at: "2026-01-01T00:00:01.000Z",
          sequence: 1,
          metadata: { liveType: "thread.user_prompt" },
        }),
        item({
          id: "dismissed-1",
          eventType: "thread.status",
          role: "system",
          text: legacyMessage,
          at: "2026-01-01T00:00:02.000Z",
          sequence: 2,
          metadata: { liveType: "thread.idle" },
        }),
        item({
          id: "dismissed-2",
          eventType: "thread.status",
          role: "system",
          text: legacyMessage,
          at: "2026-01-01T00:00:03.000Z",
          sequence: 3,
          metadata: { liveType: "thread.idle" },
        }),
      ],
    }),
  );

  expect(
    view.mainFeedEntries.filter((entry) => entry.kind === "timeline").map((entry) => entry.item.text),
  ).toEqual(["制定计划", "计划忽略"]);
});

test("buildThreadRunProjectionViewModel collapses superseded stream deltas after final output", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      requestSpans: [
        {
          requestId: "stream:thinking",
          status: "completed",
          startedAt: "2026-01-01T00:00:01.000Z",
          firstTokenAt: "2026-01-01T00:00:02.000Z",
          endedAt: "2026-01-01T00:00:03.000Z",
        },
      ],
      timeline: [
        item({
          id: "thinking-placeholder",
          eventType: "thinking.delta",
          role: "thinking",
          text: "",
          at: "2026-01-01T00:00:01.000Z",
          sequence: 1,
        }),
        item({
          id: "thinking-delta",
          eventType: "thinking.delta",
          role: "thinking",
          text: "先查天气来源",
          at: "2026-01-01T00:00:02.000Z",
          sequence: 2,
        }),
        item({
          id: "thinking-final",
          eventType: "thinking.final",
          role: "thinking",
          text: "先查天气来源",
          at: "2026-01-01T00:00:03.000Z",
          sequence: 3,
        }),
      ],
    }),
  );

  expect(view.mainFeedEntries.map((entry) => entry.key)).toEqual(["main:stream:thinking:role:thinking"]);
  const entry = view.mainFeedEntries[0];
  expect(entry?.kind).toBe("timeline");
  if (entry?.kind === "timeline") {
    expect(projectionItemToDetailBlock(entry.item)).toMatchObject({
      kind: "thinking",
      streaming: false,
      text: "先查天气来源",
    });
  }
});

test("buildThreadRunProjectionViewModel does not bleed prior thinking into a new request", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      requestSpans: [
        {
          requestId: "req_old",
          status: "completed",
          startedAt: "2026-01-01T00:00:01.000Z",
          endedAt: "2026-01-01T00:00:02.000Z",
        },
        {
          requestId: "req_new",
          status: "streaming",
          startedAt: "2026-01-01T00:00:03.000Z",
        },
      ],
      timeline: [
        item({
          id: "thinking-old-final",
          eventType: "thinking.final",
          role: "thinking",
          requestId: "req_old",
          streamKey: "thr_test:thinking",
          text: "The user wants to download a GGUF model with a very long prior thought.",
          at: "2026-01-01T00:00:02.000Z",
          sequence: 1,
        }),
        item({
          id: "thinking-new-delta",
          eventType: "thinking.delta",
          role: "thinking",
          requestId: "req_new",
          streamKey: "thr_test:thinking",
          text: "Good, starting fresh.",
          at: "2026-01-01T00:00:04.000Z",
          sequence: 2,
        }),
      ],
    }),
  );

  const entries = view.mainFeedEntries.filter(
    (entry) => entry.kind === "timeline" && entry.item.eventType.includes("thinking"),
  );
  expect(entries.map((entry) => entry.key)).toEqual([
    "main:stream:thinking:request:req_old",
    "main:stream:thinking:sk:thr_test:thinking:req:req_new",
  ]);
  const latest = entries.at(-1);
  expect(latest?.kind).toBe("timeline");
  if (latest?.kind === "timeline") {
    expect(projectionItemToDetailBlock(latest.item)).toMatchObject({
      kind: "thinking",
      text: "Good, starting fresh.",
      streaming: true,
    });
  }
});

test("buildThreadRunProjectionViewModel keeps historical thinking without requestId in chronological order", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      requestSpans: [
        {
          requestId: "req_1",
          status: "completed",
          startedAt: "2026-01-01T00:00:01.000Z",
          endedAt: "2026-01-01T00:00:05.000Z",
        },
        {
          requestId: "req_2",
          status: "streaming",
          startedAt: "2026-01-01T00:01:00.000Z",
        },
      ],
      timeline: [
        item({
          id: "t1-think",
          eventType: "thinking.delta",
          role: "thinking",
          streamKey: "thr_test:thinking",
          text: "第一轮思考",
          at: "2026-01-01T00:00:02.000Z",
          sequence: 1,
        }),
        item({
          id: "t1-msg",
          eventType: "message.final",
          role: "planner",
          requestId: "req_1",
          text: "第一轮回复",
          at: "2026-01-01T00:00:05.000Z",
          sequence: 2,
        }),
        item({
          id: "user",
          eventType: "thread.status",
          role: "user",
          text: "继续",
          metadata: { liveType: "thread.user_prompt" },
          at: "2026-01-01T00:00:59.000Z",
          sequence: 3,
        }),
        item({
          id: "t2-think",
          eventType: "thinking.delta",
          role: "thinking",
          requestId: "req_2",
          streamKey: "thr_test:thinking",
          text: "第二轮思考",
          at: "2026-01-01T00:01:02.000Z",
          sequence: 4,
        }),
      ],
    }),
  );

  expect(
    view.mainFeedEntries.filter((entry) => entry.kind === "timeline").map((entry) => entry.item.id),
  ).toEqual(["t1-think", "t1-msg", "user", "t2-think"]);
});

test("buildThreadRunProjectionViewModel keeps streaming thinking above streaming message body", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      requestSpans: [
        {
          requestId: "req_1",
          status: "streaming",
          startedAt: "2026-01-01T00:00:01.000Z",
        },
      ],
      timeline: [
        item({
          id: "thinking-delta",
          eventType: "thinking.delta",
          role: "thinking",
          requestId: "req_1",
          streamKey: "thr_test:thinking",
          text: "正在思考",
          at: "2026-01-01T00:00:02.000Z",
          sequence: 2,
        }),
        item({
          id: "message-delta",
          eventType: "message.delta",
          role: "planner",
          requestId: "req_1",
          text: "正文输出",
          at: "2026-01-01T00:00:05.000Z",
          sequence: 3,
        }),
      ],
    }),
  );

  expect(
    view.mainFeedEntries.filter((entry) => entry.kind === "timeline").map((entry) => entry.item.id),
  ).toEqual(["thinking-delta", "message-delta"]);
});

test("buildThreadRunProjectionViewModel preserves thinking text across empty stream placeholders", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      requestSpans: [
        {
          requestId: "req_think",
          status: "streaming",
          startedAt: "2026-01-01T00:00:01.000Z",
        },
      ],
      timeline: [
        item({
          id: "thinking-delta",
          eventType: "thinking.delta",
          role: "thinking",
          requestId: "req_think",
          streamKey: "thinking:sk:thr_test:thinking",
          text: "较长的思考内容",
          at: "2026-01-01T00:00:02.000Z",
          sequence: 2,
        }),
        item({
          id: "thinking-placeholder",
          eventType: "thinking.delta",
          role: "thinking",
          requestId: "req_think",
          streamKey: "thinking:sk:thr_test:thinking",
          text: "",
          at: "2026-01-01T00:00:03.000Z",
          sequence: 3,
        }),
        item({
          id: "thinking-shorter",
          eventType: "thinking.delta",
          role: "thinking",
          requestId: "req_think",
          streamKey: "thinking:sk:thr_test:thinking",
          text: "短",
          at: "2026-01-01T00:00:04.000Z",
          sequence: 4,
        }),
      ],
    }),
  );

  const entry = view.mainFeedEntries.find(
    (candidate) => candidate.kind === "timeline" && candidate.item.eventType.includes("thinking"),
  );
  expect(entry?.kind).toBe("timeline");
  if (entry?.kind === "timeline") {
    expect(projectionItemToDetailBlock(entry.item)).toMatchObject({
      kind: "thinking",
      text: "较长的思考内容",
      streaming: true,
    });
  }
});

test("buildThreadRunProjectionViewModel settles terminal deltas when final event is missing", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      requestSpans: [
        {
          requestId: "req_planner",
          status: "completed",
          startedAt: "2026-01-01T00:00:01.000Z",
          firstTokenAt: "2026-01-01T00:00:02.000Z",
          endedAt: "2026-01-01T00:00:03.000Z",
        },
      ],
      timeline: [
        item({
          id: "planner-delta",
          eventType: "message.delta",
          role: "planner",
          requestId: "req_planner",
          text: "天气查询完成。",
          at: "2026-01-01T00:00:02.000Z",
          sequence: 2,
        }),
      ],
    }),
  );

  const entry = view.mainFeedEntries[0];
  expect(entry?.kind).toBe("timeline");
  if (entry?.kind === "timeline") {
    expect(entry.item.eventType).toBe("message.final");
    expect(projectionItemToDetailBlock(entry.item)).toMatchObject({
      kind: "narrative",
      streaming: false,
      text: "天气查询完成。",
    });
  }
});

test("buildThreadRunProjectionViewModel settles stale active stream when thread is interrupted", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      thread: {
        threadId: "thr_view",
        status: "idle",
        generatedAt: "2026-01-01T00:00:04.000Z",
      },
      requestSpans: [
        {
          requestId: "req_interrupted",
          status: "streaming",
          startedAt: "2026-01-01T00:00:01.000Z",
          firstTokenAt: "2026-01-01T00:00:02.000Z",
        },
      ],
      timeline: [
        item({
          id: "request-start",
          eventType: "request.started",
          role: "planner",
          requestId: "req_interrupted",
          at: "2026-01-01T00:00:01.000Z",
          sequence: 1,
        }),
        item({
          id: "planner-delta",
          eventType: "message.delta",
          role: "planner",
          requestId: "req_interrupted",
          text: "我先停在这里。",
          at: "2026-01-01T00:00:02.000Z",
          sequence: 2,
        }),
      ],
    }),
  );

  expect(view.mainFeedEntries.map((entry) => entry.key)).toEqual([
    "main:stream:message:request:req_interrupted",
  ]);
  const entry = view.mainFeedEntries[0];
  expect(entry?.kind).toBe("timeline");
  if (entry?.kind === "timeline") {
    expect(entry.item.eventType).toBe("message.final");
    expect(projectionItemToDetailBlock(entry.item)).toMatchObject({
      kind: "narrative",
      streaming: false,
      text: "我先停在这里。",
    });
  }
});

test("buildThreadRunProjectionViewModel hides request lifecycle terminal events", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      requestSpans: [
        {
          requestId: "req_done",
          status: "completed",
          startedAt: "2026-01-01T00:00:01.000Z",
          endedAt: "2026-01-01T00:00:02.000Z",
        },
        {
          requestId: "req_failed",
          status: "failed",
          startedAt: "2026-01-01T00:00:03.000Z",
          endedAt: "2026-01-01T00:00:04.000Z",
        },
        {
          requestId: "req_cancelled",
          status: "cancelled",
          startedAt: "2026-01-01T00:00:05.000Z",
          endedAt: "2026-01-01T00:00:06.000Z",
        },
      ],
      timeline: [
        item({
          id: "request-start",
          eventType: "request.started",
          role: "planner",
          requestId: "req_done",
          at: "2026-01-01T00:00:01.000Z",
          sequence: 1,
        }),
        item({
          id: "request-done",
          eventType: "request.completed",
          role: "planner",
          requestId: "req_done",
          at: "2026-01-01T00:00:02.000Z",
          sequence: 2,
        }),
        item({
          id: "request-failed-start",
          eventType: "request.started",
          role: "planner",
          requestId: "req_failed",
          at: "2026-01-01T00:00:03.000Z",
          sequence: 3,
        }),
        item({
          id: "request-failed",
          eventType: "request.failed",
          role: "planner",
          requestId: "req_failed",
          text: "HTTP 502",
          at: "2026-01-01T00:00:04.000Z",
          sequence: 4,
        }),
        item({
          id: "request-cancelled-start",
          eventType: "request.started",
          role: "planner",
          requestId: "req_cancelled",
          at: "2026-01-01T00:00:05.000Z",
          sequence: 5,
        }),
        item({
          id: "request-cancelled",
          eventType: "request.cancelled",
          role: "planner",
          requestId: "req_cancelled",
          text: "模型请求已取消",
          at: "2026-01-01T00:00:06.000Z",
          sequence: 6,
        }),
      ],
    }),
  );

  expect(view.mainFeedEntries).toEqual([]);
});

test("buildThreadRunProjectionViewModel hides duplicate active request placeholders for the same owner", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      requestSpans: [
        {
          requestId: "req_proxy",
          status: "waiting_first_token",
          startedAt: "2026-01-01T00:00:01.000Z",
          role: "planner",
        },
        {
          requestId: "req_sdk",
          status: "waiting_first_token",
          startedAt: "2026-01-01T00:00:01.100Z",
          role: "planner",
        },
      ],
      timeline: [
        item({
          id: "proxy-request",
          eventType: "request.started",
          role: "planner",
          requestId: "req_proxy",
          at: "2026-01-01T00:00:01.000Z",
          sequence: 1,
        }),
        item({
          id: "sdk-request",
          eventType: "request.started",
          role: "planner",
          requestId: "req_sdk",
          at: "2026-01-01T00:00:01.100Z",
          sequence: 2,
        }),
      ],
    }),
  );

  expect(view.mainFeedEntries.map((entry) => entry.key)).toEqual(["main:sdk-request"]);
});

test("buildThreadRunProjectionViewModel hides request placeholders once owner output appears", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      requestSpans: [
        {
          requestId: "req_orphan_started",
          status: "waiting_first_token",
          startedAt: "2026-01-01T00:00:01.000Z",
        },
        {
          requestId: "stream:planner",
          status: "streaming",
          startedAt: "2026-01-01T00:00:01.500Z",
          firstTokenAt: "2026-01-01T00:00:02.000Z",
        },
      ],
      timeline: [
        item({
          id: "request-start",
          eventType: "request.started",
          role: "planner",
          requestId: "req_orphan_started",
          at: "2026-01-01T00:00:01.000Z",
          sequence: 1,
        }),
        item({
          id: "planner-delta",
          eventType: "message.delta",
          role: "planner",
          text: "我会让子代理查询天气。",
          at: "2026-01-01T00:00:02.000Z",
          sequence: 2,
        }),
      ],
    }),
  );

  expect(view.mainFeedEntries.map((entry) => entry.key)).toEqual(["main:stream:message:role:planner"]);
});

test("buildThreadRunProjectionViewModel hides request placeholder for completed message-only responses", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      requestSpans: [
        {
          requestId: "req_planner",
          status: "completed",
          startedAt: "2026-01-01T00:00:01.000Z",
          firstTokenAt: "2026-01-01T00:00:03.000Z",
          endedAt: "2026-01-01T00:00:05.000Z",
        },
      ],
      timeline: [
        item({
          id: "request-start",
          eventType: "request.started",
          role: "planner",
          requestId: "req_planner",
          at: "2026-01-01T00:00:01.000Z",
          sequence: 1,
        }),
        item({
          id: "planner-final",
          eventType: "message.final",
          role: "planner",
          requestId: "req_planner",
          text: "直接回复，没有思考内容。",
          at: "2026-01-01T00:00:05.000Z",
          sequence: 2,
        }),
      ],
    }),
  );

  expect(view.mainFeedEntries.map((entry) => entry.key)).toEqual(["main:stream:message:request:req_planner"]);
});

test("buildThreadRunProjectionViewModel keeps follow-up request placeholder after prior planner output", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      requestSpans: [
        {
          requestId: "req_turn_1",
          status: "completed",
          startedAt: "2026-01-01T00:00:01.000Z",
          firstTokenAt: "2026-01-01T00:00:02.000Z",
          endedAt: "2026-01-01T00:00:03.000Z",
        },
        {
          requestId: "req_turn_2",
          status: "waiting_first_token",
          startedAt: "2026-01-01T00:01:00.000Z",
          role: "planner",
        },
      ],
      timeline: [
        item({
          id: "turn-1-final",
          eventType: "message.final",
          role: "planner",
          requestId: "req_turn_1",
          text: "第一轮回复。",
          at: "2026-01-01T00:00:03.000Z",
          sequence: 1,
        }),
        item({
          id: "turn-2-user",
          eventType: "thread.status",
          role: "user",
          text: "继续帮我查一下。",
          metadata: { liveType: "thread.user_prompt" },
          at: "2026-01-01T00:00:59.000Z",
          sequence: 2,
        }),
        item({
          id: "turn-2-request",
          eventType: "request.started",
          role: "planner",
          requestId: "req_turn_2",
          at: "2026-01-01T00:01:00.000Z",
          sequence: 3,
        }),
      ],
    }),
  );

  expect(view.mainFeedEntries.map((entry) => entry.key)).toEqual([
    "main:stream:message:request:req_turn_1",
    "main:turn-2-user",
    "main:turn-2-request",
  ]);
  const requestEntry = view.mainFeedEntries[2];
  expect(requestEntry?.kind).toBe("timeline");
  if (requestEntry?.kind === "timeline") {
    expect(projectionItemToDetailBlock(requestEntry.item)).toMatchObject({
      kind: "model-request",
      role: "planner",
    });
  }
});

test("buildThreadRunProjectionViewModel keeps completed planner replies from prior turns", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      requestSpans: [
        {
          requestId: "req_turn_1",
          status: "completed",
          startedAt: "2026-01-01T00:00:01.000Z",
          endedAt: "2026-01-01T00:00:03.000Z",
        },
        {
          requestId: "req_turn_2",
          status: "completed",
          startedAt: "2026-01-01T00:01:00.000Z",
          endedAt: "2026-01-01T00:01:05.000Z",
        },
      ],
      timeline: [
        item({
          id: "turn-1-final",
          eventType: "message.final",
          role: "planner",
          requestId: "req_turn_1",
          streamKey: "thr_view:planner",
          text: "第一轮回复。",
          at: "2026-01-01T00:00:03.000Z",
          sequence: 1,
        }),
        item({
          id: "turn-2-user",
          eventType: "thread.status",
          role: "user",
          text: "继续帮我查一下。",
          metadata: { liveType: "thread.user_prompt" },
          at: "2026-01-01T00:00:59.000Z",
          sequence: 2,
        }),
        item({
          id: "turn-2-final",
          eventType: "message.final",
          role: "planner",
          requestId: "req_turn_2",
          streamKey: "thr_view:planner",
          text: "第二轮回复。",
          at: "2026-01-01T00:01:05.000Z",
          sequence: 3,
        }),
      ],
    }),
  );

  expect(view.mainFeedEntries.map((entry) => entry.key)).toEqual([
    "main:stream:message:request:req_turn_1",
    "main:turn-2-user",
    "main:stream:message:request:req_turn_2",
  ]);
  const narratives = view.mainFeedEntries
    .filter((entry): entry is Extract<typeof entry, { kind: "timeline" }> => entry.kind === "timeline")
    .map((entry) => projectionItemToDetailBlock(entry.item))
    .filter((block) => block?.kind === "narrative");
  expect(narratives.map((block) => block?.text)).toEqual(["第一轮回复。", "第二轮回复。"]);
});

test("buildThreadRunProjectionViewModel keeps completed planner thinking from prior turns", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      requestSpans: [
        {
          requestId: "req_turn_1",
          status: "completed",
          startedAt: "2026-01-01T00:00:01.000Z",
          endedAt: "2026-01-01T00:00:03.000Z",
          role: "planner",
        },
        {
          requestId: "req_turn_2",
          status: "completed",
          startedAt: "2026-01-01T00:01:00.000Z",
          endedAt: "2026-01-01T00:01:05.000Z",
          role: "planner",
        },
      ],
      timeline: [
        item({
          id: "turn-1-request",
          eventType: "request.started",
          role: "planner",
          requestId: "req_turn_1",
          at: "2026-01-01T00:00:01.000Z",
          sequence: 1,
        }),
        item({
          id: "turn-1-thinking",
          eventType: "thinking.final",
          role: "thinking",
          streamKey: "thr_view:thinking",
          text: "第一轮思考。",
          at: "2026-01-01T00:00:02.000Z",
          sequence: 2,
        }),
        item({
          id: "turn-1-final",
          eventType: "message.final",
          role: "planner",
          requestId: "req_turn_1",
          text: "第一轮回复。",
          at: "2026-01-01T00:00:03.000Z",
          sequence: 3,
        }),
        item({
          id: "turn-2-user",
          eventType: "thread.status",
          role: "user",
          text: "继续。",
          metadata: { liveType: "thread.user_prompt" },
          at: "2026-01-01T00:00:59.000Z",
          sequence: 4,
        }),
        item({
          id: "turn-2-request",
          eventType: "request.started",
          role: "planner",
          requestId: "req_turn_2",
          at: "2026-01-01T00:01:00.000Z",
          sequence: 5,
        }),
        item({
          id: "turn-2-thinking",
          eventType: "thinking.final",
          role: "thinking",
          streamKey: "thr_view:thinking",
          text: "第二轮思考。",
          at: "2026-01-01T00:01:02.000Z",
          sequence: 6,
        }),
        item({
          id: "turn-2-final",
          eventType: "message.final",
          role: "planner",
          requestId: "req_turn_2",
          text: "第二轮回复。",
          at: "2026-01-01T00:01:05.000Z",
          sequence: 7,
        }),
      ],
    }),
  );

  const thinking = view.mainFeedEntries
    .filter(
      (entry): entry is Extract<typeof entry, { kind: "timeline" }> =>
        entry.kind === "timeline" && entry.item.eventType.includes("thinking"),
    )
    .map((entry) => projectionItemToDetailBlock(entry.item));
  expect(thinking.map((block) => block?.text)).toEqual(["第一轮思考。", "第二轮思考。"]);
});

test("buildThreadRunProjectionViewModel interleaves completed thinking before each planner reply", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      requestSpans: [
        {
          requestId: "req_turn_1",
          status: "completed",
          startedAt: "2026-01-01T00:00:01.000Z",
          endedAt: "2026-01-01T00:00:05.000Z",
        },
        {
          requestId: "req_turn_2",
          status: "completed",
          startedAt: "2026-01-01T00:01:00.000Z",
          endedAt: "2026-01-01T00:01:05.000Z",
        },
      ],
      timeline: [
        item({
          id: "turn-1-thinking",
          eventType: "thinking.final",
          role: "thinking",
          requestId: "req_turn_1",
          streamKey: "thr_view:thinking",
          text: "第一轮思考。",
          at: "2026-01-01T00:00:02.000Z",
          sequence: 1,
        }),
        item({
          id: "turn-1-final",
          eventType: "message.final",
          role: "planner",
          requestId: "req_turn_1",
          text: "第一轮回复。",
          at: "2026-01-01T00:00:05.000Z",
          sequence: 2,
        }),
        item({
          id: "turn-2-thinking",
          eventType: "thinking.final",
          role: "thinking",
          requestId: "req_turn_2",
          streamKey: "thr_view:thinking",
          text: "第二轮思考。",
          at: "2026-01-01T00:01:02.000Z",
          sequence: 3,
        }),
        item({
          id: "turn-2-final",
          eventType: "message.final",
          role: "planner",
          requestId: "req_turn_2",
          text: "第二轮回复。",
          at: "2026-01-01T00:01:05.000Z",
          sequence: 4,
        }),
      ],
    }),
  );

  const streamTexts = view.mainFeedEntries
    .filter(
      (entry): entry is Extract<typeof entry, { kind: "timeline" }> =>
        entry.kind === "timeline" &&
        (entry.item.eventType === "thinking.final" || entry.item.eventType === "message.final"),
    )
    .map((entry) => entry.item.text);
  expect(streamTexts).toEqual(["第一轮思考。", "第一轮回复。", "第二轮思考。", "第二轮回复。"]);
});

test("buildThreadRunProjectionViewModel does not bleed prior thinking text into a new turn delta", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      requestSpans: [
        {
          requestId: "req_turn_1",
          status: "completed",
          startedAt: "2026-01-01T00:00:01.000Z",
          endedAt: "2026-01-01T00:00:03.000Z",
        },
        {
          requestId: "req_turn_2",
          status: "streaming",
          startedAt: "2026-01-01T00:01:00.000Z",
        },
      ],
      timeline: [
        item({
          id: "turn-1-thinking",
          eventType: "thinking.delta",
          role: "thinking",
          requestId: "req_turn_1",
          streamKey: "thr_view:thinking",
          text: "旧思考内容很长",
          at: "2026-01-01T00:00:02.000Z",
          sequence: 1,
        }),
        item({
          id: "turn-1-final",
          eventType: "message.final",
          role: "planner",
          requestId: "req_turn_1",
          text: "第一轮回复。",
          at: "2026-01-01T00:00:03.000Z",
          sequence: 2,
        }),
        item({
          id: "turn-2-user",
          eventType: "thread.status",
          role: "user",
          text: "继续。",
          metadata: { liveType: "thread.user_prompt" },
          at: "2026-01-01T00:00:59.000Z",
          sequence: 3,
        }),
        item({
          id: "turn-2-thinking",
          eventType: "thinking.delta",
          role: "thinking",
          requestId: "req_turn_1",
          streamKey: "thr_view:thinking",
          text: "新思考",
          at: "2026-01-01T00:01:01.000Z",
          sequence: 4,
        }),
      ],
    }),
  );

  const thinking = view.mainFeedEntries.filter(
    (entry): entry is Extract<typeof entry, { kind: "timeline" }> =>
      entry.kind === "timeline" && entry.item.eventType.includes("thinking"),
  );
  expect(thinking.map((entry) => entry.item.text)).toEqual(["旧思考内容很长", "新思考"]);
});

test("buildThreadRunProjectionViewModel keeps prior message.final when next turn streams with shared streamKey", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      requestSpans: [
        {
          requestId: "req_turn_1",
          status: "completed",
          startedAt: "2026-01-01T00:00:01.000Z",
          endedAt: "2026-01-01T00:00:03.000Z",
        },
        {
          requestId: "req_turn_2",
          status: "streaming",
          startedAt: "2026-01-01T00:01:00.000Z",
        },
      ],
      timeline: [
        item({
          id: "turn-1-final",
          eventType: "message.final",
          role: "planner",
          requestId: "req_turn_1",
          streamKey: "thr_view:planner",
          text: "第一轮回复。",
          at: "2026-01-01T00:00:03.000Z",
          sequence: 1,
        }),
        item({
          id: "turn-2-user",
          eventType: "thread.status",
          role: "user",
          text: "继续。",
          metadata: { liveType: "thread.user_prompt" },
          at: "2026-01-01T00:00:59.000Z",
          sequence: 2,
        }),
        item({
          id: "turn-2-delta",
          eventType: "message.delta",
          role: "planner",
          requestId: "req_turn_2",
          streamKey: "thr_view:planner",
          text: "第二轮",
          at: "2026-01-01T00:01:01.000Z",
          sequence: 3,
        }),
      ],
    }),
  );

  const narratives = view.mainFeedEntries
    .filter((entry): entry is Extract<typeof entry, { kind: "timeline" }> => entry.kind === "timeline")
    .map((entry) => projectionItemToDetailBlock(entry.item))
    .filter((block) => block?.kind === "narrative");
  expect(narratives.map((block) => block?.text)).toEqual(["第一轮回复。", "第二轮"]);
});

test("buildThreadRunProjectionViewModel does not bleed prior thinking delta into a new thinking delta on the same request", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      requestSpans: [
        {
          requestId: "req_1",
          status: "streaming",
          startedAt: "2026-01-01T00:00:01.000Z",
          firstTokenAt: "2026-01-01T00:00:02.000Z",
        },
      ],
      timeline: [
        item({
          id: "think-1",
          eventType: "thinking.delta",
          role: "thinking",
          requestId: "req_1",
          streamKey: "thr_test:thinking",
          text: "旧思考内容很长",
          at: "2026-01-01T00:00:02.000Z",
          sequence: 1,
        }),
        item({
          id: "think-2",
          eventType: "thinking.delta",
          role: "thinking",
          requestId: "req_1",
          streamKey: "thr_test:thinking",
          text: "新思考",
          at: "2026-01-01T00:00:04.000Z",
          sequence: 2,
        }),
      ],
    }),
  );

  const thinking = view.mainFeedEntries.filter(
    (entry): entry is Extract<typeof entry, { kind: "timeline" }> =>
      entry.kind === "timeline" && entry.item.eventType.includes("thinking"),
  );
  expect(thinking.map((entry) => entry.item.text)).toEqual(["新思考"]);
});

test("buildThreadRunProjectionViewModel keeps final main agent text after empty placeholder sharing a streamKey", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      requestSpans: [
        {
          requestId: "stream:act_weather",
          status: "completed",
          startedAt: "2026-01-01T00:00:01.000Z",
          endedAt: "2026-01-01T00:00:03.000Z",
        },
      ],
      timeline: [
        item({
          id: "planner-placeholder",
          eventType: "message.delta",
          role: "planner",
          text: "",
          streamKey: "act_weather",
          at: "2026-01-01T00:00:01.000Z",
          sequence: 1,
        }),
        item({
          id: "planner-final",
          eventType: "message.final",
          role: "planner",
          text: "子代理查询结果：广州今天中到大雨。",
          streamKey: "act_weather",
          at: "2026-01-01T00:00:03.000Z",
          sequence: 2,
        }),
      ],
    }),
  );

  expect(view.mainFeedEntries.map((entry) => entry.key)).toEqual(["main:stream:message:sk:act_weather"]);
  const entry = view.mainFeedEntries[0];
  expect(entry?.kind).toBe("timeline");
  if (entry?.kind === "timeline") {
    expect(projectionItemToDetailBlock(entry.item)).toMatchObject({
      kind: "narrative",
      streaming: false,
      text: "子代理查询结果：广州今天中到大雨。",
    });
  }
});

test("buildThreadRunProjectionViewModel keeps separate SDK text blocks in one completed request", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      requestSpans: [
        {
          requestId: "req_planner",
          status: "completed",
          startedAt: "2026-01-01T00:00:01.000Z",
          endedAt: "2026-01-01T00:00:04.000Z",
        },
      ],
      timeline: [
        item({
          id: "text-block-0",
          eventType: "message.final",
          role: "planner",
          requestId: "req_planner",
          streamKey: "thr_view:planner:block:text:0",
          text: "第一句正文。",
          at: "2026-01-01T00:00:02.000Z",
          sequence: 1,
        }),
        item({
          id: "text-block-2",
          eventType: "message.final",
          role: "planner",
          requestId: "req_planner",
          streamKey: "thr_view:planner:block:text:2",
          text: "第二句正文。",
          at: "2026-01-01T00:00:04.000Z",
          sequence: 2,
        }),
      ],
    }),
  );

  const narratives = view.mainFeedEntries
    .filter((entry): entry is Extract<typeof entry, { kind: "timeline" }> => entry.kind === "timeline")
    .map((entry) => projectionItemToDetailBlock(entry.item))
    .filter((block) => block?.kind === "narrative");
  expect(narratives.map((block) => block?.text)).toEqual(["第一句正文。", "第二句正文。"]);
});

test("buildThreadRunProjectionViewModel keeps SDK block streams from separate turns", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      requestSpans: [
        {
          requestId: "req_turn_1",
          status: "completed",
          startedAt: "2026-01-01T00:00:01.000Z",
          endedAt: "2026-01-01T00:00:05.000Z",
          role: "planner",
        },
        {
          requestId: "req_turn_2",
          status: "completed",
          startedAt: "2026-01-01T00:01:01.000Z",
          endedAt: "2026-01-01T00:01:05.000Z",
          role: "planner",
        },
      ],
      timeline: [
        item({
          id: "turn-1-user",
          eventType: "thread.status",
          role: "user",
          text: "第一轮。",
          metadata: { liveType: "thread.user_prompt" },
          at: "2026-01-01T00:00:00.000Z",
          sequence: 1,
        }),
        item({
          id: "turn-1-request",
          eventType: "request.started",
          role: "planner",
          requestId: "req_turn_1",
          at: "2026-01-01T00:00:01.000Z",
          sequence: 2,
        }),
        item({
          id: "turn-1-thinking",
          eventType: "thinking.final",
          role: "thinking",
          requestId: "req_turn_1",
          streamKey: "thr_view:thinking:block:thinking:0",
          text: "第一轮思考。",
          at: "2026-01-01T00:00:02.000Z",
          sequence: 3,
        }),
        item({
          id: "turn-1-request-completed",
          eventType: "request.completed",
          role: "thinking",
          requestId: "req_turn_1",
          text: "模型请求完成",
          at: "2026-01-01T00:00:03.000Z",
          sequence: 4,
        }),
        item({
          id: "turn-1-message",
          eventType: "message.final",
          role: "planner",
          streamKey: "thr_view:planner:block:text:1",
          text: "第一轮回复。",
          at: "2026-01-01T00:00:04.000Z",
          sequence: 5,
        }),
        item({
          id: "turn-2-user",
          eventType: "thread.status",
          role: "user",
          text: "第二轮。",
          metadata: { liveType: "thread.user_prompt" },
          at: "2026-01-01T00:01:00.000Z",
          sequence: 6,
        }),
        item({
          id: "turn-2-request",
          eventType: "request.started",
          role: "planner",
          requestId: "req_turn_2",
          at: "2026-01-01T00:01:01.000Z",
          sequence: 7,
        }),
        item({
          id: "turn-2-thinking",
          eventType: "thinking.final",
          role: "thinking",
          requestId: "req_turn_2",
          streamKey: "thr_view:thinking:block:thinking:0",
          text: "第二轮思考。",
          at: "2026-01-01T00:01:02.000Z",
          sequence: 8,
        }),
        item({
          id: "turn-2-request-completed",
          eventType: "request.completed",
          role: "thinking",
          requestId: "req_turn_2",
          text: "模型请求完成",
          at: "2026-01-01T00:01:03.000Z",
          sequence: 9,
        }),
        item({
          id: "turn-2-message",
          eventType: "message.final",
          role: "planner",
          streamKey: "thr_view:planner:block:text:1",
          text: "第二轮回复。",
          at: "2026-01-01T00:01:04.000Z",
          sequence: 10,
        }),
      ],
    }),
  );

  const timelineEntries = view.mainFeedEntries.filter(
    (entry): entry is Extract<typeof entry, { kind: "timeline" }> => entry.kind === "timeline",
  );
  expect(timelineEntries.map((entry) => entry.item.id)).toEqual([
    "turn-1-user",
    "turn-1-thinking",
    "turn-1-message",
    "turn-2-user",
    "turn-2-thinking",
    "turn-2-message",
  ]);
  const narratives = timelineEntries
    .map((entry) => projectionItemToDetailBlock(entry.item))
    .filter((block) => block?.kind === "narrative");
  expect(narratives.map((block) => block?.text)).toEqual(["第一轮回复。", "第二轮回复。"]);
});

test("buildThreadRunProjectionViewModel hides legacy duplicate final echoes when block final exists", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      requestSpans: [
        {
          requestId: "req_planner",
          status: "completed",
          startedAt: "2026-01-01T00:00:01.000Z",
          endedAt: "2026-01-01T00:00:04.000Z",
        },
      ],
      timeline: [
        item({
          id: "thinking-legacy-final",
          eventType: "thinking.final",
          role: "thinking",
          requestId: "req_planner",
          streamKey: "thr_view:thinking",
          text: "旧思考。",
          at: "2026-01-01T00:00:02.000Z",
          sequence: 1,
        }),
        item({
          id: "thinking-block-final",
          eventType: "thinking.final",
          role: "thinking",
          streamKey: "thr_view:thinking:block:thinking:0",
          text: "旧思考。",
          at: "2026-01-01T00:00:02.001Z",
          sequence: 2,
        }),
        item({
          id: "message-legacy-final",
          eventType: "message.final",
          role: "planner",
          requestId: "req_planner",
          streamKey: "thr_view:planner",
          text: "最终回复。",
          at: "2026-01-01T00:00:04.000Z",
          sequence: 3,
        }),
        item({
          id: "message-block-final",
          eventType: "message.final",
          role: "planner",
          streamKey: "thr_view:planner:block:text:1",
          text: "最终回复。",
          at: "2026-01-01T00:00:04.001Z",
          sequence: 4,
        }),
      ],
    }),
  );

  const timelineEntries = view.mainFeedEntries.filter(
    (entry): entry is Extract<typeof entry, { kind: "timeline" }> => entry.kind === "timeline",
  );
  expect(timelineEntries.map((entry) => entry.item.id)).toEqual([
    "thinking-block-final",
    "message-block-final",
  ]);
});

test("buildThreadRunProjectionViewModel hides assistant block final echo after settled stream delta", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      requestSpans: [
        {
          requestId: "req_planner",
          status: "completed",
          startedAt: "2026-01-01T00:00:01.000Z",
          endedAt: "2026-01-01T00:00:03.000Z",
        },
      ],
      timeline: [
        item({
          id: "thinking-block-delta",
          eventType: "thinking.delta",
          role: "thinking",
          requestId: "req_planner",
          streamKey: "thr_view:thinking:block:thinking:0",
          text: "已流式输出的思考。",
          at: "2026-01-01T00:00:02.000Z",
          sequence: 1,
        }),
        item({
          id: "thinking-assistant-final",
          eventType: "thinking.final",
          role: "thinking",
          streamKey: "thr_view:thinking:block:thinking:0",
          text: "已流式输出的思考。",
          at: "2026-01-01T00:00:02.001Z",
          sequence: 2,
        }),
      ],
    }),
  );

  const thinkingEntries = view.mainFeedEntries.filter(
    (entry): entry is Extract<typeof entry, { kind: "timeline" }> =>
      entry.kind === "timeline" && entry.item.eventType.includes("thinking"),
  );
  expect(thinkingEntries.map((entry) => entry.item.id)).toEqual(["thinking-block-delta"]);
  expect(thinkingEntries.map((entry) => entry.item.eventType)).toEqual(["thinking.final"]);
});

test("buildThreadRunProjectionViewModel collapses agent card stream rows without losing final echo", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      requestSpans: [
        {
          requestId: "stream:coder_agent_00000001",
          ownerAgentId: "coder_agent_00000001",
          role: "coder",
          status: "completed",
          startedAt: "2026-01-01T00:00:01.000Z",
          firstTokenAt: "2026-01-01T00:00:02.000Z",
          endedAt: "2026-01-01T00:00:03.000Z",
        },
      ],
      agents: [
        agent({
          agentId: "coder_agent_00000001",
          role: "coder",
          status: "stopped",
          timeline: [
            item({
              id: "agent-placeholder",
              eventType: "message.delta",
              scope: "agent",
              role: "coder",
              agentId: "coder_agent_00000001",
              text: "",
              at: "2026-01-01T00:00:01.000Z",
              sequence: 1,
            }),
            item({
              id: "agent-final",
              eventType: "message.final",
              scope: "agent",
              role: "coder",
              agentId: "coder_agent_00000001",
              text: "广州今天有阵雨。",
              at: "2026-01-01T00:00:03.000Z",
              sequence: 3,
            }),
          ],
        }),
      ],
    }),
  );

  expect(view.subagentCards[0]?.timelineIds).toEqual(["agent-final"]);
  expect(view.mainFeedEntries.map((entry) => entry.key)).toEqual(["agent-card:coder_agent_00000001"]);
  const card = view.subagentCards[0];
  expect(card?.agent.timeline[0]).toBeTruthy();
  if (card?.agent.timeline[0]) {
    expect(projectionItemToDetailBlock(card.agent.timeline[0])).toMatchObject({
      kind: "narrative",
      streaming: false,
      text: "广州今天有阵雨。",
    });
  }
});

test("projectionMainFeedEntryKey stays stable across superseded stream deltas", () => {
  const deltaOne = item({
    id: "delta-1",
    eventType: "message.delta",
    role: "planner",
    requestId: "req_stream",
    text: "A",
    sequence: 1,
  });
  const deltaTwo = item({
    id: "delta-2",
    eventType: "message.delta",
    role: "planner",
    requestId: "req_stream",
    text: "AB",
    sequence: 2,
  });
  expect(projectionMainFeedEntryKey(deltaOne)).toBe(projectionMainFeedEntryKey(deltaTwo));
});

test("projectionMainFeedEntryKey scopes message stream by requestId when present", () => {
  const withoutRequest = item({
    id: "delta-1",
    eventType: "message.delta",
    role: "planner",
    text: "A",
    sequence: 1,
  });
  const withRequest = item({
    id: "delta-2",
    eventType: "message.delta",
    role: "planner",
    requestId: "req_planner",
    text: "AB",
    sequence: 2,
  });
  expect(projectionMainFeedEntryKey(withoutRequest)).toBe("main:stream:message:role:planner");
  expect(projectionMainFeedEntryKey(withRequest)).toBe("main:stream:message:role:planner:req:req_planner");
});

test("buildThreadRunProjectionViewModel preserves separate Codex message items after request completion", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      requestSpans: [
        {
          requestId: "turn_codex",
          status: "completed",
          startedAt: "2026-01-01T00:00:00.000Z",
          endedAt: "2026-01-01T00:00:05.000Z",
          role: "planner",
        },
      ],
      timeline: [
        item({
          id: "codex-message-a",
          eventType: "message.final",
          role: "planner",
          requestId: "turn_codex",
          streamKey: "msg_codex_a",
          text: "先检查项目结构。",
          sequence: 1,
          metadata: {
            codexMethod: "item/completed",
            logicalEntityId: "msg_codex_a",
            itemId: "msg_codex_a",
            itemType: "agentMessage",
          },
        }),
        item({
          id: "codex-message-b",
          eventType: "message.final",
          role: "planner",
          requestId: "turn_codex",
          streamKey: "msg_codex_b",
          text: "结构确认后继续修改。",
          sequence: 2,
          metadata: {
            codexMethod: "item/completed",
            logicalEntityId: "msg_codex_b",
            itemId: "msg_codex_b",
            itemType: "agentMessage",
          },
        }),
      ],
    }),
  );

  const messages = view.mainFeedEntries.filter(
    (entry) => entry.kind === "timeline" && entry.item.eventType === "message.final",
  );
  expect(messages.map((entry) => (entry.kind === "timeline" ? entry.item.text : ""))).toEqual([
    "先检查项目结构。",
    "结构确认后继续修改。",
  ]);
});

test("buildThreadRunProjectionViewModel keeps active thinking below bash cards", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      requestSpans: [
        {
          requestId: "req_think",
          status: "streaming",
          startedAt: "2026-01-01T00:00:03.000Z",
        },
      ],
      timeline: [
        item({
          id: "bash-start",
          eventType: "tool.started",
          role: "tool",
          text: "Tool: Bash · ls",
          at: "2026-01-01T00:00:01.000Z",
          sequence: 1,
          metadata: {
            liveType: "tool.started",
            tool: { name: "Bash", toolUseId: "toolu_bash_1", detail: "ls", status: "started" },
          },
        }),
        item({
          id: "bash-done",
          eventType: "tool.completed",
          role: "tool",
          text: "Tool: Bash · ls",
          at: "2026-01-01T00:00:02.000Z",
          sequence: 2,
          metadata: {
            liveType: "tool.completed",
            tool: { name: "Bash", toolUseId: "toolu_bash_1", detail: "ls", status: "completed" },
          },
        }),
        item({
          id: "thinking-delta",
          eventType: "thinking.delta",
          role: "thinking",
          requestId: "req_think",
          text: "继续分析",
          at: "2026-01-01T00:00:01.500Z",
          sequence: 3,
        }),
      ],
    }),
  );

  const keys = view.mainFeedEntries.map((entry) => entry.key);
  expect(keys.indexOf("main:lifecycle:toolu_bash_1")).toBeLessThan(
    keys.indexOf("main:stream:thinking:role:thinking:req:req_think"),
  );
});

test("buildThreadRunProjectionViewModel groups adjacent bash calls into a tool summary", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      timeline: [
        item({
          id: "bash-a-start",
          eventType: "tool.started",
          role: "tool",
          text: "Tool: Bash · ls",
          at: "2026-01-01T00:00:01.000Z",
          sequence: 1,
          metadata: {
            liveType: "tool.started",
            tool: { name: "Bash", toolUseId: "toolu_bash_a", detail: "ls", status: "started" },
          },
        }),
        item({
          id: "bash-b-start",
          eventType: "tool.started",
          role: "tool",
          text: "Tool: Bash · pwd",
          at: "2026-01-01T00:00:02.000Z",
          sequence: 2,
          metadata: {
            liveType: "tool.started",
            tool: { name: "Bash", toolUseId: "toolu_bash_b", detail: "pwd", status: "started" },
          },
        }),
        item({
          id: "bash-a-done",
          eventType: "tool.completed",
          role: "tool",
          text: "Tool: Bash · ls",
          at: "2026-01-01T00:00:03.000Z",
          sequence: 3,
          metadata: {
            liveType: "tool.completed",
            tool: { name: "Bash", toolUseId: "toolu_bash_a", detail: "ls", status: "completed" },
          },
        }),
      ],
    }),
  );

  expect(view.mainFeedEntries).toHaveLength(1);
  expect(view.mainFeedEntries[0]?.kind).toBe("tool-group");
  if (view.mainFeedEntries[0]?.kind === "tool-group") {
    expect(view.mainFeedEntries[0].entries.map((entry) => entry.key)).toEqual([
      "main:lifecycle:toolu_bash_a",
      "main:lifecycle:toolu_bash_b",
    ]);
  }
});

test("empty terminal thinking does not split adjacent tool summaries", () => {
  const tool = (id: string, sequence: number, path: string) =>
    item({
      id,
      sequence,
      eventType: "tool.completed",
      role: "tool",
      text: `Tool: Read · ${path}`,
      at: `2026-01-01T00:00:0${sequence}.000Z`,
      metadata: {
        tool: {
          name: "Read",
          detail: path,
          toolUseId: `toolu_${id}`,
          status: "completed",
        },
      },
    });
  const view = buildThreadRunProjectionViewModel(
    projection({
      timeline: [
        tool("read-a", 1, "src/a.ts"),
        item({
          id: "empty-reasoning",
          sequence: 2,
          eventType: "thinking.final",
          role: "thinking",
          text: "",
          at: "2026-01-01T00:00:02.000Z",
          metadata: { thinkingDurationMs: 0 },
        }),
        tool("read-b", 3, "src/b.ts"),
      ],
    }),
  );

  expect(view.mainFeedEntries).toHaveLength(1);
  expect(view.mainFeedEntries[0]?.kind).toBe("tool-group");
  if (view.mainFeedEntries[0]?.kind === "tool-group") {
    expect(view.mainFeedEntries[0].entries.map((entry) => entry.item.id)).toEqual([
      "read-a",
      "read-b",
    ]);
  }
  expect(
    projectionItemToDetailBlock(
      item({
        id: "empty-reasoning-detail",
        eventType: "thinking.final",
        role: "thinking",
        text: "",
        metadata: { thinkingDurationMs: 0 },
      }),
    ),
  ).toBeUndefined();
});

test("buildThreadRunProjectionViewModel keeps a growing file tool group key stable", () => {
  const fileTool = (id: string, sequence: number, name: "Read" | "Edit", detail: string) =>
    item({
      id,
      sequence,
      eventType: "tool.completed",
      text: `Tool: ${name} · ${detail}`,
      metadata: {
        tool: {
          name,
          detail,
          toolUseId: `toolu_${id}`,
          status: "completed",
        },
      },
    });
  const initialTimeline = [
    fileTool("read-a", 1, "Read", "src/a.ts"),
    fileTool("read-b", 2, "Read", "src/b.ts"),
  ];
  const initial = buildThreadRunProjectionViewModel(projection({ timeline: initialTimeline }));
  const appended = buildThreadRunProjectionViewModel(
    projection({ timeline: [...initialTimeline, fileTool("edit-c", 3, "Edit", "src/c.ts")] }),
  );

  expect(initial.mainFeedEntries[0]?.kind).toBe("tool-group");
  expect(appended.mainFeedEntries[0]?.kind).toBe("tool-group");
  expect(appended.mainFeedEntries[0]?.key).toBe(initial.mainFeedEntries[0]?.key);
});

test("buildProjectionDisplayTimelineItems keeps only the latest in-flight delta per stream", () => {
  const rows = buildProjectionDisplayTimelineItems(
    [
      item({
        id: "delta-1",
        eventType: "message.delta",
        role: "planner",
        text: "A",
        at: "2026-01-01T00:00:01.000Z",
        sequence: 1,
      }),
      item({
        id: "delta-2",
        eventType: "message.delta",
        role: "planner",
        text: "AB",
        at: "2026-01-01T00:00:02.000Z",
        sequence: 2,
      }),
    ],
    new Map([
      [
        "stream:planner",
        {
          requestId: "stream:planner",
          status: "streaming",
          startedAt: "2026-01-01T00:00:01.000Z",
          firstTokenAt: "2026-01-01T00:00:01.000Z",
        },
      ],
    ]),
  );

  expect(rows.map((row) => row.id)).toEqual(["delta-2"]);
  expect(rows[0]?.eventType).toBe("message.delta");
});

test("projectionItemToDetailBlock maps reconnect activity to collapsible phase", () => {
  const detail = projectionItemToDetailBlock(
    item({
      id: "reconnect-1",
      eventType: "api.error",
      scope: "main",
      text: "【连接失败】HTTP 500：upstream error: do request failed",
      metadata: {
        liveType: "thread.api_error",
        activityOrigin: "proxy.connection_error",
        apiError: { statusCode: 500, message: "upstream error: do request failed" },
      },
    }),
  );
  expect(detail).toMatchObject({
    kind: "phase",
    label: "连接失败 · HTTP 500",
    reconnecting: true,
    reconnectFailed: true,
  });
  expect(detail).not.toHaveProperty("reconnectDetail");
});

test("buildProjectionDisplayTimelineItems keeps only the latest reconnect status", () => {
  const timeline = [
    item({
      id: "r1",
      sequence: 1,
      eventType: "api.error",
      text: "【连接失败】HTTP 500：first",
      metadata: { activityOrigin: "proxy.connection_error", apiError: { statusCode: 500, message: "first" } },
    }),
    item({
      id: "r2",
      sequence: 2,
      eventType: "request.retry_scheduled",
      text: "API retry 1/5…",
      metadata: { activityOrigin: "sdk.api_retry", retry: { attempt: 1, maxRetries: 5 } },
    }),
    item({
      id: "r3",
      sequence: 3,
      eventType: "request.retry_scheduled",
      text: "API retry 2/5…",
      metadata: { activityOrigin: "sdk.api_retry", retry: { attempt: 2, maxRetries: 5 } },
    }),
  ];
  const rows = buildProjectionDisplayTimelineItems(timeline, new Map());
  expect(rows.map((row) => row.id)).toEqual(["r3"]);
});

test("buildProjectionDisplayTimelineItems annotates repeated connection failures with a count", () => {
  const timeline = [
    item({
      id: "r1",
      sequence: 1,
      eventType: "api.error",
      text: "【连接失败】HTTP 500：first",
      metadata: { activityOrigin: "proxy.connection_error", apiError: { statusCode: 500, message: "first" } },
    }),
    item({
      id: "r2",
      sequence: 2,
      eventType: "api.error",
      text: "【连接失败】HTTP 500：second",
      metadata: {
        activityOrigin: "proxy.connection_error",
        apiError: { statusCode: 500, message: "second" },
      },
    }),
  ];
  const rows = buildProjectionDisplayTimelineItems(timeline, new Map());
  expect(rows.map((row) => row.id)).toEqual(["r2"]);
  expect(projectionItemToDetailBlock(requireValue(rows[0], "reconnect row"))).toMatchObject({
    kind: "phase",
    label: "连接失败 · HTTP 500 ×2",
  });
});

test("buildProjectionDisplayTimelineItems drops reconnect after agent recovers", () => {
  const timeline = [
    item({
      id: "retry",
      sequence: 1,
      eventType: "request.retry_scheduled",
      text: "API retry 2/5…",
      metadata: { activityOrigin: "sdk.api_retry", retry: { attempt: 2, maxRetries: 5 } },
    }),
    item({
      id: "reply",
      sequence: 2,
      eventType: "message.final",
      text: "好的，我已经完成分析。",
      role: "planner",
    }),
  ];
  const rows = buildProjectionDisplayTimelineItems(timeline, new Map());
  expect(rows.map((row) => row.id)).toEqual(["reply"]);
});

test("buildProjectionDisplayTimelineItems collapses SDK api_retry rows and final failure", () => {
  const timeline = [
    item({
      id: "r1",
      sequence: 1,
      eventType: "request.retry_scheduled",
      text: "API retry 1/5…",
      metadata: { activityOrigin: "sdk.api_retry", retry: { attempt: 1, maxRetries: 5 } },
    }),
    item({
      id: "r2",
      sequence: 2,
      eventType: "request.retry_scheduled",
      text: "API retry 2/5…",
      metadata: { activityOrigin: "sdk.api_retry", retry: { attempt: 2, maxRetries: 5 } },
    }),
    item({
      id: "r3",
      sequence: 3,
      eventType: "api.error",
      text: "【连接失败】HTTP 502：upstream unavailable",
      metadata: {
        activityOrigin: "proxy.connection_error",
        apiError: { statusCode: 502, message: "upstream unavailable" },
      },
    }),
  ];
  const rows = buildProjectionDisplayTimelineItems(timeline, new Map());
  expect(rows.map((row) => row.id)).toEqual(["r3"]);
  expect(projectionItemToDetailBlock(requireValue(rows[0], "reconnect row"))).toMatchObject({
    kind: "phase",
    label: "连接失败 · HTTP 502",
    reconnecting: true,
    reconnectFailed: true,
  });
});

test("buildProjectionDisplayTimelineItems keeps reconnect summary and one original API error phase", () => {
  const rawApiError =
    "API Error: 503 Loading model. This is a server-side issue, usually temporary — try again in a moment.";
  const wrappedFailure = `Claude Code returned an error result: ${rawApiError}`;
  const blockedWithHint = `${wrappedFailure} 可在下方继续对话、切换模型后重试，或点击「重试此次请求」。`;
  const timeline = [
    item({
      id: "reconnect",
      sequence: 1,
      eventType: "api.error",
      text: "【连接失败】HTTP 503：upstream unavailable",
      metadata: {
        activityOrigin: "proxy.connection_error",
        apiError: { statusCode: 503, message: "upstream unavailable" },
      },
    }),
    item({
      id: "phase",
      sequence: 2,
      eventType: "message.final",
      text: rawApiError,
      metadata: { activityOrigin: "sdk.upstream_error", liveType: "message.delta" },
    }),
    item({
      id: "wrapped",
      sequence: 3,
      eventType: "message.final",
      text: wrappedFailure,
      metadata: { activityOrigin: "sdk.run_failure", liveType: "message.delta" },
    }),
    item({
      id: "blocked",
      sequence: 4,
      eventType: "thread.status",
      text: blockedWithHint,
      metadata: { activityOrigin: "eco.thread_blocked", liveType: "thread.blocked" },
    }),
  ];
  const rows = buildProjectionDisplayTimelineItems(timeline, new Map());
  expect(rows.map((row) => row.id)).toEqual(["reconnect", "phase"]);
  expect(projectionItemToDetailBlock(requireValue(rows[0], "reconnect row"))).toMatchObject({
    kind: "phase",
    label: "连接失败 · HTTP 503",
    reconnecting: true,
    reconnectFailed: true,
  });
  expect(projectionItemToDetailBlock(requireValue(rows[1], "phase row"))).toEqual({
    kind: "phase",
    label: rawApiError,
  });
});

test("buildProjectionDisplayTimelineItems drops reconnect and upstream error after agent recovers", () => {
  const rawApiError = "API Error: 503 Loading model.";
  const timeline = [
    item({
      id: "retry",
      sequence: 1,
      eventType: "request.retry_scheduled",
      text: "API retry 2/5…",
      metadata: { activityOrigin: "sdk.api_retry", retry: { attempt: 2, maxRetries: 5 } },
    }),
    item({
      id: "phase",
      sequence: 2,
      eventType: "message.final",
      text: rawApiError,
      metadata: { activityOrigin: "sdk.upstream_error" },
    }),
    item({
      id: "reply",
      sequence: 3,
      eventType: "message.final",
      text: "问题已修复，请查看变更。",
      role: "planner",
    }),
  ];
  const rows = buildProjectionDisplayTimelineItems(timeline, new Map());
  expect(rows.map((row) => row.id)).toEqual(["reply"]);
});

test("buildProjectionDisplayTimelineItems collapses duplicate tool rows by toolUseId", () => {
  const rows = buildProjectionDisplayTimelineItems(
    [
      item({
        id: "tool-start",
        eventType: "tool.started",
        text: "Tool: mcp__eco_plan__finalize_plan",
        sequence: 1,
        metadata: {
          tool: {
            name: "mcp__eco_plan__finalize_plan",
            toolUseId: "toolu_plan",
          },
        },
      }),
      item({
        id: "tool-input-complete",
        eventType: "tool.started",
        text: "Tool: mcp__eco_plan__finalize_plan",
        sequence: 2,
        metadata: {
          tool: {
            name: "mcp__eco_plan__finalize_plan",
            detail: "提交计划",
            toolUseId: "toolu_plan",
          },
        },
      }),
    ],
    new Map(),
  );

  expect(rows.map((row) => row.id)).toEqual(["tool-input-complete"]);
});

test("buildThreadRunProjectionViewModel collapses superseded context compaction started states", () => {
  const running = buildThreadRunProjectionViewModel(
    projection({
      timeline: [
        item({
          id: "compact-start-1",
          eventType: "context.compaction.started",
          text: "正在自动压缩上下文",
          at: "2026-01-01T00:00:01.000Z",
          sequence: 1,
        }),
        item({
          id: "compact-start-2",
          eventType: "context.compaction.started",
          text: "正在自动压缩上下文",
          at: "2026-01-01T00:00:02.000Z",
          sequence: 2,
        }),
      ],
    }),
  );
  expect(running.mainFeedEntries.map((entry) => entry.key)).toEqual(["main:compact-start-2"]);

  const completed = buildThreadRunProjectionViewModel(
    projection({
      timeline: [
        item({
          id: "compact-start",
          eventType: "context.compaction.started",
          text: "正在自动压缩上下文",
          at: "2026-01-01T00:00:01.000Z",
          sequence: 1,
        }),
        item({
          id: "compact-done",
          eventType: "context.compaction.completed",
          text: "上下文已自动压缩",
          at: "2026-01-01T00:00:02.000Z",
          sequence: 2,
        }),
      ],
    }),
  );

  expect(completed.mainFeedEntries.map((entry) => entry.key)).toEqual(["main:compact-done"]);
  const detail = projectionItemToDetailBlock(
    item({
      id: "compact-done",
      eventType: "context.compaction.completed",
      text: "上下文已自动压缩",
    }),
  );
  expect(detail).toEqual({ kind: "phase", label: "上下文已自动压缩" });
});

test("isThreadContextCompactionInFlight tracks latest compaction stage", () => {
  const now = Date.parse("2026-06-19T12:00:00.000Z");
  expect(isThreadContextCompactionInFlight(undefined, now)).toBe(false);
  expect(
    isThreadContextCompactionInFlight(
      projection({
        timeline: [
          item({
            id: "compact-start",
            eventType: "context.compaction.started",
            text: "正在自动压缩上下文",
            at: "2026-06-19T11:59:30.000Z",
          }),
        ],
      }),
      now,
    ),
  ).toBe(true);
  expect(
    isThreadContextCompactionInFlight(
      projection({
        timeline: [
          item({
            id: "compact-start",
            eventType: "context.compaction.started",
            text: "正在自动压缩上下文",
            at: "2026-06-19T11:59:30.000Z",
          }),
          item({
            id: "compact-done",
            eventType: "context.compaction.completed",
            text: "上下文已自动压缩",
            at: "2026-06-19T12:00:00.000Z",
          }),
        ],
      }),
      now,
    ),
  ).toBe(false);
  expect(
    isThreadContextCompactionInFlight(
      projection({
        timeline: [
          item({
            id: "compact-start",
            eventType: "context.compaction.started",
            text: "正在手动压缩上下文",
            at: "2026-06-19T11:59:30.000Z",
          }),
          item({
            id: "compact-failed",
            eventType: "context.compaction.failed",
            text: "上下文压缩失败",
            at: "2026-06-19T12:00:00.000Z",
          }),
        ],
      }),
      now,
    ),
  ).toBe(false);
});

test("isThreadContextCompactionInFlight ignores stale started without terminal event", () => {
  const now = Date.parse("2026-06-19T12:00:00.000Z");
  expect(
    isThreadContextCompactionInFlight(
      projection({
        timeline: [
          item({
            id: "compact-start",
            eventType: "context.compaction.started",
            text: "正在手动压缩上下文",
            at: "2026-06-19T11:55:00.000Z",
          }),
        ],
      }),
      now,
    ),
  ).toBe(false);
});

test("isThreadAutoCompactSuspended tracks suspended until successful compact", () => {
  expect(isThreadAutoCompactSuspended(undefined)).toBe(false);
  expect(
    isThreadAutoCompactSuspended(
      projection({
        timeline: [
          item({
            id: "compact-suspended",
            eventType: "context.compaction.suspended",
            text: "自动上下文压缩已暂停",
          }),
        ],
      }),
    ),
  ).toBe(true);
  expect(
    isThreadAutoCompactSuspended(
      projection({
        timeline: [
          item({
            id: "compact-suspended",
            eventType: "context.compaction.suspended",
            text: "自动上下文压缩已暂停",
          }),
          item({
            id: "compact-done",
            eventType: "context.compaction.completed",
            text: "上下文已手动压缩",
          }),
        ],
      }),
    ),
  ).toBe(false);
});

test("isThreadPromptCacheInvalidated tracks cache invalidation events", () => {
  expect(isThreadPromptCacheInvalidated(undefined)).toBe(false);
  expect(
    isThreadPromptCacheInvalidated(
      projection({
        timeline: [
          item({
            id: "cache-broken",
            eventType: "context.cache_invalidated",
            text: "MCP 配置已变更，本会话 prompt cache 已失效",
          }),
        ],
      }),
    ),
  ).toBe(true);
});

test("resolveProjectionPhaseLabel maps cache hit drop events", () => {
  const detail = projectionItemToDetailBlock(
    item({
      id: "cache-hit-drop",
      eventType: "billing.cache_hit_dropped",
      text: "Prompt cache 命中率从 78% 降至 12%（↓66pp），可能由 cache break 引起。",
    }),
  );
  expect(detail).toEqual({
    kind: "phase",
    label: "Prompt cache 命中率从 78% 降至 12%（↓66pp），可能由 cache break 引起。",
  });
});

test("buildThreadRunProjectionViewModel collapses prompt cache timeline events in main feed", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      timeline: [
        item({
          id: "drift",
          sequence: 1,
          eventType: "context.cache_config_drift",
          text: "MCP 配置已变更（Composer）",
          metadata: { promptCacheEpisodeId: "pce_1" },
        }),
        item({
          id: "invalidated",
          sequence: 2,
          eventType: "context.cache_invalidated",
          text: "MCP 配置已变更，本会话 prompt cache 已失效",
          metadata: { promptCacheEpisodeId: "pce_1" },
        }),
        item({
          id: "msg",
          sequence: 3,
          eventType: "message.final",
          text: "继续",
        }),
      ],
    }),
  );
  const timelineEntries = view.mainFeedEntries.filter((entry) => entry.kind === "timeline");
  expect(timelineEntries).toHaveLength(2);
  const cacheEntry = timelineEntries[0];
  expect(cacheEntry?.kind).toBe("timeline");
  if (cacheEntry?.kind === "timeline") {
    const detail = projectionItemToDetailBlock(cacheEntry.item);
    expect(detail?.kind).toBe("prompt-cache-timeline");
  }
});

test("buildThreadRunProjectionViewModel requests legacy prompt only when projection lacks user prompt", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      timeline: [item({ id: "main", role: "planner", text: "Working" })],
    }),
    { id: "thr_view", prompt: "原始需求" },
  );

  expect(view.showThreadPrompt).toBe(true);
  expect(view.mainItemIds).toEqual(["main"]);
});

test("projectionItemToDetailBlock maps API errors and request ownership", () => {
  const apiError = projectionItemToDetailBlock(
    item({
      id: "api-error",
      eventType: "api.error",
      scope: "both",
      role: "coder",
      agentId: "coder_a",
      text: "HTTP 502",
      metadata: { apiError: { statusCode: 502, code: "bad_gateway", message: "Bad gateway" } },
    }),
  );
  const agentRequest = projectionItemToDetailBlock(
    item({
      id: "agent-request",
      eventType: "request.started",
      scope: "agent",
      role: "coder",
      agentId: "coder_a",
      requestId: "req_agent",
    }),
  );
  const mainRequest = projectionItemToDetailBlock(
    item({
      id: "main-request",
      eventType: "request.started",
      scope: "main",
      role: "planner",
      requestId: "req_main",
    }),
  );

  expect(apiError).toMatchObject({
    kind: "api-error",
    message: "Bad gateway",
    statusCode: 502,
    code: "bad_gateway",
    subagent: "coder",
    agentId: "coder_a",
  });
  expect(agentRequest).toMatchObject({ kind: "agent-request", subagent: "coder", agentId: "coder_a" });
  expect(mainRequest).toMatchObject({ kind: "model-request", role: "planner" });
});

test("projectionItemToDetailBlock maps Read tool.started with structured line range", () => {
  const detail = projectionItemToDetailBlock(
    item({
      id: "read-range",
      eventType: "tool.started",
      scope: "agent",
      role: "coder",
      text: "Tool: Read · ActivityLogView.tsx:L120-159",
      metadata: {
        liveType: "tool.started",
        tool: {
          name: "Read",
          detail: "ActivityLogView.tsx:L120-159",
          toolUseId: "toolu_read_1",
          status: "started",
          readTarget: {
            filePath: "/repo/apps/desktop/src/renderer/ActivityLogView.tsx",
            offset: 120,
            limit: 40,
          },
        },
      },
    }),
  );

  expect(detail).toMatchObject({
    kind: "action",
    icon: "file",
    label: "ActivityLogView.tsx:L120-159",
    readTarget: {
      fileName: "ActivityLogView.tsx",
      filePath: "/repo/apps/desktop/src/renderer/ActivityLogView.tsx",
      offset: 120,
      limit: 40,
      lineRange: "L120-159",
    },
  });
});

test("buildThreadRunProjectionViewModel hides Reading progress rows when structured Read exists", () => {
  const viewModel = buildThreadRunProjectionViewModel(
    projection({
      timeline: [
        item({
          id: "read-progress",
          eventType: "tool.started",
          text: "Reading src/pages/Home/CtLossUser.vue",
          sequence: 1,
          metadata: {
            tool: {
              name: "Read",
              detail: "Reading src/pages/Home/CtLossUser.vue",
              toolUseId: "toolu_read_progress",
            },
          },
        }),
        item({
          id: "read-structured",
          eventType: "tool.completed",
          text: "Tool: Read · CtLossUser.vue:L810-869",
          sequence: 2,
          metadata: {
            tool: {
              name: "Read",
              detail: "CtLossUser.vue:L810-869",
              toolUseId: "toolu_read_structured",
              status: "completed",
              readTarget: {
                filePath: "/repo/src/pages/Home/CtLossUser.vue",
                offset: 810,
                limit: 60,
              },
            },
          },
        }),
      ],
    }),
  );

  expect(viewModel.mainFeedEntries).toHaveLength(1);
  expect(viewModel.mainFeedEntries[0]).toMatchObject({
    kind: "timeline",
    item: { id: "read-structured" },
  });
});

test("buildThreadRunProjectionViewModel hides Searching progress rows when structured Grep exists", () => {
  const viewModel = buildThreadRunProjectionViewModel(
    projection({
      timeline: [
        item({
          id: "grep-progress",
          eventType: "tool.started",
          text: "Searching file read display card format UI comp",
          sequence: 1,
          metadata: {
            tool: {
              name: "Grep",
              detail: "Searching file read display card format UI comp",
              toolUseId: "toolu_grep_progress",
            },
          },
        }),
        item({
          id: "grep-structured",
          eventType: "tool.completed",
          text: "Tool: Grep · Read.*\\.tsx · src",
          sequence: 2,
          metadata: {
            tool: {
              name: "Grep",
              detail: "Read.*\\.tsx · src",
              toolUseId: "toolu_grep_structured",
              status: "completed",
              grepTarget: {
                pattern: String.raw`Read.*\.tsx`,
                path: "src",
              },
            },
          },
        }),
      ],
    }),
  );

  expect(viewModel.mainFeedEntries).toHaveLength(1);
  expect(viewModel.mainFeedEntries[0]).toMatchObject({
    kind: "timeline",
    item: { id: "grep-structured" },
  });
});

test("buildProjectionDisplayTimelineItems replaces placeholder Read by toolUseId", () => {
  const rows = buildProjectionDisplayTimelineItems(
    [
      item({
        id: "read-placeholder",
        eventType: "tool.started",
        text: "Tool: Read",
        sequence: 1,
        metadata: {
          tool: {
            name: "Read",
            toolUseId: "toolu_read_same",
          },
        },
      }),
      item({
        id: "read-structured",
        eventType: "tool.completed",
        text: "Tool: Read · snake.html",
        sequence: 2,
        metadata: {
          tool: {
            name: "Read",
            detail: "snake.html",
            toolUseId: "toolu_read_same",
            status: "completed",
            readTarget: {
              filePath: "/repo/snake.html",
            },
          },
        },
      }),
    ],
    new Map(),
  );

  expect(rows).toHaveLength(1);
  expect(rows[0]?.id).toBe("read-structured");
  expect(projectionItemToDetailBlock(requireValue(rows[0], "read row"))).toMatchObject({
    readTarget: { fileName: "snake.html" },
  });
});

test("projectionItemToDetailBlock suppresses bare Read placeholder until file detail exists", () => {
  const detail = projectionItemToDetailBlock(
    item({
      id: "read-placeholder",
      eventType: "tool.started",
      text: "Tool: Read",
      metadata: {
        tool: {
          name: "Read",
          toolUseId: "toolu_read_placeholder",
        },
      },
    }),
  );

  expect(detail).toBeUndefined();
});

test("buildThreadRunProjectionViewModel hides bare Read placeholder rendering when structured Read exists", () => {
  const viewModel = buildThreadRunProjectionViewModel(
    projection({
      timeline: [
        item({
          id: "read-placeholder",
          eventType: "tool.started",
          text: "Tool: Read",
          sequence: 1,
          metadata: {
            tool: {
              name: "Read",
              toolUseId: "toolu_read_placeholder",
            },
          },
        }),
        item({
          id: "read-structured",
          eventType: "tool.completed",
          text: "Tool: Read · snake.html",
          sequence: 2,
          metadata: {
            tool: {
              name: "Read",
              detail: "snake.html",
              toolUseId: "toolu_read_structured",
              status: "completed",
              readTarget: {
                filePath: "/repo/snake.html",
              },
            },
          },
        }),
      ],
    }),
  );

  const visibleBlocks = viewModel.mainFeedEntries
    .filter((entry) => entry.kind === "timeline")
    .map((entry) => projectionItemToDetailBlock(entry.item))
    .filter(Boolean);
  expect(visibleBlocks).toHaveLength(1);
  expect(visibleBlocks[0]).toMatchObject({
    readTarget: { fileName: "snake.html" },
  });
});

test("projectionItemToDetailBlock maps planner Agent tool.started with metadata", () => {
  const detail = projectionItemToDetailBlock(
    item({
      id: "delegate-coder",
      eventType: "tool.started",
      scope: "main",
      role: "coder",
      text: "Tool: Agent · coder",
      metadata: {
        liveType: "tool.started",
        tool: {
          name: "Agent",
          detail: "coder",
          toolUseId: "toolu_agent_1",
          status: "running",
        },
      },
    }),
  );

  expect(detail).toMatchObject({
    kind: "action",
    icon: "agent",
    label: "coder",
    lifecycle: "running",
    subagent: "coder",
  });
});

test("projectionItemToDetailBlock maps agent.started delegation metadata to subagent mission", () => {
  const detail = projectionItemToDetailBlock(
    item({
      id: "agent-started",
      eventType: "agent.started",
      scope: "agent",
      role: "coder",
      agentId: "coder_a",
      text: "Subagent coder started",
      metadata: {
        lifecycle: "started",
        delegationPrompt: "Review export filters in src/api.ts",
        delegationSummary: "审查：export filters",
      },
    }),
  );

  expect(detail).toMatchObject({
    kind: "subagent-mission",
    subagent: "coder",
    summary: "审查：export filters",
    prompt: "Review export filters in src/api.ts",
    agentId: "coder_a",
  });
});

test("resolveSubagentCardMissionText prefers delegation prompt over summary", () => {
  expect(
    resolveSubagentCardMissionText({
      agentId: "coder_a",
      role: "coder",
      kind: "subagent",
      status: "active",
      startedAt: "2026-01-01T00:00:00.000Z",
      durationMs: 0,
      delegationPrompt: "Implement export filters in src/api.ts",
      delegationSummary: "实现：export filters",
      timeline: [],
    }),
  ).toBe("Implement export filters in src/api.ts");
});

test("resolveSubagentCardMissionText falls back to agent.started timeline metadata", () => {
  expect(
    resolveSubagentCardMissionText({
      agentId: "coder_a",
      role: "coder",
      kind: "subagent",
      status: "active",
      startedAt: "2026-01-01T00:00:00.000Z",
      durationMs: 0,
      timeline: [
        item({
          id: "agent-started",
          eventType: "agent.started",
          scope: "agent",
          role: "coder",
          agentId: "coder_a",
          text: "Subagent coder started",
          metadata: {
            lifecycle: "started",
            delegationPrompt: "Review export filters in src/api.ts",
            delegationSummary: "审查：export filters",
          },
        }),
      ],
    }),
  ).toBe("Review export filters in src/api.ts");
});

test("resolveSubagentCardMissionText falls back to main timeline @mission by parentToolUseId", () => {
  expect(
    resolveSubagentCardMissionText(
      {
        agentId: "agent_coder_a",
        role: "coder",
        kind: "subagent",
        status: "active",
        startedAt: "2026-01-01T00:00:01.000Z",
        durationMs: 0,
        parentToolUseId: "toolu_agent_1",
        timeline: [],
      },
      {
        mainTimeline: [
          item({
            id: "delegate-coder",
            eventType: "tool.started",
            scope: "main",
            role: "coder",
            text: formatSubagentMissionMessage("coder", "Implement export filters in src/api.ts"),
            sequence: 1,
            metadata: {
              liveType: "tool.started",
              tool: {
                name: "Agent",
                detail: "coder",
                toolUseId: "toolu_agent_1",
                status: "running",
              },
            },
          }),
        ],
      },
    ),
  ).toBe("Implement export filters in src/api.ts");
});

test("resolveSubagentCardMissionText returns empty without structured attribution", () => {
  expect(
    resolveSubagentCardMissionText(
      {
        agentId: "agent_coder_a",
        role: "coder",
        kind: "subagent",
        status: "active",
        startedAt: "2026-01-01T00:00:01.000Z",
        durationMs: 0,
        timeline: [],
      },
      {
        mainTimeline: [
          item({
            id: "delegate-coder",
            eventType: "tool.started",
            scope: "main",
            role: "coder",
            text: formatSubagentMissionMessage("coder", "Implement export filters.\nFiles: src/api.ts"),
            metadata: {
              tool: { name: "Agent", toolUseId: "toolu_unlinked", status: "running" },
            },
          }),
        ],
      },
    ),
  ).toBe("");
});

test("resolveSubagentCardMissionText reads @mission with explicit agentId on agent timeline", () => {
  expect(
    resolveSubagentCardMissionText({
      agentId: "agent_a",
      role: "coder",
      kind: "subagent",
      status: "active",
      startedAt: "2026-01-01T00:00:01.000Z",
      durationMs: 0,
      timeline: [
        item({
          id: "mission",
          eventType: "tool.started",
          scope: "agent",
          role: "coder",
          agentId: "agent_a",
          text: formatSubagentMissionMessage("coder", "Scoped mission", { agentId: "agent_a" }),
        }),
      ],
    }),
  ).toBe("Scoped mission");
});

test("buildThreadRunProjectionViewModel shows planner delegation on main feed", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      timeline: [
        item({
          id: "delegate-coder",
          eventType: "tool.started",
          scope: "main",
          role: "coder",
          text: "Tool: Agent · coder",
          sequence: 1,
          metadata: {
            liveType: "tool.started",
            tool: {
              name: "Agent",
              detail: "coder",
              toolUseId: "toolu_agent_1",
              status: "running",
            },
          },
        }),
      ],
    }),
  );

  expect(view.mainFeedEntries).toHaveLength(1);
  expect(view.mainFeedEntries[0]?.kind).toBe("timeline");
  const timelineEntry = view.mainFeedEntries[0];
  if (timelineEntry?.kind === "timeline") {
    expect(projectionItemToDetailBlock(timelineEntry.item)?.kind).toBe("action");
  }
});

test("buildThreadRunProjectionViewModel hides absorbed planner Agent delegation when subagent card exists", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      agents: [
        {
          agentId: "agent_coder_a",
          role: "coder",
          kind: "subagent",
          status: "active",
          startedAt: "2026-01-01T00:00:01.000Z",
          parentToolUseId: "toolu_agent_1",
          delegationPrompt: "Implement export filters in src/api.ts",
          delegationSummary: "实现：export filters",
          timeline: [],
        },
      ],
      timeline: [
        item({
          id: "delegate-coder",
          eventType: "tool.started",
          scope: "main",
          role: "coder",
          text: formatSubagentMissionMessage("coder", "Implement export filters in src/api.ts"),
          sequence: 1,
          metadata: {
            liveType: "tool.started",
            tool: {
              name: "Agent",
              detail: "coder",
              toolUseId: "toolu_agent_1",
              status: "running",
            },
          },
        }),
      ],
    }),
  );

  expect(view.mainFeedEntries).toHaveLength(1);
  expect(view.mainFeedEntries[0]?.kind).toBe("agent-card");
  expect(view.subagentCards[0]?.missionText).toBe("Implement export filters in src/api.ts");
});

test("buildThreadRunProjectionViewModel resolves subagent missionText from full timeline before display filtering", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      agents: [
        {
          agentId: "agent_explore_a",
          role: "explore",
          kind: "subagent",
          status: "active",
          startedAt: "2026-01-01T00:00:01.000Z",
          timeline: [
            item({
              id: "agent-started",
              eventType: "agent.started",
              scope: "agent",
              role: "explore",
              agentId: "agent_explore_a",
              text: "Subagent explore started",
              metadata: {
                lifecycle: "started",
                delegationPrompt: "Scan src for API usage",
                delegationSummary: "扫描：API usage",
              },
            }),
            item({
              id: "request-started",
              eventType: "request.started",
              scope: "agent",
              role: "explore",
              agentId: "agent_explore_a",
              text: "Request started",
              requestId: "req_1",
              sequence: 2,
            }),
            item({
              id: "request-stream",
              eventType: "message.delta",
              scope: "agent",
              role: "explore",
              agentId: "agent_explore_a",
              text: "Working",
              requestId: "req_1",
              streamKey: "stream_1",
              sequence: 3,
            }),
          ],
        },
      ],
      requestSpans: [
        {
          requestId: "req_1",
          status: "active",
          startedAt: "2026-01-01T00:00:02.000Z",
        },
      ],
    }),
  );

  expect(view.subagentCards[0]?.missionText).toBe("Scan src for API usage");
});

test("buildThreadRunProjectionViewModel does not echo attributed @mission from agent timeline", () => {
  const missionText = formatSubagentMissionMessage("explore", "Gather CPU info", {
    agentId: "agent_explore_a",
  });
  const view = buildThreadRunProjectionViewModel(
    projection({
      agents: [
        {
          agentId: "agent_explore_a",
          role: "explore",
          kind: "subagent",
          status: "active",
          startedAt: "2026-01-01T00:00:01.000Z",
          parentToolUseId: "toolu_agent_1",
          delegationPrompt: "Gather CPU info",
          delegationSummary: "Gather CPU info",
          timeline: [
            item({
              id: "mission-echo",
              eventType: "message.final",
              scope: "agent",
              role: "explore",
              agentId: "agent_explore_a",
              text: missionText,
              at: "2026-01-01T00:00:01.100Z",
              sequence: 2,
            }),
            item({
              id: "agent-speech",
              eventType: "message.final",
              scope: "agent",
              role: "explore",
              agentId: "agent_explore_a",
              text: "Checking CPU topology.",
              at: "2026-01-01T00:00:02.000Z",
              sequence: 3,
            }),
          ],
        },
      ],
      timeline: [],
    }),
  );

  expect(view.mainFeedEntries.map((entry) => entry.kind)).toEqual(["agent-card"]);
  expect(view.subagentCards[0]?.timelineIds).toEqual(["agent-speech"]);
  expect(view.subagentCards[0]?.agent.timeline[0]?.text).toBe("Checking CPU topology.");
});

test("buildThreadRunProjectionViewModel absorbs main feed @mission stamped with agentId", () => {
  const missionText = formatSubagentMissionMessage("explore", "Gather GPU info", {
    agentId: "agent_explore_b",
  });
  const view = buildThreadRunProjectionViewModel(
    projection({
      agents: [
        {
          agentId: "agent_explore_b",
          role: "explore",
          kind: "subagent",
          status: "active",
          startedAt: "2026-01-01T00:00:01.000Z",
          delegationPrompt: "Gather GPU info",
          delegationSummary: "Gather GPU info",
          timeline: [],
        },
      ],
      timeline: [
        item({
          id: "mission-main",
          eventType: "message.final",
          scope: "main",
          role: "explore",
          text: missionText,
          at: "2026-01-01T00:00:01.000Z",
          sequence: 1,
        }),
      ],
    }),
  );

  expect(view.mainFeedEntries).toHaveLength(1);
  expect(view.mainFeedEntries[0]?.kind).toBe("agent-card");
});

test("buildThreadRunProjectionViewModel does not echo legacy @mission below subagent card", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      agents: [
        {
          agentId: "agent_explore_legacy",
          role: "explore",
          kind: "subagent",
          status: "active",
          startedAt: "2026-01-01T00:00:01.000Z",
          delegationPrompt: "scan src",
          delegationSummary: "scan src",
          timeline: [
            item({
              id: "mission-legacy",
              eventType: "message.final",
              scope: "agent",
              role: "explore",
              agentId: "agent_explore_legacy",
              text: "@mission explore: scan src",
              at: "2026-01-01T00:00:01.100Z",
              sequence: 2,
            }),
            item({
              id: "agent-speech",
              eventType: "message.final",
              scope: "agent",
              role: "explore",
              agentId: "agent_explore_legacy",
              text: "Scanning repository layout.",
              at: "2026-01-01T00:00:02.000Z",
              sequence: 3,
            }),
          ],
        },
      ],
      timeline: [],
    }),
  );

  expect(view.mainFeedEntries.map((entry) => entry.kind)).toEqual(["agent-card"]);
  expect(view.subagentCards[0]?.timelineIds).toEqual(["agent-speech"]);
  expect(view.subagentCards[0]?.agent.timeline[0]?.text).toBe("Scanning repository layout.");
});

test("projectionItemToDetailBlock omits tool role badge and resolves icon from tool name", () => {
  const detail = projectionItemToDetailBlock(
    item({
      id: "read-index",
      eventType: "tool.completed",
      role: "tool",
      text: "Tool: Read · index.vue",
      metadata: {
        liveType: "tool.completed",
        tool: {
          name: "Read",
          detail: "index.vue",
          toolUseId: "toolu_read_1",
        },
      },
    }),
  );

  expect(detail).toEqual({
    kind: "action",
    icon: "file",
    label: "index.vue",
    toolName: "Read",
    lifecycle: "completed",
    readTarget: {
      fileName: "index.vue",
      filePath: "index.vue",
    },
  });
});

test("projectionItemToDetailBlock maps bash approval to action with lifecycle", () => {
  const detail = projectionItemToDetailBlock(
    item({
      id: "grep-approval",
      eventType: "message.final",
      role: "tool",
      text: "等待确认 Grep：/path/to/file.txt",
      metadata: {
        liveType: "bash_approval.requested",
        bashApproval: {
          toolUseId: "toolu_grep_1",
          phase: "requested",
          toolName: "Grep",
          detail: "/path/to/file.txt",
        },
      },
    }),
  );

  expect(detail).toEqual({
    kind: "action",
    icon: "search",
    label: "/path/to/file.txt",
    toolName: "Grep",
    lifecycle: "approval-pending",
  });
});

test("projectionItemToDetailBlock builds bash card for bash approval requests", () => {
  const detail = projectionItemToDetailBlock(
    item({
      id: "bash-approval",
      eventType: "message.final",
      role: "tool",
      text: "等待确认 Bash：npm test",
      metadata: {
        liveType: "bash_approval.requested",
        bashApproval: {
          toolUseId: "toolu_bash_1",
          phase: "requested",
          toolName: "Bash",
          detail: "npm test",
          description: "Run unit tests",
        },
      },
    }),
  );

  expect(detail).toMatchObject({
    kind: "action",
    icon: "terminal",
    label: "npm test",
    lifecycle: "approval-pending",
    bashRun: {
      title: "Run unit tests",
      body: "npm test",
    },
  });
});

test("buildThreadRunProjectionViewModel hides subagent bash approvals from main feed", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      agents: [
        {
          agentId: "agent_coder_a",
          role: "coder",
          kind: "subagent",
          status: "active",
          startedAt: "2026-01-01T00:00:01.000Z",
          timeline: [
            item({
              id: "approval-wait",
              eventType: "message.final",
              scope: "agent",
              role: "tool",
              agentId: "agent_coder_a",
              text: "等待确认 Bash：npm test",
              sequence: 1,
              metadata: {
                liveType: "bash_approval.requested",
                bashApproval: {
                  toolUseId: "toolu_bash_1",
                  phase: "requested",
                  toolName: "Bash",
                  detail: "npm test",
                },
              },
            }),
            item({
              id: "bash-completed",
              eventType: "tool.completed",
              scope: "agent",
              role: "tool",
              agentId: "agent_coder_a",
              text: "Tool: Bash · npm test",
              sequence: 2,
              metadata: {
                liveType: "tool.completed",
                tool: {
                  name: "Bash",
                  detail: "npm test",
                  toolUseId: "toolu_bash_1",
                  status: "completed",
                  output: "36 pass",
                },
              },
            }),
          ],
        },
      ],
      timeline: [
        item({
          id: "main-approval-wait",
          eventType: "message.final",
          scope: "main",
          role: "tool",
          text: "等待确认 Bash：npm test",
          sequence: 1,
          metadata: {
            liveType: "bash_approval.requested",
            bashApproval: {
              toolUseId: "toolu_bash_1",
              phase: "requested",
              toolName: "Bash",
              detail: "npm test",
            },
          },
        }),
        item({
          id: "main-approval-approved",
          eventType: "message.final",
          scope: "main",
          role: "tool",
          text: "已允许本次 Bash：npm test",
          sequence: 2,
          metadata: {
            liveType: "bash_approval.approved",
            bashApproval: {
              toolUseId: "toolu_bash_1",
              phase: "approved",
              toolName: "Bash",
              detail: "npm test",
            },
          },
        }),
      ],
    }),
  );

  expect(view.mainFeedEntries.map((entry) => entry.key)).toEqual(["agent-card:agent_coder_a"]);
  const card = view.subagentCards[0];
  expect(card?.agent.timeline.map((entry) => entry.id)).toEqual(["bash-completed"]);
});

test("projectionItemToDetailBlock prefers structured tool metadata", () => {
  const detail = projectionItemToDetailBlock(
    item({
      id: "sdk-webfetch",
      eventType: "tool.completed",
      scope: "agent",
      role: "explore",
      agentId: "agent_weather",
      text: "Tool: WebFetch",
      metadata: {
        liveType: "tool.completed",
        tool: {
          name: "WebFetch",
          detail: "https://weather.example/guangzhou",
          toolUseId: "toolu_fetch_1",
          durationMs: 8300,
        },
      },
    }),
  );

  expect(detail).toEqual({
    kind: "action",
    icon: "file",
    label: "https://weather.example/guangzhou (8.3s)",
    toolName: "WebFetch",
    lifecycle: "completed",
    subagent: "explore",
    agentId: "agent_weather",
  });
});

test("projectionItemToDetailBlock prefers structured tool description on completed bash cards", () => {
  const detail = projectionItemToDetailBlock(
    item({
      id: "bash-done",
      eventType: "tool.completed",
      scope: "main",
      role: "planner",
      text: "Tool: Bash · npm test",
      metadata: {
        liveType: "tool.completed",
        tool: {
          name: "Bash",
          detail: "npm test",
          toolUseId: "toolu_bash_1",
          description: "Run unit tests",
          durationMs: 716,
          status: "completed",
          output: "36 pass\n0 fail",
        },
      },
    }),
  );

  expect(detail).toMatchObject({
    kind: "action",
    icon: "terminal",
    bashRun: {
      title: "Run unit tests",
      body: "36 pass\n0 fail",
    },
  });
});

test("projectionItemToDetailBlock builds bash card display for completed bash tools", () => {
  const detail = projectionItemToDetailBlock(
    item({
      id: "bash-done",
      eventType: "tool.completed",
      scope: "main",
      role: "planner",
      text: "Run projection view tests",
      metadata: {
        liveType: "tool.completed",
        tool: {
          name: "Bash",
          detail: "cd apps/desktop && bun test test/thread-run-projection-view.test.ts",
          toolUseId: "toolu_bash_1",
          durationMs: 716,
          status: "completed",
          output: "36 pass\n0 fail",
        },
      },
    }),
  );

  expect(detail).toMatchObject({
    kind: "action",
    icon: "terminal",
    bashRun: {
      title: "Run projection view tests",
      meta: "cd, 1+, 0.7s",
      body: "36 pass\n0 fail",
    },
  });
});

test("projectionItemToDetailBlock separates failed bash command from output", () => {
  const command = "cd apps/desktop && bun test test/thread-run-projection-view.test.ts";
  const detail = projectionItemToDetailBlock(
    item({
      id: "bash-failed",
      eventType: "tool.failed",
      scope: "main",
      role: "planner",
      text: `Tool: Bash · ${command}`,
      metadata: {
        liveType: "tool.failed",
        tool: {
          name: "Bash",
          detail: command,
          toolUseId: "toolu_bash_failed",
          status: "failed",
          output: "1 test failed",
        },
      },
    }),
  );

  expect(detail).toEqual({
    kind: "tool-failed",
    tool: "Bash",
    command,
    error: "1 test failed",
  });
});

test("projectionItemToDetailBlock recovers patch followed by an empty ripgrep verification", () => {
  const command = `/bin/zsh -lc "apply_patch <<'PATCH'
*** Begin Patch
*** Update File: src/example.ts
@@
-old
+new
*** End Patch
PATCH
rg -n \"oldSymbol\" src -g '*.ts'"`;
  const detail = projectionItemToDetailBlock(
    item({
      id: "bash-patch-verified",
      eventType: "tool.failed",
      scope: "main",
      role: "planner",
      text: `Tool: Bash · ${command}`,
      metadata: {
        liveType: "tool.failed",
        tool: {
          name: "Bash",
          detail: command,
          toolUseId: "toolu_bash_patch_verified",
          status: "failed",
          exitCode: 1,
          output: "Success. Updated the following files:\nM src/example.ts\n",
        },
      },
    }),
  );

  expect(detail).toEqual({
    kind: "tool-failed",
    tool: "Bash",
    command,
    recoveredResult: {
      kind: "patch-applied-verification-empty",
      files: [{ status: "M", path: "src/example.ts" }],
    },
  });
});

test("projectionItemToDetailBlock keeps a real command after apply_patch as failed", () => {
  const command = `/bin/zsh -lc "apply_patch <<'PATCH'
*** Begin Patch
*** Update File: src/example.ts
@@
-old
+new
*** End Patch
PATCH
bun test"`;
  const detail = projectionItemToDetailBlock(
    item({
      id: "bash-patch-test-failed",
      eventType: "tool.failed",
      scope: "main",
      role: "planner",
      text: `Tool: Bash · ${command}`,
      metadata: {
        liveType: "tool.failed",
        tool: {
          name: "Bash",
          detail: command,
          status: "failed",
          exitCode: 1,
          output: "Success. Updated the following files:\nM src/example.ts\n",
        },
      },
    }),
  );

  expect(detail).toMatchObject({
    kind: "tool-failed",
    tool: "Bash",
    error: "Success. Updated the following files:\nM src/example.ts",
  });
  expect(detail).not.toHaveProperty("recoveredResult");
});

test("projectionItemToDetailBlock formats MCP tool metadata", () => {
  const detail = projectionItemToDetailBlock(
    item({
      id: "plan-tool",
      eventType: "tool.started",
      scope: "main",
      role: "planner",
      text: "Tool: mcp__eco_plan__finalize_plan",
      metadata: {
        liveType: "tool.started",
        tool: {
          name: "mcp__eco_plan__finalize_plan",
          toolUseId: "toolu_plan",
        },
      },
    }),
  );

  expect(detail).toMatchObject({
    kind: "action",
    label: "提交计划",
  });

  const wrapper = projectionItemToDetailBlock(
    item({
      id: "plan-wrapper",
      eventType: "tool.completed",
      scope: "main",
      role: "planner",
      text: "Tool: mcp_tool · mcp__eco_plan__finalize_plan (0.0s)",
      metadata: {
        liveType: "tool.completed",
        tool: {
          name: "mcp_tool",
          detail: "mcp__eco_plan__finalize_plan",
          durationMs: 0,
        },
      },
    }),
  );

  expect(wrapper).toMatchObject({
    kind: "action",
    label: "提交计划 (0.0s)",
  });
});

test("projectionItemToDetailBlock treats structured todo metadata as tool action", () => {
  const detail = projectionItemToDetailBlock(
    item({
      id: "todo-webfetch",
      eventType: "tool.started",
      scope: "agent",
      role: "explore",
      agentId: "agent_weather",
      text: "https://weather.example/guangzhou",
      metadata: {
        liveType: "todo.updated",
        tool: {
          name: "WebFetch",
          detail: "https://weather.example/guangzhou",
        },
      },
    }),
  );

  expect(detail).toEqual({
    kind: "action",
    icon: "file",
    label: "https://weather.example/guangzhou",
    toolName: "WebFetch",
    subagent: "explore",
    agentId: "agent_weather",
  });
});

test("isProjectionRequestActive follows request span status", () => {
  expect(
    isProjectionRequestActive({
      requestId: "req_waiting",
      status: "waiting_first_token",
      startedAt: "2026-01-01T00:00:00.000Z",
    }),
  ).toBe(true);
  expect(
    isProjectionRequestActive({
      requestId: "req_streaming",
      status: "streaming",
      startedAt: "2026-01-01T00:00:00.000Z",
    }),
  ).toBe(true);
  expect(
    isProjectionRequestActive({
      requestId: "req_done",
      status: "completed",
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T00:00:01.000Z",
    }),
  ).toBe(false);
});

test("buildThreadRunProjectionViewModel drops redundant permission denied lines after tool.failed", () => {
  const view = buildThreadRunProjectionViewModel(
    projection({
      timeline: [
        item({
          id: "tool-failed",
          eventType: "tool.failed",
          sequence: 1,
          text: 'Permission denied for Write: Filesystem write path "/home/user/summer_night.md" is outside Eco workspace.',
          metadata: {
            liveType: "tool.failed",
            tool: {
              name: "Write",
              status: "failed",
              detail:
                'Filesystem write path "/home/user/summer_night.md" is outside Eco workspace "/Users/gareth/.eco/projects/home".',
            },
          },
        }),
        item({
          id: "deny-short",
          sequence: 2,
          role: "system",
          text: "Permission denied for Write",
        }),
        item({
          id: "reject",
          sequence: 3,
          role: "system",
          text: "工具调用被拒绝",
        }),
      ],
    }),
  );

  const timelineEntries = view.mainFeedEntries.filter((entry) => entry.kind === "timeline");
  expect(timelineEntries).toHaveLength(1);
  expect(timelineEntries[0]?.kind === "timeline" && timelineEntries[0].item.id).toBe("tool-failed");
  const firstEntry = requireValue(timelineEntries[0], "timeline entry");
  if (firstEntry.kind !== "timeline") {
    throw new Error("timeline entry missing");
  }
  expect(projectionItemToDetailBlock(firstEntry.item)).toMatchObject({
    kind: "tool-failed",
    tool: "Write",
  });
});
