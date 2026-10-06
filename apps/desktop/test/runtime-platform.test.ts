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
    // Restored in the `finally`: the renderer's language is process-wide, and leaving it
    // in English failed every later file that asserts a Chinese string.
    const previousLanguage = i18n.resolvedLanguage ?? i18n.language;
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
      if (i18n.language !== previousLanguage) {
        await i18n.changeLanguage(previousLanguage);
      }
    }
  });
});
