import { describe, expect, it } from "bun:test";
import {
  buildCommitModelOptions,
  commitModelDedupeKey,
  formatCommitModelDisplayName,
  findCommitModelOptionForCandidateId,
} from "../src/shared/commit-model-options";
import type { CommitModelPricingHint } from "../src/shared/ipc";
import type { CommitMessageCandidateModel } from "../src/shared/resolve-commit-message-route";

describe("commit-model-options", () => {
  it("builds options from all provider candidate models", () => {
    const candidates: CommitMessageCandidateModel[] = [
      {
        candidateModelId: "cand-1",
        providerId: "p1",
        providerName: "Anthropic",
        modelId: "claude-sonnet-4",
      },
      {
        candidateModelId: "cand-2",
        providerId: "p2",
        providerName: "OpenAI",
        modelId: "gpt-4.1-mini",
      },
    ];
    const hints: CommitModelPricingHint[] = [
      {
        candidateModelId: "cand-1",
        modelId: "claude-sonnet-4",
        providerName: "Anthropic",
        pricingResolved: true,
        rates: { inputPerM: 3, outputPerM: 15 },
      },
      {
        candidateModelId: "cand-2",
        modelId: "gpt-4.1-mini",
        providerName: "OpenAI",
        pricingResolved: true,
        rates: { inputPerM: 0.4, outputPerM: 1.6 },
      },
    ];

    const options = buildCommitModelOptions(candidates, hints);
    expect(options).toHaveLength(2);
    expect(options[0]?.modelLabel).toBe("gpt-4.1-mini");
    expect(options[1]?.modelLabel).toBe("claude-sonnet-4");
    expect(findCommitModelOptionForCandidateId(options, "cand-2")?.candidateModelId).toBe("cand-2");
  });

  it("formats long model ids for display", () => {
    expect(formatCommitModelDisplayName("vendor/very-long-model-name-for-testing-only")).toMatch(/…/);
    expect(commitModelDedupeKey("Anthropic", "sonnet", {
      candidateModelId: "cand-1",
      modelId: "sonnet",
      providerName: "Anthropic",
      pricingResolved: true,
      rates: { inputPerM: 1, outputPerM: 2 },
    })).toContain("anthropic::sonnet::");
  });
});
