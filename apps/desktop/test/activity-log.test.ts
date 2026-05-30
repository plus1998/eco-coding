import { expect, test } from "bun:test";
import { formatSubagentMissionMessage } from "@eco/runtime";
import { buildActivityLogBlocks } from "../src/renderer/activity-log";

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
  const session = blocks.find((block) => block.kind === "work-session");
  expect(session?.kind).toBe("work-session");
  if (session?.kind !== "work-session") {
    return;
  }
  expect(session.defaultCollapsed).toBe(true);
  expect(session.children.some((child) => child.kind === "action" && child.label.includes("styles.css"))).toBe(
    true,
  );
  const summary = blocks.find((block) => block.kind === "assistant-message");
  expect(summary?.kind).toBe("assistant-message");
  if (summary?.kind === "assistant-message") {
    expect(summary.text).toContain("final plan summary");
  }
});

test("keeps work session expanded while running", () => {
  const blocks = buildActivityLogBlocks(
    [
      { id: "u1", role: "user", message: "Go" },
      { id: "1", role: "coder", message: "Checking package.json", stream: true },
    ],
    { status: "running", createdAt: new Date().toISOString() },
  );

  const session = blocks.find((block) => block.kind === "work-session");
  expect(session?.kind).toBe("work-session");
  if (session?.kind !== "work-session") {
    return;
  }
  expect(session.running).toBe(true);
  expect(session.defaultCollapsed).toBe(false);
});

test("keeps thinking separate from agent narrative streams", () => {
  const blocks = buildActivityLogBlocks(
    [
      { id: "u1", role: "user", message: "test" },
      { id: "1", role: "thinking", message: "Let me also", stream: true },
      { id: "2", role: "coder", message: "check the index.html", stream: true },
      { id: "3", role: "coder", message: " to", stream: true },
      { id: "4", role: "coder", message: "understand", stream: true },
      { id: "5", role: "coder", message: "the", stream: true },
      { id: "6", role: "coder", message: " build", stream: true },
      { id: "7", role: "coder", message: "setup.", stream: true },
    ],
    { status: "running", createdAt: new Date().toISOString() },
  );

  const session = blocks.find((block) => block.kind === "work-session");
  expect(session?.kind).toBe("work-session");
  if (session?.kind !== "work-session") {
    return;
  }
  const thinking = session.children.find((child) => child.kind === "thinking");
  const narrative = session.children.find((child) => child.kind === "narrative");
  expect(thinking?.kind).toBe("thinking");
  if (thinking?.kind === "thinking") {
    expect(thinking.text).toBe("Let me also");
    expect(thinking.streaming).toBe(true);
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
  const blocks = buildActivityLogBlocks(
    [
      { id: "u1", role: "user", message: "run" },
      { id: "1", role: "planner", message: "【3/3】执行" },
      {
        id: "2",
        role: "tool",
        message: "Tool: Agent · 编码 (coder)",
      },
      { id: "3", role: "coder", message: "Checking package.json", stream: true },
    ],
    { status: "running", createdAt: new Date().toISOString() },
  );

  const session = blocks.find((block) => block.kind === "work-session");
  expect(session?.kind).toBe("work-session");
  if (session?.kind === "work-session") {
    expect(session.activeSubagent).toBe("coder");
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

  const session = blocks.find((block) => block.kind === "work-session");
  expect(session?.kind).toBe("work-session");
  if (session?.kind !== "work-session") {
    return;
  }
  const actions = session.children.filter((child) => child.kind === "action");
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
