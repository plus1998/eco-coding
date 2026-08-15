import { describe, expect, test } from "bun:test";
import { parseCursorAgentModelsOutput } from "../src/cursor-agent-models.js";

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
