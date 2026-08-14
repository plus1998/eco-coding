import { expect, test } from "bun:test";
import {
  buildPiSessionToolApprovalFields,
  resolvePiSkipExecutionApprovals,
} from "../src/main/pi-runtime-run";
import { createPiSubagentSpawnHandler } from "../src/main/pi-subagent-host";

test("allow_all skips Eco execution approvals like Claude", () => {
  expect(resolvePiSkipExecutionApprovals("allow_all")).toBe(true);
  expect(resolvePiSkipExecutionApprovals("always")).toBe(false);
  expect(resolvePiSkipExecutionApprovals("auto")).toBe(false);
});

test("omits approval fields when handler is missing — do not pretend PI is gated", () => {
  expect(buildPiSessionToolApprovalFields({})).toEqual({});
});

test("passes handler and subagent attribution through to piSession", () => {
  const handler = async () => ({ behavior: "allow" as const });
  const fields = buildPiSessionToolApprovalFields({
    toolPermissionHandler: handler,
    agentId: "ag_1",
    agentType: "coder",
  });
  expect(fields.toolPermissionHandler).toBe(handler);
  expect(fields.toolApprovalAgentId).toBe("ag_1");
  expect(fields.toolApprovalAgentType).toBe("coder");
});

test("createPiSubagentSpawnHandler fail-closes when toolPermissionHandler is missing at runtime", () => {
  expect(() =>
    createPiSubagentSpawnHandler({
      threadId: "t1",
      ecoDataDir: "/tmp/eco",
      getArmedBinding: () => undefined,
      registry: { agents: [] } as never,
      conversationStore: {} as never,
      toolPermissionHandler: undefined as never,
    }),
  ).toThrow(/tool permission handler/i);
});
