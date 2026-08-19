import { expect, test } from "bun:test";
import {
  createAcpPermissionHandler,
  mapAcpPermissionToBashApprovalRequest,
  mapBashResolutionToAcpPermission,
} from "../src/main/acp-permission-bridge";
import type { AcpPermissionRequest } from "@eco/runtime";
import type { BashApprovalRequest } from "../src/shared/ipc";

const EXECUTE_REQUEST: AcpPermissionRequest = {
  sessionId: "sess-1",
  toolCall: {
    toolCallId: "call_sh",
    kind: "execute",
    title: "ls -la",
    rawInput: { command: "ls -la" },
  },
  options: [
    { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
    { optionId: "allow-always", name: "Allow always", kind: "allow_always" },
    { optionId: "reject-once", name: "Reject", kind: "reject_once" },
  ],
};

test("maps execute toolCall command into Eco bash approval request", () => {
  const mapped = mapAcpPermissionToBashApprovalRequest({
    threadId: "thr_1",
    request: EXECUTE_REQUEST,
    cwd: "/tmp/ws",
    agentId: "planner_1",
    reason: "needs confirmation",
  });
  expect(mapped.command).toBe("ls -la");
  expect(mapped.kind).toBe("command");
  expect(mapped.toolUseId).toBe("call_sh");
});

test("approved_remember_prefix selects allow_always when Cursor offers it", () => {
  expect(
    mapBashResolutionToAcpPermission(EXECUTE_REQUEST, { decision: "approved_remember_prefix" }),
  ).toEqual({ outcome: { outcome: "selected", optionId: "allow-always" } });
  expect(mapBashResolutionToAcpPermission(EXECUTE_REQUEST, { decision: "approved" })).toEqual({
    outcome: { outcome: "selected", optionId: "allow-once" },
  });
  expect(mapBashResolutionToAcpPermission(EXECUTE_REQUEST, { decision: "denied" })).toEqual({
    outcome: { outcome: "selected", optionId: "reject-once" },
  });
});

test("allow_all auto-allows without parking Eco bash approval", async () => {
  const parked: BashApprovalRequest[] = [];
  const handler = createAcpPermissionHandler("thr_1", {
    getBashReviewMode: () => "allow_all",
    getCwd: () => "/tmp/ws",
    getWorkspacePath: () => "/tmp/ws",
    getPlannerAgentId: () => "planner_1",
    getRememberPrefixes: () => [],
    evaluateConfirmation: () => {
      throw new Error("should not evaluate when allow_all");
    },
    registerPending: async (_threadId, request) => {
      parked.push(request);
      return { decision: "approved" };
    },
    rememberPrefix: () => {},
    emit: () => {},
  });
  await expect(handler(EXECUTE_REQUEST)).resolves.toEqual({
    outcome: { outcome: "selected", optionId: "allow-once" },
  });
  expect(parked).toEqual([]);
});

test("always parks execute commands on Eco bash approval", async () => {
  const parked: BashApprovalRequest[] = [];
  const handler = createAcpPermissionHandler("thr_1", {
    getBashReviewMode: () => "always",
    getCwd: () => "/tmp/ws",
    getWorkspacePath: () => "/tmp/ws",
    getPlannerAgentId: () => "planner_1",
    getRememberPrefixes: () => [],
    evaluateConfirmation: () => ({
      action: "ask",
      reason: "always mode",
      userMessage: "需要确认",
    }),
    registerPending: async (_threadId, request) => {
      parked.push(request);
      return { decision: "approved" };
    },
    rememberPrefix: () => {},
    emit: () => {},
  });
  await expect(handler(EXECUTE_REQUEST)).resolves.toEqual({
    outcome: { outcome: "selected", optionId: "allow-once" },
  });
  expect(parked).toHaveLength(1);
  expect(parked[0]?.command).toBe("ls -la");
});

function createAutoHandler(input: {
  parked: BashApprovalRequest[];
  reviewed: Array<{ toolName: string }>;
  reviewAction?: "allow" | "human_required" | "deny";
}) {
  return createAcpPermissionHandler("thr_1", {
    getBashReviewMode: () => "auto",
    getCwd: () => "/tmp/ws",
    getWorkspacePath: () => "/tmp/ws",
    getPlannerAgentId: () => "planner_1",
    getRememberPrefixes: () => [],
    evaluateConfirmation: () => ({
      action: "ask",
      reason: "auto mode",
      userMessage: "需要确认",
    }),
    reviewApproval: async (_request, tool) => {
      input.reviewed.push({ toolName: tool.toolName });
      if (input.reviewAction === "human_required") {
        return {
          action: "human_required",
          rationale: "need a person",
          policyMatches: [],
        };
      }
      if (input.reviewAction === "deny") {
        return {
          action: "deny",
          rationale: "blocked",
          policyMatches: [],
        };
      }
      return {
        action: "allow",
        rationale: "safe",
        riskLevel: "low",
        policyMatches: [],
      };
    },
    registerPending: async (_threadId, request) => {
      input.parked.push(request);
      return { decision: "approved" };
    },
    rememberPrefix: () => {},
    emit: () => {},
  });
}

test("替我审批 uses Eco auxiliary review, not Cursor config", async () => {
  const parked: BashApprovalRequest[] = [];
  const reviewed: Array<{ toolName: string }> = [];
  const handler = createAutoHandler({ parked, reviewed });
  await expect(handler(EXECUTE_REQUEST)).resolves.toEqual({
    outcome: { outcome: "selected", optionId: "allow-once" },
  });
  expect(reviewed).toEqual([{ toolName: "Bash" }]);
  expect(parked).toEqual([]);
});

test("替我审批 reviews non-execute ACP tools instead of parking immediately", async () => {
  const parked: BashApprovalRequest[] = [];
  const reviewed: Array<{ toolName: string }> = [];
  const handler = createAutoHandler({ parked, reviewed });
  const edit: AcpPermissionRequest = {
    toolCall: {
      toolCallId: "call_edit",
      kind: "edit",
      title: "Write file",
      rawInput: { path: "/tmp/ws/a.ts" },
    },
    options: [
      { optionId: "allow-once", kind: "allow_once" },
      { optionId: "reject-once", kind: "reject_once" },
    ],
  };
  await expect(handler(edit)).resolves.toEqual({
    outcome: { outcome: "selected", optionId: "allow-once" },
  });
  expect(reviewed).toEqual([{ toolName: "Edit" }]);
  expect(parked).toEqual([]);
});

test("替我审批 parks after auxiliary review returns human_required", async () => {
  const parked: BashApprovalRequest[] = [];
  const reviewed: Array<{ toolName: string }> = [];
  const handler = createAutoHandler({ parked, reviewed, reviewAction: "human_required" });
  const search: AcpPermissionRequest = {
    toolCall: {
      toolCallId: "web_search_0",
      kind: "search",
      title: "Web search",
    },
    options: [
      { optionId: "allow-once", kind: "allow_once" },
      { optionId: "reject-once", kind: "reject_once" },
    ],
  };
  await expect(handler(search)).resolves.toEqual({
    outcome: { outcome: "selected", optionId: "allow-once" },
  });
  expect(reviewed).toEqual([{ toolName: "WebSearch" }]);
  expect(parked).toHaveLength(1);
  expect(parked[0]?.reviewRationale).toBe("need a person");
});

test("missing planner agentId rejects instead of inventing an id", async () => {
  const handler = createAcpPermissionHandler("thr_1", {
    getBashReviewMode: () => "always",
    getCwd: () => "/tmp/ws",
    getWorkspacePath: () => "/tmp/ws",
    getPlannerAgentId: () => undefined,
    getRememberPrefixes: () => [],
    evaluateConfirmation: () => {
      throw new Error("should not evaluate without agentId");
    },
    registerPending: async () => {
      throw new Error("should not park without agentId");
    },
    rememberPrefix: () => {},
    emit: () => {},
  });
  await expect(handler(EXECUTE_REQUEST)).resolves.toEqual({
    outcome: { outcome: "selected", optionId: "reject-once" },
  });
});

test("switch_mode is auto-allowed; web search still parks in Eco always", async () => {
  const parked: BashApprovalRequest[] = [];
  const handler = createAcpPermissionHandler("thr_1", {
    getBashReviewMode: () => "always",
    getCwd: () => "/tmp/ws",
    getWorkspacePath: () => "/tmp/ws",
    getPlannerAgentId: () => "planner_1",
    getRememberPrefixes: () => [],
    evaluateConfirmation: () => {
      throw new Error("switch_mode/search should not use bash policy");
    },
    registerPending: async (_threadId, request) => {
      parked.push(request);
      return { decision: "approved" };
    },
    rememberPrefix: () => {},
    emit: () => {},
  });

  const switchMode: AcpPermissionRequest = {
    toolCall: { toolCallId: "call_switch", kind: "switch_mode", title: "Ready" },
    options: [
      { optionId: "agent", kind: "allow_always" },
      { optionId: "reject", kind: "reject_once" },
    ],
  };
  await expect(handler(switchMode)).resolves.toEqual({
    outcome: { outcome: "selected", optionId: "agent" },
  });
  expect(parked).toEqual([]);

  const search: AcpPermissionRequest = {
    toolCall: { toolCallId: "web_search_0", kind: "search", title: "Web search" },
    options: [
      { optionId: "allow-once", kind: "allow_once" },
      { optionId: "reject-once", kind: "reject_once" },
    ],
  };
  await expect(handler(search)).resolves.toEqual({
    outcome: { outcome: "selected", optionId: "allow-once" },
  });
  expect(parked).toHaveLength(1);
  expect(parked[0]?.kind).toBe("network");
});
