import { expect, test } from "bun:test";
import { formatSubagentMissionMessage } from "@eco/runtime";
import {
  shouldClearReconnectActivity,
} from "../src/shared/activity-display";
import {
  buildWorktreeMergeSummary,
  serializeWorktreeMergeMessage,
} from "../src/shared/worktree-merge";
import {
  buildActivityLogBlocks,
  countOpenAgentDelegations,
  thinkingPreviewLine,
  findSubagentRunLineBounds,
  isAgentElapsedProgressLine,
  isModelRequestLine,
  isReconnectActivityMessage,
  resolveActiveSubagents,
  resolveLatestSubagentLogLine,
  resolveSubagentRunDurationMs,
  sessionAwaitingFirstToken,
  shouldScrollMainActivityFeedForLine,
} from "../src/renderer/activity-log";

test("only planner-side activity lines scroll the main feed", () => {
  expect(shouldScrollMainActivityFeedForLine({ role: "planner", message: "hi", id: "1" })).toBe(true);
  expect(shouldScrollMainActivityFeedForLine({ role: "user", message: "go", id: "2" })).toBe(true);
  expect(shouldScrollMainActivityFeedForLine({ role: "tool", message: "Tool: Read", id: "3" })).toBe(
    true,
  );
  expect(shouldScrollMainActivityFeedForLine({ role: "reviewer", message: "Tool: Read", id: "4" })).toBe(
    false,
  );
  expect(shouldScrollMainActivityFeedForLine({ role: "coder", message: "editing", id: "5" })).toBe(false);
});

test("groups narrative and compact tool summaries into collapsible work session", () => {
  const blocks = buildActivityLogBlocks(
    [
      { id: "u1", role: "user", message: "Add feature" },
      { id: "1", role: "planner", message: "Let me check `react-quill` compatibility first." },
      { id: "2", role: "tool", message: "Tool: Read · styles.css" },
      { id: "3", role: "tool", message: "Tool: Read · package.json" },
      { id: "4", role: "planner", message: "Here is the final plan summary for you." },
    ],
    { status: "completed", createdAt: new Date(Date.now() - 394_000).toISOString() },
  );

  expect(blocks.some((block) => block.kind === "user-prompt")).toBe(true);
  const session = blocks.find(
    (block) => block.kind === "work-session" && !block.compactSubagentMode,
  );
  expect(session?.kind).toBe("work-session");
  if (session?.kind !== "work-session") {
    return;
  }
  expect(session.defaultCollapsed).toBe(false);
  expect(session.inlineContent).toBe(true);
  expect(session.compactSubagentMode).toBeFalsy();
  expect(session.children.some((child) => child.kind === "action" && child.label.includes("styles.css"))).toBe(
    true,
  );
  const summary = blocks.find((block) => block.kind === "assistant-message");
  expect(summary?.kind).toBe("assistant-message");
  if (summary?.kind === "assistant-message") {
    expect(summary.text).toContain("final plan summary");
  }
});

test("collapses work session while subagent is running", () => {
  const lines = [
    { id: "u1", role: "user", message: "Go" },
    { id: "1", role: "coder", message: "Checking package.json", stream: true },
  ] as const;
  const blocks = buildActivityLogBlocks([...lines], {
    status: "running",
    createdAt: new Date().toISOString(),
  });

  const session = blocks.find((block) => block.kind === "work-session");
  expect(session?.kind).toBe("work-session");
  if (session?.kind !== "work-session") {
    return;
  }
  expect(session.running).toBe(true);
  expect(session.compactSubagentMode).toBe(true);
  expect(session.defaultCollapsed).toBe(true);
  expect(session.activeSubagents).toContain("coder");
});

test("keeps planner-only work session expanded while running", () => {
  const blocks = buildActivityLogBlocks(
    [
      { id: "u1", role: "user", message: "Go" },
      { id: "1", role: "planner", message: "Let me inspect the repo.", stream: true },
    ],
    { status: "running", createdAt: new Date().toISOString() },
  );

  const session = blocks.find((block) => block.kind === "work-session");
  expect(session?.kind).toBe("work-session");
  if (session?.kind !== "work-session") {
    return;
  }
  expect(session.running).toBe(true);
  expect(session.compactSubagentMode).toBeFalsy();
  expect(session.defaultCollapsed).toBe(false);
});

