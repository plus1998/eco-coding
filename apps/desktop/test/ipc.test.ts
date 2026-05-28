import { expect, test } from "bun:test";
import { IPC_CHANNELS, isKnownIpcChannel } from "../src/shared/ipc";

test("declares the core desktop IPC channels", () => {
  expect(IPC_CHANNELS.workspaceOpen).toBe("workspace:open");
  expect(IPC_CHANNELS.threadStart).toBe("thread:start");
  expect(IPC_CHANNELS.approvalResolve).toBe("approval:resolve");
  expect(IPC_CHANNELS.conformanceRun).toBe("conformance:run");
});

test("guards unknown channels", () => {
  expect(isKnownIpcChannel("workspace:open")).toBe(true);
  expect(isKnownIpcChannel("thread:start")).toBe(true);
  expect(isKnownIpcChannel("unknown")).toBe(false);
});
