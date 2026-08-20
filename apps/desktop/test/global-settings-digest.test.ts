import { expect, test } from "bun:test";
import {
  computeGlobalSettingsDigest,
  redactWorkflowSettingsForDigest,
} from "../src/shared/global-settings-digest";
import type { ModelSettingsSnapshot, WorkflowSettingsSnapshot } from "../src/shared/ipc";

const emptyModelSettings: ModelSettingsSnapshot = {
  providers: [],
  routeProfiles: [],
  agentTemplates: [],
  mainAgentConfigs: [],
  mainAgentPrompts: [],
  subagentOrchestrations: [],
};

const baseWorkflow: WorkflowSettingsSnapshot = {
  sessionMode: "agent",
  contextWindowLimitTokens: 262144,
  maxOutputLimitTokens: 32768,
  followUpDeliveryMode: "steer",
};

test("digest is stable across object key order", () => {
  const left = computeGlobalSettingsDigest({
    modelSettings: {
      ...emptyModelSettings,
      mcpSettings: { servers: [] },
    },
    workflowSettings: { ...baseWorkflow, showBilling: false },
  });
  const right = computeGlobalSettingsDigest({
    workflowSettings: { showBilling: false, ...baseWorkflow },
    modelSettings: {
      mcpSettings: { servers: [] },
      ...emptyModelSettings,
    },
  });
  expect(left.digest).toBe(right.digest);
  expect(left.digest).toMatch(/^[a-f0-9]{32}$/);
});

test("digest changes when workflow or model settings change", () => {
  const base = computeGlobalSettingsDigest({
    modelSettings: emptyModelSettings,
    workflowSettings: baseWorkflow,
  });
  const workflowChanged = computeGlobalSettingsDigest({
    modelSettings: emptyModelSettings,
    workflowSettings: { ...baseWorkflow, sessionMode: "plan" },
  });
  const modelChanged = computeGlobalSettingsDigest({
    modelSettings: {
      ...emptyModelSettings,
      mcpSettings: { servers: [] },
    },
    workflowSettings: baseWorkflow,
  });
  expect(workflowChanged.digest).not.toBe(base.digest);
  expect(modelChanged.digest).not.toBe(base.digest);
});

test("digest ignores acpCursorApiKey plaintext and only tracks presence", () => {
  const withoutKey = computeGlobalSettingsDigest({
    modelSettings: emptyModelSettings,
    workflowSettings: baseWorkflow,
  });
  const withKeyA = computeGlobalSettingsDigest({
    modelSettings: emptyModelSettings,
    workflowSettings: { ...baseWorkflow, acpCursorApiKey: "sk-aaa" },
  });
  const withKeyB = computeGlobalSettingsDigest({
    modelSettings: emptyModelSettings,
    workflowSettings: { ...baseWorkflow, acpCursorApiKey: "sk-bbb" },
  });
  expect(withKeyA.digest).toBe(withKeyB.digest);
  expect(withKeyA.digest).not.toBe(withoutKey.digest);
  expect(redactWorkflowSettingsForDigest({ ...baseWorkflow, acpCursorApiKey: "secret" })).toEqual({
    ...baseWorkflow,
    hasAcpCursorApiKey: true,
  });
});
