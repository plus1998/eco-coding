import { afterEach, expect, test } from "bun:test";
import {
  CLAUDE_CODE_ATTRIBUTION_HEADERS,
  ECO_PROXY_BILLING_HEADERS,
  ProxyBillingStampRegistry,
} from "../src/main/proxy-billing-stamp";
import {
  handleBridgeMessagesRequest,
  resolveExplicitBridgeRequestAgentId,
  resolveFrozenLiveRequestAttribution,
} from "../src/main/thread-live-request-coordinator";
import { ThreadLiveRequestRegistry } from "../src/main/thread-live-request-registry";
import { BUILTIN_VISION_AGENT_ROLE } from "../src/shared/prompt-image-vision";

afterEach(() => {
  // no global state
});

test("resolveExplicitBridgeRequestAgentId accepts matching request-scoped billing headers only", () => {
  const headers = new Headers({
    [ECO_PROXY_BILLING_HEADERS.agentId]: "vision:thr:abc",
    [ECO_PROXY_BILLING_HEADERS.billingRole]: BUILTIN_VISION_AGENT_ROLE,
  });
  expect(resolveExplicitBridgeRequestAgentId(BUILTIN_VISION_AGENT_ROLE, headers)).toBe("vision:thr:abc");
  expect(resolveExplicitBridgeRequestAgentId("coder", headers)).toBeUndefined();
});

test("resolveExplicitBridgeRequestAgentId accepts Claude instance header for any route role", () => {
  const headers = new Headers({
    [CLAUDE_CODE_ATTRIBUTION_HEADERS.agentId]: "agent_coder_instance_1",
  });
  expect(resolveExplicitBridgeRequestAgentId("coder", headers)).toBe("agent_coder_instance_1");
  expect(resolveExplicitBridgeRequestAgentId("explore", headers)).toBe("agent_coder_instance_1");
});

test("Eco Vision headers take priority over Claude agent-id header", () => {
  const headers = new Headers({
    [ECO_PROXY_BILLING_HEADERS.agentId]: "vision:thr:abc",
    [ECO_PROXY_BILLING_HEADERS.billingRole]: BUILTIN_VISION_AGENT_ROLE,
    [CLAUDE_CODE_ATTRIBUTION_HEADERS.agentId]: "agent_should_not_win",
  });
  expect(resolveExplicitBridgeRequestAgentId(BUILTIN_VISION_AGENT_ROLE, headers)).toBe("vision:thr:abc");
  // Mismatched Eco role rejects Eco stamp; Claude header still applies.
  expect(resolveExplicitBridgeRequestAgentId("coder", headers)).toBe("agent_should_not_win");
});

test("concurrent same-role Bridge requests stamp distinct Claude agent ids", () => {
  const registry = new ThreadLiveRequestRegistry();
  const threadId = "thr_concurrent_claude";
  const a = handleBridgeMessagesRequest(registry, {
    threadId,
    role: "coder",
    agentId: resolveExplicitBridgeRequestAgentId(
      "coder",
      new Headers({ [CLAUDE_CODE_ATTRIBUTION_HEADERS.agentId]: "agent_a" }),
    ),
    emitTimelineActivity: true,
  });
  const b = handleBridgeMessagesRequest(registry, {
    threadId,
    role: "coder",
    agentId: resolveExplicitBridgeRequestAgentId(
      "coder",
      new Headers({ [CLAUDE_CODE_ATTRIBUTION_HEADERS.agentId]: "agent_b" }),
    ),
    emitTimelineActivity: true,
  });
  expect(a.agentId).toBe("agent_a");
  expect(b.agentId).toBe("agent_b");
  expect(a.logicalRequestId).not.toBe(b.logicalRequestId);
  expect(resolveFrozenLiveRequestAttribution(registry, threadId, a.logicalRequestId)?.agentId).toBe(
    "agent_a",
  );
  expect(resolveFrozenLiveRequestAttribution(registry, threadId, b.logicalRequestId)?.agentId).toBe(
    "agent_b",
  );
});

test("billing stamp registry single candidate does not pre-fill bridge entry", () => {
  const registry = new ThreadLiveRequestRegistry();
  const billing = new ProxyBillingStampRegistry();
  const threadId = "thr_role_only";
  billing.register(threadId, { agentId: "agent_single", role: "coder" });

  const stamp = billing.resolveForRoute(threadId, "coder");
  expect(stamp?.agentId).toBe("agent_single");

  const snapshot = handleBridgeMessagesRequest(registry, {
    threadId,
    role: "coder",
    emitTimelineActivity: true,
  });
  expect(snapshot.agentId).toBeUndefined();
  expect(registry.findEntryByLogicalId(threadId, snapshot.logicalRequestId)?.agentId).toBeUndefined();
});

test("missing Claude and Eco headers leaves Bridge entry without agentId", () => {
  const registry = new ThreadLiveRequestRegistry();
  const threadId = "thr_missing_header";
  const agentId = resolveExplicitBridgeRequestAgentId("coder", new Headers());
  expect(agentId).toBeUndefined();
  const snapshot = handleBridgeMessagesRequest(registry, {
    threadId,
    role: "coder",
    emitTimelineActivity: true,
  });
  expect(snapshot.agentId).toBeUndefined();
});
