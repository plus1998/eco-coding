import { expect, test } from "bun:test";
import { applyAcpCursorEnableSave, reconcileAcpCursorEnabled } from "../src/main/acp-cursor-availability";

test("rising-edge enable rejected when probe fails", () => {
  expect(() =>
    applyAcpCursorEnableSave({
      nextEnabled: true,
      current: {},
      probe: { available: false, reasonKey: "handshakeFailed", detail: "auth" },
      probeFailedMessage: "probe-failed",
    }),
  ).toThrow("probe-failed");
});

test("already-enabled + probe fails → disables (and can keep other save fields)", () => {
  const patch = applyAcpCursorEnableSave({
    nextEnabled: true,
    current: { acpAgentsEnabled: { cursor: true }, defaultCoreKind: "acp" },
    probe: { available: false, reasonKey: "missingCli" },
    probeFailedMessage: "probe-failed",
  });
  expect(patch).toEqual({ acpCursorEnabled: false, defaultCoreKind: "claude" });
  const otherFields = { sessionMode: "agent", contextWindowLimitTokens: 128_000 };
  expect({ ...otherFields, ...patch }).toMatchObject({
    sessionMode: "agent",
    contextWindowLimitTokens: 128_000,
    acpCursorEnabled: false,
    defaultCoreKind: "claude",
  });
});

test("disable falls back default core from acp", () => {
  expect(
    applyAcpCursorEnableSave({
      nextEnabled: false,
      current: { acpAgentsEnabled: { cursor: true }, defaultCoreKind: "acp" },
      probe: { available: true },
      probeFailedMessage: "probe-failed",
    }),
  ).toEqual({ acpCursorEnabled: false, defaultCoreKind: "claude" });
});

test("post-save reconcile must reuse rising-edge probe (no-op when available)", () => {
  const probe = { available: true } as const;
  const applied = applyAcpCursorEnableSave({
    nextEnabled: true,
    current: {},
    probe,
    probeFailedMessage: "probe-failed",
  });
  expect(applied).toEqual({ acpCursorEnabled: true });
  // Same probe that passed rising-edge must not clear enable (re-probe flake risk).
  expect(
    reconcileAcpCursorEnabled({
      acpCursorEnabled: true,
      defaultCoreKind: "acp",
      probe,
    }),
  ).toBeUndefined();
});