test("keeps thinking separate from agent narrative streams", () => {
  const blocks = buildActivityLogBlocks(
    [
      { id: "u1", role: "user", message: "test" },
      { id: "1", role: "thinking", message: "Let me also", stream: true },
      { id: "2", role: "coder", message: "check the index.html", stream: true },
      { id: "3", role: "coder", message: "check the index.html to", stream: true },
      {
        id: "4",
        role: "coder",
        message: "check the index.html to understand",
        stream: true,
      },
      {
        id: "5",
        role: "coder",
        message: "check the index.html to understand the",
        stream: true,
      },
      {
        id: "6",
        role: "coder",
        message: "check the index.html to understand the build",
        stream: true,
      },
      {
        id: "7",
        role: "coder",
        message: "check the index.html to understand the build setup.",
        stream: true,
      },
    ],
    { status: "running", createdAt: new Date().toISOString() },
  );

  const plannerSession = blocks.find(
    (block) => block.kind === "work-session" && !block.compactSubagentMode,
  );
  const coderSession = blocks.find(
    (block) => block.kind === "work-session" && block.compactSubagentMode,
  );
  expect(plannerSession?.kind).toBe("work-session");
  expect(coderSession?.kind).toBe("work-session");
  if (plannerSession?.kind !== "work-session" || coderSession?.kind !== "work-session") {
    return;
  }
  const thinking = plannerSession.children.find((child) => child.kind === "thinking");
  const narrative = coderSession.children.find((child) => child.kind === "narrative");
  expect(thinking?.kind).toBe("thinking");
  if (thinking?.kind === "thinking") {
    expect(thinking.text).toBe("Let me also");
    expect(thinking.streaming).toBeFalsy();
  }
  expect(narrative?.kind).toBe("narrative");
  if (narrative?.kind === "narrative") {
    expect(narrative.text).toBe("check the index.html to understand the build setup.");
  }
});

test("renders streaming thinking label even before first token", () => {
  const blocks = buildActivityLogBlocks(
    [
      { id: "u1", role: "user", message: "go" },
      { id: "1", role: "thinking", message: "", stream: true },
    ],
    { status: "running", createdAt: new Date().toISOString() },
  );

  const session = blocks.find((block) => block.kind === "work-session");
  const thinking = session?.kind === "work-session"
    ? session.children.find((child) => child.kind === "thinking")
    : undefined;
  expect(thinking?.kind).toBe("thinking");
  if (thinking?.kind === "thinking") {
    expect(thinking.text).toBe("");
    expect(thinking.streaming).toBe(true);
  }
});

test("shows active subagent while running", () => {
  const lines = [
    { id: "u1", role: "user", message: "run" },
    { id: "1", role: "planner", message: "【3/3】执行" },
    {
      id: "2",
      role: "tool",
      message: "Tool: Agent · 编码 (coder)",
    },
    { id: "3", role: "coder", message: "Checking package.json", stream: true },
  ];
  const blocks = buildActivityLogBlocks(lines, {
    status: "running",
    createdAt: new Date().toISOString(),
  });

  const session = blocks.find(
    (block) => block.kind === "work-session" && block.compactSubagentMode && block.running,
  );
  expect(session?.kind).toBe("work-session");
  if (session?.kind === "work-session") {
    expect(session.subagentRunRole).toBe("coder");
    expect(session.activeSubagent).toBe("coder");
    expect(session.compactSubagentMode).toBe(true);
    expect(session.activeSubagents).toContain("coder");
  }
  expect(resolveActiveSubagents(lines, "running")).toContain("coder");
});

test("counts parallel coder delegations", () => {
  const lines = [
    { id: "u1", role: "user", message: "go" },
    { id: "1", role: "tool", message: "Tool: Agent · 编码 (coder)" },
    { id: "2", role: "tool", message: "Tool: Agent · 编码 (coder)" },
    { id: "3", role: "coder", message: "Tool: Read · a.ts" },
  ];
  expect(countOpenAgentDelegations(lines, "coder")).toBe(2);
  expect(resolveActiveSubagents(lines, "running").filter((role) => role === "coder")).toHaveLength(2);
});

test("shows planner work inline when subagent cards exist", () => {
  const missionCoder = formatSubagentMissionMessage("coder", "Implement");
  const blocks = buildActivityLogBlocks(
    [
      { id: "u1", role: "user", message: "go" },
      { id: "1", role: "planner", message: "【3/3】执行" },
      { id: "2", role: "planner", message: missionCoder },
      { id: "3", role: "coder", message: "Tool: Read · a.ts" },
    ],
    { status: "completed", createdAt: new Date(Date.now() - 3_334_000).toISOString() },
  );

  const plannerSession = blocks.find(
    (block) => block.kind === "work-session" && !block.compactSubagentMode,
  );
  expect(plannerSession?.kind).toBe("work-session");
  if (plannerSession?.kind === "work-session") {
    expect(plannerSession.inlineContent).toBe(true);
    expect(plannerSession.defaultCollapsed).toBe(false);
  }
});

