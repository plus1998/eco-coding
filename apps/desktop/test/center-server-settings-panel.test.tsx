import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { CenterServerSettingsPanel } from "../src/renderer/CenterServerSettingsPanel";
import type { CenterServerSettingsSnapshot } from "../src/shared/center-server";
import { renderLocalized } from "./i18n-test";

const connectedSnapshot: CenterServerSettingsSnapshot = {
  settings: {
    enabled: true,
    supabaseUrl: "https://example.supabase.co",
    serverUrl: "https://example.supabase.co",
    hasAnonKey: true,
    deviceId: "dev_1",
    deviceName: "Eco Desktop",
    hasDeviceSecret: true,
    hasRefreshToken: true,
  },
  status: {
    state: "connected",
    connectedAt: "2026-08-18T00:00:00.000Z",
  },
};

function renderPanel(snapshot: CenterServerSettingsSnapshot = connectedSnapshot, busy = false) {
  return renderLocalized(
    createElement(CenterServerSettingsPanel, {
      snapshot,
      busy,
      onSave: async () => snapshot,
      onTestConnection: async () => ({ ok: true }),
      onSignUp: async () => ({ ...snapshot, user: { id: "u1", email: "a@b.c", displayName: null, createdAt: "2026-08-18T00:00:00.000Z" } }),
      onSignIn: async () => ({ ...snapshot, user: { id: "u1", email: "a@b.c", displayName: null, createdAt: "2026-08-18T00:00:00.000Z" } }),
      onCreatePairing: async () => ({
        pairingId: "pair_1",
        code: "123456",
        bootstrapToken: "token",
        qrPayload: "eco://pair",
        expiresAt: "2026-08-18T01:00:00.000Z",
      }),
      onListBindings: async () => [],
      onListPresence: async () => [],
      onRevokeBinding: async () => ({
        id: "bind_1",
        userId: "user_1",
        desktopDeviceId: "dev_1",
        mobileDeviceId: "mob_1",
        capabilities: [],
        createdAt: "2026-08-18T00:00:00.000Z",
        revokedAt: null,
      }),
      onConnect: async () => snapshot,
      onDisconnect: async () => snapshot,
      onRemoveConnection: async () => snapshot,
      onGetVaultStatus: async () => ({ hasVaultKey: false, state: "idle" as const }),
      onSyncConfig: async () => ({
        mode: "pull" as const,
        settingsPushed: false,
        settingsPulled: false,
        secretsPushed: 0,
        secretsPulled: 0,
        syncedAt: "2026-08-18T00:00:00.000Z",
        vaultKeyCreated: false,
        vaultStatus: { hasVaultKey: false, state: "idle" as const },
      }),
      onRequestVaultClaim: async () => ({
        claimId: "claim_1",
        expiresAt: "2026-08-18T01:00:00.000Z",
      }),
      onListPendingVaultClaims: async () => [],
      onApproveVaultClaim: async () => ({
        claimId: "claim_1",
        code: "123456",
        expiresAt: "2026-08-18T01:00:00.000Z",
      }),
      onSubmitVaultClaimCode: async () => ({
        ok: true,
        vaultStatus: { hasVaultKey: true, state: "idle" as const },
      }),
      onCancelVaultClaim: async () => ({ hasVaultKey: false, state: "idle" as const }),
    }),
    "zh-CN",
  );
}

test("connected connection panel keeps switch and delete enabled", () => {
  const markup = renderPanel();

  expect(markup).toContain("互联");
  expect(markup).toContain("删除连接");
  expect(markup).toContain('<input type="checkbox" checked=""/>');
  expect(markup).not.toMatch(/type="checkbox"[^>]*disabled/);
  expect(markup).not.toMatch(/cs-text-action is-muted"[^>]*disabled[^>]*>[\s\S]*?删除连接/);
});

test("saving still disables switch and delete", () => {
  const markup = renderPanel(connectedSnapshot, true);

  expect(markup).toMatch(/type="checkbox"[^>]*disabled/);
  expect(markup).toMatch(/cs-text-action is-muted"[^>]*disabled[^>]*>[\s\S]*?删除连接/);
});

test("bindings loading is not part of connection action busy", () => {
  const source = readFileSync(new URL("../src/renderer/CenterServerSettingsPanel.tsx", import.meta.url), "utf8");
  expect(source).toContain("connectionBusy || saveBusy || authBusy || vaultBusy");
  expect(source).not.toContain("connectionBusy || bindingsLoading || saveBusy");
});
