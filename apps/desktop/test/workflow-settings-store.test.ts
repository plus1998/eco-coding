import { expect, test } from "bun:test";
import {
  isWorkflowSettingsSnapshot,
  normalizeWorkflowSettingsSnapshot,
} from "../src/main/workflow-settings-store";

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
