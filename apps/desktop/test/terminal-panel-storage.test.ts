import { afterEach, beforeEach, expect, test } from "bun:test";
import { i18n } from "../src/renderer/i18n";
import {
  createProjectTerminalState,
  createTerminalTab,
  nextTerminalTabLabel,
  type ProjectTerminalState,
  readTerminalWorkspaceState,
  resolveTerminalTabForInjectedSession,
  saveTerminalWorkspaceState,
} from "../src/renderer/terminal-panel-storage";

const storage = new Map<string, string>();

beforeEach(async () => {
  await i18n.changeLanguage("en-US");
  storage.clear();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    },
  });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "localStorage");
});

test("stores terminal state per workspace", () => {
  const workspaceA = "/tmp/project-a";
  const workspaceB = "/tmp/project-b";
  const stateA = createProjectTerminalState("project-a", true);
  const stateB = createProjectTerminalState("project-b", true);

  saveTerminalWorkspaceState({
    [workspaceA]: stateA,
    [workspaceB]: { ...stateB, open: false },
  });

  const restored = readTerminalWorkspaceState();
  expect(restored[workspaceA]?.open).toBe(true);
  expect(restored[workspaceB]?.open).toBe(false);
  expect(restored[workspaceA]?.tabs).toHaveLength(1);
});

test("creates unique tab labels within a project", () => {
  const tabs = [createTerminalTab("fadanjiance")];
  expect(nextTerminalTabLabel("fadanjiance", tabs)).toBe("fadanjiance 2");
  tabs.push(createTerminalTab("fadanjiance 2"));
  expect(nextTerminalTabLabel("fadanjiance", tabs)).toBe("fadanjiance 3");
});

test("injected sessions reuse idle tabs and never steal a live session", () => {
  const occupied = createTerminalTab("eco");
  const idle = createTerminalTab("eco 2");
  const base: ProjectTerminalState = {
    open: true,
    height: 280,
    tabs: [occupied, idle],
    activeTabId: occupied.id,
  };

  const reusedIdle = resolveTerminalTabForInjectedSession({
    state: base,
    workspaceLabel: "eco",
    sessionId: "session-script",
    sessionByTabId: { [occupied.id]: "session-dev" },
  });
  expect(reusedIdle.tabId).toBe(idle.id);
  expect(reusedIdle.state.tabs).toHaveLength(2);
  expect(reusedIdle.state.activeTabId).toBe(idle.id);

  const created = resolveTerminalTabForInjectedSession({
    state: { ...base, tabs: [occupied], activeTabId: occupied.id },
    workspaceLabel: "eco",
    sessionId: "session-script",
    sessionByTabId: { [occupied.id]: "session-dev" },
  });
  expect(created.tabId).not.toBe(occupied.id);
  expect(created.state.tabs).toHaveLength(2);
  expect(created.state.activeTabId).toBe(created.tabId);

  const alreadyBound = resolveTerminalTabForInjectedSession({
    state: base,
    workspaceLabel: "eco",
    sessionId: "session-dev",
    sessionByTabId: { [occupied.id]: "session-dev" },
  });
  expect(alreadyBound.tabId).toBe(occupied.id);
  expect(alreadyBound.state.tabs).toHaveLength(2);
});

test("uses the active locale for empty and restored terminal labels", () => {
  expect(createTerminalTab(" ").label).toBe("Terminal");
  expect(nextTerminalTabLabel("", [])).toBe("Terminal");

  storage.set(
    "eco.terminal",
    JSON.stringify({
      projects: {
        "/tmp/project": {
          open: true,
          height: 280,
          tabs: [{ id: "tab-1", label: "" }],
          activeTabId: "tab-1",
        },
      },
    }),
  );
  expect(readTerminalWorkspaceState()["/tmp/project"]?.tabs[0]?.label).toBe("Terminal");
});
