import { expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createProjectOrchestrationSettingsStore } from "../src/main/project-orchestration-settings-store";

const sqliteAvailable = await (async () => {
  try {
    await import("node:sqlite");
    return true;
  } catch {
    return false;
  }
})();

test.skipIf(!sqliteAvailable)("project orchestration settings persist by normalized workspace path", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-project-orchestration-"));
  const store = await createProjectOrchestrationSettingsStore(path.join(dir, "settings.db"));
  const workspacePath = path.join(dir, "repo", "..", "repo");
  const selection = {
    mainAgentConfigId: " user.main ",
    mainPrompt: { mode: "builtin" as const },
    subagents: { mode: "none" as const },
  };

  expect(store.get(workspacePath)).toEqual({ workspacePath: path.resolve(workspacePath) });
  expect(store.save({ workspacePath, orchestrationSelection: selection })).toEqual({
    workspacePath: path.resolve(workspacePath),
    orchestrationSelection: { ...selection, mainAgentConfigId: "user.main" },
  });
  expect(store.get(path.resolve(workspacePath)).orchestrationSelection?.mainAgentConfigId).toBe(
    "user.main",
  );
  expect(store.listSelections()).toHaveLength(1);
});
