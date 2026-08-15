import { expect, test } from "bun:test";
import { decideAcpResume, isAcpLoadSessionFailure } from "../src/main/acp-runtime-run";
import { resolveAcpThreadAgentId } from "../src/main/resolve-acp-thread-agent-id";

test("resolveAcpThreadAgentId defaults missing id to cursor", () => {
  expect(resolveAcpThreadAgentId({})).toBe("cursor");
  expect(resolveAcpThreadAgentId({ acpAgentId: undefined })).toBe("cursor");
});

test("resolveAcpThreadAgentId accepts cursor", () => {
  expect(resolveAcpThreadAgentId({ acpAgentId: "cursor" })).toBe("cursor");
});

test("resolveAcpThreadAgentId rejects unsupported ids", () => {
  expect(() => resolveAcpThreadAgentId({ acpAgentId: "other" })).toThrow(/Unsupported acpAgentId/);
});

test("isAcpLoadSessionFailure detects ACP_LOAD_SESSION_UNSUPPORTED", () => {
  expect(isAcpLoadSessionFailure("ACP_LOAD_SESSION_UNSUPPORTED: agent did not advertise")).toBe(true);
  expect(isAcpLoadSessionFailure("failed session/load")).toBe(true);
  expect(isAcpLoadSessionFailure("network timeout")).toBe(false);
});

test("decideAcpResume: fresh when not continuation", () => {
  expect(decideAcpResume({})).toEqual({ kind: "fresh" });
  expect(decideAcpResume({ continuation: false, externalSessionId: "s1" })).toEqual({ kind: "fresh" });
});

test("decideAcpResume: resume when continuation has session id", () => {
  expect(decideAcpResume({ continuation: true, externalSessionId: " sess_1 " })).toEqual({
    kind: "resume",
    sessionId: "sess_1",
  });
});

test("decideAcpResume: cannot_resume when continuation lacks session id", () => {
  expect(decideAcpResume({ continuation: true })).toEqual({ kind: "cannot_resume" });
  expect(decideAcpResume({ continuation: true, externalSessionId: "" })).toEqual({ kind: "cannot_resume" });
  expect(decideAcpResume({ continuation: true, externalSessionId: "   " })).toEqual({
    kind: "cannot_resume",
  });
  expect(decideAcpResume({ continuation: true, externalSessionId: null })).toEqual({
    kind: "cannot_resume",
  });
});
