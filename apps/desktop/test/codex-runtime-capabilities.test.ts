import { describe, expect, test } from "bun:test";
import {
  assertCodexRuntimeConfigSupported,
  LONGCAT_CODEX_RESPONSES_ERROR,
  LONGCAT_CODEX_SUBAGENT_ERROR,
} from "../src/main/codex-runtime-capabilities";

function config(input: Record<string, unknown>) {
  return {
    sessionMode: "agent",
    bashReviewMode: "allow_all",
    subagentEnabled: { coder: true },
    resolvedOrchestrationSnapshot: {
      mainAgent: {
        modelRef: { providerId: "provider", modelId: "model", apiCompat: "openai_responses" },
      },
      agents: [],
      ...input,
    },
  } as never;
}

describe("Codex runtime capability admission", () => {
  test("rejects LongCat Codex routes that still use Chat Completions", () => {
    expect(() =>
      assertCodexRuntimeConfigSupported(
        config({
          mainAgent: {
            modelRef: {
              providerId: "longcat-mamlso",
              modelId: "LongCat-2.0",
              apiCompat: "openai_chat_completions",
            },
          },
        }),
      ),
    ).toThrow(LONGCAT_CODEX_RESPONSES_ERROR);
  });

  test("allows LongCat Codex main tools when Responses is selected and no child agent is enabled", () => {
    expect(() =>
      assertCodexRuntimeConfigSupported(
        config({
          mainAgent: {
            modelRef: { providerId: "longcat-mamlso", modelId: "LongCat-2.0", apiCompat: "openai_responses" },
          },
        }),
      ),
    ).not.toThrow();
  });

  test("rejects enabled LongCat Codex child agents before starting a run", () => {
    expect(() =>
      assertCodexRuntimeConfigSupported(
        config({
          agents: [
            {
              agentKey: "coder",
              enabled: true,
              modelRef: {
                providerId: "longcat-mamlso",
                modelId: "LongCat-2.0",
                apiCompat: "openai_responses",
              },
            },
          ],
        }),
      ),
    ).toThrow(LONGCAT_CODEX_SUBAGENT_ERROR);
  });

  test("does not reject a disabled LongCat child or a different provider", () => {
    expect(() =>
      assertCodexRuntimeConfigSupported(
        config({
          agents: [
            {
              agentKey: "coder",
              enabled: false,
              modelRef: {
                providerId: "longcat-mamlso",
                modelId: "LongCat-2.0",
                apiCompat: "openai_responses",
              },
            },
            {
              agentKey: "explore",
              enabled: true,
              modelRef: { providerId: "other", modelId: "other-model", apiCompat: "openai_responses" },
            },
          ],
        }),
      ),
    ).not.toThrow();
  });
});
