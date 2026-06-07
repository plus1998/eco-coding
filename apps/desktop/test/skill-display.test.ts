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

test("replaces generic Skill action with detailed skill action", () => {
  const blocks = buildActivityLogBlocks(
    [
      { id: "u1", role: "user", message: "use skill" },
      { id: "1", role: "planner", message: "Tool: Skill" },
      { id: "2", role: "planner", message: "Tool: Skill · frontend-design 技能" },
    ],
    { status: "running", createdAt: new Date().toISOString() },
  );

  const session = blocks.find((block) => block.kind === "work-session");
  expect(session?.kind).toBe("work-session");
  if (session?.kind !== "work-session") {
    return;
  }
  const actions = session.children.filter((child) => child.kind === "action");
  expect(actions).toHaveLength(1);
  expect(actions[0]?.kind).toBe("action");
  if (actions[0]?.kind === "action") {
    expect(actions[0].label).toBe("读取 · frontend-design 技能");
  }
});
