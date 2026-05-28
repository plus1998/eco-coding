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
