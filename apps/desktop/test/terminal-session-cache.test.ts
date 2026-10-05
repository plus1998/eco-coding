import { afterEach, expect, test } from "bun:test";
import {
  deleteTerminalSessionId,
  getTerminalSessionId,
  hasTerminalSessionsForProject,
  listTerminalSessionEntriesForProject,
  listTerminalSessionsForProject,
  replaceTerminalSessionsForProject,
  setTerminalSessionId,
} from "../src/renderer/terminal-session-cache";

const workspaceA = "/tmp/project-a";
const workspaceB = "/tmp/project-b";

afterEach(() => {
  deleteTerminalSessionId(workspaceA, "tab-a");
  deleteTerminalSessionId(workspaceA, "tab-b");
  deleteTerminalSessionId(workspaceA, "tab-c");
  deleteTerminalSessionId(workspaceA, "tab-ssh");
  deleteTerminalSessionId(workspaceB, "tab-b");
});

test("keeps terminal sessions per workspace and tab", () => {
  setTerminalSessionId(workspaceA, "tab-a", "session-a");
  setTerminalSessionId(workspaceB, "tab-b", "session-b");

  expect(getTerminalSessionId(workspaceA, "tab-a")).toBe("session-a");
  expect(getTerminalSessionId(workspaceB, "tab-b")).toBe("session-b");
  expect(hasTerminalSessionsForProject(workspaceA)).toBe(true);
  expect(listTerminalSessionsForProject(workspaceA, ["tab-a", "missing"])).toEqual({
    "tab-a": "session-a",
  });
  expect(listTerminalSessionEntriesForProject(workspaceA)).toEqual([
    { tabId: "tab-a", sessionId: "session-a", kind: "local" },
  ]);
});

test("keeps the SSH tab identity alongside the session", () => {
  setTerminalSessionId(workspaceA, "tab-ssh", "session-ssh", {
    kind: "ssh",
    label: "Prod",
    endpoint: "root@prod.example.com",
  });

  expect(listTerminalSessionEntriesForProject(workspaceA)).toEqual([
    {
      tabId: "tab-ssh",
      sessionId: "session-ssh",
      kind: "ssh",
      label: "Prod",
      endpoint: "root@prod.example.com",
    },
  ]);
});

test("deleteTerminalSessionId removes only the targeted tab session", () => {
  setTerminalSessionId(workspaceA, "tab-a", "session-a");
  setTerminalSessionId(workspaceA, "tab-b", "session-b");

  expect(deleteTerminalSessionId(workspaceA, "tab-a")).toBe("session-a");
  expect(getTerminalSessionId(workspaceA, "tab-a")).toBeUndefined();
  expect(getTerminalSessionId(workspaceA, "tab-b")).toBe("session-b");
});

test("replaceTerminalSessionsForProject swaps one project's session map", () => {
  setTerminalSessionId(workspaceA, "tab-a", "session-a");
  setTerminalSessionId(workspaceB, "tab-b", "session-b");

  replaceTerminalSessionsForProject(workspaceA, [{ tabId: "tab-c", sessionId: "session-c", kind: "local" }]);

  expect(getTerminalSessionId(workspaceA, "tab-a")).toBeUndefined();
  expect(getTerminalSessionId(workspaceA, "tab-c")).toBe("session-c");
  expect(getTerminalSessionId(workspaceB, "tab-b")).toBe("session-b");

  replaceTerminalSessionsForProject(workspaceA, []);
  expect(hasTerminalSessionsForProject(workspaceA)).toBe(false);
});
