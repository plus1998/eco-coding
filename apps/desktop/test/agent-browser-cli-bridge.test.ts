import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  mapAgentBrowserToolToCliArgs,
  resolveAgentBrowserTabIndex,
  resolveAgentBrowserTabSwitchArg,
  shouldRouteAgentBrowserToolsViaCli,
} from "../src/main/agent-browser-cli-bridge";

test("shouldRouteAgentBrowserToolsViaCli defaults to CLI on all platforms", () => {
  expect(shouldRouteAgentBrowserToolsViaCli()).toBe(true);
});

test("mapAgentBrowserToolToCliArgs covers core browser tools", () => {
  expect(mapAgentBrowserToolToCliArgs("agent_browser_open", { url: "https://example.com" })).toEqual([
    "open",
    "https://example.com",
  ]);
  expect(mapAgentBrowserToolToCliArgs("agent_browser_click", { ref: "@e2" })).toEqual(["click", "@e2"]);
  expect(mapAgentBrowserToolToCliArgs("agent_browser_snapshot", { interactive: true })).toEqual([
    "snapshot",
    "--interactive",
  ]);
  expect(mapAgentBrowserToolToCliArgs("agent_browser_scroll", { direction: "down", amount: 400 })).toEqual([
    "scroll",
    "down",
    "400",
  ]);
  expect(mapAgentBrowserToolToCliArgs("agent_browser_eval", { script: "1+1" })).toEqual(["eval", "1+1"]);
  expect(mapAgentBrowserToolToCliArgs("agent_browser_tab_list", {})).toEqual(["tab", "list"]);
});

test("resolveAgentBrowserTabSwitchArg maps to agent-browser tab syntax", () => {
  expect(resolveAgentBrowserTabSwitchArg({ tabId: "t1" })).toBe("t1");
  expect(resolveAgentBrowserTabSwitchArg({ label: "Example Domain" })).toBe("Example Domain");
  expect(resolveAgentBrowserTabSwitchArg({ index: 0 })).toBe("t1");
  expect(resolveAgentBrowserTabSwitchArg({ index: 1 })).toBe("t2");
  expect(mapAgentBrowserToolToCliArgs("agent_browser_tab_switch", { tabId: "t2" })).toEqual(["tab", "t2"]);
  expect(mapAgentBrowserToolToCliArgs("agent_browser_tab_switch", { index: 0 })).toEqual(["tab", "t1"]);
});

test("resolveAgentBrowserTabIndex maps tN to zero-based index", () => {
  expect(resolveAgentBrowserTabIndex({ tabId: "t1" }, 2)).toBe(0);
  expect(resolveAgentBrowserTabIndex({ tabId: "t2" }, 2)).toBe(1);
  expect(() => resolveAgentBrowserTabIndex({ tabId: "t6" }, 2)).toThrow(/not found/);
});

test("mapAgentBrowserToolToCliArgs screenshot always includes output path", () => {
  const args = mapAgentBrowserToolToCliArgs("agent_browser_screenshot", {});
  expect(args[0]).toBe("screenshot");
  expect(args[1]).toMatch(/eco-browser-screenshot-\d+\.png$/);
});

test("callAgentBrowserToolViaCli uses async spawn (does not block main process)", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../src/main/agent-browser-cli-bridge.ts", import.meta.url)),
    "utf8",
  );
  expect(source).toContain("export async function callAgentBrowserToolViaCli");
  expect(source).toContain("spawn(");
  expect(source).not.toContain("spawnSync");
});

test("mapAgentBrowserToolToCliArgs forwards extraArgs", () => {
  expect(
    mapAgentBrowserToolToCliArgs("agent_browser_open", {
      url: "https://example.com",
      extraArgs: ["--json"],
    }),
  ).toEqual(["open", "https://example.com", "--json"]);
});
