import { expect, test } from "bun:test";
import type { ParsedUsage } from "@eco/runtime";
import type {
  SdkAssistantSubagentBillingInput,
  SdkEventUsageBillingResolution,
  SdkRunUsageBillingInput,
  SdkStreamPartialUsageInput,
  SdkUsageBillingBundle,
} from "../src/main/sdk-event-usage-billing";
import {
  dispatchSdkEventUsageBilling,
  type SdkUsageBillingDispatchServices,
  type SdkUsageBillingLoggableResolution,
} from "../src/main/sdk-usage-billing-dispatch";

function usage(inputTokens = 100): ParsedUsage {
  return {
    inputTokens,
    outputTokens: 20,
    cacheReadTokens: 3,
    cacheCreationTokens: 4,
  };
}

function bundle(input: Partial<SdkUsageBillingBundle> = {}): SdkUsageBillingBundle {
  return {
    models: [{ modelId: "haiku", usage: usage() }],
    contextUsage: usage(900),
    totalCostUsd: 0.05,
    authoritative: true,
    ...input,
  };
}

function assistantInput(): SdkAssistantSubagentBillingInput {
  return {
    threadId: "thr_sdk",
    role: "coder",
    agentId: "agent_coder",
    source: "sdk",
    usage: usage(),
    messageId: "msg_1",
    requestKey: "sdk-assistant:msg_1",
  };
}

function streamInput(): SdkStreamPartialUsageInput {
  return {
    threadId: "thr_sdk",
    eventId: "evt_stream",
    role: "coder",
    usage: usage(40),
  };
}

function runInput(): SdkRunUsageBillingInput {
  return {
    threadId: "thr_sdk",
    role: "coder",
    requestKey: "sdk-result:evt_final",
    bundle: bundle(),
    usagePayload: {},
  };
}

function createServices(overrides: Partial<SdkUsageBillingDispatchServices> = {}): {
  services: SdkUsageBillingDispatchServices;
  tracked: Array<{ threadId: string; task: Promise<void> }>;
  assistantCalls: SdkAssistantSubagentBillingInput[];
  streamCalls: SdkStreamPartialUsageInput[];
  runCalls: SdkRunUsageBillingInput[];
  logs: SdkUsageBillingLoggableResolution[];
  errors: string[];
} {
  const tracked: Array<{ threadId: string; task: Promise<void> }> = [];
  const assistantCalls: SdkAssistantSubagentBillingInput[] = [];
  const streamCalls: SdkStreamPartialUsageInput[] = [];
  const runCalls: SdkRunUsageBillingInput[] = [];
  const logs: SdkUsageBillingLoggableResolution[] = [];
  const errors: string[] = [];
  const services: SdkUsageBillingDispatchServices = {
    trackUsageUpdate: (threadId, task) => tracked.push({ threadId, task }),
    processUsageBilling: async (input) => {
      assistantCalls.push(input);
    },
    processSdkStreamPartialUsage: async (input) => {
      streamCalls.push(input);
    },
    processSdkRunBilling: async (input) => {
      runCalls.push(input);
    },
    logResolution: (_threadId, resolved) => logs.push(resolved),
    writeError: (message) => errors.push(message),
    ...overrides,
  };
  return { services, tracked, assistantCalls, streamCalls, runCalls, logs, errors };
}

test("dispatchSdkEventUsageBilling ignores none and assistant_ignored resolutions", () => {
  const { services, tracked } = createServices();
  expect(
    dispatchSdkEventUsageBilling({
      threadId: "thr_sdk",
      resolved: { kind: "none" },
      services,
    }),
  ).toEqual({ dispatched: false, reason: "none" });
  expect(
    dispatchSdkEventUsageBilling({
      threadId: "thr_sdk",
      resolved: {
        kind: "assistant_ignored",
        bundle: bundle({ authoritative: false }),
        billingRole: "coder",
      },
      services,
    }),
  ).toEqual({ dispatched: false, reason: "assistant_ignored" });
  expect(tracked).toHaveLength(0);
});

test("dispatchSdkEventUsageBilling tracks assistant fallback billing without resolution logging", async () => {
  const { services, tracked, assistantCalls, logs } = createServices();
  const billingInput = assistantInput();
  const result = dispatchSdkEventUsageBilling({
    threadId: "thr_sdk",
    resolved: {
      kind: "assistant_subagent",
      bundle: bundle({ authoritative: false }),
      billingRole: "coder",
      subagentAgentId: "agent_coder",
      messageId: "msg_1",
      billingInput,
    },
    services,
  });

  expect(result).toEqual({ dispatched: true, kind: "assistant_subagent" });
  expect(tracked).toHaveLength(1);
  await tracked[0]?.task;
  expect(assistantCalls).toEqual([billingInput]);
  expect(logs).toHaveLength(0);
});

test("dispatchSdkEventUsageBilling tracks stream partial usage and logs resolution", async () => {
  const { services, tracked, streamCalls, logs } = createServices();
  const input = streamInput();
  const resolved: SdkEventUsageBillingResolution = {
    kind: "stream_partial",
    bundle: bundle(),
    billingRole: "coder",
    diagnostic: {
      throttleKey: "sdk-usage:thr_sdk:coder",
      role: "coder",
      stream: true,
      explicit: false,
    },
    streamInput: input,
  };

  expect(
    dispatchSdkEventUsageBilling({
      threadId: "thr_sdk",
      resolved,
      services,
    }),
  ).toEqual({ dispatched: true, kind: "stream_partial" });
  expect(tracked).toHaveLength(1);
  await tracked[0]?.task;
  expect(streamCalls).toEqual([input]);
  expect(logs).toEqual([resolved]);
});

test("dispatchSdkEventUsageBilling tracks sdk final usage and converts failures to audit errors", async () => {
  const errors: string[] = [];
  const failingRunCalls: SdkRunUsageBillingInput[] = [];
  const { services, tracked, logs } = createServices({
    processSdkRunBilling: async (input) => {
      failingRunCalls.push(input);
      throw new Error("settlement failed");
    },
    writeError: (message) => errors.push(message),
  });
  const input = runInput();
  const resolved: SdkEventUsageBillingResolution = {
    kind: "sdk_run",
    bundle: bundle(),
    billingRole: "coder",
    diagnostic: {
      throttleKey: "sdk-usage:thr_sdk:coder",
      role: "coder",
      stream: false,
      explicit: false,
    },
    runInput: input,
  };

  expect(
    dispatchSdkEventUsageBilling({
      threadId: "thr_sdk",
      resolved,
      services,
    }),
  ).toEqual({ dispatched: true, kind: "sdk_run" });
  expect(tracked).toHaveLength(1);
  await tracked[0]?.task;
  expect(failingRunCalls).toEqual([input]);
  expect(logs).toEqual([resolved]);
  expect(errors).toEqual(["[eco] SDK run billing failed: settlement failed\n"]);
});