test("isolates each subagent run into its own compact work session", () => {
  const missionCoder = formatSubagentMissionMessage("coder", "Implement export API");
  const missionReviewer = formatSubagentMissionMessage(
    "reviewer",
    "Review export API changes in src/api.ts",
  );
  const blocks = buildActivityLogBlocks(
    [
      { id: "u1", role: "user", message: "go" },
      { id: "1", role: "planner", message: "【3/3】执行" },
      { id: "2", role: "planner", message: missionCoder },
      { id: "3", role: "coder", message: "Tool: Read · src/api.ts" },
      { id: "4", role: "planner", message: missionReviewer },
      { id: "5", role: "reviewer", message: "Tool: Read · src/api.ts" },
    ],
    { status: "running", createdAt: new Date().toISOString() },
  );

  const compactSessions = blocks.filter(
    (block): block is Extract<typeof block, { kind: "work-session" }> =>
      block.kind === "work-session" && Boolean(block.compactSubagentMode),
  );
  expect(compactSessions).toHaveLength(2);
  expect(compactSessions[0]?.subagentRunRole).toBe("coder");
  expect(compactSessions[1]?.subagentRunRole).toBe("reviewer");
  expect(compactSessions[0]?.running).toBe(false);
  expect(compactSessions[1]?.running).toBe(true);
  expect(
    blocks.some(
      (block) =>
        block.kind === "work-session" &&
        !block.compactSubagentMode &&
        block.children.some((child) => child.kind === "phase"),
    ),
  ).toBe(true);
});

test("uses compact mode for reviewer subagent work", () => {
  const missionLine = formatSubagentMissionMessage(
    "reviewer",
    "Review export API changes in src/api.ts",
  );
  const blocks = buildActivityLogBlocks(
    [
      { id: "u1", role: "user", message: "go" },
      { id: "1", role: "planner", message: missionLine },
      { id: "2", role: "reviewer", message: "Tool: Read · src/api.ts" },
    ],
    { status: "running", createdAt: new Date().toISOString() },
  );

  const session = blocks.find((block) => block.kind === "work-session");
  expect(session?.kind).toBe("work-session");
  if (session?.kind === "work-session") {
    expect(session.compactSubagentMode).toBe(true);
    expect(session.defaultCollapsed).toBe(true);
  }
});

test("shows user prompt as a preserved node", () => {
  const blocks = buildActivityLogBlocks(
    [
      { id: "u1", role: "user", message: "给导出接口加筛选参数\n第二行保留" },
      { id: "2", role: "planner", message: "Let me inspect the repo." },
    ],
    { status: "running", createdAt: new Date().toISOString() },
  );

  const userBlock = blocks.find((block) => block.kind === "user-prompt");
  expect(userBlock?.kind).toBe("user-prompt");
  if (userBlock?.kind !== "user-prompt") {
    return;
  }
  expect(userBlock.text).toBe("给导出接口加筛选参数\n第二行保留");
});

test("shows subagent mission before tool steps", () => {
  const missionLine = formatSubagentMissionMessage(
    "reviewer",
    "Review code changes for the export API.\nFiles changed: src/api.ts",
  );
  const blocks = buildActivityLogBlocks(
    [
      { id: "u1", role: "user", message: "go" },
      { id: "1", role: "planner", message: missionLine },
      { id: "2", role: "reviewer", message: "Tool: Read · src/api.ts" },
    ],
    { status: "running", createdAt: new Date().toISOString() },
  );

  const session = blocks.find((block) => block.kind === "work-session");
  expect(session?.kind).toBe("work-session");
  if (session?.kind !== "work-session") {
    return;
  }
  const mission = session.children.find((child) => child.kind === "subagent-mission");
  expect(mission?.kind).toBe("subagent-mission");
  if (mission?.kind === "subagent-mission") {
    expect(mission.subagent).toBe("reviewer");
    expect(mission.summary).toContain("src/api.ts");
  }
  expect(session.activeMissionSummary).toContain("src/api.ts");
});

test("resolves subagent run duration from agent elapsed lines", () => {
  const missionLine = formatSubagentMissionMessage("coder", "Implement API");
  const lines = [
    { id: "1", role: "planner", message: missionLine },
    { id: "2", role: "tool", message: "Tool: Agent · 编码 (coder)" },
    { id: "3", role: "tool", message: "Tool: Agent (12.5s)" },
    {
      id: "4",
      role: "planner",
      message: formatSubagentMissionMessage("reviewer", "Review"),
    },
    { id: "5", role: "tool", message: "Tool: Agent · 审查 (reviewer)" },
    { id: "6", role: "tool", message: "Tool: Agent (4s)" },
  ];
  expect(resolveSubagentRunDurationMs(lines, "coder", 0)).toBe(12_500);
  expect(resolveSubagentRunDurationMs(lines, "reviewer", 0)).toBe(4000);
});

