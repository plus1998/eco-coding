import { expect, test } from "bun:test";
import { SubagentConcurrencyGate } from "../src/main/subagent-concurrency-gate";

test("SubagentConcurrencyGate counts active and pending launches against the concurrency limit", () => {
  let active = 4;
  const gate = new SubagentConcurrencyGate({
    maxConcurrentSubagents: 5,
    readActiveSubagentCount: () => active,
  });

  expect(gate.tryReserveLaunch({ toolUseId: "tool_a", role: "coder" })).toEqual({ ok: true });
  const blocked = gate.tryReserveLaunch({ toolUseId: "tool_b", role: "tester" });
  expect(blocked.ok).toBe(false);
  if (!blocked.ok) {
    expect(blocked.reason).toContain("5/5 subagents active or launching");
    expect(blocked.reason).not.toContain("wait for existing subagents to finish");
  }

  active = 5;
  gate.releaseLaunch({ toolUseId: "tool_a", agentId: "agent_a", role: "coder" });
  const stillBlocked = gate.tryReserveLaunch({ toolUseId: "tool_c", role: "reviewer" });
  expect(stillBlocked.ok).toBe(false);

  active = 4;
  expect(gate.tryReserveLaunch({ toolUseId: "tool_c", role: "reviewer" })).toEqual({ ok: true });
});

test("SubagentConcurrencyGate expires abandoned pending launches", () => {
  let now = 1_000;
  const gate = new SubagentConcurrencyGate({
    maxConcurrentSubagents: 1,
    pendingTtlMs: 1_000,
    readActiveSubagentCount: () => 0,
    now: () => now,
  });

  expect(gate.tryReserveLaunch({ toolUseId: "tool_a" })).toEqual({ ok: true });
  expect(gate.tryReserveLaunch({ toolUseId: "tool_b" }).ok).toBe(false);

  now = 2_001;
  expect(gate.tryReserveLaunch({ toolUseId: "tool_b" })).toEqual({ ok: true });
});
