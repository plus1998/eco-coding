import { describe, expect, test } from "bun:test";
import {
  buildCursorAgentCliEnv,
  parseCursorAgentModelsOutput,
} from "../src/cursor-agent-models.js";

describe("buildCursorAgentCliEnv", () => {
  test("merges caller env over process env and injects CURSOR_API_KEY when present", () => {
    const env = buildCursorAgentCliEnv({ CUSTOM_VAR: "x" }, "  ck-test-123  ");
    expect(env.CURSOR_API_KEY).toBe("ck-test-123");
    expect(env.CUSTOM_VAR).toBe("x");
    expect(env.HOME ?? env.USERPROFILE).toBe(process.env.HOME ?? process.env.USERPROFILE);
  });

  test("leaves CURSOR_API_KEY untouched for blank or absent keys", () => {
    const withBlank = buildCursorAgentCliEnv(undefined, "   ");
    const without = buildCursorAgentCliEnv(undefined);
    for (const env of [withBlank, without]) {
      expect(env.CURSOR_API_KEY).toBe(process.env.CURSOR_API_KEY);
    }
  });
});

describe("listCursorAgentModels helpers", () => {
  test("parses the account-owned CLI model catalog", () => {
    expect(
      parseCursorAgentModelsOutput(
        "Available models\n\nauto - Auto (current, default)\ngpt-5.3-codex - Codex 5.3\n\u001b[2mTip: use --model <id>\u001b[0m\n",
      ),
    ).toEqual([
      { id: "auto", displayName: "Auto", current: true, default: true },
      { id: "gpt-5.3-codex", displayName: "Codex 5.3", current: false, default: false },
    ]);
  });
});
