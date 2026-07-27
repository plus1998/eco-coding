import { expect, test } from "bun:test";
import { buildPromptCacheFingerprint } from "../src/main/prompt-cache-fingerprint";
import { ThreadPromptCacheMonitor } from "../src/main/thread-prompt-cache-monitor";

function fingerprint(
  orchestrationKey: string,
  mcp: string[],
  digest = "digest-a",
  mainAgentModelKey = '["p1","m1","high"]',
) {
  return buildPromptCacheFingerprint({
    orchestrationKey,
    mainAgentModelKey,
    mcpServerKeys: mcp,
    claudeMdDigest: digest,
  });
}

test("ThreadPromptCacheMonitor sets baseline on first observe", () => {
  const monitor = new ThreadPromptCacheMonitor();
  expect(monitor.observe("t1", fingerprint("orchestration-a", ["github"]))).toEqual([]);
});

test("ThreadPromptCacheMonitor reports breaks only when fingerprint changes", () => {
  const monitor = new ThreadPromptCacheMonitor();
  monitor.observe("t1", fingerprint("orchestration-a", ["github"]));
  expect(monitor.observe("t1", fingerprint("orchestration-a", ["github"]))).toEqual([]);
  expect(monitor.observe("t1", fingerprint("orchestration-a", ["github", "mongo"]))).toEqual([
    "mcp_servers_changed",
  ]);
  expect(monitor.observe("t1", fingerprint("orchestration-a", ["github", "mongo"]))).toEqual([]);
  expect(
    monitor.observe(
      "t1",
      fingerprint("orchestration-a", ["github", "mongo"], "digest-a", '["p1","m1","xhigh"]'),
    ),
  ).toEqual(["main_agent_model_changed"]);
});

test("ThreadPromptCacheMonitor clearThread resets baseline", () => {
  const monitor = new ThreadPromptCacheMonitor();
  monitor.observe("t1", fingerprint("orchestration-a", ["github"]));
  monitor.clearThread("t1");
  expect(monitor.observe("t1", fingerprint("orchestration-b", ["mongo"]))).toEqual([]);
});
