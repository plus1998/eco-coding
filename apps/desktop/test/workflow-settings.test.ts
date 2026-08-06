import { expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createWorkflowSettingsStore,
  defaultWorkflowSettings,
  isWorkflowSettingsSnapshot,
  normalizeWorkflowSettingsSnapshot,
  orchestrationModeFromSnapshot,
  usesManualOrchestration,
  usesPlanMode,
  usesPlanOrchestration,
} from "../src/main/workflow-settings-store";

const sqliteAvailable = await (async () => {
  try {
    await import("node:sqlite");
    return true;
  } catch {
    return false;
  }
})();

test("session mode defaults to agent", () => {
  expect(defaultWorkflowSettings()).toEqual({
    sessionMode: "agent",
    defaultCoreKind: "claude",
    contextWindowLimitTokens: 262_144,
    maxOutputLimitTokens: 32_000,
  });
  expect(usesPlanMode(defaultWorkflowSettings())).toBe(false);
  expect(usesManualOrchestration(defaultWorkflowSettings())).toBe(false);
});

test("isWorkflowSettingsSnapshot accepts sessionMode", () => {
  expect(isWorkflowSettingsSnapshot({ sessionMode: "plan" })).toBe(true);
  expect(isWorkflowSettingsSnapshot({ sessionMode: "ask" })).toBe(true);
  expect(isWorkflowSettingsSnapshot({ sessionMode: "agent", defaultCoreKind: "codex" })).toBe(true);
  expect(
    isWorkflowSettingsSnapshot({
      sessionMode: "agent",
      contextWindowLimitTokens: 524_288,
    }),
  ).toBe(true);
  expect(
    isWorkflowSettingsSnapshot({
      sessionMode: "agent",
      maxOutputLimitTokens: 32_000,
    }),
  ).toBe(true);
  expect(
    isWorkflowSettingsSnapshot({
      sessionMode: "agent",
      contextWindowLimitTokens: 300_000,
    }),
  ).toBe(false);
  expect(
    isWorkflowSettingsSnapshot({
      sessionMode: "agent",
      maxOutputLimitTokens: 30_000,
    }),
  ).toBe(false);
  expect(isWorkflowSettingsSnapshot({ sessionMode: "agent", defaultCoreKind: "unknown" })).toBe(false);
  expect(isWorkflowSettingsSnapshot({ sessionMode: "invalid" })).toBe(false);
});

test("normalizeWorkflowSettingsSnapshot keeps valid sessionMode", () => {
  expect(normalizeWorkflowSettingsSnapshot({ sessionMode: "plan" })).toEqual({
    sessionMode: "plan",
    defaultCoreKind: "claude",
    contextWindowLimitTokens: 262_144,
    maxOutputLimitTokens: 32_000,
  });
  expect(normalizeWorkflowSettingsSnapshot({ sessionMode: "agent" })).toEqual({
    sessionMode: "agent",
    defaultCoreKind: "claude",
    contextWindowLimitTokens: 262_144,
    maxOutputLimitTokens: 32_000,
  });
  expect(normalizeWorkflowSettingsSnapshot({ sessionMode: "ask" })).toEqual({
    sessionMode: "ask",
    defaultCoreKind: "claude",
    contextWindowLimitTokens: 262_144,
    maxOutputLimitTokens: 32_000,
  });
  expect(normalizeWorkflowSettingsSnapshot({})).toEqual({
    sessionMode: "agent",
    defaultCoreKind: "claude",
    contextWindowLimitTokens: 262_144,
    maxOutputLimitTokens: 32_000,
  });
});

test("orchestrationModeFromSnapshot maps session mode to runtime mode", () => {
  expect(orchestrationModeFromSnapshot({ sessionMode: "plan" })).toBe("manual");
  expect(orchestrationModeFromSnapshot({ sessionMode: "agent" })).toBe("autonomous");
  expect(orchestrationModeFromSnapshot({ sessionMode: "ask" })).toBe("autonomous");
});

test("usesPlanOrchestration is alias for plan session mode", () => {
  expect(usesPlanOrchestration({ sessionMode: "plan" })).toBe(true);
  expect(usesPlanOrchestration({ sessionMode: "agent" })).toBe(false);
});

