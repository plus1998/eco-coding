import { expect, test } from "bun:test";
import type { UsageBillingObservation } from "../src/main/billing-orchestration";
import {
  appendUsageBillingObservation,
  usageBillingObservationKey,
} from "../src/main/usage-billing-observations";

function observation(overrides: Partial<UsageBillingObservation> = {}): UsageBillingObservation {
  return {
    source: "sdk",
    role: "coder",
    agentId: "agent_coder",
    requestKey: "req_1",
    modelId: "haiku",
    usage: {
      inputTokens: 1_000,
      outputTokens: 100,
      cacheReadTokens: 10,
      cacheCreationTokens: 20,
    },
    ...overrides,
  };
}

function unattributedObservation(): UsageBillingObservation {
  const { agentId: _agentId, ...rest } = observation();
  return rest;
}

test("appendUsageBillingObservation dedupes identical observations", () => {
  const observations: UsageBillingObservation[] = [];

  expect(appendUsageBillingObservation(observations, observation())).toBe(true);
  expect(appendUsageBillingObservation(observations, observation())).toBe(false);

  expect(observations).toHaveLength(1);
});

test("usageBillingObservationKey separates agent request model and token totals", () => {
  const base = observation();

  expect(usageBillingObservationKey(base)).not.toBe(
    usageBillingObservationKey(observation({ agentId: "agent_other" })),
  );
  expect(usageBillingObservationKey(base)).not.toBe(
    usageBillingObservationKey(observation({ requestKey: "req_2" })),
  );
  expect(usageBillingObservationKey(base)).not.toBe(
    usageBillingObservationKey(observation({ modelId: "sonnet" })),
  );
  expect(usageBillingObservationKey(base)).not.toBe(
    usageBillingObservationKey(
      observation({
        usage: {
          inputTokens: 1_001,
          outputTokens: 100,
          cacheReadTokens: 10,
          cacheCreationTokens: 20,
        },
      }),
    ),
  );
});

test("appendUsageBillingObservation keeps unattributed observations distinct from attributed ones", () => {
  const observations: UsageBillingObservation[] = [];

  expect(appendUsageBillingObservation(observations, unattributedObservation())).toBe(true);
  expect(appendUsageBillingObservation(observations, observation({ agentId: "agent_coder" }))).toBe(true);

  expect(observations).toHaveLength(2);
});
