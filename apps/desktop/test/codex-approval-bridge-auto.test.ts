import { expect, test } from "bun:test";
import {
  CODEX_COMMAND_EXECUTION_REQUEST_APPROVAL,
  CODEX_MCP_SERVER_ELICITATION_REQUEST,
  type CodexApprovalBridgeDeps,
  handleCodexServerRequest,
  resolvePendingCodexBashApproval,
} from "../src/main/codex-approval-bridge";
import type { BashApprovalDecision } from "../src/shared/ipc";
import type { ThreadLiveEvent } from "../src/shared/ipc";

test("Codex auto mode returns accept when the auxiliary reviewer allows the command", async () => {
  const events: ThreadLiveEvent[] = [];
  const deps: CodexApprovalBridgeDeps = {
    resolveEcoThreadId: () => "thread-1",
    getThread: () => ({ prompt: "检查仓库状态", workspacePath: "/workspace" }),
    getWorktreePath: () => "/workspace",
    getPlannerAgentId: () => "planner-1",
    getRoutesJson: () => "[]",
    savePendingPlan: () => undefined,
    emitThreadLive: (event) => events.push(event),
    updateThreadStatus: () => undefined,
    getApprovalMode: () => "auto",
    reviewApproval: async () => ({ action: "allow", rationale: "Read-only inspection." }),
  };

  await expect(
    handleCodexServerRequest(deps, CODEX_COMMAND_EXECUTION_REQUEST_APPROVAL, {
      threadId: "codex-thread-1",
      turnId: "turn-1",
      itemId: "command-1",
      startedAtMs: 1,
      command: "git status",
      cwd: "/workspace",
      reason: "Sandbox requires approval",
    }),
  ).resolves.toEqual({ decision: "accept" });

  expect(events.map((event) => event.type)).toEqual(["bash_approval.approved"]);
  expect(events[0]?.message).toContain("辅助模型已允许");
  expect(events[0]?.bashApproval).toMatchObject({
    reason: "Sandbox requires approval",
    description: "Sandbox requires approval",
    reviewRationale: "Read-only inspection.",
  });
});

test("Codex auto mode preserves the original request when the reviewer requires a human", async () => {
  const events: ThreadLiveEvent[] = [];
  const deps: CodexApprovalBridgeDeps = {
    resolveEcoThreadId: () => "thread-human",
    getThread: () => ({ prompt: "检查仓库状态", workspacePath: "/workspace" }),
    getWorktreePath: () => "/workspace",
    getPlannerAgentId: () => "planner-human",
    getRoutesJson: () => "[]",
    savePendingPlan: () => undefined,
    emitThreadLive: (event) => {
      events.push(event);
      if (event.type === "bash_approval.requested") {
        queueMicrotask(() => {
          resolvePendingCodexBashApproval("command-human", { decision: "denied" });
        });
      }
    },
    updateThreadStatus: () => undefined,
    getApprovalMode: () => "auto",
    reviewApproval: async () => ({
      action: "human_required",
      rationale: "No tool action details provided; cannot assess risk or authorization.",
    }),
  };

  await expect(
    handleCodexServerRequest(deps, CODEX_COMMAND_EXECUTION_REQUEST_APPROVAL, {
      threadId: "codex-thread-human",
      turnId: "turn-human",
      itemId: "command-human",
      startedAtMs: 1,
      command: "git status",
      cwd: "/workspace",
      reason: "Sandbox requires approval",
    }),
  ).resolves.toEqual({ decision: "decline" });

  expect(events[0]).toMatchObject({
    type: "bash_approval.requested",
    bashApproval: {
      reason: "Sandbox requires approval",
      description: "Sandbox requires approval",
      reviewRationale: "No tool action details provided; cannot assess risk or authorization.",
    },
  });
});

test("image generation MCP approval accepts only a one-time approval", async () => {
  async function request(decision: BashApprovalDecision) {
    const events: ThreadLiveEvent[] = [];
    const deps: CodexApprovalBridgeDeps = {
      resolveEcoThreadId: () => "thread-image",
      getThread: () => ({ prompt: "create image", workspacePath: "/workspace" }),
      getWorktreePath: () => "/workspace/worktree",
      getPlannerAgentId: () => "planner-image",
      getRoutesJson: () => "[]",
      savePendingPlan: () => undefined,
      emitThreadLive: (event) => {
        events.push(event);
        if (event.type === "bash_approval.requested" && event.bashApproval) {
          queueMicrotask(() => {
            resolvePendingCodexBashApproval(event.bashApproval!.toolUseId, { decision });
          });
        }
      },
      updateThreadStatus: () => undefined,
      getApprovalMode: () => "always",
    };
    const result = await handleCodexServerRequest(
      deps,
      CODEX_MCP_SERVER_ELICITATION_REQUEST,
      {
        threadId: "codex-thread-image",
        turnId: "turn-image",
        serverName: "eco_image_generation",
        mode: "form",
        message: 'Allow the MCP server to run tool "create_image"',
        requestedSchema: {},
      },
    );
    expect(events[0]?.bashApproval).toMatchObject({
      kind: "image_generation",
      cwd: "/workspace/worktree",
    });
    return result;
  }

  await expect(request("approved")).resolves.toEqual({ action: "accept", content: {} });
  await expect(request("approved_for_session")).resolves.toEqual({ action: "decline" });
  await expect(request("approved_remember_prefix")).resolves.toEqual({ action: "decline" });
});
