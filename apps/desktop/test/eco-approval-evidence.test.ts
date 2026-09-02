import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AnthropicProxyRoute } from "../src/main/anthropic-proxy";
import {
  buildApprovalEnvelope,
  MAX_ENVELOPE_CHARS,
  shouldIncludeActivityLine,
  truncateText,
} from "../src/main/eco-approval-evidence";
import { reviewEcoApproval } from "../src/main/eco-approval-reviewer";

const route: AnthropicProxyRoute = {
  role: "auxiliary",
  provider: {
    id: "provider",
    name: "Provider",
    baseUrl: "https://provider.test",
    requestPath: "",
    version: "v1",
    apiCompat: "anthropic",
    tokenCountMode: "auto",
    defaultModel: "review-model",
    enabled: true,
    hasApiKey: true,
    apiKey: "secret",
    createdAt: "",
    updatedAt: "",
  },
  modelId: "review-model",
};

test("truncates entries with marker and filters bash_approval noise", () => {
  expect(truncateText("abcdefghij".repeat(20), 40)).toContain("<truncated />");
  expect(
    shouldIncludeActivityLine({
      role: "tool",
      message: "辅助模型已允许 Bash：ls",
      type: "bash_approval.approved",
    }),
  ).toBe(false);
  expect(shouldIncludeActivityLine({ role: "user", message: "fix the bug" })).toBe(true);
});

test("buildApprovalEnvelope stays under hard caps and prefers user lines", () => {
  const lines = Array.from({ length: 40 }, (_, index) => ({
    role: index % 3 === 0 ? "user" : "tool",
    message: `line-${index}-${"x".repeat(500)}`,
  }));
  const built = buildApprovalEnvelope({
    activityLines: lines,
    initialPrompt: "initial prompt",
    toolName: "Bash",
    toolInput: { command: "git status" },
    cwd: "/ws",
    workspacePath: "/ws",
    reason: "ask",
    source: "claude",
  });
  expect(built.ok).toBe(true);
  if (!built.ok) {
    return;
  }
  expect(built.serialized.length).toBeLessThanOrEqual(MAX_ENVELOPE_CHARS);
  expect(built.envelope.transcript.some((entry) => entry.role === "user")).toBe(true);
  expect(built.envelope.plannedAction.tool).toBe("Bash");
});

test("oversized planned action is truncated inside envelope", () => {
  const built = buildApprovalEnvelope({
    activityLines: [{ role: "user", message: "deploy" }],
    initialPrompt: "deploy",
    toolName: "Bash",
    toolInput: { command: "x".repeat(50_000) },
    cwd: "/ws",
    workspacePath: "/ws",
    reason: "run",
  });
  expect(built.ok).toBe(true);
  if (!built.ok) {
    return;
  }
  expect(built.serialized.length).toBeLessThanOrEqual(MAX_ENVELOPE_CHARS);
  expect(JSON.stringify(built.envelope.plannedAction.input).length).toBeLessThan(12_000);
});

test("reviewer reuses the same serialized envelope across retries", async () => {
  const bodies: string[] = [];
  const built = buildApprovalEnvelope({
    activityLines: [{ role: "user", message: "status" }],
    initialPrompt: "status",
    toolName: "Bash",
    toolInput: { command: "git status" },
    cwd: "/ws",
    workspacePath: "/ws",
    reason: "check",
  });
  expect(built.ok).toBe(true);
  if (!built.ok) {
    return;
  }

  await reviewEcoApproval({
    route,
    envelope: built.envelope,
    serializedEnvelope: built.serialized,
    fetcher: async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
      bodies.push(body.messages[0]?.content ?? "");
      return new Response(
        JSON.stringify({ type: "message", content: [{ type: "text", text: "not-json" }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toBe(built.serialized);
  expect(bodies[1]).toBe(built.serialized);
});

test("BashApprovalPanel source shows reviewRationale UI keys", () => {
  const panelPath = fileURLToPath(new URL("../src/renderer/BashApprovalPanel.tsx", import.meta.url));
  const source = readFileSync(panelPath, "utf8");
  expect(source).toContain("reviewRationale");
  expect(source).toContain("approval.bash.autoReviewFailedTitle");
  expect(source).toContain("approval.bash.autoReviewFailedHint");
});

test("policy markdown is loaded into system prompt", async () => {
  let system = "";
  await reviewEcoApproval({
    route,
    envelope: {
      userRequest: "check",
      toolName: "Bash",
      toolInput: { command: "git status" },
      cwd: "/ws",
      workspacePath: "/ws",
      reason: "x",
    },
    locale: "zh-CN",
    fetcher: async (_url, init) => {
      system = String((JSON.parse(String(init?.body)) as { system: string }).system);
      return new Response(
        JSON.stringify({
          type: "message",
          content: [
            {
              type: "text",
              text: JSON.stringify({
                risk_level: "low",
                user_authorization: "high",
                decision: "allow",
                policy_matches: [],
                rationale: "ok",
              }),
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });
  expect(system).toContain("Data Exfiltration");
  expect(system).toContain("human_required");
  expect(system).toContain("untrusted evidence");
  expect(system).toContain("简体中文");
});

test("reviewer asks for English rationale when locale is en-US", async () => {
  let system = "";
  await reviewEcoApproval({
    route,
    envelope: {
      userRequest: "check",
      toolName: "Bash",
      toolInput: { command: "git status" },
      cwd: "/ws",
      workspacePath: "/ws",
      reason: "x",
    },
    locale: "en-US",
    fetcher: async (_url, init) => {
      system = String((JSON.parse(String(init?.body)) as { system: string }).system);
      return new Response(
        JSON.stringify({
          type: "message",
          content: [
            {
              type: "text",
              text: JSON.stringify({
                risk_level: "low",
                user_authorization: "high",
                decision: "allow",
                policy_matches: [],
                rationale: "ok",
              }),
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });
  expect(system).toContain("Write the `rationale` field in English");
  expect(system).not.toContain("简体中文");
});