test("finds isolated line bounds per subagent occurrence", () => {
  const lines = [
    { id: "1", role: "planner", message: formatSubagentMissionMessage("reviewer", "Round 1") },
    { id: "2", role: "tool", message: "Tool: Agent (3s)" },
    { id: "3", role: "planner", message: formatSubagentMissionMessage("reviewer", "Round 2") },
    { id: "4", role: "tool", message: "Tool: Agent (7s)" },
  ];
  expect(findSubagentRunLineBounds(lines, "reviewer", 0)).toEqual({ start: 0, end: 2 });
  expect(findSubagentRunLineBounds(lines, "reviewer", 1)).toEqual({ start: 2, end: 4 });
  expect(resolveSubagentRunDurationMs(lines, "reviewer", 0)).toBe(3000);
  expect(resolveSubagentRunDurationMs(lines, "reviewer", 1)).toBe(7000);
});

test("attaches run duration to completed subagent work session", () => {
  const missionLine = formatSubagentMissionMessage("coder", "Implement API");
  const blocks = buildActivityLogBlocks(
    [
      { id: "u1", role: "user", message: "go" },
      { id: "1", role: "planner", message: missionLine },
      { id: "2", role: "tool", message: "Tool: Agent · 编码 (coder)" },
      { id: "3", role: "tool", message: "Tool: Agent (8s)" },
      { id: "4", role: "tool", message: "Tool: Agent · 审查 (reviewer)" },
      { id: "5", role: "reviewer", message: "Tool: Read · a.ts", stream: true },
    ],
    { status: "running", createdAt: new Date().toISOString() },
  );

  const coderSession = blocks.find(
    (block) => block.kind === "work-session" && block.subagentRunRole === "coder",
  );
  expect(coderSession?.kind).toBe("work-session");
  if (coderSession?.kind === "work-session") {
    expect(coderSession.runDurationMs).toBe(8000);
    expect(coderSession.running).toBe(false);
  }
});

test("does not split subagent run on interleaved planner model-request lines", () => {
  const missionLine = formatSubagentMissionMessage("reviewer", "Review changes");
  const blocks = buildActivityLogBlocks(
    [
      { id: "u1", role: "user", message: "go" },
      { id: "1", role: "planner", message: missionLine },
      { id: "2", role: "reviewer", message: "Tool: TodoWrite · update task" },
      { id: "3", role: "planner", message: "Requesting model…" },
      { id: "4", role: "reviewer", message: "Tool: TodoWrite · list tasks" },
      { id: "5", role: "planner", message: "Requesting model…" },
      { id: "6", role: "reviewer", message: "Tool: Bash · npx tsc" },
    ],
    { status: "running", createdAt: new Date().toISOString() },
  );

  const reviewerSessions = blocks.filter(
    (block) => block.kind === "work-session" && block.subagentRunRole === "reviewer",
  );
  expect(reviewerSessions).toHaveLength(1);
  const plannerSeparators = blocks.filter(
    (block) => block.kind === "work-session" && !block.compactSubagentMode,
  );
  expect(plannerSeparators).toHaveLength(0);
});

test("isolates repeated reviewer missions into separate compact cards with distinct durations", () => {
  const mission1 = formatSubagentMissionMessage("reviewer", "Review round 1");
  const mission2 = formatSubagentMissionMessage("reviewer", "Review round 2");
  const blocks = buildActivityLogBlocks(
    [
      { id: "u1", role: "user", message: "go" },
      { id: "1", role: "planner", message: mission1 },
      { id: "2", role: "tool", message: "Tool: Agent · 审查 (reviewer)" },
      { id: "3", role: "tool", message: "Tool: Agent (10s)" },
      { id: "4", role: "planner", message: mission2 },
      { id: "5", role: "tool", message: "Tool: Agent · 审查 (reviewer)" },
      { id: "6", role: "tool", message: "Tool: Agent (22s)" },
    ],
    { status: "completed", createdAt: new Date().toISOString() },
  );

  const reviewerSessions = blocks.filter(
    (block): block is Extract<typeof block, { kind: "work-session" }> =>
      block.kind === "work-session" && block.subagentRunRole === "reviewer",
  );
  expect(reviewerSessions).toHaveLength(2);
  expect(reviewerSessions[0]?.runDurationMs).toBe(10_000);
  expect(reviewerSessions[1]?.runDurationMs).toBe(22_000);
});

