import { expect, test } from "bun:test";
import { createSubagentHandoffService } from "../src/main/subagent-handoff-service";

test("buildHandoffPrompt uses activity for agent and falls back without routes", async () => {
  const service = createSubagentHandoffService({
    listActivityLines: () => [
      { id: "1", role: "explore", message: "Older finding about auth middleware", agentId: "agent-1" },
      { id: "2", role: "explore", message: "Recent tail output", agentId: "agent-1" },
      { id: "3", role: "explore", message: "Other agent", agentId: "agent-2" },
    ],
    resolveProxyRoutes: () => undefined,
  });

  const prompt = await service.buildHandoffPrompt({
    threadId: "thr_1",
    agentId: "agent-1",
    role: "explore",
    originalPrompt: "Map auth flow",
  });

  expect(prompt).toContain("Map auth flow");
  expect(prompt).toContain("Recent tail output");
  expect(prompt).toContain("agent-1");
  expect(prompt).not.toContain("Other agent");
});
