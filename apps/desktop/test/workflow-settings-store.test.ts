import { expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createWorkflowSettingsStore,
  isWorkflowSettingsSnapshot,
  normalizeWorkflowSettingsSnapshot,
} from "../src/main/workflow-settings-store";

const sqliteAvailable = await (async () => {
  try {
    await import("node:sqlite");
    return true;
  } catch {
    return false;
  }
})();

test("workflow settings preserve a valid default auxiliary model", () => {
  const snapshot = normalizeWorkflowSettingsSnapshot({
    sessionMode: "agent",
    defaultCoreKind: "codex",
    defaultAuxiliaryModel: {
      providerId: " provider ",
      modelId: " model ",
      candidateModelId: " candidate ",
    },
  });

  expect(snapshot.defaultAuxiliaryModel).toEqual({
    providerId: "provider",
    modelId: "model",
    candidateModelId: "candidate",
  });
  expect(isWorkflowSettingsSnapshot(snapshot)).toBe(true);
});

test("workflow settings reject an incomplete auxiliary model", () => {
  expect(
    isWorkflowSettingsSnapshot({
      sessionMode: "agent",
      defaultAuxiliaryModel: { providerId: "provider", modelId: "model" },
    }),
  ).toBe(false);
});

test.skipIf(!sqliteAvailable)("clears deleted subagent orchestration from the global default", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-workflow-settings-clear-"));
  const store = await createWorkflowSettingsStore(path.join(dir, "settings.db"));
  store.save({
    sessionMode: "agent",
    defaultCoreKind: "codex",
    defaultOrchestrationSelection: {
      mainAgentConfigId: "user.main",
      mainPrompt: { mode: "builtin" },
      subagents: { mode: "orchestration", orchestrationId: "user.orchestration" },
    },
  });

  expect(store.clearDefaultSubagentOrchestrationReference("user.orchestration")).toBe(true);
  expect(store.get().defaultOrchestrationSelection).toEqual({
    mainAgentConfigId: "user.main",
    mainPrompt: { mode: "builtin" },
    subagents: { mode: "none" },
  });
});
