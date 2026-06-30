import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  createProjectTerminalState,
  createTerminalTab,
  nextTerminalTabLabel,
  readTerminalWorkspaceState,
  saveTerminalWorkspaceState,
} from "../src/renderer/terminal-panel-storage";

const storage = new Map<string, string>();

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
