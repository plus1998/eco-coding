/**
 * Read-only authenticated Supabase Center smoke test for the DEV Electron app.
 *
 * This intentionally does not register devices, revoke bindings, change sync
 * settings, or publish conversation data. It only reconnects the already
 * configured DEV session and reads the authenticated binding/presence/sync
 * surfaces exposed by the preload API.
 */
import { chromium } from "@playwright/test";

const cdpUrl = process.env.ECO_DEV_CDP_URL ?? "http://127.0.0.1:9333";

const browser = await chromium.connectOverCDP(cdpUrl);
try {
  const context = browser.contexts()[0];
  if (!context) {
    throw new Error("No browser context from CDP");
  }
  const page = context.pages().find((candidate) => candidate.url().includes("5173")) ?? context.pages()[0];
  if (!page) {
    throw new Error("No page from CDP");
  }

  const result = await page.evaluate(async () => {
    if (!window.eco) {
      throw new Error("window.eco is not ready");
    }

    // start() is safe for this smoke: it reconnects the existing local
    // session, but does not register or revoke a device/binding.
    const connected = await window.eco.connectCenterServer();
    const [settings, bindings, presence, sync] = await Promise.all([
      window.eco.getCenterServerSettings(),
      window.eco.listCenterServerBindings(),
      window.eco.listCenterServerPresence(),
      window.eco.getCenterServerSyncStatus(),
    ]);

    const domainEntries = Array.isArray(sync?.domains) ? sync.domains : [];
    const onlinePresence = Array.isArray(presence) ? presence.filter((entry) => entry?.online) : [];
    const activeBindings = Array.isArray(bindings) ? bindings.filter((entry) => !entry?.revokedAt) : [];
    const domainStateCounts = Object.fromEntries(
      [...new Set(domainEntries.map((entry) => entry?.state).filter(Boolean))].map((state) => [
        state,
        domainEntries.filter((entry) => entry?.state === state).length,
      ]),
    );

    return {
      connected: {
        state: connected?.status?.state,
        enabled: connected?.settings?.enabled,
        hasAnonKey: connected?.settings?.hasAnonKey,
        hasDeviceSecret: connected?.settings?.hasDeviceSecret,
        hasRefreshToken: connected?.settings?.hasRefreshToken,
      },
      settings: {
        state: settings?.status?.state,
        enabled: settings?.settings?.enabled,
        hasAnonKey: settings?.settings?.hasAnonKey,
        hasDeviceSecret: settings?.settings?.hasDeviceSecret,
        hasRefreshToken: settings?.settings?.hasRefreshToken,
        htmlHostingAvailable: settings?.htmlHosting?.available,
      },
      bindings: {
        count: Array.isArray(bindings) ? bindings.length : 0,
        active: activeBindings.length,
        capabilitySets: activeBindings.map((entry) => [...(entry?.capabilities ?? [])].sort()),
      },
      presence: {
        count: Array.isArray(presence) ? presence.length : 0,
        online: onlinePresence.length,
        onlineKinds: [...new Set(onlinePresence.map((entry) => entry?.kind).filter(Boolean))].sort(),
      },
      sync: {
        domainCount: domainEntries.length,
        domainStateCounts,
      },
    };
  });

  const failures = [];
  if (result.connected.state !== "connected" || result.settings.state !== "connected") {
    failures.push("authenticated center connection is not connected");
  }
  if (
    !result.connected.enabled ||
    !result.connected.hasAnonKey ||
    !result.connected.hasDeviceSecret ||
    !result.connected.hasRefreshToken
  ) {
    failures.push("configured authenticated session is incomplete");
  }
  if (
    !result.settings.enabled ||
    !result.settings.hasAnonKey ||
    !result.settings.hasDeviceSecret ||
    !result.settings.hasRefreshToken
  ) {
    failures.push("authenticated settings snapshot is incomplete");
  }
  if (result.bindings.active < 1) {
    failures.push("authenticated center has no active binding");
  }
  if (
    !result.bindings.capabilitySets.some(
      (capabilities) => capabilities.includes("events:read") && capabilities.includes("rpc:invoke"),
    )
  ) {
    failures.push("active binding has no events:read + rpc:invoke capability pair");
  }
  if (result.presence.online < 1) {
    failures.push("authenticated presence has no online device");
  }
  if (result.sync.domainCount === 0) {
    failures.push("authenticated settings sync returned no domains");
  }

  console.log("[cdp-center]", JSON.stringify(result, null, 2));
  if (failures.length > 0) {
    throw new Error(failures.join("; "));
  }
  console.log("[cdp-center] PASS — authenticated binding, presence, and settings-sync reads succeeded");
} finally {
  await browser.close();
}
