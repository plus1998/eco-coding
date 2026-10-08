import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveApprovalModelRoute, type SystemOneApprovalRoute } from "../src/main/approval-model-route";
import { resolveAuxiliaryModelRoute } from "../src/main/auxiliary-model-route";
import { reviewEcoApproval } from "../src/main/eco-approval-reviewer";
import { fetchUpstreamModelsFromCredentials, testProviderConnection } from "../src/main/provider-models";
import { createProviderStore } from "../src/main/provider-store";
import { resolveVisionModelRoute } from "../src/main/vision-model-route";
import { createWorkflowSettingsStore } from "../src/main/workflow-settings-store";
import { normalizeUpstreamApiCompat, resolveUpstreamApiCompat } from "../src/shared/api-compat";
import { listCommitMessageCandidateModels } from "../src/shared/resolve-commit-message-route";
import {
  buildAcpThreadRuntimeConfig,
  isThreadRuntimeConfig,
  normalizeThreadRuntimeConfig,
} from "../src/shared/thread-runtime-config";

const route: SystemOneApprovalRoute = {
  kind: "system_one",
  modelId: "jev-latest",
  provider: {
    id: "jev",
    name: "Jev",
    baseUrl: "https://api.typesafe.test",
    requestPath: "/gateway",
    version: "v2",
    apiCompat: "system_one",
    apiKey: "test-key",
    enabled: true,
    hasApiKey: true,
    defaultModel: "jev-latest",
    createdAt: "",
    updatedAt: "",
  },
};
const envelope = {
  userRequest: "检查仓库状态",
  toolName: "Bash",
  toolInput: { command: "git status" },
  cwd: "/repo",
  workspacePath: "/repo",
  reason: "inspect",
};
function choice(value: string, options: string[], confidence = 0.99) {
  return {
    type: "choice",
    choice: value,
    confidence,
    probabilities: Object.fromEntries(
      options.map((option) => [option, option === value ? 0.99 : 0.01 / (options.length - 1)]),
    ),
  };
}
function answers(risk = "low", authorization = "medium", decision = "allow", confidence = 0.99) {
  return {
    risk_level: choice(risk, ["low", "medium", "high", "critical"], confidence),
    user_authorization: choice(authorization, ["unknown", "low", "medium", "high"]),
    decision: choice(decision, ["allow", "human_required", "deny"]),
  };
}
function fetchAnswers(value: unknown): typeof fetch {
  return async () =>
    Response.json({ model: "jev-1.13", answers: value, usage: { input_tokens: 1, output_tokens: 1 } });
}

test("SystemOne reviews use state/questions and Bearer auth rather than a chat payload", async () => {
  const result = await reviewEcoApproval({
    route,
    envelope,
    locale: "zh-CN",
    fetcher: async (url, init) => {
      expect(String(url)).toBe("https://api.typesafe.test/gateway/v2/systemone");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-key");
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe("jev-latest");
      expect(body.state.evidence.plannedAction.input.command).toBe("git status");
      expect(Object.keys(body.questions)).toEqual(["risk_level", "user_authorization", "decision"]);
      expect(body.messages).toBeUndefined();
      expect(body.state.policy).toContain("user_authorization");
      return Response.json({ answers: answers() });
    },
  });
  expect(result.action).toBe("allow");
  expect(result.rationale).toContain("SystemOne");
});

for (const [risk, authorization, decision, confidence, action] of [
  ["critical", "high", "allow", 0.99, "deny"],
  ["low", "high", "deny", 0.99, "deny"],
  ["high", "low", "allow", 0.99, "human_required"],
  ["high", "high", "allow", 0.99, "allow"],
  ["low", "medium", "allow", 0.6, "human_required"],
  ["low", "medium", "human_required", 0.99, "human_required"],
] as const) {
  test(`SystemOne enforces risk/authorization/confidence: ${risk}/${authorization}/${decision}/${confidence}`, async () => {
    const result = await reviewEcoApproval({
      route,
      envelope,
      fetcher: fetchAnswers(answers(risk, authorization, decision, confidence)),
    });
    expect(result.action).toBe(action);
  });
}

test("malformed SystemOne distributions and HTTP failures stay visible and never allow", async () => {
  const invalid = answers();
  invalid.decision.probabilities.allow = 2;
  const result = await reviewEcoApproval({ route, envelope, fetcher: fetchAnswers(invalid) });
  expect(result.action).toBe("human_required");
  expect(result.policyMatches).toContain("review_failed_closed");
  expect(result.rationale).toContain("无效");
  const failed = await reviewEcoApproval({
    route,
    envelope,
    fetcher: async () => new Response("error", { status: 401 }),
  });
  expect(failed.action).toBe("human_required");
  expect(failed.rationale).toContain("HTTP 401");
});

