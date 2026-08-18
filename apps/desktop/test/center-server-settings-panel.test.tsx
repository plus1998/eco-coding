import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { CenterServerSettingsPanel } from "../src/renderer/CenterServerSettingsPanel";
import type { CenterServerSettingsSnapshot } from "../src/shared/center-server";
import { renderLocalized } from "./i18n-test";

const connectedSnapshot: CenterServerSettingsSnapshot = {
  settings: {
    enabled: true,
    serverUrl: "http://127.0.0.1:3128",
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
      onSignUp: async () => snapshot,
      onSignIn: async () => snapshot,
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
  expect(source).toContain(
    "const actionBusy = busy || testing || pairingBusy || connectionBusy || saveBusy || authBusy;",
  );
  expect(source).not.toContain("connectionBusy || bindingsLoading || saveBusy");
});
