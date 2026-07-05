import { expect, test } from "bun:test";
import { ApprovalService } from "../../approval/src";
import { type AgentRuntimeDriver, ThreadSupervisor } from "../../runtime/src";
import { type AgentRoleRoute, InMemoryEventStore, type ModelProfile } from "../../shared/src";
import { createApprovalBackedPermissionHandler, resolveRoutes, ThreadOrchestrator } from "../src";

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

test("starts thread worker in workspace without isolated worktree", async () => {
  const driver: AgentRuntimeDriver = {
    async *run() {},
  };
  const supervisor = new ThreadSupervisor(new InMemoryEventStore(), driver);
  const orchestrator = new ThreadOrchestrator(supervisor);

  const result = await orchestrator.start({
    threadId: "thr_1",
    title: "Test",
    workspacePath: "/repo",
    prompt: "do work",
    roles: ["planner"],
    roleRoutes,
    modelProfiles: profiles,
  });

  await result.running.done;

  expect(result.worktree.worktreePath).toBe("/repo");
  expect(result.worktree.workspacePath).toBe("/repo");
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
