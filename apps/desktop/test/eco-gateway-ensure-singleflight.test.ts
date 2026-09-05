import { afterEach, describe, expect, test } from "bun:test";
import {
  configureEcoGatewayLifecycle,
  ensureGlobalEcoGateway,
  EcoGatewayLifecycle,
  formatBridgePortInUseError,
  resetGlobalEcoGatewayForTests,
  stopGlobalEcoGateway,
} from "../src/main/eco-gateway-lifecycle";

afterEach(async () => {
  await resetGlobalEcoGatewayForTests().catch(() => undefined);
});

describe("eco-gateway ensure single-flight", () => {
  test("formatBridgePortInUseError includes occupant and health hint", () => {
    const message = formatBridgePortInUseError(18765, "Electron 12345 … TCP 127.0.0.1:18765 (LISTEN)", true);
    expect(message).toContain("18765");
    expect(message).toContain("Listener:");
    expect(message).toContain("/health");
  });

  test("concurrent ensureRunning only binds bridge once", async () => {
    const port = 18_760 + Math.floor(Math.random() * 200);
    const lifecycle = new EcoGatewayLifecycle({
      gatewayPort: port,
      listProviders: () => [
        {
          id: "p1",
          name: "P1",
          enabled: true,
          baseUrl: "https://api.example.test",
          apiKey: "sk-test",
          apiCompat: "anthropic",
          defaultModel: "m1",
          models: [{ modelId: "m1" }],
        },
      ],
      onStderr: () => undefined,
    });

    try {
      const [a, b, c] = await Promise.all([
        lifecycle.ensureRunning(),
        lifecycle.ensureRunning(),
        lifecycle.ensureRunning(),
      ]);
      expect(a).toHaveLength(1);
      expect(b).toHaveLength(1);
      expect(c).toHaveLength(1);
      expect(lifecycle.baseUrl).toBe(`http://127.0.0.1:${port}`);
      const health = await fetch(`${lifecycle.baseUrl}/health`);
      expect(health.ok).toBe(true);
      // Serial re-entry after start must not re-listen (still healthy).
      await lifecycle.ensureRunning();
      const health2 = await fetch(`${lifecycle.baseUrl}/health`);
      expect(health2.ok).toBe(true);
    } finally {
      await lifecycle.stop();
    }
  });

  test("stopGlobalEcoGateway keeps lifecycle so ensure can restart without reconfigure", async () => {
    const port = 18_760 + Math.floor(Math.random() * 200);
    configureEcoGatewayLifecycle({
      gatewayPort: port,
      listProviders: () => [
        {
          id: "p1",
          name: "P1",
          enabled: true,
          baseUrl: "https://api.example.test",
          apiKey: "sk-test",
          apiCompat: "anthropic",
          defaultModel: "m1",
          models: [{ modelId: "m1" }],
        },
      ],
      onStderr: () => undefined,
    });

    const first = await ensureGlobalEcoGateway();
    expect(first).toHaveLength(1);
    await stopGlobalEcoGateway();

    // Must not throw "lifecycle is not configured" — quit teardown used to clear the singleton.
    const second = await ensureGlobalEcoGateway();
    expect(second).toHaveLength(1);
  });

  test("resetGlobalEcoGatewayForTests clears singleton so ensure fails closed", async () => {
    configureEcoGatewayLifecycle({
      gatewayPort: 0,
      listProviders: () => [],
      onStderr: () => undefined,
    });
    await resetGlobalEcoGatewayForTests();
    await expect(ensureGlobalEcoGateway()).rejects.toThrow(/lifecycle is not configured/);
  });
});
