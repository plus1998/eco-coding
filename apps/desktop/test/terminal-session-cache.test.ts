import { afterEach, expect, test } from "bun:test";
import {
  deleteTerminalSessionId,
  getTerminalSessionId,
  listTerminalSessionsForProject,
  setTerminalSessionId,
} from "../src/renderer/terminal-session-cache";

const workspaceA = "/tmp/project-a";
const workspaceB = "/tmp/project-b";

afterEach(() => {
  deleteTerminalSessionId(workspaceA, "tab-a");
  deleteTerminalSessionId(workspaceB, "tab-b");
});

test("keeps terminal sessions per workspace and tab", () => {
  setTerminalSessionId(workspaceA, "tab-a", "session-a");
  setTerminalSessionId(workspaceB, "tab-b", "session-b");

  expect(getTerminalSessionId(workspaceA, "tab-a")).toBe("session-a");
  expect(getTerminalSessionId(workspaceB, "tab-b")).toBe("session-b");
  expect(listTerminalSessionsForProject(workspaceA, ["tab-a", "missing"])).toEqual({
    "tab-a": "session-a",
  });
});

test("deleteTerminalSessionId removes only the targeted tab session", () => {
  setTerminalSessionId(workspaceA, "tab-a", "session-a");
  setTerminalSessionId(workspaceA, "tab-b", "session-b");

  expect(deleteTerminalSessionId(workspaceA, "tab-a")).toBe("session-a");
  expect(getTerminalSessionId(workspaceA, "tab-a")).toBeUndefined();
  expect(getTerminalSessionId(workspaceA, "tab-b")).toBe("session-b");
});
