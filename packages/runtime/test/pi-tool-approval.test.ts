import { expect, test } from "bun:test";
import type { SdkToolPermissionDecision, SdkToolPermissionRequest } from "../src/claude-agent-sdk";
import {
  applyPiToolCallPermission,
  createEcoPiToolApprovalExtensionFactory,
  mapSdkPermissionDecisionToPiToolCallResult,
  type PiToolCallEventLike,
} from "../src/pi-tool-approval";

function event(partial: Partial<PiToolCallEventLike> = {}): PiToolCallEventLike {
  return {
    type: "tool_call",
    toolCallId: "call_1",
    toolName: "bash",
    input: { command: "ls" },
    ...partial,
  };
}

test("allow returns undefined and does not block", () => {
  const ev = event();
  const result = mapSdkPermissionDecisionToPiToolCallResult(
    { behavior: "allow", updatedInput: ev.input },
    ev,
  );
  expect(result).toBeUndefined();
});

test("allow with updatedInput mutates event.input in place", () => {
  const ev = event({ input: { command: "ls" } });
  mapSdkPermissionDecisionToPiToolCallResult({ behavior: "allow", updatedInput: { command: "ls -la" } }, ev);
  expect(ev.input.command).toBe("ls -la");
});

test("deny maps to block plus reason without terminate", () => {
  const result = mapSdkPermissionDecisionToPiToolCallResult(
    { behavior: "deny", message: "User rejected this command." },
    event(),
  );
  expect(result).toEqual({ block: true, reason: "User rejected this command." });
});

test("deny with interrupt sets terminate", () => {
  const result = mapSdkPermissionDecisionToPiToolCallResult(
    { behavior: "deny", message: "Thread was not found.", interrupt: true },
    event(),
  );
  expect(result).toEqual({
    block: true,
    reason: "Thread was not found.",
    terminate: true,
  });
});

test("applyPiToolCallPermission fail-closes when handler throws", async () => {
  const result = await applyPiToolCallPermission(
    event(),
    {},
    {
      onToolPermission: async () => {
        throw new Error("boom");
      },
    },
  );
  expect(result?.block).toBe(true);
  expect(result?.reason).toContain("blocked");
});

test("applyPiToolCallPermission rethrows AbortError from handler", async () => {
  const abortError = new DOMException("aborted", "AbortError");
  await expect(
    applyPiToolCallPermission(
      event(),
      {},
      {
        onToolPermission: async () => {
          throw abortError;
        },
      },
    ),
  ).rejects.toBe(abortError);
});

test("applyPiToolCallPermission maps PI bash to Bash for handler request", async () => {
  let seen: SdkToolPermissionRequest | undefined;
  await applyPiToolCallPermission(
    event({ toolName: "bash" }),
    {},
    {
      onToolPermission: async (request) => {
        seen = request;
        return { behavior: "allow" } satisfies SdkToolPermissionDecision;
      },
    },
  );
  expect(seen?.toolName).toBe("Bash");
});

test("applyPiToolCallPermission maps PI read/write/edit to Read/Write/Edit", async () => {
  const cases = [
    ["read", "Read"],
    ["write", "Write"],
    ["edit", "Edit"],
  ] as const;
  for (const [piName, sdkName] of cases) {
    let seen: SdkToolPermissionRequest | undefined;
    await applyPiToolCallPermission(
      event({ toolName: piName }),
      {},
      {
        onToolPermission: async (request) => {
          seen = request;
          return { behavior: "allow" } satisfies SdkToolPermissionDecision;
        },
      },
    );
    expect(seen?.toolName).toBe(sdkName);
  }
});

test("applyPiToolCallPermission leaves grep unmapped", async () => {
  let seen: SdkToolPermissionRequest | undefined;
  await applyPiToolCallPermission(
    event({ toolName: "grep" }),
    {},
    {
      onToolPermission: async (request) => {
        seen = request;
        return { behavior: "allow" } satisfies SdkToolPermissionDecision;
      },
    },
  );
  expect(seen?.toolName).toBe("grep");
});

test("applyPiToolCallPermission leaves mcp-style names unchanged", async () => {
  let seen: SdkToolPermissionRequest | undefined;
  await applyPiToolCallPermission(
    event({ toolName: "mcp__eco_agent_browser__open" }),
    {},
    {
      onToolPermission: async (request) => {
        seen = request;
        return { behavior: "allow" } satisfies SdkToolPermissionDecision;
      },
    },
  );
  expect(seen?.toolName).toBe("mcp__eco_agent_browser__open");
});

test("applyPiToolCallPermission forwards SdkToolPermissionRequest fields", async () => {
  let seen: SdkToolPermissionRequest | undefined;
  const controller = new AbortController();
  await applyPiToolCallPermission(
    event({ toolName: "write", toolCallId: "w1", input: { path: "a.ts" } }),
    { cwd: "/repo", signal: controller.signal },
    {
      onToolPermission: async (request) => {
        seen = request;
        return { behavior: "allow" } satisfies SdkToolPermissionDecision;
      },
      agentId: "agent_child",
      agentType: "coder",
    },
  );
  expect(seen?.toolName).toBe("Write");
  expect(seen?.toolUseId).toBe("w1");
  expect(seen?.input).toEqual({ path: "a.ts" });
  expect(seen?.cwd).toBe("/repo");
  expect(seen?.agentId).toBe("agent_child");
  expect(seen?.agentType).toBe("coder");
  expect(seen?.signal).toBe(controller.signal);
});

test("factory registers tool_call and returns handler result", async () => {
  const handlers: Array<(event: PiToolCallEventLike, ctx: { cwd?: string }) => Promise<unknown>> = [];
  const pi = {
    on(
      _event: "tool_call",
      handler: (event: PiToolCallEventLike, ctx: { cwd?: string }) => Promise<unknown>,
    ) {
      handlers.push(handler);
    },
  };
  createEcoPiToolApprovalExtensionFactory({
    onToolPermission: async () => ({ behavior: "deny", message: "nope" }),
  })(pi);
  expect(handlers).toHaveLength(1);
  const result = await handlers[0]!(event(), { cwd: "/ws" });
  expect(result).toEqual({ block: true, reason: "nope" });
});
