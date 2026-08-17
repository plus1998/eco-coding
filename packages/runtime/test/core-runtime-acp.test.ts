import { expect, test } from "bun:test";
import {
  ACP_CORE_CAPABILITIES,
  CORE_KINDS,
  isCoreKind,
  type AcpAgentId,
} from "../src/core-runtime";

test("CORE_KINDS includes acp and excludes first-class cursor", () => {
  expect(CORE_KINDS).toContain("acp");
  expect(CORE_KINDS).not.toContain("cursor");
});

test("isCoreKind accepts acp and rejects cursor", () => {
  expect(isCoreKind("acp")).toBe(true);
  expect(isCoreKind("cursor")).toBe(false);
});

test("AcpAgentId MVP is cursor", () => {
  const id: AcpAgentId = "cursor";
  expect(id).toBe("cursor");
});

test("ACP_CORE_CAPABILITIES advertises plan/ask and eco planApproval", () => {
  expect(ACP_CORE_CAPABILITIES.toolApproval).toBe("unsupported");
  expect(ACP_CORE_CAPABILITIES.planApproval).toBe("eco");
  expect(ACP_CORE_CAPABILITIES.sessionModes).toEqual(["agent", "plan", "ask"]);
});
