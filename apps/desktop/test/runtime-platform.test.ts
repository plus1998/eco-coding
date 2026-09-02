import { describe, expect, test } from "bun:test";
import { i18n } from "../src/renderer/i18n";
import { getRuntimePlatformLabel } from "../src/renderer/runtime-platform";

describe("runtime-platform", () => {
  test("getRuntimePlatformLabel detects platform from navigator", () => {
    const previousNavigator = globalThis.navigator;

    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        platform: "MacIntel",
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      },
    });

    try {
      expect(getRuntimePlatformLabel()).toBe("macOS");
    } finally {
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: previousNavigator,
      });
    }
  });

  test("getRuntimePlatformLabel localizes the unknown platform fallback", async () => {
    const previousNavigator = globalThis.navigator;
    await i18n.changeLanguage("en-US");
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { platform: "", userAgent: "" },
    });

    try {
      expect(getRuntimePlatformLabel()).toBe("current system");
    } finally {
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: previousNavigator,
      });
    }
  });
});
