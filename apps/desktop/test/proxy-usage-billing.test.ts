import { expect, test } from "bun:test";
import type { ParsedUsage } from "@eco/runtime";
import type { AgentRole } from "../src/shared/ipc";
import type { AnthropicProxyUsageInfo } from "../src/main/anthropic-proxy";
import {
  buildProxyUsageRequestKey,
  resolveProxyUsageBilling,
} from "../src/main/proxy-usage-billing";
import type { SubagentUsageAttributionResolver } from "../src/main/subagent-usage-attribution";

function proxyUsage(input: Partial<AnthropicProxyUsageInfo> = {}): AnthropicProxyUsageInfo {
  return {
    role: "coder",
    providerId: "anthropic",
    providerName: "Anthropic",
    providerBaseUrl: "https://api.anthropic.com",
    modelId: "haiku",
    requestId: "req_proxy_1",
    usage: parsedUsage(),
    ...input,
  };
}

function parsedUsage(input: Partial<ParsedUsage> = {}): ParsedUsage {
  return {
    inputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 3,
    cacheCreationTokens: 4,
    ...input,
  };
}

function resolver(
  input: {
    agentByRole?: Partial<Record<AgentRole, string>>;
    roleByAgent?: Record<string, AgentRole>;
  } = {},
): SubagentUsageAttributionResolver {
  return {
    resolveAgentId(_threadId, request) {
      if (request.subagentAgentId) {
        return request.subagentAgentId;
      }
      return input.agentByRole?.[request.role];
    },
    roleForAgentId(_threadId, agentId) {
      return input.roleByAgent?.[agentId];
    },
  };
}

test("buildProxyUsageRequestKey uses provider request id when available", () => {
  const key = buildProxyUsageRequestKey(proxyUsage(), 9);

  expect(key).toBe("proxy:coder:haiku:req_proxy_1:100:20:3:4");
});

test("buildProxyUsageRequestKey falls back to request sequence", () => {
  const { requestId: _requestId, ...info } = proxyUsage();
  const key = buildProxyUsageRequestKey(info, 2);

  expect(key).toBe("proxy:coder:haiku:2:100:20:3:4");
});

test("resolveProxyUsageBilling builds observation and billing input", () => {
  const resolved = resolveProxyUsageBilling({
    info: { ...proxyUsage(), threadId: "thr_proxy" },
    currentRequestSeq: 4,
    runAttemptId: "attempt_1",
    plannerAgentId: "planner_attempt_1",
    resolver: resolver({
      agentByRole: { coder: "agent_coder_1" },
      roleByAgent: { agent_coder_1: "coder" },
    }),
  });

  expect(resolved.nextRequestSeq).toBe(5);
  expect(resolved.contextRole).toBe("coder");
  expect(resolved.contextOccupied).toBe(107);
  expect(resolved.requestKey).toBe("proxy:coder:haiku:req_proxy_1:100:20:3:4");
  expect(resolved.billingRole).toBe("coder");
  expect(resolved.subagentAgentId).toBe("agent_coder_1");
  expect(resolved.observation).toMatchObject({
    source: "proxy",
    role: "coder",
    requestKey: "proxy:coder:haiku:req_proxy_1:100:20:3:4",
    modelId: "haiku",
    agentId: "agent_coder_1",
    usage: {
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 3,
      cacheCreationTokens: 4,
    },
  });
  expect(resolved.billingInput).toMatchObject({
    threadId: "thr_proxy",
    role: "coder",
    source: "proxy",
    inputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 3,
    cacheCreationTokens: 4,
    modelId: "haiku",
    requestKey: "proxy:coder:haiku:req_proxy_1:100:20:3:4",
    sourceEventId: "proxy:coder:haiku:req_proxy_1:100:20:3:4",
    providerRequestId: "req_proxy_1",
    runAttemptId: "attempt_1",
    plannerAgentId: "planner_attempt_1",
    reconciliationOnly: true,
    fillSdkPrimaryForSubagent: true,
    agentId: "agent_coder_1",
  });
});

test("resolveProxyUsageBilling keeps request key role stable when registry role differs", () => {
  const resolved = resolveProxyUsageBilling({
    info: { ...proxyUsage(), threadId: "thr_proxy" },
    resolver: resolver({
      agentByRole: { coder: "agent_reviewer_1" },
      roleByAgent: { agent_reviewer_1: "reviewer" },
    }),
  });

  expect(resolved.requestKey).toBe("proxy:coder:haiku:req_proxy_1:100:20:3:4");
  expect(resolved.billingRole).toBe("reviewer");
  expect(resolved.observation).toMatchObject({
    role: "reviewer",
    agentId: "agent_reviewer_1",
  });
  expect(resolved.billingInput).toMatchObject({
    role: "reviewer",
    fillSdkPrimaryForSubagent: true,
    agentId: "agent_reviewer_1",
  });
});

test("resolveProxyUsageBilling leaves planner proxy usage unattributed", () => {
  const resolved = resolveProxyUsageBilling({
    info: { ...proxyUsage({ role: "planner" }), threadId: "thr_proxy" },
    resolver: resolver({
      agentByRole: { planner: "planner_should_not_be_used" },
      roleByAgent: { planner_should_not_be_used: "planner" },
    }),
  });

  expect(resolved.billingRole).toBe("planner");
  expect(resolved.subagentAgentId).toBeUndefined();
  expect(resolved.observation.agentId).toBeUndefined();
  expect(resolved.billingInput).toMatchObject({
    role: "planner",
    reconciliationOnly: true,
    fillSdkPrimaryForSubagent: false,
  });
});
