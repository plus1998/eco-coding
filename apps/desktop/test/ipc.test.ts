import { expect, test } from "bun:test";
import { IPC_CHANNELS, isKnownIpcChannel } from "../src/shared/ipc";

test("declares the core desktop IPC channels", () => {
  expect(IPC_CHANNELS.workspaceOpen).toBe("workspace:open");
  expect(IPC_CHANNELS.modelSettingsGet).toBe("model-settings:get");
  expect(IPC_CHANNELS.modelProviderSave).toBe("model-provider:save");
  expect(IPC_CHANNELS.modelRoutesSave).toBe("model-routes:save");
  expect(IPC_CHANNELS.threadStart).toBe("thread:start");
  expect(IPC_CHANNELS.threadApprovePlan).toBe("thread:approve-plan");
  expect(IPC_CHANNELS.threadDismissPlan).toBe("thread:dismiss-plan");
  expect(IPC_CHANNELS.threadContinue).toBe("thread:continue");
  expect(IPC_CHANNELS.threadTodoList).toBe("thread:todo-list");
  expect(IPC_CHANNELS.clarificationGetPending).toBe("clarification:get-pending");
  expect(IPC_CHANNELS.clarificationSubmit).toBe("clarification:submit");
  expect(IPC_CHANNELS.clarificationDismiss).toBe("clarification:dismiss");
  expect(IPC_CHANNELS.mcpSettingsGet).toBe("mcp-settings:get");
  expect(IPC_CHANNELS.skillsList).toBe("skills:list");
  expect(IPC_CHANNELS.mcpServerSave).toBe("mcp-server:save");
  expect(IPC_CHANNELS.approvalResolve).toBe("approval:resolve");
  expect(IPC_CHANNELS.conformanceRun).toBe("conformance:run");
});

test("guards unknown channels", () => {
  expect(isKnownIpcChannel("workspace:open")).toBe(true);
  expect(isKnownIpcChannel("model-settings:get")).toBe(true);
  expect(isKnownIpcChannel("thread:start")).toBe(true);
  expect(isKnownIpcChannel("unknown")).toBe(false);
});
