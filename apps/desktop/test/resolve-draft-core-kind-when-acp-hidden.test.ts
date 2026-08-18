import { expect, test } from "bun:test";
import { resolveDraftCoreKindWhenAcpHidden } from "../src/shared/resolve-draft-core-kind-when-acp-hidden";

test("keeps acp while probe pending", () => {
  expect(
    resolveDraftCoreKindWhenAcpHidden({
      draftCoreKind: "acp",
      coreAvailabilityResolved: false,
      showAcpCursor: false,
      defaultCoreKind: "acp",
    }),
  ).toBeUndefined();
});

test("demotes acp once probe resolved and cursor unavailable", () => {
  expect(
    resolveDraftCoreKindWhenAcpHidden({
      draftCoreKind: "acp",
      coreAvailabilityResolved: true,
      showAcpCursor: false,
      defaultCoreKind: "acp",
    }),
  ).toBe("claude");
});

test("keeps acp while a Cursor selection probe is in flight", () => {
  expect(
    resolveDraftCoreKindWhenAcpHidden({
      draftCoreKind: "acp",
      coreAvailabilityResolved: true,
      showAcpCursor: false,
      selectionInFlight: true,
      defaultCoreKind: "claude",
    }),
  ).toBeUndefined();
});

test("demotes to non-acp default when probe says unavailable", () => {
  expect(
    resolveDraftCoreKindWhenAcpHidden({
      draftCoreKind: "acp",
      coreAvailabilityResolved: true,
      showAcpCursor: false,
      defaultCoreKind: "codex",
    }),
  ).toBe("codex");
});

test("keeps draft when showAcpCursor is true", () => {
  expect(
    resolveDraftCoreKindWhenAcpHidden({
      draftCoreKind: "acp",
      coreAvailabilityResolved: true,
      showAcpCursor: true,
      defaultCoreKind: "claude",
    }),
  ).toBeUndefined();
});

test("ignores non-acp drafts", () => {
  expect(
    resolveDraftCoreKindWhenAcpHidden({
      draftCoreKind: "claude",
      coreAvailabilityResolved: false,
      showAcpCursor: false,
      defaultCoreKind: "codex",
    }),
  ).toBeUndefined();
});

test("falls back to claude when default is acp or missing", () => {
  expect(
    resolveDraftCoreKindWhenAcpHidden({
      draftCoreKind: "acp",
      coreAvailabilityResolved: true,
      showAcpCursor: false,
      defaultCoreKind: "acp",
    }),
  ).toBe("claude");
  expect(
    resolveDraftCoreKindWhenAcpHidden({
      draftCoreKind: "acp",
      coreAvailabilityResolved: true,
      showAcpCursor: false,
    }),
  ).toBe("claude");
});
