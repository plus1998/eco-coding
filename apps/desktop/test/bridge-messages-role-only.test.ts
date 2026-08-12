import { afterEach, expect, test } from "bun:test";
import {
  handleBridgeMessagesRequest,
  resolveExplicitBridgeRequestAgentId,
} from "../src/main/thread-live-request-coordinator";
import { ProxyBillingStampRegistry, ECO_PROXY_BILLING_HEADERS } from "../src/main/proxy-billing-stamp";
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
  expect(resolveExplicitBridgeRequestAgentId(BUILTIN_VISION_AGENT_ROLE, headers)).toBe(
    "vision:thr:abc",
  );
  expect(resolveExplicitBridgeRequestAgentId("coder", headers)).toBeUndefined();
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
