import { expect, test } from "bun:test";
import { SESSION_MODE_UI, sessionModeUi } from "../src/shared/session-mode-ui";

test("SESSION_MODE_UI defines agent, plan, and ask copy", () => {
  expect(SESSION_MODE_UI.map((entry) => entry.value)).toEqual(["agent", "plan", "ask"]);
  expect(sessionModeUi("agent").title).toBe("Agent");
  expect(sessionModeUi("plan").title).toBe("Plan");
  expect(sessionModeUi("ask").title).toBe("Ask");
});