test("resolves latest subagent log line for compact card", () => {
  const blocks = buildActivityLogBlocks(
    [
      { id: "u1", role: "user", message: "implement" },
      { id: "1", role: "tool", message: "Tool: Agent · 编码 (coder)" },
      { id: "2", role: "coder", message: "Tool: Read · src/api.ts" },
      { id: "3", role: "coder", message: "Tool: Edit · src/api.ts" },
    ],
    { status: "running", createdAt: new Date().toISOString() },
  );

  const session = blocks.find((block) => block.kind === "work-session");
  expect(session?.kind).toBe("work-session");
  if (session?.kind === "work-session") {
    expect(session.latestSubagentLogLine).toBe("编辑 · src/api.ts");
  }
  expect(resolveLatestSubagentLogLine([
    { kind: "action", icon: "file", label: "读取 · a.ts", subagent: "coder" },
    { kind: "action", icon: "edit", label: "编辑 · b.ts", subagent: "coder" },
  ])).toBe("编辑 · b.ts");
});

test("shows each subagent tool step with role and target", () => {
  const blocks = buildActivityLogBlocks(
    [
      { id: "u1", role: "user", message: "implement" },
      { id: "1", role: "tool", message: "Tool: Agent · 编码 (coder)" },
      { id: "2", role: "coder", message: "Tool: Read · src/api.ts" },
      { id: "3", role: "coder", message: "Tool: Edit · src/api.ts" },
      { id: "4", role: "reviewer", message: "Tool: Read · src/api.ts" },
    ],
    { status: "running", createdAt: new Date().toISOString() },
  );

  const sessions = blocks.filter((block) => block.kind === "work-session" && block.compactSubagentMode);
  expect(sessions.length).toBeGreaterThanOrEqual(2);
  const actions = sessions.flatMap((session) =>
    session.kind === "work-session" ? session.children.filter((child) => child.kind === "action") : [],
  );
  expect(actions.length).toBeGreaterThanOrEqual(3);
  const coderRead = actions.find(
    (child) => child.kind === "action" && child.subagent === "coder" && child.label.includes("src/api.ts"),
  );
  expect(coderRead?.kind).toBe("action");
});

test("deduplicates repeated narrative separated by tool exploration", () => {
  const blocks = buildActivityLogBlocks(
    [
      { id: "u1", role: "user", message: "explore" },
      {
        id: "1",
        role: "planner",
        message:
          "Now I have enough context. Let me read the cells data structure to understand the zone counts.",
      },
      { id: "2", role: "tool", message: "Tool: Grep · cells" },
      {
        id: "3",
        role: "planner",
        message:
          "Now I have enough context. Let me look at the cells structure to understand the zone counts.",
      },
    ],
    { status: "running", createdAt: new Date().toISOString() },
  );

  const session = blocks.find((block) => block.kind === "work-session");
  const narratives =
    session?.kind === "work-session"
      ? session.children.filter((child) => child.kind === "narrative")
      : [];
  expect(narratives).toHaveLength(1);
});

test("collapses read progress and grep tool on the same file", () => {
  const blocks = buildActivityLogBlocks(
    [
      { id: "u1", role: "user", message: "explore" },
      { id: "1", role: "explore", message: "Reading activityLinkGroupMessage.service.ts · Read" },
      { id: "2", role: "tool", message: "Tool: Grep · activityLinkGroupMessage.service.ts" },
    ],
    { status: "running", createdAt: new Date().toISOString() },
  );

  const session = blocks.find((block) => block.kind === "work-session");
  const actions =
    session?.kind === "work-session"
      ? session.children.filter((child) => child.kind === "action")
      : [];
  expect(actions).toHaveLength(1);
  expect(actions[0]?.kind).toBe("action");
  if (actions[0]?.kind === "action") {
    expect(actions[0].label).toBe("搜索 · activityLinkGroupMessage.service.ts");
  }
});

test("hides usage cost lines even with subagent prefix", () => {
  const blocks = buildActivityLogBlocks(
    [
      { id: "u1", role: "user", message: "go" },
      { id: "1", role: "planner", message: "【规划】Usage recorded (cost $2.1695)." },
      { id: "2", role: "tool", message: "Tool: Read · styles.css" },
      { id: "3", role: "planner", message: "Here is the plan outline." },
    ],
    { status: "completed", createdAt: new Date().toISOString() },
  );

  const serialized = JSON.stringify(blocks);
  expect(serialized).not.toMatch(/Usage recorded/i);
  expect(blocks.some((block) => block.kind === "assistant-message" && block.text.includes("plan outline"))).toBe(
    true,
  );
});

