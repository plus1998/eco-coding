import { expect, test } from "bun:test";
import {
  acpPermissionIsExecute,
  isAcpSwitchModePermission,
  parseAcpPermissionRequest,
  resolveAcpPermissionAutoAllow,
  shouldHostAutoAllowAcpPermission,
} from "../src/acp-permission.js";

const ALLOW_REJECT_OPTIONS = [
  { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
  { optionId: "reject-once", name: "Reject", kind: "reject_once" },
];

test("Eco 完全访问 auto-allows host-side; 替我审批/always do not", () => {
  const execute = parseAcpPermissionRequest({
    toolCall: { toolCallId: "call_sh", kind: "execute", title: "ls" },
    options: ALLOW_REJECT_OPTIONS,
  })!;
  expect(shouldHostAutoAllowAcpPermission({ bashReviewMode: "allow_all", request: execute })).toBe(
    true,
  );
  expect(shouldHostAutoAllowAcpPermission({ bashReviewMode: "auto", request: execute })).toBe(false);
  expect(shouldHostAutoAllowAcpPermission({ bashReviewMode: "always", request: execute })).toBe(
    false,
  );
});

test("parseAcpPermissionRequest requires toolCallId and selectable options", () => {
  expect(parseAcpPermissionRequest({})).toBeUndefined();
  expect(
    parseAcpPermissionRequest({
      toolCall: { toolCallId: "call_1" },
      options: ALLOW_REJECT_OPTIONS,
    })?.toolCall.toolCallId,
  ).toBe("call_1");
});

test("acpPermissionIsExecute treats rawInput.command as shell even without kind", () => {
  expect(
    acpPermissionIsExecute({ toolCallId: "call_sh", kind: "execute", rawInput: { command: "ls" } }),
  ).toBe(true);
  expect(
    acpPermissionIsExecute({ toolCallId: "call_sh", rawInput: { command: "ls -la" } }),
  ).toBe(true);
  expect(
    acpPermissionIsExecute({ toolCallId: "call_edit", kind: "edit", rawInput: { path: "a.ts" } }),
  ).toBe(false);
});

test("switch_mode permissions auto-allow even when Eco is always", () => {
  const request = parseAcpPermissionRequest({
    toolCall: { toolCallId: "call_switch", kind: "switch_mode", title: "Ready" },
    options: [
      { optionId: "agent", name: "Yes", kind: "allow_always" },
      { optionId: "reject", name: "No", kind: "reject_once" },
    ],
  })!;
  expect(isAcpSwitchModePermission(request)).toBe(true);
  expect(shouldHostAutoAllowAcpPermission({ bashReviewMode: "always", request })).toBe(true);
  expect(
    shouldHostAutoAllowAcpPermission({
      bashReviewMode: "always",
      request: parseAcpPermissionRequest({
        toolCall: { toolCallId: "call_sh", kind: "execute", title: "ls" },
        options: ALLOW_REJECT_OPTIONS,
      })!,
    }),
  ).toBe(false);
});

test("resolveAcpPermissionAutoAllow prefers allow_once", () => {
  expect(
    resolveAcpPermissionAutoAllow({
      toolCall: { toolCallId: "c1" },
      options: ALLOW_REJECT_OPTIONS,
    }),
  ).toEqual({ outcome: { outcome: "selected", optionId: "allow-once" } });
});
