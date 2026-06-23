import { expect, test } from "bun:test";
import { ThreadLiveRequestRegistry } from "../src/main/thread-live-request-registry";

test("ThreadLiveRequestRegistry resolves by agentId only when agentId is provided", () => {
  const registry = new ThreadLiveRequestRegistry();
  const requestA = registry.beginRequest("thr_1", { role: "coder", agentId: "agent_a" });
  registry.beginRequest("thr_1", { role: "coder", agentId: "agent_b" });

  expect(registry.resolve("thr_1", { role: "coder", agentId: "agent_a" })).toBe(requestA);
  expect(registry.resolve("thr_1", { role: "coder", agentId: "agent_b" })).toMatch(/^req_/);
  expect(registry.resolve("thr_1", { role: "coder", agentId: "agent_missing" })).toBeUndefined();
});

test("ThreadLiveRequestRegistry does not resolve same-role subagents by role alone", () => {
  const registry = new ThreadLiveRequestRegistry();
  registry.beginRequest("thr_1", { role: "coder", agentId: "agent_a" });
  registry.beginRequest("thr_1", { role: "coder", agentId: "agent_b" });

  expect(registry.resolve("thr_1", { role: "coder" })).toBeUndefined();
});

test("ThreadLiveRequestRegistry does not fall back to the last active request", () => {
  const registry = new ThreadLiveRequestRegistry();
  registry.beginRequest("thr_1", { role: "coder", agentId: "agent_a" });
  const lastRequestId = registry.beginRequest("thr_1", { role: "reviewer", agentId: "agent_b" });

  expect(registry.resolve("thr_1", { role: "explorer" })).toBeUndefined();
  expect(registry.resolve("thr_1", {})).toBeUndefined();
  expect(registry.resolve("thr_1", { role: "coder" })).toBeUndefined();
  expect(lastRequestId).toMatch(/^req_/);
});

test("ThreadLiveRequestRegistry resolves main-thread role scope without agentId", () => {
  const registry = new ThreadLiveRequestRegistry();
  registry.beginRequest("thr_1", { role: "planner" });
  registry.beginRequest("thr_1", { role: "coder", agentId: "agent_a" });

  expect(registry.resolve("thr_1", { role: "planner" })).toMatch(/^req_/);
  expect(registry.resolve("thr_1", { role: "coder" })).toBeUndefined();
});

test("ThreadLiveRequestRegistry adopts provider request id for the active scope", () => {
  const registry = new ThreadLiveRequestRegistry();
  const localRequestId = registry.beginRequest("thr_1", { role: "planner" });
  const adopted = registry.adoptProviderRequestId("thr_1", { role: "planner" }, "msgreq_provider_123");

  expect(adopted.requestId).toBe("msgreq_provider_123");
  expect(adopted.replacedRequestId).toBe(localRequestId);
  expect(registry.resolve("thr_1", { role: "planner" })).toBe("msgreq_provider_123");
});

test("ThreadLiveRequestRegistry clears ended requests", () => {
  const registry = new ThreadLiveRequestRegistry();
  const requestId = registry.beginRequest("thr_1", { role: "coder", agentId: "agent_a" });
  registry.endRequest("thr_1", requestId);
  expect(registry.resolve("thr_1", { role: "coder", agentId: "agent_a" })).toBeUndefined();
});

test("ThreadLiveRequestRegistry keeps role-only and agent-scoped coder requests separate", () => {
  const registry = new ThreadLiveRequestRegistry();
  const subagentRequestId = registry.beginRequest("thr_1", {
    role: "coder",
    agentId: "agent_a",
  });

  const unattributedRequestId = registry.beginRequest("thr_1", { role: "coder" });

  expect(registry.resolve("thr_1", { role: "coder", agentId: "agent_a" })).toBe(subagentRequestId);
  expect(registry.resolve("thr_1", { role: "coder" })).toBe(unattributedRequestId);
});

test("ThreadLiveRequestRegistry does not adopt provider id across mismatched attribution scope", () => {
  const registry = new ThreadLiveRequestRegistry();
  const subagentRequestId = registry.beginRequest("thr_1", {
    role: "coder",
    agentId: "agent_a",
  });

  const adopted = registry.adoptProviderRequestId("thr_1", { role: "coder" }, "msgreq_unattributed");

  expect(adopted.requestId).toBe("msgreq_unattributed");
  expect(adopted.replacedRequestId).toBeUndefined();
  expect(registry.resolve("thr_1", { role: "coder", agentId: "agent_a" })).toBe(subagentRequestId);
  expect(registry.resolve("thr_1", { role: "coder" })).toBe("msgreq_unattributed");
});