test("shows reconnect phase for auto-retry and connection failure lines", () => {
  expect(isReconnectActivityMessage("【自动重试 1/5】5 秒后重试：fetch failed")).toBe(true);
  expect(isReconnectActivityMessage("【连接失败】无法连接上游")).toBe(true);

  const blocks = buildActivityLogBlocks(
    [
      { id: "u1", role: "user", message: "go" },
      { id: "1", role: "system", message: "【连接失败】无法连接上游模型 API。" },
      { id: "2", role: "system", message: "【自动重试 2/5】5 秒后重试：fetch failed" },
    ],
    { status: "running", createdAt: new Date().toISOString() },
  );

  const session = blocks.find((block) => block.kind === "work-session");
  const phases =
    session?.kind === "work-session"
      ? session.children.filter((child) => child.kind === "phase")
      : [];
  expect(phases).toHaveLength(1);
  expect(phases[0]?.kind).toBe("phase");
  if (phases[0]?.kind === "phase") {
    expect(phases[0].reconnecting).toBe(true);
    expect(phases[0].label).toContain("自动重试 2/5");
  }
});

test("clears reconnect phase after connection resumes", () => {
  expect(shouldClearReconnectActivity({ role: "planner", message: "Requesting model…" })).toBe(true);
  expect(shouldClearReconnectActivity({ role: "system", message: "【自动重试 1/5】5 秒后重试" })).toBe(
    false,
  );

  const blocks = buildActivityLogBlocks(
    [
      { id: "u1", role: "user", message: "go" },
      { id: "1", role: "system", message: "【连接失败】无法连接上游模型 API。" },
      { id: "2", role: "system", message: "【自动重试 1/5】5 秒后重试：fetch failed" },
      { id: "3", role: "planner", message: "Requesting model…" },
      { id: "4", role: "tool", message: "Tool: Read · a.ts" },
    ],
    { status: "running", createdAt: new Date().toISOString() },
  );

  const session = blocks.find((block) => block.kind === "work-session");
  const reconnectPhases =
    session?.kind === "work-session"
      ? session.children.filter((child) => child.kind === "phase" && child.reconnecting)
      : [];
  expect(reconnectPhases).toHaveLength(0);
});

test("collapses repeated auto-retry lines into one reconnect phase", () => {
  const blocks = buildActivityLogBlocks(
    [
      { id: "u1", role: "user", message: "go" },
      { id: "1", role: "system", message: "【自动重试 1/5】5 秒后重试：error A" },
      { id: "2", role: "system", message: "【自动重试 2/5】5 秒后重试：error B" },
      { id: "3", role: "system", message: "【自动重试 5/5】5 秒后重试：error C" },
    ],
    { status: "running", createdAt: new Date().toISOString() },
  );

  const session = blocks.find((block) => block.kind === "work-session");
  const phases =
    session?.kind === "work-session"
      ? session.children.filter((child) => child.kind === "phase" && child.reconnecting)
      : [];
  expect(phases).toHaveLength(1);
  if (phases[0]?.kind === "phase") {
    expect(phases[0].label).toContain("自动重试 5/5");
    expect(phases[0].label).toContain("error C");
  }
});

test("drops stale model-request before tool actions", () => {
  const blocks = buildActivityLogBlocks(
    [
      { id: "u1", role: "user", message: "hi" },
      { id: "1", role: "planner", message: "Requesting model…" },
      { id: "2", role: "tool", message: "Tool: Read · src/api.ts" },
    ],
    { status: "running", createdAt: new Date().toISOString() },
  );

  const session = blocks.find((block) => block.kind === "work-session");
  expect(session?.kind).toBe("work-session");
  if (session?.kind !== "work-session") {
    return;
  }
  expect(session.children.some((child) => child.kind === "model-request")).toBe(false);
  expect(session.children[session.children.length - 1]?.kind).toBe("action");
});

test("keeps model-request as the last step when still waiting", () => {
  const blocks = buildActivityLogBlocks(
    [
      { id: "u1", role: "user", message: "hi" },
      { id: "1", role: "tool", message: "Tool: Read · src/api.ts" },
      { id: "2", role: "planner", message: "Requesting model…" },
      { id: "3", role: "planner", message: "Requesting model…" },
    ],
    { status: "running", createdAt: new Date().toISOString() },
  );

  const session = blocks.find((block) => block.kind === "work-session");
  expect(session?.kind).toBe("work-session");
  if (session?.kind !== "work-session") {
    return;
  }
  const requests = session.children.filter(
    (child) => child.kind === "model-request" || child.kind === "agent-request",
  );
  expect(requests).toHaveLength(1);
  expect(session.children[session.children.length - 1]?.kind).toBe("model-request");
});

test("shows model-request row for Requesting model status line", () => {
  expect(isModelRequestLine("Requesting model…")).toBe(true);

  const blocks = buildActivityLogBlocks(
    [
      { id: "u1", role: "user", message: "hi" },
      { id: "1", role: "planner", message: "Requesting model…" },
    ],
    { status: "running", createdAt: new Date().toISOString() },
  );

  const session = blocks.find((block) => block.kind === "work-session");
  expect(session?.kind).toBe("work-session");
  if (session?.kind === "work-session") {
    expect(session.children.some((child) => child.kind === "model-request")).toBe(true);
    expect(session.awaitingFirstToken).toBe(true);
  }
});

