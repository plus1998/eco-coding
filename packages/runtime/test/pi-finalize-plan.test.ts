import { expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createEcoPiFinalizePlanExtensionFactory,
  PI_FINALIZE_PLAN_EXTENSION_NAME,
} from "../src/pi-finalize-plan";
import {
  PI_FINALIZE_PLAN_TOOL_NAME,
  piSystemPromptForSessionMode,
  piToolsForSessionMode,
} from "../src/pi-session-mode";

test("finalize_plan extension submits plan asynchronously and does not block", async () => {
  const submitted: Array<{ plan: string; toolCallId: string }> = [];
  const factory = createEcoPiFinalizePlanExtensionFactory({
    onSubmitted: (input) => {
      submitted.push(input);
    },
  });

  let registered:
    | {
        name: string;
        description: string;
        promptGuidelines?: string[];
        execute: (
          toolCallId: string,
          params: Record<string, unknown>,
          signal: AbortSignal | undefined,
          onUpdate: undefined,
          ctx: { cwd: string },
        ) => Promise<{ content: Array<{ type: "text"; text: string }> }>;
      }
    | undefined;

  factory({
    registerTool: (tool) => {
      registered = tool as typeof registered;
    },
  });

  expect(PI_FINALIZE_PLAN_EXTENSION_NAME).toBe("eco-pi-finalize-plan");
  expect(registered?.name).toBe(PI_FINALIZE_PLAN_TOOL_NAME);
  expect(registered?.description).not.toMatch(/approv|asynchron|Agent execution/i);
  expect(registered?.promptGuidelines?.join("\n")).not.toMatch(/approv|Eco/i);

  const result = await registered!.execute("call_1", { plan: "1. Read\n2. Patch" }, undefined, undefined, {
    cwd: "/tmp",
  });
  expect(submitted).toEqual([{ plan: "1. Read\n2. Patch", toolCallId: "call_1" }]);
  expect(result.content[0]?.text).toMatch(/submitted/i);
  expect(result.content[0]?.text).not.toMatch(/approv|asynchron|Eco|Agent mode/i);
});

test("finalize_plan extension rejects empty plan without onSubmitted", async () => {
  let called = false;
  const factory = createEcoPiFinalizePlanExtensionFactory({
    onSubmitted: () => {
      called = true;
    },
  });
  let registered:
    | {
        execute: (
          toolCallId: string,
          params: Record<string, unknown>,
          signal: AbortSignal | undefined,
          onUpdate: undefined,
          ctx: { cwd: string },
        ) => Promise<{ content: Array<{ type: "text"; text: string }> }>;
      }
    | undefined;
  factory({
    registerTool: (tool) => {
      registered = tool as typeof registered;
    },
  });
  const result = await registered!.execute("call_2", { plan: "   " }, undefined, undefined, {
    cwd: "/tmp",
  });
  expect(called).toBe(false);
  expect(result.content[0]?.text).toContain("empty");
});

test("Plan session exposes finalize_plan as an active tool and lists it in the system prompt", async () => {
  const agentDir = await mkdtemp(path.join(tmpdir(), "eco-pi-plan-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  await mkdir(path.join(agentDir, "skills"), { recursive: true });

  const pi = await import("@earendil-works/pi-coding-agent");
  const { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } = pi;

  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false } });
  const resourceLoader = new DefaultResourceLoader({
    cwd: agentDir,
    agentDir,
    settingsManager,
    noExtensions: true,
    extensionFactories: [
      {
        name: PI_FINALIZE_PLAN_EXTENSION_NAME,
        factory: createEcoPiFinalizePlanExtensionFactory({
          onSubmitted: () => {},
        }) as never,
      },
    ],
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    appendSystemPromptOverride: () => [piSystemPromptForSessionMode("plan")],
  });
  await resourceLoader.reload();

  const modelRuntime = await ModelRuntime.create({
    authPath: path.join(agentDir, "auth.json"),
    modelsPath: path.join(agentDir, "models.json"),
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  const { session } = await createAgentSession({
    cwd: agentDir,
    agentDir,
    modelRuntime,
    resourceLoader: resourceLoader as never,
    tools: piToolsForSessionMode("plan"),
    sessionManager: SessionManager.inMemory(agentDir),
    settingsManager,
  });

  try {
    expect(session.getActiveToolNames()).toContain(PI_FINALIZE_PLAN_TOOL_NAME);
    expect(session.systemPrompt).toContain("Available tools:");
    expect(session.systemPrompt).toMatch(/finalize_plan:/);
  } finally {
    session.dispose();
  }
});
