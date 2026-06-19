import { expect, test } from "bun:test";
import {
  buildEcoJsonRpcRequest,
  classifyEcoCommandRisk,
  createAgentEvent,
  ECO_RPC_METHODS,
  hasCapabilities,
  isEcoInvokeParams,
  type ModelProfile,
} from "../src";

const model: ModelProfile = {
  id: "sonnet",
  provider: "anthropic",
  displayName: "Claude Sonnet",
  baseUrl: "https://api.anthropic.com",
  modelId: "claude-sonnet",
  capabilities: ["messages_api", "streaming", "tool_use"],
  enabled: true,
};

test("checks required model capabilities", () => {
  expect(hasCapabilities(model, ["messages_api", "tool_use"])).toBe(true);
  expect(hasCapabilities(model, ["subagent_compatible"])).toBe(false);
});

test("creates timestamped agent events", () => {
  const event = createAgentEvent({
    id: "evt_1",
    threadId: "thr_1",
    agentId: "agt_1",
    role: "planner",
    type: "agent.started",
    payload: { modelId: "sonnet" },
  });

  expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
});

test("classifies mobile command risk for server policy", () => {
  expect(classifyEcoCommandRisk("thread:list")).toBe("read");
  expect(classifyEcoCommandRisk("thread:start")).toBe("execute");
  expect(classifyEcoCommandRisk("agent-template:save")).toBe("write_safe");
  expect(classifyEcoCommandRisk("bash-approval:resolve")).toBe("privileged");
});

test("validates eco.invoke params with desktop target", () => {
  const request = buildEcoJsonRpcRequest("req_1", ECO_RPC_METHODS.invoke, {
    desktopDeviceId: "dev_desktop",
    channel: "thread:list",
    args: [],
  });
  expect(isEcoInvokeParams(request.params)).toBe(true);
});
