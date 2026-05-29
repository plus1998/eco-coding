import { expect, test } from "bun:test";
import { buildActivityLogBlocks } from "../src/renderer/activity-log";

test("groups narrative and compact tool summaries", () => {
  const blocks = buildActivityLogBlocks(
    [
      { id: "1", role: "planner", message: "Let me check `react-quill` compatibility first." },
      { id: "2", role: "tool", message: "Tool: Read · styles.css" },
      { id: "3", role: "tool", message: "Tool: Read · package.json" },
      { id: "4", role: "tool", message: "Tool: Grep · react-quill" },
      { id: "5", role: "tool", message: "Tool: Edit · package.json" },
      { id: "6", role: "tool", message: "Tool: Bash · bun install" },
    ],
    { status: "completed", createdAt: new Date(Date.now() - 394_000).toISOString() },
  );

  expect(blocks.some((block) => block.kind === "progress" && block.label.includes("已处理"))).toBe(true);
  expect(blocks.some((block) => block.kind === "narrative")).toBe(true);
  expect(blocks.some((block) => block.kind === "action" && block.label.includes("已探索 2 个文件"))).toBe(
    true,
  );
  expect(blocks.some((block) => block.kind === "action" && block.label.includes("已编辑 1 个文件"))).toBe(
    true,
  );
  expect(blocks.some((block) => block.kind === "action" && block.label.includes("已运行 bun install"))).toBe(
    true,
  );
});

test("merges stream segments across roles without losing spaces", () => {
  const blocks = buildActivityLogBlocks(
    [
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

  const narrative = blocks.find((block) => block.kind === "narrative");
  expect(narrative?.kind).toBe("narrative");
  if (narrative?.kind !== "narrative") {
    return;
  }
  expect(narrative.text).toBe("Let me also check the index.html to understand the build setup.");
});

test("shows active subagent while running", () => {
  const blocks = buildActivityLogBlocks(
    [
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

  const progress = blocks.find((block) => block.kind === "progress");
  expect(progress?.label).toContain("编码");
  expect(progress?.activeSubagent).toBe("coder");
});

test("deduplicates repeated narrative separated by tool exploration", () => {
  const blocks = buildActivityLogBlocks(
    [
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

  const narratives = blocks.filter((block) => block.kind === "narrative");
  const actions = blocks.filter((block) => block.kind === "action");
  expect(narratives).toHaveLength(1);
  expect(actions).toHaveLength(1);
});
