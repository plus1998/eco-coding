import { expect, test } from "bun:test";
import {
  auditAnthropicMessagesBody,
  normalizeAnthropicMessagesBodyForCache,
  normalizeCchInText,
  STABLE_CCH_PLACEHOLDER,
} from "../src/main/proxy-cch-audit";

test("auditAnthropicMessagesBody finds billing header in system blocks", () => {
  const audit = auditAnthropicMessagesBody({
    model: "claude-sonnet-4-6",
    max_tokens: 256,
    system: [
      {
        type: "text",
        text: "x-anthropic-billing-header: cc_version=2.1.91.abf; cc_entrypoint=cli; cch=f4074;",
      },
      { type: "text", text: "You are helpful." },
    ],
    messages: [{ role: "user", content: "hi" }],
  });

  expect(audit.hitCount).toBeGreaterThan(0);
  expect(audit.billingHeaderInSystem).toBe(true);
  expect(audit.uniqueCchValues).toEqual(["f4074"]);
  expect(audit.hits[0]).toMatchObject({
    path: "system[0].text",
    kind: "billing_header",
    cchValue: "f4074",
  });
});

test("auditAnthropicMessagesBody finds cch tokens in historical tool results", () => {
  const audit = auditAnthropicMessagesBody({
    model: "claude-sonnet-4-6",
    max_tokens: 256,
    messages: [
      { role: "user", content: "run grep" },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_1",
            content: "proxy log: x-anthropic-billing-header: ... cch=14f72 ...",
          },
        ],
      },
    ],
  });

  expect(audit.uniqueCchValues).toEqual(["14f72"]);
  expect(audit.hits.some((hit) => hit.path.includes("messages[1]"))).toBe(true);
});

test("auditAnthropicMessagesBody ignores unrelated text", () => {
  const audit = auditAnthropicMessagesBody({
    model: "claude-sonnet-4-6",
    max_tokens: 256,
    messages: [{ role: "user", content: "cache control and cch variable names only" }],
  });

  expect(audit.hitCount).toBe(0);
  expect(audit.uniqueCchValues).toEqual([]);
});

test("normalizeCchInText replaces dynamic attestation hashes", () => {
  expect(normalizeCchInText("t=sdk-ts; cch=88232;")).toBe(`t=sdk-ts; ${STABLE_CCH_PLACEHOLDER};`);
});

test("normalizeAnthropicMessagesBodyForCache strips system billing header and stabilizes tool results", () => {
  const normalized = normalizeAnthropicMessagesBodyForCache({
    model: "claude-sonnet-4-6",
    max_tokens: 256,
    system: [
      {
        type: "text",
        text: "x-anthropic-billing-header: cc_version=2.1.91.abf; cc_entrypoint=sdk-ts; cch=88232;",
      },
      { type: "text", text: "You are helpful." },
    ],
    messages: [
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "log cch=14f72 done" }],
      },
    ],
  });

  const audit = auditAnthropicMessagesBody(normalized);
  expect(audit.hitCount).toBe(0);
  expect(normalized.system).toEqual([{ type: "text", text: "You are helpful." }]);
  expect(normalized.messages).toEqual([
    {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "toolu_1", content: `log ${STABLE_CCH_PLACEHOLDER} done` }],
    },
  ]);
});