test("shows placeholder work session while running with no activity yet", () => {
  const blocks = buildActivityLogBlocks(
    [{ id: "u1", role: "user", message: "go" }],
    { status: "running", createdAt: new Date().toISOString() },
  );

  const session = blocks.find((block) => block.kind === "work-session");
  expect(session?.kind).toBe("work-session");
  if (session?.kind === "work-session") {
    expect(session.awaitingFirstToken).toBe(true);
    expect(session.children[0]?.kind).toBe("model-request");
  }
});

test("marks session awaiting first token for empty streaming thinking", () => {
  const blocks = buildActivityLogBlocks(
    [
      { id: "u1", role: "user", message: "go" },
      { id: "1", role: "thinking", message: "", stream: true },
    ],
    { status: "running", createdAt: new Date().toISOString() },
  );

  const session = blocks.find((block) => block.kind === "work-session");
  expect(session?.kind).toBe("work-session");
  if (session?.kind === "work-session") {
    expect(session.awaitingFirstToken).toBe(true);
    expect(sessionAwaitingFirstToken(session.children)).toBe(true);
  }
});

test("shows agent-request row while subagent has no output yet", () => {
  expect(isAgentElapsedProgressLine("Tool: Agent (12.3s)")).toBe(true);

  const blocks = buildActivityLogBlocks(
    [
      { id: "u1", role: "user", message: "go" },
      { id: "1", role: "tool", message: "Tool: Agent · 编码 (coder)" },
      { id: "2", role: "tool", message: "Tool: Agent (4.2s)" },
    ],
    { status: "running", createdAt: new Date().toISOString() },
  );

  const session = blocks.find(
    (block) => block.kind === "work-session" && block.compactSubagentMode && block.running,
  );
  expect(session?.kind).toBe("work-session");
  if (session?.kind === "work-session") {
    expect(session.children.some((child) => child.kind === "agent-request")).toBe(true);
    expect(session.awaitingFirstToken).toBe(true);
  }
});

test("clears awaiting once subagent streams narrative", () => {
  const blocks = buildActivityLogBlocks(
    [
      { id: "u1", role: "user", message: "go" },
      { id: "1", role: "tool", message: "Tool: Agent · 编码 (coder)" },
      { id: "2", role: "coder", message: "Starting", stream: true },
    ],
    { status: "running", createdAt: new Date().toISOString() },
  );

  const session = blocks.find((block) => block.kind === "work-session");
  expect(session?.kind).toBe("work-session");
  if (session?.kind === "work-session") {
    expect(session.children.some((child) => child.kind === "agent-request")).toBe(false);
    expect(session.awaitingFirstToken).toBeUndefined();
  }
});

test("renders tool failed lines as tool-failed blocks", () => {
  const blocks = buildActivityLogBlocks(
    [
      { id: "u1", role: "user", message: "go" },
      { id: "1", role: "coder", message: "Tool failed: Read · ENOENT: missing file" },
    ],
    { status: "running", createdAt: new Date().toISOString() },
  );

  const session = blocks.find((block) => block.kind === "work-session");
  expect(session?.kind).toBe("work-session");
  if (session?.kind !== "work-session") {
    return;
  }
  const failed = session.children.find((child) => child.kind === "tool-failed");
  expect(failed).toMatchObject({
    kind: "tool-failed",
    tool: "Read",
    error: "ENOENT: missing file",
    subagent: "coder",
  });
});

test("upgrades weak agent mission with @mission payload", () => {
  const missionLine = formatSubagentMissionMessage(
    "coder",
    "Implement export filters.\nFiles: src/api.ts",
  );
  const blocks = buildActivityLogBlocks(
    [
      { id: "u1", role: "user", message: "go" },
      { id: "1", role: "tool", message: "Tool: Agent · 编码 (coder)" },
      { id: "2", role: "planner", message: missionLine },
    ],
    { status: "running", createdAt: new Date().toISOString() },
  );

  const session = blocks.find((block) => block.kind === "work-session");
  expect(session?.kind).toBe("work-session");
  if (session?.kind !== "work-session") {
    return;
  }
  const missions = session.children.filter((child) => child.kind === "subagent-mission");
  expect(missions).toHaveLength(1);
  if (missions[0]?.kind === "subagent-mission") {
    expect(missions[0].prompt).toContain("src/api.ts");
    expect(missions[0].summary).toContain("src/api.ts");
  }
});

