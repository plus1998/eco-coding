import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  createProjectTerminalState,
  createTerminalTab,
  nextTerminalTabLabel,
  type ProjectTerminalState,
  readTerminalWorkspaceState,
  resolveTerminalTabForInjectedSession,
  saveTerminalWorkspaceState,
} from "../src/renderer/terminal-panel-storage";
import { withTestLanguage } from "./support/test-language";

const storage = new Map<string, string>();

withTestLanguage("en-US");

beforeEach(() => {
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

test("SSH tabs keep their kind and endpoint across a save/restore", () => {
  const sshTab = createTerminalTab("Prod", "ssh", "root@prod.example.com");
  const state: ProjectTerminalState = {
    open: true,
    height: 280,
    tabs: [sshTab, createTerminalTab("eco")],
    activeTabId: sshTab.id,
  };

  saveTerminalWorkspaceState({ "/tmp/project": state });

  const restored = readTerminalWorkspaceState()["/tmp/project"];
  expect(restored?.tabs[0]?.kind).toBe("ssh");
  expect(restored?.tabs[0]?.endpoint).toBe("root@prod.example.com");
  expect(restored?.tabs[1]?.kind).toBe("local");
  expect(restored?.tabs[1]?.endpoint).toBeUndefined();
});

test("an injected SSH session gets its own labelled tab instead of an idle one", () => {
  const shell = createTerminalTab("eco");
  const idle = createTerminalTab("eco 2");
  const base: ProjectTerminalState = {
    open: false,
    height: 280,
    tabs: [shell, idle],
    activeTabId: idle.id,
  };

  const assigned = resolveTerminalTabForInjectedSession({
    state: base,
    workspaceLabel: "eco",
    sessionId: "session-ssh",
    sessionByTabId: { [shell.id]: "session-shell" },
    kind: "ssh",
    label: "Prod",
    endpoint: "root@prod.example.com",
  });

  const sshTab = assigned.state.tabs.at(-1);
  expect(assigned.tabId).toBe(sshTab?.id);
  expect(assigned.state.open).toBe(true);
  expect(assigned.state.activeTabId).toBe(sshTab?.id);
  expect(sshTab?.label).toBe("Prod");
  expect(sshTab?.kind).toBe("ssh");
  expect(sshTab?.endpoint).toBe("root@prod.example.com");
  expect(assigned.state.tabs).toHaveLength(3);

  // A second connection to the same bookmark still stays tellable apart.
  const second = resolveTerminalTabForInjectedSession({
    state: assigned.state,
    workspaceLabel: "eco",
    sessionId: "session-ssh-2",
    sessionByTabId: {},
    kind: "ssh",
    label: "Prod",
    endpoint: "root@prod.example.com",
  });
  expect(second.state.tabs.at(-1)?.label).toBe("Prod 2");
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
