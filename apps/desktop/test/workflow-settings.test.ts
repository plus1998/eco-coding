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
  expect(defaultWorkflowSettings()).toEqual({ sessionMode: "agent", defaultCoreKind: "claude" });
  expect(usesPlanMode(defaultWorkflowSettings())).toBe(false);
  expect(usesManualOrchestration(defaultWorkflowSettings())).toBe(false);
});

test("isWorkflowSettingsSnapshot accepts sessionMode", () => {
  expect(isWorkflowSettingsSnapshot({ sessionMode: "plan" })).toBe(true);
  expect(isWorkflowSettingsSnapshot({ sessionMode: "ask" })).toBe(true);
  expect(isWorkflowSettingsSnapshot({ sessionMode: "agent", defaultCoreKind: "codex" })).toBe(true);
  expect(isWorkflowSettingsSnapshot({ sessionMode: "agent", defaultCoreKind: "unknown" })).toBe(false);
  expect(isWorkflowSettingsSnapshot({ sessionMode: "invalid" })).toBe(false);
});

test("normalizeWorkflowSettingsSnapshot keeps valid sessionMode", () => {
  expect(normalizeWorkflowSettingsSnapshot({ sessionMode: "plan" })).toEqual({
    sessionMode: "plan",
    defaultCoreKind: "claude",
  });
  expect(normalizeWorkflowSettingsSnapshot({ sessionMode: "agent" })).toEqual({
    sessionMode: "agent",
    defaultCoreKind: "claude",
  });
  expect(normalizeWorkflowSettingsSnapshot({ sessionMode: "ask" })).toEqual({
    sessionMode: "ask",
    defaultCoreKind: "claude",
  });
  expect(normalizeWorkflowSettingsSnapshot({})).toEqual({
    sessionMode: "agent",
    defaultCoreKind: "claude",
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
    mcpServersEnabled: { mongo: true, browser: false },
  });
});

test("normalizeWorkflowSettingsSnapshot preserves a trimmed default Agent profile", () => {
  expect(
    normalizeWorkflowSettingsSnapshot({
      sessionMode: "agent",
      defaultAgentProfileId: "  profile-b  ",
    }),
  ).toEqual({
    sessionMode: "agent",
    defaultCoreKind: "claude",
    defaultAgentProfileId: "profile-b",
  });
});

test("normalizeWorkflowSettingsSnapshot preserves a valid default Core", () => {
  expect(normalizeWorkflowSettingsSnapshot({ sessionMode: "agent", defaultCoreKind: "codex" })).toEqual({
    sessionMode: "agent",
    defaultCoreKind: "codex",
  });
  expect(normalizeWorkflowSettingsSnapshot({ sessionMode: "agent", defaultCoreKind: "unknown" })).toEqual({
    sessionMode: "agent",
    defaultCoreKind: "claude",
  });
});

test.skipIf(!sqliteAvailable)("workflow settings store persists composer MCP selections", async () => {
  const dbPath = path.join(os.tmpdir(), `eco-workflow-settings-${Date.now()}.sqlite`);
  const store = await createWorkflowSettingsStore(dbPath);
  const saved = store.save({
    sessionMode: "plan",
    defaultCoreKind: "codex",
    defaultAgentProfileId: "profile-b",
    mcpServersEnabled: { mongo: true, browser: false },
  });
  expect(saved).toEqual({
    sessionMode: "plan",
    defaultCoreKind: "codex",
    defaultAgentProfileId: "profile-b",
    mcpServersEnabled: { mongo: true, browser: false },
  });
  expect(store.get()).toEqual(saved);
  await fs.rm(dbPath, { force: true });
});