test("does not treat tool elapsed duration as subagent role", () => {
  const blocks = buildActivityLogBlocks(
    [
      { id: "u1", role: "user", message: "go" },
      { id: "1", role: "tool", message: "Tool: Agent · 编码 (coder)" },
      { id: "2", role: "tool", message: "Tool: Agent (32.5s)" },
      { id: "3", role: "coder", message: "Tool: TodoWrite (0.0s)" },
    ],
    { status: "running", createdAt: new Date().toISOString() },
  );

  const session = blocks.find((block) => block.kind === "work-session");
  expect(session?.kind).toBe("work-session");
  if (session?.kind !== "work-session") {
    return;
  }
  expect(session.activeSubagent).toBe("coder");
  const mission = session.children.find((child) => child.kind === "subagent-mission");
  expect(mission?.kind).toBe("subagent-mission");
  if (mission?.kind === "subagent-mission") {
    expect(mission.subagent).toBe("coder");
    expect(mission.summary).not.toContain("32.5s");
  }
  const todoAction = session.children.find(
    (child) => child.kind === "action" && child.label.includes("更新任务"),
  );
  expect(todoAction?.kind).toBe("action");
  if (todoAction?.kind === "action") {
    expect(todoAction.subagent).toBe("coder");
    expect(todoAction.label).toBe("更新任务");
  }
});

test("thinkingPreviewLine collapses markdown to one line", () => {
  expect(
    thinkingPreviewLine("**Plan**\n\n- item one\n- item two"),
  ).toBe("Plan - item one - item two");
  expect(thinkingPreviewLine("a".repeat(200)).endsWith("…")).toBe(true);
});

test("renders MCP tool calls as styled actions instead of narrative", () => {
  const blocks = buildActivityLogBlocks(
    [
      { id: "u1", role: "user", message: "plan this" },
      { id: "1", role: "planner", message: "提交实现计划给 Eco。" },
      { id: "2", role: "planner", message: "Tool: mcp__eco_plan__finalize_plan" },
      { id: "3", role: "tool", message: "Tool: mcp_tool (0.0s)" },
      { id: "4", role: "planner", message: "我会先核对当前工作树状态。" },
    ],
    { status: "running", createdAt: new Date().toISOString() },
  );

  const session = blocks.find((block) => block.kind === "work-session");
  expect(session?.kind).toBe("work-session");
  if (session?.kind !== "work-session") {
    return;
  }

  const mcpAction = session.children.find(
    (child) => child.kind === "action" && child.label === "提交计划",
  );
  expect(mcpAction?.kind).toBe("action");
  if (mcpAction?.kind === "action") {
    expect(mcpAction.icon).toBe("file");
  }

  const narrative = session.children.find(
    (child) => child.kind === "narrative" && child.text.includes("mcp__eco_plan__finalize_plan"),
  );
  expect(narrative).toBeUndefined();

  const wrapperAction = session.children.filter(
    (child) => child.kind === "action" && child.label.includes("MCP 工具"),
  );
  expect(wrapperAction.length).toBe(0);
});

test("formats generic MCP tool names for display", () => {
  const blocks = buildActivityLogBlocks(
    [
      { id: "u1", role: "user", message: "go" },
      { id: "1", role: "tool", message: "Tool: mcp__github__list_issues" },
    ],
    { status: "completed", createdAt: new Date().toISOString() },
  );

  const session = blocks.find((block) => block.kind === "work-session");
  expect(session?.kind).toBe("work-session");
  if (session?.kind !== "work-session") {
    return;
  }
  const action = session.children.find((child) => child.kind === "action");
  expect(action?.kind).toBe("action");
  if (action?.kind === "action") {
    expect(action.label).toBe("github · list issues");
    expect(action.icon).toBe("file");
  }
});

test("emits dedicated worktree-merge block instead of narrative markdown", () => {
  const summary = buildWorktreeMergeSummary(
    `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1 +1,2 @@
+x
`,
    ["src/a.ts"],
  );
  const mergeMessage = serializeWorktreeMergeMessage(summary);
  const blocks = buildActivityLogBlocks(
    [
      { id: "u1", role: "user", message: "implement" },
      { id: "1", role: "planner", message: "Tool: Write · src/a.ts" },
      { id: "2", role: "system", message: mergeMessage },
    ],
    { status: "completed", createdAt: new Date().toISOString() },
  );

  const mergeBlock = blocks.find((block) => block.kind === "worktree-merge");
  expect(mergeBlock?.kind).toBe("worktree-merge");
  if (mergeBlock?.kind === "worktree-merge") {
    expect(mergeBlock.summary.files).toHaveLength(1);
    expect(mergeBlock.summary.totalAdditions).toBe(1);
  }

  const markdownNarrative = blocks.find(
    (block) =>
      block.kind === "assistant-message" &&
      block.text.includes("__eco_worktree_merge__"),
  );
  expect(markdownNarrative).toBeUndefined();
});
