import { describe, expect, it } from "bun:test";
import {
  buildCommitModelOptions,
  commitModelDedupeKey,
  formatCommitModelDisplayName,
  findCommitModelOptionForRole,
} from "../src/shared/commit-model-options";
import type { RoutePricingHint, RuntimeRoleRouteConfig } from "../src/shared/ipc";

const enabled = new Set(["explore", "coder", "reviewer"] as const);

describe("commit-model-options", () => {
  it("dedupes by provider, model, and pricing", () => {
    const routes: RuntimeRoleRouteConfig[] = [
      { role: "explore", providerId: "p1", modelId: "claude-sonnet-4" },
      { role: "coder", providerId: "p1", modelId: "claude-sonnet-4" },
      { role: "reviewer", providerId: "p2", modelId: "gpt-4.1-mini" },
    ];
    const hints: RoutePricingHint[] = [
      {
        role: "explore",
        modelId: "claude-sonnet-4",
        providerName: "Anthropic",
        pricingResolved: true,
        rates: { inputPerM: 3, outputPerM: 15 },
      },
      {
        role: "coder",
        modelId: "claude-sonnet-4",
        providerName: "Anthropic",
        pricingResolved: true,
        rates: { inputPerM: 3, outputPerM: 15 },
      },
      {
        role: "reviewer",
        modelId: "gpt-4.1-mini",
        providerName: "OpenAI",
        pricingResolved: true,
        rates: { inputPerM: 0.4, outputPerM: 1.6 },
      },
    ];

    const options = buildCommitModelOptions(routes, hints, enabled);
    expect(options).toHaveLength(2);
    expect(options[0]?.modelLabel).toBe("gpt-4.1-mini");
    expect(options[1]?.modelLabel).toBe("claude-sonnet-4");
    expect(findCommitModelOptionForRole(options, "coder", routes, hints)?.role).toBe("explore");
  });

  it("formats long model ids for display", () => {
    expect(formatCommitModelDisplayName("vendor/very-long-model-name-for-testing-only")).toMatch(/…/);
    expect(commitModelDedupeKey("Anthropic", "sonnet", {
      role: "coder",
      modelId: "sonnet",
      providerName: "Anthropic",
      pricingResolved: true,
      rates: { inputPerM: 1, outputPerM: 2 },
    })).toContain("anthropic::sonnet::");
  });
});