test("normalizeWorkflowSettingsSnapshot preserves composer MCP defaults", () => {
  expect(
    normalizeWorkflowSettingsSnapshot({
      sessionMode: "agent",
      mcpServersEnabled: { mongo: true, browser: false },
    }),
  ).toEqual({
    sessionMode: "agent",
    defaultCoreKind: "claude",
    contextWindowLimitTokens: 262_144,
    maxOutputLimitTokens: 32_000,
    mcpServersEnabled: { mongo: true, browser: false },
  });
});

test("normalizeWorkflowSettingsSnapshot preserves default orchestration selection", () => {
  const selection = {
    mainAgentConfigId: "user.main",
    mainPrompt: { mode: "builtin" as const },
    subagents: { mode: "none" as const },
  };
  expect(
    normalizeWorkflowSettingsSnapshot({
      sessionMode: "agent",
      defaultOrchestrationSelection: selection,
    }),
  ).toEqual({
    sessionMode: "agent",
    defaultCoreKind: "claude",
    contextWindowLimitTokens: 262_144,
    maxOutputLimitTokens: 32_000,
    defaultOrchestrationSelection: selection,
  });
});

test("normalizeWorkflowSettingsSnapshot preserves a valid default Core", () => {
  expect(normalizeWorkflowSettingsSnapshot({ sessionMode: "agent", defaultCoreKind: "codex" })).toEqual({
    sessionMode: "agent",
    defaultCoreKind: "codex",
    contextWindowLimitTokens: 262_144,
    maxOutputLimitTokens: 32_000,
  });
  expect(normalizeWorkflowSettingsSnapshot({ sessionMode: "agent", defaultCoreKind: "unknown" })).toEqual({
    sessionMode: "agent",
    defaultCoreKind: "claude",
    contextWindowLimitTokens: 262_144,
    maxOutputLimitTokens: 32_000,
  });
});

test("normalizeWorkflowSettingsSnapshot preserves supported context and max output limits", () => {
  expect(
    normalizeWorkflowSettingsSnapshot({
      sessionMode: "agent",
      contextWindowLimitTokens: 1_048_576,
    }).contextWindowLimitTokens,
  ).toBe(1_048_576);
  expect(
    normalizeWorkflowSettingsSnapshot({
      sessionMode: "agent",
      contextWindowLimitTokens: 300_000,
    }).contextWindowLimitTokens,
  ).toBe(262_144);
  expect(
    normalizeWorkflowSettingsSnapshot({
      sessionMode: "agent",
      maxOutputLimitTokens: 64_000,
    }).maxOutputLimitTokens,
  ).toBe(64_000);
  expect(
    normalizeWorkflowSettingsSnapshot({
      sessionMode: "agent",
      maxOutputLimitTokens: 384_000,
    }).maxOutputLimitTokens,
  ).toBe(32_000);
});

test.skipIf(!sqliteAvailable)("workflow settings store persists composer MCP selections", async () => {
  const dbPath = path.join(os.tmpdir(), `eco-workflow-settings-${Date.now()}.sqlite`);
  const store = await createWorkflowSettingsStore(dbPath);
  const saved = store.save({
    sessionMode: "plan",
    defaultCoreKind: "codex",
    contextWindowLimitTokens: 524_288,
    maxOutputLimitTokens: 64_000,
    defaultOrchestrationSelection: {
      mainAgentConfigId: "user.main",
      mainPrompt: { mode: "builtin" },
      subagents: { mode: "none" },
    },
    mcpServersEnabled: { mongo: true, browser: false },
  });
  expect(saved).toEqual({
    sessionMode: "plan",
    defaultCoreKind: "codex",
    contextWindowLimitTokens: 524_288,
    maxOutputLimitTokens: 64_000,
    defaultOrchestrationSelection: {
      mainAgentConfigId: "user.main",
      mainPrompt: { mode: "builtin" },
      subagents: { mode: "none" },
    },
    mcpServersEnabled: { mongo: true, browser: false },
  });
  expect(store.get()).toEqual(saved);
  await fs.rm(dbPath, { force: true });
});
