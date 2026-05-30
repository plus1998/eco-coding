import { expect, test } from "bun:test";
import { buildActivityLogBlocks } from "../src/renderer/activity-log";

test("shows skill read action in work session", () => {
  const blocks = buildActivityLogBlocks(
    [
      { id: "u1", role: "user", message: "use skill" },
      { id: "1", role: "planner", message: "Tool: Skill · pdf 技能" },
    ],
    { status: "running", createdAt: new Date().toISOString() },
  );

  const session = blocks.find((block) => block.kind === "work-session");
  expect(session?.kind).toBe("work-session");
  if (session?.kind !== "work-session") {
    return;
  }
  const action = session.children.find((child) => child.kind === "action");
  expect(action?.kind).toBe("action");
  if (action?.kind === "action") {
    expect(action.label).toBe("读取 · pdf 技能");
  }
});