test("SystemOne models discovery understands models/name and connection probes call systemone", async () => {
  const models = await fetchUpstreamModelsFromCredentials(
    "https://api.typesafe.test",
    "key",
    "",
    undefined,
    "system_one",
    undefined,
    "v1",
    async (_url, init) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer key");
      return Response.json({ models: [{ name: "jev-latest", description: "Jev" }, { name: "jev-1.13" }] });
    },
  );
  expect(models).toEqual({ ok: true, models: [{ id: "jev-1.13" }, { id: "jev-latest" }] });
  const probe = await testProviderConnection(
    {} as never,
    {
      baseUrl: "https://api.typesafe.test",
      requestPath: "",
      apiCompat: "system_one",
      apiKey: "key",
      defaultModel: "jev-latest",
    },
    async (url) => {
      expect(String(url)).toBe("https://api.typesafe.test/v1/systemone");
      return Response.json({ answers: { connection: choice("connected", ["connected", "unavailable"]) } });
    },
  );
  expect(probe.ok).toBe(true);
});

test("SystemOne is available only to approval selection and cannot be overridden onto chat", async () => {
  expect(normalizeUpstreamApiCompat("system_one")).toBe("system_one");
  expect(() => resolveUpstreamApiCompat("anthropic", "system_one")).toThrow("仅可用于审批");
  const directory = await mkdtemp(path.join(os.tmpdir(), "eco-system-one-"));
  try {
    const store = await createProviderStore(path.join(directory, "providers.sqlite"));
    const provider = store.saveProvider({
      name: "Jev",
      baseUrl: "https://api.typesafe.test",
      apiCompat: "system_one",
      apiKey: "key",
      defaultModel: "jev-latest",
      enabled: true,
    });
    const candidate = store.saveCandidateModel({ providerId: provider.id, modelId: "jev-latest" });
    const selection = { providerId: provider.id, modelId: candidate.modelId, candidateModelId: candidate.id };
    expect(store.listProviders()[0]?.apiCompat).toBe("system_one");
    expect(
      listCommitMessageCandidateModels(store.listProviders(), (id) => store.listCandidateModels(id)),
    ).toEqual([]);
    expect(
      listCommitMessageCandidateModels(
        store.listProviders(),
        (id) => store.listCandidateModels(id),
        "approval",
      ),
    ).toHaveLength(1);
    expect(resolveApprovalModelRoute(selection, store)).toMatchObject({
      kind: "system_one",
      modelId: "jev-latest",
    });
    expect(() => resolveAuxiliaryModelRoute(selection, store)).toThrow("仅可用于审批");
    expect(() => resolveVisionModelRoute(selection, store)).toThrow("仅可用于审批");
    expect(() => resolveApprovalModelRoute(undefined, store)).toThrow("未配置审批模型");
    expect(() => resolveApprovalModelRoute({ ...selection, modelId: "wrong" }, store)).toThrow("发生变化");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("workflow and runtime configs persist and clear approval independently without auxiliary fallback", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "eco-approval-config-"));
  try {
    const store = await createWorkflowSettingsStore(path.join(directory, "workflow.sqlite"));
    const auxiliary = { providerId: "chat", modelId: "fast", candidateModelId: "fast-id" };
    const approval = { providerId: "jev", modelId: "jev-latest", candidateModelId: "jev-id" };
    const saved = store.save({
      ...store.get(),
      defaultAuxiliaryModel: auxiliary,
      defaultApprovalModel: approval,
    });
    expect(store.get().defaultApprovalModel).toEqual(approval);
    const config = normalizeThreadRuntimeConfig(
      buildAcpThreadRuntimeConfig({
        auxiliaryModel: auxiliary,
        approvalModel: approval,
        bashReviewMode: "auto",
      }),
    );
    expect(config.approvalModel).toEqual(approval);
    expect(config.auxiliaryModel).toEqual(auxiliary);
    expect(isThreadRuntimeConfig(config)).toBe(true);
    expect(isThreadRuntimeConfig({ ...config, approvalModel: { ...approval, candidateModelId: "" } })).toBe(
      false,
    );
    const { defaultApprovalModel: _clear, ...cleared } = saved;
    store.save(cleared);
    expect(store.get().defaultApprovalModel).toBeUndefined();
    expect(store.get().defaultAuxiliaryModel).toEqual(auxiliary);
    expect(buildAcpThreadRuntimeConfig({ auxiliaryModel: auxiliary }).approvalModel).toBeUndefined();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
