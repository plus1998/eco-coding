import { expect, test } from "bun:test";
import {
  buildEcoJsonRpcRequest,
  createAgentEvent,
  ECO_RPC_METHODS,
  getRemoteCommandDefinition,
  hasCapabilities,
  isEcoInvokeParams,
  isRemoteCommandChannel,
  listRemoteCommandDefinitions,
  type ModelProfile,
  validateRemoteCommandArgs,
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

test("registers explicit remote command definitions", () => {
  expect(isRemoteCommandChannel("thread:list")).toBe(true);
  expect(isRemoteCommandChannel("thread:approve-plan")).toBe(true);
  expect(isRemoteCommandChannel("center-server:sign-in")).toBe(false);
  expect(listRemoteCommandDefinitions().map((definition) => definition.channel)).toContain(
    "workflow-settings:save",
  );
  expect(isRemoteCommandChannel("mcp-settings:get")).toBe(true);
  expect(listRemoteCommandDefinitions().map((definition) => definition.channel)).toEqual(
    expect.arrayContaining([
      "thread:get",
      "thread:session-bootstrap",
      "thread:run-projection-get",
      "thread:run-projection-detail-get",
      "thread:subagent-sessions-list",
    ]),
  );

  const approvePlan = getRemoteCommandDefinition("thread:approve-plan");
  expect(approvePlan).toMatchObject({
    risk: "privileged",
    requiresConfirmation: true,
  });
  expect(approvePlan?.requiredCapabilities).toContain("approval:decide");
});

test("validates remote command args", () => {
  expect(
    validateRemoteCommandArgs("thread:start", [
      { workspacePath: "/repo", prompt: "ship it", runtimeConfig: { sessionMode: "agent" } },
    ]),
  ).toEqual({ ok: true });
  expect(validateRemoteCommandArgs("thread:start", [])).toMatchObject({ ok: false });
  expect(validateRemoteCommandArgs("thread:start", [{ workspacePath: "/repo" }])).toMatchObject({
    ok: false,
  });
  expect(
    validateRemoteCommandArgs("thread:follow-up-cancel", [{ threadId: "thr_1", followUpId: "fup_1" }]),
  ).toEqual({ ok: true });
  expect(validateRemoteCommandArgs("thread:follow-up-cancel", ["fup_1"])).toMatchObject({
    ok: false,
  });
  expect(validateRemoteCommandArgs("thread:get", ["thr_1"])).toEqual({ ok: true });
  expect(validateRemoteCommandArgs("thread:delete", ["thr_1"])).toEqual({ ok: true });
  expect(validateRemoteCommandArgs("thread:session-bootstrap", ["thr_1"])).toEqual({ ok: true });
  expect(validateRemoteCommandArgs("thread:run-projection-get", ["thr_1"])).toEqual({ ok: true });
  expect(validateRemoteCommandArgs("thread:run-projection-get", ["feed:thr_1"])).toEqual({ ok: true });
  expect(validateRemoteCommandArgs("thread:run-projection-get", ["thr_1", "feed"])).toEqual({ ok: true });
  expect(
    validateRemoteCommandArgs("thread:run-projection-get", [{ threadId: "thr_1", mode: "feed" }]),
  ).toMatchObject({ ok: false });
  expect(
    validateRemoteCommandArgs("thread:run-projection-detail-get", [
      { threadId: "thr_1", kind: "agent", key: "agent_1" },
    ]),
  ).toEqual({ ok: true });
  expect(
    validateRemoteCommandArgs("thread:run-projection-detail-get", [{ threadId: "thr_1", kind: "agent" }]),
  ).toMatchObject({ ok: false });
  expect(validateRemoteCommandArgs("thread:get-usage-snapshot", ["thr_1"])).toEqual({ ok: true });
  expect(
    validateRemoteCommandArgs("thread:follow-up-escalate", [{ threadId: "thr_1", followUpId: "fup_1" }]),
  ).toEqual({ ok: true });
  expect(
    validateRemoteCommandArgs("thread:follow-up-update", [
      { threadId: "thr_1", followUpId: "fup_1", prompt: "updated" },
    ]),
  ).toEqual({ ok: true });
  expect(validateRemoteCommandArgs("center-server:sign-in", [])).toMatchObject({ ok: false });
});

test("registers workspace remote command definitions", () => {
  expect(isRemoteCommandChannel("workspace:get-home-path")).toBe(true);
  expect(validateRemoteCommandArgs("workspace:get-home-path", [])).toEqual({ ok: true });
  expect(isRemoteCommandChannel("workspace:get-user-home-path")).toBe(true);
  expect(validateRemoteCommandArgs("workspace:get-user-home-path", [])).toEqual({ ok: true });
  expect(isRemoteCommandChannel("workspace:list-directories")).toBe(true);
  expect(validateRemoteCommandArgs("workspace:list-directories", ["/Users/example"])).toEqual({ ok: true });
});

test("registers git remote command definitions", () => {
  expect(isRemoteCommandChannel("git:get-status")).toBe(true);
  expect(isRemoteCommandChannel("git:commit")).toBe(true);
  expect(isRemoteCommandChannel("git:push")).toBe(true);
  expect(
    validateRemoteCommandArgs("git:commit", [
      { workspacePath: "/repo", profileId: "prof_1", includeUnstaged: true },
    ]),
  ).toEqual({ ok: true });
  expect(validateRemoteCommandArgs("git:push", [{ workspacePath: "/repo" }])).toEqual({ ok: true });
  expect(isRemoteCommandChannel("git:pull")).toBe(true);
  expect(validateRemoteCommandArgs("git:pull", [{ workspacePath: "/repo" }])).toEqual({ ok: true });
  expect(isRemoteCommandChannel("thread:todo-list")).toBe(true);
  expect(isRemoteCommandChannel("workspace:list-package-scripts")).toBe(true);
});

test("validates eco.invoke params with desktop target", () => {
  const request = buildEcoJsonRpcRequest("req_1", ECO_RPC_METHODS.invoke, {
    desktopDeviceId: "dev_desktop",
    channel: "thread:list",
    args: [],
  });
  expect(isEcoInvokeParams(request.params)).toBe(true);
});
