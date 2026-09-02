import { expect, test } from "bun:test";
import { ACP_IMAGE_ONLY_PROMPT } from "@eco/runtime";
import { resolveThreadMessagePrompt } from "../src/main/thread-message-prompt";

test("resolveThreadMessagePrompt uses image-only default when prompt is missing", () => {
  expect(
    resolveThreadMessagePrompt(undefined, [{ mediaType: "image/png", path: "/tmp/test.png" }]),
  ).toBe(ACP_IMAGE_ONLY_PROMPT);
});

test("resolveThreadMessagePrompt keeps explicit prompt text", () => {
  expect(resolveThreadMessagePrompt("  describe this  ", [])).toBe("describe this");
});

test("resolveThreadMessagePrompt returns empty when no prompt or attachments", () => {
  expect(resolveThreadMessagePrompt(undefined, [])).toBe("");
});
