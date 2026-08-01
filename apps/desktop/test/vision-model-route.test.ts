import { describe, expect, test } from "bun:test";
import {
  normalizeVisionModelSelection,
  isVisionModelSelection,
} from "../src/shared/vision-model";
import { resolveVisionModelRoute } from "../src/main/vision-model-route";
import type { ProviderStore } from "../src/main/provider-store";

describe("vision model selection", () => {
  test("normalizes a complete selection", () => {
    expect(
      normalizeVisionModelSelection({
        providerId: " p1 ",
        modelId: " vision ",
        candidateModelId: " c1 ",
      }),
    ).toEqual({
      providerId: "p1",
      modelId: "vision",
      candidateModelId: "c1",
    });
  });

  test("rejects incomplete selections", () => {
    expect(isVisionModelSelection({ providerId: "p1", modelId: "m1" })).toBe(false);
    expect(normalizeVisionModelSelection({ providerId: "p1", modelId: "m1" })).toBeUndefined();
  });
});

describe("resolveVisionModelRoute", () => {
  test("throws when selection is missing", () => {
    const providerStore = {
      listProvidersWithSecrets: () => [],
      listCandidateModels: () => [],
    } as unknown as ProviderStore;
    expect(() => resolveVisionModelRoute(undefined, providerStore)).toThrow(/未配置视觉模型/);
  });

  test("resolves a configured vision model route", () => {
    const provider = {
      id: "provider-1",
      name: "Provider",
      enabled: true,
      apiCompat: "openai",
      baseUrl: "https://example.test",
    };
    const providerStore = {
      listProvidersWithSecrets: () => [provider],
      listCandidateModels: () => [
        {
          id: "candidate-vision",
          providerId: "provider-1",
          modelId: "vision-model",
          sortOrder: 0,
          createdAt: "",
          updatedAt: "",
          manualSpec: { supportsImageInput: true, maxOutputTokens: 4096 },
        },
      ],
    } as unknown as ProviderStore;

    const route = resolveVisionModelRoute(
      {
        providerId: "provider-1",
        modelId: "vision-model",
        candidateModelId: "candidate-vision",
      },
      providerStore,
    );

    expect(route.role).toBe("vision");
    expect(route.modelId).toBe("vision-model");
    expect(route.provider.id).toBe("provider-1");
    expect(route.manualSpec?.supportsImageInput).toBe(true);
  });

  test("rejects a stale model id", () => {
    const provider = {
      id: "provider-1",
      name: "Provider",
      enabled: true,
      apiCompat: "openai",
      baseUrl: "https://example.test",
    };
    const providerStore = {
      listProvidersWithSecrets: () => [provider],
      listCandidateModels: () => [
        {
          id: "candidate-vision",
          providerId: "provider-1",
          modelId: "vision-model-v2",
          sortOrder: 0,
          createdAt: "",
          updatedAt: "",
        },
      ],
    } as unknown as ProviderStore;

    expect(() =>
      resolveVisionModelRoute(
        {
          providerId: "provider-1",
          modelId: "vision-model",
          candidateModelId: "candidate-vision",
        },
        providerStore,
      ),
    ).toThrow(/配置已发生变化/);
  });
});
