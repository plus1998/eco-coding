import { expect, test } from "bun:test";
import {
  createPiModeAwareToolPermissionHandler,
  isPiReadOnlyBashCommand,
  PI_FINALIZE_PLAN_TOOL_NAME,
  piSystemPromptForSessionMode,
  piToolsForSessionMode,
} from "../src/pi-session-mode";
import type { SdkToolPermissionRequest } from "../src/claude-agent-sdk";

function request(
  toolName: string,
  input: Record<string, unknown> = {},
): SdkToolPermissionRequest {
  return {
    toolName,
    input,
    toolUseId: "tu_1",
    signal: new AbortController().signal,
  };
}

test("piToolsForSessionMode ask/plan are read-only plus bash", () => {
  expect(piToolsForSessionMode("ask")).toEqual(["read", "grep", "find", "ls", "bash"]);
  expect(piToolsForSessionMode("plan")).toContain("finalize_plan");
  expect(piToolsForSessionMode("plan")).not.toContain("edit");
  expect(piToolsForSessionMode("agent")).toContain("write");
});

test("isPiReadOnlyBashCommand allows rg/grep/git status", () => {
  expect(isPiReadOnlyBashCommand("rg TODO")).toBe(true);
  expect(isPiReadOnlyBashCommand("grep -R foo src")).toBe(true);
  expect(isPiReadOnlyBashCommand("git status")).toBe(true);
  expect(isPiReadOnlyBashCommand("git log -1")).toBe(true);
  expect(isPiReadOnlyBashCommand("ls -la")).toBe(true);
  expect(isPiReadOnlyBashCommand("rg foo | head")).toBe(true);
});

test("isPiReadOnlyBashCommand denies mutating commands", () => {
  expect(isPiReadOnlyBashCommand("rm -rf src")).toBe(false);
  expect(isPiReadOnlyBashCommand("git commit -m x")).toBe(false);
  expect(isPiReadOnlyBashCommand("npm install lodash")).toBe(false);
  expect(isPiReadOnlyBashCommand("echo hi > file.txt")).toBe(false);
  expect(isPiReadOnlyBashCommand("ls && rm -rf /")).toBe(false);
  expect(isPiReadOnlyBashCommand("echo $(rm -rf x)")).toBe(false);
});

test("Ask mode allows Read and read-only bash without calling baseHandler", async () => {
  let baseCalls = 0;
  const handler = createPiModeAwareToolPermissionHandler({
    mode: "ask",
    baseHandler: async () => {
      baseCalls += 1;
      return { behavior: "allow" };
    },
  });
  expect(await handler(request("Read", { path: "a.ts" }))).toEqual({
    behavior: "allow",
    updatedInput: { path: "a.ts" },
  });
  expect(await handler(request("Bash", { command: "rg foo" }))).toMatchObject({
    behavior: "allow",
  });
  expect(baseCalls).toBe(0);
});

test("Ask mode hard-denies Write and Agent without baseHandler", async () => {
  let baseCalls = 0;
  const handler = createPiModeAwareToolPermissionHandler({
    mode: "ask",
    baseHandler: async () => {
      baseCalls += 1;
      return { behavior: "allow" };
    },
  });
  const write = await handler(request("Write", { path: "a.ts" }));
  const agent = await handler(request("Agent", { task: "x" }));
  const bash = await handler(request("Bash", { command: "rm -rf ." }));
  expect(write.behavior).toBe("deny");
  expect(agent.behavior).toBe("deny");
  expect(bash.behavior).toBe("deny");
  expect(write.behavior === "deny" ? write.message : "").not.toMatch(/\b(Eco|PI)\b/i);
  expect(bash.behavior === "deny" ? bash.message : "").not.toMatch(/\b(Eco|PI)\b/i);
  expect(baseCalls).toBe(0);
});

test("Ask mode fail-closes unknown MCP tools", async () => {
  const handler = createPiModeAwareToolPermissionHandler({
    mode: "ask",
    baseHandler: async () => ({ behavior: "allow" }),
  });
  expect((await handler(request("mcp__browser__navigate", { url: "https://x" }))).behavior).toBe(
    "deny",
  );
});

test("Agent mode passes through to baseHandler", async () => {
  let seen: string | undefined;
  const handler = createPiModeAwareToolPermissionHandler({
    mode: "agent",
    baseHandler: async (req) => {
      seen = req.toolName;
      return { behavior: "allow", updatedInput: req.input };
    },
  });
  await handler(request("Bash", { command: "npm install" }));
  expect(seen).toBe("Bash");
});

test("Plan finalize_plan is allowed immediately without baseHandler", async () => {
  let baseCalls = 0;
  const handler = createPiModeAwareToolPermissionHandler({
    mode: "plan",
    baseHandler: async () => {
      baseCalls += 1;
      return { behavior: "allow" };
    },
  });
  const decision = await handler(
    request(PI_FINALIZE_PLAN_TOOL_NAME, { plan: "1. Do the thing\n2. Test" }),
  );
  expect(decision.behavior).toBe("allow");
  expect(baseCalls).toBe(0);
});

test("Plan finalize_plan denies empty plan", async () => {
  const handler = createPiModeAwareToolPermissionHandler({
    mode: "plan",
    baseHandler: async () => ({ behavior: "allow" }),
  });
  const decision = await handler(request(PI_FINALIZE_PLAN_TOOL_NAME, { plan: "  " }));
  expect(decision.behavior).toBe("deny");
});

test("Ask mode blocks finalize_plan", async () => {
  const handler = createPiModeAwareToolPermissionHandler({
    mode: "ask",
    baseHandler: async () => ({ behavior: "allow" }),
  });
  expect(
    (await handler(request(PI_FINALIZE_PLAN_TOOL_NAME, { plan: "step" }))).behavior,
  ).toBe("deny");
});

test("piSystemPromptForSessionMode differs by mode", () => {
  const ask = piSystemPromptForSessionMode("ask");
  const plan = piSystemPromptForSessionMode("plan");
  const agent = piSystemPromptForSessionMode("agent");
  expect(ask).toContain("MUST NOT modify");
  expect(plan).toContain("finalize_plan");
  expect(plan).toContain("MUST invoke");
  expect(plan).not.toMatch(/approv|asynchron|Agent mode|approval card/i);
  expect(agent).toBe("");
  for (const text of [ask, plan, agent]) {
    expect(text).not.toMatch(/\b(Eco|PI)\b/i);
    expect(text).not.toMatch(/You are/i);
  }
});
