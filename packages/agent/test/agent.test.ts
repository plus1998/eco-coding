import { expect, test } from "bun:test";
import type { AgentRoleRoute, ModelProfile } from "../../shared/src";
import { InMemoryEventStore } from "../../persistence/src";
import { ThreadSupervisor, type AgentRuntimeDriver } from "../../runtime/src";
import { ApprovalService } from "../../approval/src";
import { ThreadOrchestrator, createApprovalBackedPermissionHandler, resolveRoutes } from "../src";

const profiles: ModelProfile[] = [
  {
    id: "sonnet",
    provider: "anthropic",
    displayName: "Sonnet",
    baseUrl: "https://gateway.test",
    modelId: "claude-sonnet",
    capabilities: ["messages_api", "streaming", "tool_use"],
    enabled: true,
  },
];

const roleRoutes: AgentRoleRoute[] = [
  {
    role: "planner",
    primaryModelId: "sonnet",
    fallbackModelIds: [],
    requiredCapabilities: ["messages_api"],
  },
];

test("resolves requested role routes before starting workers", () => {
  const routes = resolveRoutes(["planner"], roleRoutes, profiles);
  expect(routes[0]?.primary.modelId).toBe("claude-sonnet");
});

test("creates worktree before starting a thread worker", async () => {
  const order: string[] = [];
  const driver: AgentRuntimeDriver = {
    async *run() {},
  };
  const supervisor = new ThreadSupervisor(new InMemoryEventStore(), driver);
  const orchestrator = new ThreadOrchestrator(supervisor, {
    async createWorktree() {
      order.push("worktree");
    },
  });

  const result = await orchestrator.start({
    threadId: "thr_1",
    title: "Test",
    workspacePath: "/repo",
    prompt: "do work",
    roles: ["planner"],
    roleRoutes,
    modelProfiles: profiles,
  });

  order.push("started");
  await result.running.done;

  expect(order).toEqual(["worktree", "started"]);
  expect(result.worktree.worktreePath).toBe("/repo/.eco/worktrees/thr_1");
});

test("turns risky SDK Bash tools into pending approvals", async () => {
  const approvalService = new ApprovalService({
    store: { async saveApproval() {} },
    idFactory: () => "approval_1",
  });
  const handler = createApprovalBackedPermissionHandler({
    approvalService,
    threadId: "thr_1",
    workspacePath: "/repo",
    cwd: "/repo",
  });

  const decision = await handler({
    toolName: "Bash",
    input: { command: "echo ok && rm -rf src" },
    toolUseId: "tool_1",
    agentId: "coder",
    signal: new AbortController().signal,
  });

  expect(decision).toEqual({
    behavior: "deny",
    message: "Approval required: File deletion requires approval",
    interrupt: true,
  });
});
