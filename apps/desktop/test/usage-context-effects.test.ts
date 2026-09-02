import { expect, test } from "bun:test";
import type { ParsedUsage } from "@eco/runtime";
import type { UsageBillingContextUpdate } from "../src/main/usage-billing-artifacts";
import {
  applyUsageContextUpdate,
  buildUsageContextUpdateOptions,
  createUsageContextService,
  type UsageContextMonitor,
  type UsageContextUpdateMonitor,
} from "../src/main/usage-context-effects";

function usage(inputTokens = 1_000): ParsedUsage {
  return { inputTokens, outputTokens: 100, cacheReadTokens: 0, cacheCreationTokens: 0 };
}

const contextUpdate: UsageBillingContextUpdate = {
  role: "coder",
  modelId: "haiku",
  providerBaseUrl: "https://api.example.test",
};

test("buildUsageContextUpdateOptions includes attribution and routing fields", () => {
  expect(
    buildUsageContextUpdateOptions(contextUpdate, {
      agentId: "agent_coder",
      messageId: "msg_1",
    }),
  ).toEqual({
    role: "coder",
    agentId: "agent_coder",
    modelId: "haiku",
    providerBaseUrl: "https://api.example.test",
    messageId: "msg_1",
  });
});

test("applyUsageContextUpdate forwards usage to the context monitor", async () => {
  const calls: Array<{ threadId: string; usage: ParsedUsage; options: unknown }> = [];
  const monitor: UsageContextUpdateMonitor = {
    async updateFromUsage(threadId, nextUsage, options) {
      calls.push({ threadId, usage: nextUsage, options });
      return undefined as Awaited<ReturnType<UsageContextUpdateMonitor["updateFromUsage"]>>;
    },
    async updateOccupied() {
      return undefined as Awaited<ReturnType<UsageContextUpdateMonitor["updateOccupied"]>>;
    },
  };

  const updated = await applyUsageContextUpdate(monitor, {
    threadId: "thr_context",
    usage: usage(),
    contextUpdate,
    agentId: "agent_coder",
  });

  expect(updated).toBe(true);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({
    threadId: "thr_context",
    options: {
      role: "coder",
      agentId: "agent_coder",
      modelId: "haiku",
    },
  });
});

test("applyUsageContextUpdate skips missing or disabled context updates", async () => {
  const calls: unknown[] = [];
  const monitor: UsageContextUpdateMonitor = {
    async updateFromUsage() {
      calls.push({});
      return undefined as Awaited<ReturnType<UsageContextUpdateMonitor["updateFromUsage"]>>;
    },
    async updateOccupied() {
      return undefined as Awaited<ReturnType<UsageContextUpdateMonitor["updateOccupied"]>>;
    },
  };

  expect(
    await applyUsageContextUpdate(monitor, {
      threadId: "thr_context_skip",
      usage: usage(),
      contextUpdate,
      updateContext: false,
    }),
  ).toBe(false);
  expect(
    await applyUsageContextUpdate(monitor, {
      threadId: "thr_context_skip",
      usage: usage(),
    }),
  ).toBe(false);
  expect(calls).toHaveLength(0);
});

test("createUsageContextService exposes update snapshot and live emit as one boundary", async () => {
  const updates: Array<{ threadId: string; usage: ParsedUsage; options: unknown }> = [];
  const snapshots: string[] = [];
  const live: string[] = [];
  const monitor: UsageContextMonitor = {
    async updateFromUsage(threadId, nextUsage, options) {
      updates.push({ threadId, usage: nextUsage, options });
      return undefined as Awaited<ReturnType<UsageContextMonitor["updateFromUsage"]>>;
    },
    async updateOccupied() {
      return undefined as Awaited<ReturnType<UsageContextMonitor["updateOccupied"]>>;
    },
    getSnapshot(threadId) {
      snapshots.push(threadId);
      return undefined;
    },
  };
  const service = createUsageContextService({
    monitor,
    emitLiveContext: (threadId) => live.push(threadId),
  });

  expect(
    await service.applyUpdate({
      threadId: "thr_context_service",
      usage: usage(),
      contextUpdate,
    }),
  ).toBe(true);
  expect(service.getSnapshot("thr_context_service")).toBeUndefined();
  service.emitLive("thr_context_service");

  expect(updates).toHaveLength(1);
  expect(snapshots).toEqual(["thr_context_service"]);
  expect(live).toEqual(["thr_context_service"]);
});
